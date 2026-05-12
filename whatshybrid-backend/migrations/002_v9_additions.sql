-- 002_v9_additions.sql
-- Tabelas adicionadas em v9.0.0 que não existiam em v8.5.0

-- ── 2FA TOTP ──────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN totp_secret TEXT;
-- @SEPARATOR
ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0;
-- @SEPARATOR
ALTER TABLE users ADD COLUMN preferred_language TEXT DEFAULT 'pt-BR';
-- @SEPARATOR
ALTER TABLE users ADD COLUMN onboarding_completed INTEGER DEFAULT 0;

-- @SEPARATOR

-- ── Funnel events para analytics ──────────────────────────────────
CREATE TABLE IF NOT EXISTS funnel_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  workspace_id TEXT,
  step TEXT NOT NULL,
  metadata TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_funnel_step ON funnel_events(step, created_at DESC);
-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_funnel_user ON funnel_events(user_id, created_at DESC);
-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_funnel_workspace ON funnel_events(workspace_id, created_at DESC);

-- @SEPARATOR

-- ── Sistema de referrals ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  referrer_user_id TEXT NOT NULL,
  referrer_workspace_id TEXT NOT NULL,
  referred_email TEXT,
  referred_user_id TEXT,
  status TEXT DEFAULT 'pending',
  reward_tokens INTEGER DEFAULT 0,
  reward_paid_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);

-- @SEPARATOR

-- ── Email drip log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_drip_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  campaign TEXT NOT NULL,
  step TEXT NOT NULL,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, campaign, step)
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_drip_user ON email_drip_log(user_id);

-- @SEPARATOR

-- ── NPS responses ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nps_responses (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_nps_workspace ON nps_responses(workspace_id, created_at DESC);

-- @SEPARATOR

-- ── Health score em workspaces ────────────────────────────────────
ALTER TABLE workspaces ADD COLUMN health_score INTEGER DEFAULT 100;
-- @SEPARATOR
ALTER TABLE workspaces ADD COLUMN health_score_updated_at DATETIME;

-- @SEPARATOR

-- ── LGPD: data deletion log ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_deletion_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
