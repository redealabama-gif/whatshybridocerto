-- 007_analytics_tables.sql
-- v9.3.3 — tabelas analytics_telemetry e analytics_daily_metrics
--
-- Bug que isso resolve:
--   Rotas POST /api/v1/analytics/telemetry e processamento daily falhavam
--   com "no such table" porque as tabelas eram referenciadas em analytics.js
--   mas nunca declaradas no schema.

CREATE TABLE IF NOT EXISTS analytics_telemetry (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,
  session_id TEXT,
  total_sent INTEGER DEFAULT 0,
  total_failed INTEGER DEFAULT 0,
  total_confirmed INTEGER DEFAULT 0,
  unique_contacts INTEGER DEFAULT 0,
  total_campaigns INTEGER DEFAULT 0,
  data_snapshot TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_analytics_telemetry_workspace_date ON analytics_telemetry(workspace_id, created_at DESC);

-- @SEPARATOR

CREATE TABLE IF NOT EXISTS analytics_daily_metrics (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  date TEXT NOT NULL,
  messages_sent INTEGER DEFAULT 0,
  messages_failed INTEGER DEFAULT 0,
  messages_confirmed INTEGER DEFAULT 0,
  campaigns_started INTEGER DEFAULT 0,
  ai_requests INTEGER DEFAULT 0,
  ai_tokens INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  UNIQUE(workspace_id, date)
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_analytics_daily_workspace_date ON analytics_daily_metrics(workspace_id, date DESC);

-- @SEPARATOR

-- ai_usage_logs (referenciado em routes/admin.js)
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  user_id TEXT,
  provider TEXT,
  model TEXT,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  duration_ms INTEGER,
  status TEXT DEFAULT 'success',
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_ai_usage_workspace_date ON ai_usage_logs(workspace_id, created_at DESC);

-- @SEPARATOR

-- error_logs (referenciado em routes/admin.js)
CREATE TABLE IF NOT EXISTS error_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  user_id TEXT,
  error_type TEXT,
  error_message TEXT,
  stack_trace TEXT,
  context TEXT,
  severity TEXT DEFAULT 'error',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_error_logs_date ON error_logs(created_at DESC);

-- @SEPARATOR

-- admin_settings (referenciado em routes/admin.js — global, sem workspace)
CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);
