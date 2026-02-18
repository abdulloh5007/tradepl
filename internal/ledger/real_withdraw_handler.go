package ledger

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
	"lv-tradepl/internal/depositmethods"
	"lv-tradepl/internal/httputil"
	"lv-tradepl/internal/types"
)

type realWithdrawRequestInput struct {
	AmountUSD     string `json:"amount_usd"`
	MethodID      string `json:"method_id"`
	PayoutDetails string `json:"payout_details"`
}

type realWithdrawRequestResponse struct {
	Status              string `json:"status"`
	AmountUSD           string `json:"amount_usd"`
	MethodID            string `json:"method_id"`
	PayoutDetailsMasked string `json:"payout_details_masked"`
}

func (h *Handler) hasApprovedRealDepositForMethodTx(ctx context.Context, tx pgx.Tx, userID string, minAmountUSD decimal.Decimal, methodID string) (bool, error) {
	var ok bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM real_deposit_requests
			WHERE user_id = $1::uuid
			  AND status = 'approved'
			  AND amount_usd >= $2::numeric
			  AND (
					COALESCE(payment_method_id, '') = $3
					OR COALESCE(payment_method_id, '') = ''
				)
			LIMIT 1
		)
	`, userID, minAmountUSD, methodID).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok, nil
}

func (h *Handler) RequestRealWithdraw(w http.ResponseWriter, r *http.Request, userID string) {
	if h.accountSvc == nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "account service unavailable"})
		return
	}

	account, err := h.accountSvc.Resolve(r.Context(), userID, strings.TrimSpace(r.Header.Get("X-Account-ID")))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if account.Mode != "real" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "real withdraw is allowed only for real account"})
		return
	}

	var req realWithdrawRequestInput
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	amountUSD, err := decimal.NewFromString(strings.TrimSpace(req.AmountUSD))
	if err != nil || !amountUSD.GreaterThan(decimal.Zero) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid amount_usd"})
		return
	}

	methodID := strings.ToLower(strings.TrimSpace(req.MethodID))
	if methodID == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "payment method is required"})
		return
	}
	payoutDetails, err := depositmethods.NormalizeAndValidateDetails(methodID, req.PayoutDetails)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if payoutDetails == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "payout details are required"})
		return
	}

	methods, err := depositmethods.Load(r.Context(), h.svc.pool)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	methodAvailable := false
	for _, item := range methods {
		if strings.EqualFold(item.ID, methodID) {
			methodAvailable = item.Enabled
			break
		}
	}
	if !methodAvailable {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "selected payment method is unavailable"})
		return
	}
	cfg, cfgErr := h.loadBonusProgramConfig(r.Context())
	if cfgErr != nil {
		if isUndefinedTableError(cfgErr) || isUndefinedColumnError(cfgErr) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "real withdraw is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: cfgErr.Error()})
		return
	}

	asset, err := h.store.GetAssetBySymbol(r.Context(), "USD")
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "asset not found"})
		return
	}

	tx, err := h.svc.pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	defer tx.Rollback(r.Context())

	verified, verifyErr := h.hasApprovedRealDepositForMethodTx(r.Context(), tx, userID, cfg.RealDepositMinUSD, methodID)
	if verifyErr != nil {
		if isUndefinedTableError(verifyErr) || isUndefinedColumnError(verifyErr) {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "real withdraw is unavailable: run migrations"})
			return
		}
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: verifyErr.Error()})
		return
	}
	if !verified {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{
			Error: fmt.Sprintf("withdraw requires an approved real deposit of at least %s USD via %s", cfg.RealDepositMinUSD.StringFixed(2), strings.ToUpper(methodID)),
		})
		return
	}

	userAccount, err := h.svc.EnsureAccountForTradingAccount(r.Context(), tx, userID, account.ID, asset.ID, types.AccountKindAvailable)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	balance, err := h.svc.GetBalance(r.Context(), tx, userAccount)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if balance.LessThan(amountUSD) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "insufficient balance"})
		return
	}

	systemAccount, err := h.svc.EnsureSystemAccount(r.Context(), tx, asset.ID, types.AccountKindAvailable)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	ref := fmt.Sprintf("real_withdraw:%s:%d", methodID, time.Now().UTC().UnixNano())
	if _, err := h.svc.Transfer(r.Context(), tx, userAccount, systemAccount, amountUSD, types.LedgerEntryTypeWithdraw, ref); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	h.notifyUserTelegramAsync(
		userID,
		"deposit",
		"Withdrawal completed",
		fmt.Sprintf("Real withdrawal of %s USD was completed via %s.", amountUSD.StringFixed(2), strings.ToUpper(methodID)),
		"#notifications",
	)

	httputil.WriteJSON(w, http.StatusOK, realWithdrawRequestResponse{
		Status:              "ok",
		AmountUSD:           amountUSD.StringFixed(2),
		MethodID:            methodID,
		PayoutDetailsMasked: maskPayoutDetails(methodID, payoutDetails),
	})
}

func maskPayoutDetails(methodID, details string) string {
	value := strings.TrimSpace(details)
	if value == "" {
		return ""
	}
	switch strings.ToLower(strings.TrimSpace(methodID)) {
	case "visa_sum", "mastercard", "visa_usd", "humo", "uzcard":
		digits := strings.ReplaceAll(value, " ", "")
		if len(digits) < 4 {
			return "****"
		}
		return "**** **** **** " + digits[len(digits)-4:]
	case "paypal":
		at := strings.Index(value, "@")
		if at <= 1 {
			return "***"
		}
		return value[:1] + "***" + value[at:]
	default:
		if len(value) <= 10 {
			return value
		}
		return value[:6] + "..." + value[len(value)-4:]
	}
}
