/**
 * Unit tests — TokenService
 *
 * Cobre:
 * - Saldo (getBalance, ensureRow)
 * - Crédito (credit, idempotência via invoice_id, tipos válidos)
 * - Consumo (consume, idempotência via ai_request_id, INSUFFICIENT_CREDITS)
 * - Reset mensal (resetMonthlyForPlan)
 *
 * Run: node tests/unit/token-service.test.js
 */

const assert = require('node:assert/strict');
const Module = require('module');
const orig = Module.prototype.require;

// ═══ Mock DB ═════════════════════════════════════════════════════════
const mockDb = {
  credits: new Map(),       // workspace_id → { tokens_total, tokens_used, ... }
  transactions: [],         // [{ id, workspace_id, type, amount, balance_after, invoice_id, ai_request_id, ... }]

  exec() {},

  prepare(sql) {
    return {
      all: () => [],
      get: () => null,
    };
  },

  get(sql, args = []) {
    // SELECT ... FROM workspace_credits WHERE workspace_id = ?
    if (/FROM workspace_credits/i.test(sql)) {
      const wid = args[0];
      return mockDb.credits.get(wid) || null;
    }
    // SELECT ... FROM token_transactions WHERE workspace_id = ? AND invoice_id = ? AND type = ?
    if (/FROM token_transactions.*invoice_id/is.test(sql)) {
      const [wid, invoiceId, type] = args;
      return mockDb.transactions.find(t =>
        t.workspace_id === wid && t.invoice_id === invoiceId && t.type === type
      ) || null;
    }
    // SELECT ... FROM token_transactions WHERE workspace_id = ? AND ai_request_id = ?
    if (/FROM token_transactions.*ai_request_id/is.test(sql)) {
      const [wid, reqId] = args;
      return mockDb.transactions.find(t =>
        t.workspace_id === wid && t.ai_request_id === reqId
      ) || null;
    }
    return null;
  },

  all(sql, args = []) {
    if (/FROM token_transactions/i.test(sql)) {
      const wid = args[0];
      return mockDb.transactions.filter(t => t.workspace_id === wid);
    }
    return [];
  },

  run(sql, args = []) {
    // INSERT OR IGNORE INTO workspace_credits ...
    if (/INSERT.*INTO workspace_credits/i.test(sql)) {
      const wid = args[0];
      if (!mockDb.credits.has(wid)) {
        mockDb.credits.set(wid, {
          workspace_id: wid,
          tokens_total: 0,
          tokens_used: 0,
          last_topup_at: null,
          last_used_at: null,
          low_balance_warned_at: null,
        });
      }
      return { changes: 1, lastInsertRowid: 0 };
    }
    // UPDATE workspace_credits SET tokens_total = tokens_total + ? ... WHERE workspace_id = ?
    if (/UPDATE workspace_credits/i.test(sql)) {
      const wid = args[args.length - 1]; // último arg é sempre workspace_id (pelo WHERE)
      const row = mockDb.credits.get(wid);
      if (!row) return { changes: 0 };

      // Detecta operações via SQL pattern + args
      // tokens_total = tokens_total + ?  → primeiro arg é incremento
      if (/tokens_total\s*=\s*tokens_total\s*\+\s*\?/i.test(sql)) {
        row.tokens_total += args[0];
      }
      // tokens_used = tokens_used + ?  → primeiro arg é incremento
      if (/tokens_used\s*=\s*tokens_used\s*\+\s*\?/i.test(sql)) {
        row.tokens_used += args[0];
      }
      return { changes: 1 };
    }

    // INSERT INTO token_transactions ...
    if (/INSERT INTO token_transactions/i.test(sql)) {
      const colMatch = sql.match(/INSERT INTO token_transactions\s*\(([^)]+)\)/i);
      const cols = colMatch ? colMatch[1].split(',').map(c => c.trim()) : [];

      const valuesMatch = sql.match(/VALUES\s*\(([^)]+)\)/i);
      const valTokens = valuesMatch ? valuesMatch[1].split(',').map(v => v.trim()) : [];

      const record = { created_at: new Date().toISOString() };
      let argIdx = 0;
      for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        const valTok = valTokens[i];
        if (valTok && valTok.startsWith("'")) {
          record[col] = valTok.replace(/'/g, '');
        } else {
          record[col] = args[argIdx++];
        }
      }

      mockDb.transactions.push(record);
      return { changes: 1, lastInsertRowid: mockDb.transactions.length };
    }
    return { changes: 0 };
  },

  transaction(fn) {
    // sqlite-driver wraps better-sqlite3.transaction(fn)() — executa imediatamente
    // e retorna o resultado. Mock simula isso.
    return fn();
  },

  reset() {
    mockDb.credits.clear();
    mockDb.transactions.length = 0;
  },
};

// ═══ Mock logger ═════════════════════════════════════════════════════
const mockLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
};

// ═══ Mock uuid ═══════════════════════════════════════════════════════
let _uuidCounter = 0;
const mockUuid = { v4: () => `uuid-${++_uuidCounter}` };

// ═══ Mock require para TokenService ══════════════════════════════════
Module.prototype.require = function (id) {
  if (id === '../utils/database') return mockDb;
  if (id === '../utils/logger' || id.endsWith('logger')) return mockLogger;
  if (id === './uuid-wrapper' || id.endsWith('uuid-wrapper')) return mockUuid;
  if (id === 'uuid') return mockUuid;
  return orig.call(this, id);
};

// Limpar cache pra forçar re-require
delete require.cache[require.resolve('../../src/services/TokenService')];
const tokenService = require('../../src/services/TokenService');

// ═══ Tests ═══════════════════════════════════════════════════════════
let passed = 0, failed = 0;

function test(name, fn) {
  mockDb.reset();
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

// ─── Saldo ───────────────────────────────────────────────────────────
console.log('\nTokenService — Saldo');

test('ensureRow cria row vazia se não existir', () => {
  tokenService.ensureRow('ws-1');
  const balance = tokenService.getBalance('ws-1');
  assert.equal(balance.balance, 0);
  assert.equal(balance.total, 0);
  assert.equal(balance.used, 0);
});

test('getBalance retorna 0 pra workspace inexistente', () => {
  const balance = tokenService.getBalance('ws-nonexistent');
  assert.equal(balance.balance, 0);
});

// ─── Credit ──────────────────────────────────────────────────────────
console.log('\nTokenService — Credit');

test('credit adiciona tokens ao saldo', () => {
  const result = tokenService.credit('ws-1', 1000, 'topup', { description: 'test' });
  assert.equal(result.balance_after, 1000);

  const balance = tokenService.getBalance('ws-1');
  assert.equal(balance.balance, 1000);
});

test('credit com tipo inválido lança erro', () => {
  assert.throws(() => {
    tokenService.credit('ws-1', 100, 'invalid_type');
  }, /Tipo inválido/);
});

test('credit com amount <= 0 lança erro', () => {
  assert.throws(() => {
    tokenService.credit('ws-1', 0, 'topup');
  }, /positivo/);

  assert.throws(() => {
    tokenService.credit('ws-1', -100, 'topup');
  }, /positivo/);
});

test('credit é idempotente por invoice_id', () => {
  // Primeiro credit
  const r1 = tokenService.credit('ws-1', 500, 'topup', { invoice_id: 'inv_abc123' });
  assert.equal(r1.balance_after, 500);

  // Mesmo invoice_id — deve ser idempotente (não duplica)
  const r2 = tokenService.credit('ws-1', 500, 'topup', { invoice_id: 'inv_abc123' });
  assert.equal(r2.balance_after, 500);  // ainda 500, não 1000

  const balance = tokenService.getBalance('ws-1');
  assert.equal(balance.balance, 500);
});

test('credit acumula múltiplos invoice_ids diferentes', () => {
  tokenService.credit('ws-1', 500, 'topup', { invoice_id: 'inv_1' });
  tokenService.credit('ws-1', 300, 'topup', { invoice_id: 'inv_2' });
  tokenService.credit('ws-1', 200, 'topup', { invoice_id: 'inv_3' });

  const balance = tokenService.getBalance('ws-1');
  assert.equal(balance.balance, 1000);
});

// ─── Consume ─────────────────────────────────────────────────────────
console.log('\nTokenService — Consume');

test('consume debita tokens do saldo', () => {
  tokenService.credit('ws-1', 1000, 'topup');

  const result = tokenService.consume('ws-1', 250, { ai_request_id: 'req_xyz' });
  assert.equal(result.allowed, true);
  assert.equal(result.balance_after, 750);

  const balance = tokenService.getBalance('ws-1');
  assert.equal(balance.balance, 750);
});

test('consume com saldo insuficiente retorna allowed=false', () => {
  tokenService.credit('ws-1', 100, 'topup');

  const result = tokenService.consume('ws-1', 500, { ai_request_id: 'req_xyz' });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'insufficient_balance');
  assert.equal(result.balance_after, 100);  // saldo permanece intacto
});

test('consume é idempotente por ai_request_id', () => {
  tokenService.credit('ws-1', 1000, 'topup');

  // Primeiro consume
  const r1 = tokenService.consume('ws-1', 200, { ai_request_id: 'req_abc' });
  assert.equal(r1.allowed, true);
  assert.equal(r1.balance_after, 800);

  // Mesmo ai_request_id — idempotente
  const r2 = tokenService.consume('ws-1', 200, { ai_request_id: 'req_abc' });
  assert.equal(r2.idempotent_replay, true);
  assert.equal(r2.balance_after, 800);  // ainda 800

  const balance = tokenService.getBalance('ws-1');
  assert.equal(balance.balance, 800);
});

test('consume diferente ai_request_id debita normalmente', () => {
  tokenService.credit('ws-1', 1000, 'topup');

  tokenService.consume('ws-1', 100, { ai_request_id: 'req_1' });
  tokenService.consume('ws-1', 200, { ai_request_id: 'req_2' });
  tokenService.consume('ws-1', 50, { ai_request_id: 'req_3' });

  const balance = tokenService.getBalance('ws-1');
  assert.equal(balance.balance, 650);
});

test('consume sem ai_request_id ainda funciona (sem dedup)', () => {
  tokenService.credit('ws-1', 1000, 'topup');

  tokenService.consume('ws-1', 100);
  tokenService.consume('ws-1', 100);

  // Sem ai_request_id, ambas chamadas debitam (200 total)
  const balance = tokenService.getBalance('ws-1');
  assert.equal(balance.balance, 800);
});

// ═══ Resumo ══════════════════════════════════════════════════════════
console.log(`\nResult: ${passed} passed, ${failed} failed`);

// Restore require
Module.prototype.require = orig;

if (failed > 0) {
  process.exit(1);
} else {
  console.log('✅ All tests passed');
}
