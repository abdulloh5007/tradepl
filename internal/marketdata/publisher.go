package marketdata

import (
	"context"
	"log"
	"math"
	"sort"
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

type AutoTrendStatus struct {
	Active         bool             `json:"active"`
	Trend          string           `json:"trend"`
	SessionID      string           `json:"session_id"`
	NextSwitchAt   int64            `json:"next_switch_at"`
	RemainingSec   int64            `json:"remaining_sec"`
	UpcomingEvents []AutoTrendEvent `json:"upcoming_events,omitempty"`
}

type AutoTrendEvent struct {
	Direction       string `json:"direction"`
	DurationSeconds int    `json:"duration_seconds"`
	ScheduledAt     int64  `json:"scheduled_at"`
	Status          string `json:"status"`
	SessionID       string `json:"session_id"`
}

var currentAutoTrendState = &AutoTrendStatus{
	Active:         false,
	Trend:          "random",
	SessionID:      "",
	NextSwitchAt:   0,
	RemainingSec:   0,
	UpcomingEvents: nil,
}

type trendDynamics struct {
	lastTrend          string
	momentum           float64
	anchorPrice        float64
	sidewaysFromAnchor bool
	pullbackTicks      int
	lastSign           int
	streak             int
	impulseScore       float64
	sidewaysLow        float64
	sidewaysHigh       float64
	sidewaysMid        float64
	oscPhase           float64
}

type autoTrendState struct {
	dayKey          string
	impulses        []scheduledImpulse
	activeImpulse   int
	sidewaysUntil   time.Time
	sidewaysSession string
}

type scheduledImpulse struct {
	start     time.Time
	end       time.Time
	sessionID string
	trend     string
}

type priceSample struct {
	t     time.Time
	price float64
}

// GetCurrentEventState returns the current event state for API access
func GetCurrentEventState() EventState {
	return *currentEventState
}

func GetCurrentAutoTrendState() AutoTrendStatus {
	return *currentAutoTrendState
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
	trendDyn := &trendDynamics{lastTrend: "random", anchorPrice: currentPrice}
	autoTrend := &autoTrendState{activeImpulse: -1}
	priceSamples := []priceSample{{t: time.Now(), price: currentPrice}}

	// Active price event tracking
	var activeEvent *sessions.PriceEvent
	var eventEndTime time.Time
	var previousTrend string // To restore after event

	// Channels for config updates
	sessionCh := sessions.SessionChangeChannel()
	trendCh := sessions.TrendChangeChannel()
	var sessStore *sessions.Store
	activeSessionID := ""
	if pool != nil {
		sessStore = sessions.NewStore(pool)
		if active, err := sessStore.GetActiveSession(context.Background()); err == nil && active != nil {
			activeSessionID = active.ID
		}
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
			change := calculatePriceChange(pair, config.TrendBias, config.Volatility, config.UpdateRateMs, currentPrice, trendDyn)

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
			priceSamples = appendPriceSample(priceSamples, time.Now(), currentPrice)

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
					activeSessionID = session.ID
					config.UpdateRateMs = session.UpdateRateMs
					// Volatility/Spread controlled by separate service
					// config.Volatility = session.Volatility
					// config.Spread = session.Spread
					trendMode, _ := sessStore.GetSetting(ctx, sessions.SettingTrendMode)
					if trendMode == "manual" {
						if manualTrend, err := sessStore.GetSetting(ctx, sessions.SettingCurrentTrend); err == nil && manualTrend != "" {
							config.TrendBias = manualTrend
						}
					} else {
						config.TrendBias = session.TrendBias
					}

					// Reset ticker with new rate
					ticker.Stop()
					ticker = time.NewTicker(time.Duration(config.UpdateRateMs) * time.Millisecond)

					// Re-apply current volatility profile immediately (without spread coupling).
					if volStore != nil {
						if volConfig, err := volStore.GetActiveConfig(ctx); err == nil {
							config.Volatility = volConfig.Volatility
						}
					}
					autoTrend.dayKey = "" // force daily impulse rebuild
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
				now := time.Now()
				mode, _ := sessStore.GetSetting(context.Background(), sessions.SettingSessionMode)
				if mode == "auto" {
					checkAutoSession(sessStore)
				}
				trendMode, _ := sessStore.GetSetting(context.Background(), sessions.SettingTrendMode)
				if trendMode == "" {
					trendMode = "auto"
				}
				if trendMode == "manual" && activeEvent == nil {
					if untilRaw, err := sessStore.GetSetting(context.Background(), sessions.SettingTrendManualUntil); err == nil && untilRaw != "" && untilRaw != "0" {
						if untilMs, parseErr := strconv.ParseInt(untilRaw, 10, 64); parseErr == nil && untilMs > 0 && now.UnixMilli() >= untilMs {
							if manualTrend, terr := sessStore.GetSetting(context.Background(), sessions.SettingCurrentTrend); terr == nil && (manualTrend == "bullish" || manualTrend == "bearish") {
								config.TrendBias = "random"
								_ = sessStore.SetSetting(context.Background(), sessions.SettingCurrentTrend, "random")
								_ = sessStore.SetSetting(context.Background(), sessions.SettingTrendManualUntil, "0")
								log.Printf("[Publisher] Manual trend '%s' expired -> random", manualTrend)
							} else {
								_ = sessStore.SetSetting(context.Background(), sessions.SettingTrendManualUntil, "0")
							}
						}
					}
				}
				if trendMode == "auto" && activeEvent == nil {
					targetTrend, nextSwitchAt, trendSessionID, hasSchedule := resolveAutoTrend(now, pair, currentPrice, priceSamples, autoTrend, trendDyn)
					syncCompletedAutoEvents(sessStore, pair, now, autoTrend.impulses)
					if targetTrend != config.TrendBias {
						config.TrendBias = targetTrend
						_ = sessStore.SetSetting(context.Background(), sessions.SettingCurrentTrend, targetTrend)
						log.Printf("[Publisher] Auto trend -> %s (session=%s)", targetTrend, trendSessionID)
					}
					if trendSessionID == "" {
						trendSessionID = activeSessionID
					}
					remaining := int64(0)
					nextSwitchUnix := int64(0)
					if !nextSwitchAt.IsZero() {
						remaining = int64(time.Until(nextSwitchAt).Seconds())
						if remaining < 0 {
							remaining = 0
						}
						nextSwitchUnix = nextSwitchAt.UnixMilli()
					}
					upcoming := buildAutoTrendEvents(now, autoTrend.impulses)
					currentAutoTrendState = &AutoTrendStatus{
						Active:         hasSchedule,
						Trend:          config.TrendBias,
						SessionID:      trendSessionID,
						NextSwitchAt:   nextSwitchUnix,
						RemainingSec:   remaining,
						UpcomingEvents: upcoming,
					}
				} else {
					upcoming := []AutoTrendEvent(nil)
					if trendMode == "auto" {
						upcoming = buildAutoTrendEvents(now, autoTrend.impulses)
					}
					currentAutoTrendState = &AutoTrendStatus{
						Active:         false,
						Trend:          config.TrendBias,
						SessionID:      activeSessionID,
						NextSwitchAt:   0,
						RemainingSec:   0,
						UpcomingEvents: upcoming,
					}
				}
			}

		case <-eventTicker.C:
			// Check scheduled pending events and start only when their scheduled_at time is reached.
			if pool != nil && activeEvent == nil {
				sessStore := sessions.NewStore(pool)
				ctx := context.Background()
				events, err := sessStore.GetPendingEvents(ctx)
				if err == nil && len(events) > 0 {
					now := time.Now().UTC()
					for _, evt := range events {
						if evt.Status != "pending" {
							continue
						}
						if evt.ScheduledAt.After(now) {
							continue
						}

						// Start event at or after scheduled time.
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
func calculatePriceChange(pair string, trend string, volatility float64, intervalMs int, currentPrice float64, dyn *trendDynamics) float64 {
	if intervalMs <= 0 {
		intervalMs = 1000
	}
	if volatility <= 0 {
		return 0
	}
	// Additional damping to keep live movement aligned with historical 1m behavior.
	// User requested another 2-3x reduction.
	modelVol := volatility * 0.40

	linScale := float64(intervalMs) / 1000.0
	sqrtScale := math.Sqrt(linScale)
	seed := time.Now().UnixNano()

	// Reset/initialize dynamic state when trend mode changes.
	if dyn != nil && dyn.lastTrend != trend {
		dyn.lastTrend = trend
		dyn.momentum = 0
		dyn.pullbackTicks = 0
		dyn.lastSign = 0
		dyn.streak = 0
		dyn.oscPhase = 0
		customSidewaysAnchor := 0.0
		if dyn.sidewaysFromAnchor && dyn.anchorPrice > 0 {
			customSidewaysAnchor = dyn.anchorPrice
		}
		if currentPrice > 0 {
			dyn.anchorPrice = currentPrice
		}
		if trend == "sideways" {
			base := currentPrice
			if customSidewaysAnchor > 0 {
				base = customSidewaysAnchor
				dyn.anchorPrice = customSidewaysAnchor
			}
			setupSidewaysBand(pair, base, dyn)
			dyn.sidewaysFromAnchor = false
		}
	}
	if dyn != nil && dyn.anchorPrice <= 0 && currentPrice > 0 {
		dyn.anchorPrice = currentPrice
	}

	// Base random movement to keep natural candle alternation (green/red mix).
	noise := randNorm(seed) * modelVol * 0.060 * sqrtScale
	microNoise := randNorm(seed^0x5DEECE66D) * modelVol * 0.015 * sqrtScale

	driftSign := 0.0
	switch trend {
	case "bullish":
		// In this instrument model backend down-move means chart up-move.
		driftSign = -1.0
	case "bearish":
		driftSign = 1.0
	case "sideways":
		driftSign = 0.0
	default:
		driftSign = 0.0
	}

	momentum := 0.0
	pullback := 0.0
	meanReversion := 0.0

	if dyn != nil {
		dyn.oscPhase += 0.35 + rand01(seed^0x52AB91C34D7E1F08)*0.20
		oscillation := math.Sin(dyn.oscPhase) * modelVol * 0.012 * sqrtScale

		// Momentum gives directional persistence, but not monotonic candles.
		dyn.momentum = dyn.momentum*0.92 +
			driftSign*modelVol*0.004*linScale +
			randNorm(seed^0x7A5B3C2D1E0F1122)*modelVol*0.006*sqrtScale

		if trend == "bullish" || trend == "bearish" {
			// Occasionally inject short counter-trend pullbacks to avoid "all green/all red" runs.
			if dyn.pullbackTicks == 0 && math.Abs(dyn.momentum) > modelVol*0.0015 {
				chance := clampFloat(0.05*linScale, 0.010, 0.18)
				if rand01(seed^0x6C8E9DAB4F237155) < chance {
					span := int(math.Round(900.0 / float64(intervalMs)))
					if span < 2 {
						span = 2
					}
					if span > 8 {
						span = 8
					}
					dyn.pullbackTicks = span
				}
			}
			if dyn.pullbackTicks > 0 {
				pullback = (-driftSign) * modelVol * 0.012 * linScale
				dyn.pullbackTicks--
			}
		} else {
			dyn.pullbackTicks = 0
		}

		if trend == "sideways" && dyn.anchorPrice > 0 && currentPrice > 0 {
			// Sideways: oscillate inside a bounded range and bounce from edges.
			if dyn.sidewaysLow <= 0 || dyn.sidewaysHigh <= dyn.sidewaysLow {
				setupSidewaysBand(pair, currentPrice, dyn)
			}
			dyn.sidewaysMid = (dyn.sidewaysLow + dyn.sidewaysHigh) / 2
			gap := (dyn.sidewaysMid - currentPrice) / currentPrice
			meanReversion = clampFloat(gap*1.35*linScale, -modelVol*0.035*linScale, modelVol*0.035*linScale)
			edgePush := 0.0
			if currentPrice <= dyn.sidewaysLow {
				edgePush = modelVol * 0.025 * linScale
			} else if currentPrice >= dyn.sidewaysHigh {
				edgePush = -modelVol * 0.025 * linScale
			}
			noise = randNorm(seed) * modelVol * 0.045 * sqrtScale
			microNoise = randNorm(seed^0x4B1D7C9E12A85F3C) * modelVol * 0.012 * sqrtScale
			dyn.momentum *= 0.35
			pullback = edgePush
		}

		noise += oscillation
		momentum = dyn.momentum
	}

	drift := driftSign * modelVol * 0.0032 * linScale
	change := noise + microNoise + momentum + drift + pullback + meanReversion

	// Hard safety clamp for per-tick jumps.
	stepLimit := modelVol * (0.15*sqrtScale + 0.025*linScale)
	change = clampFloat(change, -stepLimit, stepLimit)

	// Maintain anti-monotonicity stats for richer candle bodies/wicks.
	if dyn != nil {
		sign := 0
		if change > 0 {
			sign = 1
		} else if change < 0 {
			sign = -1
		}
		if sign != 0 {
			if dyn.lastSign == sign {
				dyn.streak++
			} else {
				dyn.lastSign = sign
				dyn.streak = 1
			}
		}
		absNorm := math.Abs(change) / (modelVol + 1e-12)
		dyn.impulseScore = dyn.impulseScore*0.985 + absNorm*0.015

		// Hard anti-monotonic guard:
		// force a counter move if direction persists too long.
		if dyn.streak >= 8 && dyn.lastSign != 0 {
			flipMag := math.Max(math.Abs(change)*0.45, modelVol*0.012*linScale)
			change = float64(-dyn.lastSign) * flipMag
			dyn.lastSign = -dyn.lastSign
			dyn.streak = 1
		} else if dyn.streak >= 6 {
			change += float64(-dyn.lastSign) * modelVol * 0.0035 * linScale
		}
	}
	return change
}

func clampFloat(v, minV, maxV float64) float64 {
	if v < minV {
		return minV
	}
	if v > maxV {
		return maxV
	}
	return v
}

type timeWindow struct {
	start time.Time
	end   time.Time
}

func resolveAutoTrend(now time.Time, pair string, currentPrice float64, samples []priceSample, st *autoTrendState, dyn *trendDynamics) (string, time.Time, string, bool) {
	if st == nil {
		return "random", time.Time{}, autoMarketRegimeID(now), false
	}
	ensureDailyImpulsePlan(st, now, pair)

	activeIdx := -1
	for i := range st.impulses {
		imp := st.impulses[i]
		if !now.Before(imp.start) && now.Before(imp.end) {
			activeIdx = i
			break
		}
	}
	if activeIdx >= 0 {
		st.activeImpulse = activeIdx
		st.sidewaysUntil = time.Time{}
		st.sidewaysSession = ""
		imp := st.impulses[activeIdx]
		return imp.trend, imp.end, imp.sessionID, true
	}

	if st.activeImpulse >= 0 && st.activeImpulse < len(st.impulses) {
		last := st.impulses[st.activeImpulse]
		if !now.Before(last.end) {
			anchor := averageRecentPrice(samples, now, time.Minute, currentPrice)
			if dyn != nil {
				dyn.anchorPrice = anchor
				dyn.sidewaysFromAnchor = true
				setupSidewaysBand(pair, anchor, dyn)
			}
			st.sidewaysUntil = now.Add(sidewaysHoldDuration(last.end.Sub(last.start), now.UnixNano()))
			st.sidewaysSession = last.sessionID
			st.activeImpulse = -1
			return "sideways", st.sidewaysUntil, st.sidewaysSession, true
		}
	}

	if !st.sidewaysUntil.IsZero() {
		if now.Before(st.sidewaysUntil) {
			if dyn != nil && dyn.anchorPrice > 0 {
				setupSidewaysBand(pair, dyn.anchorPrice, dyn)
			}
			return "sideways", st.sidewaysUntil, st.sidewaysSession, true
		}
		st.sidewaysUntil = time.Time{}
		st.sidewaysSession = ""
	}

	nextStart, nextSession := nextImpulseStart(st.impulses, now)
	if !nextStart.IsZero() {
		return "random", nextStart, nextSession, true
	}
	return "random", time.Time{}, autoMarketRegimeID(now), len(st.impulses) > 0
}

func ensureDailyImpulsePlan(st *autoTrendState, now time.Time, pair string) {
	dayStart := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	dayKey := dayStart.Format("2006-01-02")
	if st.dayKey == dayKey && len(st.impulses) > 0 {
		return
	}
	st.dayKey = dayKey
	st.impulses = buildDailyImpulsePlan(dayStart, pair)
	st.activeImpulse = -1
	st.sidewaysUntil = time.Time{}
	st.sidewaysSession = ""
	log.Printf("[Publisher] Auto daily impulses generated: day=%s count=%d", dayKey, len(st.impulses))
}

func buildDailyImpulsePlan(dayStart time.Time, pair string) []scheduledImpulse {
	seedBase := dayStart.UnixNano() + int64(len(pair))*7919
	target := pickImpulseCount(seedBase)
	impulses := make([]scheduledImpulse, 0, target)
	minGap := 5 * time.Minute

	for attempt := 0; attempt < 300 && len(impulses) < target; attempt++ {
		seed := seedBase + int64(attempt+1)*104729
		sessionID := "london"
		if rand01(seed^0x31B57A2C) >= 0.5 {
			sessionID = "newyork"
		}
		durationMin := 2 + int(rand01(seed^0x27D4EB2F)*7.0) // 2..8
		duration := time.Duration(durationMin) * time.Minute

		start, ok := pickRandomSessionStart(dayStart, sessionID, duration, seed^0x9E3779B)
		if !ok {
			continue
		}
		imp := scheduledImpulse{
			start:     start,
			end:       start.Add(duration),
			sessionID: sessionID,
			trend:     "bullish",
		}
		if rand01(seed^0x6A09E667) >= 0.5 {
			imp.trend = "bearish"
		}
		if hasImpulseConflict(impulses, imp, minGap) {
			continue
		}
		impulses = append(impulses, imp)
	}

	sort.Slice(impulses, func(i, j int) bool {
		return impulses[i].start.Before(impulses[j].start)
	})
	if len(impulses) == 0 {
		// Safety fallback: always keep at least one impulse event per day.
		dur := 4 * time.Minute
		start, ok := pickRandomSessionStart(dayStart, "newyork", dur, seedBase^0xBB67AE85)
		if ok {
			impulses = append(impulses, scheduledImpulse{
				start:     start,
				end:       start.Add(dur),
				sessionID: "newyork",
				trend:     "bullish",
			})
		}
	}
	return impulses
}

func pickImpulseCount(seed int64) int {
	r := rand01(seed ^ 0xA0761D64)
	if r < 0.45 {
		return 1
	}
	if r < 0.80 {
		return 2
	}
	return 3
}

func pickRandomSessionStart(dayStart time.Time, sessionID string, duration time.Duration, seed int64) (time.Time, bool) {
	windows := []timeWindow{}
	switch sessionID {
	case "newyork":
		windows = append(windows, timeWindow{start: dayStart.Add(13 * time.Hour), end: dayStart.Add(22 * time.Hour)})
	default:
		windows = append(windows, timeWindow{start: dayStart, end: dayStart.Add(13 * time.Hour)})
		windows = append(windows, timeWindow{start: dayStart.Add(22 * time.Hour), end: dayStart.Add(24 * time.Hour)})
	}

	totalSlots := 0
	slotRanges := make([][3]int, 0, len(windows)) // startUnix, slots, offsetAccumulator
	acc := 0
	for _, w := range windows {
		latest := w.end.Add(-duration)
		if latest.Before(w.start) {
			continue
		}
		slots := int(latest.Sub(w.start).Seconds()) + 1
		if slots <= 0 {
			continue
		}
		slotRanges = append(slotRanges, [3]int{int(w.start.Unix()), slots, acc})
		acc += slots
		totalSlots += slots
	}
	if totalSlots <= 0 {
		return time.Time{}, false
	}
	pick := int(rand01(seed) * float64(totalSlots))
	if pick >= totalSlots {
		pick = totalSlots - 1
	}
	for _, r := range slotRanges {
		startUnix := r[0]
		slots := r[1]
		offsetAcc := r[2]
		if pick >= offsetAcc && pick < offsetAcc+slots {
			sec := pick - offsetAcc
			return time.Unix(int64(startUnix+sec), 0).UTC(), true
		}
	}
	return time.Time{}, false
}

func hasImpulseConflict(existing []scheduledImpulse, candidate scheduledImpulse, minGap time.Duration) bool {
	for _, imp := range existing {
		windowStart := imp.start.Add(-minGap)
		windowEnd := imp.end.Add(minGap)
		if candidate.start.Before(windowEnd) && windowStart.Before(candidate.end) {
			return true
		}
	}
	return false
}

func nextImpulseStart(impulses []scheduledImpulse, now time.Time) (time.Time, string) {
	var next time.Time
	sessionID := ""
	for _, imp := range impulses {
		if imp.start.After(now) && (next.IsZero() || imp.start.Before(next)) {
			next = imp.start
			sessionID = imp.sessionID
		}
	}
	return next, sessionID
}

func buildAutoTrendEvents(now time.Time, impulses []scheduledImpulse) []AutoTrendEvent {
	if len(impulses) == 0 {
		return nil
	}
	items := make([]AutoTrendEvent, 0, len(impulses))
	for _, imp := range impulses {
		direction := "up"
		if imp.trend == "bearish" {
			direction = "down"
		}

		status := "completed"
		if now.Before(imp.start) {
			status = "pending"
		} else if now.Before(imp.end) {
			status = "active"
		}

		duration := int(imp.end.Sub(imp.start).Seconds())
		if duration <= 0 {
			duration = 60
		}

		items = append(items, AutoTrendEvent{
			Direction:       direction,
			DurationSeconds: duration,
			ScheduledAt:     imp.start.UnixMilli(),
			Status:          status,
			SessionID:       imp.sessionID,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].ScheduledAt < items[j].ScheduledAt
	})
	return items
}

func syncCompletedAutoEvents(store *sessions.Store, pair string, now time.Time, impulses []scheduledImpulse) {
	if store == nil || len(impulses) == 0 {
		return
	}
	ctx := context.Background()
	for _, imp := range impulses {
		if imp.end.After(now) {
			continue
		}
		direction := "up"
		if imp.trend == "bearish" {
			direction = "down"
		}
		duration := int(imp.end.Sub(imp.start).Seconds())
		if duration <= 0 {
			duration = 60
		}
		if err := store.EnsureAutoCompletedEvent(ctx, pair, direction, duration, imp.start.UTC(), imp.end.UTC()); err != nil {
			log.Printf("[Publisher] EnsureAutoCompletedEvent failed: %v", err)
		}
	}
}

func sidewaysHoldDuration(impulseDuration time.Duration, seed int64) time.Duration {
	extraMin := 2 + int(rand01(seed^0x94D049BB)*5.0) // 2..6
	hold := impulseDuration + time.Duration(extraMin)*time.Minute
	if hold < 3*time.Minute {
		hold = 3 * time.Minute
	}
	if hold > 12*time.Minute {
		hold = 12 * time.Minute
	}
	return hold
}

func appendPriceSample(samples []priceSample, now time.Time, price float64) []priceSample {
	samples = append(samples, priceSample{t: now, price: price})
	cutoff := now.Add(-2 * time.Minute)
	drop := 0
	for drop < len(samples) && samples[drop].t.Before(cutoff) {
		drop++
	}
	if drop > 0 {
		copy(samples, samples[drop:])
		samples = samples[:len(samples)-drop]
	}
	return samples
}

func averageRecentPrice(samples []priceSample, now time.Time, window time.Duration, fallback float64) float64 {
	if len(samples) == 0 {
		return fallback
	}
	cutoff := now.Add(-window)
	sum := 0.0
	count := 0
	for i := len(samples) - 1; i >= 0; i-- {
		if samples[i].t.Before(cutoff) {
			break
		}
		sum += samples[i].price
		count++
	}
	if count == 0 {
		return fallback
	}
	return sum / float64(count)
}

func setupSidewaysBand(pair string, currentPrice float64, dyn *trendDynamics) {
	if dyn == nil || currentPrice <= 0 {
		return
	}
	if IsDisplayInverted(pair) {
		display := 1.0 / currentPrice
		block := 50.0
		base := math.Floor(display/block) * block
		if base <= 0 {
			base = math.Max(1, display-block/2)
		}
		upperDisplay := base + block
		lowerRaw := 1.0 / upperDisplay
		upperRaw := 1.0 / base
		dyn.sidewaysLow = math.Min(lowerRaw, upperRaw)
		dyn.sidewaysHigh = math.Max(lowerRaw, upperRaw)
		dyn.sidewaysMid = (dyn.sidewaysLow + dyn.sidewaysHigh) / 2
		return
	}
	half := currentPrice * 0.0020
	dyn.sidewaysLow = currentPrice - half
	dyn.sidewaysHigh = currentPrice + half
	dyn.sidewaysMid = currentPrice
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
