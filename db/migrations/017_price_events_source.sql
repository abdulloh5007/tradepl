ALTER TABLE price_events
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'auto'));

CREATE INDEX IF NOT EXISTS idx_price_events_source_status_scheduled
  ON price_events(source, status, scheduled_at DESC);
