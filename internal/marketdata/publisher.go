package marketdata

import (
	"context"
	"log"
	"strconv"
	"time"

	"lv-tradepl/internal/sessions"
	"lv-tradepl/internal/volatility"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PublisherConfig holds dynamic configuration for the publisher
type PublisherConfig struct {
	UpdateRateMs int
	Volatility   float64
	Spread       float64
	TrendBias    string // bullish, bearish, sideways, random
}

// EventState represents the current active event state
type EventState struct {
	Active      bool   `json:"active"`
	Trend       string `json:"trend"`
	EndTime     int64  `json:"end_time"`
	EventID     int    `json:"event_id"`
	Direction   string `json:"direction"`
	Duration    int    `json:"duration"`
	ManualTrend string `json:"manual_trend"` // The trend to restore after event ends
}

var currentEventState = &EventState{Active: false}

// GetCurrentEventState returns the current event state for API access
func GetCurrentEventState() EventState {
	return *currentEventState
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

	candles, err := store.LoadRecent(key, 10000, prec)
	if err != nil || len(candles) == 0 {
		log.Printf("[Publisher] Generating 500 historical candles for %s", pair)
		candles = GenerateInitialCandles(pair, 5000)
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
	var volStore *volatility.Store
	if pool != nil {
		sessStore := sessions.NewStore(pool)
		volStore = volatility.NewStore(pool)
		ctx := context.Background()
		if session, err := sessStore.GetActiveSession(ctx); err == nil {
			config.UpdateRateMs = session.UpdateRateMs
			// Volatility/Spread now handled by volStore, but we start with session default if needed
			// or wait for first poll.
			// config.Volatility = session.Volatility // DEPRECATED
			// config.Spread = session.Spread         // DEPRECATED
			config.TrendBias = session.TrendBias
			log.Printf("[Publisher] Loaded session '%s': rate=%dms, trend=%s",
				session.Name, config.UpdateRateMs, config.TrendBias)
		}
		if trend, err := sessStore.GetSetting(ctx, sessions.SettingCurrentTrend); err == nil && trend != "" {
			config.TrendBias = trend
		}

		// Load initial Volatility Config
		if volConfig, err := volStore.GetActiveConfig(ctx); err == nil {
			config.Volatility = volConfig.Volatility
			log.Printf("[Publisher] Loaded volatility config: id=%s, vol=%.5f (spread stays account-based)",
				volConfig.ID, config.Volatility)
		}
	}

	// Prime live quote cache immediately on startup so order execution
	// and metrics use the same source even before the first ticker tick.
	initialSpread := config.Spread
	if initialSpread < 0 {
		initialSpread = 0
	}
	initialHalfSpread := initialSpread / 2
	setLiveQuote(pair, lastPrice-initialHalfSpread, lastPrice+initialHalfSpread)

	go runPublisher(bus, pair, dir, prec, lastPrice, profile, config, pool, volStore)
}

func runPublisher(bus *Bus, pair string, dir string, prec int, lastPrice float64, profile pairProfile, config *PublisherConfig, pool *pgxpool.Pool, volStore *volatility.Store) {
	store := NewCandleStore(dir)
	key := pair + "|1m"

	ticker := time.NewTicker(time.Duration(config.UpdateRateMs) * time.Millisecond)
	defer ticker.Stop()

	currentPrice := lastPrice

	// Active price event tracking
	var activeEvent *sessions.PriceEvent
	var eventEndTime time.Time
	var previousTrend string // To restore after event

	// Channels for config updates
	sessionCh := sessions.SessionChangeChannel()
	trendCh := sessions.TrendChangeChannel()
	var sessStore *sessions.Store
	if pool != nil {
		sessStore = sessions.NewStore(pool)
	}

	// Event check ticker (every 5 seconds)
	eventTicker := time.NewTicker(5 * time.Second)
	defer eventTicker.Stop()

	// Volatility refresh ticker (every 1 second)
	volTicker := time.NewTicker(1 * time.Second)
	defer volTicker.Stop()

	for {
		select {
		case <-ticker.C:
			// Apply trend bias to price change
			// Pass UpdateRateMs to scale the step size
			change := calculatePriceChange(config.TrendBias, config.Volatility, config.UpdateRateMs)

			// If there's an active price event, check if it should end
			if activeEvent != nil {
				if time.Now().After(eventEndTime) {
					// Event completed - restore previous trend
					log.Printf("[Publisher] Event completed, restoring trend to '%s'", previousTrend)
					config.TrendBias = previousTrend
					completeEvent(pool, activeEvent)

					// Clear global event state
					currentEventState = &EventState{Active: false, ManualTrend: previousTrend}

					// Broadcast event ended
					bus.Publish(Event{Type: "event_state", Data: map[string]interface{}{
						"active":       false,
						"trend":        previousTrend,
						"manual_trend": previousTrend,
					}})

					activeEvent = nil
				}
			}

			// Normal price change (with current trend bias - may be event-modified)
			currentPrice = currentPrice * (1 + change)

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
			setLiveQuote(pair, bid, ask)

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
			if sessStore != nil {
				ctx := context.Background()
				if session, err := sessStore.GetActiveSession(ctx); err == nil {
					log.Printf("[Publisher] Switching to session '%s'", session.Name)
					config.UpdateRateMs = session.UpdateRateMs
					// Volatility/Spread controlled by separate service
					// config.Volatility = session.Volatility
					// config.Spread = session.Spread
					config.TrendBias = session.TrendBias

					// Reset ticker with new rate
					ticker.Stop()
					ticker = time.NewTicker(time.Duration(config.UpdateRateMs) * time.Millisecond)

					// Re-apply current volatility profile immediately (without spread coupling).
					if volStore != nil {
						if volConfig, err := volStore.GetActiveConfig(ctx); err == nil {
							config.Volatility = volConfig.Volatility
						}
					}
				}
			}
			_ = sessionID // avoid unused warning

		case trend := <-trendCh:
			log.Printf("[Publisher] Trend changed to: %s", trend)
			config.TrendBias = trend

		case <-volTicker.C:
			if volStore != nil {
				// Refresh volatility only. Spread stays controlled by account plan multipliers.
				if volConfig, err := volStore.GetActiveConfig(context.Background()); err == nil {
					newVol := volConfig.Volatility
					if config.Volatility != newVol {
						log.Printf("[Publisher] Volatility Update: id=%s, vol=%.5f", volConfig.ID, newVol)
						config.Volatility = newVol
					}

					// "Auto Mode" check:
					mode, _ := volStore.GetMode(context.Background())
					if mode == "auto" {
						checkAutoVolatility(volStore)
					}
				}
			}
			if sessStore != nil {
				mode, _ := sessStore.GetSetting(context.Background(), sessions.SettingSessionMode)
				if mode == "auto" {
					checkAutoSession(sessStore)
				}
			}

		case <-eventTicker.C:
			// Check for pending events - start immediately (no price target)
			if pool != nil && activeEvent == nil {
				sessStore := sessions.NewStore(pool)
				ctx := context.Background()
				events, err := sessStore.GetPendingEvents(ctx)
				if err == nil && len(events) > 0 {
					for _, evt := range events {
						if evt.Status != "pending" {
							continue
						}

						// Start this event IMMEDIATELY
						log.Printf("[Publisher] Starting price event: direction=%s, duration=%ds",
							evt.Direction, evt.DurationSeconds)
						sessStore.MarkEventActive(ctx, evt.ID)
						activeEvent = &evt

						// Save current trend and set event end time
						previousTrend = config.TrendBias
						eventEndTime = time.Now().Add(time.Duration(evt.DurationSeconds) * time.Second)

						// Apply trend based on direction
						if evt.Direction == "up" {
							config.TrendBias = "bullish"
						} else {
							config.TrendBias = "bearish"
						}

						// Set global event state for API access
						currentEventState = &EventState{
							Active:      true,
							Trend:       config.TrendBias,
							EndTime:     eventEndTime.UnixMilli(),
							EventID:     evt.ID,
							Direction:   evt.Direction,
							Duration:    evt.DurationSeconds,
							ManualTrend: previousTrend,
						}

						// Broadcast event state via WebSocket
						bus.Publish(Event{Type: "event_state", Data: map[string]interface{}{
							"active":       true,
							"trend":        config.TrendBias,
							"end_time":     eventEndTime.UnixMilli(),
							"event_id":     evt.ID,
							"direction":    evt.Direction,
							"duration":     evt.DurationSeconds,
							"manual_trend": previousTrend,
						}})

						log.Printf("[Publisher] Event applied trend '%s' for %ds (ends at %s)", config.TrendBias, evt.DurationSeconds, eventEndTime.Format("15:04:05"))
						break
					}
				}
			}
		}
	}
}

// calculatePriceChange returns a price change based on trend bias
// intervalMs is used to scale the volatility per step (Linear Scaling)
// This ensures that 5 steps of 200ms = 1 step of 1000ms in total distance.
func calculatePriceChange(trend string, volatility float64, intervalMs int) float64 {
	// Scale factor based on reference 1000ms
	scale := float64(intervalMs) / 1000.0

	// Random component - always present for natural fluctuations (wicks/shadows)
	randomChange := randNorm(time.Now().UnixNano()) * volatility * 0.2 * scale

	// Drift component - adds a small consistent bias in trend direction
	// This creates overall trend direction while allowing natural counter-moves
	driftBias := volatility * 0.08 * scale // Small consistent drift

	switch trend {
	case "bullish":
		// Add negative drift (backend price down -> inverted screen price up)
		// Random component stays intact for natural wicks
		return randomChange - driftBias
	case "bearish":
		// Add positive drift (backend price up -> inverted screen price down)
		return randomChange + driftBias
	case "sideways":
		// Smaller overall movements but still natural
		return randomChange * 0.5
	default: // "random"
		return randomChange
	}
}

func autoMarketRegimeID(t time.Time) string {
	// Gold-like rhythm:
	// New York: 13:00-22:00 UTC
	// London:   all other hours
	hour := t.UTC().Hour()
	if hour >= 13 && hour < 22 {
		return "newyork"
	}
	return "london"
}

// Helper to check schedule and update volatility profile if needed.
func checkAutoVolatility(store *volatility.Store) {
	targetID := autoMarketRegimeID(time.Now())

	// Optimization: GetSettings, check active one.
	settings, err := store.GetSettings(context.Background())
	if err == nil {
		for _, s := range settings {
			if s.IsActive && s.ID == targetID {
				return // Already active
			}
		}
		// Need switch
		log.Printf("[Publisher] Auto-Switching Volatility to %s", targetID)
		store.SetActive(context.Background(), targetID)
	}
}

// Helper to check schedule and update active trading session if needed.
func checkAutoSession(store *sessions.Store) {
	targetID := autoMarketRegimeID(time.Now())

	active, err := store.GetActiveSession(context.Background())
	if err == nil && active != nil && active.ID == targetID {
		return
	}

	if err := store.SwitchSession(context.Background(), targetID); err == nil {
		log.Printf("[Publisher] Auto-Switching Session to %s", targetID)
		sessions.NotifySessionChange(targetID)
	}
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
			// Save the COMPLETED candle to disk
			completedCandle := *last
			go store.Append(key, completedCandle)

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
			// Do NOT save new candle yet (wait for close)
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
		// Do NOT save first candle yet
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
