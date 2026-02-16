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
	"github.com/jackc/pgx/v5/pgconn"
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
	referralNotifier func(ctx context.Context, inviterID, invitedUserID, rewardUSD string)
}

type User struct {
	ID                           string
	Email                        string
	TelegramID                   int64
	TelegramWriteAccess          bool
	TelegramNotificationsEnabled bool
	TelegramNotificationKinds    TelegramNotificationKinds
	DisplayName                  string
	AvatarURL                    string
}

type TelegramNotificationKinds struct {
	System   bool `json:"system"`
	Bonus    bool `json:"bonus"`
	Deposit  bool `json:"deposit"`
	News     bool `json:"news"`
	Referral bool `json:"referral"`
}

func defaultTelegramNotificationKinds() TelegramNotificationKinds {
	return TelegramNotificationKinds{
		System:   false,
		Bonus:    false,
		Deposit:  true,
		News:     false,
		Referral: true,
	}
}

type telegramAuthPayload struct {
	ID              int64  `json:"id"`
	FirstName       string `json:"first_name"`
	LastName        string `json:"last_name"`
	Username        string `json:"username"`
	PhotoURL        string `json:"photo_url"`
	AllowsWriteToPM *bool  `json:"allows_write_to_pm,omitempty"`
	StartParam      string `json:"-"`
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

func (s *Service) SetReferralSignupNotifier(fn func(ctx context.Context, inviterID, invitedUserID, rewardUSD string)) {
	s.referralNotifier = fn
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
	isNewUser := false
	referredByID := ""
	referralRewardUSD := ""

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return "", User{}, err
	}
	defer tx.Rollback(ctx)

	err = tx.QueryRow(ctx, `
		SELECT id::text
		FROM users
		WHERE telegram_id = $1
		FOR UPDATE
	`, payload.ID).Scan(&userID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", User{}, err
	}
	if errors.Is(err, pgx.ErrNoRows) {
		referralCode := referralCodeFromUserID(email)
		err = tx.QueryRow(ctx, `
			INSERT INTO users (email, telegram_id, display_name, avatar_url, referral_code)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (email)
			DO UPDATE SET
				telegram_id = EXCLUDED.telegram_id,
				display_name = EXCLUDED.display_name,
				avatar_url = EXCLUDED.avatar_url,
				referral_code = CASE
					WHEN COALESCE(TRIM(users.referral_code), '') = '' THEN EXCLUDED.referral_code
					ELSE users.referral_code
				END
			RETURNING id::text
		`, email, payload.ID, displayName, strings.TrimSpace(payload.PhotoURL), referralCode).Scan(&userID)
		if err != nil {
			return "", User{}, err
		}
		isNewUser = true
	} else {
		referralCode := referralCodeFromUserID(userID)
		_, err = tx.Exec(ctx, `
			UPDATE users
			SET
				display_name = $1,
				avatar_url = $2,
				referral_code = CASE
					WHEN COALESCE(TRIM(referral_code), '') = '' THEN $4
					ELSE referral_code
				END
			WHERE id = $3
		`, displayName, strings.TrimSpace(payload.PhotoURL), userID, referralCode)
		if err != nil {
			return "", User{}, err
		}
	}
	if err := ensureReferralWalletTx(ctx, tx, userID); err != nil {
		return "", User{}, err
	}
	if payload.AllowsWriteToPM != nil {
		if _, err := tx.Exec(ctx, `
			UPDATE users
			SET telegram_write_access = $2
			WHERE id = $1
		`, userID, *payload.AllowsWriteToPM); err != nil && !isUndefinedColumnError(err) {
			return "", User{}, err
		}
	}
	if isNewUser {
		inviterID, rewardUSD, refErr := applyReferralFromStartParamTx(ctx, tx, userID, payload.StartParam)
		if refErr != nil {
			return "", User{}, refErr
		}
		referredByID = strings.TrimSpace(inviterID)
		referralRewardUSD = strings.TrimSpace(rewardUSD)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", User{}, err
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
	if isNewUser && referredByID != "" && referralRewardUSD != "" && s.referralNotifier != nil {
		notifier := s.referralNotifier
		invitedID := userID
		go func() {
			notifyCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			notifier(notifyCtx, referredByID, invitedID, referralRewardUSD)
		}()
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
	defaultKinds := defaultTelegramNotificationKinds()
	err := s.pool.QueryRow(ctx, `
		SELECT
			id,
			email,
			COALESCE(telegram_id, 0),
			COALESCE(telegram_write_access, FALSE),
			COALESCE(telegram_notifications_enabled, TRUE),
			COALESCE((telegram_notification_kinds->>'system')::boolean, FALSE),
			COALESCE((telegram_notification_kinds->>'bonus')::boolean, FALSE),
			COALESCE((telegram_notification_kinds->>'deposit')::boolean, TRUE),
			COALESCE((telegram_notification_kinds->>'news')::boolean, FALSE),
			COALESCE((telegram_notification_kinds->>'referral')::boolean, TRUE),
			COALESCE(display_name, ''),
			COALESCE(avatar_url, '')
		FROM users
		WHERE id = $1
	`, userID).Scan(
		&u.ID,
		&u.Email,
		&u.TelegramID,
		&u.TelegramWriteAccess,
		&u.TelegramNotificationsEnabled,
		&u.TelegramNotificationKinds.System,
		&u.TelegramNotificationKinds.Bonus,
		&u.TelegramNotificationKinds.Deposit,
		&u.TelegramNotificationKinds.News,
		&u.TelegramNotificationKinds.Referral,
		&u.DisplayName,
		&u.AvatarURL,
	)
	if err != nil && isUndefinedColumnError(err) {
		err = s.pool.QueryRow(ctx, `
			SELECT id, email, COALESCE(telegram_id, 0), COALESCE(display_name, ''), COALESCE(avatar_url, '')
			FROM users
			WHERE id = $1
		`, userID).Scan(&u.ID, &u.Email, &u.TelegramID, &u.DisplayName, &u.AvatarURL)
		if err == nil {
			u.TelegramWriteAccess = false
			u.TelegramNotificationsEnabled = true
			u.TelegramNotificationKinds = defaultKinds
		}
	}
	if err == nil && (u.TelegramNotificationKinds == TelegramNotificationKinds{}) {
		u.TelegramNotificationKinds = defaultKinds
	}
	return u, err
}

// UserExists checks if a user exists in the database
func (s *Service) UserExists(ctx context.Context, userID string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)", userID).Scan(&exists)
	return exists, err
}

func (s *Service) SetTelegramWriteAccess(ctx context.Context, userID string, allowed bool) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE users
		SET telegram_write_access = $2
		WHERE id = $1
	`, userID, allowed)
	if err != nil {
		if isUndefinedColumnError(err) {
			return errors.New("telegram write access is unavailable: run migrations")
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("user not found")
	}
	return nil
}

func (s *Service) SetTelegramNotificationsEnabled(ctx context.Context, userID string, enabled bool) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE users
		SET telegram_notifications_enabled = $2
		WHERE id = $1
	`, userID, enabled)
	if err != nil {
		if isUndefinedColumnError(err) {
			return errors.New("telegram notifications setting is unavailable: run migrations")
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("user not found")
	}
	return nil
}

func (s *Service) SetTelegramNotificationKinds(ctx context.Context, userID string, kinds TelegramNotificationKinds) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE users
		SET telegram_notification_kinds = jsonb_build_object(
			'system', $2,
			'bonus', $3,
			'deposit', $4,
			'news', $5,
			'referral', $6
		)
		WHERE id = $1
	`, userID, kinds.System, kinds.Bonus, kinds.Deposit, kinds.News, kinds.Referral)
	if err != nil {
		if isUndefinedColumnError(err) {
			return errors.New("telegram notification kinds are unavailable: run migrations")
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("user not found")
	}
	return nil
}

func referralCodeFromUserID(seed string) string {
	trimmed := strings.TrimSpace(strings.ToLower(seed))
	if trimmed == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(trimmed))
	return "bx" + hex.EncodeToString(sum[:])[:24]
}

func ensureReferralWalletTx(ctx context.Context, tx pgx.Tx, userID string) error {
	if strings.TrimSpace(userID) == "" {
		return nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO referral_wallets (user_id, balance, total_earned, total_withdrawn, updated_at)
		VALUES ($1, 0, 0, 0, NOW())
		ON CONFLICT (user_id) DO NOTHING
	`, userID)
	if err != nil && (isUndefinedTableError(err) || isUndefinedColumnError(err)) {
		return nil
	}
	return err
}

func parseStartReferralCode(startParam string) string {
	value := strings.ToLower(strings.TrimSpace(startParam))
	if strings.HasPrefix(value, "ref_") {
		value = strings.TrimPrefix(value, "ref_")
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if !strings.HasPrefix(value, "bx") {
		value = "bx" + value
	}
	return value
}

func applyReferralFromStartParamTx(ctx context.Context, tx pgx.Tx, newUserID, startParam string) (string, string, error) {
	code := parseStartReferralCode(startParam)
	if code == "" {
		return "", "", nil
	}
	var inviterID string
	err := tx.QueryRow(ctx, `
		SELECT id::text
		FROM users
		WHERE LOWER(referral_code) = LOWER($1)
	`, code).Scan(&inviterID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isUndefinedColumnError(err) {
			return "", "", nil
		}
		return "", "", err
	}
	inviterID = strings.TrimSpace(inviterID)
	if inviterID == "" || inviterID == strings.TrimSpace(newUserID) {
		return "", "", nil
	}

	tag, err := tx.Exec(ctx, `
		UPDATE users
		SET referred_by = $2,
		    referred_at = NOW()
		WHERE id = $1
		  AND referred_by IS NULL
	`, newUserID, inviterID)
	if err != nil {
		if isUndefinedColumnError(err) {
			return "", "", nil
		}
		return "", "", err
	}
	if tag.RowsAffected() == 0 {
		return "", "", nil
	}

	sourceRef := "ref_signup:" + newUserID
	var eventID string
	err = tx.QueryRow(ctx, `
		INSERT INTO referral_events (
			user_id,
			related_user_id,
			kind,
			amount,
			commission_percent,
			source_ref,
			created_at
		) VALUES ($1, $2, 'signup', 5, 0, $3, NOW())
		ON CONFLICT (kind, source_ref) DO NOTHING
		RETURNING id::text
	`, inviterID, newUserID, sourceRef).Scan(&eventID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isUndefinedTableError(err) || isUndefinedColumnError(err) {
			return "", "", nil
		}
		return "", "", err
	}
	if strings.TrimSpace(eventID) == "" {
		return "", "", nil
	}
	if err := ensureReferralWalletTx(ctx, tx, inviterID); err != nil {
		return "", "", err
	}
	_, err = tx.Exec(ctx, `
		UPDATE referral_wallets
		SET balance = balance + 5,
		    total_earned = total_earned + 5,
		    updated_at = NOW()
		WHERE user_id = $1
	`, inviterID)
	if err != nil && (isUndefinedTableError(err) || isUndefinedColumnError(err)) {
		return "", "", nil
	}
	if err != nil {
		return "", "", err
	}
	return inviterID, "5.00", nil
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
	payload.StartParam = strings.TrimSpace(params.Get("start_param"))
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

func isUndefinedColumnError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42703"
}

func isUndefinedTableError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42P01"
}
