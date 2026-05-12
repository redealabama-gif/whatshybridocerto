-- 009_memory_events.sql
-- v9.5.5 — Granular memory event log ("Leão" pattern)
--
-- Adopted from RedeAlabama's serviceWorker.js queue → /v1/memory/query.php.
-- Companion to data-sync-manager which syncs whole storage blobs. This table
-- stores individual events (message_received, suggestion_used, feedback,
-- assistant_picked, etc.) so the backend can:
--   1. Reconstruct timeline per workspace/chat
--   2. Aggregate analytics that need event-level granularity (ai_tier_hit,
--      safety_blocked counts) without parsing the analytics_events JSON blob
--   3. Survive cross-device — events flushed from device A are queryable by
--      device B even before whole-blob sync runs

CREATE TABLE IF NOT EXISTS memory_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT,
  client_ts INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_memory_events_workspace_type ON memory_events(workspace_id, event_type, created_at DESC);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_memory_events_workspace_date ON memory_events(workspace_id, created_at DESC);
