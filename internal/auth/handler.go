package auth

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

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	id, err := h.svc.Register(r.Context(), req.Email, req.Password)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	token, err := h.svc.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusCreated, map[string]string{"user_id": id, "access_token": token})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	token, err := h.svc.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"access_token": token})
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request, userID string) {
	user, err := h.svc.GetUser(r.Context(), userID)
	if err != nil {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"id": user.ID, "email": user.Email})
}
