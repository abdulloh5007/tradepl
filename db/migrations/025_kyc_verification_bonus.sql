-- KYC verification flow:
-- - one-time 50 USD bonus (configurable) for approved KYC
-- - Telegram review queue with approve/reject callbacks
-- - rejection ladder: 24h -> 7d -> permanent block

ALTER TABLE trading_risk_config
    ADD COLUMN IF NOT EXISTS telegram_kyc_chat_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS kyc_bonus_amount NUMERIC NOT NULL DEFAULT 50,
    ADD COLUMN IF NOT EXISTS kyc_review_eta_hours INT NOT NULL DEFAULT 8;

UPDATE trading_risk_config
SET
    telegram_kyc_chat_id = COALESCE(telegram_kyc_chat_id, ''),
    kyc_bonus_amount = COALESCE(kyc_bonus_amount, 50),
    kyc_review_eta_hours = COALESCE(kyc_review_eta_hours, 8)
WHERE id = 1;

ALTER TABLE panel_admins
    ALTER COLUMN rights SET DEFAULT '{"sessions": false, "trend": false, "events": false, "volatility": false, "kyc_review": false}'::jsonb;

UPDATE panel_admins
SET rights = COALESCE(rights, '{}'::jsonb) || '{"kyc_review": false}'::jsonb
WHERE NOT (COALESCE(rights, '{}'::jsonb) ? 'kyc_review');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class
        WHERE relkind = 'S' AND relname = 'kyc_verification_ticket_no_seq'
    ) THEN
        CREATE SEQUENCE kyc_verification_ticket_no_seq START WITH 3000000;
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS kyc_verification_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_no BIGINT NOT NULL DEFAULT nextval('kyc_verification_ticket_no_seq'),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL CHECK (document_type IN ('passport', 'id_card', 'driver_license', 'other')),
    full_name TEXT NOT NULL,
    document_number TEXT NOT NULL,
    residence_address TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    proof_file_name TEXT NOT NULL,
    proof_mime_type TEXT NOT NULL,
    proof_size_bytes INT NOT NULL CHECK (proof_size_bytes > 0),
    proof_blob BYTEA NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    review_due_at TIMESTAMPTZ NOT NULL,
    reviewed_at TIMESTAMPTZ NULL,
    reviewed_by_telegram_id BIGINT NULL,
    review_note TEXT NOT NULL DEFAULT '',
    review_message_chat_id BIGINT NULL,
    review_message_id BIGINT NULL,
    bonus_tx_id UUID NULL REFERENCES ledger_txs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(ticket_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kyc_verification_requests_user_pending
    ON kyc_verification_requests(user_id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_kyc_verification_requests_user_created
    ON kyc_verification_requests(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kyc_verification_requests_status_unsent
    ON kyc_verification_requests(status, review_message_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_kyc_verification_requests_review_msg
    ON kyc_verification_requests(review_message_chat_id, review_message_id);

CREATE TABLE IF NOT EXISTS kyc_user_states (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    failed_attempts INT NOT NULL DEFAULT 0,
    blocked_until TIMESTAMPTZ NULL,
    permanent_blocked BOOLEAN NOT NULL DEFAULT FALSE,
    last_rejected_at TIMESTAMPTZ NULL,
    last_request_id UUID NULL REFERENCES kyc_verification_requests(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kyc_bonus_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    trading_account_id UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
    request_id UUID NOT NULL UNIQUE REFERENCES kyc_verification_requests(id) ON DELETE CASCADE,
    amount_usd NUMERIC NOT NULL CHECK (amount_usd > 0),
    ledger_tx_id UUID NOT NULL REFERENCES ledger_txs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyc_bonus_claims_account_created
    ON kyc_bonus_claims(trading_account_id, created_at DESC);
