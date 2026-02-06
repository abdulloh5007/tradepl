package marketdata

import (
	"context"
	"log"
	"strconv"
	"time"

	"lv-tradepl/internal/sessions"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PublisherConfig holds dynamic configuration for the publisher
type PublisherConfig struct {
	UpdateRateMs int
	Volatility   float64
	Spread       float64
	TrendBias    string // bullish, bearish, sideways, random
}

// StartPublisher starts a background goroutine that generates quotes and candles
// and publishes them to the bus for all connected WebSocket clients
func StartPublisher(bus *Bus, pair string, dir string) {
	StartPublisherWithDB(bus, pair, dir, nil)
}

// StartPublisherWithDB starts the publisher with optional database pool for sessions
func StartPublisherWithDB(bus *Bus, pair string, dir string, pool *pgxpool.Pool) {
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

	// Initialize config with defaults
	config := &PublisherConfig{
		UpdateRateMs: 250,
		Volatility:   profile.Vol,
		Spread:       profile.Spread,
		TrendBias:    "random",
	}

	// Load session config from DB if available
	if pool != nil {
		sessStore := sessions.NewStore(pool)
		ctx := context.Background()
		if session, err := sessStore.GetActiveSession(ctx); err == nil {
			config.UpdateRateMs = session.UpdateRateMs
			config.Volatility = session.Volatility
			config.Spread = session.Spread
			config.TrendBias = session.TrendBias
			log.Printf("[Publisher] Loaded session '%s': rate=%dms, vol=%.4f, spread=%.2f, trend=%s",
				session.Name, config.UpdateRateMs, config.Volatility, config.Spread, config.TrendBias)
		}
		if trend, err := sessStore.GetSetting(ctx, sessions.SettingCurrentTrend); err == nil && trend != "" {
			config.TrendBias = trend
		}
	}

	go runPublisher(bus, pair, dir, prec, lastPrice, profile, config, pool)
}

func runPublisher(bus *Bus, pair string, dir string, prec int, lastPrice float64, profile pairProfile, config *PublisherConfig, pool *pgxpool.Pool) {
	store := NewCandleStore(dir)
	key := pair + "|1m"

	ticker := time.NewTicker(time.Duration(config.UpdateRateMs) * time.Millisecond)
	defer ticker.Stop()

	currentPrice := lastPrice

	// Active price event tracking
	var activeEvent *sessions.PriceEvent
	var eventPricePerTick float64

	// Channels for config updates
	sessionCh := sessions.SessionChangeChannel()
	trendCh := sessions.TrendChangeChannel()

	// Event check ticker (every 5 seconds)
	eventTicker := time.NewTicker(5 * time.Second)
	defer eventTicker.Stop()

	for {
		select {
		case <-ticker.C:
			// Apply trend bias to price change
			change := calculatePriceChange(config.TrendBias, config.Volatility)

			// If there's an active price event, move towards target
			if activeEvent != nil {
				if eventPricePerTick != 0 {
					currentPrice += eventPricePerTick
					// Check if event is complete
					if activeEvent.Direction == "up" && currentPrice >= activeEvent.TargetPrice {
						currentPrice = activeEvent.TargetPrice
						completeEvent(pool, activeEvent)
						activeEvent = nil
					} else if activeEvent.Direction == "down" && currentPrice <= activeEvent.TargetPrice {
						currentPrice = activeEvent.TargetPrice
						completeEvent(pool, activeEvent)
						activeEvent = nil
					}
				}
			} else {
				// Normal price movement
				currentPrice = currentPrice * (1 + change)
			}

			// Keep price bounded
			if currentPrice <= 0 {
				currentPrice = profile.Base
			}

			// Calculate bid/ask from current price
			// Calculate bid/ask from current price (Mid Price)
			spread := config.Spread
			if spread == 0 {
				spread = currentPrice * 0.0001
			}
			halfSpread := spread / 2
			bid := currentPrice - halfSpread
			ask := currentPrice + halfSpread

			// Publish quote
			quoteEvt := Quote{
				Type:      "quote",
				Pair:      pair,
				Bid:       formatFloatPrec(bid, prec),
				Ask:       formatFloatPrec(ask, prec),
				Last:      formatFloatPrec(currentPrice, prec),
				Spread:    formatFloatPrec(spread, prec),
				Timestamp: time.Now().UnixMilli(),
			}
			bus.Publish(Event{Type: "quote", Data: quoteEvt})

			// Update/create candle
			updateCandle(bus, store, key, currentPrice, prec)

		case sessionID := <-sessionCh:
			// Session changed - reload config
			if pool != nil {
				sessStore := sessions.NewStore(pool)
				ctx := context.Background()
				if session, err := sessStore.GetActiveSession(ctx); err == nil {
					log.Printf("[Publisher] Switching to session '%s'", session.Name)
					config.UpdateRateMs = session.UpdateRateMs
					config.Volatility = session.Volatility
					config.Spread = session.Spread
					config.TrendBias = session.TrendBias

					// Reset ticker with new rate
					ticker.Stop()
					ticker = time.NewTicker(time.Duration(config.UpdateRateMs) * time.Millisecond)
				}
			}
			_ = sessionID // avoid unused warning

		case trend := <-trendCh:
			log.Printf("[Publisher] Trend changed to: %s", trend)
			config.TrendBias = trend

		case <-eventTicker.C:
			// Check for pending events that should start
			if pool != nil && activeEvent == nil {
				sessStore := sessions.NewStore(pool)
				ctx := context.Background()
				events, err := sessStore.GetPendingEvents(ctx)
				if err == nil && len(events) > 0 {
					for _, evt := range events {
						if evt.Status == "pending" && time.Now().After(evt.ScheduledAt) {
							// Start this event
							log.Printf("[Publisher] Starting price event: target=%.2f, direction=%s, duration=%ds",
								evt.TargetPrice, evt.Direction, evt.DurationSeconds)
							sessStore.MarkEventActive(ctx, evt.ID)
							activeEvent = &evt

							// Calculate price change per tick
							ticksNeeded := float64(evt.DurationSeconds*1000) / float64(config.UpdateRateMs)
							priceDiff := evt.TargetPrice - currentPrice
							eventPricePerTick = priceDiff / ticksNeeded
							break
						}
					}
				}
			}
		}
	}
}

// calculatePriceChange returns a price change based on trend bias
func calculatePriceChange(trend string, volatility float64) float64 {
	baseChange := randNorm(time.Now().UnixNano()) * volatility * 0.2

	switch trend {
	case "bullish":
		// Bias towards negative changes (backend price down -> inverted screen price up)
		if baseChange > 0 {
			baseChange *= 0.3 // Reduce positive moves
		} else {
			baseChange *= 1.5 // Amplify negative moves
		}
	case "bearish":
		// Bias towards positive changes (backend price up -> inverted screen price down)
		if baseChange < 0 {
			baseChange *= 0.3 // Reduce negative moves
		} else {
			baseChange *= 1.5 // Amplify positive moves
		}
	case "sideways":
		// Smaller movements
		baseChange *= 0.3
		// "random" - no modification
	}

	return baseChange
}

// updateCandle handles candle creation/update logic
func updateCandle(bus *Bus, store *CandleStore, key string, currentPrice float64, prec int) {
	now := time.Now().Unix()
	candleTime := (now / 60) * 60

	candlesByTF.mu.Lock()
	defer candlesByTF.mu.Unlock()

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
			bus.Publish(Event{Type: "candle", Data: *last})
		} else if candleTime > last.Time {
			// Create new candle
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
				Open:  prevClose,
				High:  formatFloatPrec(highVal, prec),
				Low:   formatFloatPrec(lowVal, prec),
				Close: closeStr,
			}
			candlesByTF.items[key] = append(existing, newCandle)
			go store.Append(key, newCandle)
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
}

// completeEvent marks an event as completed
func completeEvent(pool *pgxpool.Pool, event *sessions.PriceEvent) {
	if pool == nil || event == nil {
		return
	}
	log.Printf("[Publisher] Completed price event #%d", event.ID)
	sessStore := sessions.NewStore(pool)
	ctx := context.Background()
	sessStore.MarkEventCompleted(ctx, event.ID)
}

func formatFloatPrec(v float64, prec int) string {
	return strconv.FormatFloat(v, 'f', prec, 64)
}
