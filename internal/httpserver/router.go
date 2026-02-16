package httpserver

import (
	"net/http"
	"os"
	"path/filepath"

	"lv-tradepl/internal/accounts"
	"lv-tradepl/internal/admin"
	"lv-tradepl/internal/auth"
	"lv-tradepl/internal/health"
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
	HealthHandler     *health.Handler
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

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		if d.HealthHandler == nil {
			w.WriteHeader(http.StatusOK)
			return
		}
		d.HealthHandler.Get(w, r)
	})
	r.Get("/health/live", func(w http.ResponseWriter, r *http.Request) {
		if d.HealthHandler == nil {
			w.WriteHeader(http.StatusOK)
			return
		}
		d.HealthHandler.Live(w, r)
	})
	r.Get("/health/ready", func(w http.ResponseWriter, r *http.Request) {
		if d.HealthHandler == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		d.HealthHandler.Ready(w, r)
	})
	r.Get("/health/admin", func(w http.ResponseWriter, r *http.Request) {
		if d.HealthHandler == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		d.HealthHandler.Full(w, r)
	})
	r.Get("/metrics", func(w http.ResponseWriter, r *http.Request) {
		if d.HealthHandler == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		d.HealthHandler.Metrics(w, r)
	})
	r.Route("/v1", func(r chi.Router) {
		r.Route("/auth", func(r chi.Router) {
			r.Get("/mode", d.AuthHandler.Mode)
			r.Post("/register", d.AuthHandler.Register)
			r.Post("/login", d.AuthHandler.Login)
			r.Post("/telegram", d.AuthHandler.LoginTelegram)
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
			r.Post("/auth/telegram/write-access", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.AuthHandler.UpdateTelegramWriteAccess(w, r, userID)
			})
			r.Post("/auth/telegram/notifications", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.AuthHandler.UpdateTelegramNotifications(w, r, userID)
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
			r.Get("/rewards/signup", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.LedgerHandler.SignupBonusStatus(w, r, userID)
			})
			r.Post("/rewards/signup/claim", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.LedgerHandler.ClaimSignupBonus(w, r, userID)
			})
			r.Get("/rewards/deposit", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.LedgerHandler.DepositBonusStatus(w, r, userID)
			})
			r.Get("/rewards/profit", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.LedgerHandler.ProfitRewardStatus(w, r, userID)
			})
			r.Post("/rewards/profit/claim", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.LedgerHandler.ClaimProfitReward(w, r, userID)
			})
			r.Post("/deposits/real/request", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.LedgerHandler.RequestRealDeposit(w, r, userID)
			})
			r.Post("/withdraw/real/request", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.LedgerHandler.RequestRealWithdraw(w, r, userID)
			})
			r.Get("/kyc/status", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.LedgerHandler.KYCStatus(w, r, userID)
			})
			r.Post("/kyc/request", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.LedgerHandler.RequestKYC(w, r, userID)
			})
			r.Get("/referrals/status", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.LedgerHandler.ReferralStatus(w, r, userID)
			})
			r.Get("/referrals/events", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.LedgerHandler.ReferralEvents(w, r, userID)
			})
			r.Post("/referrals/withdraw", func(w http.ResponseWriter, r *http.Request) {
				userID, ok := UserID(r)
				if !ok {
					httputil.WriteJSON(w, http.StatusUnauthorized, httputil.ErrorResponse{Error: "unauthorized"})
					return
				}
				d.LedgerHandler.ReferralWithdraw(w, r, userID)
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
			r.Get("/news/upcoming", d.SessionsHandler.PublicNewsUpcoming)
			r.Get("/news/recent", d.SessionsHandler.PublicNewsRecent)
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
			r.Post("/internal/telegram/reviews/deposit/decision", d.LedgerHandler.InternalTelegramDepositDecision)
			r.Post("/internal/telegram/reviews/kyc/decision", d.LedgerHandler.InternalTelegramKYCDecision)
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
				// System diagnostics (owner-only)
				r.With(admin.RequireOwner).Get("/system/health", func(w http.ResponseWriter, r *http.Request) {
					if d.HealthHandler == nil {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					d.HealthHandler.FullTrusted(w, r)
				})
				r.With(admin.RequireOwner).Get("/system/metrics", func(w http.ResponseWriter, r *http.Request) {
					if d.HealthHandler == nil {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					d.HealthHandler.MetricsJSONTrusted(w, r)
				})
				r.With(admin.RequireOwner).Post("/system/reset-db", d.AdminHandler.ResetDatabaseData)
				r.With(admin.RequireOwner).Get("/system/updater", d.AdminHandler.GetSystemUpdater)
				r.With(admin.RequireOwner).Post("/system/updater/check", d.AdminHandler.CheckSystemUpdater)
				r.With(admin.RequireOwner).Post("/system/updater/update", d.AdminHandler.RunSystemUpdater)
				r.With(admin.RequireOwner).Post("/system/updater/config", d.AdminHandler.UpdateSystemUpdaterConfig)
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
				// Economic news calendar (owner-only)
				r.With(admin.RequireOwner).Get("/news/events", d.SessionsHandler.AdminNewsEvents)
				r.With(admin.RequireOwner).Post("/news/events", d.SessionsHandler.AdminCreateNewsEvent)
				r.With(admin.RequireOwner).Delete("/news/events/{id}", d.SessionsHandler.AdminCancelNewsEvent)
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
				// Real deposit payment methods (owner-only)
				r.With(admin.RequireOwner).Get("/deposit-methods", d.AdminHandler.GetDepositMethods)
				r.With(admin.RequireOwner).Post("/deposit-methods", d.AdminHandler.UpdateDepositMethods)
				// Panel admins management (owner only feature on UI)
				r.Get("/panel-admins", d.AdminHandler.GetPanelAdmins)
				r.Post("/panel-admins", d.AdminHandler.CreatePanelAdmin)
				r.Put("/panel-admins/{id}", d.AdminHandler.UpdatePanelAdmin)
				r.Delete("/panel-admins/{id}", d.AdminHandler.DeletePanelAdmin)
				r.Post("/kyc/unban/{userID}", d.AdminHandler.ClearKYCBlock)
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
