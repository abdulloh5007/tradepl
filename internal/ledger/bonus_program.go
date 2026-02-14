package ledger

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

var (
	defaultSignupBonusAmount      = decimal.NewFromInt(10)
	defaultRealDepositMinUSD      = decimal.NewFromInt(10)
	defaultRealDepositMaxUSD      = decimal.NewFromInt(1000)
	defaultUSDToUZSRate           = decimal.NewFromInt(13000)
	defaultKYCBonusAmount         = decimal.NewFromInt(50)
	defaultRealDepositReviewHours = 2
	defaultKYCReviewETAHours      = 8
	diamondVoucherMinUSD          = decimal.NewFromInt(200)
)

const defaultSignupBonusTotalLimit = 700

type bonusProgramConfig struct {
	SignupBonusTotalLimit   int
	SignupBonusAmount       decimal.Decimal
	RealDepositMinUSD       decimal.Decimal
	RealDepositMaxUSD       decimal.Decimal
	USDToUZSRate            decimal.Decimal
	RealDepositReviewMinute int
	TelegramDepositChatID   string
	KYCBonusAmount          decimal.Decimal
	KYCReviewETAHours       int
	TelegramKYCChatID       string
}

type depositVoucherStatus struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Percent   string `json:"percent"`
	Available bool   `json:"available"`
	Used      bool   `json:"used"`
}

type depositBonusStatusResponse struct {
	MinAmountUSD      string                 `json:"min_amount_usd"`
	MaxAmountUSD      string                 `json:"max_amount_usd"`
	USDToUZSRate      string                 `json:"usd_to_uzs_rate"`
	ReviewMinutes     int                    `json:"review_minutes"`
	OneTimeUsed       bool                   `json:"one_time_used"`
	PendingCount      int                    `json:"pending_count"`
	NextReviewDueAt   *time.Time             `json:"next_review_due_at,omitempty"`
	EligibleAccountID string                 `json:"eligible_account_id,omitempty"`
	Vouchers          []depositVoucherStatus `json:"vouchers"`
}

func defaultBonusProgramConfig() bonusProgramConfig {
	return bonusProgramConfig{
		SignupBonusTotalLimit:   defaultSignupBonusTotalLimit,
		SignupBonusAmount:       defaultSignupBonusAmount,
		RealDepositMinUSD:       defaultRealDepositMinUSD,
		RealDepositMaxUSD:       defaultRealDepositMaxUSD,
		USDToUZSRate:            defaultUSDToUZSRate,
		RealDepositReviewMinute: defaultRealDepositReviewHours * 60,
		KYCBonusAmount:          defaultKYCBonusAmount,
		KYCReviewETAHours:       defaultKYCReviewETAHours,
	}
}

func normalizeBonusProgramConfig(cfg bonusProgramConfig) bonusProgramConfig {
	out := cfg
	if out.SignupBonusTotalLimit <= 0 {
		out.SignupBonusTotalLimit = defaultSignupBonusTotalLimit
	}
	if !out.SignupBonusAmount.GreaterThan(decimal.Zero) {
		out.SignupBonusAmount = defaultSignupBonusAmount
	}
	if !out.RealDepositMinUSD.GreaterThan(decimal.Zero) {
		out.RealDepositMinUSD = defaultRealDepositMinUSD
	}
	if !out.RealDepositMaxUSD.GreaterThan(out.RealDepositMinUSD) {
		out.RealDepositMaxUSD = out.RealDepositMinUSD
		if out.RealDepositMaxUSD.LessThan(defaultRealDepositMaxUSD) {
			out.RealDepositMaxUSD = defaultRealDepositMaxUSD
		}
	}
	if !out.USDToUZSRate.GreaterThan(decimal.Zero) {
		out.USDToUZSRate = defaultUSDToUZSRate
	}
	if out.RealDepositReviewMinute <= 0 {
		out.RealDepositReviewMinute = defaultRealDepositReviewHours * 60
	}
	if !out.KYCBonusAmount.GreaterThan(decimal.Zero) {
		out.KYCBonusAmount = defaultKYCBonusAmount
	}
	if out.KYCReviewETAHours <= 0 {
		out.KYCReviewETAHours = defaultKYCReviewETAHours
	}
	out.TelegramDepositChatID = strings.TrimSpace(out.TelegramDepositChatID)
	out.TelegramKYCChatID = strings.TrimSpace(out.TelegramKYCChatID)
	return out
}

func (h *Handler) loadBonusProgramConfig(ctx context.Context) (bonusProgramConfig, error) {
	cfg := defaultBonusProgramConfig()
	err := h.svc.pool.QueryRow(ctx, `
		SELECT
			COALESCE((to_jsonb(trc)->>'signup_bonus_total_limit')::int, $2),
			COALESCE((to_jsonb(trc)->>'signup_bonus_amount')::numeric, $3::numeric),
			COALESCE((to_jsonb(trc)->>'real_deposit_min_usd')::numeric, $4::numeric),
			COALESCE((to_jsonb(trc)->>'real_deposit_max_usd')::numeric, $5::numeric),
			COALESCE((to_jsonb(trc)->>'usd_to_uzs_rate')::numeric, $6::numeric),
			COALESCE((to_jsonb(trc)->>'real_deposit_review_minutes')::int, $7),
			COALESCE((to_jsonb(trc)->>'telegram_deposit_chat_id')::text, ''),
			COALESCE((to_jsonb(trc)->>'kyc_bonus_amount')::numeric, $8::numeric),
			COALESCE((to_jsonb(trc)->>'kyc_review_eta_hours')::int, $9),
			COALESCE((to_jsonb(trc)->>'telegram_kyc_chat_id')::text, '')
		FROM trading_risk_config trc
		WHERE id = $1
	`, 1, defaultSignupBonusTotalLimit, defaultSignupBonusAmount.String(), defaultRealDepositMinUSD.String(), defaultRealDepositMaxUSD.String(), defaultUSDToUZSRate.String(), defaultRealDepositReviewHours*60, defaultKYCBonusAmount.String(), defaultKYCReviewETAHours).Scan(
		&cfg.SignupBonusTotalLimit,
		&cfg.SignupBonusAmount,
		&cfg.RealDepositMinUSD,
		&cfg.RealDepositMaxUSD,
		&cfg.USDToUZSRate,
		&cfg.RealDepositReviewMinute,
		&cfg.TelegramDepositChatID,
		&cfg.KYCBonusAmount,
		&cfg.KYCReviewETAHours,
		&cfg.TelegramKYCChatID,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return normalizeBonusProgramConfig(cfg), nil
		}
		return cfg, err
	}
	return normalizeBonusProgramConfig(cfg), nil
}

func (h *Handler) loadBonusProgramConfigTx(ctx context.Context, tx pgx.Tx) (bonusProgramConfig, error) {
	cfg := defaultBonusProgramConfig()
	err := tx.QueryRow(ctx, `
		SELECT
			COALESCE((to_jsonb(trc)->>'signup_bonus_total_limit')::int, $2),
			COALESCE((to_jsonb(trc)->>'signup_bonus_amount')::numeric, $3::numeric),
			COALESCE((to_jsonb(trc)->>'real_deposit_min_usd')::numeric, $4::numeric),
			COALESCE((to_jsonb(trc)->>'real_deposit_max_usd')::numeric, $5::numeric),
			COALESCE((to_jsonb(trc)->>'usd_to_uzs_rate')::numeric, $6::numeric),
			COALESCE((to_jsonb(trc)->>'real_deposit_review_minutes')::int, $7),
			COALESCE((to_jsonb(trc)->>'telegram_deposit_chat_id')::text, ''),
			COALESCE((to_jsonb(trc)->>'kyc_bonus_amount')::numeric, $8::numeric),
			COALESCE((to_jsonb(trc)->>'kyc_review_eta_hours')::int, $9),
			COALESCE((to_jsonb(trc)->>'telegram_kyc_chat_id')::text, '')
		FROM trading_risk_config trc
		WHERE id = $1
	`, 1, defaultSignupBonusTotalLimit, defaultSignupBonusAmount.String(), defaultRealDepositMinUSD.String(), defaultRealDepositMaxUSD.String(), defaultUSDToUZSRate.String(), defaultRealDepositReviewHours*60, defaultKYCBonusAmount.String(), defaultKYCReviewETAHours).Scan(
		&cfg.SignupBonusTotalLimit,
		&cfg.SignupBonusAmount,
		&cfg.RealDepositMinUSD,
		&cfg.RealDepositMaxUSD,
		&cfg.USDToUZSRate,
		&cfg.RealDepositReviewMinute,
		&cfg.TelegramDepositChatID,
		&cfg.KYCBonusAmount,
		&cfg.KYCReviewETAHours,
		&cfg.TelegramKYCChatID,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return normalizeBonusProgramConfig(cfg), nil
		}
		return cfg, err
	}
	return normalizeBonusProgramConfig(cfg), nil
}

func normalizeVoucherKind(raw string) string {
	v := strings.ToLower(strings.TrimSpace(raw))
	switch v {
	case "gold", "diamond":
		return v
	default:
		return "none"
	}
}

func voucherPercent(kind string) decimal.Decimal {
	switch normalizeVoucherKind(kind) {
	case "gold":
		return decimal.NewFromInt(100)
	case "diamond":
		return decimal.NewFromInt(50)
	default:
		return decimal.Zero
	}
}

func voucherTitle(kind string) string {
	switch normalizeVoucherKind(kind) {
	case "gold":
		return "Gold +100%"
	case "diamond":
		return "Diamond +50%"
	default:
		return "None"
	}
}

func voucherMinAmountUSD(kind string) decimal.Decimal {
	switch normalizeVoucherKind(kind) {
	case "diamond":
		return diamondVoucherMinUSD
	default:
		return decimal.Zero
	}
}
