-- Plan-level commission/swap model:
-- commission_per_lot: USD per lot per side
-- swap_long_per_lot / swap_short_per_lot: USD per lot per rollover day

ALTER TABLE account_plans
    ADD COLUMN IF NOT EXISTS commission_per_lot DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS swap_long_per_lot DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS swap_short_per_lot DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS is_swap_free BOOLEAN NOT NULL DEFAULT FALSE;

-- Sensible defaults by plan.
UPDATE account_plans
SET
    commission_per_lot = CASE id
        WHEN 'standard' THEN 0.00
        WHEN 'pro' THEN 2.50
        WHEN 'raw' THEN 3.50
        WHEN 'swapfree' THEN 1.50
        ELSE commission_per_lot
    END,
    swap_long_per_lot = CASE id
        WHEN 'standard' THEN -0.80
        WHEN 'pro' THEN -0.70
        WHEN 'raw' THEN -0.60
        WHEN 'swapfree' THEN 0.00
        ELSE swap_long_per_lot
    END,
    swap_short_per_lot = CASE id
        WHEN 'standard' THEN -0.40
        WHEN 'pro' THEN -0.35
        WHEN 'raw' THEN -0.30
        WHEN 'swapfree' THEN 0.00
        ELSE swap_short_per_lot
    END,
    is_swap_free = CASE id
        WHEN 'swapfree' THEN TRUE
        ELSE FALSE
    END,
    updated_at = NOW();

CREATE TABLE IF NOT EXISTS order_swap_charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence BIGSERIAL NOT NULL,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
    charge_date DATE NOT NULL,
    lot_qty NUMERIC NOT NULL,
    rate_per_lot NUMERIC NOT NULL,
    amount NUMERIC NOT NULL,
    ledger_tx_id UUID NULL REFERENCES ledger_txs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(order_id, charge_date)
);

CREATE INDEX IF NOT EXISTS idx_order_swap_charges_user_date
    ON order_swap_charges(user_id, charge_date DESC, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_order_swap_charges_account_date
    ON order_swap_charges(trading_account_id, charge_date DESC, sequence DESC);
