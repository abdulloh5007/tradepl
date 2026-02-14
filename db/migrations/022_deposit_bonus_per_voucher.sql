-- Deposit vouchers should be one-time per voucher type (gold/diamond), not one-time per user globally.

ALTER TABLE deposit_bonus_claims
    DROP CONSTRAINT IF EXISTS deposit_bonus_claims_user_id_key;

DROP INDEX IF EXISTS deposit_bonus_claims_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_deposit_bonus_claims_user_voucher
    ON deposit_bonus_claims(user_id, voucher_kind);
