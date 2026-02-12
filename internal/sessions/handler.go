package sessions

import (
	"encoding/json"
	"net/http"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"lv-tradepl/internal/httputil"
)

// Handler handles admin API requests for sessions
type Handler struct {
	store *Store
}

// NewHandler creates a new sessions handler
func NewHandler(store *Store) *Handler {
	return &Handler{store: store}
}

// --- Session Config Endpoints ---

// GetSessions returns all session configurations
func (h *Handler) GetSessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := h.store.GetAllSessions(r.Context())
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, sessions)
}

// GetActiveSession returns the currently active session
func (h *Handler) GetActiveSession(w http.ResponseWriter, r *http.Request) {
	session, err := h.store.GetActiveSession(r.Context())
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, session)
}

// SwitchSession activates a different session
func (h *Handler) SwitchSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SessionID string `json:"session_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request body"})
		return
	}
	if req.SessionID == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "session_id is required"})
		return
	}

	if err := h.store.SwitchSession(r.Context(), req.SessionID); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	// Notify publisher about session change (via global channel - to be implemented)
	NotifySessionChange(req.SessionID)

	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok", "session": req.SessionID})
}

// --- Mode Endpoints (Auto/Manual) ---

// GetMode returns the current session mode
func (h *Handler) GetMode(w http.ResponseWriter, r *http.Request) {
	mode, err := h.store.GetSetting(r.Context(), SettingSessionMode)
	if err != nil {
		mode = "manual"
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"mode": mode})
}

// SetMode sets the session mode (auto/manual)
func (h *Handler) SetMode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request body"})
		return
	}
	if req.Mode != "auto" && req.Mode != "manual" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "mode must be 'auto' or 'manual'"})
		return
	}

	if err := h.store.SetSetting(r.Context(), SettingSessionMode, req.Mode); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok", "mode": req.Mode})
}

// --- Trend Endpoints ---

// GetTrend returns the current trend bias
func (h *Handler) GetTrend(w http.ResponseWriter, r *http.Request) {
	trend, err := h.store.GetSetting(r.Context(), SettingCurrentTrend)
	if err != nil {
		trend = "random"
	}
	expiresAtMs := int64(0)
	if raw, err := h.store.GetSetting(r.Context(), SettingTrendManualUntil); err == nil && raw != "" {
		if parsed, perr := strconv.ParseInt(raw, 10, 64); perr == nil && parsed > time.Now().UnixMilli() {
			expiresAtMs = parsed
		}
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"trend":      trend,
		"expires_at": expiresAtMs,
	})
}

// GetTrendMode returns current trend mode (auto/manual)
func (h *Handler) GetTrendMode(w http.ResponseWriter, r *http.Request) {
	mode, err := h.store.GetSetting(r.Context(), SettingTrendMode)
	if err != nil || (mode != "auto" && mode != "manual") {
		mode = "auto"
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"mode": mode})
}

// GetTrendState returns current auto-trend runtime state
func (h *Handler) GetTrendState(w http.ResponseWriter, r *http.Request) {
	if getTrendStateFn != nil {
		state := getTrendStateFn()
		httputil.WriteJSON(w, http.StatusOK, state)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"active":         false,
		"trend":          "random",
		"session_id":     "",
		"next_switch_at": 0,
		"remaining_sec":  0,
	})
}

// SetTrendMode sets trend mode (auto/manual)
func (h *Handler) SetTrendMode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request body"})
		return
	}
	if req.Mode != "auto" && req.Mode != "manual" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "mode must be 'auto' or 'manual'"})
		return
	}
	if err := h.store.SetSetting(r.Context(), SettingTrendMode, req.Mode); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok", "mode": req.Mode})
}

// SetTrend sets the trend bias (bullish/bearish/sideways/random)
func (h *Handler) SetTrend(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Trend           string `json:"trend"`
		DurationSeconds int    `json:"duration_seconds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request body"})
		return
	}
	validTrends := map[string]bool{"bullish": true, "bearish": true, "sideways": true, "random": true}
	if !validTrends[req.Trend] {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "trend must be bullish, bearish, sideways, or random"})
		return
	}

	expiresAtMs := int64(0)
	if req.Trend == "bullish" || req.Trend == "bearish" {
		if req.DurationSeconds == 0 {
			req.DurationSeconds = 180
		}
		if req.DurationSeconds != 180 && req.DurationSeconds != 300 {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "duration_seconds must be 180 or 300"})
			return
		}
		expiresAtMs = time.Now().Add(time.Duration(req.DurationSeconds) * time.Second).UnixMilli()
		if err := h.store.SetSetting(r.Context(), SettingTrendManualUntil, strconv.FormatInt(expiresAtMs, 10)); err != nil {
			httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
			return
		}
	} else {
		_ = h.store.SetSetting(r.Context(), SettingTrendManualUntil, "0")
	}
	if err := h.store.SetSetting(r.Context(), SettingCurrentTrend, req.Trend); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	// Manual trend change acts as explicit override.
	_ = h.store.SetSetting(r.Context(), SettingTrendMode, "manual")

	// Notify publisher about trend change
	NotifyTrendChange(req.Trend)

	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"status":           "ok",
		"trend":            req.Trend,
		"duration_seconds": req.DurationSeconds,
		"expires_at":       expiresAtMs,
	})
}

// --- Price Event Endpoints ---

// GetEvents returns price events with pagination and date filtering
func (h *Handler) GetEvents(w http.ResponseWriter, r *http.Request) {
	// Parse query params
	q := r.URL.Query()

	// Limit (default 20)
	limit := 20
	if l := q.Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	// Offset (default 0)
	offset := 0
	if o := q.Get("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	// Date range (default: today)
	now := time.Now()
	dateFrom := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	dateTo := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, int(time.Second-time.Nanosecond), now.Location())

	if df := q.Get("date_from"); df != "" {
		if parsed, err := time.Parse(time.RFC3339, df); err == nil {
			dateFrom = parsed
		}
	}
	if dt := q.Get("date_to"); dt != "" {
		if parsed, err := time.Parse(time.RFC3339, dt); err == nil {
			dateTo = parsed
		}
	}

	autoEvents := extractAutoPendingEvents(getTrendStateSnapshot(), dateFrom, dateTo)
	autoCount := len(autoEvents)

	autoFrom := 0
	autoTo := 0
	remainingLimit := limit
	dbOffset := 0

	if offset < autoCount {
		autoFrom = offset
		autoTo = autoFrom + limit
		if autoTo > autoCount {
			autoTo = autoCount
		}
		remainingLimit = limit - (autoTo - autoFrom)
		dbOffset = 0
	} else {
		remainingLimit = limit
		dbOffset = offset - autoCount
	}

	dbLimit := remainingLimit
	if dbLimit <= 0 {
		dbLimit = 1 // still fetch DB total count
	}

	result, err := h.store.GetEventsPaginated(r.Context(), dbLimit, dbOffset, dateFrom, dateTo)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	combined := make([]PriceEvent, 0, limit)
	if autoTo > autoFrom {
		combined = append(combined, autoEvents[autoFrom:autoTo]...)
	}
	if remainingLimit > 0 && len(result.Events) > 0 {
		combined = append(combined, result.Events...)
	}

	httputil.WriteJSON(w, http.StatusOK, EventsResult{
		Events: combined,
		Total:  result.Total + autoCount,
	})
}

// GetActiveEvent returns the current active event state
func (h *Handler) GetActiveEvent(w http.ResponseWriter, r *http.Request) {
	// Import marketdata package to get current event state
	// This is done via a callback set during initialization
	if getEventStateFn != nil {
		state := getEventStateFn()
		httputil.WriteJSON(w, http.StatusOK, state)
		return
	}
	// No active event
	httputil.WriteJSON(w, http.StatusOK, map[string]interface{}{"active": false})
}

// Callback for getting event state from marketdata package
var getEventStateFn func() interface{}
var getTrendStateFn func() interface{}

func getTrendStateSnapshot() interface{} {
	if getTrendStateFn == nil {
		return nil
	}
	return getTrendStateFn()
}

func extractAutoPendingEvents(state interface{}, dateFrom, dateTo time.Time) []PriceEvent {
	if state == nil {
		return nil
	}
	rv := reflect.ValueOf(state)
	if !rv.IsValid() {
		return nil
	}
	if rv.Kind() == reflect.Pointer {
		if rv.IsNil() {
			return nil
		}
		rv = rv.Elem()
	}
	if rv.Kind() != reflect.Struct {
		return nil
	}

	upcoming := rv.FieldByName("UpcomingEvents")
	if !upcoming.IsValid() || upcoming.Kind() != reflect.Slice {
		return nil
	}

	out := make([]PriceEvent, 0, upcoming.Len())
	for i := 0; i < upcoming.Len(); i++ {
		item := upcoming.Index(i)
		if item.Kind() == reflect.Pointer {
			if item.IsNil() {
				continue
			}
			item = item.Elem()
		}
		if item.Kind() != reflect.Struct {
			continue
		}

		status := strings.ToLower(strings.TrimSpace(reflectStringField(item, "Status")))
		if status == "" {
			status = "pending"
		}
		if status != "pending" {
			continue
		}

		direction := strings.ToLower(strings.TrimSpace(reflectStringField(item, "Direction")))
		if direction != "up" && direction != "down" {
			continue
		}

		scheduledMs := reflectInt64Field(item, "ScheduledAt")
		if scheduledMs <= 0 {
			continue
		}
		scheduledAt := time.UnixMilli(scheduledMs).UTC()
		if scheduledAt.Before(dateFrom) || scheduledAt.After(dateTo) {
			continue
		}

		duration := int(reflectInt64Field(item, "DurationSeconds"))
		if duration <= 0 {
			duration = 300
		}

		id := syntheticAutoEventID(scheduledMs, direction, duration, i)
		out = append(out, PriceEvent{
			ID:              id,
			Pair:            "UZS-USD",
			TargetPrice:     0,
			Direction:       direction,
			DurationSeconds: duration,
			ScheduledAt:     scheduledAt,
			Status:          "pending",
			Source:          "auto",
			CreatedAt:       scheduledAt,
		})
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].ScheduledAt.Before(out[j].ScheduledAt)
	})
	return out
}

func reflectStringField(v reflect.Value, field string) string {
	f := v.FieldByName(field)
	if !f.IsValid() || f.Kind() != reflect.String {
		return ""
	}
	return f.String()
}

func reflectInt64Field(v reflect.Value, field string) int64 {
	f := v.FieldByName(field)
	if !f.IsValid() {
		return 0
	}
	switch f.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return f.Int()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return int64(f.Uint())
	default:
		return 0
	}
}

func syntheticAutoEventID(scheduledMs int64, direction string, duration, index int) int {
	seed := scheduledMs + int64(duration*31) + int64(index+1)*7919
	if direction == "down" {
		seed += 104729
	}
	if seed < 0 {
		seed = -seed
	}
	seed = seed%1000000000 + 1
	return -int(seed)
}

// SetEventStateCallback sets the callback function to get current event state
func SetEventStateCallback(fn func() interface{}) {
	getEventStateFn = fn
}

// SetTrendStateCallback sets callback for auto-trend runtime state
func SetTrendStateCallback(fn func() interface{}) {
	getTrendStateFn = fn
}

// CreateEvent creates a new scheduled price event
func (h *Handler) CreateEvent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pair            string  `json:"pair"`
		TargetPrice     float64 `json:"target_price"`
		Direction       string  `json:"direction"`
		DurationSeconds int     `json:"duration_seconds"`
		ScheduledAt     string  `json:"scheduled_at"` // RFC3339 format
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request body"})
		return
	}

	// target_price is now optional (not used for triggering)
	if req.Direction != "up" && req.Direction != "down" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "direction must be 'up' or 'down'"})
		return
	}
	if req.DurationSeconds <= 0 {
		req.DurationSeconds = 300 // Default 5 minutes
	}
	if req.Pair == "" {
		req.Pair = "UZS-USD"
	}

	scheduledAt := time.Now().UTC()
	if strings.TrimSpace(req.ScheduledAt) != "" {
		parsed, err := time.Parse(time.RFC3339, req.ScheduledAt)
		if err != nil {
			httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "scheduled_at must be RFC3339"})
			return
		}
		scheduledAt = parsed.UTC()
	}

	event, err := h.store.CreateEvent(r.Context(), req.Pair, req.TargetPrice, req.Direction, req.DurationSeconds, scheduledAt)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	httputil.WriteJSON(w, http.StatusCreated, event)
}

// CancelEvent cancels a pending price event
func (h *Handler) CancelEvent(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	if idStr == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "event id is required"})
		return
	}
	id, err := strconv.Atoi(idStr)
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid event id"})
		return
	}

	if err := h.store.CancelEvent(r.Context(), id); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}

// --- Notification channels for publisher ---

var (
	sessionChangeCh = make(chan string, 1)
	trendChangeCh   = make(chan string, 1)
)

// NotifySessionChange sends session change notification
func NotifySessionChange(sessionID string) {
	select {
	case sessionChangeCh <- sessionID:
	default:
	}
}

// NotifyTrendChange sends trend change notification
func NotifyTrendChange(trend string) {
	select {
	case trendChangeCh <- trend:
	default:
	}
}

// SessionChangeChannel returns the session change channel for publisher to listen
func SessionChangeChannel() <-chan string {
	return sessionChangeCh
}

// TrendChangeChannel returns the trend change channel for publisher to listen
func TrendChangeChannel() <-chan string {
	return trendChangeCh
}
