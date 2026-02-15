-- Owner-managed dynamic spread profile (Balanced defaults).
-- Used by marketdata publisher to widen/tighten spread during impulses/news.

ALTER TABLE trading_risk_config
    ADD COLUMN IF NOT EXISTS spread_calm_max_add NUMERIC NOT NULL DEFAULT 0.12,
    ADD COLUMN IF NOT EXISTS spread_spike_threshold NUMERIC NOT NULL DEFAULT 0.60,
    ADD COLUMN IF NOT EXISTS spread_spike_max_add NUMERIC NOT NULL DEFAULT 0.20,
    ADD COLUMN IF NOT EXISTS spread_news_pre_mult NUMERIC NOT NULL DEFAULT 1.08,
    ADD COLUMN IF NOT EXISTS spread_news_post_mult NUMERIC NOT NULL DEFAULT 1.12,
    ADD COLUMN IF NOT EXISTS spread_news_live_low_mult NUMERIC NOT NULL DEFAULT 1.20,
    ADD COLUMN IF NOT EXISTS spread_news_live_medium_mult NUMERIC NOT NULL DEFAULT 1.35,
    ADD COLUMN IF NOT EXISTS spread_news_live_high_mult NUMERIC NOT NULL DEFAULT 1.55,
    ADD COLUMN IF NOT EXISTS spread_dynamic_cap_mult NUMERIC NOT NULL DEFAULT 1.75,
    ADD COLUMN IF NOT EXISTS spread_smoothing_alpha NUMERIC NOT NULL DEFAULT 0.18;

UPDATE trading_risk_config
SET
    spread_calm_max_add = COALESCE(spread_calm_max_add, 0.12),
    spread_spike_threshold = COALESCE(spread_spike_threshold, 0.60),
    spread_spike_max_add = COALESCE(spread_spike_max_add, 0.20),
    spread_news_pre_mult = COALESCE(spread_news_pre_mult, 1.08),
    spread_news_post_mult = COALESCE(spread_news_post_mult, 1.12),
    spread_news_live_low_mult = COALESCE(spread_news_live_low_mult, 1.20),
    spread_news_live_medium_mult = COALESCE(spread_news_live_medium_mult, 1.35),
    spread_news_live_high_mult = COALESCE(spread_news_live_high_mult, 1.55),
    spread_dynamic_cap_mult = COALESCE(spread_dynamic_cap_mult, 1.75),
    spread_smoothing_alpha = COALESCE(spread_smoothing_alpha, 0.18)
WHERE id = 1;

