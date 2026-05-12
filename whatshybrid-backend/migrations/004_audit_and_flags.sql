-- 004_audit_and_flags.sql
-- v9.2.0 — audit log, feature flags, login attempts tracking

-- ── Audit log: ações sensíveis (LGPD + investigação) ─────────────────────
-- Imutável: nunca UPDATE/DELETE. Apenas INSERT.
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  workspace_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  ip TEXT,
  user_agent TEXT,
  metadata TEXT,
  outcome TEXT DEFAULT 'success',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC);
-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_log(workspace_id, created_at DESC);
-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, created_at DESC);

-- @SEPARATOR

-- ── Feature flags ────────────────────────────────────────────────────────
-- Permite ligar/desligar features sem deploy.
-- workspace_id NULL = flag global. Se workspace tem override, ele vence.
CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY,
  flag_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  workspace_id TEXT,
  description TEXT,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (flag_name, workspace_id)
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_feature_flags_name ON feature_flags(flag_name);
-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_feature_flags_workspace ON feature_flags(workspace_id);

-- @SEPARATOR

-- ── Login attempts: rate limit por email ─────────────────────────────────
CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, created_at DESC);

-- @SEPARATOR

-- ── Selector telemetry: detectar quebra de seletores do WhatsApp Web ────
CREATE TABLE IF NOT EXISTS selector_telemetry (
  id TEXT PRIMARY KEY,
  selector_name TEXT NOT NULL,
  wa_version TEXT,
  extension_version TEXT,
  workspace_id TEXT,
  failure_count INTEGER DEFAULT 1,
  first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT,
  UNIQUE (selector_name, wa_version, extension_version)
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_selector_recent ON selector_telemetry(last_seen DESC);
-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_selector_workspace ON selector_telemetry(workspace_id);

-- @SEPARATOR

-- ── Adiciona extension_version às tabelas que recebem dados da extensão ──
ALTER TABLE workspaces ADD COLUMN current_extension_version TEXT;
