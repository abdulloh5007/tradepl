-- Telegram deposit review integration:
-- - owner-configurable target chat id
-- - sent message metadata for pending real deposits
-- - reviewer telegram id for audit

ALTER TABLE trading_risk_config
    ADD COLUMN IF NOT EXISTS telegram_deposit_chat_id TEXT NOT NULL DEFAULT '';

UPDATE trading_risk_config
SET telegram_deposit_chat_id = COALESCE(telegram_deposit_chat_id, '')
WHERE id = 1;

ALTER TABLE real_deposit_requests
    ADD COLUMN IF NOT EXISTS review_message_chat_id BIGINT,
    ADD COLUMN IF NOT EXISTS review_message_id BIGINT,
    ADD COLUMN IF NOT EXISTS reviewed_by_telegram_id BIGINT,
    ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_real_deposit_requests_pending_unsent
    ON real_deposit_requests(status, review_message_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_real_deposit_requests_review_msg
    ON real_deposit_requests(review_message_chat_id, review_message_id);
