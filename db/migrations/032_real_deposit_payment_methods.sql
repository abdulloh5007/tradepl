ALTER TABLE real_deposit_requests
    ADD COLUMN IF NOT EXISTS payment_method_id TEXT NOT NULL DEFAULT '';

INSERT INTO system_settings(key, value, updated_at)
VALUES ('real_deposit_methods', '{}', NOW())
ON CONFLICT (key) DO NOTHING;
