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

type telegramLoginRequest struct {
	InitData string `json:"init_data"`
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

func (h *Handler) LoginTelegram(w http.ResponseWriter, r *http.Request) {
	var req telegramLoginRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	token, user, err := h.svc.LoginTelegram(r.Context(), req.InitData)
	if err != nil {
		httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"access_token": token,
		"user": map[string]interface{}{
			"id":           user.ID,
			"email":        user.Email,
			"telegram_id":  user.TelegramID,
			"display_name": user.DisplayName,
			"avatar_url":   user.AvatarURL,
		},
	})
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request, userID string) {
	user, err := h.svc.GetUser(r.Context(), userID)
	if err != nil {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"id":           user.ID,
		"email":        user.Email,
		"telegram_id":  user.TelegramID,
		"display_name": user.DisplayName,
		"avatar_url":   user.AvatarURL,
	})
}

// Verify checks if user exists in database - used on page load to validate session
func (h *Handler) Verify(w http.ResponseWriter, r *http.Request, userID string) {
	exists, err := h.svc.UserExists(r.Context(), userID)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "verification failed"})
		return
	}
	if !exists {
		httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "user not found, please login again"})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{"valid": true, "user_id": userID})
}
