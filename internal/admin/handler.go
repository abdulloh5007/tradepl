package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"lv-tradepl/internal/httputil"
)

// Handler handles admin authentication
type Handler struct {
	pool      *pgxpool.Pool
	jwtSecret []byte
}

// NewHandler creates a new admin handler
func NewHandler(pool *pgxpool.Pool, jwtSecret string) *Handler {
	return &Handler{pool: pool, jwtSecret: []byte(jwtSecret)}
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
