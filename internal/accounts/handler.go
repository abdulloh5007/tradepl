package accounts

import (
	"net/http"

	"lv-tradepl/internal/httputil"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request, userID string) {
	accounts, err := h.svc.List(r.Context(), userID)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if accounts == nil {
		accounts = []TradingAccount{}
	}
	httputil.WriteJSON(w, http.StatusOK, accounts)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request, userID string) {
	var req struct {
		PlanID   string `json:"plan_id"`
		Mode     string `json:"mode"`
		Name     string `json:"name"`
		IsActive bool   `json:"is_active"`
	}
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	acc, err := h.svc.Create(r.Context(), userID, req.PlanID, req.Mode, req.Name, req.IsActive)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusCreated, acc)
}

func (h *Handler) Switch(w http.ResponseWriter, r *http.Request, userID string) {
	var req struct {
		AccountID string `json:"account_id"`
	}
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	acc, err := h.svc.SetActive(r.Context(), userID, req.AccountID)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, acc)
}

func (h *Handler) UpdateLeverage(w http.ResponseWriter, r *http.Request, userID string) {
	var req struct {
		AccountID string `json:"account_id"`
		Leverage  int    `json:"leverage"`
	}
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	acc, err := h.svc.UpdateLeverage(r.Context(), userID, req.AccountID, req.Leverage)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, acc)
}
