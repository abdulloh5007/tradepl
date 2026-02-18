package support

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultPageLimit = 50
	maxPageLimit     = 200
	maxMessageRunes  = 2000
)

var (
	ErrConversationNotFound = errors.New("conversation not found")
	ErrMessageRequired      = errors.New("message is required")
	ErrMessageTooLong       = errors.New("message is too long")
	ErrInvalidStatus        = errors.New("invalid status")
)

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

type Conversation struct {
	ID                string    `json:"id"`
	UserID            string    `json:"user_id,omitempty"`
	UserEmail         string    `json:"user_email,omitempty"`
	UserDisplayName   string    `json:"user_display_name,omitempty"`
	Status            string    `json:"status"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
	LastMessageAt     time.Time `json:"last_message_at"`
	LastMessageText   string    `json:"last_message_text"`
	LastMessageFrom   string    `json:"last_message_from"`
	UnreadForUser     int       `json:"unread_for_user"`
	UnreadForAdmin    int       `json:"unread_for_admin"`
	TotalMessageCount int       `json:"total_message_count"`
}

type Message struct {
	ID                  int64     `json:"id"`
	ConversationID      string    `json:"conversation_id"`
	SenderType          string    `json:"sender_type"`
	SenderAdminUsername string    `json:"sender_admin_username,omitempty"`
	Body                string    `json:"body"`
	ReadByUser          bool      `json:"read_by_user"`
	ReadByAdmin         bool      `json:"read_by_admin"`
	CreatedAt           time.Time `json:"created_at"`
}

func normalizeLimit(limit int) int {
	if limit <= 0 {
		return defaultPageLimit
	}
	if limit > maxPageLimit {
		return maxPageLimit
	}
	return limit
}

func normalizeStatus(raw string) (string, error) {
	status := strings.ToLower(strings.TrimSpace(raw))
	if status == "" {
		status = "all"
	}
	switch status {
	case "all", "open", "closed":
		return status, nil
	default:
		return "", ErrInvalidStatus
	}
}

func normalizeMessage(raw string) (string, error) {
	msg := strings.TrimSpace(raw)
	if msg == "" {
		return "", ErrMessageRequired
	}
	if len([]rune(msg)) > maxMessageRunes {
		return "", ErrMessageTooLong
	}
	return msg, nil
}

func reverseMessages(messages []Message) {
	for left, right := 0, len(messages)-1; left < right; left, right = left+1, right-1 {
		messages[left], messages[right] = messages[right], messages[left]
	}
}

func (s *Service) GetConversationForUser(ctx context.Context, userID string) (*Conversation, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT
			c.id::text,
			c.user_id::text,
			c.status,
			c.created_at,
			c.updated_at,
			COALESCE(last_m.created_at, c.updated_at) AS last_message_at,
			COALESCE(last_m.body, '') AS last_message_text,
			COALESCE(last_m.sender_type, '') AS last_message_from,
			(SELECT COUNT(*) FROM support_messages m WHERE m.conversation_id = c.id AND m.sender_type IN ('admin', 'system') AND m.read_by_user = FALSE)::int AS unread_for_user,
			(SELECT COUNT(*) FROM support_messages m WHERE m.conversation_id = c.id AND m.sender_type = 'user' AND m.read_by_admin = FALSE)::int AS unread_for_admin,
			(SELECT COUNT(*) FROM support_messages m WHERE m.conversation_id = c.id)::int AS total_message_count
		FROM support_conversations c
		LEFT JOIN LATERAL (
			SELECT m.body, m.sender_type, m.created_at
			FROM support_messages m
			WHERE m.conversation_id = c.id
			ORDER BY m.id DESC
			LIMIT 1
		) last_m ON TRUE
		WHERE c.user_id = $1::uuid
	`, userID)

	var conversation Conversation
	if err := row.Scan(
		&conversation.ID,
		&conversation.UserID,
		&conversation.Status,
		&conversation.CreatedAt,
		&conversation.UpdatedAt,
		&conversation.LastMessageAt,
		&conversation.LastMessageText,
		&conversation.LastMessageFrom,
		&conversation.UnreadForUser,
		&conversation.UnreadForAdmin,
		&conversation.TotalMessageCount,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &conversation, nil
}

func (s *Service) ListMessagesForUser(ctx context.Context, userID string, beforeID int64, limit int) ([]Message, error) {
	limit = normalizeLimit(limit)
	args := []any{userID}
	query := `
		SELECT
			m.id,
			m.conversation_id::text,
			m.sender_type,
			COALESCE(m.sender_admin_username, '') AS sender_admin_username,
			m.body,
			m.read_by_user,
			m.read_by_admin,
			m.created_at
		FROM support_messages m
		JOIN support_conversations c ON c.id = m.conversation_id
		WHERE c.user_id = $1::uuid
	`
	if beforeID > 0 {
		query += fmt.Sprintf(" AND m.id < $%d", len(args)+1)
		args = append(args, beforeID)
	}
	query += fmt.Sprintf(" ORDER BY m.id DESC LIMIT $%d", len(args)+1)
	args = append(args, limit)

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := make([]Message, 0, limit)
	for rows.Next() {
		var item Message
		if err := rows.Scan(
			&item.ID,
			&item.ConversationID,
			&item.SenderType,
			&item.SenderAdminUsername,
			&item.Body,
			&item.ReadByUser,
			&item.ReadByAdmin,
			&item.CreatedAt,
		); err != nil {
			return nil, err
		}
		messages = append(messages, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	reverseMessages(messages)
	return messages, nil
}

func (s *Service) SendUserMessage(ctx context.Context, userID, rawMessage string) (*Message, error) {
	message, err := normalizeMessage(rawMessage)
	if err != nil {
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		INSERT INTO support_conversations (user_id, status)
		VALUES ($1::uuid, 'open')
		ON CONFLICT (user_id) DO NOTHING
	`, userID); err != nil {
		return nil, err
	}

	var conversationID string
	if err := tx.QueryRow(ctx, `
		SELECT id::text
		FROM support_conversations
		WHERE user_id = $1::uuid
		FOR UPDATE
	`, userID).Scan(&conversationID); err != nil {
		return nil, err
	}

	var created Message
	if err := tx.QueryRow(ctx, `
		INSERT INTO support_messages (
			conversation_id, sender_type, sender_user_id, body, read_by_user, read_by_admin
		) VALUES (
			$1::uuid, 'user', $2::uuid, $3, TRUE, FALSE
		)
		RETURNING
			id,
			conversation_id::text,
			sender_type,
			COALESCE(sender_admin_username, '') AS sender_admin_username,
			body,
			read_by_user,
			read_by_admin,
			created_at
	`, conversationID, userID, message).Scan(
		&created.ID,
		&created.ConversationID,
		&created.SenderType,
		&created.SenderAdminUsername,
		&created.Body,
		&created.ReadByUser,
		&created.ReadByAdmin,
		&created.CreatedAt,
	); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE support_conversations
		SET status = 'open',
			updated_at = NOW(),
			last_user_message_at = NOW()
		WHERE id = $1::uuid
	`, conversationID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &created, nil
}

func (s *Service) MarkReadByUser(ctx context.Context, userID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE support_messages m
		SET read_by_user = TRUE
		WHERE m.conversation_id = (
			SELECT c.id FROM support_conversations c WHERE c.user_id = $1::uuid
		)
		AND m.sender_type IN ('admin', 'system')
		AND m.read_by_user = FALSE
	`, userID)
	return err
}

func (s *Service) ListConversationsForAdmin(ctx context.Context, status string, before *time.Time, limit int) ([]Conversation, error) {
	normStatus, err := normalizeStatus(status)
	if err != nil {
		return nil, err
	}
	limit = normalizeLimit(limit)

	args := []any{}
	query := `
		SELECT
			c.id::text,
			c.user_id::text,
			COALESCE(u.email, '') AS user_email,
			COALESCE(u.display_name, '') AS user_display_name,
			c.status,
			c.created_at,
			c.updated_at,
			COALESCE(last_m.created_at, c.updated_at) AS last_message_at,
			COALESCE(last_m.body, '') AS last_message_text,
			COALESCE(last_m.sender_type, '') AS last_message_from,
			(SELECT COUNT(*) FROM support_messages m WHERE m.conversation_id = c.id AND m.sender_type IN ('admin', 'system') AND m.read_by_user = FALSE)::int AS unread_for_user,
			(SELECT COUNT(*) FROM support_messages m WHERE m.conversation_id = c.id AND m.sender_type = 'user' AND m.read_by_admin = FALSE)::int AS unread_for_admin,
			(SELECT COUNT(*) FROM support_messages m WHERE m.conversation_id = c.id)::int AS total_message_count
		FROM support_conversations c
		JOIN users u ON u.id = c.user_id
		LEFT JOIN LATERAL (
			SELECT m.body, m.sender_type, m.created_at
			FROM support_messages m
			WHERE m.conversation_id = c.id
			ORDER BY m.id DESC
			LIMIT 1
		) last_m ON TRUE
		WHERE 1=1
	`

	if normStatus != "all" {
		query += fmt.Sprintf(" AND c.status = $%d", len(args)+1)
		args = append(args, normStatus)
	}
	if before != nil {
		query += fmt.Sprintf(" AND c.updated_at < $%d", len(args)+1)
		args = append(args, *before)
	}
	query += fmt.Sprintf(" ORDER BY c.updated_at DESC LIMIT $%d", len(args)+1)
	args = append(args, limit)

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]Conversation, 0, limit)
	for rows.Next() {
		var item Conversation
		if err := rows.Scan(
			&item.ID,
			&item.UserID,
			&item.UserEmail,
			&item.UserDisplayName,
			&item.Status,
			&item.CreatedAt,
			&item.UpdatedAt,
			&item.LastMessageAt,
			&item.LastMessageText,
			&item.LastMessageFrom,
			&item.UnreadForUser,
			&item.UnreadForAdmin,
			&item.TotalMessageCount,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) ListMessagesForAdmin(ctx context.Context, conversationID string, beforeID int64, limit int) ([]Message, error) {
	limit = normalizeLimit(limit)
	args := []any{conversationID}
	query := `
		SELECT
			m.id,
			m.conversation_id::text,
			m.sender_type,
			COALESCE(m.sender_admin_username, '') AS sender_admin_username,
			m.body,
			m.read_by_user,
			m.read_by_admin,
			m.created_at
		FROM support_messages m
		WHERE m.conversation_id = $1::uuid
	`
	if beforeID > 0 {
		query += fmt.Sprintf(" AND m.id < $%d", len(args)+1)
		args = append(args, beforeID)
	}
	query += fmt.Sprintf(" ORDER BY m.id DESC LIMIT $%d", len(args)+1)
	args = append(args, limit)

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := make([]Message, 0, limit)
	for rows.Next() {
		var item Message
		if err := rows.Scan(
			&item.ID,
			&item.ConversationID,
			&item.SenderType,
			&item.SenderAdminUsername,
			&item.Body,
			&item.ReadByUser,
			&item.ReadByAdmin,
			&item.CreatedAt,
		); err != nil {
			return nil, err
		}
		messages = append(messages, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	reverseMessages(messages)
	return messages, nil
}

func (s *Service) SendAdminMessage(ctx context.Context, conversationID, adminUsername, rawMessage string) (*Message, error) {
	message, err := normalizeMessage(rawMessage)
	if err != nil {
		return nil, err
	}
	adminUsername = strings.TrimSpace(adminUsername)
	if adminUsername == "" {
		adminUsername = "admin"
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var existingID string
	if err := tx.QueryRow(ctx, `
		SELECT id::text
		FROM support_conversations
		WHERE id = $1::uuid
		FOR UPDATE
	`, conversationID).Scan(&existingID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrConversationNotFound
		}
		return nil, err
	}

	var created Message
	if err := tx.QueryRow(ctx, `
		INSERT INTO support_messages (
			conversation_id, sender_type, sender_admin_username, body, read_by_user, read_by_admin
		) VALUES (
			$1::uuid, 'admin', $2, $3, FALSE, TRUE
		)
		RETURNING
			id,
			conversation_id::text,
			sender_type,
			COALESCE(sender_admin_username, '') AS sender_admin_username,
			body,
			read_by_user,
			read_by_admin,
			created_at
	`, existingID, adminUsername, message).Scan(
		&created.ID,
		&created.ConversationID,
		&created.SenderType,
		&created.SenderAdminUsername,
		&created.Body,
		&created.ReadByUser,
		&created.ReadByAdmin,
		&created.CreatedAt,
	); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE support_conversations
		SET status = 'open',
			updated_at = NOW(),
			last_admin_message_at = NOW()
		WHERE id = $1::uuid
	`, existingID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &created, nil
}

func (s *Service) SetConversationStatus(ctx context.Context, conversationID, status string) error {
	normStatus, err := normalizeStatus(status)
	if err != nil || normStatus == "all" {
		return ErrInvalidStatus
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE support_conversations
		SET status = $2,
			updated_at = NOW()
		WHERE id = $1::uuid
	`, conversationID, normStatus)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrConversationNotFound
	}
	return nil
}

func (s *Service) MarkReadByAdmin(ctx context.Context, conversationID string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE support_messages
		SET read_by_admin = TRUE
		WHERE conversation_id = $1::uuid
		  AND sender_type = 'user'
		  AND read_by_admin = FALSE
	`, conversationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// Make sure conversation exists even when there are no unread messages.
		var exists bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM support_conversations WHERE id = $1::uuid)`, conversationID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrConversationNotFound
		}
	}
	return nil
}
