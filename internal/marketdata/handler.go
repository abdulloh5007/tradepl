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
		limit = 1
	}
	outLimit := limit
	if interval == time.Minute {
		candles, err := Candles(CandleParams{Pair: pair, Interval: interval, Limit: limit, Now: time.Now().UTC()})
		if err != nil {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
			return
		}
		httputil.WriteJSON(w, http.StatusOK, candles)
		return
	}
	factor := int(interval / time.Minute)
	baseLimit := outLimit * factor
	if baseLimit < outLimit {
		baseLimit = outLimit
	}
	if baseLimit > 5000 {
		baseLimit = 5000
	}
	base, err := Candles(CandleParams{Pair: pair, Interval: time.Minute, Limit: baseLimit, Now: time.Now().UTC()})
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	agg := aggregateCandles(base, interval, profile.Prec)
	agg = trimCandles(agg, outLimit)
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
