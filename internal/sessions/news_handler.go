package sessions

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"lv-tradepl/internal/httputil"
)

const (
	defaultNewsPreSeconds   = 15 * 60
	defaultNewsEventSeconds = 5 * 60
	defaultNewsPostSeconds  = 60 * 60
)

func parseNewsLimit(raw string, fallback, max int) int {
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return fallback
	}
	if n > max {
		return max
	}
	return n
}

func parseNewsOffset(raw string) int {
	if raw == "" {
		return 0
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

func parseRFC3339OrZero(raw string) (time.Time, bool) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return time.Time{}, false
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, false
	}
	return parsed.UTC(), true
}

func clampDuration(raw, fallback, min, max int) int {
	if raw <= 0 {
		raw = fallback
	}
	if raw < min {
		return min
	}
	if raw > max {
		return max
	}
	return raw
}

func normalizeImpact(raw string) string {
	impact := strings.ToLower(strings.TrimSpace(raw))
	if impact == "low" || impact == "medium" || impact == "high" {
		return impact
	}
	return ""
}

// PublicNewsUpcoming returns top upcoming economic news for authenticated users.
func (h *Handler) PublicNewsUpcoming(w http.ResponseWriter, r *http.Request) {
	pair := strings.TrimSpace(r.URL.Query().Get("pair"))
	limit := parseNewsLimit(r.URL.Query().Get("limit"), 3, 20)
	events, err := h.store.GetEconomicNewsUpcoming(r.Context(), pair, limit)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, events)
}

// PublicNewsRecent returns recent live/completed economic news for notification sync.
func (h *Handler) PublicNewsRecent(w http.ResponseWriter, r *http.Request) {
	pair := strings.TrimSpace(r.URL.Query().Get("pair"))
	limit := parseNewsLimit(r.URL.Query().Get("limit"), 20, 100)
	events, err := h.store.GetEconomicNewsRecent(r.Context(), pair, limit)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, events)
}

// AdminNewsEvents returns owner view of economic news events.
func (h *Handler) AdminNewsEvents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	pair := strings.TrimSpace(q.Get("pair"))
	limit := parseNewsLimit(q.Get("limit"), 20, 100)
	offset := parseNewsOffset(q.Get("offset"))

	now := time.Now().UTC()
	dateFrom := now.AddDate(0, -1, 0)
	dateTo := now.AddDate(0, 3, 0)
	if parsed, ok := parseRFC3339OrZero(q.Get("date_from")); ok {
		dateFrom = parsed
	}
	if parsed, ok := parseRFC3339OrZero(q.Get("date_to")); ok {
		dateTo = parsed
	}

	result, err := h.store.GetEconomicNewsPaginated(r.Context(), pair, limit, offset, dateFrom, dateTo)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, result)
}

// AdminCreateNewsEvent creates a manual economic news event (owner only).
func (h *Handler) AdminCreateNewsEvent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pair         string  `json:"pair"`
		Title        string  `json:"title"`
		Impact       string  `json:"impact"`
		Forecast     float64 `json:"forecast_value"`
		PreSeconds   int     `json:"pre_seconds"`
		EventSeconds int     `json:"event_seconds"`
		PostSeconds  int     `json:"post_seconds"`
		ScheduledAt  string  `json:"scheduled_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid request body"})
		return
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "title is required"})
		return
	}
	if len(title) > 120 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "title is too long"})
		return
	}
	impact := normalizeImpact(req.Impact)
	if impact == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "impact must be low, medium, or high"})
		return
	}
	scheduledAt, ok := parseRFC3339OrZero(req.ScheduledAt)
	if !ok {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "scheduled_at must be RFC3339"})
		return
	}
	if scheduledAt.Before(time.Now().UTC().Add(-1 * time.Minute)) {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "scheduled_at is in the past"})
		return
	}

	input := CreateEconomicNewsInput{
		Pair:         req.Pair,
		Title:        title,
		Impact:       impact,
		RuleKey:      "manual",
		Source:       "manual",
		Forecast:     req.Forecast,
		PreSeconds:   clampDuration(req.PreSeconds, defaultNewsPreSeconds, 60, 86400),
		EventSeconds: clampDuration(req.EventSeconds, defaultNewsEventSeconds, 60, 36000),
		PostSeconds:  clampDuration(req.PostSeconds, defaultNewsPostSeconds, 60, 172800),
		ScheduledAt:  scheduledAt,
		CreatedBy:    "owner",
	}

	evt, err := h.store.CreateEconomicNews(r.Context(), input)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusCreated, evt)
}

// AdminCancelNewsEvent cancels pending/pre event (owner only).
func (h *Handler) AdminCancelNewsEvent(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimSpace(r.PathValue("id"))
	if idStr == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "event id is required"})
		return
	}
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "invalid event id"})
		return
	}
	if err := h.store.CancelEconomicNews(r.Context(), id); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}
