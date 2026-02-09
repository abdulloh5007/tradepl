-- Trading Sessions Configuration
-- Migration: 002_sessions.sql

-- Session configurations (Turbo, Normal, Calm)
CREATE TABLE IF NOT EXISTS session_configs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    update_rate_ms INT NOT NULL DEFAULT 500,
    volatility REAL NOT NULL DEFAULT 0.0008,
    spread REAL NOT NULL DEFAULT 8.0,
    trend_bias TEXT NOT NULL DEFAULT 'random',
    volume_factor REAL NOT NULL DEFAULT 1.0,
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scheduled price events (for planned price movements)
CREATE TABLE IF NOT EXISTS price_events (
    id SERIAL PRIMARY KEY,
    pair TEXT NOT NULL DEFAULT 'UZS-USD',
    target_price REAL NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
    duration_seconds INT NOT NULL DEFAULT 300,
    scheduled_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session schedule (for auto mode)
CREATE TABLE IF NOT EXISTS session_schedule (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES session_configs(id) ON DELETE CASCADE,
    start_hour INT NOT NULL CHECK (start_hour >= 0 AND start_hour <= 23),
    end_hour INT NOT NULL CHECK (end_hour >= 0 AND end_hour <= 23),
    days TEXT[] DEFAULT ARRAY['mon','tue','wed','thu','fri','sat','sun'],
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Admin settings (session mode, etc.)
CREATE TABLE IF NOT EXISTS admin_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO admin_settings (key, value) VALUES 
    ('session_mode', 'manual'),
    ('current_trend', 'random')
ON CONFLICT (key) DO NOTHING;

-- Insert default session configs
INSERT INTO session_configs (id, name, update_rate_ms, volatility, spread, trend_bias, volume_factor, is_active) VALUES 
    ('turbo', 'Turbo', 250, 0.0015, 5.0, 'random', 1.5, FALSE),
    ('normal', 'Normal', 500, 0.0008, 8.0, 'smooth', 1.0, TRUE),
    ('calm', 'Calm', 1000, 0.0003, 12.0, 'sideways', 0.5, FALSE)
ON CONFLICT (id) DO NOTHING;

-- Insert default schedule (idempotent)
INSERT INTO session_schedule (session_id, start_hour, end_hour, days)
SELECT v.session_id, v.start_hour, v.end_hour, v.days
FROM (
    VALUES
        ('calm', 0, 8, ARRAY['mon','tue','wed','thu','fri','sat','sun']::TEXT[]),
        ('normal', 8, 16, ARRAY['mon','tue','wed','thu','fri','sat','sun']::TEXT[]),
        ('turbo', 16, 23, ARRAY['mon','tue','wed','thu','fri','sat','sun']::TEXT[])
) AS v(session_id, start_hour, end_hour, days)
WHERE NOT EXISTS (
    SELECT 1
    FROM session_schedule s
    WHERE s.session_id = v.session_id
      AND s.start_hour = v.start_hour
      AND s.end_hour = v.end_hour
      AND s.days = v.days
);

-- Index for faster event queries
CREATE INDEX IF NOT EXISTS idx_price_events_scheduled ON price_events(scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_price_events_status ON price_events(status);
