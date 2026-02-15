-- Economic news calendar for UZS-USD (hybrid: auto rules + owner manual events)
CREATE TABLE IF NOT EXISTS economic_news_events (
    id BIGSERIAL PRIMARY KEY,
    pair TEXT NOT NULL DEFAULT 'UZS-USD',
    title TEXT NOT NULL,
    impact TEXT NOT NULL CHECK (impact IN ('low', 'medium', 'high')),
    rule_key TEXT NOT NULL DEFAULT 'manual',
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
    forecast_value NUMERIC(20,6) NOT NULL DEFAULT 0,
    actual_value NUMERIC(20,6),
    actual_auto BOOLEAN NOT NULL DEFAULT FALSE,
    pre_seconds INT NOT NULL DEFAULT 900 CHECK (pre_seconds > 0 AND pre_seconds <= 86400),
    event_seconds INT NOT NULL DEFAULT 300 CHECK (event_seconds > 0 AND event_seconds <= 36000),
    post_seconds INT NOT NULL DEFAULT 3600 CHECK (post_seconds > 0 AND post_seconds <= 172800),
    scheduled_at TIMESTAMPTZ NOT NULL,
    live_started_at TIMESTAMPTZ,
    post_started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'pre', 'live', 'post', 'completed', 'cancelled')),
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_economic_news_events_pair_status_scheduled
    ON economic_news_events(pair, status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_economic_news_events_updated_at
    ON economic_news_events(updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_economic_news_events_schedule
    ON economic_news_events(pair, rule_key, scheduled_at, source);
