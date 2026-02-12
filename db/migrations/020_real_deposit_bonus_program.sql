-- Bonus and real deposit request program.
-- Includes:
-- 1) configurable bonus/deposit settings (owner panel),
-- 2) real deposit request queue with proof,
-- 3) one-time deposit bonus claim tracking.

ALTER TABLE trading_risk_config
    ADD COLUMN IF NOT EXISTS signup_bonus_total_limit INT NOT NULL DEFAULT 700,
    ADD COLUMN IF NOT EXISTS signup_bonus_amount NUMERIC NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS real_deposit_min_usd NUMERIC NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS real_deposit_max_usd NUMERIC NOT NULL DEFAULT 1000,
    ADD COLUMN IF NOT EXISTS usd_to_uzs_rate NUMERIC NOT NULL DEFAULT 13000,
    ADD COLUMN IF NOT EXISTS real_deposit_review_minutes INT NOT NULL DEFAULT 120;

UPDATE trading_risk_config
SET
    signup_bonus_total_limit = COALESCE(signup_bonus_total_limit, 700),
    signup_bonus_amount = COALESCE(signup_bonus_amount, 10),
    real_deposit_min_usd = COALESCE(real_deposit_min_usd, 10),
    real_deposit_max_usd = COALESCE(real_deposit_max_usd, 1000),
    usd_to_uzs_rate = COALESCE(usd_to_uzs_rate, 13000),
    real_deposit_review_minutes = COALESCE(real_deposit_review_minutes, 120)
WHERE id = 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class
        WHERE relkind = 'S' AND relname = 'real_deposit_ticket_no_seq'
    ) THEN
        CREATE SEQUENCE real_deposit_ticket_no_seq START WITH 2000000;
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS real_deposit_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_no BIGINT NOT NULL DEFAULT nextval('real_deposit_ticket_no_seq'),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
    amount_usd NUMERIC NOT NULL CHECK (amount_usd > 0),
    amount_uzs NUMERIC NOT NULL CHECK (amount_uzs > 0),
    voucher_kind TEXT NOT NULL DEFAULT 'none' CHECK (voucher_kind IN ('none', 'gold', 'diamond')),
    bonus_percent NUMERIC NOT NULL DEFAULT 0,
    bonus_amount_usd NUMERIC NOT NULL DEFAULT 0,
    total_credit_usd NUMERIC NOT NULL DEFAULT 0,
    proof_file_name TEXT NOT NULL,
    proof_mime_type TEXT NOT NULL,
    proof_size_bytes INT NOT NULL CHECK (proof_size_bytes > 0),
    proof_blob BYTEA NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    review_due_at TIMESTAMPTZ NOT NULL,
    reviewed_at TIMESTAMPTZ NULL,
    approved_tx_id UUID NULL REFERENCES ledger_txs(id) ON DELETE SET NULL,
    bonus_tx_id UUID NULL REFERENCES ledger_txs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(ticket_no)
);

CREATE INDEX IF NOT EXISTS idx_real_deposit_requests_user_created
    ON real_deposit_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_real_deposit_requests_account_created
    ON real_deposit_requests(trading_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_real_deposit_requests_status_due
    ON real_deposit_requests(status, review_due_at ASC, created_at ASC);

CREATE TABLE IF NOT EXISTS deposit_bonus_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
    request_id UUID NOT NULL REFERENCES real_deposit_requests(id) ON DELETE CASCADE,
    voucher_kind TEXT NOT NULL CHECK (voucher_kind IN ('gold', 'diamond')),
    bonus_percent NUMERIC NOT NULL,
    bonus_amount_usd NUMERIC NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deposit_bonus_claims_account_created
    ON deposit_bonus_claims(trading_account_id, created_at DESC);
