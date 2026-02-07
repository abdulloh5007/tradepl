package admin

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AccessToken represents a temporary access token
type AccessToken struct {
	ID         int       `json:"id"`
	Token      string    `json:"token"`
	TokenType  string    `json:"token_type"` // "owner" or "admin"
	TelegramID int64     `json:"telegram_id"`
	ExpiresAt  time.Time `json:"expires_at"`
	CreatedAt  time.Time `json:"created_at"`
}

// PanelAdmin represents an admin with rights
type PanelAdmin struct {
	ID         int             `json:"id"`
	TelegramID int64           `json:"telegram_id"`
	Name       string          `json:"name"`
	Rights     map[string]bool `json:"rights"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
}

// TokenStore handles access tokens and panel admins
type TokenStore struct {
	pool *pgxpool.Pool
}

// NewTokenStore creates a new token store
func NewTokenStore(pool *pgxpool.Pool) *TokenStore {
	return &TokenStore{pool: pool}
}

// GenerateToken generates a random token string
func GenerateToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// CreateToken creates a new access token
func (s *TokenStore) CreateToken(ctx context.Context, tokenType string, telegramID int64, duration time.Duration) (*AccessToken, error) {
	token := GenerateToken()
	expiresAt := time.Now().Add(duration)

	var t AccessToken
	err := s.pool.QueryRow(ctx, `
		INSERT INTO access_tokens (token, token_type, telegram_id, expires_at)
		VALUES ($1, $2, $3, $4)
		RETURNING id, token, token_type, telegram_id, expires_at, created_at
	`, token, tokenType, telegramID, expiresAt).Scan(
		&t.ID, &t.Token, &t.TokenType, &t.TelegramID, &t.ExpiresAt, &t.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// ValidateToken validates a token and returns its info
func (s *TokenStore) ValidateToken(ctx context.Context, token string) (*AccessToken, error) {
	var t AccessToken
	err := s.pool.QueryRow(ctx, `
		SELECT id, token, token_type, telegram_id, expires_at, created_at
		FROM access_tokens
		WHERE token = $1 AND expires_at > NOW()
	`, token).Scan(&t.ID, &t.Token, &t.TokenType, &t.TelegramID, &t.ExpiresAt, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// DeleteExpiredTokens removes expired tokens
func (s *TokenStore) DeleteExpiredTokens(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM access_tokens WHERE expires_at < NOW()`)
	return err
}

// GetPanelAdmins returns all panel admins
func (s *TokenStore) GetPanelAdmins(ctx context.Context) ([]PanelAdmin, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, telegram_id, name, rights, created_at, updated_at
		FROM panel_admins
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var admins []PanelAdmin
	for rows.Next() {
		var a PanelAdmin
		if err := rows.Scan(&a.ID, &a.TelegramID, &a.Name, &a.Rights, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		admins = append(admins, a)
	}
	return admins, nil
}

// GetPanelAdminByTelegramID returns a panel admin by telegram ID
func (s *TokenStore) GetPanelAdminByTelegramID(ctx context.Context, telegramID int64) (*PanelAdmin, error) {
	var a PanelAdmin
	err := s.pool.QueryRow(ctx, `
		SELECT id, telegram_id, name, rights, created_at, updated_at
		FROM panel_admins
		WHERE telegram_id = $1
	`, telegramID).Scan(&a.ID, &a.TelegramID, &a.Name, &a.Rights, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// CreatePanelAdmin creates a new panel admin
func (s *TokenStore) CreatePanelAdmin(ctx context.Context, telegramID int64, name string, rights map[string]bool) (*PanelAdmin, error) {
	var a PanelAdmin
	err := s.pool.QueryRow(ctx, `
		INSERT INTO panel_admins (telegram_id, name, rights)
		VALUES ($1, $2, $3)
		RETURNING id, telegram_id, name, rights, created_at, updated_at
	`, telegramID, name, rights).Scan(&a.ID, &a.TelegramID, &a.Name, &a.Rights, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// UpdatePanelAdmin updates a panel admin
func (s *TokenStore) UpdatePanelAdmin(ctx context.Context, id int, name string, rights map[string]bool) (*PanelAdmin, error) {
	var a PanelAdmin
	err := s.pool.QueryRow(ctx, `
		UPDATE panel_admins
		SET name = $2, rights = $3, updated_at = NOW()
		WHERE id = $1
		RETURNING id, telegram_id, name, rights, created_at, updated_at
	`, id, name, rights).Scan(&a.ID, &a.TelegramID, &a.Name, &a.Rights, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// DeletePanelAdmin deletes a panel admin
func (s *TokenStore) DeletePanelAdmin(ctx context.Context, id int) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM panel_admins WHERE id = $1`, id)
	return err
}
