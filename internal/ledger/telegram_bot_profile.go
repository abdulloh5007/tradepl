package ledger

import (
	"context"
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

	var me struct {
		Username string `json:"username"`
	}
	if err := h.telegramCallJSON(ctx, "getMe", map[string]interface{}{}, &me); err != nil {
		return ""
	}
	resolved := strings.TrimSpace(strings.TrimPrefix(me.Username, "@"))
	if resolved == "" {
		return ""
	}
	h.setTelegramBotUsernameCached(resolved)
	return resolved
}
