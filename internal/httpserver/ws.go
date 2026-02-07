package httpserver

import (
	"net/http"
	"strings"

	"lv-tradepl/internal/auth"
	"lv-tradepl/internal/marketdata"

	"github.com/gorilla/websocket"
)

type WSHandler struct {
	bus      *marketdata.Bus
	authSvc  *auth.Service
	origin   string
	upgrader websocket.Upgrader
}

func NewWSHandler(bus *marketdata.Bus, authSvc *auth.Service, origin string) *WSHandler {
	return &WSHandler{
		bus:     bus,
		authSvc: authSvc,
		origin:  origin,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return allowOrigin(r, origin) },
		},
	}
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
	_, err := h.authSvc.ParseToken(token)
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
			if err := conn.WriteJSON(evt); err != nil {
				return
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
