-- Separate fixed P/L sizing from margin sizing.
-- contract_size continues to drive margin/notional.
-- pnl_contract_size drives unrealized/realized P/L.
--
-- Target for UZS-USD:
-- 0.01 lot and 14 points move => 14 USD P/L
-- pnl = move * lot * pnl_contract_size => pnl_contract_size = 100

ALTER TABLE trading_pairs
    ADD COLUMN IF NOT EXISTS pnl_contract_size NUMERIC;

-- Backfill existing rows to preserve current behavior by default.
UPDATE trading_pairs
SET pnl_contract_size = contract_size
WHERE pnl_contract_size IS NULL OR pnl_contract_size <= 0;

-- UZS-USD uses fixed P/L multiplier independent from margin contract size.
UPDATE trading_pairs
SET pnl_contract_size = 100
WHERE symbol = 'UZS-USD';
