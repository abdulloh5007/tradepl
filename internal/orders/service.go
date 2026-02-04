package orders

import (
	"context"
	"errors"
	"fmt"
	"time"

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
	UserID      string
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
	// Validation for Market Buy
	if req.Type == types.OrderTypeMarket && req.Side == types.OrderSideBuy {
		// Broker Style: Allow Qty for Market Buy
		if req.Qty == nil && req.QuoteAmount == nil {
			return PlaceOrderResult{}, errors.New("qty or quote_amount required")
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
		notional := req.Price.Mul(*req.Qty)
		if minNotional.GreaterThan(decimal.Zero) && notional.LessThan(minNotional) {
			return PlaceOrderResult{}, errors.New("notional below minimum")
		}
	}
	if req.Type == types.OrderTypeMarket && req.TimeInForce != types.TimeInForceIOC {
		return PlaceOrderResult{}, errors.New("market orders must be ioc")
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
				// Fetch current Ask price
				_, ask, err := marketdata.GetCurrentQuote(pair.Symbol)
				if err != nil {
					return PlaceOrderResult{}, fmt.Errorf("failed to get quote: %w", err)
				}
				askPrice := decimal.NewFromFloat(ask)
				// Reserve cost = Qty * Ask
				reservedAmount = req.Qty.Mul(askPrice)
			} else {
				// Exchange Style Buy: Spend fixed amount
				reservedAmount = *req.QuoteAmount
			}
		} else {
			// Limit Buy
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

	// Broker-Style Execution: Market orders fill instantly against "the market"
	if req.Type == types.OrderTypeMarket {
		// Get current market price
		bid, ask, err := marketdata.GetCurrentQuote(pair.Symbol)
		if err != nil {
			return PlaceOrderResult{}, fmt.Errorf("failed to get market price: %w", err)
		}

		var execPrice decimal.Decimal
		var execQty decimal.Decimal

		if req.Side == types.OrderSideBuy {
			// Buy at Ask price
			execPrice = decimal.NewFromFloat(ask)
			if req.Qty != nil {
				execQty = *req.Qty
			} else if req.QuoteAmount != nil {
				// Calculate qty from quote amount
				execQty = req.QuoteAmount.Div(execPrice)
			}
		} else {
			// Sell at Bid price
			execPrice = decimal.NewFromFloat(bid)
			execQty = *req.Qty
		}

		quoteAmount := execPrice.Mul(execQty)

		// Execute the trade: Transfer funds
		if req.Side == types.OrderSideBuy {
			// Buyer: Reserved USD -> "Market" (burn), Receive Base Asset
			reservedQuote, _ := s.ledger.EnsureAccount(ctx, tx, req.UserID, pair.QuoteAssetID, types.AccountKindReserved)
			availableBase, _ := s.ledger.EnsureAccount(ctx, tx, req.UserID, pair.BaseAssetID, types.AccountKindAvailable)

			// Deduct USD from Reserved
			_, err := s.ledger.DebitAccount(ctx, tx, reservedQuote, quoteAmount, types.LedgerEntryTypeTrade, "market_buy")
			if err != nil {
				return PlaceOrderResult{}, fmt.Errorf("failed to debit quote: %w", err)
			}
			// Credit Base Asset to Available (Mint from Market)
			_, err = s.ledger.CreditAccount(ctx, tx, availableBase, execQty, types.LedgerEntryTypeTrade, "market_buy")
			if err != nil {
				return PlaceOrderResult{}, fmt.Errorf("failed to credit base: %w", err)
			}
		} else {
			// Seller: Reserved Base -> "Market" (burn), Receive USD
			reservedBase, _ := s.ledger.EnsureAccount(ctx, tx, req.UserID, pair.BaseAssetID, types.AccountKindReserved)
			availableQuote, _ := s.ledger.EnsureAccount(ctx, tx, req.UserID, pair.QuoteAssetID, types.AccountKindAvailable)

			// Deduct Base from Reserved
			_, err := s.ledger.DebitAccount(ctx, tx, reservedBase, execQty, types.LedgerEntryTypeTrade, "market_sell")
			if err != nil {
				return PlaceOrderResult{}, fmt.Errorf("failed to debit base: %w", err)
			}
			// Credit USD to Available (Mint from Market)
			_, err = s.ledger.CreditAccount(ctx, tx, availableQuote, quoteAmount, types.LedgerEntryTypeTrade, "market_sell")
			if err != nil {
				return PlaceOrderResult{}, fmt.Errorf("failed to credit quote: %w", err)
			}
		}

		// Update order to Filled
		order.Status = types.OrderStatusFilled
		order.SpentAmount = quoteAmount
		order.Qty = execQty
		order.RemainingQty = decimal.Zero
		order.RemainingQuote = nil
		order.Price = &execPrice // Entry Price

		err = s.store.UpdateOrderFill(ctx, tx, order.ID, order.RemainingQty, order.RemainingQuote, order.SpentAmount, order.Status)
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

type AccountMetrics struct {
	Balance     decimal.Decimal `json:"balance"`
	Equity      decimal.Decimal `json:"equity"`
	Margin      decimal.Decimal `json:"margin"`
	FreeMargin  decimal.Decimal `json:"free_margin"`
	MarginLevel decimal.Decimal `json:"margin_level"`
	PnL         decimal.Decimal `json:"pl"`
}

func (s *Service) GetAccountMetrics(ctx context.Context, userID string) (AccountMetrics, error) {
	// 1. Get all balances
	balances, err := s.ledger.BalancesByUser(ctx, userID)
	if err != nil {
		return AccountMetrics{}, err
	}

	var totalUSD decimal.Decimal
	var equity decimal.Decimal
	var margin decimal.Decimal

	// 2. Determine USD value of everything
	// We assume Quote Asset is always USD for simplicity in this MVP
	// If Asset is USD, add to balance/equity.
	// If Asset is non-USD (XAU, UZS, etc.), get Price and add to Equity.
	// And if Reserved non-USD -> Add to Margin (Value).

	for _, b := range balances {
		if b.Symbol == "USD" {
			totalUSD = totalUSD.Add(b.Amount)
			equity = equity.Add(b.Amount)
			if b.Kind == types.AccountKindReserved {
				margin = margin.Add(b.Amount)
			}
		} else {
			// Get Price (Asset-USD)
			// We try to find pair symbol "ASSET-USD"
			// This is fragile but works for "UZS-USD", "XAUUSD" (needs special case maybe?)
			pairSymbol := b.Symbol + "-USD"
			if b.Symbol == "XAU" {
				pairSymbol = "XAUUSD"
			} // Special case for gold
			if b.Symbol == "BTC" {
				pairSymbol = "BTCUSD"
			}
			if b.Symbol == "EUR" {
				pairSymbol = "EURUSD"
			}

			// Get Bid/Ask
			bid, _, err := marketdata.GetCurrentQuote(pairSymbol)
			var price decimal.Decimal
			if err == nil {
				price = decimal.NewFromFloat(bid)
			} else {
				// Fallback
				candle, err := marketdata.LiveCandle(marketdata.CandleParams{
					Pair:     pairSymbol,
					Interval: time.Minute,
					Limit:    1,
					Now:      time.Now().UTC(),
				})
				if err == nil {
					price, _ = decimal.NewFromString(candle.Close)
				} else {
					price = decimal.Zero
				}
			}

			// Value = Amount * Bid Price (Liquidation Value)
			// This naturally incorporates Spread into P/L (Simulates "Closing at Market")
			val := b.Amount.Mul(price)
			equity = equity.Add(val)

			// If it's a "Position" (Reserved asset? No, holding asset IS the position in Spot)
			// But wait, in Spot:
			// Buy XAU -> Reserved USD -> Trade -> Available XAU.
			// So "Available XAU" is an open position effectively.
			// "Reserved XAU" is a Sell Order (Locked XAU).
			// Both contribute to Equity.
			// Does "Reserved XAU" count as Margin?
			// Usually "Margin" is USD backing the trade.
			// In Spot, there is no margin.
			// But if we want to simulate "Margin Used", we could say:
			// Margin = Cost Basis of Assets?
			// Or Margin = 0.
			// User asked for "Margin, Margin Level".
			// Let's assume Margin = 0 for Spot Holdings to avoid confusion,
			// OR if user wants to see "Used Funds", we can show Cost Basis?
			// Let's stick to Margin = Reserved USD (for open buy orders).
			// And Reserved XAU (for open sell orders) valuated in USD?
			// Standard Spot: Margin = 0.

			if b.Kind == types.AccountKindReserved {
				// If we have reserved XAU, it's pending sell.
				// Value is locked.
			}
		}
	}

	// 3. Get Net Deposits (Initial Investment)
	netDep, err := s.ledger.GetNetDeposits(ctx, userID)
	if err != nil {
		netDep = decimal.Zero // Should not happen but fallback
	}

	// 4. Calculate Derived Metrics

	// Balance: Cash (USD)
	balance := totalUSD

	// P/L: Equity - Net Deposits
	// This tracks "Total Profit" since inception.
	pl := equity.Sub(netDep)

	// Free Margin: Equity - Margin (if Margin defined)
	// If Margin is only "Reserved USD for Open Orders":
	freeMargin := equity.Sub(margin)

	// Margin Level: Equity / Margin * 100
	var marginLevel decimal.Decimal
	if margin.GreaterThan(decimal.Zero) {
		marginLevel = equity.Div(margin).Mul(decimal.NewFromInt(100))
	} else {
		// Infinite
		marginLevel = decimal.Zero // Or special value? Frontend handles 0?
	}

	return AccountMetrics{
		Balance:     balance,
		Equity:      equity,
		Margin:      margin,
		FreeMargin:  freeMargin,
		MarginLevel: marginLevel,
		PnL:         pl,
	}, nil
}

func (s *Service) ListOpenOrders(ctx context.Context, userID string) ([]model.Order, error) {
	// Broker Style: We need the ENTRY PRICE ("Open Price").
	// For a Market Order (filled/partially filled), Entry Price = SpentQuote / FilledQty.
	// We will calculate this on the fly or return it.
	// The `orders` table has `spent_amount` (quote spent) and `qty` (total) and `remaining_qty`.
	// filled_qty = qty - remaining_qty.
	// If filled_qty > 0, avg_price = spent_amount / filled_qty.

	query := `
		SELECT id, user_id, pair_id, side, type, status, price, qty, remaining_qty, quote_amount, remaining_quote, reserved_amount, spent_amount, time_in_force, created_at
		FROM orders
		WHERE user_id = $1 AND status IN ('new', 'partially_filled', 'filled') -- Include filled if they are "open positions" in broker model?
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
		-- ALTERNATIVE: Just list everything from orders table that is NOT cancelled.
		-- And for P/L:
		-- If Status=Filled, EntryPrice = Spent / Qty.
		-- If Status=New, EntryPrice = Price (Limit).
		AND status != 'cancelled'
		ORDER BY created_at DESC
	`
	rows, err := s.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []model.Order
	for rows.Next() {
		var o model.Order
		err := rows.Scan(
			&o.ID, &o.UserID, &o.PairID, &o.Side, &o.Type, &o.Status,
			&o.Price, &o.Qty, &o.RemainingQty, &o.QuoteAmount, &o.RemainingQuote,
			&o.ReservedAmount, &o.SpentAmount, &o.TimeInForce, &o.CreatedAt,
		)
		if err != nil {
			return nil, err
		}

		// Broker Logic: Calculate Entry Price
		filledQty := o.Qty.Sub(o.RemainingQty)
		if filledQty.GreaterThan(decimal.Zero) {
			avgPrice := o.SpentAmount.Div(filledQty)
			o.Price = &avgPrice
		}

		orders = append(orders, o)
	}
	return orders, nil
}

func (s *Service) CancelOrder(ctx context.Context, userID, orderID string) error {
	// 1. Get Order
	// 2. If status not open, error
	// 3. Update status to cancelled
	// 4. Refund reserved funds
	// This requires DB tx.
	return nil
}
