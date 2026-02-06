package httpserver

import (
	"net/http"
	"os"
	"path/filepath"

	"lv-tradepl/internal/admin"
	"lv-tradepl/internal/auth"
	"lv-tradepl/internal/httputil"
	"lv-tradepl/internal/ledger"
	"lv-tradepl/internal/marketdata"
	"lv-tradepl/internal/orders"
	"lv-tradepl/internal/sessions"

	"github.com/go-chi/chi/v5"
)

type RouterDeps struct {
	AuthHandler     *auth.Handler
	LedgerHandler   *ledger.Handler
	OrderHandler    *orders.Handler
	MarketHandler   *marketdata.Handler
	SessionsHandler *sessions.Handler
	AdminHandler    *admin.Handler
	AuthService     *auth.Service
	InternalToken   string
	JWTSecret       string
	WSHandler       http.Handler
	UIDist          string
}

func NewRouter(d RouterDeps) http.Handler {
	r := chi.NewRouter()

	// CORS middleware for development
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin == "" {
				origin = "*"
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			next.ServeHTTP(w, r)
		})
	})

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Route("/v1", func(r chi.Router) {
		r.Route("/auth", func(r chi.Router) {
			r.Post("/register", d.AuthHandler.Register)
			r.Post("/login", d.AuthHandler.Login)
		})
		r.Get("/ws", d.WSHandler.ServeHTTP)
		r.Get("/market/candles", d.MarketHandler.Candles)
		r.Get("/market/ws", d.MarketHandler.WS.ServeHTTP)
		r.Get("/market/candles/ws", d.MarketHandler.CandleWS.ServeHTTP)
		r.Group(func(r chi.Router) {
			r.Use(WithAuth(d.AuthService))
			r.Get("/me", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.AuthHandler.Me(w, r, userID)
			})
			r.Get("/balances", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.LedgerHandler.Balances(w, r, userID)
			})
			r.Post("/orders", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.OrderHandler.Place(w, r, userID)
			})
			r.Get("/orders", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.OrderHandler.OpenOrders(w, r, userID)
			})
			r.Delete("/orders/{id}", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.OrderHandler.Cancel(w, r, userID, chi.URLParam(r, "id"))
			})
			r.Get("/metrics", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.OrderHandler.Metrics(w, r, userID)
			})
			r.Post("/faucet", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.LedgerHandler.Faucet(w, r, userID)
			})
		})
		r.Group(func(r chi.Router) {
			r.Use(InternalAuth(d.InternalToken))
			r.Post("/internal/deposits", d.LedgerHandler.Deposit)
			r.Post("/internal/withdrawals", d.LedgerHandler.Withdraw)
		})
		// Admin routes
		r.Route("/admin", func(r chi.Router) {
			// Public login endpoint
			r.Post("/login", d.AdminHandler.Login)

			// Protected routes
			r.Group(func(r chi.Router) {
				r.Use(admin.AdminAuthMiddleware(d.JWTSecret))
				r.Get("/me", d.AdminHandler.Me)
				// Sessions
				r.Get("/sessions", d.SessionsHandler.GetSessions)
				r.Get("/sessions/active", d.SessionsHandler.GetActiveSession)
				r.Post("/sessions/switch", d.SessionsHandler.SwitchSession)
				// Mode (auto/manual)
				r.Get("/sessions/mode", d.SessionsHandler.GetMode)
				r.Post("/sessions/mode", d.SessionsHandler.SetMode)
				// Trend
				r.Get("/trend", d.SessionsHandler.GetTrend)
				r.Post("/trend", d.SessionsHandler.SetTrend)
				// Price events
				r.Get("/events", d.SessionsHandler.GetEvents)
				r.Post("/events", d.SessionsHandler.CreateEvent)
				r.Delete("/events/{id}", d.SessionsHandler.CancelEvent)
			})
		})
	})
	if d.UIDist != "" {
		r.NotFound(spaHandler(d.UIDist).ServeHTTP)
	}
	return r
}

func spaHandler(dir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}
		clean := filepath.Clean(path)
		full := filepath.Join(dir, clean)
		if info, err := os.Stat(full); err == nil && !info.IsDir() {
			http.ServeFile(w, r, full)
			return
		}
		index := filepath.Join(dir, "index.html")
		if _, err := os.Stat(index); err != nil {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, index)
	})
}
