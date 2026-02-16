ALTER TABLE users
    ADD COLUMN IF NOT EXISTS telegram_notification_kinds JSONB NOT NULL DEFAULT jsonb_build_object(
        'system', FALSE,
        'bonus', FALSE,
        'deposit', TRUE,
        'news', FALSE,
        'referral', TRUE
    );

