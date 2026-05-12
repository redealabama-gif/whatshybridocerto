-- 006_crm_stage.sql
-- v9.3.2 — adiciona coluna `stage` em contacts e índice
--
-- Bug que isso resolve:
--   Frontend permitia mover contato entre estágios do funil (kanban),
--   salvava localmente, mas no /sync com backend o campo era IGNORADO
--   porque a coluna não existia. Resultado: ao recarregar do backend,
--   contatos voltavam pra "new" perdendo todo o trabalho do usuário.
--
-- Idempotente: ALTER TABLE ADD COLUMN IF NOT EXISTS funciona em
-- SQLite >= 3.35 e Postgres. Pra SQLite mais antigo, fazemos try/catch
-- via app code; aqui usamos versão segura.

-- @SEPARATOR

-- SQLite não suporta IF NOT EXISTS no ADD COLUMN, mas é idempotente em outros sentidos:
-- usamos PRAGMA pra checar antes em código quando aplicar. SQL puro:
ALTER TABLE contacts ADD COLUMN stage TEXT DEFAULT 'new';

-- @SEPARATOR

CREATE INDEX IF NOT EXISTS idx_contacts_stage ON contacts(workspace_id, stage);

-- @SEPARATOR

-- Backfill: contatos sem stage recebem 'new'
UPDATE contacts SET stage = 'new' WHERE stage IS NULL;
