/**
 * Database Driver Abstraction — v9.0.0
 *
 * Permite alternar entre SQLite (dev/test) e PostgreSQL (produção)
 * via env var DB_DRIVER=sqlite|postgres
 *
 * API uniforme: run, get, all, transaction, exec, close
 *
 * Placeholders convertidos automaticamente:
 *   SQLite usa `?` → mantém
 *   Postgres usa `$1, $2, ...` → converte de `?`
 *
 * ⚠️ AVISO IMPORTANTE — DRIVER DRIFT (v9.3.6):
 *
 * SQLite (better-sqlite3) é SÍNCRONO: `db.run(...)` retorna objeto direto.
 * Postgres (pg) é ASSÍNCRONO: `db.run(...)` retorna Promise.
 *
 * O código atual (~364 chamadas em routes) usa o driver de modo SÍNCRONO:
 *   `const user = db.get('SELECT ...');`
 *   `if (user.id) { ... }`
 *
 * Isso FUNCIONA em SQLite mas QUEBRA em Postgres — em Postgres `user` será
 * uma Promise e `user.id` será undefined.
 *
 * RECOMENDAÇÃO ATUAL:
 *   - Use SQLite em produção single-tenant (até ~1000 usuários ativos)
 *   - Ou faça refactor adicionando `await` em TODAS as chamadas db.* antes
 *     de migrar pra Postgres
 *
 * Migração futura pra Postgres:
 *   1. Migrar 364 chamadas pra `await db.*`
 *   2. Verificar tipos DATETIME (SQLite) vs TIMESTAMP (Postgres) — postgres-driver
 *      converte automaticamente em adaptSqliteSql()
 *   3. Verificar ON CONFLICT vs INSERT OR REPLACE (postgres-driver tenta adaptar)
 *   4. Smoke test completo (suite de testes formais)
 *
 * Não foi feito v9.3.6 porque é trabalho dedicado de 1-2 dias com riscos
 * de regressão. Para tráfego atual SQLite sustenta confortavelmente.
 */

const driver = process.env.DB_DRIVER || 'sqlite';
const logger = require('../logger');

let backend;

if (driver === 'postgres') {
  logger.info('[DB] Driver: PostgreSQL');
  // v9.3.6: aviso explícito de drift
  logger.warn(
    '[DB] ⚠️ Postgres driver selecionado, mas o código backend usa db.* SÍNCRONO em ~364 lugares. ' +
    'Insert/Update podem não acontecer. Migre pra `await db.*` antes de usar Postgres em produção. ' +
    'Veja avisos em src/utils/db/index.js'
  );
  backend = require('./postgres-driver');
} else {
  logger.info('[DB] Driver: SQLite (better-sqlite3)');
  backend = require('./sqlite-driver');
}

module.exports = backend;
