package orders

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"lv-tradepl/internal/accounts"
	"lv-tradepl/internal/httputil"
	"lv-tradepl/internal/types"

	"github.com/shopspring/decimal"
)

type Handler struct {
	svc        *Service
	accountSvc *accounts.Service
}

func NewHandler(svc *Service, accountSvc *accounts.Service) *Handler {
	return &Handler{svc: svc, accountSvc: accountSvc}
}

type placeOrderRequest struct {
	PairSymbol  string `json:"pair"`
	Side        string `json:"side"`
	Type        string `json:"type"`
	Price       string `json:"price"`
	Qty         string `json:"qty"`
	QuoteAmount string `json:"quote_amount"`
	TimeInForce string `json:"time_in_force"`
	ClientRef   string `json:"client_ref"`
}

func (h *Handler) Place(w http.ResponseWriter, r *http.Request, userID string) {
	account, err := h.accountSvc.Resolve(r.Context(), userID, strings.TrimSpace(r.Header.Get("X-Account-ID")))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	var req placeOrderRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	pairSymbol := strings.ToUpper(strings.TrimSpace(req.PairSymbol))
	if pairSymbol == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "pair is required"})
		return
	}
	if pairSymbol != "UZS-USD" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "only UZS-USD is supported"})
		return
	}
	var price *decimal.Decimal
	if req.Price != "" {
		p, err := decimal.NewFromString(req.Price)
		if err != nil {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid price"})
			return
		}
		price = &p
	}
	var qty *decimal.Decimal
	if req.Qty != "" {
		q, err := decimal.NewFromString(req.Qty)
		if err != nil {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid qty"})
			return
		}
		qty = &q
	}
	var quoteAmount *decimal.Decimal
	if req.QuoteAmount != "" {
		q, err := decimal.NewFromString(req.QuoteAmount)
		if err != nil {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid quote_amount"})
			return
		}
		quoteAmount = &q
	}
	res, err := h.svc.PlaceOrder(r.Context(), PlaceOrderRequest{
		UserID:      userID,
		AccountID:   account.ID,
		PairSymbol:  pairSymbol,
		Side:        types.OrderSide(req.Side),
		Type:        types.OrderType(req.Type),
		Price:       price,
		Qty:         qty,
		QuoteAmount: quoteAmount,
		TimeInForce: types.TimeInForce(req.TimeInForce),
		ClientRef:   req.ClientRef,
	})
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusCreated, map[string]string{"order_id": res.OrderID, "status": string(res.Status)})
}

func (h *Handler) Metrics(w http.ResponseWriter, r *http.Request, userID string) {
	account, err := h.accountSvc.Resolve(r.Context(), userID, strings.TrimSpace(r.Header.Get("X-Account-ID")))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	metrics, err := h.svc.GetAccountMetricsByAccount(r.Context(), userID, account.ID)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, metrics)
}

func (h *Handler) OpenOrders(w http.ResponseWriter, r *http.Request, userID string) {
	// For simplicity, we just list orders with status 'new' or 'partially_filled'
	// But wait, the Service doesn't have a ListOrders method exposed yet?
	// Let's add it quickly or check service.
	// We need to implement ListOpenOrders in Service first.
	account, err := h.accountSvc.Resolve(r.Context(), userID, strings.TrimSpace(r.Header.Get("X-Account-ID")))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	orders, err := h.svc.ListOpenOrdersByAccount(r.Context(), userID, account.ID)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, orders)
}

func (h *Handler) OrderHistory(w http.ResponseWriter, r *http.Request, userID string) {
	account, err := h.accountSvc.Resolve(r.Context(), userID, strings.TrimSpace(r.Header.Get("X-Account-ID")))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	limit := 50
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		v, convErr := strconv.Atoi(rawLimit)
		if convErr != nil || v <= 0 {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid limit"})
			return
		}
		if v > 200 {
			v = 200
		}
		limit = v
	}

	var before *time.Time
	if rawBefore := strings.TrimSpace(r.URL.Query().Get("before")); rawBefore != "" {
		parsed, parseErr := time.Parse(time.RFC3339Nano, rawBefore)
		if parseErr != nil {
			parsed, parseErr = time.Parse(time.RFC3339, rawBefore)
		}
		if parseErr != nil {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid before"})
			return
		}
		before = &parsed
	}

	orders, err := h.svc.ListOrderHistoryByAccount(r.Context(), userID, account.ID, account.Mode, before, limit)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, orders)
}

func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request, userID string, orderID string) {
	account, err := h.accountSvc.Resolve(r.Context(), userID, strings.TrimSpace(r.Header.Get("X-Account-ID")))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if err := h.svc.CancelOrder(r.Context(), userID, orderID, account.ID); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "closed"})
}

func (h *Handler) CloseMany(w http.ResponseWriter, r *http.Request, userID string) {
	account, err := h.accountSvc.Resolve(r.Context(), userID, strings.TrimSpace(r.Header.Get("X-Account-ID")))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	var req struct {
		Scope string `json:"scope"`
	}
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	res, err := h.svc.CloseOrdersByScope(r.Context(), userID, account.ID, req.Scope)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, res)
}
