/**
 * Unit tests — postgres-driver SQL adapter
 *
 * Cobre conversões críticas SQLite → Postgres:
 * - INSERT OR IGNORE → ON CONFLICT DO NOTHING
 * - INSERT OR REPLACE → ON CONFLICT DO UPDATE SET ... (excluindo key cols)
 * - PRIMARY KEY simples + UNIQUE composto
 * - Tabelas com mapping vs sem mapping (warning)
 *
 * Run: node tests/unit/postgres-driver.test.js
 */

const assert = require('node:assert/strict');
const Module = require('module');
const orig = Module.prototype.require;

const mockLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

Module.prototype.require = function (id) {
  if (id === 'uuid') return { v4: () => 'test-uuid' };
  if (id === '../logger' || id.endsWith('logger')) return mockLogger;
  if (id === 'pg') {
    // Driver Postgres só carrega quando initialize() é chamado
    throw new Error('pg not installed in tests');
  }
  return orig.call(this, id);
};

const { adaptSqliteSql } = require('../../src/utils/db/postgres-driver');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

console.log('\npostgres-driver — INSERT OR IGNORE');

test('billing_invoices (PK id) → ON CONFLICT (id) DO NOTHING', () => {
  const out = adaptSqliteSql(
    `INSERT OR IGNORE INTO billing_invoices (id, workspace_id, provider, amount, status) VALUES (?, ?, ?, ?, ?)`
  );
  assert.match(out, /ON CONFLICT \(id\) DO NOTHING/);
  assert.doesNotMatch(out, /OR IGNORE/, 'OR IGNORE deve ser removido');
});

test('email_drip_log (UNIQUE composto) → ON CONFLICT (user_id, campaign, step)', () => {
  const out = adaptSqliteSql(
    `INSERT OR IGNORE INTO email_drip_log (id, user_id, campaign, step) VALUES (?, ?, ?, ?)`
  );
  assert.match(out, /ON CONFLICT \(user_id, campaign, step\) DO NOTHING/);
});

test('webhook_inbox (provider, provider_event_id) → idempotência de webhooks', () => {
  const out = adaptSqliteSql(
    `INSERT OR IGNORE INTO webhook_inbox (id, provider, event_type, provider_event_id, signature) VALUES (?, ?, ?, ?, ?)`
  );
  assert.match(out, /ON CONFLICT \(provider, provider_event_id\) DO NOTHING/);
});

console.log('\npostgres-driver — INSERT OR REPLACE');

test('interaction_metadata → DO UPDATE SET ... (exceto interaction_id)', () => {
  const out = adaptSqliteSql(
    `INSERT OR REPLACE INTO interaction_metadata (interaction_id, model, prompt_tokens, completion_tokens) VALUES (?, ?, ?, ?)`
  );
  assert.match(out, /ON CONFLICT \(interaction_id\) DO UPDATE SET/);
  assert.match(out, /model = EXCLUDED\.model/);
  assert.match(out, /prompt_tokens = EXCLUDED\.prompt_tokens/);
  assert.match(out, /completion_tokens = EXCLUDED\.completion_tokens/);
  // A key NÃO deve aparecer no SET
  assert.doesNotMatch(out, /interaction_id = EXCLUDED\.interaction_id/);
});

test('analytics_daily_metrics (UNIQUE composto) → DO UPDATE', () => {
  const out = adaptSqliteSql(
    `INSERT OR REPLACE INTO analytics_daily_metrics (id, workspace_id, date, value) VALUES (?, ?, ?, ?)`
  );
  assert.match(out, /ON CONFLICT \(workspace_id, date\) DO UPDATE/);
  // workspace_id e date NÃO devem aparecer no SET (são as keys)
  assert.doesNotMatch(out, /workspace_id = EXCLUDED\.workspace_id/);
  assert.doesNotMatch(out, /date = EXCLUDED\.date/);
  // value DEVE aparecer
  assert.match(out, /value = EXCLUDED\.value/);
});

test('autopilot_sessions com várias colunas', () => {
  const out = adaptSqliteSql(
    `INSERT OR REPLACE INTO autopilot_sessions (id, user_id, status, config, stats, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  );
  assert.match(out, /ON CONFLICT \(id\) DO UPDATE/);
  assert.match(out, /user_id = EXCLUDED\.user_id/);
  assert.match(out, /status = EXCLUDED\.status/);
});

console.log('\npostgres-driver — Edge cases');

test('Tabela sem mapping → warning visível em SQL', () => {
  const out = adaptSqliteSql(
    `INSERT OR IGNORE INTO unknown_legacy_table (a, b) VALUES (?, ?)`
  );
  assert.match(out, /WARN: INSERT OR IGNORE sem mapping/);
});

test('INSERT comum (sem OR IGNORE/REPLACE) não é modificado', () => {
  const sql = `INSERT INTO foo (a, b) VALUES (?, ?)`;
  const out = adaptSqliteSql(sql);
  assert.doesNotMatch(out, /ON CONFLICT/);
  assert.equal(out.trim(), sql.trim());
});

test('SELECT/UPDATE/DELETE não afetados', () => {
  const sqls = [
    `SELECT * FROM workspaces`,
    `UPDATE workspaces SET name = ? WHERE id = ?`,
    `DELETE FROM sessions WHERE expires_at < datetime('now')`,
  ];
  for (const sql of sqls) {
    const out = adaptSqliteSql(sql);
    assert.doesNotMatch(out, /ON CONFLICT/);
  }
});

test('datetime("now") → NOW() (regression check pra outras transformações)', () => {
  const out = adaptSqliteSql(
    `INSERT OR REPLACE INTO products (id, name, updated_at) VALUES (?, ?, datetime('now'))`
  );
  assert.match(out, /NOW\(\)/);
  assert.match(out, /ON CONFLICT/);
  assert.doesNotMatch(out, /datetime/);
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
Module.prototype.require = orig;

if (failed > 0) process.exit(1);
else { console.log('✅ All tests passed'); process.exit(0); }
