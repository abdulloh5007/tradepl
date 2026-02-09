-- Per-account leverage (with support for unlimited mode = 0)
-- IMPORTANT: this repo reapplies all migration files via `make migrate`,
-- so this script must be idempotent and MUST NOT overwrite user-changed leverage.

DO $$
DECLARE
    leverage_column_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'trading_accounts'
          AND column_name = 'leverage'
    ) INTO leverage_column_exists;

    IF NOT leverage_column_exists THEN
        ALTER TABLE trading_accounts
            ADD COLUMN leverage INT;

        -- One-time backfill ONLY when column is first introduced.
        UPDATE trading_accounts ta
        SET leverage = p.leverage
        FROM account_plans p
        WHERE ta.plan_id = p.id;
    END IF;
END $$;

UPDATE trading_accounts
SET leverage = 100
WHERE leverage IS NULL;

ALTER TABLE trading_accounts
    ALTER COLUMN leverage SET DEFAULT 100;

ALTER TABLE trading_accounts
    ALTER COLUMN leverage SET NOT NULL;

ALTER TABLE trading_accounts
    DROP CONSTRAINT IF EXISTS trading_accounts_leverage_check;

ALTER TABLE trading_accounts
    ADD CONSTRAINT trading_accounts_leverage_check
    CHECK (leverage = 0 OR leverage IN (2, 5, 10, 20, 30, 40, 50, 100, 200, 500, 1000, 2000, 3000));
