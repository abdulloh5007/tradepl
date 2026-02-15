package marketdata

import (
	"context"
	"log"
	"math"
	"time"

	"lv-tradepl/internal/sessions"
)

const (
	newsPhasePending   = "pending"
	newsPhasePre       = "pre"
	newsPhaseLive      = "live"
	newsPhasePost      = "post"
	newsPhaseCompleted = "completed"
	defaultNewsPreSec  = 15 * 60
	defaultNewsLiveSec = 5 * 60
	defaultNewsPostSec = 60 * 60
)

type economicNewsEffect struct {
	Active               bool
	EventID              int64
	Title                string
	Phase                string
	Trend                string
	VolatilityMultiplier float64
	Forecast             float64
	Actual               *float64
	Impact               string
}

func phasePriority(phase string) int {
	switch phase {
	case newsPhaseLive:
		return 0
	case newsPhasePre:
		return 1
	case newsPhasePost:
		return 2
	default:
		return 9
	}
}

func resolveEconomicPhase(evt sessions.EconomicNewsEvent, now time.Time) string {
	preStart := evt.ScheduledAt.Add(-time.Duration(evt.PreSeconds) * time.Second)
	liveStart := evt.ScheduledAt
	liveEnd := liveStart.Add(time.Duration(evt.EventSeconds) * time.Second)
	postEnd := liveEnd.Add(time.Duration(evt.PostSeconds) * time.Second)

	if now.Before(preStart) {
		return newsPhasePending
	}
	if now.Before(liveStart) {
		return newsPhasePre
	}
	if now.Before(liveEnd) {
		return newsPhaseLive
	}
	if now.Before(postEnd) {
		return newsPhasePost
	}
	return newsPhaseCompleted
}

func impactLiveMultiplier(impact string) float64 {
	switch impact {
	case "high":
		return 3.20
	case "medium":
		return 2.50
	default:
		return 1.80
	}
}

func autoActualValue(evt sessions.EconomicNewsEvent) float64 {
	base := evt.Forecast
	if math.Abs(base) < 0.000001 {
		base = 100.0 + float64((evt.ID%25)+1)
	}
	maxPct := 0.015
	switch evt.Impact {
	case "high":
		maxPct = 0.060
	case "medium":
		maxPct = 0.032
	}
	seed := evt.ID*982451653 + evt.ScheduledAt.Unix()
	deltaPct := (rand01(seed^0x4F1BBCDCBFA54095) * 2.0) - 1.0
	actual := base * (1.0 + deltaPct*maxPct)
	if math.Abs(actual) < 0.000001 {
		actual = (deltaPct * maxPct * 100.0)
	}
	return math.Round(actual*10000) / 10000
}

func trendFromForecastActual(evt sessions.EconomicNewsEvent) string {
	actual := evt.Actual
	if actual == nil {
		return "random"
	}
	if *actual > evt.Forecast {
		return "bullish"
	}
	if *actual < evt.Forecast {
		return "bearish"
	}
	if evt.ID%2 == 0 {
		return "bullish"
	}
	return "bearish"
}

func effectForPhase(evt sessions.EconomicNewsEvent, phase string) economicNewsEffect {
	effect := economicNewsEffect{
		Active:   true,
		EventID:  evt.ID,
		Title:    evt.Title,
		Phase:    phase,
		Forecast: evt.Forecast,
		Actual:   evt.Actual,
		Impact:   evt.Impact,
	}
	switch phase {
	case newsPhasePre:
		effect.Trend = "random"
		effect.VolatilityMultiplier = 0.55
	case newsPhaseLive:
		effect.Trend = trendFromForecastActual(evt)
		effect.VolatilityMultiplier = impactLiveMultiplier(evt.Impact)
	case newsPhasePost:
		effect.Trend = "sideways"
		effect.VolatilityMultiplier = 0.75
	default:
		effect.Active = false
	}
	return effect
}

func ensureEventActual(store *sessions.Store, evt *sessions.EconomicNewsEvent, now time.Time) error {
	if evt.Actual != nil {
		return nil
	}
	generated := autoActualValue(*evt)
	if err := store.MarkEconomicNewsLive(context.Background(), evt.ID, now, &generated, true); err != nil {
		return err
	}
	evt.Actual = &generated
	return nil
}

func updateEconomicNewsLifecycle(store *sessions.Store, pair string, now time.Time) (economicNewsEffect, error) {
	if store == nil {
		return economicNewsEffect{}, nil
	}

	events, err := store.GetEconomicNewsLifecycleEvents(context.Background(), pair, now, 10*24*time.Hour, 256)
	if err != nil {
		return economicNewsEffect{}, err
	}
	if len(events) == 0 {
		return economicNewsEffect{}, nil
	}

	best := economicNewsEffect{}
	bestPriority := 100
	bestScheduled := time.Time{}

	for i := range events {
		evt := &events[i]
		desired := resolveEconomicPhase(*evt, now)
		if evt.Status != desired {
			switch desired {
			case newsPhasePre:
				if err := store.MarkEconomicNewsPre(context.Background(), evt.ID, now); err != nil {
					log.Printf("[Publisher] economic news pre transition failed id=%d: %v", evt.ID, err)
				} else {
					evt.Status = newsPhasePre
				}
			case newsPhaseLive:
				actual := evt.Actual
				autoActual := false
				if actual == nil {
					generated := autoActualValue(*evt)
					actual = &generated
					autoActual = true
				}
				if err := store.MarkEconomicNewsLive(context.Background(), evt.ID, now, actual, autoActual); err != nil {
					log.Printf("[Publisher] economic news live transition failed id=%d: %v", evt.ID, err)
				} else {
					evt.Status = newsPhaseLive
					evt.Actual = actual
				}
			case newsPhasePost:
				_ = ensureEventActual(store, evt, now)
				if err := store.MarkEconomicNewsPost(context.Background(), evt.ID, now); err != nil {
					log.Printf("[Publisher] economic news post transition failed id=%d: %v", evt.ID, err)
				} else {
					evt.Status = newsPhasePost
				}
			case newsPhaseCompleted:
				_ = ensureEventActual(store, evt, now)
				if err := store.MarkEconomicNewsCompleted(context.Background(), evt.ID, now); err != nil {
					log.Printf("[Publisher] economic news complete transition failed id=%d: %v", evt.ID, err)
				} else {
					evt.Status = newsPhaseCompleted
				}
			}
		}

		if evt.Status != newsPhasePre && evt.Status != newsPhaseLive && evt.Status != newsPhasePost {
			continue
		}
		priority := phasePriority(evt.Status)
		if !best.Active || priority < bestPriority || (priority == bestPriority && (bestScheduled.IsZero() || evt.ScheduledAt.Before(bestScheduled))) {
			effect := effectForPhase(*evt, evt.Status)
			best = effect
			bestPriority = priority
			bestScheduled = evt.ScheduledAt
		}
	}

	return best, nil
}

func tashkentLocation() *time.Location {
	loc, err := time.LoadLocation("Asia/Tashkent")
	if err == nil {
		return loc
	}
	return time.FixedZone("Asia/Tashkent", 5*60*60)
}

func firstWeekdayOfMonth(year int, month time.Month, weekday time.Weekday, hour, minute int, loc *time.Location) time.Time {
	d := time.Date(year, month, 1, hour, minute, 0, 0, loc)
	for d.Weekday() != weekday {
		d = d.AddDate(0, 0, 1)
	}
	return d
}

func endOfMonthTime(year int, month time.Month, hour, minute int, loc *time.Location) time.Time {
	firstNext := time.Date(year, month, 1, hour, minute, 0, 0, loc).AddDate(0, 1, 0)
	return firstNext.AddDate(0, 0, -1)
}

func autoForecast(ruleKey string, year int, month time.Month) float64 {
	seed := int64(year*1000 + int(month)*17)
	base := 55.0
	span := 14.0
	if ruleKey == "auto_first_friday" {
		base = 180.0
		span = 38.0
	}
	jitter := (rand01(seed^0x5218A7C37A4B1E63) * 2.0) - 1.0
	value := base + jitter*span
	if value < 0.01 {
		value = 0.01
	}
	return math.Round(value*100) / 100
}

func ensureEconomicNewsCalendar(store *sessions.Store, pair string, now time.Time) {
	if store == nil {
		return
	}
	loc := tashkentLocation()
	localNow := now.In(loc)
	monthBase := time.Date(localNow.Year(), localNow.Month(), 1, 0, 0, 0, 0, loc)
	ctx := context.Background()
	for i := 0; i < 6; i++ {
		monthStart := monthBase.AddDate(0, i, 0)
		year := monthStart.Year()
		month := monthStart.Month()

		firstFriday := firstWeekdayOfMonth(year, month, time.Friday, 19, 30, loc)
		_ = store.EnsureAutoEconomicNews(ctx, sessions.CreateEconomicNewsInput{
			Pair:         pair,
			Title:        "Monthly Payroll Outlook",
			Impact:       "high",
			RuleKey:      "auto_first_friday",
			Source:       "auto",
			Forecast:     autoForecast("auto_first_friday", year, month),
			PreSeconds:   defaultNewsPreSec,
			EventSeconds: defaultNewsLiveSec,
			PostSeconds:  defaultNewsPostSec,
			ScheduledAt:  firstFriday.UTC(),
			CreatedBy:    "system",
		})

		monthEnd := endOfMonthTime(year, month, 21, 0, loc)
		_ = store.EnsureAutoEconomicNews(ctx, sessions.CreateEconomicNewsInput{
			Pair:         pair,
			Title:        "Month-End Liquidity Rebalance",
			Impact:       "medium",
			RuleKey:      "auto_month_end",
			Source:       "auto",
			Forecast:     autoForecast("auto_month_end", year, month),
			PreSeconds:   defaultNewsPreSec,
			EventSeconds: defaultNewsLiveSec,
			PostSeconds:  defaultNewsPostSec,
			ScheduledAt:  monthEnd.UTC(),
			CreatedBy:    "system",
		})
	}
}
