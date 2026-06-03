#!/usr/bin/env node
'use strict';
/**
 * DR RESTORE DRILL (SQLite) — prova executável de que o backup é RESTAURÁVEL.
 *
 * Ter script de backup não prova nada; o que prova é restaurar e conferir que o
 * dado voltou íntegro. Este drill faz o ciclo completo, em processo e sem deps
 * extras (usa better-sqlite3, já dependência, + zlib nativo):
 *
 *   1. sobe um DB vivo com as MIGRATIONS reais e semeia linhas conhecidas;
 *   2. tira um snapshot ONLINE via .backup() (mesmo primitivo do
 *      deploy/scripts/backup.sh) e comprime com gzip -9;
 *   3. simula DESASTRE apagando o DB vivo (+ sidecars WAL/SHM);
 *   4. RESTAURA do backup;
 *   5. valida PRAGMA integrity_check + compara um fingerprint determinístico do
 *      conteúdo crítico (counts + hash das linhas) → exige RPO=0 p/ o commitado.
 *
 * Sai 0 só se o restore for bit-a-bit consistente. É o gate de DR do CI.
 *
 * Uso: node scripts/dr-restore-drill.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-dr-'));
const LIVE = path.join(WORK, 'live.db');
const SNAP = path.join(WORK, 'snapshot.db');
const ARCHIVE = SNAP + '.gz';

// Env de teste ANTES de requerer config/database.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = LIVE;
process.env.DATABASE_PATH = LIVE;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'abcdef0123456789abcdef0123456789abcdef0123';
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'abcdef0123456789abcdef';
process.env.REDIS_DISABLED = 'true';
process.env.BILLING_CRON_DISABLED = 'true';
process.env.EMAIL_OUTBOX_DISABLED = 'true';

function cleanup() {
  try {
    fs.rmSync(WORK, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
}
function fail(msg) {
  console.error(`\n❌ DR DRILL FALHOU: ${msg}\n`);
  cleanup();
  process.exit(1);
}
function ok(msg) {
  console.log(`   ✅ ${msg}`);
}

// Fingerprint determinístico do conteúdo crítico (counts + hash das linhas).
function fingerprint(db) {
  const tables = [
    'users',
    'workspaces',
    'contacts',
    'deals',
    'billing_invoices',
    'token_transactions',
  ];
  const h = crypto.createHash('sha256');
  const counts = {};
  for (const t of tables) {
    let rows = [];
    try {
      rows = db.prepare(`SELECT * FROM ${t} ORDER BY id`).all();
    } catch (_) {
      rows = [];
    }
    counts[t] = rows.length;
    h.update(t + ':' + JSON.stringify(rows));
  }
  return { hash: h.digest('hex'), counts };
}

(async () => {
  console.log('\n🛟 DR RESTORE DRILL (SQLite) — backup → desastre → restore → verifica\n');

  // 1) DB vivo: migrations reais + seed conhecido.
  const database = require('../src/utils/database');
  await database.runMigrations();
  // database.transaction(fn) executa a transação imediatamente.
  database.transaction(() => {
    database.run(
      `INSERT INTO users (id, email, password, status) VALUES ('dr-u1','dr1@example.com','x','active')`
    );
    database.run(
      `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status) VALUES ('dr-w1','DR WS','dr-u1','pro','active')`
    );
    database.run(
      `INSERT INTO contacts (id, workspace_id, phone, name) VALUES ('dr-c1','dr-w1','5511999990000','DR Contact')`
    );
    database.run(
      `INSERT INTO deals (id, workspace_id, contact_id, title, value) VALUES ('dr-d1','dr-w1','dr-c1','DR Deal',1234.5)`
    );
    database.run(
      `INSERT INTO billing_invoices (id, workspace_id, provider, provider_ref, plan, amount, currency, status)
       VALUES ('dr-i1','dr-w1','stripe','dr-ref','pro',99.9,'BRL','paid')`
    );
  });
  try {
    database.pragma('wal_checkpoint(TRUNCATE)');
  } catch (_) {
    /* WAL pode estar desabilitado */
  }
  const before = fingerprint(database.getDb());
  ok(`DB vivo semeado: ${JSON.stringify(before.counts)}`);

  // 2) BACKUP online (.backup) + gzip -9 (mesmo mecanismo do backup.sh).
  await database.getDb().backup(SNAP);
  database.close();
  fs.writeFileSync(ARCHIVE, zlib.gzipSync(fs.readFileSync(SNAP), { level: 9 }));
  fs.unlinkSync(SNAP);
  if (!fs.existsSync(ARCHIVE) || fs.statSync(ARCHIVE).size < 100) {
    fail('arquivo de backup ausente ou pequeno demais');
  }
  ok(`backup gerado e comprimido (${fs.statSync(ARCHIVE).size} bytes)`);

  // 3) DESASTRE: apaga o DB vivo (+ sidecars).
  for (const s of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(LIVE + s);
    } catch (_) {
      /* já não existe */
    }
  }
  if (fs.existsSync(LIVE)) fail('o DB vivo deveria estar destruído');
  ok('desastre simulado: DB vivo destruído');

  // 4) RESTORE: gunzip → caminho vivo.
  fs.writeFileSync(LIVE, zlib.gunzipSync(fs.readFileSync(ARCHIVE)));
  ok('backup restaurado para o caminho vivo');

  // 5) VERIFICA: integridade + fingerprint idêntico.
  const restored = new Database(LIVE, { readonly: true });
  const integrity = restored.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') {
    restored.close();
    fail(`integrity_check do DB restaurado: ${integrity}`);
  }
  ok('integrity_check: ok');
  const after = fingerprint(restored);
  restored.close();

  if (after.hash !== before.hash) {
    fail(
      `fingerprint divergente após restore\n  antes:  ${JSON.stringify(before.counts)}\n  depois: ${JSON.stringify(after.counts)}`
    );
  }
  ok(`fingerprint idêntico (RPO=0 p/ dados commitados): ${JSON.stringify(after.counts)}`);

  cleanup();
  console.log('\n✅ DR DRILL OK — backup restaurável e consistente.\n');
  process.exit(0);
})().catch((e) => fail(e && (e.stack || e.message)));
