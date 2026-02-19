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
	"github.com/shopspring/decimal"
)

const systemSettingKey = "real_deposit_methods"

type Method struct {
	ID                  string `json:"id"`
	Title               string `json:"title"`
	Details             string `json:"details"`
	Enabled             bool   `json:"enabled"`
	MinAmountUSD        string `json:"min_amount_usd"`
	MaxAmountUSD        string `json:"max_amount_usd"`
	VerifiedForWithdraw bool   `json:"verified_for_withdraw,omitempty"`
}

type storedMethod struct {
	Details      string `json:"details"`
	Enabled      bool   `json:"enabled"`
	MinAmountUSD string `json:"min_amount_usd"`
	MaxAmountUSD string `json:"max_amount_usd"`
}

type storedMethodPayload struct {
	Details      string `json:"details"`
	Enabled      *bool  `json:"enabled"`
	MinAmountUSD string `json:"min_amount_usd"`
	MaxAmountUSD string `json:"max_amount_usd"`
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

var (
	defaultMethodMinAmountUSD = decimal.NewFromInt(10)
	defaultMethodMaxAmountUSD = decimal.NewFromInt(1000)
)

func Defaults() []Method {
	out := make([]Method, 0, len(methodCatalog))
	minAmountUSD, maxAmountUSD := defaultAmountBoundsString()
	for _, base := range methodCatalog {
		out = append(out, Method{
			ID:           base.ID,
			Title:        base.Title,
			Details:      "",
			Enabled:      false,
			MinAmountUSD: minAmountUSD,
			MaxAmountUSD: maxAmountUSD,
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
	payload := make(map[string]storedMethod, len(methodCatalog))
	for _, m := range methods {
		id := strings.ToLower(strings.TrimSpace(m.ID))
		if !isKnownMethodID(id) {
			continue
		}
		normalized, err := NormalizeAndValidateDetails(id, m.Details)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", id, err)
		}
		minAmountUSD, maxAmountUSD, err := NormalizeAmountBounds(m.MinAmountUSD, m.MaxAmountUSD)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", id, err)
		}
		enabled := m.Enabled
		if enabled && normalized == "" {
			return nil, fmt.Errorf("%s: details are required when method is enabled", id)
		}
		payload[id] = storedMethod{
			Details:      normalized,
			Enabled:      enabled,
			MinAmountUSD: minAmountUSD,
			MaxAmountUSD: maxAmountUSD,
		}
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
	settingsMap := decodeStoredMethods(raw)
	defaultMinAmountUSD, defaultMaxAmountUSD := defaultAmountBoundsString()
	out := make([]Method, 0, len(methodCatalog))
	for _, base := range methodCatalog {
		settings := settingsMap[base.ID]
		details := strings.TrimSpace(settings.Details)
		enabled := settings.Enabled && details != ""
		minAmountDec, maxAmountDec := ResolveAmountBounds(settings.MinAmountUSD, settings.MaxAmountUSD, defaultMethodMinAmountUSD, defaultMethodMaxAmountUSD)
		out = append(out, Method{
			ID:           base.ID,
			Title:        base.Title,
			Details:      details,
			Enabled:      enabled,
			MinAmountUSD: minAmountDec.StringFixed(2),
			MaxAmountUSD: maxAmountDec.StringFixed(2),
		})
	}
	if len(out) == 0 {
		return Defaults()
	}
	for i := range out {
		if strings.TrimSpace(out[i].MinAmountUSD) == "" {
			out[i].MinAmountUSD = defaultMinAmountUSD
		}
		if strings.TrimSpace(out[i].MaxAmountUSD) == "" {
			out[i].MaxAmountUSD = defaultMaxAmountUSD
		}
	}
	return out
}

func decodeStoredMethods(raw string) map[string]storedMethod {
	out := make(map[string]storedMethod)
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return out
	}

	legacyMap := map[string]string{}
	if err := json.Unmarshal([]byte(trimmed), &legacyMap); err == nil && len(legacyMap) > 0 {
		for id, details := range legacyMap {
			normalizedID := strings.ToLower(strings.TrimSpace(id))
			if !isKnownMethodID(normalizedID) {
				continue
			}
			cleanDetails := strings.TrimSpace(details)
			out[normalizedID] = storedMethod{
				Details: cleanDetails,
				Enabled: cleanDetails != "",
			}
		}
		return out
	}

	rawMap := map[string]json.RawMessage{}
	if err := json.Unmarshal([]byte(trimmed), &rawMap); err != nil {
		return out
	}
	for id, payload := range rawMap {
		normalizedID := strings.ToLower(strings.TrimSpace(id))
		if !isKnownMethodID(normalizedID) {
			continue
		}
		var detailsOnly string
		if err := json.Unmarshal(payload, &detailsOnly); err == nil {
			cleanDetails := strings.TrimSpace(detailsOnly)
			out[normalizedID] = storedMethod{
				Details: cleanDetails,
				Enabled: cleanDetails != "",
			}
			continue
		}
		var entry storedMethodPayload
		if err := json.Unmarshal(payload, &entry); err != nil {
			continue
		}
		details := strings.TrimSpace(entry.Details)
		enabled := details != ""
		if entry.Enabled != nil {
			enabled = *entry.Enabled && details != ""
		}
		out[normalizedID] = storedMethod{
			Details:      details,
			Enabled:      enabled,
			MinAmountUSD: strings.TrimSpace(entry.MinAmountUSD),
			MaxAmountUSD: strings.TrimSpace(entry.MaxAmountUSD),
		}
	}
	return out
}

func NormalizeAmountBounds(minRaw, maxRaw string) (string, string, error) {
	minAmount := defaultMethodMinAmountUSD
	maxAmount := defaultMethodMaxAmountUSD

	trimmedMin := strings.TrimSpace(minRaw)
	if trimmedMin != "" {
		parsedMin, ok := parsePositiveDecimal(trimmedMin)
		if !ok {
			return "", "", errors.New("min_amount_usd must be a positive number")
		}
		minAmount = parsedMin
	}
	trimmedMax := strings.TrimSpace(maxRaw)
	if trimmedMax != "" {
		parsedMax, ok := parsePositiveDecimal(trimmedMax)
		if !ok {
			return "", "", errors.New("max_amount_usd must be a positive number")
		}
		maxAmount = parsedMax
	}
	if maxAmount.LessThan(minAmount) {
		return "", "", errors.New("max_amount_usd must be greater than or equal to min_amount_usd")
	}
	return minAmount.StringFixed(2), maxAmount.StringFixed(2), nil
}

func ResolveAmountBounds(minRaw, maxRaw string, fallbackMin, fallbackMax decimal.Decimal) (decimal.Decimal, decimal.Decimal) {
	minAmount := fallbackMin
	maxAmount := fallbackMax
	if !minAmount.GreaterThan(decimal.Zero) {
		minAmount = defaultMethodMinAmountUSD
	}
	if !maxAmount.GreaterThan(decimal.Zero) {
		maxAmount = defaultMethodMaxAmountUSD
	}
	if maxAmount.LessThan(minAmount) {
		maxAmount = minAmount
	}
	if parsedMin, ok := parsePositiveDecimal(minRaw); ok {
		minAmount = parsedMin
	}
	if parsedMax, ok := parsePositiveDecimal(maxRaw); ok {
		maxAmount = parsedMax
	}
	if maxAmount.LessThan(minAmount) {
		maxAmount = minAmount
	}
	return minAmount, maxAmount
}

func defaultAmountBoundsString() (string, string) {
	return defaultMethodMinAmountUSD.StringFixed(2), defaultMethodMaxAmountUSD.StringFixed(2)
}

func parsePositiveDecimal(raw string) (decimal.Decimal, bool) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return decimal.Zero, false
	}
	out, err := decimal.NewFromString(value)
	if err != nil || !out.GreaterThan(decimal.Zero) {
		return decimal.Zero, false
	}
	return out, true
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
