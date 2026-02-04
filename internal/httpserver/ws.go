package httpserver

import (
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
	"lv-tradepl/internal/marketdata"
)

type WSHandler struct {
	bus     *marketdata.Bus
	origin  string
	upgrader websocket.Upgrader
}

func NewWSHandler(bus *marketdata.Bus, origin string) *WSHandler {
	return &WSHandler{bus: bus, origin: origin, upgrader: websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return allowOrigin(r, origin) }}}
}

func allowOrigin(r *http.Request, origin string) bool {
	if origin == "*" {
		return true
	}
	return strings.EqualFold(r.Header.Get("Origin"), origin)
}

func (h *WSHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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
