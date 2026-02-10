package httpserver

import (
	"net/http"
	"os"
	"path/filepath"

	"lv-tradepl/internal/accounts"
	"lv-tradepl/internal/admin"
	"lv-tradepl/internal/auth"
	"lv-tradepl/internal/httputil"
	"lv-tradepl/internal/ledger"
	"lv-tradepl/internal/marketdata"
	"lv-tradepl/internal/orders"
	"lv-tradepl/internal/sessions"
	"lv-tradepl/internal/volatility"

	"github.com/go-chi/chi/v5"
)

type RouterDeps struct {
	AuthHandler       *auth.Handler
	AccountsHandler   *accounts.Handler
	LedgerHandler     *ledger.Handler
	OrderHandler      *orders.Handler
	MarketHandler     *marketdata.Handler
	SessionsHandler   *sessions.Handler
	VolatilityHandler *volatility.Handler
	AdminHandler      *admin.Handler
	AuthService       *auth.Service
	InternalToken     string
	JWTSecret         string
	WSHandler         http.Handler
	EventsWSHandler   http.Handler
	UIDist            string
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
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Account-ID")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			next.ServeHTTP(w, r)
		})
	})

	// Security Middleware
	r.Use(SecurityHeaders)
	r.Use(RateLimitMiddleware)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Route("/v1", func(r chi.Router) {
		r.Route("/auth", func(r chi.Router) {
			r.Post("/register", d.AuthHandler.Register)
			r.Post("/login", d.AuthHandler.Login)
			// Verify endpoint - check if user exists in DB (with rate limiting)
			r.With(VerifyRateLimitMiddleware).Group(func(r chi.Router) {
				r.Use(WithAuth(d.AuthService))
				r.Get("/verify", func(w http.ResponseWriter, r *http.Request) {
					userID, ok := UserID(r)
					if !ok {
						httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
						return
					}
					d.AuthHandler.Verify(w, r, userID)
				})
			})
		})
		r.Get("/ws", d.WSHandler.ServeHTTP)
		r.Get("/events/ws", d.EventsWSHandler.ServeHTTP) // Unauthenticated WebSocket for event_state
		r.Get("/market/config", d.MarketHandler.GetConfig)
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
			r.Get("/accounts", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.AccountsHandler.List(w, r, userID)
			})
			r.Post("/accounts", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.AccountsHandler.Create(w, r, userID)
			})
			r.Post("/accounts/switch", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.AccountsHandler.Switch(w, r, userID)
			})
			r.Post("/accounts/leverage", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.AccountsHandler.UpdateLeverage(w, r, userID)
			})
			r.Post("/accounts/name", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.AccountsHandler.UpdateName(w, r, userID)
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
			r.Get("/orders/history", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.OrderHandler.OrderHistory(w, r, userID)
			})
			r.Post("/orders/close", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.OrderHandler.CloseMany(w, r, userID)
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
			r.Post("/withdraw", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.LedgerHandler.WithdrawDemo(w, r, userID)
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
			// Public token validation (for Telegram bot tokens)
			r.Get("/validate-token", d.AdminHandler.ValidateToken)

			// Protected routes
			r.Group(func(r chi.Router) {
				r.Use(admin.AdminAuthMiddleware(d.JWTSecret))
				r.Get("/me", d.AdminHandler.Me)
				// Sessions
				r.With(admin.RequireRight("sessions")).Get("/sessions", d.SessionsHandler.GetSessions)
				r.With(admin.RequireRight("sessions")).Get("/sessions/active", d.SessionsHandler.GetActiveSession)
				r.With(admin.RequireRight("sessions")).Post("/sessions/switch", d.SessionsHandler.SwitchSession)
				// Mode (auto/manual)
				r.With(admin.RequireRight("sessions")).Get("/sessions/mode", d.SessionsHandler.GetMode)
				r.With(admin.RequireRight("sessions")).Post("/sessions/mode", d.SessionsHandler.SetMode)
				// Trend
				r.With(admin.RequireRight("trend")).Get("/trend", d.SessionsHandler.GetTrend)
				r.With(admin.RequireRight("trend")).Get("/trend/mode", d.SessionsHandler.GetTrendMode)
				r.With(admin.RequireRight("trend")).Get("/trend/state", d.SessionsHandler.GetTrendState)
				r.With(admin.RequireRight("trend")).Post("/trend", d.SessionsHandler.SetTrend)
				r.With(admin.RequireRight("trend")).Post("/trend/mode", d.SessionsHandler.SetTrendMode)
				// Price events
				r.With(admin.RequireRight("events")).Get("/events", d.SessionsHandler.GetEvents)
				r.With(admin.RequireRight("events")).Get("/events/active", d.SessionsHandler.GetActiveEvent)
				r.With(admin.RequireRight("events")).Post("/events", d.SessionsHandler.CreateEvent)
				r.With(admin.RequireRight("events")).Delete("/events/{id}", d.SessionsHandler.CancelEvent)
				// Volatility
				r.With(admin.RequireRight("volatility")).Get("/volatility", d.VolatilityHandler.GetSettings)
				r.With(admin.RequireRight("volatility")).Post("/volatility/activate", d.VolatilityHandler.SetActive)
				r.With(admin.RequireRight("volatility")).Post("/volatility/mode", d.VolatilityHandler.SetMode)
				// Trading risk + pair contract specs
				r.Get("/trading/risk", d.AdminHandler.GetTradingRisk)
				r.Post("/trading/risk", d.AdminHandler.UpdateTradingRisk)
				r.Get("/trading/pairs", d.AdminHandler.GetTradingPairs)
				r.Post("/trading/pairs/{symbol}", d.AdminHandler.UpdateTradingPair)
				// Fixed P/L contract sizing (owner only, server-enforced)
				r.Get("/trading/pnl", d.AdminHandler.GetTradingPnLConfig)
				r.Post("/trading/pnl/{symbol}", d.AdminHandler.UpdateTradingPnLConfig)
				// Panel admins management (owner only feature on UI)
				r.Get("/panel-admins", d.AdminHandler.GetPanelAdmins)
				r.Post("/panel-admins", d.AdminHandler.CreatePanelAdmin)
				r.Put("/panel-admins/{id}", d.AdminHandler.UpdatePanelAdmin)
				r.Delete("/panel-admins/{id}", d.AdminHandler.DeletePanelAdmin)
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
