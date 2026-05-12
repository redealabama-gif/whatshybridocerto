-- 008_llm_cost_log.sql
-- v9.5.5 — Per-request LLM cost tracking
--
-- Adopted from RedeAlabama's llm_cost_log pattern. We already track AI events
-- in analytics_events but with no economic dimension. This table dedicates one
-- row per LLM request with token counts, latency and computed USD cost so
-- operators can see spend by provider/model/workspace/day.
--
-- The cost is computed at insert time using a static price table per model
-- (see CostLoggerService.js). If pricing changes, historical rows are NOT
-- recomputed — they reflect cost at the time of the request.

CREATE TABLE IF NOT EXISTS llm_cost_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,
  request_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  http_status INTEGER DEFAULT 200,
  cost_usd REAL DEFAULT 0,
  intent TEXT,
  chat_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_llm_cost_log_workspace_date ON llm_cost_log(workspace_id, created_at DESC);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_llm_cost_log_provider_model ON llm_cost_log(provider, model);
