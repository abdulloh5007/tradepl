package ledger

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type telegramNotificationKind string

const (
	telegramNotificationKindSystem   telegramNotificationKind = "system"
	telegramNotificationKindBonus    telegramNotificationKind = "bonus"
	telegramNotificationKindDeposit  telegramNotificationKind = "deposit"
	telegramNotificationKindNews     telegramNotificationKind = "news"
	telegramNotificationKindReferral telegramNotificationKind = "referral"
)

type telegramNotificationKinds struct {
	System   bool
	Bonus    bool
	Deposit  bool
	News     bool
	Referral bool
}

func defaultTelegramNotificationKinds() telegramNotificationKinds {
	return telegramNotificationKinds{
		System:   false,
		Bonus:    false,
		Deposit:  true,
		News:     false,
		Referral: true,
	}
}

func normalizeTelegramNotificationKind(raw string) telegramNotificationKind {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case string(telegramNotificationKindBonus):
		return telegramNotificationKindBonus
	case string(telegramNotificationKindDeposit):
		return telegramNotificationKindDeposit
	case string(telegramNotificationKindNews):
		return telegramNotificationKindNews
	case string(telegramNotificationKindReferral):
		return telegramNotificationKindReferral
	default:
		return telegramNotificationKindSystem
	}
}

func (k telegramNotificationKinds) allows(kind telegramNotificationKind) bool {
	switch kind {
	case telegramNotificationKindBonus:
		return k.Bonus
	case telegramNotificationKindDeposit:
		return k.Deposit
	case telegramNotificationKindNews:
		return k.News
	case telegramNotificationKindReferral:
		return k.Referral
	default:
		return k.System
	}
}

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

func (h *Handler) notifyUserTelegramAsync(userID, kind, title, message, target string) {
	if strings.TrimSpace(userID) == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		h.NotifyUserImportantTelegram(ctx, userID, kind, title, message, target)
	}()
}

func (h *Handler) NotifyUserImportantTelegram(ctx context.Context, userID, kind, title, message, target string) {
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
	var notificationsEnabled bool
	notificationKinds := defaultTelegramNotificationKinds()
	err := h.svc.pool.QueryRow(ctx, `
		SELECT
			COALESCE(telegram_id, 0),
			COALESCE(telegram_write_access, FALSE),
			COALESCE(telegram_notifications_enabled, TRUE),
			COALESCE((telegram_notification_kinds->>'system')::boolean, FALSE),
			COALESCE((telegram_notification_kinds->>'bonus')::boolean, FALSE),
			COALESCE((telegram_notification_kinds->>'deposit')::boolean, TRUE),
			COALESCE((telegram_notification_kinds->>'news')::boolean, FALSE),
			COALESCE((telegram_notification_kinds->>'referral')::boolean, TRUE)
		FROM users
		WHERE id = $1
	`, userID).Scan(
		&telegramID,
		&writeAllowed,
		&notificationsEnabled,
		&notificationKinds.System,
		&notificationKinds.Bonus,
		&notificationKinds.Deposit,
		&notificationKinds.News,
		&notificationKinds.Referral,
	)
	if err != nil {
		if isUndefinedColumnError(err) {
			err = h.svc.pool.QueryRow(ctx, `
				SELECT COALESCE(telegram_id, 0), COALESCE(telegram_write_access, FALSE)
				FROM users
				WHERE id = $1
			`, userID).Scan(&telegramID, &writeAllowed)
			if err == nil {
				notificationsEnabled = true
				notificationKinds = defaultTelegramNotificationKinds()
			}
		}
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isUndefinedColumnError(err) {
			return
		}
		return
	}
	if telegramID == 0 || !writeAllowed || !notificationsEnabled {
		return
	}
	if !notificationKinds.allows(normalizeTelegramNotificationKind(kind)) {
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

	if err := h.telegramCallJSON(ctx, "sendMessage", payload, nil); err != nil {
		if isTelegramBlockedError(err) {
			_, _ = h.svc.pool.Exec(ctx, `
				UPDATE users
				SET telegram_write_access = FALSE
				WHERE id = $1
			`, userID)
		}
	}
}

func isTelegramBlockedError(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(strings.TrimSpace(err.Error()))
	if text == "" {
		return false
	}
	return strings.Contains(text, "bot was blocked by the user") ||
		strings.Contains(text, "forbidden: bot was blocked") ||
		strings.Contains(text, "chat not found") ||
		strings.Contains(text, "forbidden")
}
