-- 010_subscription_codes.sql
-- Pacote A: assinatura via código + anti-compartilhamento (1 código = 1 dispositivo)
--
-- Modelo:
--   subscription_codes.code      → string única (ex: WHL-XXXX-XXXX-XXXX)
--   subscription_codes.workspace → workspace ao qual o código dá acesso
--   subscription_codes.plan      → plano vendido (starter/pro/enterprise)
--   subscription_codes.device_id_hash → fingerprint do dispositivo onde foi ativado
--                                       (NULL = ainda não ativado)
--   subscription_codes.activated_at   → primeiro POST /validate bem-sucedido
--
-- Quando a extensão chama /validate com code, o backend:
--   1. Procura o código.
--   2. Se device_id_hash for NULL → grava o hash atual e libera.
--   3. Se device_id_hash bater → libera.
--   4. Se device_id_hash divergir → retorna 423 LOCKED com reason='in_use_elsewhere'.
-- Para "mudar de dispositivo" o usuário precisa logar no SaaS e clicar
-- "Desvincular dispositivo" — que zera o device_id_hash.

CREATE TABLE IF NOT EXISTS subscription_codes (
  code           TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  plan           TEXT NOT NULL DEFAULT 'starter',
  status         TEXT NOT NULL DEFAULT 'unused', -- unused | active | revoked | expired
  device_id_hash TEXT,                            -- NULL até primeira ativação
  activated_at   TEXT,
  revoked_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at     TEXT,                            -- opcional, p/ códigos com prazo de validade
  notes          TEXT,                            -- ex: id da compra que originou o código
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subscription_codes_workspace ON subscription_codes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_subscription_codes_status ON subscription_codes(status);
