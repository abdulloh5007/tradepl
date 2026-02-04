package broker

import "context"

type OrderRequest struct {
	ClientOrderID string
	Symbol        string
	Side          string
	Type          string
	Price         string
	Qty           string
}

type OrderResponse struct {
	BrokerOrderID string
	Status        string
}

type Adapter interface {
	PlaceOrder(ctx context.Context, req OrderRequest) (OrderResponse, error)
	CancelOrder(ctx context.Context, brokerOrderID string) error
}
