package support

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"lv-tradepl/internal/httputil"

	"github.com/go-chi/chi/v5"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func parseLimit(raw string) (int, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return defaultPageLimit, nil
	}
	limit, err := strconv.Atoi(value)
	if err != nil || limit <= 0 {
		return 0, errors.New("invalid limit")
	}
	if limit > maxPageLimit {
		limit = maxPageLimit
	}
	return limit, nil
}

func parseBeforeID(raw string) (int64, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return 0, nil
	}
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("invalid before_id")
	}
	return id, nil
}

func parseBeforeTime(raw string) (*time.Time, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		parsed, err = time.Parse(time.RFC3339, value)
	}
	if err != nil {
		return nil, errors.New("invalid before")
	}
	return &parsed, nil
}

func writeValidationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrConversationNotFound), errors.Is(err, ErrInvalidStatus):
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
	case errors.Is(err, ErrMessageRequired), errors.Is(err, ErrMessageTooLong):
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
	case errors.Is(err, ErrTemplateRequired), errors.Is(err, ErrTemplateTitle), errors.Is(err, ErrTemplateMessage), errors.Is(err, ErrTemplateKey), errors.Is(err, ErrTemplateDuplicateKey):
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
	default:
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
	}
}

func (h *Handler) GetConversation(w http.ResponseWriter, r *http.Request, userID string) {
	conversation, err := h.svc.GetConversationForUser(r.Context(), userID)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"conversation": conversation,
	})
}

func (h *Handler) ListMessages(w http.ResponseWriter, r *http.Request, userID string) {
	limit, err := parseLimit(r.URL.Query().Get("limit"))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	beforeID, err := parseBeforeID(r.URL.Query().Get("before_id"))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	items, err := h.svc.ListMessagesForUser(r.Context(), userID, beforeID, limit)
	if err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if items == nil {
		items = []Message{}
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) SendMessage(w http.ResponseWriter, r *http.Request, userID string) {
	var req struct {
		Message string `json:"message"`
	}
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	created, err := h.svc.SendUserMessage(r.Context(), userID, req.Message)
	if err != nil {
		writeValidationError(w, err)
		return
	}
	httputil.WriteJSON(w, http.StatusCreated, created)
}

func (h *Handler) MarkRead(w http.ResponseWriter, r *http.Request, userID string) {
	if err := h.svc.MarkReadByUser(r.Context(), userID); err != nil {
		httputil.WriteJSON(w, http.StatusInternalServerError, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) AdminListConversations(w http.ResponseWriter, r *http.Request) {
	limit, err := parseLimit(r.URL.Query().Get("limit"))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	before, err := parseBeforeTime(r.URL.Query().Get("before"))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	items, err := h.svc.ListConversationsForAdmin(r.Context(), status, before, limit)
	if err != nil {
		writeValidationError(w, err)
		return
	}
	if items == nil {
		items = []Conversation{}
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) AdminListMessages(w http.ResponseWriter, r *http.Request) {
	conversationID := strings.TrimSpace(r.URL.Query().Get("conversation_id"))
	if conversationID == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "conversation_id is required"})
		return
	}
	limit, err := parseLimit(r.URL.Query().Get("limit"))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	beforeID, err := parseBeforeID(r.URL.Query().Get("before_id"))
	if err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}

	items, err := h.svc.ListMessagesForAdmin(r.Context(), conversationID, beforeID, limit)
	if err != nil {
		writeValidationError(w, err)
		return
	}
	if items == nil {
		items = []Message{}
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) AdminSendMessage(w http.ResponseWriter, r *http.Request, adminUsername string) {
	var req struct {
		ConversationID string `json:"conversation_id"`
		Message        string `json:"message"`
	}
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	created, err := h.svc.SendAdminMessage(r.Context(), req.ConversationID, adminUsername, req.Message)
	if err != nil {
		writeValidationError(w, err)
		return
	}
	httputil.WriteJSON(w, http.StatusCreated, created)
}

func (h *Handler) AdminSetConversationStatus(w http.ResponseWriter, r *http.Request) {
	conversationID := strings.TrimSpace(chi.URLParam(r, "id"))
	if conversationID == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "conversation id is required"})
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	if err := h.svc.SetConversationStatus(r.Context(), conversationID, req.Status); err != nil {
		writeValidationError(w, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) AdminMarkRead(w http.ResponseWriter, r *http.Request) {
	conversationID := strings.TrimSpace(chi.URLParam(r, "id"))
	if conversationID == "" {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: "conversation id is required"})
		return
	}
	if err := h.svc.MarkReadByAdmin(r.Context(), conversationID); err != nil {
		writeValidationError(w, err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) AdminListReplyTemplates(w http.ResponseWriter, r *http.Request, includeDisabled bool) {
	items, err := h.svc.ListReplyTemplates(r.Context(), includeDisabled)
	if err != nil {
		writeValidationError(w, err)
		return
	}
	if items == nil {
		items = []ReplyTemplate{}
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) AdminReplaceReplyTemplates(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Items []ReplyTemplateInput `json:"items"`
	}
	if err := httputil.ReadJSON(r, &req); err != nil {
		httputil.WriteJSON(w, http.StatusBadRequest, httputil.ErrorResponse{Error: err.Error()})
		return
	}
	items, err := h.svc.ReplaceReplyTemplates(r.Context(), req.Items)
	if err != nil {
		writeValidationError(w, err)
		return
	}
	if items == nil {
		items = []ReplyTemplate{}
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}
