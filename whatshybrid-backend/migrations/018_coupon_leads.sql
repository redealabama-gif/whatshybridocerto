-- 018_coupon_leads.sql
-- Leads capturados no modal de cupom (exit-intent) da landing public/index.html.
-- A pessoa preenche nome, e-mail e telefone (WhatsApp) para liberar o desconto;
-- esses dados antes só iam para os pixels/sessionStorage e se perdiam. Agora
-- ficam persistidos para o admin consultar na aba "Cupom".

CREATE TABLE IF NOT EXISTS coupon_leads (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  phone      TEXT NOT NULL,
  coupon     TEXT,
  source     TEXT,
  referrer   TEXT,
  user_agent TEXT,
  ip         TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_coupon_leads_created ON coupon_leads(created_at DESC);
-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_coupon_leads_email ON coupon_leads(email);
