package accounts

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
)

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

var allowedLeverageValues = map[int]struct{}{
	0: {}, // unlimited
	2: {}, 5: {}, 10: {}, 20: {}, 30: {}, 40: {}, 50: {},
	100: {}, 200: {}, 500: {}, 1000: {}, 2000: {}, 3000: {},
}

const defaultNewAccountLeverage = 2000

func isAllowedLeverage(v int) bool {
	_, ok := allowedLeverageValues[v]
	return ok
}

type Plan struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	Description      string  `json:"description"`
	SpreadMultiplier float64 `json:"spread_multiplier"`
	CommissionRate   float64 `json:"commission_rate"`
	CommissionPerLot float64 `json:"commission_per_lot"`
	SwapLongPerLot   float64 `json:"swap_long_per_lot"`
	SwapShortPerLot  float64 `json:"swap_short_per_lot"`
	IsSwapFree       bool    `json:"is_swap_free"`
	Leverage         int     `json:"leverage"`
}

type TradingAccount struct {
	ID        string          `json:"id"`
	UserID    string          `json:"user_id"`
	PlanID    string          `json:"plan_id"`
	Plan      Plan            `json:"plan"`
	Leverage  int             `json:"leverage"`
	Mode      string          `json:"mode"`
	Name      string          `json:"name"`
	IsActive  bool            `json:"is_active"`
	Balance   decimal.Decimal `json:"balance"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

func normalizeMode(mode string) string {
	return strings.ToLower(strings.TrimSpace(mode))
}

func defaultAccountName(mode, planID string) string {
	m := strings.Title(mode)
	p := strings.Title(planID)
	return fmt.Sprintf("%s %s", m, p)
}

func (s *Service) ensureDefaultAccountsTx(ctx context.Context, tx pgx.Tx, userID string) error {
	if userID == "" {
		return errors.New("user_id is required")
	}

	_, err := tx.Exec(ctx, `
		INSERT INTO trading_accounts (user_id, plan_id, mode, name, is_active, leverage)
		SELECT $1, 'standard', 'demo', 'Demo Standard', FALSE, $2
		WHERE NOT EXISTS (
			SELECT 1 FROM trading_accounts
			WHERE user_id = $1 AND mode = 'demo' AND plan_id = 'standard'
		)
	`, userID, defaultNewAccountLeverage)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO trading_accounts (user_id, plan_id, mode, name, is_active, leverage)
		SELECT $1, 'standard', 'real', 'Real Standard', FALSE, $2
		WHERE NOT EXISTS (
			SELECT 1 FROM trading_accounts
			WHERE user_id = $1 AND mode = 'real' AND plan_id = 'standard'
		)
	`, userID, defaultNewAccountLeverage)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		WITH has_active AS (
			SELECT EXISTS(
				SELECT 1 FROM trading_accounts
				WHERE user_id = $1 AND is_active = TRUE
			) AS ok
		), pick AS (
			SELECT id
			FROM trading_accounts
			WHERE user_id = $1
			ORDER BY (mode = 'demo') DESC, created_at ASC
			LIMIT 1
		)
		UPDATE trading_accounts
		SET is_active = TRUE, updated_at = NOW()
		WHERE id IN (SELECT id FROM pick)
		  AND (SELECT ok FROM has_active) = FALSE
	`, userID)
	if err != nil {
		return err
	}

	return nil
}

func (s *Service) EnsureDefaultAccounts(ctx context.Context, userID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := s.ensureDefaultAccountsTx(ctx, tx, userID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *Service) List(ctx context.Context, userID string) ([]TradingAccount, error) {
	if err := s.EnsureDefaultAccounts(ctx, userID); err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			ta.id, ta.user_id, ta.plan_id, ta.leverage, ta.mode, ta.name, ta.is_active, ta.created_at, ta.updated_at,
			p.id, p.name, p.description, p.spread_multiplier, p.commission_rate,
			COALESCE((to_jsonb(p)->>'commission_per_lot')::double precision, 0.0) AS commission_per_lot,
			COALESCE((to_jsonb(p)->>'swap_long_per_lot')::double precision, 0.0) AS swap_long_per_lot,
			COALESCE((to_jsonb(p)->>'swap_short_per_lot')::double precision, 0.0) AS swap_short_per_lot,
			COALESCE((to_jsonb(p)->>'is_swap_free')::boolean, FALSE) AS is_swap_free,
			p.leverage,
			COALESCE(bal.balance, 0) AS balance
		FROM trading_accounts ta
		JOIN account_plans p ON p.id = ta.plan_id
		LEFT JOIN LATERAL (
			SELECT COALESCE(SUM(le.amount), 0) AS balance
			FROM accounts a
			JOIN assets ast ON ast.id = a.asset_id
			LEFT JOIN ledger_entries le ON le.account_id = a.id
			WHERE a.trading_account_id = ta.id
			  AND ast.symbol = 'USD'
			  AND a.kind = 'available'
		) bal ON TRUE
		WHERE ta.user_id = $1
		ORDER BY ta.created_at ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]TradingAccount, 0, 4)
	for rows.Next() {
		var a TradingAccount
		var p Plan
		if err := rows.Scan(
			&a.ID, &a.UserID, &a.PlanID, &a.Leverage, &a.Mode, &a.Name, &a.IsActive, &a.CreatedAt, &a.UpdatedAt,
			&p.ID, &p.Name, &p.Description, &p.SpreadMultiplier, &p.CommissionRate, &p.CommissionPerLot, &p.SwapLongPerLot, &p.SwapShortPerLot, &p.IsSwapFree, &p.Leverage,
			&a.Balance,
		); err != nil {
			return nil, err
		}
		a.Plan = p
		out = append(out, a)
	}

	return out, rows.Err()
}

func (s *Service) getByID(ctx context.Context, tx pgx.Tx, userID, accountID string) (*TradingAccount, error) {
	var a TradingAccount
	var p Plan
	err := tx.QueryRow(ctx, `
		SELECT
			ta.id, ta.user_id, ta.plan_id, ta.leverage, ta.mode, ta.name, ta.is_active, ta.created_at, ta.updated_at,
			p.id, p.name, p.description, p.spread_multiplier, p.commission_rate,
			COALESCE((to_jsonb(p)->>'commission_per_lot')::double precision, 0.0) AS commission_per_lot,
			COALESCE((to_jsonb(p)->>'swap_long_per_lot')::double precision, 0.0) AS swap_long_per_lot,
			COALESCE((to_jsonb(p)->>'swap_short_per_lot')::double precision, 0.0) AS swap_short_per_lot,
			COALESCE((to_jsonb(p)->>'is_swap_free')::boolean, FALSE) AS is_swap_free,
			p.leverage
		FROM trading_accounts ta
		JOIN account_plans p ON p.id = ta.plan_id
		WHERE ta.id = $1 AND ta.user_id = $2
	`, accountID, userID).Scan(
		&a.ID, &a.UserID, &a.PlanID, &a.Leverage, &a.Mode, &a.Name, &a.IsActive, &a.CreatedAt, &a.UpdatedAt,
		&p.ID, &p.Name, &p.Description, &p.SpreadMultiplier, &p.CommissionRate, &p.CommissionPerLot, &p.SwapLongPerLot, &p.SwapShortPerLot, &p.IsSwapFree, &p.Leverage,
	)
	if err != nil {
		return nil, err
	}
	a.Plan = p
	return &a, nil
}

func (s *Service) Resolve(ctx context.Context, userID, requestedAccountID string) (*TradingAccount, error) {
	if userID == "" {
		return nil, errors.New("user_id is required")
	}
	if err := s.EnsureDefaultAccounts(ctx, userID); err != nil {
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if requestedAccountID != "" {
		acc, err := s.getByID(ctx, tx, userID, requestedAccountID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, errors.New("account not found")
			}
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return acc, nil
	}

	var activeID string
	err = tx.QueryRow(ctx, `
		SELECT id FROM trading_accounts
		WHERE user_id = $1 AND is_active = TRUE
		ORDER BY created_at ASC
		LIMIT 1
	`, userID).Scan(&activeID)
	if err != nil {
		return nil, err
	}

	acc, err := s.getByID(ctx, tx, userID, activeID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return acc, nil
}

func (s *Service) SetActive(ctx context.Context, userID, accountID string) (*TradingAccount, error) {
	if userID == "" || accountID == "" {
		return nil, errors.New("user_id and account_id are required")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	acc, err := s.getByID(ctx, tx, userID, accountID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("account not found")
		}
		return nil, err
	}

	if _, err := tx.Exec(ctx, "UPDATE trading_accounts SET is_active = FALSE, updated_at = NOW() WHERE user_id = $1", userID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, "UPDATE trading_accounts SET is_active = TRUE, updated_at = NOW() WHERE id = $1", accountID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	acc.IsActive = true
	return acc, nil
}

func (s *Service) Create(ctx context.Context, userID, planID, mode, name string, makeActive bool) (*TradingAccount, error) {
	if userID == "" {
		return nil, errors.New("user_id is required")
	}
	planID = strings.ToLower(strings.TrimSpace(planID))
	if planID == "" {
		planID = "standard"
	}
	mode = normalizeMode(mode)
	if mode != "demo" && mode != "real" {
		return nil, errors.New("mode must be demo or real")
	}
	if strings.TrimSpace(name) == "" {
		name = defaultAccountName(mode, planID)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var planExists bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM account_plans WHERE id = $1)", planID).Scan(&planExists); err != nil {
		return nil, err
	}
	if !planExists {
		return nil, errors.New("plan not found")
	}

	var id string
	err = tx.QueryRow(ctx, `
		INSERT INTO trading_accounts (user_id, plan_id, leverage, mode, name, is_active)
		VALUES ($1, $2, $3, $4, $5, FALSE)
		RETURNING id
	`, userID, planID, defaultNewAccountLeverage, mode, name).Scan(&id)
	if err != nil {
		return nil, err
	}

	if makeActive {
		if _, err := tx.Exec(ctx, "UPDATE trading_accounts SET is_active = FALSE, updated_at = NOW() WHERE user_id = $1", userID); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, "UPDATE trading_accounts SET is_active = TRUE, updated_at = NOW() WHERE id = $1", id); err != nil {
			return nil, err
		}
	}

	acc, err := s.getByID(ctx, tx, userID, id)
	if err != nil {
		return nil, err
	}
	if makeActive {
		acc.IsActive = true
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return acc, nil
}

func (s *Service) UpdateLeverage(ctx context.Context, userID, accountID string, leverage int) (*TradingAccount, error) {
	if userID == "" || accountID == "" {
		return nil, errors.New("user_id and account_id are required")
	}
	if !isAllowedLeverage(leverage) {
		return nil, errors.New("unsupported leverage value; allowed: 0 (unlimited), 2, 5, 10, 20, 30, 40, 50, 100, 200, 500, 1000, 2000, 3000")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	acc, err := s.getByID(ctx, tx, userID, accountID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("account not found")
		}
		return nil, err
	}

	var hasOpenPositions bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM orders
			WHERE user_id = $1
			  AND trading_account_id = $2
			  AND status IN ('open', 'partially_filled', 'filled')
			LIMIT 1
		)
	`, userID, accountID).Scan(&hasOpenPositions); err != nil {
		return nil, err
	}
	if hasOpenPositions {
		return nil, errors.New("cannot change leverage while there are open positions; close them first")
	}

	if _, err := tx.Exec(ctx, `
		UPDATE trading_accounts
		SET leverage = $1, updated_at = NOW()
		WHERE id = $2
	`, leverage, accountID); err != nil {
		return nil, err
	}

	acc.Leverage = leverage
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return acc, nil
}

func (s *Service) UpdateName(ctx context.Context, userID, accountID, name string) (*TradingAccount, error) {
	if userID == "" || accountID == "" {
		return nil, errors.New("user_id and account_id are required")
	}
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return nil, errors.New("account name is required")
	}
	if len([]rune(trimmed)) > 64 {
		return nil, errors.New("account name is too long (max 64 chars)")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	acc, err := s.getByID(ctx, tx, userID, accountID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("account not found")
		}
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE trading_accounts
		SET name = $1, updated_at = NOW()
		WHERE id = $2
	`, trimmed, accountID); err != nil {
		return nil, err
	}

	acc.Name = trimmed
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return acc, nil
}
