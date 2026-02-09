package orders

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"lv-tradepl/internal/accounts"
	"lv-tradepl/internal/ledger"
	"lv-tradepl/internal/marketdata"
	"lv-tradepl/internal/matching"
	"lv-tradepl/internal/model"
	"lv-tradepl/internal/types"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
)

type Service struct {
	pool       *pgxpool.Pool
	store      *Store
	ledger     *ledger.Service
	market     *marketdata.Store
	match      *matching.Engine
	accountSvc *accounts.Service
}

func NewService(pool *pgxpool.Pool, store *Store, ledgerSvc *ledger.Service, market *marketdata.Store, match *matching.Engine, accountSvc *accounts.Service) *Service {
	return &Service{pool: pool, store: store, ledger: ledgerSvc, market: market, match: match, accountSvc: accountSvc}
}

type PlaceOrderRequest struct {
	UserID      string
	AccountID   string
	PairSymbol  string
	Side        types.OrderSide
	Type        types.OrderType
	Price       *decimal.Decimal
	Qty         *decimal.Decimal
	QuoteAmount *decimal.Decimal
	TimeInForce types.TimeInForce
	ClientRef   string
}

type PlaceOrderResult struct {
	OrderID string
	Status  types.OrderStatus
}

type CloseOrdersResult struct {
	Scope  string `json:"scope"`
	Total  int    `json:"total"`
	Closed int    `json:"closed"`
	Failed int    `json:"failed"`
}

func (s *Service) PlaceOrder(ctx context.Context, req PlaceOrderRequest) (PlaceOrderResult, error) {
	if req.UserID == "" || req.PairSymbol == "" || req.AccountID == "" {
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
	riskCfg, riskErr := s.GetRiskConfig(ctx)
	if riskErr != nil {
		return PlaceOrderResult{}, fmt.Errorf("failed to load risk config: %w", riskErr)
	}
	contractSize := pairContractSize(pair)
	spreadMultiplier := 1.0
	commissionRate := 0.0
	effectiveLeverage := decimal.NewFromInt(100)
	if s.accountSvc != nil {
		acc, accErr := s.accountSvc.Resolve(ctx, req.UserID, req.AccountID)
		if accErr != nil {
			return PlaceOrderResult{}, accErr
		}
		if acc != nil {
			if acc.Plan.SpreadMultiplier > 0 {
				spreadMultiplier = acc.Plan.SpreadMultiplier
			}
			if acc.Plan.CommissionRate > 0 {
				commissionRate = acc.Plan.CommissionRate
			}
			effectiveLeverage = resolveEffectiveLeverage(acc.Leverage, riskCfg)
		}
	}

	currentMetrics, openPositions, metricsErr := s.computeAccountMetricsByAccount(ctx, req.UserID, req.AccountID)
	if metricsErr != nil {
		return PlaceOrderResult{}, fmt.Errorf("failed to evaluate margin risk: %w", metricsErr)
	}
	if len(openPositions) >= riskCfg.MaxOpenPositions {
		return PlaceOrderResult{}, fmt.Errorf("max open positions reached (%d)", riskCfg.MaxOpenPositions)
	}
	if currentMetrics.Margin.GreaterThan(decimal.Zero) {
		if currentMetrics.MarginLevel.LessThanOrEqual(riskCfg.StopOutLevelPercent) {
			return PlaceOrderResult{}, errors.New("stop out active: margin level is too low, reduce exposure first")
		}
		if currentMetrics.MarginLevel.LessThanOrEqual(riskCfg.MarginCallLevelPercent) {
			return PlaceOrderResult{}, errors.New("margin call: opening new orders is disabled until margin level recovers")
		}
	}

	minQty := pairMinLot(pair)
	minNotional, _ := decimal.NewFromString(pair.MinNotional)
	// Validation for Market Buy
	if req.Type == types.OrderTypeMarket && req.Side == types.OrderSideBuy {
		// Broker Style: Allow Qty for Market Buy
		if req.Qty == nil && req.QuoteAmount == nil {
			return PlaceOrderResult{}, errors.New("qty or quote_amount required")
		}
		if req.Qty != nil && req.Qty.LessThanOrEqual(decimal.Zero) {
			return PlaceOrderResult{}, errors.New("invalid qty")
		}
		if req.QuoteAmount != nil && req.QuoteAmount.LessThanOrEqual(decimal.Zero) {
			return PlaceOrderResult{}, errors.New("invalid quote_amount")
		}
		// If both, prefer Qty? Or error? Let's prefer Qty if provided (Broker style).
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
		if req.Price == nil || req.Price.LessThanOrEqual(decimal.Zero) {
			return PlaceOrderResult{}, errors.New("invalid price")
		}
		notional := orderNotional(pair.Symbol, *req.Price, *req.Qty, contractSize)
		if minNotional.GreaterThan(decimal.Zero) && notional.LessThan(minNotional) {
			return PlaceOrderResult{}, errors.New("notional below minimum")
		}
	}
	if req.Type == types.OrderTypeMarket && req.TimeInForce != types.TimeInForceIOC {
		return PlaceOrderResult{}, errors.New("market orders must be ioc")
	}

	var marketBid float64
	var marketAsk float64
	var invertedDisplayPair bool
	var estimatedPrice decimal.Decimal
	var estimatedQty decimal.Decimal
	var estimatedNotional decimal.Decimal
	if req.Type == types.OrderTypeMarket {
		var quoteErr error
		marketBid, marketAsk, quoteErr = marketdata.GetCurrentQuote(pair.Symbol)
		if quoteErr != nil {
			return PlaceOrderResult{}, fmt.Errorf("failed to get market quote: %w", quoteErr)
		}
		marketBid, marketAsk = applySpreadMultiplier(marketBid, marketAsk, spreadMultiplier)
		invertedDisplayPair = marketdata.IsDisplayInverted(pair.Symbol)

		entryPrice := marketAsk
		if req.Side == types.OrderSideSell {
			entryPrice = marketBid
		}
		if invertedDisplayPair {
			if req.Side == types.OrderSideBuy {
				entryPrice = marketBid
			} else {
				entryPrice = marketAsk
			}
		}
		estimatedPrice = decimal.NewFromFloat(entryPrice)
		if req.Qty != nil {
			estimatedQty = *req.Qty
		} else if req.QuoteAmount != nil && estimatedPrice.GreaterThan(decimal.Zero) {
			accPrice, ok := accountingPriceForPair(pair.Symbol, estimatedPrice)
			if !ok {
				return PlaceOrderResult{}, errors.New("failed to compute order size")
			}
			estimatedQty = req.QuoteAmount.Div(accPrice.Mul(contractSize))
		}
		estimatedNotional = orderNotional(pair.Symbol, estimatedPrice, estimatedQty, contractSize)
	} else {
		estimatedPrice = *req.Price
		estimatedQty = *req.Qty
		estimatedNotional = orderNotional(pair.Symbol, estimatedPrice, estimatedQty, contractSize)
	}
	if !estimatedQty.GreaterThan(decimal.Zero) || !estimatedPrice.GreaterThan(decimal.Zero) || !estimatedNotional.GreaterThan(decimal.Zero) {
		return PlaceOrderResult{}, errors.New("invalid order size")
	}

	if estimatedQty.GreaterThan(riskCfg.MaxOrderLots) {
		return PlaceOrderResult{}, fmt.Errorf("max lots per order is %s", riskCfg.MaxOrderLots.String())
	}
	if estimatedNotional.GreaterThan(riskCfg.MaxOrderNotionalUSD) {
		return PlaceOrderResult{}, fmt.Errorf("max notional per order is %s USD", riskCfg.MaxOrderNotionalUSD.String())
	}
	if effectiveLeverage.GreaterThan(decimal.Zero) {
		requiredMargin := estimatedNotional.Div(effectiveLeverage)
		if !currentMetrics.FreeMargin.GreaterThan(decimal.Zero) || requiredMargin.GreaterThan(currentMetrics.FreeMargin) {
			return PlaceOrderResult{}, errors.New("insufficient free margin for this order size")
		}
	}

	// Transaction
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
			if req.Qty != nil {
				// Broker Style Buy: Qty specified. Need to estimate cost.
				entryPrice := marketAsk
				if invertedDisplayPair {
					// For inverted display pairs, preserve visual spread direction:
					// BUY opens at upper side in displayed prices.
					entryPrice = marketBid
				}
				askPrice := decimal.NewFromFloat(entryPrice)
				// Reserve cost = lots * contract_size * Ask
				reservedAmount = orderNotional(pair.Symbol, askPrice, *req.Qty, contractSize)
				if commissionRate > 0 {
					reservedAmount = reservedAmount.Add(reservedAmount.Mul(decimal.NewFromFloat(commissionRate)))
				}
			} else {
				// Exchange Style Buy: Spend fixed amount
				reservedAmount = *req.QuoteAmount
			}
		} else {
			// Limit Buy
			reservedAmount = orderNotional(pair.Symbol, *req.Price, *req.Qty, contractSize)
		}
	} else {
		if req.Type == types.OrderTypeMarket {
			reservedAssetID = pair.QuoteAssetID
			entryPrice := marketBid
			if invertedDisplayPair {
				entryPrice = marketAsk
			}
			bidPrice := decimal.NewFromFloat(entryPrice)
			reservedAmount = orderNotional(pair.Symbol, bidPrice, *req.Qty, contractSize)
			if commissionRate > 0 {
				reservedAmount = reservedAmount.Add(reservedAmount.Mul(decimal.NewFromFloat(commissionRate)))
			}
		} else {
			reservedAssetID = pair.BaseAssetID
			reservedAmount = *req.Qty
		}
	}
	availableAccount, err := s.ledger.EnsureAccountForTradingAccount(ctx, tx, req.UserID, req.AccountID, reservedAssetID, types.AccountKindAvailable)
	if err != nil {
		return PlaceOrderResult{}, err
	}
	reservedAccount, err := s.ledger.EnsureAccountForTradingAccount(ctx, tx, req.UserID, req.AccountID, reservedAssetID, types.AccountKindReserved)
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
		UserID:           req.UserID,
		TradingAccountID: req.AccountID,
		PairID:           pair.ID,
		Side:             req.Side,
		Type:             req.Type,
		Status:           types.OrderStatusOpen,
		Price:            req.Price,
		Qty:              decimal.Zero,
		RemainingQty:     decimal.Zero,
		QuoteAmount:      req.QuoteAmount,
		RemainingQuote:   req.QuoteAmount,
		ReservedAmount:   reservedAmount,
		SpentAmount:      decimal.Zero,
		TimeInForce:      req.TimeInForce,
		CreatedAt:        time.Now().UTC(),
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

	// Broker-Style Execution: Market orders fill instantly against "the market"
	if req.Type == types.OrderTypeMarket {
		var execPrice decimal.Decimal
		var execQty decimal.Decimal

		if req.Side == types.OrderSideBuy {
			// Buy at Ask price (or Bid for inverted display pairs)
			entryPrice := marketAsk
			if invertedDisplayPair {
				entryPrice = marketBid
			}
			execPrice = decimal.NewFromFloat(entryPrice)
			if req.Qty != nil {
				execQty = *req.Qty
			} else if req.QuoteAmount != nil {
				// Calculate lots from quote notional.
				accPrice, ok := accountingPriceForPair(pair.Symbol, execPrice)
				if !ok {
					return PlaceOrderResult{}, errors.New("failed to compute order size")
				}
				execQty = req.QuoteAmount.Div(accPrice.Mul(contractSize))
			}
		} else {
			// Sell at Bid price (or Ask for inverted display pairs)
			entryPrice := marketBid
			if invertedDisplayPair {
				entryPrice = marketAsk
			}
			execPrice = decimal.NewFromFloat(entryPrice)
			execQty = *req.Qty
		}

		quoteAmount := orderNotional(pair.Symbol, execPrice, execQty, contractSize)
		commissionAmount := decimal.Zero
		if commissionRate > 0 {
			commissionAmount = quoteAmount.Mul(decimal.NewFromFloat(commissionRate))
		}

		// Execute the trade: Transfer funds
		if req.Side == types.OrderSideBuy {
			// Buyer: Reserved USD -> "Market" (burn), Receive Base Asset
			reservedQuote, _ := s.ledger.EnsureAccountForTradingAccount(ctx, tx, req.UserID, req.AccountID, pair.QuoteAssetID, types.AccountKindReserved)
			availableBase, _ := s.ledger.EnsureAccountForTradingAccount(ctx, tx, req.UserID, req.AccountID, pair.BaseAssetID, types.AccountKindAvailable)

			// Deduct USD from Reserved
			_, err := s.ledger.DebitAccount(ctx, tx, reservedQuote, quoteAmount.Add(commissionAmount), types.LedgerEntryTypeTrade, "market_buy")
			if err != nil {
				return PlaceOrderResult{}, fmt.Errorf("failed to debit quote: %w", err)
			}
			// Credit Base Asset to Available (Mint from Market)
			_, err = s.ledger.CreditAccount(ctx, tx, availableBase, execQty, types.LedgerEntryTypeTrade, "market_buy")
			if err != nil {
				return PlaceOrderResult{}, fmt.Errorf("failed to credit base: %w", err)
			}
		} else {
			// Seller (short): lock/debit reserved USD notional at open.
			reservedQuote, _ := s.ledger.EnsureAccountForTradingAccount(ctx, tx, req.UserID, req.AccountID, pair.QuoteAssetID, types.AccountKindReserved)
			_, err := s.ledger.DebitAccount(ctx, tx, reservedQuote, quoteAmount.Add(commissionAmount), types.LedgerEntryTypeTrade, "market_sell")
			if err != nil {
				return PlaceOrderResult{}, fmt.Errorf("failed to debit quote: %w", err)
			}
		}

		// Update order to Filled
		order.Status = types.OrderStatusFilled
		order.SpentAmount = quoteAmount
		order.Qty = execQty
		order.RemainingQty = decimal.Zero
		order.RemainingQuote = nil
		order.Price = &execPrice // Entry Price

		err = s.store.UpdateOrderFill(ctx, tx, order.ID, order.Price, order.Qty, order.RemainingQty, order.RemainingQuote, order.SpentAmount, order.Status)
		if err != nil {
			return PlaceOrderResult{}, err
		}

		if err := tx.Commit(ctx); err != nil {
			return PlaceOrderResult{}, err
		}
		return PlaceOrderResult{OrderID: order.ID, Status: order.Status}, nil
	}

	// Limit Orders: Use Exchange-Style Matching
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
			reservedAccount, err := s.ledger.EnsureAccountForTradingAccount(ctx, tx, order.UserID, order.TradingAccountID, reservedAssetID, types.AccountKindReserved)
			if err != nil {
				return status, err
			}
			availableAccount, err := s.ledger.EnsureAccountForTradingAccount(ctx, tx, order.UserID, order.TradingAccountID, reservedAssetID, types.AccountKindAvailable)
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

type AccountMetrics struct {
	Balance     decimal.Decimal `json:"balance"`
	Equity      decimal.Decimal `json:"equity"`
	Margin      decimal.Decimal `json:"margin"`
	FreeMargin  decimal.Decimal `json:"free_margin"`
	MarginLevel decimal.Decimal `json:"margin_level"`
	PnL         decimal.Decimal `json:"pl"`
}

type positionRisk struct {
	Order model.Order
	PnL   decimal.Decimal
}

type RiskConfig struct {
	MaxOpenPositions           int
	MaxOrderLots               decimal.Decimal
	MaxOrderNotionalUSD        decimal.Decimal
	MarginCallLevelPercent     decimal.Decimal
	StopOutLevelPercent        decimal.Decimal
	UnlimitedEffectiveLeverage decimal.Decimal
}

var defaultRiskConfig = RiskConfig{
	MaxOpenPositions:           200,
	MaxOrderLots:               decimal.NewFromInt(100),
	MaxOrderNotionalUSD:        decimal.NewFromInt(50000),
	MarginCallLevelPercent:     decimal.NewFromInt(60),
	StopOutLevelPercent:        decimal.NewFromInt(20),
	UnlimitedEffectiveLeverage: decimal.NewFromInt(3000),
}

func (s *Service) GetAccountMetrics(ctx context.Context, userID string) (AccountMetrics, error) {
	// 1. Get all balances
	return s.GetAccountMetricsByAccount(ctx, userID, "")
}

func (s *Service) GetAccountMetricsByAccount(ctx context.Context, userID, accountID string) (AccountMetrics, error) {
	riskCfg, riskErr := s.GetRiskConfig(ctx)
	if riskErr != nil {
		return AccountMetrics{}, riskErr
	}
	metrics, positions, err := s.computeAccountMetricsByAccount(ctx, userID, accountID)
	if err != nil {
		return AccountMetrics{}, err
	}

	if metrics.Margin.GreaterThan(decimal.Zero) && metrics.MarginLevel.LessThanOrEqual(riskCfg.StopOutLevelPercent) {
		changed, stopErr := s.applyStopOut(ctx, userID, accountID, positions, riskCfg)
		if stopErr == nil && changed {
			refreshed, _, refreshErr := s.computeAccountMetricsByAccount(ctx, userID, accountID)
			if refreshErr == nil {
				return refreshed, nil
			}
		}
	}

	return metrics, nil
}

func (s *Service) computeAccountMetricsByAccount(ctx context.Context, userID, accountID string) (AccountMetrics, []positionRisk, error) {
	balances, err := s.ledger.BalancesByUserAndAccount(ctx, userID, accountID)
	if err != nil {
		return AccountMetrics{}, nil, err
	}

	var balance decimal.Decimal
	var pendingMargin decimal.Decimal
	var floatingPnL decimal.Decimal
	var positionMargin decimal.Decimal
	var positionPrincipal decimal.Decimal
	positions := make([]positionRisk, 0, 8)
	spreadMultiplier := 1.0
	leverage := decimal.NewFromInt(100)
	riskCfg, riskErr := s.GetRiskConfig(ctx)
	if riskErr != nil {
		return AccountMetrics{}, nil, riskErr
	}

	if s.accountSvc != nil {
		acc, accErr := s.accountSvc.Resolve(ctx, userID, accountID)
		if accErr == nil && acc != nil {
			if acc.Plan.SpreadMultiplier > 0 {
				spreadMultiplier = acc.Plan.SpreadMultiplier
			}
			leverage = resolveEffectiveLeverage(acc.Leverage, riskCfg)
		}
	}

	for _, b := range balances {
		if b.Symbol != "USD" {
			continue
		}
		balance = balance.Add(b.Amount)
		if b.Kind == types.AccountKindReserved && b.Amount.GreaterThan(decimal.Zero) {
			pendingMargin = pendingMargin.Add(b.Amount)
		}
	}

	openOrders, err := s.ListOpenOrdersByAccount(ctx, userID, accountID)
	if err != nil {
		return AccountMetrics{}, nil, err
	}

	pairCache := make(map[string]marketdata.Pair, 4)
	for _, o := range openOrders {
		filledQty := o.Qty.Sub(o.RemainingQty)
		if !filledQty.GreaterThan(decimal.Zero) {
			continue
		}
		if o.Side != types.OrderSideBuy && o.Side != types.OrderSideSell {
			continue
		}

		pair, ok := pairCache[o.PairID]
		if !ok {
			p, pairErr := s.market.GetPairByID(ctx, o.PairID)
			if pairErr != nil {
				continue
			}
			pair = p
			pairCache[o.PairID] = pair
		}
		contractSize := pairContractSize(pair)
		if o.Price == nil || o.Price.LessThanOrEqual(decimal.Zero) {
			if o.SpentAmount.GreaterThan(decimal.Zero) {
				avgRaw, ok := deriveEntryRawFromSpent(pair.Symbol, o.SpentAmount, filledQty, contractSize)
				if !ok {
					continue
				}
				o.Price = &avgRaw
			} else {
				continue
			}
		}

		bid, ask, quoteErr := marketdata.GetCurrentQuote(pair.Symbol)
		if quoteErr != nil {
			continue
		}
		bid, ask = applySpreadMultiplier(bid, ask, spreadMultiplier)
		entryRaw := *o.Price
		markRaw := decimal.NewFromFloat(bid)
		if o.Side == types.OrderSideSell {
			markRaw = decimal.NewFromFloat(ask)
		}

		entryForMargin, ok := effectivePriceForPair(pair.Symbol, entryRaw)
		if !ok {
			continue
		}

		notional := entryForMargin.Mul(filledQty).Mul(contractSize)
		positionPrincipal = positionPrincipal.Add(notional)
		if leverage.GreaterThan(decimal.Zero) {
			positionMargin = positionMargin.Add(notional.Div(leverage))
		}
		orderPnL := calculateOrderPnL(pair.Symbol, o.Side, entryRaw, markRaw, filledQty, pairPnLContractSize(pair))
		floatingPnL = floatingPnL.Add(orderPnL)
		if o.Status == types.OrderStatusFilled {
			positions = append(positions, positionRisk{Order: o, PnL: orderPnL})
		}
	}

	brokerBalance := balance.Add(positionPrincipal)
	equity := brokerBalance.Add(floatingPnL)
	margin := pendingMargin.Add(positionMargin)
	freeMargin := equity.Sub(margin)
	var marginLevel decimal.Decimal
	if margin.GreaterThan(decimal.Zero) {
		marginLevel = equity.Div(margin).Mul(decimal.NewFromInt(100))
	}

	return AccountMetrics{
		Balance:     brokerBalance,
		Equity:      equity,
		Margin:      margin,
		FreeMargin:  freeMargin,
		MarginLevel: marginLevel,
		PnL:         floatingPnL,
	}, positions, nil
}

func (s *Service) applyStopOut(ctx context.Context, userID, accountID string, positions []positionRisk, riskCfg RiskConfig) (bool, error) {
	losing := make([]positionRisk, 0, len(positions))
	for _, p := range positions {
		if p.PnL.LessThan(decimal.Zero) {
			losing = append(losing, p)
		}
	}
	if len(losing) == 0 {
		return false, nil
	}

	sort.Slice(losing, func(i, j int) bool {
		return losing[i].PnL.LessThan(losing[j].PnL)
	})

	closedAny := false
	for _, p := range losing {
		if err := s.CancelOrder(ctx, userID, p.Order.ID, accountID); err != nil {
			continue
		}
		closedAny = true

		metrics, _, err := s.computeAccountMetricsByAccount(ctx, userID, accountID)
		if err != nil {
			return closedAny, err
		}
		if !metrics.Margin.GreaterThan(decimal.Zero) || metrics.MarginLevel.GreaterThan(riskCfg.StopOutLevelPercent) {
			return closedAny, nil
		}
	}

	return closedAny, nil
}

func (s *Service) ListOpenOrders(ctx context.Context, userID string) ([]model.Order, error) {
	return s.ListOpenOrdersByAccount(ctx, userID, "")
}

func (s *Service) ListOpenOrdersByAccount(ctx context.Context, userID, accountID string) ([]model.Order, error) {
	// Broker Style: We need the ENTRY PRICE ("Open Price").
	// For a Market Order (filled/partially filled), Entry Price = SpentQuote / FilledQty.
	// We will calculate this on the fly or return it.
	// The `orders` table has `spent_amount` (quote spent) and `qty` (total) and `remaining_qty`.
	// filled_qty = qty - remaining_qty.
	// If filled_qty > 0, avg_price = spent_amount / filled_qty.

	query := `
		SELECT id, user_id, trading_account_id, pair_id, side, type, status, price, qty, remaining_qty, quote_amount, remaining_quote, reserved_amount, spent_amount, time_in_force, created_at
		FROM orders
		WHERE user_id = $1
		  AND ($2 = '' OR coalesce(trading_account_id::text, '') = $2)
		  AND status IN ('open', 'partially_filled', 'filled') -- Include filled if they are "open positions" in broker model?
		-- Actually in Broker model, a "Filled Order" IS an "Open Position" until explicitly closed.
		-- But our matching engine treats "Filled" as done.
		-- ADAPTATION: We will treat "Filled" buy orders as "Open Positions" IF the user still holds the asset.
		-- But wait, standard Spot: You buy, you hold.
		-- MT5 Spot: You have a "Position".
		-- Let's just list ALL non-cancelled orders that haven't been "closed" by a counter-trade?
		-- Complexity: Position management vs Order matching.
		-- MVP Fix: Just list 'filled' orders as "Positions" for now?
		-- User said: "I bought, balance dropped". Status is likely 'filled'.
		-- So we MUST return 'filled' orders too.
		-- AND we need to filter out orders that were "closed" (sold).
		-- Determining if a filled buy is "closed" is hard without a Position ID.
		-- SIMPLIFICATION for MVP:
		-- We just list ALL orders (limit 50 desc) and let frontend calculate?
		-- No, user wants "Open Orders".
		-- Let's stick to: Open Orders = Active Limit Orders OR "Positions" (Filled Buys that are not sold?).
		-- This is getting complex for a simple "Spot Exchange" backend.
		-- ALTERNATIVE: Just list everything from orders table that is NOT cancelled/closed.
		-- And for P/L:
		-- If Status=Filled, EntryPrice = Spent / Qty.
		-- If Status=New, EntryPrice = Price (Limit).
			AND status NOT IN ('canceled', 'closed')
		ORDER BY created_at DESC
	`
	rows, err := s.pool.Query(ctx, query, userID, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	spreadMultiplier := 1.0
	if s.accountSvc != nil {
		acc, accErr := s.accountSvc.Resolve(ctx, userID, accountID)
		if accErr == nil && acc != nil && acc.Plan.SpreadMultiplier > 0 {
			spreadMultiplier = acc.Plan.SpreadMultiplier
		}
	}
	pairCache := make(map[string]marketdata.Pair, 4)
	type quoteMark struct {
		bid decimal.Decimal
		ask decimal.Decimal
	}
	quoteCache := make(map[string]quoteMark, 4)

	var orders []model.Order
	for rows.Next() {
		var o model.Order
		err := rows.Scan(
			&o.ID, &o.UserID, &o.TradingAccountID, &o.PairID, &o.Side, &o.Type, &o.Status,
			&o.Price, &o.Qty, &o.RemainingQty, &o.QuoteAmount, &o.RemainingQuote,
			&o.ReservedAmount, &o.SpentAmount, &o.TimeInForce, &o.CreatedAt,
		)
		if err != nil {
			return nil, err
		}

		// Broker Logic: Calculate entry price only if DB entry is missing.
		filledQty := o.Qty.Sub(o.RemainingQty)
		if (o.Price == nil || o.Price.LessThanOrEqual(decimal.Zero)) && filledQty.GreaterThan(decimal.Zero) && o.SpentAmount.GreaterThan(decimal.Zero) {
			if pair, pairErr := s.market.GetPairByID(ctx, o.PairID); pairErr == nil {
				avgRaw, ok := deriveEntryRawFromSpent(pair.Symbol, o.SpentAmount, filledQty, pairContractSize(pair))
				if ok {
					o.Price = &avgRaw
				}
			}
		}

		if filledQty.GreaterThan(decimal.Zero) && o.Price != nil && o.Price.GreaterThan(decimal.Zero) && (o.Side == types.OrderSideBuy || o.Side == types.OrderSideSell) {
			pair, ok := pairCache[o.PairID]
			if !ok {
				p, pairErr := s.market.GetPairByID(ctx, o.PairID)
				if pairErr == nil {
					pair = p
					pairCache[o.PairID] = p
				}
			}
			if pair.Symbol != "" {
				qm, ok := quoteCache[o.PairID]
				if !ok {
					bid, ask, quoteErr := marketdata.GetCurrentQuote(pair.Symbol)
					if quoteErr == nil {
						bid, ask = applySpreadMultiplier(bid, ask, spreadMultiplier)
						qm = quoteMark{
							bid: decimal.NewFromFloat(bid),
							ask: decimal.NewFromFloat(ask),
						}
						quoteCache[o.PairID] = qm
						ok = true
					}
				}
				if ok {
					mark := qm.bid
					if o.Side == types.OrderSideSell {
						mark = qm.ask
					}
					pnl := calculateOrderPnL(pair.Symbol, o.Side, *o.Price, mark, filledQty, pairPnLContractSize(pair))
					o.UnrealizedPnL = &pnl
				}
			}
		}

		orders = append(orders, o)
	}
	return orders, nil
}

func (s *Service) ListOrderHistoryByAccount(ctx context.Context, userID, accountID string, before *time.Time, limit int) ([]model.Order, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	query := `
		SELECT id, user_id, trading_account_id, pair_id, side, type, status, price, qty, remaining_qty, quote_amount, remaining_quote, reserved_amount, spent_amount, time_in_force, created_at
		FROM orders
		WHERE user_id = $1
		  AND ($2 = '' OR coalesce(trading_account_id::text, '') = $2)
		  AND ($3::timestamptz IS NULL OR created_at < $3)
		  AND status IN ('closed', 'canceled')
		ORDER BY created_at DESC
		LIMIT $4
	`
	rows, err := s.pool.Query(ctx, query, userID, accountID, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []model.Order
	for rows.Next() {
		var o model.Order
		err := rows.Scan(
			&o.ID, &o.UserID, &o.TradingAccountID, &o.PairID, &o.Side, &o.Type, &o.Status,
			&o.Price, &o.Qty, &o.RemainingQty, &o.QuoteAmount, &o.RemainingQuote,
			&o.ReservedAmount, &o.SpentAmount, &o.TimeInForce, &o.CreatedAt,
		)
		if err != nil {
			return nil, err
		}

		filledQty := o.Qty.Sub(o.RemainingQty)
		if (o.Price == nil || o.Price.LessThanOrEqual(decimal.Zero)) && filledQty.GreaterThan(decimal.Zero) && o.SpentAmount.GreaterThan(decimal.Zero) {
			if pair, pairErr := s.market.GetPairByID(ctx, o.PairID); pairErr == nil {
				avgRaw, ok := deriveEntryRawFromSpent(pair.Symbol, o.SpentAmount, filledQty, pairContractSize(pair))
				if ok {
					o.Price = &avgRaw
				}
			}
		}

		orders = append(orders, o)
	}
	return orders, nil
}

func (s *Service) CloseOrdersByScope(ctx context.Context, userID, accountID, scope string) (CloseOrdersResult, error) {
	normalized := strings.ToLower(strings.TrimSpace(scope))
	if normalized == "" {
		normalized = "all"
	}
	if normalized != "all" && normalized != "profit" && normalized != "loss" {
		return CloseOrdersResult{}, errors.New("invalid close scope; allowed: all, profit, loss")
	}

	_, positions, err := s.computeAccountMetricsByAccount(ctx, userID, accountID)
	if err != nil {
		return CloseOrdersResult{}, err
	}

	selected := make([]positionRisk, 0, len(positions))
	for _, p := range positions {
		switch normalized {
		case "all":
			selected = append(selected, p)
		case "profit":
			if p.PnL.GreaterThan(decimal.Zero) {
				selected = append(selected, p)
			}
		case "loss":
			if p.PnL.LessThan(decimal.Zero) {
				selected = append(selected, p)
			}
		}
	}

	res := CloseOrdersResult{
		Scope: normalized,
		Total: len(selected),
	}
	for _, p := range selected {
		if err := s.CancelOrder(ctx, userID, p.Order.ID, accountID); err != nil {
			res.Failed++
			continue
		}
		res.Closed++
	}

	return res, nil
}

// ClosePosition closes an open position at current market price
// This is used for "closing" a trade (not canceling an unfilled order)
func (s *Service) CancelOrder(ctx context.Context, userID, orderID, accountID string) error {
	// Start transaction
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// 1. Get the position/order
	order, err := s.store.GetOrderForUpdate(ctx, tx, orderID)
	if err != nil {
		return fmt.Errorf("order not found: %w", err)
	}

	// 2. Verify ownership
	if order.UserID != userID {
		return errors.New("not your order")
	}
	if accountID != "" && order.TradingAccountID != accountID {
		return errors.New("order does not belong to selected account")
	}

	// 3. Only filled orders can be "closed" as positions
	if order.Status != types.OrderStatusFilled {
		return errors.New("only filled positions can be closed")
	}

	// 4. Get pair info for asset IDs
	pair, err := s.market.GetPairByID(ctx, order.PairID)
	if err != nil {
		return fmt.Errorf("pair not found: %w", err)
	}

	// 5. Get current market price
	bid, ask, err := marketdata.GetCurrentQuote(pair.Symbol)
	if err != nil {
		return fmt.Errorf("failed to get market price: %w", err)
	}
	spreadMultiplier := 1.0
	commissionRate := 0.0
	if s.accountSvc != nil {
		acc, accErr := s.accountSvc.Resolve(ctx, userID, accountID)
		if accErr == nil && acc != nil {
			if acc.Plan.SpreadMultiplier > 0 {
				spreadMultiplier = acc.Plan.SpreadMultiplier
			}
			if acc.Plan.CommissionRate > 0 {
				commissionRate = acc.Plan.CommissionRate
			}
		}
	}
	bid, ask = applySpreadMultiplier(bid, ask, spreadMultiplier)

	// 6. Calculate exit price and P/L
	var exitPrice decimal.Decimal
	var pnl decimal.Decimal
	entryPrice := *order.Price
	qty := order.Qty
	contractSize := pairContractSize(pair)

	exitPrice = decimal.NewFromFloat(bid)
	if order.Side == types.OrderSideSell {
		exitPrice = decimal.NewFromFloat(ask)
	}
	pnl = calculateOrderPnL(pair.Symbol, order.Side, entryPrice, exitPrice, qty, pairPnLContractSize(pair))

	// 7. Update user's USD balance
	// Get the user's available USD account
	usdAvailable, err := s.ledger.EnsureAccountForTradingAccount(ctx, tx, userID, accountID, pair.QuoteAssetID, types.AccountKindAvailable)
	if err != nil {
		return fmt.Errorf("failed to get USD account: %w", err)
	}

	// Calculate total return: original investment + P/L
	// For a buy: we spent order.SpentAmount (USD), now we get it back + P/L
	closeAmount := order.SpentAmount.Add(pnl)
	if commissionRate > 0 {
		closeNotional := orderNotional(pair.Symbol, exitPrice, qty, contractSize)
		if closeNotional.GreaterThan(decimal.Zero) {
			closeAmount = closeAmount.Sub(closeNotional.Mul(decimal.NewFromFloat(commissionRate)))
		}
	}

	if closeAmount.GreaterThan(decimal.Zero) {
		// Credit the return to available balance
		_, err = s.ledger.CreditAccount(ctx, tx, usdAvailable, closeAmount, types.LedgerEntryTypeTrade, "close_position")
		if err != nil {
			return fmt.Errorf("failed to credit balance: %w", err)
		}
	} else {
		// Negative balance protection: never debit beyond available balance.
		lossBeyondReserved := closeAmount.Abs()
		availableBalance, balErr := s.ledger.GetBalance(ctx, tx, usdAvailable)
		if balErr != nil {
			return fmt.Errorf("failed to read available balance: %w", balErr)
		}
		if availableBalance.GreaterThan(decimal.Zero) {
			debitAmount := lossBeyondReserved
			if debitAmount.GreaterThan(availableBalance) {
				debitAmount = availableBalance
			}
			if debitAmount.GreaterThan(decimal.Zero) {
				_, err = s.ledger.DebitAccount(ctx, tx, usdAvailable, debitAmount, types.LedgerEntryTypeTrade, "close_position_loss")
				if err != nil {
					return fmt.Errorf("failed to debit balance: %w", err)
				}
			}
		}
	}

	// 8. If it was a buy order, we also need to remove the base asset
	if order.Side == types.OrderSideBuy {
		baseAvailable, err := s.ledger.EnsureAccountForTradingAccount(ctx, tx, userID, accountID, pair.BaseAssetID, types.AccountKindAvailable)
		if err != nil {
			return fmt.Errorf("failed to get base account: %w", err)
		}
		// Debit the base asset (we're selling it)
		_, err = s.ledger.DebitAccount(ctx, tx, baseAvailable, qty, types.LedgerEntryTypeTrade, "close_position")
		if err != nil {
			return fmt.Errorf("failed to debit base asset: %w", err)
		}
	}

	// 9. Mark order as closed position.
	if err := s.store.UpdateOrderStatus(ctx, tx, orderID, types.OrderStatusClosed); err != nil {
		return fmt.Errorf("failed to update order status: %w", err)
	}

	// 10. Commit transaction
	return tx.Commit(ctx)
}

func (s *Service) GetRiskConfig(ctx context.Context) (RiskConfig, error) {
	cfg := defaultRiskConfig
	var (
		maxOpen      int
		maxLots      string
		maxNotional  string
		marginCall   string
		stopOut      string
		unlimitedLev int
	)
	err := s.pool.QueryRow(ctx, `
		SELECT max_open_positions, max_order_lots, max_order_notional_usd, margin_call_level_pct, stop_out_level_pct, unlimited_effective_leverage
		FROM trading_risk_config
		WHERE id = 1
	`).Scan(&maxOpen, &maxLots, &maxNotional, &marginCall, &stopOut, &unlimitedLev)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return cfg, nil
		}
		return cfg, err
	}

	if maxOpen > 0 {
		cfg.MaxOpenPositions = maxOpen
	}
	if unlimitedLev > 0 {
		cfg.UnlimitedEffectiveLeverage = decimal.NewFromInt(int64(unlimitedLev))
	}
	if v, ok := parseRiskDecimal(maxLots); ok {
		cfg.MaxOrderLots = v
	}
	if v, ok := parseRiskDecimal(maxNotional); ok {
		cfg.MaxOrderNotionalUSD = v
	}
	if v, ok := parseRiskDecimal(marginCall); ok {
		cfg.MarginCallLevelPercent = v
	}
	if v, ok := parseRiskDecimal(stopOut); ok {
		cfg.StopOutLevelPercent = v
	}
	return cfg, nil
}

func parseRiskDecimal(raw string) (decimal.Decimal, bool) {
	v, err := decimal.NewFromString(raw)
	if err != nil || !v.GreaterThan(decimal.Zero) {
		return decimal.Zero, false
	}
	return v, true
}

func resolveEffectiveLeverage(configured int, cfg RiskConfig) decimal.Decimal {
	if configured == 0 {
		if cfg.UnlimitedEffectiveLeverage.GreaterThan(decimal.Zero) {
			return cfg.UnlimitedEffectiveLeverage
		}
		return defaultRiskConfig.UnlimitedEffectiveLeverage
	}
	if configured > 0 {
		return decimal.NewFromInt(int64(configured))
	}
	return decimal.NewFromInt(100)
}

func applySpreadMultiplier(bid, ask, multiplier float64) (float64, float64) {
	if bid <= 0 || ask <= 0 {
		return bid, ask
	}
	if multiplier <= 0 {
		multiplier = 1.0
	}
	mid := (bid + ask) / 2.0
	spread := (ask - bid) * multiplier
	if spread < 0 {
		spread = 0
	}
	half := spread / 2.0
	return mid - half, mid + half
}

func effectivePriceForPair(symbol string, raw decimal.Decimal) (decimal.Decimal, bool) {
	return accountingPriceForPair(symbol, raw)
}

func calculateOrderPnL(symbol string, side types.OrderSide, entryRaw, markRaw, qty, contractSize decimal.Decimal) decimal.Decimal {
	if entryRaw.LessThanOrEqual(decimal.Zero) || markRaw.LessThanOrEqual(decimal.Zero) || qty.LessThanOrEqual(decimal.Zero) || contractSize.LessThanOrEqual(decimal.Zero) {
		return decimal.Zero
	}
	entry, ok := accountingPriceForPair(symbol, entryRaw)
	if !ok {
		return decimal.Zero
	}
	mark, ok := accountingPriceForPair(symbol, markRaw)
	if !ok {
		return decimal.Zero
	}
	positionSize := qty.Mul(contractSize)
	switch side {
	case types.OrderSideBuy:
		return mark.Sub(entry).Mul(positionSize)
	case types.OrderSideSell:
		return entry.Sub(mark).Mul(positionSize)
	default:
		return decimal.Zero
	}
}

func accountingPriceForPair(symbol string, raw decimal.Decimal) (decimal.Decimal, bool) {
	if raw.LessThanOrEqual(decimal.Zero) {
		return decimal.Zero, false
	}
	if marketdata.IsDisplayInverted(symbol) {
		return decimal.NewFromInt(1).Div(raw), true
	}
	return raw, true
}

func orderNotional(symbol string, priceRaw, qty, contractSize decimal.Decimal) decimal.Decimal {
	if !priceRaw.GreaterThan(decimal.Zero) || !qty.GreaterThan(decimal.Zero) || !contractSize.GreaterThan(decimal.Zero) {
		return decimal.Zero
	}
	accPrice, ok := accountingPriceForPair(symbol, priceRaw)
	if !ok {
		return decimal.Zero
	}
	return accPrice.Mul(qty).Mul(contractSize)
}

func deriveEntryRawFromSpent(symbol string, spent, qty, contractSize decimal.Decimal) (decimal.Decimal, bool) {
	if !spent.GreaterThan(decimal.Zero) || !qty.GreaterThan(decimal.Zero) || !contractSize.GreaterThan(decimal.Zero) {
		return decimal.Zero, false
	}
	accPrice := spent.Div(qty.Mul(contractSize))
	if !accPrice.GreaterThan(decimal.Zero) {
		return decimal.Zero, false
	}
	if marketdata.IsDisplayInverted(symbol) {
		return decimal.NewFromInt(1).Div(accPrice), true
	}
	return accPrice, true
}

func pairContractSize(pair marketdata.Pair) decimal.Decimal {
	size, err := decimal.NewFromString(pair.ContractSize)
	if err != nil || !size.GreaterThan(decimal.Zero) {
		return decimal.NewFromInt(1)
	}
	return size
}

func pairPnLContractSize(pair marketdata.Pair) decimal.Decimal {
	size, err := decimal.NewFromString(strings.TrimSpace(pair.PnLContractSize))
	if err == nil && size.GreaterThan(decimal.Zero) {
		return size
	}
	return pairContractSize(pair)
}

func pairMinLot(pair marketdata.Pair) decimal.Decimal {
	v, err := decimal.NewFromString(pair.MinLot)
	if err == nil && v.GreaterThan(decimal.Zero) {
		return v
	}
	v, err = decimal.NewFromString(pair.MinQty)
	if err == nil && v.GreaterThan(decimal.Zero) {
		return v
	}
	return decimal.NewFromFloat(0.01)
}

func assetUSDBid(symbol string, spreadMultiplier float64) (decimal.Decimal, bool) {
	if symbol == "USD" {
		return decimal.NewFromInt(1), true
	}

	pairSymbol := symbol + "-USD"
	switch symbol {
	case "XAU", "BTC", "EUR":
		pairSymbol = symbol + "USD"
	}

	bid, ask, err := marketdata.GetCurrentQuote(pairSymbol)
	if err != nil || bid <= 0 || ask <= 0 {
		return decimal.Zero, false
	}
	bid, ask = applySpreadMultiplier(bid, ask, spreadMultiplier)
	if bid <= 0 {
		return decimal.Zero, false
	}
	return decimal.NewFromFloat(bid), true
}
