-- 015_coupons.sql
-- Fase 1 da cobrança real: sistema de cupons promocionais.
--
-- Frontend (signup.html) e exit-intent modal da landing prometem
-- "50% OFF no 1º mês" via ?coupon=EXIT50. Até esta migration, o backend
-- ignorava o campo: o usuário via desconto na UI mas era cobrado o
-- preço cheio quando o trial acabava. Esta migration introduz:
--
-- 1. `coupons` — definição dos códigos promocionais e suas regras.
--    Tipos suportados (kind):
--      - 'percent'  → value é fração entre 0 e 1 (0.5 = 50% off)
--      - 'fixed'    → value é R$ a descontar (max = amount total)
--    Escopo:
--      - first_invoice_only=1 → só vale na 1ª cobrança (caso EXIT50)
--      - first_invoice_only=0 → válido em todas as renovações enquanto
--        o cupom estiver dentro de valid_until / max_redemptions
--    Restrições:
--      - applies_to_plans = NULL  → todos os planos pagos
--      - applies_to_plans = 'starter,pro' → CSV de planos
--
-- 2. `coupon_redemptions` — auditoria de cada uso (workspace, valor
--    original, valor descontado, plano, status). Permite calcular custo
--    de aquisição (CAC) e detectar abuso.
--
-- 3. `workspaces.coupon_code` — qual cupom o workspace tem pendente.
--    Setado no signup, consumido quando a 1ª invoice é gerada.
--    `coupon_first_invoice_used_at` marca que já foi aplicado, evitando
--    aplicar novamente em renovações para cupons first_invoice_only.

CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('percent', 'fixed')),
  value REAL NOT NULL,
  description TEXT,
  applies_to_plans TEXT,
  first_invoice_only INTEGER NOT NULL DEFAULT 1,
  max_redemptions INTEGER,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  valid_from DATETIME,
  valid_until DATETIME,
  active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  metadata TEXT
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_coupons_active_validity ON coupons(active, valid_until);

-- @SEPARATOR
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id TEXT PRIMARY KEY,
  coupon_code TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  original_amount REAL NOT NULL,
  discount_amount REAL NOT NULL,
  final_amount REAL NOT NULL,
  invoice_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (coupon_code) REFERENCES coupons(code),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_workspace ON coupon_redemptions(workspace_id);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_code ON coupon_redemptions(coupon_code);

-- @SEPARATOR
ALTER TABLE workspaces ADD COLUMN coupon_code TEXT;

-- @SEPARATOR
ALTER TABLE workspaces ADD COLUMN coupon_applied_at DATETIME;

-- @SEPARATOR
ALTER TABLE workspaces ADD COLUMN coupon_first_invoice_used_at DATETIME;

-- @SEPARATOR
-- Seed do cupom EXIT50 (50% off na 1ª fatura, sem limite de redenções,
-- sem prazo de expiração). active=1 → já vale imediatamente.
INSERT OR IGNORE INTO coupons
  (code, kind, value, description, applies_to_plans, first_invoice_only, active)
VALUES
  ('EXIT50', 'percent', 0.5, '50% OFF no 1º mês (exit-intent)', NULL, 1, 1);
