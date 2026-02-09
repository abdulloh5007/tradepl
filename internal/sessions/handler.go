package sessions

import (
	"encoding/json"
	"net/http"
	"strconv"
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
	dateTo := now

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

	result, err := h.store.GetEventsPaginated(r.Context(), limit, offset, dateFrom, dateTo)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if result.Events == nil {
		result.Events = []PriceEvent{}
	}
	httputil.WriteJSON(w, http.StatusOK, result)
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

	scheduledAt, err := time.Parse(time.RFC3339, req.ScheduledAt)
	if err != nil {
		// If parsing fails, schedule for now
		scheduledAt = time.Now()
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
