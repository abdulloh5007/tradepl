package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"lv-tradepl/internal/accounts"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type Service struct {
	pool             *pgxpool.Pool
	issuer           string
	secret           []byte
	ttl              time.Duration
	accountSvc       *accounts.Service
	telegramBotToken string
}

type User struct {
	ID          string
	Email       string
	TelegramID  int64
	DisplayName string
	AvatarURL   string
}

type telegramAuthPayload struct {
	ID        int64  `json:"id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Username  string `json:"username"`
	PhotoURL  string `json:"photo_url"`
}

func NewService(pool *pgxpool.Pool, issuer string, secret []byte, ttl time.Duration) *Service {
	return &Service{pool: pool, issuer: issuer, secret: secret, ttl: ttl}
}

func (s *Service) SetAccountService(accountSvc *accounts.Service) {
	s.accountSvc = accountSvc
}

func (s *Service) SetTelegramBotToken(token string) {
	s.telegramBotToken = strings.TrimSpace(token)
}

func (s *Service) Register(ctx context.Context, email, password string) (string, error) {
	if email == "" || password == "" {
		return "", errors.New("email and password required")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var userID string
	err = tx.QueryRow(ctx, "insert into users (email) values ($1) returning id", email).Scan(&userID)
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, "insert into user_credentials (user_id, password_hash) values ($1, $2)", userID, string(hash))
	if err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	if s.accountSvc != nil {
		if err := s.accountSvc.EnsureDefaultAccounts(ctx, userID); err != nil {
			return "", err
		}
	}
	return userID, nil
}

func (s *Service) Login(ctx context.Context, email, password string) (string, error) {
	var userID string
	var hash string
	err := s.pool.QueryRow(ctx, "select u.id, c.password_hash from users u join user_credentials c on c.user_id = u.id where u.email = $1", email).Scan(&userID, &hash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", errors.New("invalid credentials")
		}
		return "", err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return "", errors.New("invalid credentials")
	}
	return s.signToken(userID)
}

func (s *Service) LoginTelegram(ctx context.Context, initData string) (string, User, error) {
	if s.telegramBotToken == "" {
		return "", User{}, errors.New("telegram auth is not configured")
	}
	payload, err := validateTelegramInitData(strings.TrimSpace(initData), s.telegramBotToken)
	if err != nil {
		return "", User{}, err
	}

	displayName := buildTelegramDisplayName(payload)
	email := fmt.Sprintf("tg_%d@telegram.local", payload.ID)
	var userID string

	err = s.pool.QueryRow(ctx, `
		SELECT id
		FROM users
		WHERE telegram_id = $1
	`, payload.ID).Scan(&userID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", User{}, err
	}
	if errors.Is(err, pgx.ErrNoRows) {
		err = s.pool.QueryRow(ctx, `
			INSERT INTO users (email, telegram_id, display_name, avatar_url)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (email)
			DO UPDATE SET
				telegram_id = EXCLUDED.telegram_id,
				display_name = EXCLUDED.display_name,
				avatar_url = EXCLUDED.avatar_url
			RETURNING id
		`, email, payload.ID, displayName, strings.TrimSpace(payload.PhotoURL)).Scan(&userID)
		if err != nil {
			return "", User{}, err
		}
	} else {
		_, err = s.pool.Exec(ctx, `
			UPDATE users
			SET
				display_name = $1,
				avatar_url = $2
			WHERE id = $3
		`, displayName, strings.TrimSpace(payload.PhotoURL), userID)
		if err != nil {
			return "", User{}, err
		}
	}

	if s.accountSvc != nil {
		if err := s.accountSvc.EnsureDefaultAccounts(ctx, userID); err != nil {
			return "", User{}, err
		}
	}

	token, err := s.signToken(userID)
	if err != nil {
		return "", User{}, err
	}
	user, err := s.GetUser(ctx, userID)
	if err != nil {
		return "", User{}, err
	}
	return token, user, nil
}

func (s *Service) signToken(userID string) (string, error) {
	now := time.Now().UTC()
	claims := jwt.RegisteredClaims{
		Issuer:    s.issuer,
		Subject:   userID,
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(s.ttl)),
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString(s.secret)
}

func (s *Service) ParseToken(token string) (string, error) {
	parsed, err := jwt.ParseWithClaims(token, &jwt.RegisteredClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("invalid signing method")
		}
		return s.secret, nil
	})
	if err != nil {
		return "", err
	}
	claims, ok := parsed.Claims.(*jwt.RegisteredClaims)
	if !ok || !parsed.Valid {
		return "", errors.New("invalid token")
	}
	if claims.Issuer != s.issuer {
		return "", errors.New("invalid issuer")
	}
	if claims.Subject == "" {
		return "", errors.New("invalid subject")
	}
	return claims.Subject, nil
}

func (s *Service) GetUser(ctx context.Context, userID string) (User, error) {
	var u User
	err := s.pool.QueryRow(ctx, `
		SELECT id, email, COALESCE(telegram_id, 0), COALESCE(display_name, ''), COALESCE(avatar_url, '')
		FROM users
		WHERE id = $1
	`, userID).Scan(&u.ID, &u.Email, &u.TelegramID, &u.DisplayName, &u.AvatarURL)
	return u, err
}

// UserExists checks if a user exists in the database
func (s *Service) UserExists(ctx context.Context, userID string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)", userID).Scan(&exists)
	return exists, err
}

func validateTelegramInitData(initData, botToken string) (telegramAuthPayload, error) {
	if strings.TrimSpace(initData) == "" {
		return telegramAuthPayload{}, errors.New("init_data is required")
	}
	params, err := url.ParseQuery(initData)
	if err != nil {
		return telegramAuthPayload{}, errors.New("invalid init_data")
	}
	hash := strings.TrimSpace(params.Get("hash"))
	if hash == "" {
		return telegramAuthPayload{}, errors.New("invalid init_data hash")
	}
	authDateRaw := strings.TrimSpace(params.Get("auth_date"))
	if authDateRaw == "" {
		return telegramAuthPayload{}, errors.New("invalid init_data auth_date")
	}
	authDate, err := strconv.ParseInt(authDateRaw, 10, 64)
	if err != nil {
		return telegramAuthPayload{}, errors.New("invalid init_data auth_date")
	}
	now := time.Now().Unix()
	if now-authDate > 24*60*60 {
		return telegramAuthPayload{}, errors.New("init_data expired")
	}

	keys := make([]string, 0, len(params))
	for key := range params {
		if key == "hash" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	lines := make([]string, 0, len(keys))
	for _, key := range keys {
		lines = append(lines, key+"="+params.Get(key))
	}
	dataCheckString := strings.Join(lines, "\n")

	secretMac := hmac.New(sha256.New, []byte("WebAppData"))
	secretMac.Write([]byte(botToken))
	secret := secretMac.Sum(nil)

	checkMac := hmac.New(sha256.New, secret)
	checkMac.Write([]byte(dataCheckString))
	expectedHash := hex.EncodeToString(checkMac.Sum(nil))
	if !hmac.Equal([]byte(strings.ToLower(expectedHash)), []byte(strings.ToLower(hash))) {
		return telegramAuthPayload{}, errors.New("invalid init_data signature")
	}

	var payload telegramAuthPayload
	userRaw := strings.TrimSpace(params.Get("user"))
	if userRaw == "" {
		return telegramAuthPayload{}, errors.New("telegram user is missing")
	}
	if err := json.Unmarshal([]byte(userRaw), &payload); err != nil {
		return telegramAuthPayload{}, errors.New("invalid telegram user payload")
	}
	if payload.ID == 0 {
		return telegramAuthPayload{}, errors.New("invalid telegram user id")
	}
	return payload, nil
}

func buildTelegramDisplayName(payload telegramAuthPayload) string {
	fullName := strings.TrimSpace(strings.TrimSpace(payload.FirstName) + " " + strings.TrimSpace(payload.LastName))
	if fullName != "" {
		return fullName
	}
	if payload.Username != "" {
		return strings.TrimSpace(payload.Username)
	}
	return fmt.Sprintf("Telegram %d", payload.ID)
}
