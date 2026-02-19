-- Settings for Telegram news signal channel are stored in system_settings (JSON key: telegram_news_signal_config).
-- This table keeps idempotent send history to avoid duplicate daily digests and pre-alert messages.
CREATE TABLE IF NOT EXISTS telegram_news_signal_logs (
    id BIGSERIAL PRIMARY KEY,
    signal_key TEXT NOT NULL UNIQUE,
    event_id BIGINT NULL REFERENCES economic_news_events(id) ON DELETE CASCADE,
    signal_type TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_news_signal_logs_event_id
    ON telegram_news_signal_logs(event_id);

CREATE INDEX IF NOT EXISTS idx_telegram_news_signal_logs_sent_at
    ON telegram_news_signal_logs(sent_at DESC);
