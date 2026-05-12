/**
 * SQLite → PostgreSQL Migration Script
 *
 * Copia todos os dados de um banco SQLite (better-sqlite3) para Postgres,
 * preservando IDs e validando counts antes/depois.
 *
 * Uso:
 *   # 1. Garante que migrations já rodaram no Postgres (cria schema vazio)
 *   DB_DRIVER=postgres DATABASE_URL=postgres://... npm run migrate:up
 *
 *   # 2. Roda este script
 *   SQLITE_PATH=./data/whatshybrid.db DATABASE_URL=postgres://... \
 *     node scripts/migrate-sqlite-to-postgres.js
 *
 *   # 3. Valida (script já faz isso automaticamente)
 *   # Para um dry-run que só mostra o que faria:
 *   DRY_RUN=1 node scripts/migrate-sqlite-to-postgres.js
 *
 * IMPORTANTE:
 *  - Pare o backend ANTES de rodar (write-locks).
 *  - Sempre faz backup do SQLite original antes (este script faz dump pra .bak).
 *  - Roda em transação por tabela: se uma tabela falhar, ela faz rollback,
 *    mas as outras já migradas permanecem no Postgres.
 *  - Idempotente em caso de re-run? NÃO. Se rodar 2x sem dropar o Postgres,
 *    vai dar erro de UNIQUE constraint. Use TRUNCATE primeiro se for re-rodar.
 */

const fs = require('fs');
const path = require('path');

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '../whatshybrid-backend/data/whatshybrid.db');
const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.env.DRY_RUN === '1';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE, 10) || 500;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL é obrigatório (postgres://user:pass@host:5432/db)');
  process.exit(1);
}
if (!fs.existsSync(SQLITE_PATH)) {
  console.error(`❌ SQLite não encontrado em ${SQLITE_PATH}`);
  process.exit(1);
}

let Database, Pool;
try {
  Database = require('better-sqlite3');
  Pool = require('pg').Pool;
} catch (e) {
  console.error(`❌ Faltam deps. Run: npm install better-sqlite3 pg\n${e.message}`);
  process.exit(1);
}

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const pgPool = new Pool({ connectionString: DATABASE_URL, max: 5 });

// ── Tabelas a migrar (ordem importa por foreign keys) ──
const TABLES = [
  // Independent first
  'workspaces',
  'users',
  '_migrations',

  // Auth
  'refresh_tokens',
  'password_reset_tokens',
  'api_keys',

  // Multi-tenant settings
  'workspace_settings',
  'ai_settings',

  // Tokens
  'token_balances',
  'token_transactions',

  // Billing
  'billing_invoices',
  'billing_attempts',
  'webhook_inbox',
  'webhook_outbox',
  'email_outbox',

  // Domain data
  'contacts',
  'conversations',
  'messages',
  'deals',
  'campaigns',
  'tasks',
  'templates',
  'tags',
  'contact_tags',

  // AI
  'ai_requests',
  'ai_responses',
  'ai_outcomes',
  'ai_quality_scores',
  'ai_learning_events',
  'knowledge_base_entries',

  // Analytics
  'extension_telemetry',
  'audit_log',

  // v9 features
  'funnel_events',
  'referrals',
  'email_drip_log',
  'nps_responses',
  'data_deletion_log',
];

function getTablesInSqlite() {
  return sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map(r => r.name);
}

function getColumns(tableName) {
  return sqlite
    .prepare(`PRAGMA table_info(${tableName})`)
    .all();
}

function escapePgIdentifier(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

async function migrateTable(tableName) {
  const exists = sqlite.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`
  ).get(tableName);

  if (!exists) {
    return { table: tableName, status: 'skipped', reason: 'not in sqlite' };
  }

  const cols = getColumns(tableName);
  if (cols.length === 0) return { table: tableName, status: 'skipped', reason: 'no columns' };

  const colNames = cols.map(c => c.name);
  const sourceCount = sqlite.prepare(`SELECT COUNT(*) AS c FROM ${escapePgIdentifier(tableName)}`).get().c;

  if (sourceCount === 0) {
    return { table: tableName, status: 'empty', count: 0 };
  }

  if (DRY_RUN) {
    return { table: tableName, status: 'dry_run', would_copy: sourceCount };
  }

  // Stream em batches
  let copied = 0;
  let offset = 0;

  const colList = colNames.map(escapePgIdentifier).join(', ');
  const placeholders = colNames.map((_, i) => `$${i + 1}`).join(', ');
  const insertSql = `INSERT INTO ${escapePgIdentifier(tableName)} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    while (offset < sourceCount) {
      const rows = sqlite
        .prepare(`SELECT * FROM ${escapePgIdentifier(tableName)} LIMIT ? OFFSET ?`)
        .all(BATCH_SIZE, offset);

      for (const row of rows) {
        const values = colNames.map(name => {
          const v = row[name];
          // SQLite INTEGER pra BOOLEAN em Postgres? Mantém integer (compat)
          // SQLite TEXT timestamps já são ISO ou parseable por pg
          // null permanece null
          return v;
        });

        try {
          await client.query(insertSql, values);
          copied++;
        } catch (err) {
          // Tipo mismatch? Log e segue
          console.warn(`  ⚠️  ${tableName} row failed: ${err.message.substring(0, 100)}`);
        }
      }

      offset += BATCH_SIZE;
      if (sourceCount > 1000) {
        process.stdout.write(`\r  ${tableName}: ${Math.min(offset, sourceCount)}/${sourceCount}`);
      }
    }

    await client.query('COMMIT');
    if (sourceCount > 1000) process.stdout.write('\n');

    // Validação
    const targetCountResult = await client.query(`SELECT COUNT(*) AS c FROM ${escapePgIdentifier(tableName)}`);
    const targetCount = parseInt(targetCountResult.rows[0].c, 10);

    return {
      table: tableName,
      status: targetCount === sourceCount ? 'ok' : 'partial',
      source: sourceCount,
      target: targetCount,
      copied,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return { table: tableName, status: 'error', error: err.message };
  } finally {
    client.release();
  }
}

async function resetSequencesPg() {
  // Pra cada tabela que tem coluna 'id' SERIAL, reseta a sequence pro max + 1
  const client = await pgPool.connect();
  try {
    const r = await client.query(`
      SELECT c.relname AS sequence_name, t.relname AS table_name
      FROM pg_class c
      JOIN pg_depend d ON d.objid = c.oid
      JOIN pg_class t ON d.refobjid = t.oid
      WHERE c.relkind = 'S'
    `);
    for (const seq of r.rows) {
      try {
        await client.query(`SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${escapePgIdentifier(seq.table_name)}), 0) + 1, false)`,
          [seq.sequence_name]);
      } catch (_) {}
    }
  } finally {
    client.release();
  }
}

async function run() {
  console.log('═'.repeat(60));
  console.log('  SQLite → PostgreSQL Migration');
  console.log('═'.repeat(60));
  console.log(`  Source:  ${SQLITE_PATH}`);
  console.log(`  Target:  ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`  Mode:    ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`  Batch:   ${BATCH_SIZE} rows`);
  console.log('═'.repeat(60));
  console.log();

  // Backup do SQLite
  if (!DRY_RUN) {
    const bakPath = SQLITE_PATH + '.bak.' + Date.now();
    fs.copyFileSync(SQLITE_PATH, bakPath);
    console.log(`📦 Backup criado: ${bakPath}\n`);
  }

  const sqliteTables = getTablesInSqlite();
  console.log(`Encontradas ${sqliteTables.length} tabelas no SQLite\n`);

  // Migra tabelas listadas (em ordem) + qualquer extra do SQLite
  const allTables = [...TABLES];
  for (const t of sqliteTables) {
    if (!allTables.includes(t) && !t.startsWith('_')) {
      allTables.push(t);
    }
  }

  const results = [];
  for (const t of allTables) {
    const r = await migrateTable(t);
    results.push(r);

    const icon = r.status === 'ok' ? '✅' :
                 r.status === 'empty' ? '⚪' :
                 r.status === 'skipped' ? '⏭️' :
                 r.status === 'dry_run' ? '🔍' :
                 r.status === 'partial' ? '⚠️' : '❌';
    const detail = r.status === 'ok' ? `${r.target} rows` :
                   r.status === 'partial' ? `${r.target}/${r.source} rows` :
                   r.status === 'dry_run' ? `would copy ${r.would_copy}` :
                   r.status === 'empty' ? '0 rows' :
                   r.status === 'error' ? r.error : r.reason;
    console.log(`  ${icon} ${t.padEnd(30)} ${detail}`);
  }

  if (!DRY_RUN) {
    console.log('\n🔧 Resetando sequences no Postgres...');
    await resetSequencesPg();
    console.log('✅ Done');
  }

  const ok = results.filter(r => r.status === 'ok').length;
  const failed = results.filter(r => r.status === 'error' || r.status === 'partial').length;
  const skipped = results.filter(r => r.status === 'skipped' || r.status === 'empty').length;

  console.log('\n' + '═'.repeat(60));
  console.log(`  ✅ OK:      ${ok}`);
  console.log(`  ❌ Failed:  ${failed}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log('═'.repeat(60));

  await pgPool.end();
  sqlite.close();

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
