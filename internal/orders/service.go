package orders

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
	"lv-tradepl/internal/ledger"
	"lv-tradepl/internal/marketdata"
	"lv-tradepl/internal/matching"
	"lv-tradepl/internal/model"
	"lv-tradepl/internal/types"
)

type Service struct {
	pool   *pgxpool.Pool
	store  *Store
	ledger *ledger.Service
	market *marketdata.Store
	match  *matching.Engine
}

func NewService(pool *pgxpool.Pool, store *Store, ledgerSvc *ledger.Service, market *marketdata.Store, match *matching.Engine) *Service {
	return &Service{pool: pool, store: store, ledger: ledgerSvc, market: market, match: match}
}

type PlaceOrderRequest struct {
	UserID       string
	PairSymbol   string
	Side         types.OrderSide
	Type         types.OrderType
	Price        *decimal.Decimal
	Qty          *decimal.Decimal
	QuoteAmount  *decimal.Decimal
	TimeInForce  types.TimeInForce
	ClientRef    string
}

type PlaceOrderResult struct {
	OrderID string
	Status  types.OrderStatus
}

func (s *Service) PlaceOrder(ctx context.Context, req PlaceOrderRequest) (PlaceOrderResult, error) {
	if req.UserID == "" || req.PairSymbol == "" {
		return PlaceOrderResult{}, errors.New("missing user or pair")
	}
	if req.TimeInForce == types.TimeInForceFOK {
		return PlaceOrderResult{}, errors.New("fok not supported")
	}
	if req.Type == types.OrderTypeLimit && req.Price == nil {
		return PlaceOrderResult{}, errors.New("price required for limit order")
	}
	if req.Type == types.OrderTypeMarket && req.Price != nil {
		return PlaceOrderResult{}, errors.New("price not allowed for market order")
	}
	if req.Side != types.OrderSideBuy && req.Side != types.OrderSideSell {
		return PlaceOrderResult{}, errors.New("invalid side")
	}
	if req.Type != types.OrderTypeLimit && req.Type != types.OrderTypeMarket {
		return PlaceOrderResult{}, errors.New("invalid type")
	}
	if req.TimeInForce != types.TimeInForceGTC && req.TimeInForce != types.TimeInForceIOC && req.TimeInForce != types.TimeInForceFOK {
		return PlaceOrderResult{}, errors.New("invalid time_in_force")
	}
	pair, err := s.market.GetPairBySymbol(ctx, req.PairSymbol)
	if err != nil {
		return PlaceOrderResult{}, errors.New("pair not found")
	}
	if pair.Status != "active" {
		return PlaceOrderResult{}, errors.New("pair not active")
	}
	minQty, _ := decimal.NewFromString(pair.MinQty)
	minNotional, _ := decimal.NewFromString(pair.MinNotional)
	if req.Type == types.OrderTypeMarket && req.Side == types.OrderSideBuy {
		if req.QuoteAmount == nil {
			return PlaceOrderResult{}, errors.New("quote_amount required")
		}
		if req.QuoteAmount.LessThanOrEqual(decimal.Zero) {
			return PlaceOrderResult{}, errors.New("invalid quote_amount")
		}
		if minNotional.GreaterThan(decimal.Zero) && req.QuoteAmount.LessThan(minNotional) {
			return PlaceOrderResult{}, errors.New("notional below minimum")
		}
	} else {
		if req.Qty == nil {
			return PlaceOrderResult{}, errors.New("qty required")
		}
		if req.Qty.LessThanOrEqual(decimal.Zero) {
			return PlaceOrderResult{}, errors.New("invalid qty")
		}
		if minQty.GreaterThan(decimal.Zero) && req.Qty.LessThan(minQty) {
			return PlaceOrderResult{}, errors.New("qty below minimum")
		}
	}
	if req.Type == types.OrderTypeLimit {
		if req.Price.LessThanOrEqual(decimal.Zero) {
			return PlaceOrderResult{}, errors.New("invalid price")
		}
		notional := req.Price.Mul(*req.Qty)
		if minNotional.GreaterThan(decimal.Zero) && notional.LessThan(minNotional) {
			return PlaceOrderResult{}, errors.New("notional below minimum")
		}
	}
	if req.Type == types.OrderTypeMarket && req.TimeInForce != types.TimeInForceIOC {
		return PlaceOrderResult{}, errors.New("market orders must be ioc")
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return PlaceOrderResult{}, err
	}
	defer tx.Rollback(ctx)
	var reservedAssetID string
	var reservedAmount decimal.Decimal
	if req.Side == types.OrderSideBuy {
		reservedAssetID = pair.QuoteAssetID
		if req.Type == types.OrderTypeMarket {
			reservedAmount = *req.QuoteAmount
		} else {
			reservedAmount = req.Price.Mul(*req.Qty)
		}
	} else {
		reservedAssetID = pair.BaseAssetID
		reservedAmount = *req.Qty
	}
	availableAccount, err := s.ledger.EnsureAccount(ctx, tx, req.UserID, reservedAssetID, types.AccountKindAvailable)
	if err != nil {
		return PlaceOrderResult{}, err
	}
	reservedAccount, err := s.ledger.EnsureAccount(ctx, tx, req.UserID, reservedAssetID, types.AccountKindReserved)
	if err != nil {
		return PlaceOrderResult{}, err
	}
	balance, err := s.ledger.GetBalance(ctx, tx, availableAccount)
	if err != nil {
		return PlaceOrderResult{}, err
	}
	if balance.LessThan(reservedAmount) {
		return PlaceOrderResult{}, errors.New("insufficient balance")
	}
	_, err = s.ledger.Transfer(ctx, tx, availableAccount, reservedAccount, reservedAmount, types.LedgerEntryTypeReserve, req.ClientRef)
	if err != nil {
		return PlaceOrderResult{}, err
	}
	order := model.Order{
		UserID:         req.UserID,
		PairID:         pair.ID,
		Side:           req.Side,
		Type:           req.Type,
		Status:         types.OrderStatusOpen,
		Price:          req.Price,
		Qty:            decimal.Zero,
		RemainingQty:   decimal.Zero,
		QuoteAmount:    req.QuoteAmount,
		RemainingQuote: req.QuoteAmount,
		ReservedAmount: reservedAmount,
		SpentAmount:    decimal.Zero,
		TimeInForce:    req.TimeInForce,
		CreatedAt:      time.Now().UTC(),
	}
	if req.Type == types.OrderTypeMarket && req.Side == types.OrderSideBuy {
		order.Qty = decimal.Zero
		order.RemainingQty = decimal.Zero
	} else {
		order.Qty = *req.Qty
		order.RemainingQty = *req.Qty
		order.QuoteAmount = nil
		order.RemainingQuote = nil
	}
	orderID, err := s.store.CreateOrder(ctx, tx, order)
	if err != nil {
		return PlaceOrderResult{}, err
	}
	order.ID = orderID
	matchLimit := 50
	var limitPrice *decimal.Decimal
	if req.Type == types.OrderTypeLimit {
		limitPrice = req.Price
	}
		matchInput := matching.MatchInput{
			PairID:       pair.ID,
			BaseAssetID:  pair.BaseAssetID,
			QuoteAssetID: pair.QuoteAssetID,
			TakerOrder:   order,
			LimitPrice:   limitPrice,
			MatchLimit:   matchLimit,
		}
	order, err = s.match.Match(ctx, tx, matchInput)
	if err != nil {
		return PlaceOrderResult{}, err
	}
	finalStatus, err := s.finalizeOrder(ctx, tx, order, reservedAssetID)
	if err != nil {
		return PlaceOrderResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PlaceOrderResult{}, err
	}
	return PlaceOrderResult{OrderID: order.ID, Status: finalStatus}, nil
}

func (s *Service) finalizeOrder(ctx context.Context, tx pgx.Tx, order model.Order, reservedAssetID string) (types.OrderStatus, error) {
	status := order.Status
	if order.Type == types.OrderTypeMarket {
		if order.Side == types.OrderSideBuy {
			if order.RemainingQuote != nil && order.RemainingQuote.GreaterThan(decimal.Zero) {
				status = types.OrderStatusCanceled
			}
		} else {
			if order.RemainingQty.GreaterThan(decimal.Zero) {
				status = types.OrderStatusCanceled
			}
		}
	}
	if order.TimeInForce == types.TimeInForceIOC {
		if order.Type == types.OrderTypeLimit && order.RemainingQty.GreaterThan(decimal.Zero) {
			status = types.OrderStatusCanceled
		}
	}
	if status != order.Status {
		if err := s.store.UpdateOrderStatus(ctx, tx, order.ID, status); err != nil {
			return status, err
		}
	}
	if status == types.OrderStatusFilled || status == types.OrderStatusCanceled {
		remainder := order.ReservedAmount.Sub(order.SpentAmount)
		if remainder.GreaterThan(decimal.Zero) {
			reservedAccount, err := s.ledger.EnsureAccount(ctx, tx, order.UserID, reservedAssetID, types.AccountKindReserved)
			if err != nil {
				return status, err
			}
			availableAccount, err := s.ledger.EnsureAccount(ctx, tx, order.UserID, reservedAssetID, types.AccountKindAvailable)
			if err != nil {
				return status, err
			}
			_, err = s.ledger.Transfer(ctx, tx, reservedAccount, availableAccount, remainder, types.LedgerEntryTypeRelease, "release")
			if err != nil {
				return status, err
			}
		}
	}
	return status, nil
}
