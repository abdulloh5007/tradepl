package marketdata

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

type Asset struct {
	ID        string
	Symbol    string
	Precision int32
}

type Pair struct {
	ID             string
	Symbol         string
	BaseAssetID    string
	QuoteAssetID   string
	PricePrecision int32
	QtyPrecision   int32
	MinQty         string
	MinNotional    string
	Status         string
}

func (s *Store) GetAssetBySymbol(ctx context.Context, symbol string) (Asset, error) {
	var a Asset
	err := s.pool.QueryRow(ctx, "select id, symbol, precision from assets where symbol = $1", symbol).Scan(&a.ID, &a.Symbol, &a.Precision)
	return a, err
}

func (s *Store) GetPairBySymbol(ctx context.Context, symbol string) (Pair, error) {
	var p Pair
	err := s.pool.QueryRow(ctx, "select id, symbol, base_asset_id, quote_asset_id, price_precision, qty_precision, min_qty, min_notional, status from trading_pairs where symbol = $1", symbol).Scan(&p.ID, &p.Symbol, &p.BaseAssetID, &p.QuoteAssetID, &p.PricePrecision, &p.QtyPrecision, &p.MinQty, &p.MinNotional, &p.Status)
	return p, err
}
