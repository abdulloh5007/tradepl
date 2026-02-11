-- Default leverage for newly created accounts should be 1:2000.
-- Existing account leverage values are intentionally preserved.

ALTER TABLE trading_accounts
    ALTER COLUMN leverage SET DEFAULT 2000;

ALTER TABLE account_plans
    ALTER COLUMN leverage SET DEFAULT 2000;

UPDATE account_plans
SET leverage = 2000
WHERE leverage <> 2000;
