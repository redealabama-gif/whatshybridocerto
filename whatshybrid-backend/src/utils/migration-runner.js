/**
 * Migration Runner — v9.0.0
 *
 * Roda arquivos SQL em ordem alfabética de migrations/up/.
 * Rastreia em tabela _migrations qual já foi aplicada.
 * Idempotente: rodar múltiplas vezes só aplica novas.
 *
 * Convenção de nomes: 001_initial.sql, 002_add_x.sql, ...
 *
 * Uso programático:
 *   const { runVersionedMigrations } = require('./migration-runner');
 *   await runVersionedMigrations(db);
 *
 * Uso CLI:
 *   npm run migrate:up
 *   npm run migrate:status
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

async function ensureMigrationsTable(db) {
  const sql = `
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  if (db.driver === 'sqlite') {
    db.exec(sql);
  } else {
    await db.exec(sql.replace('TIMESTAMP DEFAULT CURRENT_TIMESTAMP', 'TIMESTAMP DEFAULT NOW()'));
  }
}

async function getApplied(db) {
  const isAsync = db.driver === 'postgres';
  const result = isAsync
    ? await db.all('SELECT id FROM _migrations ORDER BY id')
    : db.all('SELECT id FROM _migrations ORDER BY id');
  return new Set((result || []).map(r => r.id));
}

// v9.5.0 BUG #150: SQLite não suporta ALTER TABLE ADD COLUMN IF NOT EXISTS.
// Quando legacy SCHEMA + legacy.runMigrations já adicionou as colunas que
// uma migration versionada (002, 005) tenta adicionar de novo, recebemos
// "duplicate column name". Ignoramos APENAS esse erro específico; outros
// erros de DDL ainda quebram a transação.
function _isIdempotentSqlError(msg) {
  if (!msg) return false;
  const m = String(msg).toLowerCase();
  return (
    m.includes('duplicate column name') ||      // SQLite duplicate ALTER ADD
    m.includes('already exists') ||             // CREATE TABLE/INDEX duplicado
    m.includes('column already exists')         // Postgres equivalent
  );
}

async function applyMigration(db, file, content) {
  const id = path.basename(file, '.sql');
  logger.info(`[Migration] Applying ${id}...`);

  // Suporte a separator -- @SEPARATOR para SQL com múltiplas statements
  const statements = content.split(/^-- ?@SEPARATOR\s*$/m).map(s => s.trim()).filter(Boolean);

  if (db.driver === 'sqlite') {
    // SQLite via better-sqlite3 — síncrono
    db.transaction(() => {
      for (const stmt of statements) {
        try {
          db.exec(stmt);
        } catch (e) {
          if (_isIdempotentSqlError(e.message)) {
            logger.debug(`[Migration] ${id}: idempotent skip — ${e.message}`);
            continue;
          }
          throw e;
        }
      }
      db.run('INSERT INTO _migrations (id, filename) VALUES (?, ?)', [id, path.basename(file)]);
    });
  } else {
    // Postgres — assíncrono. Ainda commit-or-rollback inteiro, mas perdoa
    // erros de idempotência por statement (Postgres tem ALTER TABLE IF EXISTS
    // mas migrations legadas nem sempre usam).
    await db.transaction(async (txDb) => {
      for (const stmt of statements) {
        try {
          await txDb.exec(stmt);
        } catch (e) {
          if (_isIdempotentSqlError(e.message)) {
            logger.debug(`[Migration] ${id}: idempotent skip — ${e.message}`);
            continue;
          }
          throw e;
        }
      }
      await txDb.run('INSERT INTO _migrations (id, filename) VALUES (?, ?)', [id, path.basename(file)]);
    });
  }

  logger.info(`[Migration] Applied ${id} ✅`);
}

async function runVersionedMigrations(db) {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    logger.info('[Migration] No migrations directory, skipping');
    return { applied: 0, skipped: 0 };
  }

  await ensureMigrationsTable(db);
  const applied = await getApplied(db);

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let appliedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const id = path.basename(file, '.sql');
    if (applied.has(id)) {
      skippedCount++;
      continue;
    }

    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await applyMigration(db, file, content);
      appliedCount++;
    } catch (err) {
      logger.error(`[Migration] Failed ${id}: ${err.message}`);
      throw err;
    }
  }

  logger.info(`[Migration] Done: ${appliedCount} applied, ${skippedCount} skipped`);
  return { applied: appliedCount, skipped: skippedCount };
}

async function getStatus(db) {
  await ensureMigrationsTable(db);
  const applied = await getApplied(db);
  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
    : [];
  return files.map(f => ({
    id: path.basename(f, '.sql'),
    file: f,
    applied: applied.has(path.basename(f, '.sql')),
  }));
}

module.exports = { runVersionedMigrations, getStatus, ensureMigrationsTable };

// CLI
if (require.main === module) {
  const cmd = process.argv[2] || 'up';

  (async () => {
    const driver = require('./db');
    if (cmd === 'up') {
      const r = await runVersionedMigrations(driver);
      console.log(`\n✅ Migrations: ${r.applied} new, ${r.skipped} already applied`);
    } else if (cmd === 'status') {
      const status = await getStatus(driver);
      console.log('\nMigration status:\n');
      for (const s of status) {
        console.log(`  ${s.applied ? '✅' : '⏳'} ${s.id}`);
      }
    } else {
      console.error(`Unknown command: ${cmd}. Use: up | status`);
      process.exit(1);
    }
    process.exit(0);
  })().catch(err => { console.error(err); process.exit(1); });
}
