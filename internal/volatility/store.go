package volatility

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

func (s *Store) GetSettings(ctx context.Context) ([]Setting, error) {
	rows, err := s.pool.Query(ctx, "SELECT id, name, value, spread, schedule_start, schedule_end, is_active FROM volatility_settings ORDER BY value DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var settings []Setting
	for rows.Next() {
		var st Setting
		err := rows.Scan(&st.ID, &st.Name, &st.Value, &st.Spread, &st.ScheduleStart, &st.ScheduleEnd, &st.IsActive)
		if err != nil {
			return nil, err
		}
		settings = append(settings, st)
	}
	return settings, nil
}

func (s *Store) GetActiveConfig(ctx context.Context) (Config, error) {
	var c Config
	err := s.pool.QueryRow(ctx, "SELECT id, value, spread FROM volatility_settings WHERE is_active = true").Scan(&c.ID, &c.Volatility, &c.Spread)
	if err != nil {
		if err == pgx.ErrNoRows {
			// Fallback default
			return Config{ID: "medium", Volatility: 0.0003, Spread: 0.5e-7}, nil
		}
		return Config{}, err
	}
	return c, nil
}

func (s *Store) SetActive(ctx context.Context, id string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, "UPDATE volatility_settings SET is_active = false")
	if err != nil {
		return err
	}

	cmdTag, err := tx.Exec(ctx, "UPDATE volatility_settings SET is_active = true WHERE id = $1", id)
	if err != nil {
		return err
	}
	if cmdTag.RowsAffected() == 0 {
		return fmt.Errorf("setting not found")
	}

	return tx.Commit(ctx)
}

func (s *Store) GetMode(ctx context.Context) (string, error) {
	var mode string
	err := s.pool.QueryRow(ctx, "SELECT value FROM system_settings WHERE key = 'volatility_mode'").Scan(&mode)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "auto", nil
		}
		return "", err
	}
	return mode, nil
}

func (s *Store) SetMode(ctx context.Context, mode string) error {
	_, err := s.pool.Exec(ctx,
		"INSERT INTO system_settings (key, value) VALUES ('volatility_mode', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
		mode)
	return err
}
