package ledger

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func normalizeTelegramAppBaseURL(raw string) string {
	for _, candidate := range strings.Split(raw, ",") {
		v := strings.TrimSpace(candidate)
		if v == "" || v == "*" {
			continue
		}
		if strings.HasPrefix(v, "http://") || strings.HasPrefix(v, "https://") {
			return strings.TrimRight(v, "/")
		}
	}
	return ""
}

func (h *Handler) telegramNotificationLink(target string) string {
	base := strings.TrimRight(strings.TrimSpace(h.telegramAppBaseURL), "/")
	if base == "" {
		return ""
	}
	trimmed := strings.TrimSpace(target)
	if trimmed == "" {
		trimmed = "#notifications"
	}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		return trimmed
	}
	if strings.HasPrefix(trimmed, "#") {
		return base + "/" + trimmed
	}
	if strings.HasPrefix(trimmed, "/") {
		return base + trimmed
	}
	return base + "/" + trimmed
}

func (h *Handler) notifyUserTelegramAsync(userID, title, message, target string) {
	if strings.TrimSpace(userID) == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		h.NotifyUserImportantTelegram(ctx, userID, title, message, target)
	}()
}

func (h *Handler) NotifyUserImportantTelegram(ctx context.Context, userID, title, message, target string) {
	if !h.telegramNotifyEnabled {
		return
	}
	if strings.TrimSpace(h.tgBotToken) == "" {
		return
	}
	if strings.TrimSpace(userID) == "" {
		return
	}

	var telegramID int64
	var writeAllowed bool
	err := h.svc.pool.QueryRow(ctx, `
		SELECT COALESCE(telegram_id, 0), COALESCE(telegram_write_access, FALSE)
		FROM users
		WHERE id = $1
	`, userID).Scan(&telegramID, &writeAllowed)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isUndefinedColumnError(err) {
			return
		}
		return
	}
	if telegramID == 0 || !writeAllowed {
		return
	}

	cleanTitle := strings.TrimSpace(title)
	cleanMessage := strings.TrimSpace(message)
	if cleanTitle == "" || cleanMessage == "" {
		return
	}

	text := fmt.Sprintf("<b>%s</b>\n%s", safeHTML(cleanTitle), safeHTML(cleanMessage))
	payload := map[string]interface{}{
		"chat_id":    telegramID,
		"text":       text,
		"parse_mode": "HTML",
	}

	if link := h.telegramNotificationLink(target); link != "" {
		payload["reply_markup"] = map[string]interface{}{
			"inline_keyboard": [][]map[string]string{{
				{
					"text": "Open in app",
					"url":  link,
				},
			}},
		}
	}

	_ = h.telegramCallJSON(ctx, "sendMessage", payload, nil)
}
