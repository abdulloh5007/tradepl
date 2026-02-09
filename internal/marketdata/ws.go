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
	Last      string `json:"last"`
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
			// Single source of truth: use unified quote provider.
			bidVal, askVal, err := GetCurrentQuote(pair)
			if err != nil {
				continue
			}

			spreadVal := askVal - bidVal

			// Format
			profile, ok := pairProfiles[pair]
			prec := 5 // Default high precision
			if ok {
				prec = profile.Prec
			} else {
				// Heuristic for unknown pairs
				if askVal < 1.0 {
					prec = 8
				}
			}

			// Log for debugging (temporary)
			// fmt.Printf("Quote: %s Bid=%f Ask=%f Prec=%d\n", pair, bidVal, askVal, prec)

			msg := Quote{
				Type:      "quote",
				Pair:      pair,
				Bid:       formatPrice(bidVal, prec),
				Ask:       formatPrice(askVal, prec),
				Spread:    formatPrice(spreadVal, prec),
				Timestamp: time.Now().UTC().Unix(),
			}
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
	reqOrigin := r.Header.Get("Origin")
	// Allow both localhost and 127.0.0.1 variants for development
	if strings.Contains(origin, "localhost") || strings.Contains(origin, "127.0.0.1") {
		if strings.Contains(reqOrigin, "localhost") || strings.Contains(reqOrigin, "127.0.0.1") {
			return true
		}
	}
	return strings.EqualFold(reqOrigin, origin)
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
	limit := 500
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
		now := time.Now().UTC()
		bucket := now.Unix()
		bucket = bucket - (bucket % 60)
		if interval == time.Minute {
			if h.store != nil && h.store.IsEmpty() {
				seed, err := Candles(CandleParams{Pair: pair, Interval: time.Minute, Limit: 600, Now: now})
				if err != nil {
					return
				}
				stored := seed
				if len(seed) > 0 && seed[len(seed)-1].Time == bucket {
					stored = seed[:len(seed)-1]
				}
				_ = h.store.SeedIfEmpty(baseKey, stored)
				candlesByTF.mu.Lock()
				candlesByTF.items[baseKey] = seed
				candlesByTF.mu.Unlock()
			}
			hasStored := false
			if h.store != nil {
				if loaded, err := h.store.LoadRecent(key, limit, profile.Prec); err == nil && len(loaded) > 0 {
					snapshot = loaded
					hasStored = true
				}
			}
			if len(snapshot) == 0 {
				var err error
				seedLimit := 1
				if hasStored {
					seedLimit = limit
				}
				snapshot, err = Candles(CandleParams{Pair: pair, Interval: interval, Limit: seedLimit, Now: time.Now().UTC()})
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
			if len(base) == 0 && h.store != nil && h.store.IsEmpty() {
				seed, err := Candles(CandleParams{Pair: pair, Interval: time.Minute, Limit: 600, Now: now})
				if err != nil {
					return
				}
				stored := seed
				if len(seed) > 0 && seed[len(seed)-1].Time == bucket {
					stored = seed[:len(seed)-1]
				}
				_ = h.store.SeedIfEmpty(baseKey, stored)
				base = seed
				candlesByTF.mu.Lock()
				candlesByTF.items[baseKey] = seed
				candlesByTF.mu.Unlock()
			}
			hasStored := false
			if len(base) == 0 && h.store != nil {
				if loaded, err := h.store.LoadRecent(baseKey, limit, profile.Prec); err == nil && len(loaded) > 0 {
					base = loaded
					hasStored = true
				}
			}
			if len(base) == 0 {
				var err error
				seedLimit := 1
				if hasStored {
					seedLimit = limit
				}
				base, err = Candles(CandleParams{Pair: pair, Interval: time.Minute, Limit: seedLimit, Now: time.Now().UTC()})
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
