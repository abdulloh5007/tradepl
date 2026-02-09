-- Keep only 2 market regimes for sessions/volatility:
-- London + New York.
-- Remove legacy profiles (turbo/normal/calm, low/medium/high).

-- Session profiles
INSERT INTO session_configs (id, name, update_rate_ms, volatility, spread, trend_bias, volume_factor, is_active)
VALUES
    ('london', 'London', 450, 0.0008, 8.0, 'random', 1.0, FALSE),
    ('newyork', 'New York', 300, 0.0012, 8.0, 'random', 1.25, FALSE)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    update_rate_ms = EXCLUDED.update_rate_ms,
    volatility = EXCLUDED.volatility,
    spread = EXCLUDED.spread,
    trend_bias = EXCLUDED.trend_bias,
    volume_factor = EXCLUDED.volume_factor,
    updated_at = NOW();

DO $$
DECLARE
    prev_active TEXT;
BEGIN
    SELECT id INTO prev_active
    FROM session_configs
    WHERE is_active = TRUE
    LIMIT 1;

    DELETE FROM session_configs
    WHERE id NOT IN ('london', 'newyork');

    UPDATE session_configs SET is_active = FALSE WHERE id IN ('london', 'newyork');
    IF prev_active = 'newyork' THEN
        UPDATE session_configs SET is_active = TRUE, updated_at = NOW() WHERE id = 'newyork';
    ELSE
        UPDATE session_configs SET is_active = TRUE, updated_at = NOW() WHERE id = 'london';
    END IF;
END $$;

-- Session schedule table is not authoritative in runtime, but keep it aligned.
DELETE FROM session_schedule;
INSERT INTO session_schedule (session_id, start_hour, end_hour, days, is_enabled)
VALUES
    ('newyork', 13, 22, ARRAY['mon','tue','wed','thu','fri','sat','sun']::TEXT[], TRUE),
    ('london', 0, 13, ARRAY['mon','tue','wed','thu','fri','sat','sun']::TEXT[], TRUE),
    ('london', 22, 23, ARRAY['mon','tue','wed','thu','fri','sat','sun']::TEXT[], TRUE);

-- Volatility profiles
INSERT INTO volatility_settings (id, name, value, spread, schedule_start, schedule_end, is_active)
VALUES
    ('london', 'London', 0.00008, 0.55e-8, '22:00', '13:00', FALSE),
    ('newyork', 'New York', 0.00014, 0.55e-8, '13:00', '22:00', FALSE)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    value = EXCLUDED.value,
    spread = EXCLUDED.spread,
    schedule_start = EXCLUDED.schedule_start,
    schedule_end = EXCLUDED.schedule_end;

DO $$
DECLARE
    prev_active TEXT;
BEGIN
    SELECT id INTO prev_active
    FROM volatility_settings
    WHERE is_active = TRUE
    LIMIT 1;

    DELETE FROM volatility_settings
    WHERE id NOT IN ('london', 'newyork');

    UPDATE volatility_settings SET is_active = FALSE WHERE id IN ('london', 'newyork');
    IF prev_active = 'newyork' THEN
        UPDATE volatility_settings SET is_active = TRUE WHERE id = 'newyork';
    ELSE
        UPDATE volatility_settings SET is_active = TRUE WHERE id = 'london';
    END IF;
END $$;

INSERT INTO admin_settings (key, value) VALUES ('session_mode', 'manual')
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_settings (key, value) VALUES ('volatility_mode', 'auto')
ON CONFLICT (key) DO NOTHING;
