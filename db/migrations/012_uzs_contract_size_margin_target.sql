-- Adjust UZS-USD contract size to target margin behavior:
-- at leverage 1:2000 and 0.01 lot, required margin should be ~1.2-1.3 USD
-- depending on current displayed price (around 12k-13k).
--
-- Formula:
--   margin = price * lots * contract_size / leverage
-- For price ~12_000..13_000, lots=0.01, leverage=2000:
--   contract_size = 20  => margin ~1.2..1.3

UPDATE trading_pairs
SET contract_size = 20
WHERE symbol = 'UZS-USD';
