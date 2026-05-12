#!/usr/bin/env node
/**
 * Script de migração SQLite → PostgreSQL — v9.0.0
 *
 * Copia todos os dados de um SQLite existente pra um Postgres limpo.
 *
 * Uso:
 *   SQLITE_PATH=/opt/whatshybrid/data/whatshybrid.db \
 *   DATABASE_URL=postgres://user:pass@host:5432/whatshybrid \
 *   node scripts/migrate-sqlite-to-postgres.js
 *
 * Flags:
 *   --dry-run     Conta linhas mas não insere
 *   --truncate    Limpa Postgres antes (CUIDADO)
 *   --batch=500   Tamanho dos batches (default: 500)
 *   --table=X     Migra apenas tabela X
 *
 * O que faz:
 *   1. Roda migrations versionadas no Postgres (cria schema)
 *   2. Lista tabelas do SQLite
 *   3. Copia dados em batches dentro de transação
 *   4. Valida count antes/depois
 *   5. Mostra summary
 */

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isTruncate = args.includes('--truncate');
const batchSize = parseInt((args.find(a => a.startsWith('--batch=')) || '').split('=')[1], 10) || 500;
const onlyTable = (args.find(a => a.startsWith('--table=')) || '').split('=')[1] || null;

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '../data/whatshybrid.db');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL não definida');
  console.error('   Use: DATABASE_URL=postgres://user:pass@host:5432/db node ' + __filename);
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
  console.error('❌ Deps faltando. Run: npm install better-sqlite3 pg');
  process.exit(1);
}

// ── Conecta SQLite ──
const sqlite = new Database(SQLITE_PATH, { readonly: true });
sqlite.pragma('journal_mode = WAL');
console.log(`📦 SQLite: ${SQLITE_PATH}`);

// ── Conecta Postgres ──
const pgPool = new Pool({ connectionString: DATABASE_URL, max: 5 });
console.log(`🐘 Postgres: ${DATABASE_URL.replace(/:[^@/]+@/, ':***@')}`);

async function listSqliteTables() {
  const rows = sqlite.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE '_%'
    ORDER BY name
  `).all();
  return rows.map(r => r.name);
}

async function listPgTables() {
  const r = await pgPool.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  return r.rows.map(row => row.tablename);
}

function getColumns(table) {
  return sqlite.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name);
}

async function getPgColumns(table) {
  const r = await pgPool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [table]);
  return r.rows.map(row => row.column_name);
}

async function copyTable(table) {
  const startMs = Date.now();

  const sqliteCols = getColumns(table);
  const pgCols = await getPgColumns(table);

  if (pgCols.length === 0) {
    console.warn(`  ⚠️  ${table}: tabela não existe no Postgres, pulando`);
    return { table, skipped: true, reason: 'no_pg_table' };
  }

  // Apenas colunas que existem em ambos
  const commonCols = sqliteCols.filter(c => pgCols.includes(c));
  if (commonCols.length === 0) {
    console.warn(`  ⚠️  ${table}: nenhuma coluna comum`);
    return { table, skipped: true, reason: 'no_common_cols' };
  }

  // Conta linhas no SQLite
  const sqliteCount = sqlite.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c;
  if (sqliteCount === 0) {
    console.log(`  ➖ ${table}: 0 linhas`);
    return { table, copied: 0, source: 0 };
  }

  // Conta linhas no Postgres
  const pgCountBefore = (await pgPool.query(`SELECT COUNT(*) AS c FROM "${table}"`)).rows[0].c;

  if (parseInt(pgCountBefore) > 0 && !isTruncate) {
    console.warn(`  ⚠️  ${table}: tem ${pgCountBefore} linhas no Postgres. Use --truncate ou pula.`);
    return { table, skipped: true, reason: 'pg_not_empty', pg_count: pgCountBefore };
  }

  if (isDryRun) {
    console.log(`  🔍 [dry-run] ${table}: copiaria ${sqliteCount} linhas`);
    return { table, copied: 0, source: sqliteCount, dry: true };
  }

  // Truncate se solicitado
  if (isTruncate && parseInt(pgCountBefore) > 0) {
    await pgPool.query(`TRUNCATE TABLE "${table}" CASCADE`);
    console.log(`  🗑️  ${table}: truncated`);
  }

  // Lê dados do SQLite em chunks
  const colsList = commonCols.map(c => `"${c}"`).join(', ');

  const client = await pgPool.connect();
  let copied = 0;

  try {
    await client.query('BEGIN');

    let offset = 0;
    while (offset < sqliteCount) {
      const rows = sqlite.prepare(
        `SELECT ${colsList} FROM "${table}" LIMIT ${batchSize} OFFSET ${offset}`
      ).all();

      if (rows.length === 0) break;

      // Build batch INSERT
      const placeholders = rows.map((row, ri) => {
        const start = ri * commonCols.length;
        return '(' + commonCols.map((_, ci) => `$${start + ci + 1}`).join(', ') + ')';
      }).join(', ');

      const values = [];
      for (const row of rows) {
        for (const col of commonCols) {
          let v = row[col];
          // Conversão SQLite → PG: BOOLEAN salvo como 0/1 vira TRUE/FALSE
          // (Se a coluna pg for BOOLEAN, INTEGER 0/1 dá conflito)
          // SQLite armazena tudo como TEXT/INTEGER/REAL/BLOB/NULL
          values.push(v);
        }
      }

      const insertSql = `INSERT INTO "${table}" (${colsList}) VALUES ${placeholders} ON CONFLICT DO NOTHING`;

      try {
        const result = await client.query(insertSql, values);
        copied += result.rowCount;
      } catch (insertErr) {
        // Se batch falha, tenta um por um
        console.warn(`  ⚠️  ${table}: batch falhou, tentando linha-por-linha: ${insertErr.message.substring(0, 100)}`);
        for (const row of rows) {
          try {
            const singlePlaceholders = '(' + commonCols.map((_, i) => `$${i + 1}`).join(', ') + ')';
            const singleSql = `INSERT INTO "${table}" (${colsList}) VALUES ${singlePlaceholders} ON CONFLICT DO NOTHING`;
            const singleValues = commonCols.map(c => row[c]);
            const r = await client.query(singleSql, singleValues);
            copied += r.rowCount;
          } catch (singleErr) {
            console.error(`    ❌ Row failed in ${table}: ${singleErr.message.substring(0, 100)}`);
          }
        }
      }

      offset += rows.length;
      if (sqliteCount > 1000 && offset % 5000 === 0) {
        process.stdout.write(`    ${offset}/${sqliteCount} (${Math.round(offset/sqliteCount*100)}%)\r`);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  const status = copied === sqliteCount ? '✅' : '⚠️';
  console.log(`  ${status} ${table}: ${copied}/${sqliteCount} (${elapsed}s)`);

  return { table, copied, source: sqliteCount, elapsed_s: parseFloat(elapsed) };
}

async function main() {
  console.log(`\n🔄 SQLite → Postgres Migration v9.0.0`);
  console.log(`   ${isDryRun ? '🔍 DRY RUN' : '✏️  WRITE MODE'}`);
  console.log(`   batch_size=${batchSize}`);
  console.log();

  try {
    // 1. Roda migrations no Postgres pra criar schema
    if (!isDryRun) {
      console.log('▶ Aplicando migrations no Postgres...');
      process.env.DB_DRIVER = 'postgres';
      process.env.DATABASE_URL = DATABASE_URL;
      delete require.cache[require.resolve('../src/utils/database')];
      delete require.cache[require.resolve('../src/utils/db')];
      const db = require('../src/utils/database');
      await db.runMigrations();
      console.log();
    }

    // 2. Lista tabelas
    const sqliteTables = await listSqliteTables();
    const pgTables = await listPgTables();
    console.log(`▶ SQLite tem ${sqliteTables.length} tabelas`);
    console.log(`▶ Postgres tem ${pgTables.length} tabelas`);
    console.log();

    // 3. Copia
    const tablesToMigrate = onlyTable
      ? sqliteTables.filter(t => t === onlyTable)
      : sqliteTables;

    console.log(`▶ Copiando ${tablesToMigrate.length} tabela(s):\n`);

    const results = [];
    for (const table of tablesToMigrate) {
      try {
        const r = await copyTable(table);
        results.push(r);
      } catch (err) {
        console.error(`  ❌ ${table}: ${err.message}`);
        results.push({ table, error: err.message });
      }
    }

    // 4. Summary
    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  MIGRATION SUMMARY                       ║`);
    console.log(`╚══════════════════════════════════════════╝\n`);

    const totalSource = results.reduce((s, r) => s + (r.source || 0), 0);
    const totalCopied = results.reduce((s, r) => s + (r.copied || 0), 0);
    const skipped = results.filter(r => r.skipped);
    const errors = results.filter(r => r.error);

    console.log(`  Tabelas migradas:  ${results.length - skipped.length - errors.length}`);
    console.log(`  Linhas origem:     ${totalSource.toLocaleString()}`);
    console.log(`  Linhas copiadas:   ${totalCopied.toLocaleString()}`);
    console.log(`  Tabelas puladas:   ${skipped.length}`);
    console.log(`  Tabelas com erro:  ${errors.length}`);

    if (skipped.length > 0) {
      console.log(`\n  Skipped:`);
      skipped.forEach(r => console.log(`    - ${r.table}: ${r.reason}`));
    }
    if (errors.length > 0) {
      console.log(`\n  Errors:`);
      errors.forEach(r => console.log(`    - ${r.table}: ${r.error.substring(0, 80)}`));
    }

    if (!isDryRun && totalCopied === totalSource) {
      console.log(`\n  ✅ Migração 100% sucesso`);
    } else if (!isDryRun) {
      console.log(`\n  ⚠️  Migração parcial (${Math.round(totalCopied/totalSource*100)}%)`);
    }

  } finally {
    sqlite.close();
    await pgPool.end();
  }
}

main().catch(err => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});
