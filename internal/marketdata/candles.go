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
	Base  float64
	Vol   float64
	Trend float64
	Prec  int
}

var pairProfiles = map[string]pairProfile{
	"UZS-USD": {Base: 1.0 / 12300.0, Vol: 0.00000000003, Trend: 0.000000000002, Prec: 8},
}

func Candles(p CandleParams) ([]Candle, error) {
	if p.Interval <= 0 {
		return nil, errors.New("invalid interval")
	}
	profile, ok := pairProfiles[p.Pair]
	if !ok {
		return nil, errors.New("pair not supported")
	}
	limit := p.Limit
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}
	now := p.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	step := int64(p.Interval.Seconds())
	end := now.Unix()
	end = end - (end % step)
	start := end - int64(limit-1)*step
	candles := make([]Candle, 0, limit)
	price := startPrice(profile, start, step)
	for t := start; t <= end; t += step {
		open := price
		price = evolvePrice(profile, t, price, step)
		close := price
		wHigh, wLow := wickRange(profile, t, open, close)
		candles = append(candles, Candle{
			Time:  t,
			Open:  formatPrice(open, profile.Prec),
			High:  formatPrice(wHigh, profile.Prec),
			Low:   formatPrice(wLow, profile.Prec),
			Close: formatPrice(close, profile.Prec),
		})
	}
	return candles, nil
}

func anchorPrice(p pairProfile, t int64) float64 {
	y := float64(t) / 86400.0
	cycle := 1 + 0.004*math.Sin(y/7.0) + 0.002*math.Sin(y/3.3)
	return p.Base * cycle
}

func startPrice(p pairProfile, bucketStart int64, step int64) float64 {
	origin := bucketStart - step*240
	price := p.Base
	for t := origin; t < bucketStart; t += step {
		price = evolvePrice(p, t, price, step)
	}
	return price
}

func evolvePrice(p pairProfile, t int64, prev float64, step int64) float64 {
	mu := anchorPrice(p, t)
	revert := (mu - prev) * 0.06
	vol := sessionVol(p, t)
	noise := (randNorm(t) * vol) * math.Sqrt(float64(step))
	trend := p.Trend * float64(step)
	price := prev + revert + noise + trend
	floor := p.Base * 0.6
	ceiling := p.Base * 1.6
	if price < floor {
		price = floor + math.Abs(noise)
	}
	if price > ceiling {
		price = ceiling - math.Abs(noise)
	}
	return price
}

func LiveCandle(p CandleParams) (Candle, error) {
	if p.Interval <= 0 {
		return Candle{}, errors.New("invalid interval")
	}
	profile, ok := pairProfiles[p.Pair]
	if !ok {
		return Candle{}, errors.New("pair not supported")
	}
	now := p.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	step := int64(p.Interval.Seconds())
	bucket := now.Unix()
	bucket = bucket - (bucket % step)
	open := startPrice(profile, bucket, step)
	if p.PrevClose != nil {
		open = *p.PrevClose
	}
	high := open
	low := open
	close := open
	subStep := int64(1)
	for t := bucket; t <= now.Unix(); t += subStep {
		close = evolvePrice(profile, t, close, subStep)
		if close > high {
			high = close
		}
		if close < low {
			low = close
		}
	}
	minTick := profile.Base * 0.00000005
	if math.Abs(close-open) < minTick {
		close = open + math.Copysign(minTick, randNorm(now.Unix())+0.000001)
		if close > high {
			high = close
		}
		if close < low {
			low = close
		}
	}
	return Candle{
		Time:  bucket,
		Open:  formatPrice(open, profile.Prec),
		High:  formatPrice(high, profile.Prec),
		Low:   formatPrice(low, profile.Prec),
		Close: formatPrice(close, profile.Prec),
	}, nil
}

func wickRange(p pairProfile, t int64, open, close float64) (float64, float64) {
	vol := sessionVol(p, t) * 2.0
	h := math.Max(open, close) + math.Abs(randNorm(t+11))*vol
	l := math.Min(open, close) - math.Abs(randNorm(t+29))*vol
	floor := p.Base * 0.5
	ceiling := p.Base * 1.8
	if h > ceiling {
		h = ceiling
	}
	if l < floor {
		l = floor
	}
	if l > h {
		l = h
	}
	return h, l
}

func sessionVol(p pairProfile, t int64) float64 {
	hour := int(time.Unix(t, 0).UTC().Hour())
	mult := 1.0
	switch {
	case hour >= 7 && hour < 11:
		mult = 1.6
	case hour >= 11 && hour < 13:
		mult = 1.3
	case hour >= 13 && hour < 17:
		mult = 2.0
	case hour >= 17 && hour < 20:
		mult = 1.5
	case hour >= 20 && hour < 23:
		mult = 1.1
	default:
		mult = 0.6
	}
	return p.Vol * mult
}

func randNorm(seed int64) float64 {
	u1 := rand01(seed + 17)
	u2 := rand01(seed + 71)
	return math.Sqrt(-2*math.Log(u1)) * math.Cos(2*math.Pi*u2)
}

func rand01(seed int64) float64 {
	x := uint64(seed)
	x ^= x << 13
	x ^= x >> 7
	x ^= x << 17
	return float64(x%1000000)/1000000 + 0.000001
}

func formatPrice(v float64, prec int) string {
	pow := math.Pow10(prec)
	v = math.Round(v*pow) / pow
	out := strconv.FormatFloat(v, 'f', prec, 64)
	for len(out) > 1 && out[len(out)-1] == '0' && out[len(out)-2] != '.' {
		out = out[:len(out)-1]
	}
	if out[len(out)-1] == '.' {
		out = out[:len(out)-1]
	}
	return out
}
