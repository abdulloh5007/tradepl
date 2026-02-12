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
	accountLeverage := 100
	effectiveLeverage := decimal.NewFromInt(100)
	if s.accountSvc != nil {
		acc, accErr := s.accountSvc.Resolve(ctx, req.UserID, req.AccountID)
		if accErr != nil {
			return PlaceOrderResult{}, accErr
		}
		if acc != nil {
			accountLeverage = acc.Leverage
			if acc.Plan.SpreadMultiplier > 0 {
				spreadMultiplier = acc.Plan.SpreadMultiplier
			}
			if acc.Plan.CommissionRate > 0 {
				commissionRate = acc.Plan.CommissionRate
			}
			effectiveLeverage = resolveEffectiveLeverage(acc.Leverage, riskCfg)
		}
	}
	unlimitedLeverage := accountLeverage == 0

	currentMetrics, openPositions, metricsErr := s.computeAccountMetricsByAccount(ctx, req.UserID, req.AccountID)
	if metricsErr != nil {
		return PlaceOrderResult{}, fmt.Errorf("failed to evaluate margin risk: %w", metricsErr)
	}
	if unlimitedLeverage {
		switched, switchErr := s.autoDowngradeUnlimitedLeverage(ctx, req.UserID, req.AccountID, currentMetrics.Balance)
		if switchErr != nil {
			return PlaceOrderResult{}, fmt.Errorf("failed to apply leverage guardrail: %w", switchErr)
		}
		if switched {
			unlimitedLeverage = false
			accountLeverage = 2000
			effectiveLeverage = decimal.NewFromInt(2000)
			currentMetrics, openPositions, metricsErr = s.computeAccountMetricsByAccount(ctx, req.UserID, req.AccountID)
			if metricsErr != nil {
				return PlaceOrderResult{}, fmt.Errorf("failed to evaluate margin risk: %w", metricsErr)
			}
		}
	}
	if len(openPositions) >= riskCfg.MaxOpenPositions {
		return PlaceOrderResult{}, fmt.Errorf("max open positions reached (%d)", riskCfg.MaxOpenPositions)
	}
	if !unlimitedLeverage && currentMetrics.Margin.GreaterThan(decimal.Zero) {
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
	requiredMargin := decimal.Zero
	if !unlimitedLeverage && effectiveLeverage.GreaterThan(decimal.Zero) {
		requiredMargin = estimatedNotional
		requiredMargin = estimatedNotional.Div(effectiveLeverage)
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

	if req.Type == types.OrderTypeMarket {
		reservedAssetID = pair.QuoteAssetID
		reservedAmount = requiredMargin
		if commissionRate > 0 && estimatedNotional.GreaterThan(decimal.Zero) {
			openCommission := estimatedNotional.Mul(decimal.NewFromFloat(commissionRate))
			reservedAmount = reservedAmount.Add(openCommission)
		}
	} else if req.Side == types.OrderSideBuy {
		reservedAssetID = pair.QuoteAssetID
		// Limit Buy
		reservedAmount = orderNotional(pair.Symbol, *req.Price, *req.Qty, contractSize)
	} else {
		reservedAssetID = pair.BaseAssetID
		reservedAmount = *req.Qty
	}
	var availableAccount string
	var reservedAccount string
	if reservedAmount.GreaterThan(decimal.Zero) {
		availableAccount, err = s.ledger.EnsureAccountForTradingAccount(ctx, tx, req.UserID, req.AccountID, reservedAssetID, types.AccountKindAvailable)
		if err != nil {
			return PlaceOrderResult{}, err
		}
		reservedAccount, err = s.ledger.EnsureAccountForTradingAccount(ctx, tx, req.UserID, req.AccountID, reservedAssetID, types.AccountKindReserved)
		if err != nil {
			return PlaceOrderResult{}, err
		}
		balance, balErr := s.ledger.GetBalance(ctx, tx, availableAccount)
		if balErr != nil {
			return PlaceOrderResult{}, balErr
		}
		if balance.LessThan(reservedAmount) {
			return PlaceOrderResult{}, errors.New("insufficient free margin for this order size")
		}
		if _, err = s.ledger.Transfer(ctx, tx, availableAccount, reservedAccount, reservedAmount, types.LedgerEntryTypeReserve, req.ClientRef); err != nil {
			return PlaceOrderResult{}, err
		}
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

		// CFD-style margin position:
		// - keep required margin locked on reserved account,
		// - charge open commission immediately (if any),
		// - do not move base asset balances.
		openCommission := reservedAmount.Sub(requiredMargin)
		if openCommission.GreaterThan(decimal.Zero) {
			if _, err := s.ledger.DebitAccount(ctx, tx, reservedAccount, openCommission, types.LedgerEntryTypeTrade, "open_commission"); err != nil {
				return PlaceOrderResult{}, fmt.Errorf("failed to apply open commission: %w", err)
			}
		}

		// Update order to Filled
		order.Status = types.OrderStatusFilled
		order.SpentAmount = requiredMargin
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
	Balance      decimal.Decimal `json:"balance"`
	Equity       decimal.Decimal `json:"equity"`
	Margin       decimal.Decimal `json:"margin"`
	FreeMargin   decimal.Decimal `json:"free_margin"`
	MarginLevel  decimal.Decimal `json:"margin_level"`
	PnL          decimal.Decimal `json:"pl"`
	SystemNotice string          `json:"system_notice,omitempty"`
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

var unlimitedBalanceGuardrail = decimal.NewFromInt(1000)

const autoDowngradedLeverage = 2000

func (s *Service) GetAccountMetrics(ctx context.Context, userID string) (AccountMetrics, error) {
	// 1. Get all balances
	return s.GetAccountMetricsByAccount(ctx, userID, "")
}

func (s *Service) GetAccountMetricsByAccount(ctx context.Context, userID, accountID string) (AccountMetrics, error) {
	riskCfg, riskErr := s.GetRiskConfig(ctx)
	if riskErr != nil {
		return AccountMetrics{}, riskErr
	}
	leveragedAccount := 100
	if s.accountSvc != nil {
		acc, accErr := s.accountSvc.Resolve(ctx, userID, accountID)
		if accErr == nil && acc != nil {
			leveragedAccount = acc.Leverage
		}
	}

	metrics, positions, err := s.computeAccountMetricsByAccount(ctx, userID, accountID)
	if err != nil {
		return AccountMetrics{}, err
	}
	if leveragedAccount == 0 {
		switched, switchErr := s.autoDowngradeUnlimitedLeverage(ctx, userID, accountID, metrics.Balance)
		if switchErr != nil {
			return AccountMetrics{}, switchErr
		}
		if switched {
			refreshed, refreshedPositions, refreshErr := s.computeAccountMetricsByAccount(ctx, userID, accountID)
			if refreshErr != nil {
				return AccountMetrics{}, refreshErr
			}
			metrics = refreshed
			positions = refreshedPositions
			leveragedAccount = autoDowngradedLeverage
			metrics.SystemNotice = "System changed leverage to 1:2000 because balance exceeded 1000 USD."
		}
	}

	if leveragedAccount == 0 && metrics.Equity.LessThan(decimal.Zero) && len(positions) > 0 {
		liquidated, liqErr := s.autoLiquidateUnlimitedAccount(ctx, userID, accountID)
		if liqErr != nil {
			return AccountMetrics{}, liqErr
		}
		if liquidated {
			refreshed, _, refreshErr := s.computeAccountMetricsByAccount(ctx, userID, accountID)
			if refreshErr != nil {
				return AccountMetrics{}, refreshErr
			}
			metrics = refreshed
			metrics.SystemNotice = "System auto-closed all orders: equity dropped below 0 in unlimited mode. Balance reset to 0."
		}
	}

	if metrics.Margin.GreaterThan(decimal.Zero) && metrics.MarginLevel.LessThanOrEqual(riskCfg.StopOutLevelPercent) {
		changed, stopErr := s.applyStopOut(ctx, userID, accountID, positions, riskCfg)
		if stopErr == nil && changed {
			refreshed, _, refreshErr := s.computeAccountMetricsByAccount(ctx, userID, accountID)
			if refreshErr == nil {
				refreshed.SystemNotice = metrics.SystemNotice
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
	positions := make([]positionRisk, 0, 8)
	spreadMultiplier := 1.0
	unlimitedLeverage := false
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
			unlimitedLeverage = acc.Leverage == 0
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
		bidRaw := decimal.NewFromFloat(bid)
		askRaw := decimal.NewFromFloat(ask)
		markRaw := markRawForSide(pair.Symbol, o.Side, bidRaw, askRaw)

		entryForMargin, ok := effectivePriceForPair(pair.Symbol, entryRaw)
		if !ok {
			continue
		}

		notional := entryForMargin.Mul(filledQty).Mul(contractSize)
		if !unlimitedLeverage && leverage.GreaterThan(decimal.Zero) {
			positionMargin = positionMargin.Add(notional.Div(leverage))
		}
		orderPnL := calculateOrderPnL(pair.Symbol, o.Side, entryRaw, markRaw, filledQty, pairPnLContractSize(pair))
		floatingPnL = floatingPnL.Add(orderPnL)
		if o.Status == types.OrderStatusFilled {
			positions = append(positions, positionRisk{Order: o, PnL: orderPnL})
		}
	}

	brokerBalance := balance
	equity := brokerBalance.Add(floatingPnL)
	margin := pendingMargin
	if positionMargin.GreaterThan(margin) {
		margin = positionMargin
	}
	if unlimitedLeverage {
		margin = decimal.Zero
	}
	freeMargin := equity.Sub(margin)
	if unlimitedLeverage {
		freeMargin = equity
	}
	var marginLevel decimal.Decimal
	if !unlimitedLeverage && margin.GreaterThan(decimal.Zero) {
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

func (s *Service) autoDowngradeUnlimitedLeverage(ctx context.Context, userID, accountID string, balance decimal.Decimal) (bool, error) {
	if strings.TrimSpace(accountID) == "" {
		return false, nil
	}
	if !balance.GreaterThan(unlimitedBalanceGuardrail) {
		return false, nil
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE trading_accounts
		SET leverage = $1, updated_at = NOW()
		WHERE id = $2 AND user_id = $3 AND leverage = 0
	`, autoDowngradedLeverage, accountID, userID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Service) autoLiquidateUnlimitedAccount(ctx context.Context, userID, accountID string) (bool, error) {
	if strings.TrimSpace(accountID) == "" {
		return false, nil
	}
	res, err := s.CloseOrdersByScope(ctx, userID, accountID, "all")
	if err != nil {
		return false, err
	}
	if res.Closed == 0 {
		return false, nil
	}
	if err := s.resetAccountUSDBalance(ctx, userID, accountID); err != nil {
		return true, err
	}
	return true, nil
}

func (s *Service) resetAccountUSDBalance(ctx context.Context, userID, accountID string) error {
	usd, err := s.market.GetAssetBySymbol(ctx, "USD")
	if err != nil {
		return err
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	availableID, err := s.ledger.EnsureAccountForTradingAccount(ctx, tx, userID, accountID, usd.ID, types.AccountKindAvailable)
	if err != nil {
		return err
	}
	reservedID, err := s.ledger.EnsureAccountForTradingAccount(ctx, tx, userID, accountID, usd.ID, types.AccountKindReserved)
	if err != nil {
		return err
	}

	availableBalance, err := s.ledger.GetBalance(ctx, tx, availableID)
	if err != nil {
		return err
	}
	if availableBalance.GreaterThan(decimal.Zero) {
		if _, err := s.ledger.DebitAccount(ctx, tx, availableID, availableBalance, types.LedgerEntryTypeTrade, "system_unlimited_balance_reset"); err != nil {
			return err
		}
	} else if availableBalance.LessThan(decimal.Zero) {
		if _, err := s.ledger.CreditAccount(ctx, tx, availableID, availableBalance.Abs(), types.LedgerEntryTypeTrade, "system_unlimited_balance_reset"); err != nil {
			return err
		}
	}

	reservedBalance, err := s.ledger.GetBalance(ctx, tx, reservedID)
	if err != nil {
		return err
	}
	if reservedBalance.GreaterThan(decimal.Zero) {
		if _, err := s.ledger.DebitAccount(ctx, tx, reservedID, reservedBalance, types.LedgerEntryTypeTrade, "system_unlimited_balance_reset"); err != nil {
			return err
		}
	} else if reservedBalance.LessThan(decimal.Zero) {
		if _, err := s.ledger.CreditAccount(ctx, tx, reservedID, reservedBalance.Abs(), types.LedgerEntryTypeTrade, "system_unlimited_balance_reset"); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
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
	resolvePair := func(pairID string) (marketdata.Pair, bool) {
		if pair, ok := pairCache[pairID]; ok {
			return pair, true
		}
		pair, err := s.market.GetPairByID(ctx, pairID)
		if err != nil {
			return marketdata.Pair{}, false
		}
		pairCache[pairID] = pair
		return pair, true
	}

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

		pair, hasPair := resolvePair(o.PairID)
		if hasPair && pair.Symbol != "" {
			o.Symbol = pair.Symbol
		}

		// Broker Logic: Calculate entry price only if DB entry is missing.
		filledQty := o.Qty.Sub(o.RemainingQty)
		if hasPair && pair.Symbol != "" && (o.Price == nil || o.Price.LessThanOrEqual(decimal.Zero)) && filledQty.GreaterThan(decimal.Zero) && o.SpentAmount.GreaterThan(decimal.Zero) {
			avgRaw, ok := deriveEntryRawFromSpent(pair.Symbol, o.SpentAmount, filledQty, pairContractSize(pair))
			if ok {
				o.Price = &avgRaw
			}
		}

		if hasPair && pair.Symbol != "" && filledQty.GreaterThan(decimal.Zero) && o.Price != nil && o.Price.GreaterThan(decimal.Zero) && (o.Side == types.OrderSideBuy || o.Side == types.OrderSideSell) {
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
				mark := markRawForSide(pair.Symbol, o.Side, qm.bid, qm.ask)
				pnl := calculateOrderPnL(pair.Symbol, o.Side, *o.Price, mark, filledQty, pairPnLContractSize(pair))
				o.UnrealizedPnL = &pnl
			}
		}

		orders = append(orders, o)
	}
	return orders, nil
}

func (s *Service) ListOrderHistoryByAccount(ctx context.Context, userID, accountID, accountMode string, before *time.Time, limit int) ([]model.Order, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	// Fetch extra records from each source to keep mixed timeline pagination stable.
	fetchLimit := limit * 2
	if fetchLimit < limit {
		fetchLimit = limit
	}
	if fetchLimit > 400 {
		fetchLimit = 400
	}

	orderQuery := `
		SELECT id,
		       coalesce(ticket_no, 0),
		       user_id,
		       trading_account_id,
		       pair_id,
		       side,
		       type,
		       status,
		       price,
		       qty,
		       remaining_qty,
		       quote_amount,
		       remaining_quote,
		       reserved_amount,
		       spent_amount,
		       time_in_force,
		       created_at,
		       close_price,
		       coalesce(close_time, updated_at, created_at) as close_time,
		       coalesce(realized_pnl, 0),
		       coalesce(realized_commission, 0),
		       coalesce(realized_swap, 0)
		FROM orders
		WHERE user_id = $1
		  AND ($2 = '' OR coalesce(trading_account_id::text, '') = $2)
		  AND ($3::timestamptz IS NULL OR coalesce(close_time, updated_at, created_at) < $3)
		  AND status IN ('closed', 'canceled')
		ORDER BY coalesce(close_time, updated_at, created_at) DESC, created_at DESC
		LIMIT $4
	`
	rows, err := s.pool.Query(ctx, orderQuery, userID, accountID, before, fetchLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	pairCache := make(map[string]marketdata.Pair, 4)
	resolvePair := func(pairID string) (marketdata.Pair, bool) {
		if pair, ok := pairCache[pairID]; ok {
			return pair, true
		}
		pair, err := s.market.GetPairByID(ctx, pairID)
		if err != nil {
			return marketdata.Pair{}, false
		}
		pairCache[pairID] = pair
		return pair, true
	}

	var orders []model.Order
	for rows.Next() {
		var o model.Order
		var closeTime time.Time
		var realizedPnL decimal.Decimal
		var realizedCommission decimal.Decimal
		var realizedSwap decimal.Decimal
		err := rows.Scan(
			&o.ID, &o.TicketNo, &o.UserID, &o.TradingAccountID, &o.PairID, &o.Side, &o.Type, &o.Status,
			&o.Price, &o.Qty, &o.RemainingQty, &o.QuoteAmount, &o.RemainingQuote,
			&o.ReservedAmount, &o.SpentAmount, &o.TimeInForce, &o.CreatedAt,
			&o.ClosePrice, &closeTime, &realizedPnL, &realizedCommission, &realizedSwap,
		)
		if err != nil {
			return nil, err
		}
		o.CloseTime = &closeTime
		o.Profit = &realizedPnL
		o.Commission = &realizedCommission
		o.Swap = &realizedSwap
		o.Ticket = formatOrderTicket(accountMode, o.TicketNo, o.ID)

		pair, hasPair := resolvePair(o.PairID)
		if hasPair && pair.Symbol != "" {
			o.Symbol = pair.Symbol
		}

		filledQty := o.Qty.Sub(o.RemainingQty)
		if hasPair && pair.Symbol != "" && (o.Price == nil || o.Price.LessThanOrEqual(decimal.Zero)) && filledQty.GreaterThan(decimal.Zero) && o.SpentAmount.GreaterThan(decimal.Zero) {
			avgRaw, ok := deriveEntryRawFromSpent(pair.Symbol, o.SpentAmount, filledQty, pairContractSize(pair))
			if ok {
				o.Price = &avgRaw
			}
		}
		if o.ClosePrice == nil && o.Price != nil {
			o.ClosePrice = o.Price
		}
		if o.Profit != nil && o.Commission != nil && o.Commission.IsZero() && hasPair && pair.Symbol != "" && o.Price != nil && o.ClosePrice != nil && filledQty.GreaterThan(decimal.Zero) {
			derivedPnL := calculateOrderPnL(pair.Symbol, o.Side, *o.Price, *o.ClosePrice, filledQty, pairPnLContractSize(pair))
			o.Profit = &derivedPnL
		}

		orders = append(orders, o)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	cashFlowQuery := `
		SELECT le.id,
		       le.sequence,
		       le.entry_type,
		       le.amount,
		       le.created_at
		FROM ledger_entries le
		JOIN accounts a ON a.id = le.account_id
		WHERE a.owner_type = 'user'
		  AND a.owner_user_id = $1
		  AND ($2 = '' OR coalesce(a.trading_account_id::text, '') = $2)
		  AND ($3::timestamptz IS NULL OR le.created_at < $3)
		  AND le.entry_type IN ('deposit', 'withdraw', 'faucet')
		ORDER BY le.created_at DESC, le.sequence DESC
		LIMIT $4
	`
	cashRows, err := s.pool.Query(ctx, cashFlowQuery, userID, accountID, before, fetchLimit)
	if err != nil {
		return nil, err
	}
	defer cashRows.Close()

	for cashRows.Next() {
		var entryID string
		var sequence int64
		var entryType string
		var amount decimal.Decimal
		var createdAt time.Time
		if err := cashRows.Scan(&entryID, &sequence, &entryType, &amount, &createdAt); err != nil {
			return nil, err
		}

		side := types.OrderSide("deposit")
		if amount.IsNegative() || entryType == string(types.LedgerEntryTypeWithdraw) {
			side = types.OrderSide("withdraw")
		}
		qty := amount.Abs()
		profit := amount
		commission := decimal.Zero
		swap := decimal.Zero

		eventType := strings.ToLower(strings.TrimSpace(entryType))
		if eventType == string(types.LedgerEntryTypeFaucet) {
			eventType = string(types.LedgerEntryTypeDeposit)
		}

		closeTime := createdAt
		orders = append(orders, model.Order{
			ID:               entryID,
			Ticket:           formatLedgerTicket(accountMode, eventType, sequence, entryID),
			UserID:           userID,
			TradingAccountID: accountID,
			PairID:           "USD-USD",
			Symbol:           "USD-USD",
			Side:             side,
			Type:             types.OrderType("balance"),
			Status:           types.OrderStatusClosed,
			Qty:              qty,
			RemainingQty:     decimal.Zero,
			ReservedAmount:   decimal.Zero,
			SpentAmount:      decimal.Zero,
			Profit:           &profit,
			Commission:       &commission,
			Swap:             &swap,
			CloseTime:        &closeTime,
			CreatedAt:        createdAt,
		})
	}
	if err := cashRows.Err(); err != nil {
		return nil, err
	}

	sort.SliceStable(orders, func(i, j int) bool {
		li := historyEventTime(orders[i])
		rj := historyEventTime(orders[j])
		if li.Equal(rj) {
			if orders[i].CreatedAt.Equal(orders[j].CreatedAt) {
				return orders[i].ID > orders[j].ID
			}
			return orders[i].CreatedAt.After(orders[j].CreatedAt)
		}
		return li.After(rj)
	})

	if len(orders) > limit {
		orders = orders[:limit]
	}
	return orders, nil
}

func historyEventTime(o model.Order) time.Time {
	if o.CloseTime != nil && !o.CloseTime.IsZero() {
		return o.CloseTime.UTC()
	}
	return o.CreatedAt.UTC()
}

func modeTicketPrefix(mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), "demo") {
		return "d-"
	}
	return ""
}

func normalizeTicketNumber(value int64, seed string) string {
	v := value
	if v < 0 {
		v = -v
	}
	if v <= 0 {
		v = int64(ticketSeedNumber(seed))
	}
	v = v % 10000000
	if v <= 0 {
		v = int64(ticketSeedNumber(seed))
		v = v % 10000000
	}
	if v < 1000000 {
		v += 1000000
	}
	return fmt.Sprintf("%07d", v)
}

func ticketSeedNumber(seed string) int {
	h := 0
	for _, ch := range seed {
		h = (h*33 + int(ch)) % 9000000
	}
	if h < 1000000 {
		h += 1000000
	}
	return h
}

func ticketSeedLetters(seed string) string {
	h := 0
	for _, ch := range seed {
		h = (h*131 + int(ch)) % (26 * 26)
	}
	first := byte('a' + ((h / 26) % 26))
	second := byte('a' + (h % 26))
	return string([]byte{first, second})
}

func formatOrderTicket(accountMode string, ticketNo int64, seed string) string {
	digits := normalizeTicketNumber(ticketNo, seed)
	letters := ticketSeedLetters(fmt.Sprintf("ord:%d:%s", ticketNo, seed))
	return modeTicketPrefix(accountMode) + "BX-" + digits + letters
}

func formatLedgerTicket(accountMode, eventType string, sequence int64, seed string) string {
	digits := normalizeTicketNumber(sequence, seed)
	letters := ticketSeedLetters(fmt.Sprintf("cash:%s:%d:%s", eventType, sequence, seed))
	base := "BXdep"
	if strings.EqualFold(strings.TrimSpace(eventType), string(types.LedgerEntryTypeWithdraw)) {
		base = "BXwit"
	}
	return modeTicketPrefix(accountMode) + base + digits + letters
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

	bidRaw := decimal.NewFromFloat(bid)
	askRaw := decimal.NewFromFloat(ask)
	exitPrice = markRawForSide(pair.Symbol, order.Side, bidRaw, askRaw)
	pnl = calculateOrderPnL(pair.Symbol, order.Side, entryPrice, exitPrice, qty, pairPnLContractSize(pair))

	// 7. Update user's USD balance
	// Get the user's available/reserved USD accounts.
	usdAvailable, err := s.ledger.EnsureAccountForTradingAccount(ctx, tx, userID, accountID, pair.QuoteAssetID, types.AccountKindAvailable)
	if err != nil {
		return fmt.Errorf("failed to get USD account: %w", err)
	}
	usdReserved, err := s.ledger.EnsureAccountForTradingAccount(ctx, tx, userID, accountID, pair.QuoteAssetID, types.AccountKindReserved)
	if err != nil {
		return fmt.Errorf("failed to get USD reserved account: %w", err)
	}

	// Release locked margin first.
	releasedMargin := decimal.Zero
	if order.SpentAmount.GreaterThan(decimal.Zero) {
		reservedBalance, balErr := s.ledger.GetBalance(ctx, tx, usdReserved)
		if balErr != nil {
			return fmt.Errorf("failed to read reserved balance: %w", balErr)
		}
		releaseAmount := order.SpentAmount
		if releaseAmount.GreaterThan(reservedBalance) {
			releaseAmount = reservedBalance
		}
		if releaseAmount.GreaterThan(decimal.Zero) {
			if _, err = s.ledger.Transfer(ctx, tx, usdReserved, usdAvailable, releaseAmount, types.LedgerEntryTypeRelease, "release_margin_close"); err != nil {
				return fmt.Errorf("failed to release margin: %w", err)
			}
			releasedMargin = releaseAmount
		}
	}
	// Backward compatibility for legacy positions opened before margin-lock logic.
	if releasedMargin.LessThan(order.SpentAmount) {
		shortfall := order.SpentAmount.Sub(releasedMargin)
		if shortfall.GreaterThan(decimal.Zero) {
			if _, err = s.ledger.CreditAccount(ctx, tx, usdAvailable, shortfall, types.LedgerEntryTypeTrade, "legacy_margin_return"); err != nil {
				return fmt.Errorf("failed to return legacy margin: %w", err)
			}
		}
	}

	closeCommission := decimal.Zero
	if commissionRate > 0 {
		closeNotional := orderNotional(pair.Symbol, exitPrice, qty, contractSize)
		if closeNotional.GreaterThan(decimal.Zero) {
			closeCommission = closeNotional.Mul(decimal.NewFromFloat(commissionRate))
		}
	}
	openCommission := order.ReservedAmount.Sub(order.SpentAmount)
	if openCommission.LessThan(decimal.Zero) {
		openCommission = decimal.Zero
	}

	netPnL := pnl.Sub(closeCommission)
	realizedPnL := decimal.Zero
	if netPnL.GreaterThan(decimal.Zero) {
		_, err = s.ledger.CreditAccount(ctx, tx, usdAvailable, netPnL, types.LedgerEntryTypeTrade, "close_position_pnl")
		if err != nil {
			return fmt.Errorf("failed to credit pnl: %w", err)
		}
		realizedPnL = netPnL
	} else {
		// Negative balance protection: never debit beyond available balance.
		lossAmount := netPnL.Abs()
		availableBalance, balErr := s.ledger.GetBalance(ctx, tx, usdAvailable)
		if balErr != nil {
			return fmt.Errorf("failed to read available balance: %w", balErr)
		}
		if availableBalance.GreaterThan(decimal.Zero) {
			debitAmount := lossAmount
			if debitAmount.GreaterThan(availableBalance) {
				debitAmount = availableBalance
			}
			if debitAmount.GreaterThan(decimal.Zero) {
				_, err = s.ledger.DebitAccount(ctx, tx, usdAvailable, debitAmount, types.LedgerEntryTypeTrade, "close_position_loss")
				if err != nil {
					return fmt.Errorf("failed to debit balance: %w", err)
				}
				realizedPnL = debitAmount.Neg()
			}
		}
	}

	// 8. Mark order as closed position with a persisted close snapshot for history/details.
	closeTime := time.Now().UTC()
	realizedCommission := closeCommission.Add(openCommission)
	if err := s.store.CloseOrderWithSnapshot(
		ctx,
		tx,
		orderID,
		types.OrderStatusClosed,
		exitPrice,
		closeTime,
		realizedPnL,
		realizedCommission,
		decimal.Zero,
	); err != nil {
		return fmt.Errorf("failed to update order status: %w", err)
	}

	// 9. Commit transaction
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

func resolveEffectiveLeverage(configured int, _ RiskConfig) decimal.Decimal {
	if configured == 0 {
		return decimal.Zero
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

func markRawForSide(symbol string, side types.OrderSide, bidRaw, askRaw decimal.Decimal) decimal.Decimal {
	inverted := marketdata.IsDisplayInverted(symbol)
	switch side {
	case types.OrderSideBuy:
		if inverted {
			return askRaw
		}
		return bidRaw
	case types.OrderSideSell:
		if inverted {
			return bidRaw
		}
		return askRaw
	default:
		return bidRaw
	}
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
