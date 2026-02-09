-- Make UZS-USD behave like gold-style lot value:
-- 0.01 lot and +10 price points => +10 USD P/L.
-- PnL formula uses: (price_diff * lots * contract_size), so contract_size must be 100.

UPDATE trading_pairs
SET contract_size = 100
WHERE symbol = 'UZS-USD';
