package sessions

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SessionConfig represents a trading session configuration
type SessionConfig struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	UpdateRateMs int       `json:"update_rate_ms"`
	Volatility   float64   `json:"volatility"`
	TrendBias    string    `json:"trend_bias"`
	VolumeFactor float64   `json:"volume_factor"`
	IsActive     bool      `json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// PriceEvent represents a scheduled price movement event
type PriceEvent struct {
	ID              int        `json:"id"`
	Pair            string     `json:"pair"`
	TargetPrice     float64    `json:"target_price"`
	Direction       string     `json:"direction"` // "up" or "down"
	DurationSeconds int        `json:"duration_seconds"`
	ScheduledAt     time.Time  `json:"scheduled_at"`
	StartedAt       *time.Time `json:"started_at,omitempty"`
	CompletedAt     *time.Time `json:"completed_at,omitempty"`
	Status          string     `json:"status"` // pending, active, completed, cancelled
	CreatedAt       time.Time  `json:"created_at"`
}

// AdminSettings key constants
const (
	SettingSessionMode      = "session_mode"
	SettingCurrentTrend     = "current_trend"
	SettingTrendMode        = "trend_mode"
	SettingTrendManualUntil = "trend_manual_until"
)

// Store handles database operations for sessions
type Store struct {
	pool *pgxpool.Pool
}

// NewStore creates a new sessions store
func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// GetAllSessions returns all session configurations
func (s *Store) GetAllSessions(ctx context.Context) ([]SessionConfig, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, update_rate_ms, volatility, trend_bias, volume_factor, is_active, created_at, updated_at
		FROM session_configs ORDER BY update_rate_ms ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []SessionConfig
	for rows.Next() {
		var sc SessionConfig
		if err := rows.Scan(&sc.ID, &sc.Name, &sc.UpdateRateMs, &sc.Volatility, &sc.TrendBias, &sc.VolumeFactor, &sc.IsActive, &sc.CreatedAt, &sc.UpdatedAt); err != nil {
			return nil, err
		}
		sessions = append(sessions, sc)
	}
	return sessions, nil
}

// GetActiveSession returns the currently active session
func (s *Store) GetActiveSession(ctx context.Context) (*SessionConfig, error) {
	var sc SessionConfig
	err := s.pool.QueryRow(ctx, `
		SELECT id, name, update_rate_ms, volatility, trend_bias, volume_factor, is_active, created_at, updated_at
		FROM session_configs WHERE is_active = TRUE LIMIT 1
	`).Scan(&sc.ID, &sc.Name, &sc.UpdateRateMs, &sc.Volatility, &sc.TrendBias, &sc.VolumeFactor, &sc.IsActive, &sc.CreatedAt, &sc.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &sc, nil
}

// SwitchSession activates a session and deactivates others
func (s *Store) SwitchSession(ctx context.Context, sessionID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Deactivate all
	if _, err := tx.Exec(ctx, "UPDATE session_configs SET is_active = FALSE, updated_at = NOW()"); err != nil {
		return err
	}
	// Activate target
	if _, err := tx.Exec(ctx, "UPDATE session_configs SET is_active = TRUE, updated_at = NOW() WHERE id = $1", sessionID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// GetSetting gets an admin setting value
func (s *Store) GetSetting(ctx context.Context, key string) (string, error) {
	var value string
	err := s.pool.QueryRow(ctx, "SELECT value FROM admin_settings WHERE key = $1", key).Scan(&value)
	return value, err
}

// SetSetting sets an admin setting value
func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO admin_settings (key, value, updated_at) VALUES ($1, $2, NOW())
		ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
	`, key, value)
	return err
}

// GetPendingEvents returns all pending price events
func (s *Store) GetPendingEvents(ctx context.Context) ([]PriceEvent, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, pair, target_price, direction, duration_seconds, scheduled_at, started_at, completed_at, status, created_at
		FROM price_events WHERE status IN ('pending', 'active') ORDER BY scheduled_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []PriceEvent
	for rows.Next() {
		var pe PriceEvent
		if err := rows.Scan(&pe.ID, &pe.Pair, &pe.TargetPrice, &pe.Direction, &pe.DurationSeconds, &pe.ScheduledAt, &pe.StartedAt, &pe.CompletedAt, &pe.Status, &pe.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, pe)
	}
	return events, nil
}

// GetAllEvents returns all price events (for history)
func (s *Store) GetAllEvents(ctx context.Context) ([]PriceEvent, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, pair, target_price, direction, duration_seconds, scheduled_at, started_at, completed_at, status, created_at
		FROM price_events ORDER BY created_at DESC LIMIT 50
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []PriceEvent
	for rows.Next() {
		var pe PriceEvent
		if err := rows.Scan(&pe.ID, &pe.Pair, &pe.TargetPrice, &pe.Direction, &pe.DurationSeconds, &pe.ScheduledAt, &pe.StartedAt, &pe.CompletedAt, &pe.Status, &pe.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, pe)
	}
	return events, nil
}

// EventsResult contains paginated events and total count
type EventsResult struct {
	Events []PriceEvent `json:"events"`
	Total  int          `json:"total"`
}

// GetEventsPaginated returns events with pagination and date filtering
func (s *Store) GetEventsPaginated(ctx context.Context, limit, offset int, dateFrom, dateTo time.Time) (*EventsResult, error) {
	// Count total matching events
	var total int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM price_events
		WHERE created_at >= $1 AND created_at <= $2
	`, dateFrom, dateTo).Scan(&total)
	if err != nil {
		return nil, err
	}

	// Get paginated events
	rows, err := s.pool.Query(ctx, `
		SELECT id, pair, target_price, direction, duration_seconds, scheduled_at, started_at, completed_at, status, created_at
		FROM price_events
		WHERE created_at >= $1 AND created_at <= $2
		ORDER BY created_at DESC
		LIMIT $3 OFFSET $4
	`, dateFrom, dateTo, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []PriceEvent
	for rows.Next() {
		var pe PriceEvent
		if err := rows.Scan(&pe.ID, &pe.Pair, &pe.TargetPrice, &pe.Direction, &pe.DurationSeconds, &pe.ScheduledAt, &pe.StartedAt, &pe.CompletedAt, &pe.Status, &pe.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, pe)
	}

	return &EventsResult{
		Events: events,
		Total:  total,
	}, nil
}

// CreateEvent creates a new price event
func (s *Store) CreateEvent(ctx context.Context, pair string, targetPrice float64, direction string, durationSecs int, scheduledAt time.Time) (*PriceEvent, error) {
	var pe PriceEvent
	err := s.pool.QueryRow(ctx, `
		INSERT INTO price_events (pair, target_price, direction, duration_seconds, scheduled_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, pair, target_price, direction, duration_seconds, scheduled_at, status, created_at
	`, pair, targetPrice, direction, durationSecs, scheduledAt).Scan(&pe.ID, &pe.Pair, &pe.TargetPrice, &pe.Direction, &pe.DurationSeconds, &pe.ScheduledAt, &pe.Status, &pe.CreatedAt)
	return &pe, err
}

// CancelEvent cancels a price event
func (s *Store) CancelEvent(ctx context.Context, eventID int) error {
	_, err := s.pool.Exec(ctx, "UPDATE price_events SET status = 'cancelled' WHERE id = $1 AND status = 'pending'", eventID)
	return err
}

// MarkEventActive marks an event as active
func (s *Store) MarkEventActive(ctx context.Context, eventID int) error {
	_, err := s.pool.Exec(ctx, "UPDATE price_events SET status = 'active', started_at = NOW() WHERE id = $1", eventID)
	return err
}

// MarkEventCompleted marks an event as completed
func (s *Store) MarkEventCompleted(ctx context.Context, eventID int) error {
	_, err := s.pool.Exec(ctx, "UPDATE price_events SET status = 'completed', completed_at = NOW() WHERE id = $1", eventID)
	return err
}
