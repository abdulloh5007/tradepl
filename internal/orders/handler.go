package orders

import (
	"net/http"
	"strings"

	"github.com/shopspring/decimal"
	"lv-tradepl/internal/httputil"
	"lv-tradepl/internal/types"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
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
