-- One-time multi-stage profit reward program for real accounts.
-- Progress metric: sum of positive NET closed profit across all real accounts,
-- where net = realized_pnl + realized_swap (after trading costs snapshot).

CREATE TABLE IF NOT EXISTS profit_reward_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stage_no INT NOT NULL CHECK (stage_no BETWEEN 1 AND 5),
    target_trading_account_id UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE RESTRICT,
    threshold_usd NUMERIC NOT NULL,
    reward_usd NUMERIC NOT NULL,
    progress_snapshot_usd NUMERIC NOT NULL DEFAULT 0,
    ledger_tx_id UUID NOT NULL REFERENCES ledger_txs(id) ON DELETE RESTRICT,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_profit_reward_claims_user_stage
    ON profit_reward_claims(user_id, stage_no);

CREATE INDEX IF NOT EXISTS idx_profit_reward_claims_user_claimed
    ON profit_reward_claims(user_id, claimed_at DESC);

CREATE INDEX IF NOT EXISTS idx_profit_reward_claims_account_claimed
    ON profit_reward_claims(target_trading_account_id, claimed_at DESC);
