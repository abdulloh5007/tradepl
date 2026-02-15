package sessions

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

const (
	newsStatusPending   = "pending"
	newsStatusPre       = "pre"
	newsStatusLive      = "live"
	newsStatusPost      = "post"
	newsStatusCompleted = "completed"
	newsStatusCancelled = "cancelled"
)

type EconomicNewsEvent struct {
	ID           int64      `json:"id"`
	Pair         string     `json:"pair"`
	Title        string     `json:"title"`
	Impact       string     `json:"impact"`
	RuleKey      string     `json:"rule_key"`
	Source       string     `json:"source"`
	Forecast     float64    `json:"forecast_value"`
	Actual       *float64   `json:"actual_value,omitempty"`
	ActualAuto   bool       `json:"actual_auto"`
	PreSeconds   int        `json:"pre_seconds"`
	EventSeconds int        `json:"event_seconds"`
	PostSeconds  int        `json:"post_seconds"`
	ScheduledAt  time.Time  `json:"scheduled_at"`
	LiveStarted  *time.Time `json:"live_started_at,omitempty"`
	PostStarted  *time.Time `json:"post_started_at,omitempty"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
	Status       string     `json:"status"`
	CreatedBy    string     `json:"created_by"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type EconomicNewsEventsResult struct {
	Events []EconomicNewsEvent `json:"events"`
	Total  int                 `json:"total"`
}

type CreateEconomicNewsInput struct {
	Pair         string
	Title        string
	Impact       string
	RuleKey      string
	Source       string
	Forecast     float64
	PreSeconds   int
	EventSeconds int
	PostSeconds  int
	ScheduledAt  time.Time
	CreatedBy    string
}

const economicNewsSelectColumns = `
	id, pair, title, impact, rule_key, source, forecast_value, actual_value, actual_auto,
	pre_seconds, event_seconds, post_seconds, scheduled_at, live_started_at, post_started_at,
	completed_at, status, created_by, created_at, updated_at
`

func scanEconomicNewsRow(scan func(dest ...any) error) (*EconomicNewsEvent, error) {
	var evt EconomicNewsEvent
	var actual sql.NullFloat64
	var liveStarted sql.NullTime
	var postStarted sql.NullTime
	var completed sql.NullTime
	err := scan(
		&evt.ID,
		&evt.Pair,
		&evt.Title,
		&evt.Impact,
		&evt.RuleKey,
		&evt.Source,
		&evt.Forecast,
		&actual,
		&evt.ActualAuto,
		&evt.PreSeconds,
		&evt.EventSeconds,
		&evt.PostSeconds,
		&evt.ScheduledAt,
		&liveStarted,
		&postStarted,
		&completed,
		&evt.Status,
		&evt.CreatedBy,
		&evt.CreatedAt,
		&evt.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if actual.Valid {
		v := actual.Float64
		evt.Actual = &v
	}
	if liveStarted.Valid {
		v := liveStarted.Time
		evt.LiveStarted = &v
	}
	if postStarted.Valid {
		v := postStarted.Time
		evt.PostStarted = &v
	}
	if completed.Valid {
		v := completed.Time
		evt.CompletedAt = &v
	}
	return &evt, nil
}

func normalizeNewsPair(pair string) string {
	p := strings.ToUpper(strings.TrimSpace(pair))
	if p == "" {
		return "UZS-USD"
	}
	return p
}

func normalizeNewsLimit(limit, fallback, max int) int {
	if limit <= 0 {
		limit = fallback
	}
	if limit > max {
		limit = max
	}
	return limit
}

func (s *Store) CreateEconomicNews(ctx context.Context, in CreateEconomicNewsInput) (*EconomicNewsEvent, error) {
	pair := normalizeNewsPair(in.Pair)
	ruleKey := strings.TrimSpace(strings.ToLower(in.RuleKey))
	if ruleKey == "" {
		ruleKey = "manual"
	}
	source := strings.TrimSpace(strings.ToLower(in.Source))
	if source == "" {
		source = "manual"
	}
	createdBy := strings.TrimSpace(in.CreatedBy)
	if createdBy == "" {
		createdBy = "owner"
	}
	at := in.ScheduledAt.UTC()
	row := s.pool.QueryRow(ctx, `
		INSERT INTO economic_news_events (
			pair, title, impact, rule_key, source, forecast_value,
			pre_seconds, event_seconds, post_seconds, scheduled_at, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING `+economicNewsSelectColumns+`
	`, pair, strings.TrimSpace(in.Title), strings.TrimSpace(strings.ToLower(in.Impact)), ruleKey, source, in.Forecast,
		in.PreSeconds, in.EventSeconds, in.PostSeconds, at, createdBy)
	return scanEconomicNewsRow(row.Scan)
}

func (s *Store) EnsureAutoEconomicNews(ctx context.Context, in CreateEconomicNewsInput) error {
	pair := normalizeNewsPair(in.Pair)
	ruleKey := strings.TrimSpace(strings.ToLower(in.RuleKey))
	if ruleKey == "" {
		ruleKey = "auto"
	}
	source := strings.TrimSpace(strings.ToLower(in.Source))
	if source == "" {
		source = "auto"
	}
	createdBy := strings.TrimSpace(in.CreatedBy)
	if createdBy == "" {
		createdBy = "system"
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO economic_news_events (
			pair, title, impact, rule_key, source, forecast_value,
			pre_seconds, event_seconds, post_seconds, scheduled_at, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (pair, rule_key, scheduled_at, source) DO NOTHING
	`, pair, strings.TrimSpace(in.Title), strings.TrimSpace(strings.ToLower(in.Impact)), ruleKey, source, in.Forecast,
		in.PreSeconds, in.EventSeconds, in.PostSeconds, in.ScheduledAt.UTC(), createdBy)
	return err
}

func (s *Store) GetEconomicNewsUpcoming(ctx context.Context, pair string, limit int) ([]EconomicNewsEvent, error) {
	pair = normalizeNewsPair(pair)
	limit = normalizeNewsLimit(limit, 3, 20)
	now := time.Now().UTC()
	rows, err := s.pool.Query(ctx, `
		SELECT `+economicNewsSelectColumns+`
		FROM economic_news_events
		WHERE pair = $1
		  AND (
			status IN ('pre','live')
			OR (status = 'pending' AND scheduled_at >= $2)
		  )
		ORDER BY
			CASE status
				WHEN 'live' THEN 0
				WHEN 'pre' THEN 1
				WHEN 'pending' THEN 2
				ELSE 9
			END,
			scheduled_at ASC
		LIMIT $3
	`, pair, now.Add(-30*time.Minute), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]EconomicNewsEvent, 0, limit)
	for rows.Next() {
		evt, scanErr := scanEconomicNewsRow(rows.Scan)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, *evt)
	}
	return out, nil
}

func (s *Store) GetEconomicNewsRecent(ctx context.Context, pair string, limit int) ([]EconomicNewsEvent, error) {
	pair = normalizeNewsPair(pair)
	limit = normalizeNewsLimit(limit, 20, 100)
	rows, err := s.pool.Query(ctx, `
		SELECT `+economicNewsSelectColumns+`
		FROM economic_news_events
		WHERE pair = $1
		  AND status IN ('live','completed')
		ORDER BY updated_at DESC
		LIMIT $2
	`, pair, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]EconomicNewsEvent, 0, limit)
	for rows.Next() {
		evt, scanErr := scanEconomicNewsRow(rows.Scan)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, *evt)
	}
	return out, nil
}

func (s *Store) GetEconomicNewsPaginated(ctx context.Context, pair string, limit, offset int, dateFrom, dateTo time.Time) (*EconomicNewsEventsResult, error) {
	pair = normalizeNewsPair(pair)
	limit = normalizeNewsLimit(limit, 20, 100)
	if offset < 0 {
		offset = 0
	}

	var total int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM economic_news_events
		WHERE pair = $1
		  AND scheduled_at >= $2
		  AND scheduled_at <= $3
	`, pair, dateFrom.UTC(), dateTo.UTC()).Scan(&total)
	if err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT `+economicNewsSelectColumns+`
		FROM economic_news_events
		WHERE pair = $1
		  AND scheduled_at >= $2
		  AND scheduled_at <= $3
		ORDER BY scheduled_at DESC
		LIMIT $4 OFFSET $5
	`, pair, dateFrom.UTC(), dateTo.UTC(), limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]EconomicNewsEvent, 0, limit)
	for rows.Next() {
		evt, scanErr := scanEconomicNewsRow(rows.Scan)
		if scanErr != nil {
			return nil, scanErr
		}
		events = append(events, *evt)
	}
	return &EconomicNewsEventsResult{Events: events, Total: total}, nil
}

func (s *Store) CancelEconomicNews(ctx context.Context, eventID int64) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE economic_news_events
		SET status = $2, updated_at = NOW()
		WHERE id = $1
		  AND status IN ('pending','pre')
	`, eventID, newsStatusCancelled)
	return err
}

func (s *Store) GetEconomicNewsLifecycleEvents(ctx context.Context, pair string, now time.Time, lookAhead time.Duration, limit int) ([]EconomicNewsEvent, error) {
	pair = normalizeNewsPair(pair)
	limit = normalizeNewsLimit(limit, 32, 256)
	from := now.UTC().Add(-48 * time.Hour)
	to := now.UTC().Add(lookAhead)
	rows, err := s.pool.Query(ctx, `
		SELECT `+economicNewsSelectColumns+`
		FROM economic_news_events
		WHERE pair = $1
		  AND status IN ('pending','pre','live','post')
		  AND scheduled_at >= $2
		  AND scheduled_at <= $3
		ORDER BY scheduled_at ASC
		LIMIT $4
	`, pair, from, to, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]EconomicNewsEvent, 0, limit)
	for rows.Next() {
		evt, scanErr := scanEconomicNewsRow(rows.Scan)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, *evt)
	}
	return out, nil
}

func (s *Store) MarkEconomicNewsPre(ctx context.Context, eventID int64, at time.Time) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE economic_news_events
		SET status = 'pre', updated_at = $2
		WHERE id = $1
		  AND status IN ('pending','pre')
	`, eventID, at.UTC())
	return err
}

func (s *Store) MarkEconomicNewsLive(ctx context.Context, eventID int64, at time.Time, actual *float64, actualAuto bool) error {
	if actual == nil {
		_, err := s.pool.Exec(ctx, `
			UPDATE economic_news_events
			SET status = 'live',
				live_started_at = COALESCE(live_started_at, $2),
				updated_at = $2
			WHERE id = $1
			  AND status IN ('pending','pre','live')
		`, eventID, at.UTC())
		return err
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE economic_news_events
		SET status = 'live',
			live_started_at = COALESCE(live_started_at, $2),
			actual_value = COALESCE(actual_value, $3),
			actual_auto = CASE WHEN actual_value IS NULL THEN $4 ELSE actual_auto END,
			updated_at = $2
		WHERE id = $1
		  AND status IN ('pending','pre','live')
	`, eventID, at.UTC(), *actual, actualAuto)
	return err
}

func (s *Store) MarkEconomicNewsPost(ctx context.Context, eventID int64, at time.Time) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE economic_news_events
		SET status = 'post',
			post_started_at = COALESCE(post_started_at, $2),
			updated_at = $2
		WHERE id = $1
		  AND status IN ('live','post')
	`, eventID, at.UTC())
	return err
}

func (s *Store) MarkEconomicNewsCompleted(ctx context.Context, eventID int64, at time.Time) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE economic_news_events
		SET status = 'completed',
			completed_at = COALESCE(completed_at, $2),
			updated_at = $2
		WHERE id = $1
		  AND status IN ('pending','pre','live','post','completed')
	`, eventID, at.UTC())
	return err
}
