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
	EndPrice  *float64
}

type pairProfile struct {
	Base   float64
	Vol    float64
	Prec   int
	Spread float64 // Fixed spread for simplicity
}

var pairProfiles = map[string]pairProfile{
	"UZS-USD": {Base: 1.0 / 12850.0, Vol: 0.00005, Prec: 11, Spread: 0.0000000023},
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
	if liveBid, liveAsk, ok := getLiveQuote(pair); ok {
		return liveBid, liveAsk, nil
	}

	// Fallback to the shared 1m candle cache (same stream as publisher/chart).
	// If live quote is not ready yet, use mid=bid=ask to avoid a second price engine.
	key := pair + "|1m"
	candlesByTF.mu.Lock()
	base := candlesByTF.items[key]
	candlesByTF.mu.Unlock()
	if len(base) > 0 {
		last := base[len(base)-1]
		price, parseErr := strconv.ParseFloat(last.Close, 64)
		if parseErr == nil && price > 0 {
			return price, price, nil
		}
	}

	return 0, 0, errors.New("live quote not ready")
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

	candles := make([]Candle, limit)

	// If EndPrice is provided, generate BACKWARDS from it to ensure continuity
	if p.EndPrice != nil {
		currentPrice := *p.EndPrice
		seed := hashString(p.Pair)

		for i := limit - 1; i >= 0; i-- {
			t := startTick + int64(i)*stepSec
			candleSeed := seed + t

			// Calculate Open from Close using inverse drift
			// We assume simple volatility model: Close = Open * exp(change)
			// So Open = Close * exp(-change)
			// dailyChange := randNorm(candleSeed) * profile.Vol
			// If using multi-step simulation in forward, we approximate it here for speed/symmetry
			// Or we can simulate steps inverse? Let's use single step for macro alignment

			// Replicate the forward volatility scaling
			// Forward: change := randNorm * (vol * 0.1) * steps?
			// The forward loop used 4 steps of (vol * 0.1).
			// Variance sum = 4 * (0.1^2) = 0.04. StdDev scale = 0.2
			// Let's just use a single aggregated step for the reversal to keep it stable
			change := randNorm(candleSeed+100) * (profile.Vol * 0.2) // Aggregate change

			open := currentPrice * math.Exp(-change)

			// Generate High/Low relative to Open/Close
			high := math.Max(open, currentPrice)
			low := math.Min(open, currentPrice)

			// Add some wick noise
			wick := randNorm(candleSeed+200) * (profile.Vol * 0.05)
			if wick > 0 {
				high *= (1 + wick)
			} else {
				low *= (1 + wick)
			}

			candles[i] = Candle{
				Time:  t,
				Open:  formatPrice(open, profile.Prec),
				High:  formatPrice(high, profile.Prec),
				Low:   formatPrice(low, profile.Prec),
				Close: formatPrice(currentPrice, profile.Prec),
			}
			currentPrice = open
		}
		return candles, nil
	}

	// Forward Generation (Fallback or explicit start)
	seed := hashString(p.Pair)
	currentPrice := getPriceAtTime(seed, startTick, profile)

	for i := 0; i < limit; i++ {
		t := startTick + int64(i)*stepSec
		open := currentPrice
		high := open
		low := open
		closePx := open

		steps := 4
		candleSeed := seed + t

		for i := 1; i <= steps; i++ {
			change := randNorm(candleSeed+int64(i)*13) * (profile.Vol * 0.1)
			closePx = closePx * math.Exp(change)
			if closePx > high {
				high = closePx
			}
			if closePx < low {
				low = closePx
			}
		}

		candles[i] = Candle{
			Time:  t,
			Open:  formatPrice(open, profile.Prec),
			High:  formatPrice(high, profile.Prec),
			Low:   formatPrice(low, profile.Prec),
			Close: formatPrice(closePx, profile.Prec),
		}
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

// GenerateInitialCandles creates historical candles for a pair
// Produces realistic OHLC data with proper continuity (Open = Previous Close)
func GenerateInitialCandles(pair string, count int) []Candle {
	now := time.Now().Unix()
	// Each candle is 1 minute (60 seconds)
	startTime := (now/60)*60 - int64(count-1)*60

	profile, ok := pairProfiles[pair]
	if !ok {
		profile = pairProfile{Base: 0.00008, Vol: 0.0005, Prec: 8}
	}

	candles := make([]Candle, count)
	// Start price and track Close for next candle's Open
	currentPrice := profile.Base
	prevClose := currentPrice

	for i := 0; i < count; i++ {
		t := startTime + int64(i)*60
		// Deterministic seed per candle index for consistency
		seed := hashString(pair) + int64(i*7919)

		// Open = Previous candle's Close (ensures continuity)
		open := prevClose

		// Simulate intra-candle price movement (4 ticks within the minute)
		high := open
		low := open
		current := open

		for tick := 0; tick < 4; tick++ {
			tickSeed := seed + int64(tick*1337)
			// Random walk per tick
			change := randNorm(tickSeed) * profile.Vol * 0.15
			current = current * (1 + change)
			if current <= 0 {
				current = open
			}
			if current > high {
				high = current
			}
			if current < low {
				low = current
			}
		}

		// Close is the final price after intra-candle simulation
		closePrice := current

		// Ensure OHLC validity
		if high < open {
			high = open
		}
		if high < closePrice {
			high = closePrice
		}
		if low > open {
			low = open
		}
		if low > closePrice {
			low = closePrice
		}

		candles[i] = Candle{
			Time:  t,
			Open:  formatPrice(open, profile.Prec),
			High:  formatPrice(high, profile.Prec),
			Low:   formatPrice(low, profile.Prec),
			Close: formatPrice(closePrice, profile.Prec),
		}

		// Set prevClose for next iteration's Open
		prevClose = closePrice
		currentPrice = closePrice
	}

	return candles
}
