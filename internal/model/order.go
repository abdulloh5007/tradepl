package model

import (
	"time"

	"github.com/shopspring/decimal"
	"lv-tradepl/internal/types"
)

type Order struct {
	ID             string
	UserID         string
	PairID         string
	Side           types.OrderSide
	Type           types.OrderType
	Status         types.OrderStatus
	Price          *decimal.Decimal
	Qty            decimal.Decimal
	RemainingQty   decimal.Decimal
	QuoteAmount    *decimal.Decimal
	RemainingQuote *decimal.Decimal
	ReservedAmount decimal.Decimal
	SpentAmount    decimal.Decimal
	TimeInForce    types.TimeInForce
	CreatedAt      time.Time
}
