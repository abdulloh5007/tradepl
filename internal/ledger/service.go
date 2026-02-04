package ledger

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
	"lv-tradepl/internal/types"
)

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) EnsureAccount(ctx context.Context, tx pgx.Tx, userID, assetID string, kind types.AccountKind) (string, error) {
	var id string
	err := tx.QueryRow(ctx, "select id from accounts where owner_type = 'user' and owner_user_id = $1 and asset_id = $2 and kind = $3", userID, assetID, string(kind)).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	err = tx.QueryRow(ctx, "insert into accounts (owner_type, owner_user_id, asset_id, kind) values ('user', $1, $2, $3) returning id", userID, assetID, string(kind)).Scan(&id)
	if err != nil {
		return "", err
	}
	return id, nil
}

func (s *Service) EnsureSystemAccount(ctx context.Context, tx pgx.Tx, assetID string, kind types.AccountKind) (string, error) {
	var id string
	err := tx.QueryRow(ctx, "select id from accounts where owner_type = 'system' and owner_user_id is null and asset_id = $1 and kind = $2", assetID, string(kind)).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	err = tx.QueryRow(ctx, "insert into accounts (owner_type, owner_user_id, asset_id, kind) values ('system', null, $1, $2) returning id", assetID, string(kind)).Scan(&id)
	if err != nil {
		return "", err
	}
	return id, nil
}

func (s *Service) GetBalance(ctx context.Context, tx pgx.Tx, accountID string) (decimal.Decimal, error) {
	var sum decimal.Decimal
	err := tx.QueryRow(ctx, "select coalesce(sum(amount), 0) from ledger_entries where account_id = $1", accountID).Scan(&sum)
	return sum, err
}

type Balance struct {
	AssetID string           `json:"asset_id"`
	Symbol  string           `json:"symbol"`
	Kind    types.AccountKind `json:"kind"`
	Amount  decimal.Decimal  `json:"amount"`
}

func (s *Service) BalancesByUser(ctx context.Context, userID string) ([]Balance, error) {
	rows, err := s.pool.Query(ctx, "select a.asset_id, asst.symbol, a.kind, coalesce(sum(le.amount), 0) from accounts a join assets asst on asst.id = a.asset_id left join ledger_entries le on le.account_id = a.id where a.owner_type = 'user' and a.owner_user_id = $1 group by a.asset_id, asst.symbol, a.kind order by asst.symbol, a.kind", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Balance
	for rows.Next() {
		var b Balance
		var kind string
		if err := rows.Scan(&b.AssetID, &b.Symbol, &kind, &b.Amount); err != nil {
			return nil, err
		}
		b.Kind = types.AccountKind(kind)
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Service) Transfer(ctx context.Context, tx pgx.Tx, fromAccountID, toAccountID string, amount decimal.Decimal, entryType types.LedgerEntryType, ref string) (string, error) {
	if amount.LessThanOrEqual(decimal.Zero) {
		return "", errors.New("amount must be positive")
	}
	var txID string
	err := tx.QueryRow(ctx, "insert into ledger_txs (ref, created_at) values ($1, $2) returning id", ref, time.Now().UTC()).Scan(&txID)
	if err != nil {
		return "", err
	}
	if _, err := s.appendEntry(ctx, tx, txID, fromAccountID, amount.Neg(), entryType); err != nil {
		return "", err
	}
	if _, err := s.appendEntry(ctx, tx, txID, toAccountID, amount, entryType); err != nil {
		return "", err
	}
	return txID, nil
}

func (s *Service) appendEntry(ctx context.Context, tx pgx.Tx, txID, accountID string, amount decimal.Decimal, entryType types.LedgerEntryType) (string, error) {
	_, err := tx.Exec(ctx, "select pg_advisory_xact_lock(1)")
	if err != nil {
		return "", err
	}
	var prevHash *string
	err = tx.QueryRow(ctx, "select encode(hash, 'hex') from ledger_entries order by sequence desc limit 1").Scan(&prevHash)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	var entryID string
	var seq int64
	err = tx.QueryRow(ctx, "insert into ledger_entries (tx_id, account_id, amount, entry_type, prev_hash, created_at) values ($1, $2, $3, $4, decode(nullif($5,''), 'hex'), $6) returning id, sequence", txID, accountID, amount, string(entryType), nullable(prevHash), time.Now().UTC()).Scan(&entryID, &seq)
	if err != nil {
		return "", err
	}
	hash := computeHash(entryID, txID, accountID, amount, entryType, seq, prevHash)
	_, err = tx.Exec(ctx, "update ledger_entries set hash = decode($1, 'hex') where id = $2", hash, entryID)
	if err != nil {
		return "", err
	}
	return entryID, nil
}

func computeHash(entryID, txID, accountID string, amount decimal.Decimal, entryType types.LedgerEntryType, seq int64, prevHash *string) string {
	buf := entryID + "|" + txID + "|" + accountID + "|" + amount.String() + "|" + string(entryType) + "|" + strconv.FormatInt(seq, 10) + "|"
	if prevHash != nil {
		buf += *prevHash
	}
	sum := sha256.Sum256([]byte(buf))
	return hex.EncodeToString(sum[:])
}

func nullable(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
