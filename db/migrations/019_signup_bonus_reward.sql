-- One-time signup bonus claim tracking.
-- Used for welcome reward card/claim flow on Accounts page.

CREATE TABLE IF NOT EXISTS signup_bonus_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL CHECK (amount > 0),
    ledger_tx_id UUID NOT NULL REFERENCES ledger_txs(id) ON DELETE RESTRICT,
    accepted_terms BOOLEAN NOT NULL DEFAULT TRUE,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_signup_bonus_claims_user_claimed
    ON signup_bonus_claims(user_id, claimed_at DESC);

CREATE INDEX IF NOT EXISTS idx_signup_bonus_claims_account_claimed
    ON signup_bonus_claims(trading_account_id, claimed_at DESC);
