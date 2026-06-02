-- 020_canary_runs.sql
-- Resultados do canário agendado do WhatsApp Web (scripts/canary-whatsapp.js).
--
-- O canário roda num host com sessão real do WhatsApp (Puppeteer, via cron),
-- faz POST do relatório em /api/v1/canary/report, e o painel admin lê daqui
-- (aba "Canário"). Objetivo: ver quando o WhatsApp muda e quebra a extensão
-- ANTES dos clientes reclamarem. Compatível SQLite + Postgres.

CREATE TABLE IF NOT EXISTS canary_runs (
  id             TEXT PRIMARY KEY,
  status         TEXT NOT NULL,                  -- healthy | degraded | broken | error
  source         TEXT NOT NULL DEFAULT 'whatsapp-web',
  wa_version     TEXT,
  broken_count   INTEGER NOT NULL DEFAULT 0,
  degraded_count INTEGER NOT NULL DEFAULT 0,
  duration_ms    INTEGER,
  report         TEXT,                           -- JSON completo do relatório
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_canary_runs_created ON canary_runs(created_at DESC);
