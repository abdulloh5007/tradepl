package orders

import (
	"context"
	"time"

	"lv-tradepl/internal/model"
	"lv-tradepl/internal/types"

	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
)

type Store struct{}

func NewStore() *Store {
	return &Store{}
}

type Trade struct {
	ID         string
	PairID     string
	Price      decimal.Decimal
	Qty        decimal.Decimal
	TakerOrder string
	MakerOrder string
	Sequence   int64
	CreatedAt  time.Time
}

func (s *Store) CreateOrder(ctx context.Context, tx pgx.Tx, o model.Order) (string, error) {
	var id string
	err := tx.QueryRow(ctx, "insert into orders (user_id, pair_id, side, type, status, price, qty, remaining_qty, quote_amount, remaining_quote, reserved_amount, spent_amount, time_in_force, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id", o.UserID, o.PairID, string(o.Side), string(o.Type), string(o.Status), o.Price, o.Qty, o.RemainingQty, o.QuoteAmount, o.RemainingQuote, o.ReservedAmount, o.SpentAmount, string(o.TimeInForce), time.Now().UTC(), time.Now().UTC()).Scan(&id)
	return id, err
}

func (s *Store) GetOrderForUpdate(ctx context.Context, tx pgx.Tx, orderID string) (model.Order, error) {
	var o model.Order
	var side, typ, status, tif string
	var price *decimal.Decimal
	var quoteAmount *decimal.Decimal
	var remainingQuote *decimal.Decimal
	err := tx.QueryRow(ctx, "select id, user_id, pair_id, side, type, status, price, qty, remaining_qty, quote_amount, remaining_quote, reserved_amount, spent_amount, time_in_force, created_at from orders where id = $1 for update", orderID).Scan(&o.ID, &o.UserID, &o.PairID, &side, &typ, &status, &price, &o.Qty, &o.RemainingQty, &quoteAmount, &remainingQuote, &o.ReservedAmount, &o.SpentAmount, &tif, &o.CreatedAt)
	if err != nil {
		return o, err
	}
	o.Side = types.OrderSide(side)
	o.Type = types.OrderType(typ)
	o.Status = types.OrderStatus(status)
	o.Price = price
	o.QuoteAmount = quoteAmount
	o.RemainingQuote = remainingQuote
	o.TimeInForce = types.TimeInForce(tif)
	return o, nil
}

func (s *Store) ListMatchingOrders(ctx context.Context, tx pgx.Tx, pairID string, side types.OrderSide, limitPrice *decimal.Decimal, limit int) ([]model.Order, error) {
	var rows pgx.Rows
	var err error
	if side == types.OrderSideBuy {
		if limitPrice == nil {
			rows, err = tx.Query(ctx, "select id, user_id, pair_id, side, type, status, price, qty, remaining_qty, quote_amount, remaining_quote, reserved_amount, spent_amount, time_in_force, created_at from orders where pair_id = $1 and side = 'sell' and status in ('open','partially_filled') and remaining_qty > 0 order by price asc, created_at asc, id asc limit $2 for update", pairID, limit)
		} else {
			rows, err = tx.Query(ctx, "select id, user_id, pair_id, side, type, status, price, qty, remaining_qty, quote_amount, remaining_quote, reserved_amount, spent_amount, time_in_force, created_at from orders where pair_id = $1 and side = 'sell' and status in ('open','partially_filled') and remaining_qty > 0 and price <= $2 order by price asc, created_at asc, id asc limit $3 for update", pairID, limitPrice, limit)
		}
	} else {
		if limitPrice == nil {
			rows, err = tx.Query(ctx, "select id, user_id, pair_id, side, type, status, price, qty, remaining_qty, quote_amount, remaining_quote, reserved_amount, spent_amount, time_in_force, created_at from orders where pair_id = $1 and side = 'buy' and status in ('open','partially_filled') and remaining_qty > 0 order by price desc, created_at asc, id asc limit $2 for update", pairID, limit)
		} else {
			rows, err = tx.Query(ctx, "select id, user_id, pair_id, side, type, status, price, qty, remaining_qty, quote_amount, remaining_quote, reserved_amount, spent_amount, time_in_force, created_at from orders where pair_id = $1 and side = 'buy' and status in ('open','partially_filled') and remaining_qty > 0 and price >= $2 order by price desc, created_at asc, id asc limit $3 for update", pairID, limitPrice, limit)
		}
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Order
	for rows.Next() {
		var o model.Order
		var sideStr, typ, statusStr, tif string
		var price *decimal.Decimal
		var quoteAmount *decimal.Decimal
		var remainingQuote *decimal.Decimal
		if err := rows.Scan(&o.ID, &o.UserID, &o.PairID, &sideStr, &typ, &statusStr, &price, &o.Qty, &o.RemainingQty, &quoteAmount, &remainingQuote, &o.ReservedAmount, &o.SpentAmount, &tif, &o.CreatedAt); err != nil {
			return nil, err
		}
		o.Side = types.OrderSide(sideStr)
		o.Type = types.OrderType(typ)
		o.Status = types.OrderStatus(statusStr)
		o.Price = price
		o.QuoteAmount = quoteAmount
		o.RemainingQuote = remainingQuote
		o.TimeInForce = types.TimeInForce(tif)
		out = append(out, o)
	}
	return out, rows.Err()
}

func (s *Store) UpdateOrderFill(ctx context.Context, tx pgx.Tx, orderID string, price *decimal.Decimal, qty decimal.Decimal, remainingQty decimal.Decimal, remainingQuote *decimal.Decimal, spentAmount decimal.Decimal, status types.OrderStatus) error {
	if remainingQuote == nil {
		_, err := tx.Exec(ctx, "update orders set price = $1, qty = $2, remaining_qty = $3, spent_amount = $4, status = $5, updated_at = $6 where id = $7", price, qty, remainingQty, spentAmount, string(status), time.Now().UTC(), orderID)
		return err
	}
	_, err := tx.Exec(ctx, "update orders set price = $1, qty = $2, remaining_qty = $3, remaining_quote = $4, spent_amount = $5, status = $6, updated_at = $7 where id = $8", price, qty, remainingQty, remainingQuote, spentAmount, string(status), time.Now().UTC(), orderID)
	return err
}

func (s *Store) UpdateOrderStatus(ctx context.Context, tx pgx.Tx, orderID string, status types.OrderStatus) error {
	_, err := tx.Exec(ctx, "update orders set status = $1, updated_at = $2 where id = $3", string(status), time.Now().UTC(), orderID)
	return err
}

func (s *Store) CreateTrade(ctx context.Context, tx pgx.Tx, pairID string, price, qty decimal.Decimal, takerOrderID, makerOrderID string) (string, error) {
	var id string
	err := tx.QueryRow(ctx, "insert into trades (pair_id, price, qty, taker_order_id, maker_order_id, created_at) values ($1,$2,$3,$4,$5,$6) returning id", pairID, price, qty, takerOrderID, makerOrderID, time.Now().UTC()).Scan(&id)
	return id, err
}

func (s *Store) CreateFill(ctx context.Context, tx pgx.Tx, orderID, tradeID string, qty, price decimal.Decimal) error {
	_, err := tx.Exec(ctx, "insert into order_fills (order_id, trade_id, qty, price, created_at) values ($1,$2,$3,$4,$5)", orderID, tradeID, qty, price, time.Now().UTC())
	return err
}
