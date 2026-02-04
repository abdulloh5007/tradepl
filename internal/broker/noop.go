package broker

import (
	"context"
	"errors"
)

type DisabledAdapter struct{}

func NewDisabledAdapter() *DisabledAdapter {
	return &DisabledAdapter{}
}

func (a *DisabledAdapter) PlaceOrder(ctx context.Context, req OrderRequest) (OrderResponse, error) {
	return OrderResponse{}, errors.New("broker adapter not configured")
}

func (a *DisabledAdapter) CancelOrder(ctx context.Context, brokerOrderID string) error {
	return errors.New("broker adapter not configured")
}
