-- 005_ai_metadata.sql
-- v9.3.0 — interaction_metadata (feedback loop) + autopilot_maturity (graduation)
--
-- Por que existe:
--   AIOrchestrator (em src/ai/AIOrchestrator.js linha 328) faz INSERT INTO
--   interaction_metadata depois de cada processMessage(). Sem essa tabela,
--   recordFeedback() não consegue recuperar o contexto da interação e o loop
--   de aprendizado fica quebrado em silêncio.
--
--   Em SQLite, a tabela era criada via database-legacy.js no boot.
--   Em Postgres (drop-in v9.0.0+), ela só existia se você rodasse o code path
--   do legacy. Esta migration garante schema consistente em ambos os drivers.

-- ── interaction_metadata: contexto persistido pra feedback loop ──────────
CREATE TABLE IF NOT EXISTS interaction_metadata (
  interaction_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  question TEXT NOT NULL,
  response TEXT NOT NULL,
  response_goal TEXT,
  client_stage TEXT,
  variant TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_interaction_metadata_workspace ON interaction_metadata(workspace_id, created_at DESC);
-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_interaction_metadata_chat ON interaction_metadata(chat_id, created_at DESC);

-- @SEPARATOR

-- ── autopilot_maturity: state machine training → ready → live → paused ──
-- AutopilotMaturityService cria isso via ensureTable() lazy, mas migration
-- formal garante que existe antes do primeiro request mesmo em Postgres.
CREATE TABLE IF NOT EXISTS autopilot_maturity (
  workspace_id TEXT PRIMARY KEY,
  stage TEXT NOT NULL DEFAULT 'training',
  total_interactions INTEGER NOT NULL DEFAULT 0,
  approved_count INTEGER NOT NULL DEFAULT 0,
  edited_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  success_rate REAL NOT NULL DEFAULT 0.0,
  last_interactions TEXT NOT NULL DEFAULT '[]',
  graduated_at DATETIME,
  paused_at DATETIME,
  paused_reason TEXT,
  config TEXT NOT NULL DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_autopilot_maturity_stage ON autopilot_maturity(stage);
