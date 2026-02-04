package marketdata

import (
	"errors"
	"math"
	"strconv"
	"time"
)

type Candle struct {
	Time  int64  `json:"time"`
	Open  string `json:"open"`
	High  string `json:"high"`
	Low   string `json:"low"`
	Close string `json:"close"`
}

type CandleParams struct {
	Pair      string
	Interval  time.Duration
	Limit     int
	Now       time.Time
	PrevClose *float64
}

type pairProfile struct {
	Base   float64
	Vol    float64
	Prec   int
	Spread float64 // Fixed spread for simplicity
}

var pairProfiles = map[string]pairProfile{
	"UZS-USD": {Base: 1.0 / 12350.0, Vol: 0.0005, Prec: 11, Spread: 0.000000007},
	"XAUUSD":  {Base: 2710.0, Vol: 0.008, Prec: 2, Spread: 0.35},    // 35 cents spread
	"BTCUSD":  {Base: 68500.0, Vol: 0.015, Prec: 2, Spread: 25.0},   // $25 spread
	"EURUSD":  {Base: 1.0850, Vol: 0.004, Prec: 5, Spread: 0.00015}, // 1.5 pips
}

func GetProfile(pair string) (pairProfile, bool) {
	p, ok := pairProfiles[pair]
	return p, ok
}

// Helper to get current Bid/Ask
func GetCurrentQuote(pair string) (bid, ask float64, err error) {
	p, ok := pairProfiles[pair]
	if !ok {
		return 0, 0, errors.New("pair not found")
	}
	candle, err := LiveCandle(CandleParams{Pair: pair, Interval: time.Minute, Limit: 1})
	if err != nil {
		return 0, 0, err
	}
	price, _ := strconv.ParseFloat(candle.Close, 64)

	// Candle Close is usually Bid in charts
	bid = price
	ask = price + p.Spread
	return bid, ask, nil
}

func Candles(p CandleParams) ([]Candle, error) {
	if p.Interval <= 0 {
		return nil, errors.New("invalid interval")
	}
	profile, ok := pairProfiles[p.Pair]
	if !ok {
		if p.Pair == "UZS-USD" {
			profile = pairProfile{Base: 1.0 / 12350.0, Vol: 0.0005, Prec: 10}
		} else {
			profile = pairProfile{Base: 100.0, Vol: 0.0001, Prec: 2}
		}
	}
	limit := p.Limit
	if limit <= 0 {
		limit = 200
	}
	if limit > 2000 {
		limit = 2000
	}

	now := p.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}

	stepSec := int64(p.Interval.Seconds())
	if stepSec < 1 {
		stepSec = 1
	}

	endTick := now.Unix()
	endTick = endTick - (endTick % stepSec)
	startTick := endTick - int64(limit-1)*stepSec

	candles := make([]Candle, 0, limit)

	// History Generation
	// Use macro trend + local random walk
	seed := hashString(p.Pair)

	// Determine start price from macro trend
	currentPrice := getPriceAtTime(seed, startTick, profile)

	for t := startTick; t <= endTick; t += stepSec {
		open := currentPrice
		high := open
		low := open
		closePx := open

		// Simulate simulation steps inside the candle for High/Low wicks
		steps := 4
		candleSeed := seed + t

		for i := 1; i <= steps; i++ {
			// Volatility scaling: approximate sigma for duration stepSec/steps
			// Vol is roughly "daily log return stddev" or similar
			// Here we just use a tuned factor
			change := randNorm(candleSeed+int64(i)*13) * (profile.Vol * 0.1)
			closePx = closePx * math.Exp(change)

			if closePx > high {
				high = closePx
			}
			if closePx < low {
				low = closePx
			}
		}

		candles = append(candles, Candle{
			Time:  t,
			Open:  formatPrice(open, profile.Prec),
			High:  formatPrice(high, profile.Prec),
			Low:   formatPrice(low, profile.Prec),
			Close: formatPrice(closePx, profile.Prec),
		})

		currentPrice = closePx
	}

	return candles, nil
}

func LiveCandle(p CandleParams) (Candle, error) {
	if p.Interval <= 0 {
		return Candle{}, errors.New("invalid interval")
	}
	profile, ok := pairProfiles[p.Pair]
	if !ok {
		if p.Pair == "UZS-USD" {
			profile = pairProfile{Base: 1.0 / 12350.0, Vol: 0.0005, Prec: 10}
		} else {
			profile = pairProfile{Base: 100.0, Vol: 0.0001, Prec: 2}
		}
	}

	now := p.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}

	stepSec := int64(p.Interval.Seconds())
	if stepSec < 1 {
		stepSec = 1
	}

	bucketStart := now.Unix() - (now.Unix() % stepSec)

	// Anchor candle start using PrevClose if available
	startPrice := profile.Base
	if p.PrevClose != nil {
		startPrice = *p.PrevClose
	} else {
		// Fallback to macro gen
		seed := hashString(p.Pair)
		startPrice = getPriceAtTime(seed, bucketStart, profile)
	}

	open := startPrice
	high := open
	low := open
	current := open

	// Deterministic Seed for this specific minute bucket
	bucketSeed := hashString(p.Pair) + bucketStart

	elapsed := now.Unix() - bucketStart
	if elapsed < 0 {
		elapsed = 0
	}

	// Replay monotonic random walk from t=0 to t=now
	for i := int64(1); i <= elapsed; i++ {
		// Unique seed for this second
		tickSeed := bucketSeed + i*7919
		change := randNorm(tickSeed) * (profile.Vol * 0.02) // Scaled vol for 1s
		current = current * math.Exp(change)

		if current > high {
			high = current
		}
		if current < low {
			low = current
		}
	}

	nano := now.Nanosecond()
	subBlock := int64(nano / 250000000) // 0, 1, 2, 3

	jitterSeed := bucketSeed + elapsed*999 + subBlock

	jitter := randNorm(jitterSeed) * (profile.Vol * 0.005)
	realTime := current * math.Exp(jitter)

	if realTime > high {
		high = realTime
	}
	if realTime < low {
		low = realTime
	}

	return Candle{
		Time:  bucketStart,
		Open:  formatPrice(open, profile.Prec),
		High:  formatPrice(high, profile.Prec),
		Low:   formatPrice(low, profile.Prec),
		Close: formatPrice(realTime, profile.Prec),
	}, nil
}

// Macro-Trend Function
func getPriceAtTime(seed int64, t int64, p pairProfile) float64 {
	// Base price modulated by sine waves
	ft := float64(t)
	day := 86400.0

	w1 := math.Sin(ft/(day*30)) * 0.10
	w2 := math.Cos(ft/(day*7)) * 0.05

	// Add some random walk noise component "offset"
	// We can't do true RW here statelessly, but we can simulate it with Perlin
	offset := randNorm(seed+t/3600) * 0.02

	return p.Base * (1.0 + w1 + w2 + offset)
}

func randNorm(seed int64) float64 {
	u1 := rand01(seed)
	u2 := rand01(seed ^ 0x5DEECE66D)
	if u1 < 1e-9 {
		u1 = 1e-9
	}
	return math.Sqrt(-2.0*math.Log(u1)) * math.Cos(2.0*math.Pi*u2)
}

func rand01(seed int64) float64 {
	x := uint64(seed)
	x = (x << 13) ^ x
	x = (x*(x*x*15731+789221) + 1376312589)
	return float64(x&0x7fffffff) / 2147483648.0
}

func hashString(s string) int64 {
	h := int64(5381)
	for i := 0; i < len(s); i++ {
		h = ((h << 5) + h) + int64(s[i])
	}
	return h
}

func formatPrice(v float64, prec int) string {
	return strconv.FormatFloat(v, 'f', prec, 64)
}
