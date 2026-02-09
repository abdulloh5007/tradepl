package types

type OrderSide string

type OrderType string

type OrderStatus string

type TimeInForce string

type AccountKind string

type LedgerEntryType string

type TransferType string

const (
	OrderSideBuy  OrderSide = "buy"
	OrderSideSell OrderSide = "sell"
)

const (
	OrderTypeLimit  OrderType = "limit"
	OrderTypeMarket OrderType = "market"
)

const (
	OrderStatusOpen            OrderStatus = "open"
	OrderStatusPartiallyFilled OrderStatus = "partially_filled"
	OrderStatusFilled          OrderStatus = "filled"
	OrderStatusCanceled        OrderStatus = "canceled"
	OrderStatusClosed          OrderStatus = "closed"
	OrderStatusRejected        OrderStatus = "rejected"
)

const (
	TimeInForceGTC TimeInForce = "gtc"
	TimeInForceIOC TimeInForce = "ioc"
	TimeInForceFOK TimeInForce = "fok"
)

const (
	AccountKindAvailable AccountKind = "available"
	AccountKindReserved  AccountKind = "reserved"
)

const (
	LedgerEntryTypeDeposit  LedgerEntryType = "deposit"
	LedgerEntryTypeWithdraw LedgerEntryType = "withdraw"
	LedgerEntryTypeTrade    LedgerEntryType = "trade"
	LedgerEntryTypeReserve  LedgerEntryType = "reserve"
	LedgerEntryTypeRelease  LedgerEntryType = "release"
	LedgerEntryTypeFaucet   LedgerEntryType = "faucet"
)

const (
	TransferTypeDebit  TransferType = "debit"
	TransferTypeCredit TransferType = "credit"
)
