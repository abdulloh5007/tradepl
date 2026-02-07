package auth

import (
	"context"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type Service struct {
	pool   *pgxpool.Pool
	issuer string
	secret []byte
	ttl    time.Duration
}

type User struct {
	ID    string
	Email string
}

func NewService(pool *pgxpool.Pool, issuer string, secret []byte, ttl time.Duration) *Service {
	return &Service{pool: pool, issuer: issuer, secret: secret, ttl: ttl}
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
	err := s.pool.QueryRow(ctx, "select id, email from users where id = $1", userID).Scan(&u.ID, &u.Email)
	return u, err
}

// UserExists checks if a user exists in the database
func (s *Service) UserExists(ctx context.Context, userID string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)", userID).Scan(&exists)
	return exists, err
}
