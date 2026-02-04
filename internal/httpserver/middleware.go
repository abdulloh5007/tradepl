package httpserver

import (
	"context"
	"net/http"
	"strings"

	"lv-tradepl/internal/auth"
	"lv-tradepl/internal/httputil"
)

type ctxKey string

const userIDKey ctxKey = "user_id"

func WithAuth(svc *auth.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authz := r.Header.Get("Authorization")
			parts := strings.SplitN(authz, " ", 2)
			if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
				httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "missing bearer token"})
				return
			}
			userID, err := svc.ParseToken(parts[1])
			if err != nil {
				httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "invalid token"})
				return
			}
			ctx := context.WithValue(r.Context(), userIDKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func UserID(r *http.Request) (string, bool) {
	v := r.Context().Value(userIDKey)
	if v == nil {
		return "", false
	}
	id, ok := v.(string)
	return id, ok
}

func InternalAuth(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("X-Internal-Token") != token {
				httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "invalid internal token"})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
