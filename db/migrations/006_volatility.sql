CREATE TABLE IF NOT EXISTS volatility_settings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    value FLOAT NOT NULL,
    spread FLOAT NOT NULL,
    schedule_start TEXT, -- Using TEXT for simple HH:MM storage
    schedule_end TEXT,
    is_active BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Initial Data (Reduced by 3x)
INSERT INTO volatility_settings (id, name, value, spread, schedule_start, schedule_end, is_active)
VALUES
    ('low', 'Low', 0.00005, 0.22e-8, '19:00', '09:00', false),
    ('medium', 'Medium', 0.0001, 0.55e-8, '13:00', '19:00', true),
    ('high', 'High', 0.0002, 1.33e-8, '09:00', '13:00', false)
ON CONFLICT (id) DO UPDATE SET
    value = EXCLUDED.value,
    spread = EXCLUDED.spread;

INSERT INTO system_settings (key, value)
VALUES ('volatility_mode', 'auto')
ON CONFLICT (key) DO NOTHING;
