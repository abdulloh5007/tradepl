-- Persist order history snapshot fields used by mobile history UI.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class
        WHERE relkind = 'S' AND relname = 'orders_ticket_no_seq'
    ) THEN
        CREATE SEQUENCE orders_ticket_no_seq START WITH 1000000;
    END IF;
END$$;

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS ticket_no BIGINT,
    ADD COLUMN IF NOT EXISTS close_price NUMERIC,
    ADD COLUMN IF NOT EXISTS close_time TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS realized_pnl NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS realized_commission NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS realized_swap NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE orders
    ALTER COLUMN ticket_no SET DEFAULT nextval('orders_ticket_no_seq');

UPDATE orders
SET ticket_no = nextval('orders_ticket_no_seq')
WHERE ticket_no IS NULL;

ALTER TABLE orders
    ALTER COLUMN ticket_no SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_ticket_no ON orders(ticket_no);

UPDATE orders
SET close_time = updated_at
WHERE close_time IS NULL
  AND status IN ('closed', 'canceled');

UPDATE orders
SET close_price = price
WHERE close_price IS NULL
  AND status IN ('closed', 'canceled')
  AND price IS NOT NULL;

-- Keep sequence in sync when rows already had ticket_no values.
SELECT setval(
    'orders_ticket_no_seq',
    GREATEST((SELECT COALESCE(MAX(ticket_no), 1000000) FROM orders), 1000000),
    true
);

CREATE INDEX IF NOT EXISTS idx_orders_history_close_time
    ON orders(user_id, trading_account_id, close_time DESC, created_at DESC);
