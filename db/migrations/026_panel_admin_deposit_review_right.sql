-- Add explicit deposit review right for panel admins.
-- Owner is still always allowed, admins must have rights.deposit_review = true.

ALTER TABLE panel_admins
    ALTER COLUMN rights SET DEFAULT
    '{"sessions": false, "trend": false, "events": false, "volatility": false, "kyc_review": false, "deposit_review": false}'::jsonb;

UPDATE panel_admins
SET rights = COALESCE(rights, '{}'::jsonb) || '{"deposit_review": false}'::jsonb
WHERE NOT (COALESCE(rights, '{}'::jsonb) ? 'deposit_review');
