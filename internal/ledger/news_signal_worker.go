package ledger

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"strings"
	"sync/atomic"
	"time"

	"lv-tradepl/internal/newssignal"
)

const (
	newsSignalTypeDailyDigest = "daily_digest"
	newsSignalTypePreAlert    = "pre_alert"
)

type newsSignalEvent struct {
	ID           int64
	Pair         string
	Title        string
	Impact       string
	RuleKey      string
	Forecast     float64
	ScheduledAt  time.Time
	EventSeconds int
	Status       string
}

var newsSignalMissingTableWarned atomic.Bool

func (h *Handler) StartNewsSignalWorker(ctx context.Context) {
	run := func() {
		if strings.TrimSpace(h.tgBotToken) == "" {
			return
		}
		cfg, err := newssignal.Load(ctx, h.svc.pool)
		if err != nil {
			log.Printf("[news-signal] failed to load config: %v", err)
			return
		}
		if !cfg.Enabled || strings.TrimSpace(cfg.ChatID) == "" {
			return
		}
		now := time.Now().UTC()
		if err := h.sendNewsDailyDigestIfDue(ctx, cfg, now); err != nil {
			log.Printf("[news-signal] daily digest: %v", err)
		}
		if err := h.sendNewsPreAlertsIfDue(ctx, cfg, now); err != nil {
			log.Printf("[news-signal] pre-alert: %v", err)
		}
	}

	run()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}

func (h *Handler) sendNewsDailyDigestIfDue(ctx context.Context, cfg newssignal.Config, now time.Time) error {
	loc, err := time.LoadLocation(strings.TrimSpace(cfg.Timezone))
	if err != nil {
		loc = time.FixedZone("Asia/Tashkent", 5*60*60)
	}
	localNow := now.In(loc)
	hour, minute := newssignal.ParseDigestHourMinute(cfg.DailyDigestTime)
	digestAt := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), hour, minute, 0, 0, loc)
	if localNow.Before(digestAt) {
		return nil
	}

	localDateKey := localNow.Format("2006-01-02")
	signalKey := fmt.Sprintf("news:daily:%s:%s", strings.ToUpper(strings.TrimSpace(cfg.Pair)), localDateKey)
	sent, err := h.newsSignalAlreadySent(ctx, signalKey)
	if err != nil || sent {
		return err
	}

	dayStart := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, loc)
	dayEnd := dayStart.Add(24 * time.Hour)
	events, err := h.loadNewsSignalEventsForRange(ctx, cfg.Pair, dayStart.UTC(), dayEnd.UTC())
	if err != nil {
		return err
	}

	message := formatNewsDailyDigestMessage(events, localNow, loc)
	if err := h.telegramCallJSON(ctx, "sendMessage", map[string]interface{}{
		"chat_id":                  strings.TrimSpace(cfg.ChatID),
		"text":                     message,
		"parse_mode":               "HTML",
		"disable_web_page_preview": true,
	}, nil); err != nil {
		return err
	}
	return h.markNewsSignalSent(ctx, signalKey, nil, newsSignalTypeDailyDigest, cfg.ChatID, map[string]any{
		"date":       localDateKey,
		"events":     len(events),
		"digest_at":  cfg.DailyDigestTime,
		"pre_alerts": cfg.PreAlertMinutes,
	})
}

func (h *Handler) sendNewsPreAlertsIfDue(ctx context.Context, cfg newssignal.Config, now time.Time) error {
	preWindow := time.Duration(cfg.PreAlertMinutes) * time.Minute
	if preWindow <= 0 {
		preWindow = 2 * time.Minute
	}
	windowStart := now.Add(-30 * time.Second)
	windowEnd := now.Add(preWindow)
	events, err := h.loadNewsSignalPreAlertEvents(ctx, cfg.Pair, windowStart, windowEnd)
	if err != nil {
		return err
	}
	if len(events) == 0 {
		return nil
	}

	chatID := strings.TrimSpace(cfg.ChatID)
	for _, evt := range events {
		if !evt.ScheduledAt.After(now.Add(-30 * time.Second)) {
			continue
		}
		signalKey := fmt.Sprintf("news:pre:%d:%d", evt.ID, cfg.PreAlertMinutes)
		sent, sentErr := h.newsSignalAlreadySent(ctx, signalKey)
		if sentErr != nil || sent {
			if sentErr != nil {
				return sentErr
			}
			continue
		}

		direction := resolveNewsSignalDirection(evt)
		probability := resolveNewsSignalProbability(evt, now)
		message := formatNewsPreAlertMessage(evt, direction, probability, cfg.PreAlertMinutes)
		if err := h.telegramCallJSON(ctx, "sendMessage", map[string]interface{}{
			"chat_id":                  chatID,
			"text":                     message,
			"parse_mode":               "HTML",
			"disable_web_page_preview": true,
		}, nil); err != nil {
			continue
		}
		eventID := evt.ID
		_ = h.markNewsSignalSent(ctx, signalKey, &eventID, newsSignalTypePreAlert, chatID, map[string]any{
			"event_id":      evt.ID,
			"direction":     direction,
			"probability":   probability,
			"scheduled_at":  evt.ScheduledAt.UTC().Format(time.RFC3339),
			"event_seconds": evt.EventSeconds,
		})
	}
	return nil
}

func (h *Handler) loadNewsSignalEventsForRange(ctx context.Context, pair string, fromUTC, toUTC time.Time) ([]newsSignalEvent, error) {
	rows, err := h.svc.pool.Query(ctx, `
		SELECT
			id,
			pair,
			title,
			impact,
			rule_key,
			forecast_value,
			scheduled_at,
			event_seconds,
			status
		FROM economic_news_events
		WHERE pair = $1
		  AND status IN ('pending','pre','live')
		  AND scheduled_at >= $2
		  AND scheduled_at < $3
		ORDER BY scheduled_at ASC
		LIMIT 256
	`, strings.ToUpper(strings.TrimSpace(pair)), fromUTC, toUTC)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]newsSignalEvent, 0, 32)
	for rows.Next() {
		var item newsSignalEvent
		if scanErr := rows.Scan(
			&item.ID,
			&item.Pair,
			&item.Title,
			&item.Impact,
			&item.RuleKey,
			&item.Forecast,
			&item.ScheduledAt,
			&item.EventSeconds,
			&item.Status,
		); scanErr != nil {
			return nil, scanErr
		}
		item.Pair = strings.ToUpper(strings.TrimSpace(item.Pair))
		item.Impact = strings.ToLower(strings.TrimSpace(item.Impact))
		item.RuleKey = strings.ToLower(strings.TrimSpace(item.RuleKey))
		item.Status = strings.ToLower(strings.TrimSpace(item.Status))
		out = append(out, item)
	}
	return out, rows.Err()
}

func (h *Handler) loadNewsSignalPreAlertEvents(ctx context.Context, pair string, fromUTC, toUTC time.Time) ([]newsSignalEvent, error) {
	rows, err := h.svc.pool.Query(ctx, `
		SELECT
			id,
			pair,
			title,
			impact,
			rule_key,
			forecast_value,
			scheduled_at,
			event_seconds,
			status
		FROM economic_news_events
		WHERE pair = $1
		  AND status IN ('pending','pre')
		  AND scheduled_at > $2
		  AND scheduled_at <= $3
		ORDER BY scheduled_at ASC
		LIMIT 128
	`, strings.ToUpper(strings.TrimSpace(pair)), fromUTC, toUTC)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]newsSignalEvent, 0, 16)
	for rows.Next() {
		var item newsSignalEvent
		if scanErr := rows.Scan(
			&item.ID,
			&item.Pair,
			&item.Title,
			&item.Impact,
			&item.RuleKey,
			&item.Forecast,
			&item.ScheduledAt,
			&item.EventSeconds,
			&item.Status,
		); scanErr != nil {
			return nil, scanErr
		}
		item.Pair = strings.ToUpper(strings.TrimSpace(item.Pair))
		item.Impact = strings.ToLower(strings.TrimSpace(item.Impact))
		item.RuleKey = strings.ToLower(strings.TrimSpace(item.RuleKey))
		item.Status = strings.ToLower(strings.TrimSpace(item.Status))
		out = append(out, item)
	}
	return out, rows.Err()
}

func (h *Handler) newsSignalAlreadySent(ctx context.Context, signalKey string) (bool, error) {
	var exists bool
	err := h.svc.pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM telegram_news_signal_logs
			WHERE signal_key = $1
		)
	`, signalKey).Scan(&exists)
	if err != nil {
		if isUndefinedTableError(err) {
			if newsSignalMissingTableWarned.CompareAndSwap(false, true) {
				log.Printf("[news-signal] telegram_news_signal_logs table is missing, run migrations")
			}
			return true, nil
		}
		return false, err
	}
	return exists, nil
}

func (h *Handler) markNewsSignalSent(ctx context.Context, signalKey string, eventID *int64, signalType, chatID string, payload map[string]any) error {
	if len(payload) == 0 {
		payload = map[string]any{}
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = h.svc.pool.Exec(ctx, `
		INSERT INTO telegram_news_signal_logs(
			signal_key,
			event_id,
			signal_type,
			chat_id,
			payload,
			sent_at
		) VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
		ON CONFLICT (signal_key) DO NOTHING
	`, signalKey, eventID, strings.TrimSpace(signalType), strings.TrimSpace(chatID), string(encoded))
	if err != nil && isUndefinedTableError(err) {
		return nil
	}
	return err
}

func formatNewsDailyDigestMessage(events []newsSignalEvent, nowLocal time.Time, loc *time.Location) string {
	var b strings.Builder
	b.Grow(1024)
	b.WriteString("🗓 <b>Daily News Digest</b>\n")
	b.WriteString("Pair: <b>UZS-USD</b>\n")
	b.WriteString(fmt.Sprintf("Date: <b>%s</b> (%s)\n\n", nowLocal.Format("2006-01-02"), loc.String()))
	if len(events) == 0 {
		b.WriteString("No scheduled events for today.")
		return b.String()
	}
	maxItems := len(events)
	if maxItems > 20 {
		maxItems = 20
	}
	for i := 0; i < maxItems; i++ {
		item := events[i]
		b.WriteString(fmt.Sprintf("%d) <b>%s</b> [%s] %s\n",
			i+1,
			item.ScheduledAt.In(loc).Format("15:04"),
			strings.ToUpper(item.Impact),
			safeHTML(strings.TrimSpace(item.Title)),
		))
	}
	if len(events) > maxItems {
		b.WriteString(fmt.Sprintf("\n+%d more events...", len(events)-maxItems))
	}
	return b.String()
}

func formatNewsPreAlertMessage(evt newsSignalEvent, direction string, probability int, preAlertMinutes int) string {
	loc, err := time.LoadLocation("Asia/Tashkent")
	if err != nil {
		loc = time.FixedZone("Asia/Tashkent", 5*60*60)
	}
	directionLabel := "UP"
	if direction == "down" {
		directionLabel = "DOWN"
	}
	durationMinutes := int(math.Max(1, math.Round(float64(maxInt(evt.EventSeconds, 60))/60.0)))
	return fmt.Sprintf(
		"⚡ <b>News Signal (%d min)</b>\n"+
			"Event: <b>%s</b> [%s]\n"+
			"Pair: <b>%s</b>\n"+
			"Expected move: <b>%s %d%%</b>\n"+
			"Start: <b>%s</b> (%s)\n"+
			"Impulse duration: <b>%d min</b>\n\n"+
			"<i>Not financial advice.</i>",
		preAlertMinutes,
		safeHTML(strings.TrimSpace(evt.Title)),
		strings.ToUpper(strings.TrimSpace(evt.Impact)),
		strings.ToUpper(strings.TrimSpace(evt.Pair)),
		directionLabel,
		probability,
		evt.ScheduledAt.In(loc).Format("15:04"),
		loc.String(),
		durationMinutes,
	)
}

func resolveNewsSignalDirection(evt newsSignalEvent) string {
	text := strings.ToLower(strings.TrimSpace(evt.RuleKey + " " + evt.Title))
	downHints := []string{"cut", "deficit", "weak", "bear", "drop", "decline", "lower", "down"}
	upHints := []string{"hike", "surplus", "strong", "bull", "rise", "growth", "higher", "up"}
	for _, hint := range downHints {
		if strings.Contains(text, hint) {
			return "down"
		}
	}
	for _, hint := range upHints {
		if strings.Contains(text, hint) {
			return "up"
		}
	}
	seed := evt.ID + int64(evt.EventSeconds) + evt.ScheduledAt.Unix()
	if seed%2 == 0 {
		return "up"
	}
	return "down"
}

func resolveNewsSignalProbability(evt newsSignalEvent, now time.Time) int {
	durationSec := evt.EventSeconds
	if durationSec <= 0 {
		durationSec = 60
	}
	clampedDuration := durationSec
	if clampedDuration < 60 {
		clampedDuration = 60
	}
	if clampedDuration > 1800 {
		clampedDuration = 1800
	}
	ratio := float64(clampedDuration-60) / float64(1800-60)
	if ratio < 0 {
		ratio = 0
	}
	if ratio > 1 {
		ratio = 1
	}
	minProb := 70 + int(math.Round(ratio*15))
	maxProb := 85 + int(math.Round(ratio*15))
	if maxProb > 100 {
		maxProb = 100
	}
	if minProb > 100 {
		minProb = 100
	}
	if maxProb < minProb {
		maxProb = minProb
	}
	rng := rand.New(rand.NewSource(now.UnixNano() + evt.ID*7919))
	if maxProb == minProb {
		return minProb
	}
	return minProb + rng.Intn(maxProb-minProb+1)
}
