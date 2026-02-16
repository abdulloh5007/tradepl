package ledger

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

var (
	referralSignupRewardUSD          = decimal.NewFromInt(5)
	referralDepositCommissionPercent = decimal.NewFromInt(10)
	referralWithdrawMinUSD           = decimal.NewFromInt(30)
)

type referralWalletState struct {
	Balance       decimal.Decimal
	TotalEarned   decimal.Decimal
	TotalWithdraw decimal.Decimal
}

type referralEventItem struct {
	ID                string          `json:"id"`
	Kind              string          `json:"kind"`
	Amount            decimal.Decimal `json:"amount"`
	CommissionPercent decimal.Decimal `json:"commission_percent"`
	RelatedUserID     string          `json:"related_user_id,omitempty"`
	TradingAccountID  string          `json:"trading_account_id,omitempty"`
	CreatedAt         string          `json:"created_at"`
}

func referralCodeFromUserID(userID string) string {
	trimmed := strings.TrimSpace(strings.ToLower(userID))
	if trimmed == "" {
		return ""
	}
	return "bx" + strings.ReplaceAll(trimmed, "-", "")
}

func normalizeReferralCode(code string) string {
	value := strings.ToLower(strings.TrimSpace(code))
	if strings.HasPrefix(value, "ref_") {
		value = strings.TrimSpace(strings.TrimPrefix(value, "ref_"))
	}
	if strings.HasPrefix(value, "bx") {
		return value
	}
	if value == "" {
		return ""
	}
	return "bx" + value
}

func (h *Handler) telegramReferralDeepLink(ctx context.Context, code string) string {
	bot := h.telegramBotUsername(ctx)
	if bot == "" {
		return ""
	}
	normalized := normalizeReferralCode(code)
	if normalized == "" {
		return ""
	}
	shortName := strings.Trim(strings.TrimSpace(h.telegramMiniAppShort), "/")
	if shortName != "" {
		return fmt.Sprintf("https://t.me/%s/%s?startapp=ref_%s", bot, shortName, normalized)
	}
	return fmt.Sprintf("https://t.me/%s?startapp=ref_%s", bot, normalized)
}

func (h *Handler) ensureReferralWalletTx(ctx context.Context, tx pgx.Tx, userID string) error {
	if strings.TrimSpace(userID) == "" {
		return errors.New("user_id is required")
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO referral_wallets (user_id, balance, total_earned, total_withdrawn, updated_at)
		VALUES ($1, 0, 0, 0, NOW())
		ON CONFLICT (user_id) DO NOTHING
	`, userID)
	if err != nil && (isUndefinedTableError(err) || isUndefinedColumnError(err)) {
		return nil
	}
	return err
}

func (h *Handler) creditReferralWalletTx(ctx context.Context, tx pgx.Tx, userID string, amount decimal.Decimal) error {
	if strings.TrimSpace(userID) == "" || !amount.GreaterThan(decimal.Zero) {
		return nil
	}
	if err := h.ensureReferralWalletTx(ctx, tx, userID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		UPDATE referral_wallets
		SET balance = balance + $2,
		    total_earned = total_earned + $2,
		    updated_at = NOW()
		WHERE user_id = $1
	`, userID, amount)
	if err != nil && (isUndefinedTableError(err) || isUndefinedColumnError(err)) {
		return nil
	}
	return err
}

func (h *Handler) debitReferralWalletTx(ctx context.Context, tx pgx.Tx, userID string, amount decimal.Decimal) error {
	if strings.TrimSpace(userID) == "" || !amount.GreaterThan(decimal.Zero) {
		return nil
	}
	if err := h.ensureReferralWalletTx(ctx, tx, userID); err != nil {
		return err
	}
	cmd, err := tx.Exec(ctx, `
		UPDATE referral_wallets
		SET balance = balance - $2,
		    total_withdrawn = total_withdrawn + $2,
		    updated_at = NOW()
		WHERE user_id = $1
		  AND balance >= $2
	`, userID, amount)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return errors.New("insufficient referral balance")
	}
	return nil
}

func (h *Handler) readReferralWallet(ctx context.Context, userID string) (referralWalletState, error) {
	var out referralWalletState
	err := h.svc.pool.QueryRow(ctx, `
		SELECT COALESCE(balance, 0), COALESCE(total_earned, 0), COALESCE(total_withdrawn, 0)
		FROM referral_wallets
		WHERE user_id = $1
	`, userID).Scan(&out.Balance, &out.TotalEarned, &out.TotalWithdraw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isUndefinedTableError(err) || isUndefinedColumnError(err) {
			return referralWalletState{}, nil
		}
		return referralWalletState{}, err
	}
	return out, nil
}

func (h *Handler) applyReferralDepositCommissionTx(ctx context.Context, tx pgx.Tx, referredUserID, referredTradingAccountID string, depositAmount decimal.Decimal, sourceRef string) (decimal.Decimal, string, error) {
	if strings.TrimSpace(referredUserID) == "" || !depositAmount.GreaterThan(decimal.Zero) {
		return decimal.Zero, "", nil
	}
	var inviterID string
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(referred_by::text, '')
		FROM users
		WHERE id = $1
	`, referredUserID).Scan(&inviterID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isUndefinedColumnError(err) {
			return decimal.Zero, "", nil
		}
		return decimal.Zero, "", err
	}
	inviterID = strings.TrimSpace(inviterID)
	if inviterID == "" || inviterID == strings.TrimSpace(referredUserID) {
		return decimal.Zero, "", nil
	}

	commission := depositAmount.Mul(referralDepositCommissionPercent).Div(decimal.NewFromInt(100)).Round(2)
	if !commission.GreaterThan(decimal.Zero) {
		return decimal.Zero, "", nil
	}

	source := strings.TrimSpace(sourceRef)
	if source == "" {
		source = "ref_deposit_commission:" + referredUserID
	}

	var eventID string
	err = tx.QueryRow(ctx, `
		INSERT INTO referral_events (
			user_id,
			related_user_id,
			trading_account_id,
			kind,
			amount,
			commission_percent,
			source_ref,
			created_at
		)
		VALUES ($1, $2, nullif($3, '')::uuid, 'deposit_commission', $4, $5, $6, NOW())
		ON CONFLICT (kind, source_ref) DO NOTHING
		RETURNING id::text
	`, inviterID, referredUserID, referredTradingAccountID, commission, referralDepositCommissionPercent, source).Scan(&eventID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return decimal.Zero, "", nil
		}
		if isUndefinedTableError(err) || isUndefinedColumnError(err) {
			return decimal.Zero, "", nil
		}
		return decimal.Zero, "", err
	}
	if strings.TrimSpace(eventID) == "" {
		return decimal.Zero, "", nil
	}
	if err := h.creditReferralWalletTx(ctx, tx, inviterID, commission); err != nil {
		return decimal.Zero, "", err
	}
	return commission, inviterID, nil
}

func (h *Handler) creditReferralSignupTx(ctx context.Context, tx pgx.Tx, inviterID, invitedUserID string) (decimal.Decimal, error) {
	inviterID = strings.TrimSpace(inviterID)
	invitedUserID = strings.TrimSpace(invitedUserID)
	if inviterID == "" || invitedUserID == "" || inviterID == invitedUserID {
		return decimal.Zero, nil
	}
	sourceRef := "ref_signup:" + invitedUserID

	var eventID string
	err := tx.QueryRow(ctx, `
		INSERT INTO referral_events (
			user_id,
			related_user_id,
			kind,
			amount,
			commission_percent,
			source_ref,
			created_at
		) VALUES ($1, $2, 'signup', $3, 0, $4, NOW())
		ON CONFLICT (kind, source_ref) DO NOTHING
		RETURNING id::text
	`, inviterID, invitedUserID, referralSignupRewardUSD, sourceRef).Scan(&eventID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return decimal.Zero, nil
		}
		if isUndefinedTableError(err) || isUndefinedColumnError(err) {
			return decimal.Zero, nil
		}
		return decimal.Zero, err
	}
	if strings.TrimSpace(eventID) == "" {
		return decimal.Zero, nil
	}
	if err := h.creditReferralWalletTx(ctx, tx, inviterID, referralSignupRewardUSD); err != nil {
		return decimal.Zero, err
	}
	return referralSignupRewardUSD, nil
}
