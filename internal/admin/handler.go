package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"lv-tradepl/internal/httputil"
)

// Handler handles admin authentication
type Handler struct {
	pool       *pgxpool.Pool
	jwtSecret  []byte
	tokenStore *TokenStore
}

// NewHandler creates a new admin handler
func NewHandler(pool *pgxpool.Pool, jwtSecret string) *Handler {
	return &Handler{
		pool:       pool,
		jwtSecret:  []byte(jwtSecret),
		tokenStore: NewTokenStore(pool),
	}
}

// Login handles admin login
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request"})
		return
	}

	// Get user from DB
	var id int
	var passwordHash string
	err := h.pool.QueryRow(r.Context(),
		"SELECT id, password_hash FROM admin_users WHERE username = $1", req.Username,
	).Scan(&id, &passwordHash)
	if err != nil {
		httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "invalid credentials"})
		return
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "invalid credentials"})
		return
	}

	// Generate JWT token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":      id,
		"username": req.Username,
		"role":     "admin",
		"exp":      time.Now().Add(24 * time.Hour).Unix(),
	})
	tokenStr, err := token.SignedString(h.jwtSecret)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: "token generation failed"})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]string{
		"token":    tokenStr,
		"username": req.Username,
	})
}

// Me returns admin info
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	username := r.Context().Value(adminUsernameKey).(string)
	httputil.WriteJSON(w, http.StatusOK, map[string]string{
		"username": username,
		"role":     "admin",
	})
}

// ValidateToken validates an access token from Telegram bot
func (h *Handler) ValidateToken(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "token required"})
		return
	}

	accessToken, err := h.tokenStore.ValidateToken(r.Context(), token)
	if err != nil {
		httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "invalid or expired token"})
		return
	}

	// Get rights if it's an admin token
	var rights map[string]bool
	if accessToken.TokenType == "admin" {
		admin, err := h.tokenStore.GetPanelAdminByTelegramID(r.Context(), accessToken.TelegramID)
		if err != nil {
			httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "admin not found"})
			return
		}
		rights = admin.Rights
	} else {
		// Owner has all rights
		rights = map[string]bool{
			"sessions":   true,
			"trend":      true,
			"events":     true,
			"volatility": true,
		}
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"valid":       true,
		"token_type":  accessToken.TokenType,
		"telegram_id": accessToken.TelegramID,
		"expires_at":  accessToken.ExpiresAt,
		"rights":      rights,
	})
}

// GetPanelAdmins returns all panel admins (owner only)
func (h *Handler) GetPanelAdmins(w http.ResponseWriter, r *http.Request) {
	admins, err := h.tokenStore.GetPanelAdmins(r.Context())
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if admins == nil {
		admins = []PanelAdmin{}
	}
	httputil.WriteJSON(w, http.StatusOK, admins)
}

// CreatePanelAdmin creates a new panel admin
func (h *Handler) CreatePanelAdmin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TelegramID int64           `json:"telegram_id"`
		Name       string          `json:"name"`
		Rights     map[string]bool `json:"rights"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request"})
		return
	}

	if req.TelegramID == 0 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "telegram_id required"})
		return
	}

	admin, err := h.tokenStore.CreatePanelAdmin(r.Context(), req.TelegramID, req.Name, req.Rights)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	httputil.WriteJSON(w, http.StatusCreated, admin)
}

// UpdatePanelAdmin updates a panel admin
func (h *Handler) UpdatePanelAdmin(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid id"})
		return
	}

	var req struct {
		Name   string          `json:"name"`
		Rights map[string]bool `json:"rights"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request"})
		return
	}

	admin, err := h.tokenStore.UpdatePanelAdmin(r.Context(), id, req.Name, req.Rights)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, admin)
}

// DeletePanelAdmin deletes a panel admin
func (h *Handler) DeletePanelAdmin(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid id"})
		return
	}

	if err := h.tokenStore.DeletePanelAdmin(r.Context(), id); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// AdminAuthMiddleware validates admin JWT token
func AdminAuthMiddleware(jwtSecret string) func(http.Handler) http.Handler {
	secret := []byte(jwtSecret)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "missing authorization"})
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || parts[0] != "Bearer" {
				httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "invalid authorization format"})
				return
			}

			token, err := jwt.Parse(parts[1], func(token *jwt.Token) (interface{}, error) {
				return secret, nil
			})
			if err != nil || !token.Valid {
				httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "invalid token"})
				return
			}

			claims, ok := token.Claims.(jwt.MapClaims)
			if !ok {
				httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "invalid claims"})
				return
			}

			role, _ := claims["role"].(string)
			if role != "admin" {
				httputil.WriteJSON(w, http.StatusForbidden, httputil.ErrorResponse{Error: "admin access required"})
				return
			}

			username, _ := claims["username"].(string)
			ctx := context.WithValue(r.Context(), adminUsernameKey, username)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

type contextKey string

const adminUsernameKey contextKey = "admin_username"
