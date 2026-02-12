package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"lv-tradepl/internal/accounts"
	"lv-tradepl/internal/admin"
	"lv-tradepl/internal/auth"
	"lv-tradepl/internal/config"
	"lv-tradepl/internal/db"
	"lv-tradepl/internal/httpserver"
	"lv-tradepl/internal/ledger"
	"lv-tradepl/internal/marketdata"
	"lv-tradepl/internal/matching"
	"lv-tradepl/internal/orders"
	"lv-tradepl/internal/sessions"
	"lv-tradepl/internal/volatility"

	"github.com/shopspring/decimal"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	if cfg.UIDist != "" {
		if _, err := os.Stat(cfg.UIDist); err != nil {
			log.Fatal(err)
		}
	}
	ctx := context.Background()
	pool, err := db.NewPool(ctx, cfg.DBDSN)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	bus := marketdata.NewBus()
	market := marketdata.NewStore(pool)
	accountSvc := accounts.NewService(pool)
	accountHandler := accounts.NewHandler(accountSvc)
	ledgerSvc := ledger.NewService(pool)
	orderStore := orders.NewStore()
	matchEngine := matching.NewEngine(orderStore, ledgerSvc, bus)
	orderSvc := orders.NewService(pool, orderStore, ledgerSvc, market, matchEngine, accountSvc)
	authSvc := auth.NewService(pool, cfg.JWTIssuer, []byte(cfg.JWTSecret), cfg.JWTTTL)
	authSvc.SetTelegramBotToken(cfg.TelegramBotToken)
	authSvc.SetAccountService(accountSvc)
	authHandler := auth.NewHandler(authSvc, cfg.ProfectMode)
	faucetMax, err := decimal.NewFromString(cfg.FaucetMax)
	if err != nil {
		log.Fatal(err)
	}
	ledgerHandler := ledger.NewHandler(ledgerSvc, market, accountSvc, cfg.FaucetEnabled, faucetMax)
	orderHandler := orders.NewHandler(orderSvc, accountSvc)
	marketWS := marketdata.NewMarketWS(cfg.WebSocketOrigin)
	store := marketdata.NewCandleStore(cfg.MarketDataDir)
	candleWS := marketdata.NewCandleWS(cfg.WebSocketOrigin, store)
	marketHandler := marketdata.NewHandler(marketWS, candleWS)
	sessionsStore := sessions.NewStore(pool)
	sessionsHandler := sessions.NewHandler(sessionsStore)
	volStore := volatility.NewStore(pool)
	volHandler := volatility.NewHandler(volStore)
	adminHandler := admin.NewHandler(pool, cfg.JWTSecret)
	wsHandler := httpserver.NewWSHandler(bus, authSvc, cfg.WebSocketOrigin)
	eventsWSHandler := httpserver.NewEventsWSHandler(bus, cfg.WebSocketOrigin)
	router := httpserver.NewRouter(httpserver.RouterDeps{
		AuthHandler:       authHandler,
		AccountsHandler:   accountHandler,
		LedgerHandler:     ledgerHandler,
		OrderHandler:      orderHandler,
		MarketHandler:     marketHandler,
		SessionsHandler:   sessionsHandler,
		VolatilityHandler: volHandler,
		AdminHandler:      adminHandler,
		AuthService:       authSvc,
		InternalToken:     cfg.InternalToken,
		JWTSecret:         cfg.JWTSecret,
		WSHandler:         wsHandler,
		EventsWSHandler:   eventsWSHandler,
		UIDist:            cfg.UIDist,
	})
	srv := &http.Server{Addr: cfg.HTTPAddr, Handler: router}

	// Set event state callback for API access
	sessions.SetEventStateCallback(func() interface{} {
		return marketdata.GetCurrentEventState()
	})
	sessions.SetTrendStateCallback(func() interface{} {
		return marketdata.GetCurrentAutoTrendState()
	})

	// Start quote/candle publisher with session support
	marketdata.StartPublisherWithDB(bus, "UZS-USD", cfg.MarketDataDir, pool)

	log.Printf("server listening on %s", cfg.HTTPAddr)
	log.Printf("health endpoint: http://localhost%s/health", cfg.HTTPAddr)
	log.Printf("auth mode: %s", cfg.ProfectMode)
	if cfg.UIDist != "" {
		log.Printf("ui dist: %s", cfg.UIDist)
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
