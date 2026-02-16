-- Idempotent runtime-safe bootstrap for required reference data.
-- Useful for production repair when seed was not applied.

INSERT INTO assets (symbol, precision)
VALUES
    ('USD', 2),
    ('UZS', 2)
ON CONFLICT (symbol) DO UPDATE
SET precision = EXCLUDED.precision;

INSERT INTO account_plans (id, name, description, spread_multiplier, commission_rate, leverage)
VALUES
    ('standard', 'Standard', 'Balanced spread and zero commission', 1.0, 0.0000, 100),
    ('pro', 'Pro', 'Lower spread with a light commission', 0.75, 0.0005, 200),
    ('raw', 'Raw Spread', 'Raw spread with commission per trade', 0.45, 0.0010, 200),
    ('swapfree', 'Swap Free', 'No swap style account with slightly wider spread', 1.15, 0.0003, 100)
ON CONFLICT (id) DO NOTHING;

WITH base AS (
    SELECT id FROM assets WHERE symbol = 'UZS' LIMIT 1
), quote AS (
    SELECT id FROM assets WHERE symbol = 'USD' LIMIT 1
)
INSERT INTO trading_pairs (
    symbol, base_asset_id, quote_asset_id,
    price_precision, qty_precision, min_qty, min_notional,
    contract_size, pnl_contract_size, lot_step, min_lot, max_lot, status
)
SELECT
    'UZS-USD', base.id, quote.id,
    8, 2, 0.01, 0.01,
    20, 100, 0.01, 0.01, 100, 'active'
FROM base, quote
ON CONFLICT (symbol) DO NOTHING;

UPDATE trading_pairs
SET
    price_precision = CASE WHEN price_precision IS NULL OR price_precision <= 0 THEN 8 ELSE price_precision END,
    qty_precision = CASE WHEN qty_precision IS NULL OR qty_precision <= 0 THEN 2 ELSE qty_precision END,
    min_qty = CASE WHEN min_qty IS NULL OR min_qty <= 0 THEN 0.01 ELSE min_qty END,
    min_notional = CASE WHEN min_notional IS NULL OR min_notional <= 0 THEN 0.01 ELSE min_notional END,
    contract_size = CASE WHEN contract_size IS NULL OR contract_size <= 0 THEN 20 ELSE contract_size END,
    pnl_contract_size = CASE WHEN pnl_contract_size IS NULL OR pnl_contract_size <= 0 THEN 100 ELSE pnl_contract_size END,
    lot_step = CASE WHEN lot_step IS NULL OR lot_step <= 0 THEN 0.01 ELSE lot_step END,
    min_lot = CASE WHEN min_lot IS NULL OR min_lot <= 0 THEN 0.01 ELSE min_lot END,
    max_lot = CASE WHEN max_lot IS NULL OR max_lot <= 0 THEN 100 ELSE max_lot END,
    status = CASE WHEN status IS NULL OR btrim(status) = '' THEN 'active' ELSE status END
WHERE symbol = 'UZS-USD';
