-- 011_fix_sync_data.sql
-- Corrige o drift de schema da tabela sync_data.
--
-- O schema base (database-legacy.js) criava sync_data com colunas
-- module_key / version, enquanto routes/sync.js espera module / last_modified.
-- Como ambos usam CREATE TABLE IF NOT EXISTS e o schema base roda primeiro,
-- o sync.js herdava o schema errado e toda sincronizacao quebrava com
-- "no such column: module" / "no such column: last_modified".
--
-- sync_data e' uma tabela de CACHE de sincronizacao — o cliente (extensao)
-- re-envia os dados no proximo sync —, entao recriar e' seguro e nao perde
-- dado primario.

DROP TABLE IF EXISTS sync_data;

CREATE TABLE sync_data (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  module TEXT NOT NULL,
  data TEXT,
  last_modified INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_sync_user_module ON sync_data(user_id, module);
