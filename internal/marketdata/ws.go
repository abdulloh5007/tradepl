package marketdata

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Quote struct {
	Type      string `json:"type"`
	Pair      string `json:"pair"`
	Bid       string `json:"bid"`
	Ask       string `json:"ask"`
	Spread    string `json:"spread"`
	Timestamp int64  `json:"ts"`
}

type MarketWS struct {
	origin   string
	upgrader websocket.Upgrader
}

func NewMarketWS(origin string) *MarketWS {
	return &MarketWS{origin: origin, upgrader: websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return allowOrigin(r, origin) }}}
}

func (h *MarketWS) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	pair := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("pair")))
	if pair == "" {
		pair = "UZS-USD"
	}
	interval := 250 * time.Millisecond
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
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
		case <-ticker.C:
			bid, ask, spread := liveQuote(pair)
			msg := Quote{Type: "quote", Pair: pair, Bid: bid, Ask: ask, Spread: spread, Timestamp: time.Now().UTC().Unix()}
			if err := conn.WriteJSON(msg); err != nil {
				return
			}
		case <-done:
			return
		}
	}
}

func liveQuote(pair string) (string, string, string) {
	candles, err := Candles(CandleParams{Pair: pair, Interval: time.Minute, Limit: 1, Now: time.Now().UTC()})
	if err != nil || len(candles) == 0 {
		return "0", "0", "0"
	}
	profile, ok := pairProfiles[pair]
	if !ok {
		return "0", "0", "0"
	}
	price := candles[0].Close
	spread := profile.Vol * 0.8
	bid := priceToFloat(price) - spread
	ask := priceToFloat(price) + spread
	return formatPrice(bid, profile.Prec), formatPrice(ask, profile.Prec), formatPrice(spread, profile.Prec)
}

func allowOrigin(r *http.Request, origin string) bool {
	if origin == "*" {
		return true
	}
	return strings.EqualFold(r.Header.Get("Origin"), origin)
}

func priceToFloat(v string) float64 {
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return 0
	}
	return f
}

type CandleMessage struct {
	Type      string   `json:"type"`
	Pair      string   `json:"pair"`
	Timeframe string   `json:"timeframe"`
	Candles   []Candle `json:"candles,omitempty"`
	Candle    *Candle  `json:"candle,omitempty"`
	Timestamp int64    `json:"ts"`
}

type CandleWS struct {
	origin   string
	upgrader websocket.Upgrader
	store    *CandleStore
}

func NewCandleWS(origin string, store *CandleStore) *CandleWS {
	return &CandleWS{origin: origin, store: store, upgrader: websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return allowOrigin(r, origin) }}}
}

type candleCache struct {
	mu       sync.Mutex
	items    map[string][]Candle
	lastSave map[string]time.Time
	lastTime map[string]int64
}

var candlesByTF = candleCache{items: map[string][]Candle{}, lastSave: map[string]time.Time{}, lastTime: map[string]int64{}}

func (h *CandleWS) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	pair := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("pair")))
	if pair == "" {
		pair = "UZS-USD"
	}
	profile, ok := pairProfiles[pair]
	if !ok {
		return
	}
	tf := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("timeframe")))
	interval := parseInterval(tf)
	if interval == 0 {
		return
	}
	limit := 1
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	baseKey := pair + "|1m"
	key := pair + "|" + tf
	var snapshot []Candle
	candlesByTF.mu.Lock()
	snapshot = candlesByTF.items[key]
	candlesByTF.mu.Unlock()
	if len(snapshot) == 0 {
		if interval == time.Minute {
			if h.store != nil {
				if loaded, err := h.store.LoadRecent(key, limit, profile.Prec); err == nil && len(loaded) > 0 {
					snapshot = loaded
				}
			}
			if len(snapshot) == 0 {
				var err error
				snapshot, err = Candles(CandleParams{Pair: pair, Interval: interval, Limit: 1, Now: time.Now().UTC()})
				if err != nil {
					return
				}
			}
			candlesByTF.mu.Lock()
			candlesByTF.items[key] = snapshot
			candlesByTF.mu.Unlock()
		} else {
			var base []Candle
			candlesByTF.mu.Lock()
			base = candlesByTF.items[baseKey]
			candlesByTF.mu.Unlock()
			if len(base) == 0 && h.store != nil {
				if loaded, err := h.store.LoadRecent(baseKey, 1, profile.Prec); err == nil && len(loaded) > 0 {
					base = loaded
				}
			}
			if len(base) == 0 {
				var err error
				base, err = Candles(CandleParams{Pair: pair, Interval: time.Minute, Limit: 1, Now: time.Now().UTC()})
				if err != nil {
					return
				}
				candlesByTF.mu.Lock()
				candlesByTF.items[baseKey] = base
				candlesByTF.mu.Unlock()
			}
			snapshot = trimCandles(aggregateCandles(base, interval, profile.Prec), limit)
			candlesByTF.mu.Lock()
			candlesByTF.items[key] = snapshot
			candlesByTF.mu.Unlock()
		}
	}
	initMsg := CandleMessage{Type: "snapshot", Pair: pair, Timeframe: tf, Candles: snapshot, Timestamp: time.Now().UTC().Unix()}
	if err := conn.WriteJSON(initMsg); err != nil {
		return
	}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
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
		case <-ticker.C:
			now := time.Now().UTC()
			bucket := now.Unix()
			bucket = bucket - (bucket % 60)
			var prev *float64
			candlesByTF.mu.Lock()
			base := candlesByTF.items[baseKey]
			if len(base) > 0 {
				last := base[len(base)-1]
				if last.Time == bucket {
					value := priceToFloat(last.Open)
					prev = &value
				} else {
					value := priceToFloat(last.Close)
					prev = &value
				}
			}
			candlesByTF.mu.Unlock()
			latest, err := LiveCandle(CandleParams{Pair: pair, Interval: time.Minute, Now: now, PrevClose: prev})
			if err != nil {
				continue
			}
			candlesByTF.mu.Lock()
			base = candlesByTF.items[baseKey]
			if len(base) == 0 {
				base = []Candle{latest}
			} else {
				last := base[len(base)-1]
				if latest.Time > last.Time {
					if h.store != nil {
						if err := h.store.Append(baseKey, last); err == nil {
							candlesByTF.lastTime[baseKey] = last.Time
						}
					}
					base = append(base, latest)
					if len(base) > 5000 {
						base = base[len(base)-5000:]
					}
				} else if latest.Time == last.Time {
					base[len(base)-1] = latest
				}
			}
			candlesByTF.items[baseKey] = base
			var current []Candle
			var outLatest Candle
			if interval == time.Minute {
				current = base
				outLatest = latest
			} else {
				current = trimCandles(aggregateCandles(base, interval, profile.Prec), limit)
				if len(current) > 0 {
					outLatest = current[len(current)-1]
				}
			}
			candlesByTF.items[key] = current
			now = time.Now().UTC()
			candlesByTF.lastSave[baseKey] = now
			candlesByTF.lastSave[key] = now
			candlesByTF.mu.Unlock()
			if (outLatest != Candle{}) {
				msg := CandleMessage{Type: "candle", Pair: pair, Timeframe: tf, Candle: &outLatest, Timestamp: time.Now().UTC().Unix()}
				if err := conn.WriteJSON(msg); err != nil {
					return
				}
			}
		case <-done:
			return
		}
	}
}
