/**
 * Helper de testes de integração in-process.
 *
 * Monta um app Express mínimo com APENAS os routers sob teste + o errorHandler
 * real, contra um banco SQLite temporário com as migrations aplicadas. Não sobe
 * Redis, cron, socket.io nem o server.js inteiro — testes rápidos e isolados.
 *
 * IMPORTANTE: as env vars são definidas no topo deste módulo, ANTES de qualquer
 * require de config/database. Por isso o spec deve requerer este helper antes de
 * tocar em qualquer coisa do backend.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

// ── Env de teste (antes de config/database) ──────────────────────────────────
const TMP_DB = path.join(os.tmpdir(), `wh-itest-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = TMP_DB;
process.env.DATABASE_PATH = TMP_DB;
// Segredos que passam na validação do config (≥32/≥16 chars, sem substrings
// proibidas como 'secret'/'test'/'example'…).
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'abcdef0123456789abcdef0123456789abcdef0123';
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'abcdef0123456789abcdef';
process.env.REDIS_DISABLED = 'true';
process.env.EMAIL_OUTBOX_DISABLED = 'true';
process.env.BILLING_CRON_DISABLED = 'true';
// Sem rate limit nos testes (authLimiter default é 5/15min e estouraria 429
// em suites com várias tentativas de login/refresh).
process.env.AUTH_RATE_LIMIT_MAX = '100000';

const express = require('express');
const database = require('../../../src/utils/database');
const { errorHandler } = require('../../../src/middleware/errorHandler');

let migrated = false;

/** Aplica schema + migrations e inicializa o UUID wrapper (1× por processo). */
async function ensureDb() {
  if (migrated) return database;
  // server.js chama initUUID() no boot; como montamos só o router, fazemos aqui.
  // Sem isso, uuidv4() nas rotas lança "UUID module not initialized".
  await require('../../../src/utils/uuid-wrapper').initUUID();
  await database.runMigrations();
  migrated = true;
  return database;
}

/**
 * Monta um app de teste.
 * @param {Record<string, import('express').Router>} mounts - { '/api/v1/x': router }
 */
function buildApp(mounts) {
  const app = express();
  app.use(express.json());
  // Express confia no X-Forwarded-For só com trust proxy; em teste req.ip basta.
  for (const [base, router] of Object.entries(mounts)) {
    app.use(base, router);
  }
  app.use(errorHandler);
  return app;
}

/** Fecha a conexão e remove o arquivo de DB temporário (e sidecars WAL/SHM). */
function cleanupDb() {
  try {
    if (typeof database.close === 'function') database.close();
  } catch (_) {
    /* já fechado */
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(TMP_DB + suffix);
    } catch (_) {
      /* já não existe */
    }
  }
}

module.exports = { ensureDb, buildApp, cleanupDb, database, TMP_DB };
