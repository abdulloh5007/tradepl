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
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"trend": trend})
}

// SetTrend sets the trend bias (bullish/bearish/sideways/random)
func (h *Handler) SetTrend(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Trend string `json:"trend"`
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

	if err := h.store.SetSetting(r.Context(), SettingCurrentTrend, req.Trend); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	// Notify publisher about trend change
	NotifyTrendChange(req.Trend)

	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok", "trend": req.Trend})
}

// --- Price Event Endpoints ---

// GetEvents returns pending and active price events
func (h *Handler) GetEvents(w http.ResponseWriter, r *http.Request) {
	events, err := h.store.GetPendingEvents(r.Context())
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if events == nil {
		events = []PriceEvent{}
	}
	httputil.WriteJSON(w, http.StatusOK, events)
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

	if req.TargetPrice <= 0 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "target_price must be positive"})
		return
	}
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
