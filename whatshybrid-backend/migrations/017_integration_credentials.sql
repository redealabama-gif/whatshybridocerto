-- 017_integration_credentials.sql
-- Tabela do pool de credenciais gerenciado pelo painel admin.
--
-- Substitui o uso INCORRETO da tabela `api_keys` (que é de tenant, keyed por
-- key_hash) pelas rotas /api/v1/admin/api-keys. Guarda dois tipos (kind):
--   - 'api_key':     chaves de provedores (IA ou não) — fields.api_key
--   - 'integration': credenciais gerais — fields é um objeto livre, ex:
--                    Facebook { pixel_id, access_token }, Site { site_name,
--                    url, email, password }, SMTP { host, port, user, password }
--
-- `fields` é JSON livre pra permitir qualquer conjunto de chaves sem migração.

CREATE TABLE IF NOT EXISTS integration_credentials (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL DEFAULT 'api_key',
  provider    TEXT NOT NULL,
  label       TEXT,
  fields      TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'active',
  usage_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_used   DATETIME,
  notes       TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_integration_credentials_kind
  ON integration_credentials(kind, provider);
