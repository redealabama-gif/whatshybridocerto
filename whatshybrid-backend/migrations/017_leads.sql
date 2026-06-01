-- 017_leads.sql
-- Leads capturados pelo modal de saída da landing (public/index.html).
-- Nome + WhatsApp + e-mail são obrigatórios pra liberar o cupom EXIT50;
-- gravamos o lead aqui no submit do modal pra NÃO perder o contato caso a
-- pessoa não conclua o signup.
--
-- Captura é best-effort: o front dispara fire-and-forget e nunca bloqueia o
-- fluxo do usuário. coupon_code/source/attribution são nullable.
-- Formato compatível SQLite + Postgres.

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  coupon_code TEXT,
  source TEXT,
  attribution TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
