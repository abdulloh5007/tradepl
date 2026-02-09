-- Trading risk configuration + instrument contract specs
-- Idempotent migration (safe for repeated `make migrate`)

CREATE TABLE IF NOT EXISTS trading_risk_config (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    max_open_positions INT NOT NULL DEFAULT 200,
    max_order_lots NUMERIC NOT NULL DEFAULT 100,
    max_order_notional_usd NUMERIC NOT NULL DEFAULT 50000,
    margin_call_level_pct NUMERIC NOT NULL DEFAULT 60,
    stop_out_level_pct NUMERIC NOT NULL DEFAULT 20,
    unlimited_effective_leverage INT NOT NULL DEFAULT 3000,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO trading_risk_config (
    id,
    max_open_positions,
    max_order_lots,
    max_order_notional_usd,
    margin_call_level_pct,
    stop_out_level_pct,
    unlimited_effective_leverage
)
VALUES (1, 200, 100, 50000, 60, 20, 3000)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE trading_pairs
    ADD COLUMN IF NOT EXISTS contract_size NUMERIC;

ALTER TABLE trading_pairs
    ADD COLUMN IF NOT EXISTS lot_step NUMERIC;

ALTER TABLE trading_pairs
    ADD COLUMN IF NOT EXISTS min_lot NUMERIC;

ALTER TABLE trading_pairs
    ADD COLUMN IF NOT EXISTS max_lot NUMERIC;

UPDATE trading_pairs
SET contract_size = CASE
        WHEN symbol = 'UZS-USD' THEN 1
        WHEN symbol = 'XAUUSD' THEN 100
        WHEN symbol = 'BTCUSD' THEN 1
        ELSE 100000
    END
WHERE contract_size IS NULL OR contract_size <= 0;

UPDATE trading_pairs
SET contract_size = 1
WHERE symbol = 'UZS-USD';

UPDATE trading_pairs
SET lot_step = 0.01
WHERE lot_step IS NULL OR lot_step <= 0;

UPDATE trading_pairs
SET min_lot = 0.01
WHERE min_lot IS NULL OR min_lot <= 0;

UPDATE trading_pairs
SET max_lot = 100
WHERE max_lot IS NULL OR max_lot <= 0;

ALTER TABLE trading_pairs
    ALTER COLUMN contract_size SET DEFAULT 100000;

ALTER TABLE trading_pairs
    ALTER COLUMN lot_step SET DEFAULT 0.01;

ALTER TABLE trading_pairs
    ALTER COLUMN min_lot SET DEFAULT 0.01;

ALTER TABLE trading_pairs
    ALTER COLUMN max_lot SET DEFAULT 100;

ALTER TABLE trading_pairs
    ALTER COLUMN contract_size SET NOT NULL;

ALTER TABLE trading_pairs
    ALTER COLUMN lot_step SET NOT NULL;

ALTER TABLE trading_pairs
    ALTER COLUMN min_lot SET NOT NULL;

ALTER TABLE trading_pairs
    ALTER COLUMN max_lot SET NOT NULL;
