package marketdata

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"lv-tradepl/internal/httputil"
)

type Handler struct {
	WS       *MarketWS
	CandleWS *CandleWS
}

func NewHandler(ws *MarketWS, candleWS *CandleWS) *Handler {
	return &Handler{WS: ws, CandleWS: candleWS}
}

func (h *Handler) Candles(w http.ResponseWriter, r *http.Request) {
	pair := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("pair")))
	if pair == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "pair is required"})
		return
	}
	interval := parseInterval(r.URL.Query().Get("timeframe"))
	if interval == 0 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid timeframe"})
		return
	}
	profile, ok := pairProfiles[pair]
	if !ok {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "pair not supported"})
		return
	}
	limit := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	if limit <= 0 {
		limit = 500
	}

	// Parse 'before' parameter for lazy loading (unix seconds)
	var before int64 = 0
	if v := r.URL.Query().Get("before"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			before = n
		}
	}

	// ЕДИНСТВЕННЫЙ ИСТОЧНИК - 1м кэш. Без генерации новой истории!
	key := pair + "|1m"
	candlesByTF.mu.Lock()
	cached := candlesByTF.items[key]
	candlesByTF.mu.Unlock()

	// Для 1м - отдаем как есть
	if interval == time.Minute {
		result := cached
		// Filter by 'before' if provided
		if before > 0 {
			filtered := make([]Candle, 0)
			for _, c := range result {
				if c.Time < before {
					filtered = append(filtered, c)
				}
			}
			result = filtered
		}
		if len(result) > limit {
			result = result[len(result)-limit:]
		}
		httputil.WriteJSON(w, http.StatusOK, result)
		return
	}

	// Для других таймфреймов - агрегируем из 1м (никакой генерации!)
	agg := aggregateCandles(cached, interval, profile.Prec)
	// Filter by 'before' if provided
	if before > 0 {
		filtered := make([]Candle, 0)
		for _, c := range agg {
			if c.Time < before {
				filtered = append(filtered, c)
			}
		}
		agg = filtered
	}
	if len(agg) > limit {
		agg = agg[len(agg)-limit:]
	}
	httputil.WriteJSON(w, http.StatusOK, agg)
}

func parseInterval(v string) time.Duration {
	s := strings.ToLower(strings.TrimSpace(v))
	switch s {
	case "1m":
		return time.Minute
	case "5m":
		return 5 * time.Minute
	case "10m":
		return 10 * time.Minute
	case "15m":
		return 15 * time.Minute
	case "30m":
		return 30 * time.Minute
	case "1h":
		return time.Hour
	default:
		return 0
	}
}
