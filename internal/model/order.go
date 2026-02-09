package model

import (
	"time"

	"lv-tradepl/internal/types"

	"github.com/shopspring/decimal"
)

type Order struct {
	ID               string            `json:"id"`
	UserID           string            `json:"user_id"`
	TradingAccountID string            `json:"trading_account_id"`
	PairID           string            `json:"pair_id"`
	Side             types.OrderSide   `json:"side"`
	Type             types.OrderType   `json:"type"`
	Status           types.OrderStatus `json:"status"`
	Price            *decimal.Decimal  `json:"price"`
	Qty              decimal.Decimal   `json:"qty"`
	RemainingQty     decimal.Decimal   `json:"remaining_qty"`
	QuoteAmount      *decimal.Decimal  `json:"quote_amount"`
	RemainingQuote   *decimal.Decimal  `json:"remaining_quote"`
	ReservedAmount   decimal.Decimal   `json:"reserved_amount"`
	SpentAmount      decimal.Decimal   `json:"spent_amount"`
	TimeInForce      types.TimeInForce `json:"time_in_force"`
	CreatedAt        time.Time         `json:"created_at"`
}
