package ledger

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"lv-tradepl/internal/httputil"
	"lv-tradepl/internal/types"
)

const signupBonusRefPrefix = "signup_reward"

type signupBonusStatusResponse struct {
	Amount             string     `json:"amount"`
	Currency           string     `json:"currency"`
	Claimed            bool       `json:"claimed"`
	CanClaim           bool       `json:"can_claim"`
	TotalLimit         int        `json:"total_limit"`
	ClaimedTotal       int        `json:"claimed_total"`
	Remaining          int        `json:"remaining"`
	StandardOnly       bool       `json:"standard_only"`
	ClaimedAt          *time.Time `json:"claimed_at,omitempty"`
	TradingAccountID   string     `json:"trading_account_id,omitempty"`
	TradingAccountName string     `json:"trading_account_name,omitempty"`
	TradingAccountMode string     `json:"trading_account_mode,omitempty"`
}

type signupBonusClaimRequest struct {
	AcceptTerms bool `json:"accept_terms"`
}

type signupBonusTargetAccount struct {
	ID   string
	Name string
	Mode string
}

func (h *Handler) SignupBonusStatus(w http.ResponseWriter, r *http.Request, userID string) {
	if h.accountSvc == nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "account service unavailable"})
		return
	}
	if err := h.accountSvc.EnsureDefaultAccounts(r.Context(), userID); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	cfg, cfgErr := h.loadBonusProgramConfig(r.Context())
	if cfgErr != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: cfgErr.Error()})
		return
	}

	status := signupBonusStatusResponse{
		Amount:       cfg.SignupBonusAmount.StringFixed(2),
		Currency:     "USD",
		Claimed:      false,
		CanClaim:     false,
		TotalLimit:   cfg.SignupBonusTotalLimit,
		ClaimedTotal: 0,
		Remaining:    cfg.SignupBonusTotalLimit,
		StandardOnly: true,
	}

	target, targetErr := h.resolveSignupBonusTargetAccount(r.Context(), userID)
	if targetErr == nil {
		status.TradingAccountID = target.ID
		status.TradingAccountName = target.Name
		status.TradingAccountMode = target.Mode
	}

	var claimedTotal int
	if err := h.svc.pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM signup_bonus_claims`).Scan(&claimedTotal); err != nil {
		if isUndefinedTableError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "signup bonus is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	status.ClaimedTotal = claimedTotal
	remaining := cfg.SignupBonusTotalLimit - claimedTotal
	if remaining < 0 {
		remaining = 0
	}
	status.Remaining = remaining

	var claimedAt time.Time
	var claimedAccountID string
	var claimedAccountName string
	var claimedAccountMode string
	err := h.svc.pool.QueryRow(r.Context(), `
		SELECT
			sb.claimed_at,
			COALESCE(ta.id::text, sb.trading_account_id::text),
			COALESCE(ta.name, ''),
			COALESCE(ta.mode, 'real')
		FROM signup_bonus_claims sb
		LEFT JOIN trading_accounts ta ON ta.id = sb.trading_account_id
		WHERE sb.user_id = $1
	`, userID).Scan(&claimedAt, &claimedAccountID, &claimedAccountName, &claimedAccountMode)
	if err != nil {
		if isUndefinedTableError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "signup bonus is unavailable: run migrations"})
			return
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
			return
		}
		status.CanClaim = targetErr == nil && status.Remaining > 0
		httputil.WriteJSON(w, http.StatusOK, status)
		return
	}

	status.Claimed = true
	status.CanClaim = false
	status.ClaimedAt = &claimedAt
	status.TradingAccountID = claimedAccountID
	status.TradingAccountName = claimedAccountName
	status.TradingAccountMode = claimedAccountMode
	httputil.WriteJSON(w, http.StatusOK, status)
}

func (h *Handler) ClaimSignupBonus(w http.ResponseWriter, r *http.Request, userID string) {
	if h.accountSvc == nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "account service unavailable"})
		return
	}
	if err := h.accountSvc.EnsureDefaultAccounts(r.Context(), userID); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	var req signupBonusClaimRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if !req.AcceptTerms {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "accept terms before claiming the bonus"})
		return
	}

	tx, err := h.svc.pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	defer tx.Rollback(r.Context())

	cfg, cfgErr := h.loadBonusProgramConfigTx(r.Context(), tx)
	if cfgErr != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: cfgErr.Error()})
		return
	}

	var alreadyClaimed bool
	if err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM signup_bonus_claims WHERE user_id = $1)`, userID).Scan(&alreadyClaimed); err != nil {
		if isUndefinedTableError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "signup bonus is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if alreadyClaimed {
		httputil.WriteJSON(w, http.StatusConflict, httputil.ErrorResponse{Error: "signup bonus already claimed"})
		return
	}
	var claimedTotal int
	if err := tx.QueryRow(r.Context(), `SELECT COUNT(*) FROM signup_bonus_claims`).Scan(&claimedTotal); err != nil {
		if isUndefinedTableError(err) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "signup bonus is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if claimedTotal >= cfg.SignupBonusTotalLimit {
		httputil.WriteJSON(w, http.StatusConflict, httputil.ErrorResponse{Error: "signup bonus limit reached"})
		return
	}

	target, err := h.resolveSignupBonusTargetAccountTx(r.Context(), tx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "real account not found"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	var usdAssetID string
	if err := tx.QueryRow(r.Context(), `SELECT id::text FROM assets WHERE symbol = 'USD'`).Scan(&usdAssetID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "USD asset not found"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	systemAccount, err := h.svc.EnsureSystemAccount(r.Context(), tx, usdAssetID, types.AccountKindAvailable)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	userAccount, err := h.svc.EnsureAccountForTradingAccount(r.Context(), tx, userID, target.ID, usdAssetID, types.AccountKindAvailable)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	ref := fmt.Sprintf("%s:%s:%s", signupBonusRefPrefix, userID, target.ID)
	ledgerTxID, err := h.svc.Transfer(r.Context(), tx, systemAccount, userAccount, cfg.SignupBonusAmount, types.LedgerEntryTypeDeposit, ref)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	var claimedAt time.Time
	err = tx.QueryRow(r.Context(), `
		INSERT INTO signup_bonus_claims (
			user_id,
			trading_account_id,
			amount,
			ledger_tx_id,
			accepted_terms,
			claimed_at
		) VALUES ($1, $2, $3, $4, TRUE, NOW())
		RETURNING claimed_at
	`, userID, target.ID, cfg.SignupBonusAmount, ledgerTxID).Scan(&claimedAt)
	if err != nil {
		if isUniqueViolationError(err) {
			httputil.WriteJSON(w, http.StatusConflict, httputil.ErrorResponse{Error: "signup bonus already claimed"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	h.notifyUserTelegramAsync(
		userID,
		"bonus",
		"Welcome bonus credited",
		fmt.Sprintf("You received %s USD welcome bonus on account %s.", cfg.SignupBonusAmount.StringFixed(2), target.Name),
		"#notifications",
	)

	httputil.WriteJSON(w, http.StatusOK, signupBonusStatusResponse{
		Amount:             cfg.SignupBonusAmount.StringFixed(2),
		Currency:           "USD",
		Claimed:            true,
		CanClaim:           false,
		TotalLimit:         cfg.SignupBonusTotalLimit,
		ClaimedTotal:       claimedTotal + 1,
		Remaining:          maxInt(0, cfg.SignupBonusTotalLimit-(claimedTotal+1)),
		StandardOnly:       true,
		ClaimedAt:          &claimedAt,
		TradingAccountID:   target.ID,
		TradingAccountName: target.Name,
		TradingAccountMode: target.Mode,
	})
}

func (h *Handler) resolveSignupBonusTargetAccount(ctx context.Context, userID string) (signupBonusTargetAccount, error) {
	var target signupBonusTargetAccount
	err := h.svc.pool.QueryRow(ctx, `
		SELECT id::text, name, mode
		FROM trading_accounts
		WHERE user_id = $1
		  AND mode = 'real'
		  AND plan_id = 'standard'
		ORDER BY is_active DESC, created_at ASC
		LIMIT 1
	`, userID).Scan(&target.ID, &target.Name, &target.Mode)
	if err != nil {
		return signupBonusTargetAccount{}, err
	}
	target.Mode = strings.ToLower(strings.TrimSpace(target.Mode))
	return target, nil
}

func (h *Handler) resolveSignupBonusTargetAccountTx(ctx context.Context, tx pgx.Tx, userID string) (signupBonusTargetAccount, error) {
	var target signupBonusTargetAccount
	err := tx.QueryRow(ctx, `
		SELECT id::text, name, mode
		FROM trading_accounts
		WHERE user_id = $1
		  AND mode = 'real'
		  AND plan_id = 'standard'
		ORDER BY is_active DESC, created_at ASC
		LIMIT 1
		FOR UPDATE
	`, userID).Scan(&target.ID, &target.Name, &target.Mode)
	if err != nil {
		return signupBonusTargetAccount{}, err
	}
	target.Mode = strings.ToLower(strings.TrimSpace(target.Mode))
	return target, nil
}

func isUndefinedTableError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42P01"
}

func isUndefinedColumnError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42703"
}

func isUniqueViolationError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
