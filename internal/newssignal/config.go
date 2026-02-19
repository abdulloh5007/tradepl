package newssignal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	settingKey = "telegram_news_signal_config"

	defaultDigestTime   = "08:00"
	defaultPreAlertMins = 2
	defaultTimezone     = "Asia/Tashkent"
	defaultPair         = "UZS-USD"
	minPreAlertMinutes  = 1
	maxPreAlertMinutes  = 60
)

type Config struct {
	Enabled         bool   `json:"enabled"`
	ChatID          string `json:"chat_id"`
	DailyDigestTime string `json:"daily_digest_time"`
	PreAlertMinutes int    `json:"pre_alert_minutes"`
	Timezone        string `json:"timezone"`
	Pair            string `json:"pair"`
}

func Defaults() Config {
	return Config{
		Enabled:         false,
		ChatID:          "",
		DailyDigestTime: defaultDigestTime,
		PreAlertMinutes: defaultPreAlertMins,
		Timezone:        defaultTimezone,
		Pair:            defaultPair,
	}
}

func Normalize(in Config) Config {
	out := in
	out.ChatID = strings.TrimSpace(out.ChatID)
	out.DailyDigestTime = normalizeDailyDigestTime(out.DailyDigestTime)
	out.PreAlertMinutes = normalizePreAlertMinutes(out.PreAlertMinutes)
	if strings.TrimSpace(out.Timezone) == "" {
		out.Timezone = defaultTimezone
	}
	out.Timezone = strings.TrimSpace(out.Timezone)
	if strings.TrimSpace(out.Pair) == "" {
		out.Pair = defaultPair
	}
	out.Pair = strings.ToUpper(strings.TrimSpace(out.Pair))
	return out
}

func Validate(in Config) error {
	cfg := Normalize(in)
	if cfg.Enabled && cfg.ChatID == "" {
		return errors.New("chat_id is required when signal channel is enabled")
	}
	if !isValidDigestTime(cfg.DailyDigestTime) {
		return errors.New("daily_digest_time must be in HH:MM format")
	}
	if cfg.PreAlertMinutes < minPreAlertMinutes || cfg.PreAlertMinutes > maxPreAlertMinutes {
		return fmt.Errorf("pre_alert_minutes must be between %d and %d", minPreAlertMinutes, maxPreAlertMinutes)
	}
	return nil
}

func Load(ctx context.Context, pool *pgxpool.Pool) (Config, error) {
	if pool == nil {
		return Defaults(), nil
	}
	var raw string
	err := pool.QueryRow(ctx, `
		SELECT value
		FROM system_settings
		WHERE key = $1
	`, settingKey).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isUndefinedTableError(err) {
			return Defaults(), nil
		}
		return Defaults(), err
	}
	var cfg Config
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &cfg); err != nil {
		return Defaults(), nil
	}
	return Normalize(cfg), nil
}

func Save(ctx context.Context, pool *pgxpool.Pool, in Config) (Config, error) {
	if pool == nil {
		return Defaults(), errors.New("database is unavailable")
	}
	cfg := Normalize(in)
	if err := Validate(cfg); err != nil {
		return cfg, err
	}
	payload, err := json.Marshal(cfg)
	if err != nil {
		return cfg, err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO system_settings(key, value, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (key)
		DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
	`, settingKey, string(payload))
	if err != nil {
		return cfg, err
	}
	return cfg, nil
}

func ParseDigestHourMinute(digest string) (int, int) {
	v := normalizeDailyDigestTime(digest)
	parts := strings.Split(v, ":")
	if len(parts) != 2 {
		return 8, 0
	}
	hour, _ := strconv.Atoi(parts[0])
	minute, _ := strconv.Atoi(parts[1])
	return hour, minute
}

func normalizePreAlertMinutes(v int) int {
	if v < minPreAlertMinutes {
		return defaultPreAlertMins
	}
	if v > maxPreAlertMinutes {
		return maxPreAlertMinutes
	}
	return v
}

func normalizeDailyDigestTime(raw string) string {
	v := strings.TrimSpace(raw)
	if !isValidDigestTime(v) {
		return defaultDigestTime
	}
	parts := strings.Split(v, ":")
	hour, _ := strconv.Atoi(parts[0])
	minute, _ := strconv.Atoi(parts[1])
	return fmt.Sprintf("%02d:%02d", hour, minute)
}

func isValidDigestTime(v string) bool {
	parts := strings.Split(strings.TrimSpace(v), ":")
	if len(parts) != 2 {
		return false
	}
	hour, errHour := strconv.Atoi(parts[0])
	minute, errMinute := strconv.Atoi(parts[1])
	if errHour != nil || errMinute != nil {
		return false
	}
	return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

func isUndefinedTableError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42P01"
}
