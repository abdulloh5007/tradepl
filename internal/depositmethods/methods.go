package depositmethods

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const systemSettingKey = "real_deposit_methods"

type Method struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Details string `json:"details"`
	Enabled bool   `json:"enabled"`
}

var methodCatalog = []Method{
	{ID: "visa_sum", Title: "VISA SUM"},
	{ID: "mastercard", Title: "Mastercard"},
	{ID: "visa_usd", Title: "VISA USD"},
	{ID: "humo", Title: "HUMO"},
	{ID: "uzcard", Title: "Uzcard"},
	{ID: "paypal", Title: "PayPal"},
	{ID: "ton", Title: "TON"},
	{ID: "usdt", Title: "USDT"},
	{ID: "btc", Title: "BTC"},
}

func Defaults() []Method {
	out := make([]Method, 0, len(methodCatalog))
	for _, base := range methodCatalog {
		out = append(out, Method{
			ID:      base.ID,
			Title:   base.Title,
			Details: "",
			Enabled: false,
		})
	}
	return out
}

func Load(ctx context.Context, pool *pgxpool.Pool) ([]Method, error) {
	if pool == nil {
		return Defaults(), nil
	}
	var raw string
	err := pool.QueryRow(ctx, `
		SELECT value
		FROM system_settings
		WHERE key = $1
	`, systemSettingKey).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isUndefinedTableError(err) {
			return Defaults(), nil
		}
		return nil, err
	}
	return decodeMethods(raw), nil
}

func Save(ctx context.Context, pool *pgxpool.Pool, methods []Method) ([]Method, error) {
	if pool == nil {
		return nil, errors.New("database is unavailable")
	}
	payload := make(map[string]string, len(methodCatalog))
	for _, m := range methods {
		id := strings.ToLower(strings.TrimSpace(m.ID))
		if !isKnownMethodID(id) {
			continue
		}
		payload[id] = strings.TrimSpace(m.Details)
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO system_settings(key, value, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (key)
		DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
	`, systemSettingKey, string(encoded))
	if err != nil {
		return nil, err
	}
	return decodeMethods(string(encoded)), nil
}

func TitleByID(id string) string {
	normalized := strings.ToLower(strings.TrimSpace(id))
	for _, m := range methodCatalog {
		if m.ID == normalized {
			return m.Title
		}
	}
	if normalized == "" {
		return ""
	}
	return strings.ToUpper(strings.ReplaceAll(normalized, "_", " "))
}

func decodeMethods(raw string) []Method {
	detailsMap := map[string]string{}
	trimmed := strings.TrimSpace(raw)
	if trimmed != "" {
		_ = json.Unmarshal([]byte(trimmed), &detailsMap)
	}
	out := make([]Method, 0, len(methodCatalog))
	for _, base := range methodCatalog {
		details := strings.TrimSpace(detailsMap[base.ID])
		out = append(out, Method{
			ID:      base.ID,
			Title:   base.Title,
			Details: details,
			Enabled: details != "",
		})
	}
	return out
}

func isKnownMethodID(id string) bool {
	for _, m := range methodCatalog {
		if m.ID == id {
			return true
		}
	}
	return false
}

func isUndefinedTableError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42P01"
}
