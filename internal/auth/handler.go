package auth

import (
	"net/http"

	"lv-tradepl/internal/httputil"
)

type Handler struct {
	svc         *Service
	profectMode string
}

func NewHandler(svc *Service, profectMode string) *Handler {
	mode := profectMode
	if mode == "" {
		mode = "development"
	}
	return &Handler{svc: svc, profectMode: mode}
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

type telegramWriteAccessRequest struct {
	Allowed bool `json:"allowed"`
}

type telegramNotificationsRequest struct {
	Enabled bool `json:"enabled"`
}

type telegramNotificationKindsRequest struct {
	System   bool `json:"system"`
	Bonus    bool `json:"bonus"`
	Deposit  bool `json:"deposit"`
	News     bool `json:"news"`
	Referral bool `json:"referral"`
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	if h.profectMode == "production" {
		httputil.WriteJSON(w, http.StatusForbidden, httputil.ErrorResponse{Error: "email auth is disabled in production mode"})
		return
	}
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
	if h.profectMode == "production" {
		httputil.WriteJSON(w, http.StatusForbidden, httputil.ErrorResponse{Error: "email auth is disabled in production mode"})
		return
	}
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
	if h.profectMode != "production" {
		httputil.WriteJSON(w, http.StatusForbidden, httputil.ErrorResponse{Error: "telegram auth is available only in production mode"})
		return
	}
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
			"id":                             user.ID,
			"email":                          user.Email,
			"telegram_id":                    user.TelegramID,
			"telegram_write_access":          user.TelegramWriteAccess,
			"telegram_notifications_enabled": user.TelegramNotificationsEnabled,
			"telegram_notification_kinds": map[string]bool{
				"system":   user.TelegramNotificationKinds.System,
				"bonus":    user.TelegramNotificationKinds.Bonus,
				"deposit":  user.TelegramNotificationKinds.Deposit,
				"news":     user.TelegramNotificationKinds.News,
				"referral": user.TelegramNotificationKinds.Referral,
			},
			"display_name": user.DisplayName,
			"avatar_url":   user.AvatarURL,
		},
	})
}

func (h *Handler) UpdateTelegramWriteAccess(w http.ResponseWriter, r *http.Request, userID string) {
	if h.profectMode != "production" {
		httputil.WriteJSON(w, http.StatusForbidden, httputil.ErrorResponse{Error: "telegram write access is available only in production mode"})
		return
	}
	var req telegramWriteAccessRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if err := h.svc.SetTelegramWriteAccess(r.Context(), userID, req.Allowed); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "ok",
		"allowed": req.Allowed,
	})
}

func (h *Handler) UpdateTelegramNotifications(w http.ResponseWriter, r *http.Request, userID string) {
	if h.profectMode != "production" {
		httputil.WriteJSON(w, http.StatusForbidden, httputil.ErrorResponse{Error: "telegram notifications are available only in production mode"})
		return
	}
	var req telegramNotificationsRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if err := h.svc.SetTelegramNotificationsEnabled(r.Context(), userID, req.Enabled); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "ok",
		"enabled": req.Enabled,
	})
}

func (h *Handler) UpdateTelegramNotificationKinds(w http.ResponseWriter, r *http.Request, userID string) {
	if h.profectMode != "production" {
		httputil.WriteJSON(w, http.StatusForbidden, httputil.ErrorResponse{Error: "telegram notifications are available only in production mode"})
		return
	}
	var req telegramNotificationKindsRequest
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	kinds := TelegramNotificationKinds{
		System:   req.System,
		Bonus:    req.Bonus,
		Deposit:  req.Deposit,
		News:     req.News,
		Referral: req.Referral,
	}
	if err := h.svc.SetTelegramNotificationKinds(r.Context(), userID, kinds); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"status": "ok",
		"kinds": map[string]bool{
			"system":   kinds.System,
			"bonus":    kinds.Bonus,
			"deposit":  kinds.Deposit,
			"news":     kinds.News,
			"referral": kinds.Referral,
		},
	})
}

func (h *Handler) Mode(w http.ResponseWriter, _ *http.Request) {
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"mode": h.profectMode})
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request, userID string) {
	user, err := h.svc.GetUser(r.Context(), userID)
	if err != nil {
		httputil.WriteJSON(w, http.StatusNotFound, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"id":                             user.ID,
		"email":                          user.Email,
		"telegram_id":                    user.TelegramID,
		"telegram_write_access":          user.TelegramWriteAccess,
		"telegram_notifications_enabled": user.TelegramNotificationsEnabled,
		"telegram_notification_kinds": map[string]bool{
			"system":   user.TelegramNotificationKinds.System,
			"bonus":    user.TelegramNotificationKinds.Bonus,
			"deposit":  user.TelegramNotificationKinds.Deposit,
			"news":     user.TelegramNotificationKinds.News,
			"referral": user.TelegramNotificationKinds.Referral,
		},
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
