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
	ContractSize   string
	LotStep        string
	MinLot         string
	MaxLot         string
	Status         string
}

func (s *Store) GetAssetBySymbol(ctx context.Context, symbol string) (Asset, error) {
	var a Asset
	err := s.pool.QueryRow(ctx, "select id, symbol, precision from assets where symbol = $1", symbol).Scan(&a.ID, &a.Symbol, &a.Precision)
	return a, err
}

func (s *Store) GetPairBySymbol(ctx context.Context, symbol string) (Pair, error) {
	var p Pair
	err := s.pool.QueryRow(ctx, `
		select
			id, symbol, base_asset_id, quote_asset_id, price_precision, qty_precision,
			min_qty, min_notional, contract_size, lot_step, min_lot, max_lot, status
		from trading_pairs
		where symbol = $1
	`, symbol).Scan(
		&p.ID, &p.Symbol, &p.BaseAssetID, &p.QuoteAssetID, &p.PricePrecision, &p.QtyPrecision,
		&p.MinQty, &p.MinNotional, &p.ContractSize, &p.LotStep, &p.MinLot, &p.MaxLot, &p.Status,
	)
	return p, err
}

func (s *Store) GetPairByID(ctx context.Context, id string) (Pair, error) {
	var p Pair
	err := s.pool.QueryRow(ctx, `
		select
			id, symbol, base_asset_id, quote_asset_id, price_precision, qty_precision,
			min_qty, min_notional, contract_size, lot_step, min_lot, max_lot, status
		from trading_pairs
		where id = $1
	`, id).Scan(
		&p.ID, &p.Symbol, &p.BaseAssetID, &p.QuoteAssetID, &p.PricePrecision, &p.QtyPrecision,
		&p.MinQty, &p.MinNotional, &p.ContractSize, &p.LotStep, &p.MinLot, &p.MaxLot, &p.Status,
	)
	return p, err
}
