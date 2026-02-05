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

	// Load or generate initial candles
	candles := store.ReadAll(pair, "1m")
	if len(candles) == 0 {
		log.Printf("[Publisher] Generating 500 historical candles for %s", pair)
		candles = GenerateInitialCandles(pair, 500)
		for _, c := range candles {
			store.Append(pair, "1m", c)
		}
	}

	// Initialize cache
	candlesByTF.mu.Lock()
	candlesByTF.items[pair+"|1m"] = candles
	candlesByTF.mu.Unlock()

	log.Printf("[Publisher] Starting with %d candles for %s", len(candles), pair)

	go func() {
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()

		for range ticker.C {
			// Get current quote
			bid, ask, err := GetCurrentQuote(pair)
			if err != nil {
				continue
			}
			spread := ask - bid

			profile, ok := pairProfiles[pair]
			prec := 8
			if ok {
				prec = profile.Precision
			}

			// Publish quote
			quoteEvt := Quote{
				Type:      "quote",
				Pair:      pair,
				Bid:       formatFloat(bid, prec),
				Ask:       formatFloat(ask, prec),
				Spread:    formatFloat(spread, prec),
				Timestamp: time.Now().UnixMilli(),
			}
			bus.Publish(Event{Type: "quote", Data: quoteEvt})

			// Check if we need to update/create candle
			now := time.Now().Unix()
			candleTime := (now / 60) * 60 // Round to minute

			candlesByTF.mu.Lock()
			key := pair + "|1m"
			existing := candlesByTF.items[key]

			closePrice := (bid + ask) / 2
			closeStr := formatFloat(closePrice, prec)

			if len(existing) > 0 {
				last := &existing[len(existing)-1]
				if last.Time == candleTime {
					// Update existing candle
					last.Close = closeStr
					high, _ := strconv.ParseFloat(last.High, 64)
					low, _ := strconv.ParseFloat(last.Low, 64)
					if closePrice > high {
						last.High = closeStr
					}
					if closePrice < low {
						last.Low = closeStr
					}

					// Publish candle update
					bus.Publish(Event{Type: "candle", Data: *last})
				} else if candleTime > last.Time {
					// Create new candle
					newCandle := Candle{
						Time:  candleTime,
						Open:  closeStr,
						High:  closeStr,
						Low:   closeStr,
						Close: closeStr,
					}
					candlesByTF.items[key] = append(existing, newCandle)
					store.Append(pair, "1m", newCandle)

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
				store.Append(pair, "1m", newCandle)
				bus.Publish(Event{Type: "candle", Data: newCandle})
			}
			candlesByTF.mu.Unlock()
		}
	}()
}

func formatFloat(v float64, prec int) string {
	return strconv.FormatFloat(v, 'f', prec, 64)
}
