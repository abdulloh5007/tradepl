package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"lv-tradepl/internal/accounts"
	"lv-tradepl/internal/auth"
	"lv-tradepl/internal/marketdata"
	"lv-tradepl/internal/orders"
	"lv-tradepl/internal/types"

	"github.com/gorilla/websocket"
)

type WSHandler struct {
	bus      *marketdata.Bus
	authSvc  *auth.Service
	account  *accounts.Service
	orderSvc *orders.Service
	origin   string
	upgrader websocket.Upgrader
}

func NewWSHandler(bus *marketdata.Bus, authSvc *auth.Service, accountSvc *accounts.Service, orderSvc *orders.Service, origin string) *WSHandler {
	return &WSHandler{
		bus:      bus,
		authSvc:  authSvc,
		account:  accountSvc,
		orderSvc: orderSvc,
		origin:   origin,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return allowOrigin(r, origin) },
		},
	}
}

type wsControlMessage struct {
	Type    string `json:"type"`
	Enabled *bool  `json:"enabled,omitempty"`
}

type accountMetricsWS struct {
	Balance     string `json:"balance"`
	Equity      string `json:"equity"`
	Margin      string `json:"margin"`
	FreeMargin  string `json:"free_margin"`
	MarginLevel string `json:"margin_level"`
	PL          string `json:"pl"`
}

type accountSnapshotWS struct {
	AccountID string            `json:"account_id"`
	PL        string            `json:"pl"`
	OpenCount int               `json:"open_count"`
	Metrics   *accountMetricsWS `json:"metrics,omitempty"`
}

type accountSnapshotsPayload struct {
	Items []accountSnapshotWS `json:"items"`
	TS    int64               `json:"ts"`
}

func (h *WSHandler) collectAccountSnapshots(ctx context.Context, userID string) (accountSnapshotsPayload, error) {
	out := accountSnapshotsPayload{Items: make([]accountSnapshotWS, 0, 4), TS: time.Now().UnixMilli()}
	if h.account == nil || h.orderSvc == nil {
		return out, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	accountsList, err := h.account.List(ctx, userID)
	if err != nil {
		return out, err
	}

	for _, acc := range accountsList {
		entry := accountSnapshotWS{
			AccountID: acc.ID,
			PL:        "0",
			OpenCount: 0,
		}

		metrics, metricsErr := h.orderSvc.GetAccountMetricsByAccount(ctx, userID, acc.ID)
		if metricsErr == nil {
			entry.PL = metrics.PnL.String()
			entry.Metrics = &accountMetricsWS{
				Balance:     metrics.Balance.String(),
				Equity:      metrics.Equity.String(),
				Margin:      metrics.Margin.String(),
				FreeMargin:  metrics.FreeMargin.String(),
				MarginLevel: metrics.MarginLevel.String(),
				PL:          metrics.PnL.String(),
			}
		}

		openOrders, ordersErr := h.orderSvc.ListOpenOrdersByAccount(ctx, userID, acc.ID)
		if ordersErr == nil {
			count := 0
			for _, o := range openOrders {
				if o.Status == types.OrderStatusFilled {
					count++
				}
			}
			entry.OpenCount = count
		}

		out.Items = append(out.Items, entry)
	}
	return out, nil
}

func allowOrigin(r *http.Request, origin string) bool {
	if origin == "*" {
		return true
	}
	reqOrigin := r.Header.Get("Origin")
	// Allow both localhost and 127.0.0.1 variants for development
	if strings.Contains(origin, "localhost") || strings.Contains(origin, "127.0.0.1") {
		if strings.Contains(reqOrigin, "localhost") || strings.Contains(reqOrigin, "127.0.0.1") {
			return true
		}
	}
	return strings.EqualFold(reqOrigin, origin)
}

func (h *WSHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1. Authenticate via Query Param (standard for browser WS)
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}
	userID, err := h.authSvc.ParseToken(token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	// 2. Upgrade
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	sub := h.bus.Subscribe()
	defer h.bus.Unsubscribe(sub)
	var snapshotsMu sync.RWMutex
	snapshotsEnabled := false
	lastSnapshotAt := time.Time{}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			_, payload, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var ctrl wsControlMessage
			if err := json.Unmarshal(payload, &ctrl); err != nil {
				continue
			}
			switch strings.ToLower(strings.TrimSpace(ctrl.Type)) {
			case "account_snapshots_subscribe", "accounts_snapshot_subscribe":
				next := true
				if ctrl.Enabled != nil {
					next = *ctrl.Enabled
				}
				snapshotsMu.Lock()
				snapshotsEnabled = next
				snapshotsMu.Unlock()
			case "account_snapshots_unsubscribe", "accounts_snapshot_unsubscribe":
				snapshotsMu.Lock()
				snapshotsEnabled = false
				snapshotsMu.Unlock()
			}
		}
	}()
	for {
		select {
		case evt := <-sub:
			if err := conn.WriteJSON(evt); err != nil {
				return
			}
			if evt.Type == "quote" {
				snapshotsMu.RLock()
				enabled := snapshotsEnabled
				snapshotsMu.RUnlock()
				if !enabled {
					continue
				}
				if !lastSnapshotAt.IsZero() && time.Since(lastSnapshotAt) < 200*time.Millisecond {
					continue
				}
				payload, err := h.collectAccountSnapshots(context.Background(), userID)
				if err == nil {
					if err := conn.WriteJSON(marketdata.Event{Type: "account_snapshots", Data: payload}); err != nil {
						return
					}
					lastSnapshotAt = time.Now()
				}
			}
		case <-done:
			return
		}
	}
}

// EventsWSHandler - WebSocket for admin event_state updates (no auth required)
type EventsWSHandler struct {
	bus      *marketdata.Bus
	origin   string
	upgrader websocket.Upgrader
}

func NewEventsWSHandler(bus *marketdata.Bus, origin string) *EventsWSHandler {
	return &EventsWSHandler{
		bus:    bus,
		origin: origin,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return allowOrigin(r, origin) },
		},
	}
}

func (h *EventsWSHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	sub := h.bus.Subscribe()
	defer h.bus.Unsubscribe(sub)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
	for {
		select {
		case evt := <-sub:
			// Only send event_state messages
			if evt.Type == "event_state" {
				if err := conn.WriteJSON(evt); err != nil {
					return
				}
			}
		case <-done:
			return
		}
	}
}
