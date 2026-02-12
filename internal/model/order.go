package model

import (
	"time"

	"lv-tradepl/internal/types"

	"github.com/shopspring/decimal"
)

type Order struct {
	ID               string            `json:"id"`
	Ticket           string            `json:"ticket,omitempty"`
	TicketNo         int64             `json:"ticket_no,omitempty"`
	UserID           string            `json:"user_id"`
	TradingAccountID string            `json:"trading_account_id"`
	PairID           string            `json:"pair_id"`
	Symbol           string            `json:"symbol,omitempty"`
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
	UnrealizedPnL    *decimal.Decimal  `json:"unrealized_pnl,omitempty"`
	Profit           *decimal.Decimal  `json:"profit,omitempty"`
	Commission       *decimal.Decimal  `json:"commission,omitempty"`
	Swap             *decimal.Decimal  `json:"swap,omitempty"`
	ClosePrice       *decimal.Decimal  `json:"close_price,omitempty"`
	CloseTime        *time.Time        `json:"close_time,omitempty"`
	TimeInForce      types.TimeInForce `json:"time_in_force"`
	CreatedAt        time.Time         `json:"created_at"`
}
