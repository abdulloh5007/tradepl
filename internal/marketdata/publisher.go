package marketdata

import (
	"log"
	"strconv"
	"time"
)

// StartPublisher starts a background goroutine that generates quotes and candles
// and publishes them to the bus for all connected WebSocket clients
func StartPublisher(bus *Bus, pair string, dir string) {
	store := NewCandleStore(dir)
	key := pair + "|1m"

	// Load or generate initial candles
	profile, ok := pairProfiles[pair]
	prec := 8
	if ok {
		prec = profile.Prec
	}

	candles, err := store.LoadRecent(key, 500, prec)
	if err != nil || len(candles) == 0 {
		log.Printf("[Publisher] Generating 500 historical candles for %s", pair)
		candles = GenerateInitialCandles(pair, 500)
		if err := store.SeedIfEmpty(key, candles); err != nil {
			log.Printf("[Publisher] Error seeding candles: %v", err)
		}
	}

	// Initialize cache
	candlesByTF.mu.Lock()
	candlesByTF.items[key] = candles
	candlesByTF.mu.Unlock()

	// Get last price from candles for continuity
	var lastPrice float64
	if len(candles) > 0 {
		lastPrice, _ = strconv.ParseFloat(candles[len(candles)-1].Close, 64)
	}
	if lastPrice == 0 {
		lastPrice = profile.Base
	}

	log.Printf("[Publisher] Starting with %d candles for %s, last price: %v", len(candles), pair, lastPrice)

	go func() {
		ticker := time.NewTicker(250 * time.Millisecond) // 4 updates per second for smooth animation
		defer ticker.Stop()

		currentPrice := lastPrice

		for range ticker.C {
			// Small random walk from current price
			change := (randNorm(time.Now().UnixNano()) * profile.Vol * 0.05)
			currentPrice = currentPrice * (1 + change)

			// Keep price bounded
			if currentPrice <= 0 {
				currentPrice = profile.Base
			}

			// Calculate bid/ask from current price
			spread := profile.Spread
			if spread == 0 {
				spread = currentPrice * 0.0001
			}
			bid := currentPrice
			ask := currentPrice + spread

			// Publish quote
			quoteEvt := Quote{
				Type:      "quote",
				Pair:      pair,
				Bid:       formatFloatPrec(bid, prec),
				Ask:       formatFloatPrec(ask, prec),
				Spread:    formatFloatPrec(spread, prec),
				Timestamp: time.Now().UnixMilli(),
			}
			bus.Publish(Event{Type: "quote", Data: quoteEvt})

			// Check if we need to update/create candle
			now := time.Now().Unix()
			candleTime := (now / 60) * 60 // Round to minute

			candlesByTF.mu.Lock()
			existing := candlesByTF.items[key]

			closeStr := formatFloatPrec(currentPrice, prec)

			if len(existing) > 0 {
				last := &existing[len(existing)-1]
				if last.Time == candleTime {
					// Update existing candle
					last.Close = closeStr
					high, _ := strconv.ParseFloat(last.High, 64)
					low, _ := strconv.ParseFloat(last.Low, 64)
					if currentPrice > high {
						last.High = closeStr
					}
					if currentPrice < low {
						last.Low = closeStr
					}

					// Publish candle update
					bus.Publish(Event{Type: "candle", Data: *last})
				} else if candleTime > last.Time {
					// Create new candle - use PREVIOUS CLOSE as open for continuity
					prevClose := last.Close
					openPrice, _ := strconv.ParseFloat(prevClose, 64)
					highVal := currentPrice
					lowVal := currentPrice
					if openPrice > currentPrice {
						highVal = openPrice
						lowVal = currentPrice
					} else {
						highVal = currentPrice
						lowVal = openPrice
					}
					newCandle := Candle{
						Time:  candleTime,
						Open:  prevClose, // Open at previous close for continuity
						High:  formatFloatPrec(highVal, prec),
						Low:   formatFloatPrec(lowVal, prec),
						Close: closeStr,
					}
					candlesByTF.items[key] = append(existing, newCandle)
					go store.Append(key, newCandle)

					// Publish new candle
					bus.Publish(Event{Type: "candle", Data: newCandle})
				}
			} else {
				// First candle
				newCandle := Candle{
					Time:  candleTime,
					Open:  closeStr,
					High:  closeStr,
					Low:   closeStr,
					Close: closeStr,
				}
				candlesByTF.items[key] = []Candle{newCandle}
				go store.Append(key, newCandle)
				bus.Publish(Event{Type: "candle", Data: newCandle})
			}
			candlesByTF.mu.Unlock()
		}
	}()
}

func formatFloatPrec(v float64, prec int) string {
	return strconv.FormatFloat(v, 'f', prec, 64)
}
