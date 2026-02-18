package depositmethods

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const systemSettingKey = "real_deposit_methods"

type Method struct {
	ID                  string `json:"id"`
	Title               string `json:"title"`
	Details             string `json:"details"`
	Enabled             bool   `json:"enabled"`
	VerifiedForWithdraw bool   `json:"verified_for_withdraw,omitempty"`
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

var (
	paypalEmailRegex = regexp.MustCompile(`^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$`)
	btcAddressRegex  = regexp.MustCompile(`^(bc1[a-z0-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$`)
	usdtTrc20Regex   = regexp.MustCompile(`^T[1-9A-HJ-NP-Za-km-z]{33}$`)
	usdtErc20Regex   = regexp.MustCompile(`^0x[a-fA-F0-9]{40}$`)
	tonBounceRegex   = regexp.MustCompile(`^(EQ|UQ)[A-Za-z0-9_-]{46}$`)
	tonRawRegex      = regexp.MustCompile(`^-?\d+:[a-fA-F0-9]{64}$`)
)

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
		normalized, err := NormalizeAndValidateDetails(id, m.Details)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", id, err)
		}
		payload[id] = normalized
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

func NormalizeAndValidateDetails(methodID, details string) (string, error) {
	id := strings.ToLower(strings.TrimSpace(methodID))
	value := strings.TrimSpace(details)
	if value == "" {
		return "", nil
	}

	switch id {
	case "visa_sum", "mastercard", "visa_usd", "humo", "uzcard":
		digits := digitsOnly(value)
		if len(digits) != 16 {
			return "", errors.New("card number must contain exactly 16 digits")
		}
		return formatCardDigits(digits), nil
	case "paypal":
		email := strings.ToLower(strings.ReplaceAll(value, " ", ""))
		if !paypalEmailRegex.MatchString(email) {
			return "", errors.New("paypal details must be a valid email")
		}
		return email, nil
	case "btc":
		addr := strings.ReplaceAll(value, " ", "")
		if !btcAddressRegex.MatchString(addr) {
			return "", errors.New("btc address format is invalid")
		}
		return addr, nil
	case "usdt":
		addr := strings.ReplaceAll(value, " ", "")
		if !usdtTrc20Regex.MatchString(addr) && !usdtErc20Regex.MatchString(addr) {
			return "", errors.New("usdt address must be TRC20 (T...) or ERC20 (0x...)")
		}
		return addr, nil
	case "ton":
		addr := strings.ReplaceAll(value, " ", "")
		if !tonBounceRegex.MatchString(addr) && !tonRawRegex.MatchString(addr) {
			return "", errors.New("ton address format is invalid")
		}
		return addr, nil
	default:
		return value, nil
	}
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

func digitsOnly(value string) string {
	var b strings.Builder
	b.Grow(len(value))
	for _, r := range value {
		if unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func formatCardDigits(digits string) string {
	if len(digits) <= 4 {
		return digits
	}
	parts := make([]string, 0, (len(digits)+3)/4)
	for i := 0; i < len(digits); i += 4 {
		end := i + 4
		if end > len(digits) {
			end = len(digits)
		}
		parts = append(parts, digits[i:end])
	}
	return strings.Join(parts, " ")
}

func isUndefinedTableError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42P01"
}
