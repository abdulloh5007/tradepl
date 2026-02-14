ALTER TABLE users
    ADD COLUMN IF NOT EXISTS referral_code TEXT,
    ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS referred_at TIMESTAMPTZ;

-- Keep referral code deterministic and unique per user.
UPDATE users
SET referral_code = 'bx' || REPLACE(id::text, '-', '')
WHERE COALESCE(TRIM(referral_code), '') = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code
    ON users (referral_code)
    WHERE COALESCE(TRIM(referral_code), '') <> '';

CREATE TABLE IF NOT EXISTS referral_wallets (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance NUMERIC NOT NULL DEFAULT 0,
    total_earned NUMERIC NOT NULL DEFAULT 0,
    total_withdrawn NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (balance >= 0),
    CHECK (total_earned >= 0),
    CHECK (total_withdrawn >= 0)
);

CREATE TABLE IF NOT EXISTS referral_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    related_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    trading_account_id UUID REFERENCES trading_accounts(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    commission_percent NUMERIC NOT NULL DEFAULT 0,
    source_ref TEXT NOT NULL DEFAULT '',
    ledger_tx_id UUID REFERENCES ledger_txs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (kind IN ('signup', 'deposit_commission', 'withdrawal')),
    CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_referral_events_user_created
    ON referral_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referral_events_related_user
    ON referral_events(related_user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_events_kind_source
    ON referral_events(kind, source_ref);

INSERT INTO referral_wallets (user_id)
SELECT u.id
FROM users u
ON CONFLICT (user_id) DO NOTHING;
