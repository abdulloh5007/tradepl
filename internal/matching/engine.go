package matching

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
	"lv-tradepl/internal/ledger"
	"lv-tradepl/internal/marketdata"
	"lv-tradepl/internal/model"
	"lv-tradepl/internal/types"
)

type Engine struct {
	store  Store
	ledger *ledger.Service
	pub    Publisher
}

type Store interface {
	ListMatchingOrders(ctx context.Context, tx pgx.Tx, pairID string, side types.OrderSide, limitPrice *decimal.Decimal, limit int) ([]model.Order, error)
	UpdateOrderFill(ctx context.Context, tx pgx.Tx, orderID string, remainingQty decimal.Decimal, remainingQuote *decimal.Decimal, spentAmount decimal.Decimal, status types.OrderStatus) error
	CreateTrade(ctx context.Context, tx pgx.Tx, pairID string, price, qty decimal.Decimal, takerOrderID, makerOrderID string) (string, error)
	CreateFill(ctx context.Context, tx pgx.Tx, orderID, tradeID string, qty, price decimal.Decimal) error
}

type Publisher interface {
	Publish(evt marketdata.Event)
}

func NewEngine(store Store, ledgerSvc *ledger.Service, pub Publisher) *Engine {
	return &Engine{store: store, ledger: ledgerSvc, pub: pub}
}

type MatchInput struct {
	PairID        string
	BaseAssetID   string
	QuoteAssetID  string
	TakerOrder    model.Order
	LimitPrice    *decimal.Decimal
	MatchLimit    int
}

func (e *Engine) Match(ctx context.Context, tx pgx.Tx, in MatchInput) (model.Order, error) {
	order := in.TakerOrder
	if in.MatchLimit <= 0 {
		return order, errors.New("match limit required")
	}
	for {
		makers, err := e.store.ListMatchingOrders(ctx, tx, in.PairID, order.Side, in.LimitPrice, in.MatchLimit)
		if err != nil {
			return order, err
		}
		if len(makers) == 0 {
			break
		}
		progress := false
		for _, maker := range makers {
			price := maker.Price
			if price == nil {
				return order, errors.New("maker price missing")
			}
			var qty decimal.Decimal
			if order.Type == types.OrderTypeMarket && order.Side == types.OrderSideBuy {
				if order.RemainingQuote == nil {
					return order, errors.New("remaining quote missing")
				}
				maxQty := order.RemainingQuote.Div(*price)
				if maxQty.LessThanOrEqual(decimal.Zero) {
					return order, nil
				}
				if maker.RemainingQty.LessThan(maxQty) {
					qty = maker.RemainingQty
				} else {
					qty = maxQty
				}
			} else {
				if order.RemainingQty.LessThanOrEqual(decimal.Zero) {
					return order, nil
				}
				if maker.RemainingQty.LessThan(order.RemainingQty) {
					qty = maker.RemainingQty
				} else {
					qty = order.RemainingQty
				}
			}
			if qty.LessThanOrEqual(decimal.Zero) {
				continue
			}
			tradeID, err := e.store.CreateTrade(ctx, tx, in.PairID, *price, qty, order.ID, maker.ID)
			if err != nil {
				return order, err
			}
			if e.pub != nil {
				e.pub.Publish(marketdata.Event{Type: "trade", Data: map[string]string{"trade_id": tradeID, "pair_id": in.PairID, "price": price.String(), "qty": qty.String(), "taker_order_id": order.ID, "maker_order_id": maker.ID}})
			}
			if err := e.store.CreateFill(ctx, tx, order.ID, tradeID, qty, *price); err != nil {
				return order, err
			}
			if err := e.store.CreateFill(ctx, tx, maker.ID, tradeID, qty, *price); err != nil {
				return order, err
			}
			order, maker, err = e.applyLedger(ctx, tx, order, maker, qty, *price, in.BaseAssetID, in.QuoteAssetID)
			if err != nil {
				return order, err
			}
			if err := e.store.UpdateOrderFill(ctx, tx, order.ID, order.RemainingQty, order.RemainingQuote, order.SpentAmount, order.Status); err != nil {
				return order, err
			}
			if err := e.store.UpdateOrderFill(ctx, tx, maker.ID, maker.RemainingQty, maker.RemainingQuote, maker.SpentAmount, maker.Status); err != nil {
				return order, err
			}
			if order.Status == types.OrderStatusFilled {
				return order, nil
			}
			progress = true
		}
		if !progress {
			break
		}
	}
	return order, nil
}

func (e *Engine) applyLedger(ctx context.Context, tx pgx.Tx, taker model.Order, maker model.Order, qty, price decimal.Decimal, baseAssetID, quoteAssetID string) (model.Order, model.Order, error) {
	quoteAmount := price.Mul(qty)
	if taker.Side == types.OrderSideBuy {
		buyer, seller := taker, maker
		buyer, seller, err := e.applyTrade(ctx, tx, buyer, seller, qty, quoteAmount, baseAssetID, quoteAssetID)
		return buyer, seller, err
	}
	seller, buyer := taker, maker
	buyer, seller, err := e.applyTrade(ctx, tx, buyer, seller, qty, quoteAmount, baseAssetID, quoteAssetID)
	return seller, buyer, err
}

func (e *Engine) applyTrade(ctx context.Context, tx pgx.Tx, buy model.Order, sell model.Order, qty, quoteAmount decimal.Decimal, baseAssetID, quoteAssetID string) (model.Order, model.Order, error) {
	buyQuoteReserved, err := e.ledger.EnsureAccount(ctx, tx, buy.UserID, quoteAssetID, types.AccountKindReserved)
	if err != nil {
		return buy, sell, err
	}
	buyBaseAvailable, err := e.ledger.EnsureAccount(ctx, tx, buy.UserID, baseAssetID, types.AccountKindAvailable)
	if err != nil {
		return buy, sell, err
	}
	sellBaseReserved, err := e.ledger.EnsureAccount(ctx, tx, sell.UserID, baseAssetID, types.AccountKindReserved)
	if err != nil {
		return buy, sell, err
	}
	sellQuoteAvailable, err := e.ledger.EnsureAccount(ctx, tx, sell.UserID, quoteAssetID, types.AccountKindAvailable)
	if err != nil {
		return buy, sell, err
	}
	_, err = e.ledger.Transfer(ctx, tx, buyQuoteReserved, sellQuoteAvailable, quoteAmount, types.LedgerEntryTypeTrade, "trade")
	if err != nil {
		return buy, sell, err
	}
	_, err = e.ledger.Transfer(ctx, tx, sellBaseReserved, buyBaseAvailable, qty, types.LedgerEntryTypeTrade, "trade")
	if err != nil {
		return buy, sell, err
	}
	buy, sell = applyOrderFill(buy, sell, qty, quoteAmount)
	return buy, sell, nil
}

func applyOrderFill(buy model.Order, sell model.Order, qty, quoteAmount decimal.Decimal) (model.Order, model.Order) {
	buy.SpentAmount = buy.SpentAmount.Add(quoteAmount)
	sell.SpentAmount = sell.SpentAmount.Add(qty)
	if buy.Type == types.OrderTypeMarket && buy.Side == types.OrderSideBuy {
		if buy.RemainingQuote != nil {
			v := buy.RemainingQuote.Sub(quoteAmount)
			buy.RemainingQuote = &v
		}
	} else {
		buy.RemainingQty = buy.RemainingQty.Sub(qty)
	}
	sell.RemainingQty = sell.RemainingQty.Sub(qty)
	buy.Status = statusFromRemaining(buy)
	sell.Status = statusFromRemaining(sell)
	return buy, sell
}

func statusFromRemaining(o model.Order) types.OrderStatus {
	if o.Type == types.OrderTypeMarket && o.Side == types.OrderSideBuy {
		if o.RemainingQuote == nil || o.RemainingQuote.LessThanOrEqual(decimal.Zero) {
			return types.OrderStatusFilled
		}
		return types.OrderStatusPartiallyFilled
	}
	if o.RemainingQty.LessThanOrEqual(decimal.Zero) {
		return types.OrderStatusFilled
	}
	if o.RemainingQty.Equal(o.Qty) {
		return types.OrderStatusOpen
	}
	return types.OrderStatusPartiallyFilled
}
