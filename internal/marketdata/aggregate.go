package marketdata

import "time"

func aggregateCandles(base []Candle, interval time.Duration, prec int) []Candle {
	if interval <= time.Minute {
		out := make([]Candle, len(base))
		copy(out, base)
		return out
	}
	step := int64(interval.Seconds())
	if step <= 0 || len(base) == 0 {
		return nil
	}
	out := make([]Candle, 0, len(base))
	var bucket int64 = -1
	var open, high, low, close float64
	for _, c := range base {
		b := c.Time - (c.Time % step)
		o := priceToFloat(c.Open)
		h := priceToFloat(c.High)
		l := priceToFloat(c.Low)
		cl := priceToFloat(c.Close)
		if bucket != b {
			if bucket >= 0 {
				out = append(out, Candle{
					Time:  bucket,
					Open:  formatPrice(open, prec),
					High:  formatPrice(high, prec),
					Low:   formatPrice(low, prec),
					Close: formatPrice(close, prec),
				})
			}
			bucket = b
			open = o
			high = h
			low = l
			close = cl
			continue
		}
		if h > high {
			high = h
		}
		if l < low {
			low = l
		}
		close = cl
	}
	if bucket >= 0 {
		out = append(out, Candle{
			Time:  bucket,
			Open:  formatPrice(open, prec),
			High:  formatPrice(high, prec),
			Low:   formatPrice(low, prec),
			Close: formatPrice(close, prec),
		})
	}
	return out
}

func trimCandles(candles []Candle, limit int) []Candle {
	if limit <= 0 || len(candles) <= limit {
		return candles
	}
	return candles[len(candles)-limit:]
}
