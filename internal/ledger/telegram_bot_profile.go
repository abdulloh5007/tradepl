package ledger

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

func (h *Handler) getTelegramBotUsernameCached() string {
	h.tgBotUsernameMu.RLock()
	defer h.tgBotUsernameMu.RUnlock()
	return strings.TrimSpace(strings.TrimPrefix(h.tgBotUsername, "@"))
}

func (h *Handler) setTelegramBotUsernameCached(value string) {
	normalized := strings.TrimSpace(strings.TrimPrefix(value, "@"))
	h.tgBotUsernameMu.Lock()
	h.tgBotUsername = normalized
	h.tgBotUsernameMu.Unlock()
}

func (h *Handler) telegramBotUsername(ctx context.Context) string {
	cached := h.getTelegramBotUsernameCached()
	if cached != "" {
		return cached
	}
	if strings.TrimSpace(h.tgBotToken) == "" {
		return ""
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.telegramMethodURL("getMe"), bytes.NewReader([]byte("{}")))
	if err != nil {
		return ""
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := h.telegramHTTPClient().Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return ""
	}

	var parsed telegramAPIBasicResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return ""
	}
	if !parsed.OK {
		return ""
	}

	var me struct {
		Username string `json:"username"`
	}
	if err := json.Unmarshal(parsed.Result, &me); err != nil {
		return ""
	}
	resolved := strings.TrimSpace(strings.TrimPrefix(me.Username, "@"))
	if resolved == "" {
		return ""
	}
	h.setTelegramBotUsernameCached(resolved)
	return resolved
}
