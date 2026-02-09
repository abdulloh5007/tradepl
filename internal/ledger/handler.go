package ledger

import (
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
	"lv-tradepl/internal/accounts"
	"lv-tradepl/internal/httputil"
	"lv-tradepl/internal/marketdata"
	"lv-tradepl/internal/types"
)

type Handler struct {
	svc           *Service
	store         *marketdata.Store
	accountSvc    *accounts.Service
	faucetEnabled bool
	faucetMax     decimal.Decimal
}

func NewHandler(svc *Service, store *marketdata.Store, accountSvc *accounts.Service, faucetEnabled bool, faucetMax decimal.Decimal) *Handler {
	return &Handler{svc: svc, store: store, accountSvc: accountSvc, faucetEnabled: faucetEnabled, faucetMax: faucetMax}
}

type movementRequest struct {
	UserID      string `json:"user_id"`
	AssetSymbol string `json:"asset"`
	Amount      string `json:"amount"`
	Reference   string `json:"reference"`
}

type faucetRequest struct {
	AssetSymbol string `json:"asset"`
	Amount      string `json:"amount"`
	Reference   string `json:"reference"`
}

func (h *Handler) Deposit(w http.ResponseWriter, r *http.Request) {
	var req movementRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	amount, err := decimal.NewFromString(req.Amount)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid amount"})
		return
	}
	symbol := strings.ToUpper(strings.TrimSpace(req.AssetSymbol))
	asset, err := h.store.GetAssetBySymbol(r.Context(), symbol)
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
	systemAccount, err := h.svc.EnsureSystemAccount(r.Context(), tx, asset.ID, types.AccountKindAvailable)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	userAccount, err := h.svc.EnsureAccount(r.Context(), tx, req.UserID, asset.ID, types.AccountKindAvailable)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	_, err = h.svc.Transfer(r.Context(), tx, systemAccount, userAccount, amount, types.LedgerEntryTypeDeposit, req.Reference)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) Withdraw(w http.ResponseWriter, r *http.Request) {
	var req movementRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	amount, err := decimal.NewFromString(req.Amount)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid amount"})
		return
	}
	symbol := strings.ToUpper(strings.TrimSpace(req.AssetSymbol))
	asset, err := h.store.GetAssetBySymbol(r.Context(), symbol)
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
	userAccount, err := h.svc.EnsureAccount(r.Context(), tx, req.UserID, asset.ID, types.AccountKindAvailable)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	balance, err := h.svc.GetBalance(r.Context(), tx, userAccount)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if balance.LessThan(amount) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "insufficient balance"})
		return
	}
	systemAccount, err := h.svc.EnsureSystemAccount(r.Context(), tx, asset.ID, types.AccountKindAvailable)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	_, err = h.svc.Transfer(r.Context(), tx, userAccount, systemAccount, amount, types.LedgerEntryTypeWithdraw, req.Reference)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) Faucet(w http.ResponseWriter, r *http.Request, userID string) {
	if !h.faucetEnabled {
		httputil.WriteJSON(w, http.StatusForbidden, httputil.ErrorResponse{Error: "faucet disabled"})
		return
	}
	account, err := h.accountSvc.Resolve(r.Context(), userID, strings.TrimSpace(r.Header.Get("X-Account-ID")))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if account.Mode != "demo" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "faucet is allowed only for demo accounts"})
		return
	}

	var req faucetRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	symbol := strings.ToUpper(strings.TrimSpace(req.AssetSymbol))
	if symbol == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "asset is required"})
		return
	}
	if symbol != "USD" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "only USD faucet is supported"})
		return
	}
	amount, err := decimal.NewFromString(req.Amount)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid amount"})
		return
	}
	if amount.LessThanOrEqual(decimal.Zero) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "amount must be positive"})
		return
	}
	if h.faucetMax.GreaterThan(decimal.Zero) && amount.GreaterThan(h.faucetMax) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "amount exceeds faucet limit"})
		return
	}
	asset, err := h.store.GetAssetBySymbol(r.Context(), symbol)
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
	systemAccount, err := h.svc.EnsureSystemAccount(r.Context(), tx, asset.ID, types.AccountKindAvailable)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	userAccount, err := h.svc.EnsureAccountForTradingAccount(r.Context(), tx, userID, account.ID, asset.ID, types.AccountKindAvailable)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	ref := req.Reference
	if ref == "" {
		ref = "faucet"
	}
	_, err = h.svc.Transfer(r.Context(), tx, systemAccount, userAccount, amount, types.LedgerEntryTypeFaucet, ref)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) Balances(w http.ResponseWriter, r *http.Request, userID string) {
	account, err := h.accountSvc.Resolve(r.Context(), userID, strings.TrimSpace(r.Header.Get("X-Account-ID")))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	balances, err := h.svc.BalancesByUserAndAccount(r.Context(), userID, account.ID)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, balances)
}
