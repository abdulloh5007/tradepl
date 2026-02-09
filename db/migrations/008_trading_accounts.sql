-- Multi-account model: account plans + user trading accounts (demo/real)

CREATE TABLE IF NOT EXISTS account_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    spread_multiplier FLOAT NOT NULL DEFAULT 1.0,
    commission_rate FLOAT NOT NULL DEFAULT 0.0,
    leverage INT NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO account_plans (id, name, description, spread_multiplier, commission_rate, leverage)
VALUES
    ('standard', 'Standard', 'Balanced spread and zero commission', 1.0, 0.0000, 100),
    ('pro', 'Pro', 'Lower spread with a light commission', 0.75, 0.0005, 200),
    ('raw', 'Raw Spread', 'Raw spread with commission per trade', 0.45, 0.0010, 200),
    ('swapfree', 'Swap Free', 'No swap style account with slightly wider spread', 1.15, 0.0003, 100)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    spread_multiplier = EXCLUDED.spread_multiplier,
    commission_rate = EXCLUDED.commission_rate,
    leverage = EXCLUDED.leverage,
    updated_at = NOW();

CREATE TABLE IF NOT EXISTS trading_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES account_plans(id),
    mode TEXT NOT NULL CHECK (mode IN ('demo', 'real')),
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trading_accounts_user ON trading_accounts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_accounts_user_active ON trading_accounts(user_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_accounts_user_mode_name ON trading_accounts(user_id, mode, name);

ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS trading_account_id UUID NULL REFERENCES trading_accounts(id) ON DELETE CASCADE;

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS trading_account_id UUID NULL REFERENCES trading_accounts(id) ON DELETE SET NULL;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_owner_type_owner_user_id_asset_id_kind_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_user_trading_unique
    ON accounts(owner_user_id, trading_account_id, asset_id, kind)
    WHERE owner_type = 'user';

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_system_unique
    ON accounts(asset_id, kind)
    WHERE owner_type = 'system';

CREATE INDEX IF NOT EXISTS idx_accounts_trading_account ON accounts(trading_account_id);
CREATE INDEX IF NOT EXISTS idx_orders_trading_account_status ON orders(trading_account_id, status, created_at DESC);

-- Seed default demo and real accounts for existing users when missing
INSERT INTO trading_accounts (user_id, plan_id, mode, name, is_active)
SELECT u.id, 'standard', 'demo', 'Demo Standard', FALSE
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM trading_accounts ta
    WHERE ta.user_id = u.id AND ta.mode = 'demo' AND ta.plan_id = 'standard'
);

INSERT INTO trading_accounts (user_id, plan_id, mode, name, is_active)
SELECT u.id, 'standard', 'real', 'Real Standard', FALSE
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM trading_accounts ta
    WHERE ta.user_id = u.id AND ta.mode = 'real' AND ta.plan_id = 'standard'
);

-- Ensure each user has one active account
UPDATE trading_accounts ta
SET is_active = TRUE, updated_at = NOW()
WHERE ta.id IN (
    SELECT DISTINCT ON (user_id) id
    FROM trading_accounts
    ORDER BY user_id, (mode = 'demo') DESC, created_at ASC
)
AND NOT EXISTS (
    SELECT 1
    FROM trading_accounts t2
    WHERE t2.user_id = ta.user_id AND t2.is_active = TRUE
);

-- Backfill legacy accounts/orders into the default demo account
UPDATE accounts a
SET trading_account_id = ta.id
FROM trading_accounts ta
WHERE a.owner_type = 'user'
  AND a.owner_user_id = ta.user_id
  AND ta.mode = 'demo'
  AND ta.plan_id = 'standard'
  AND a.trading_account_id IS NULL;

UPDATE orders o
SET trading_account_id = ta.id
FROM trading_accounts ta
WHERE o.user_id = ta.user_id
  AND ta.mode = 'demo'
  AND ta.plan_id = 'standard'
  AND o.trading_account_id IS NULL;
