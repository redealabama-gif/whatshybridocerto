/**
 * billingCron.processExpiredTrials — testes Fase 2 cobrança real
 *
 * Cobertura:
 *   - trial pago → vira 'active'
 *   - trial não pago + MP configurado → past_due + cria preference + emite evento
 *   - trial não pago + MP NÃO configurado → past_due sem link
 *   - trial não pago + já tem pending intent < 24h → past_due, NÃO cria 2º link (idempotência)
 *   - plano 'free' → past_due sem link (não cobra)
 *
 * Estratégia: mocks via require.cache pra db, MercadoPagoService,
 * CouponService, events, alertManager. Sem dependência de banco real.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(40);

let passed = 0, failed = 0;
function log(ok, name, msg = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}${msg ? ' — ' + msg : ''}`); }
  else { failed++; console.log(`  ✗ ${name}${msg ? ' — ' + msg : ''}`); }
}

// ─── State para mocks ──────────────────────────────────────────────
let workspaces = [];
let users = new Map();
let paidInvoicesByWs = new Set();      // workspace IDs com invoice paga
let pendingIntentsByWs = new Map();     // workspaceId → array {created_at}
let billingIntentsInserted = [];
let workspaceUpdates = [];              // capturas de UPDATEs
let emittedEvents = [];
let alertsSent = [];

// ─── Mocks ─────────────────────────────────────────────────────────
function mockDB() {
  return {
    all(sql, params) {
      if (/FROM\s+workspaces[\s\S]*subscription_status\s*=\s*'trialing'/.test(sql)) {
        return workspaces.filter(w => w.subscription_status === 'trialing');
      }
      return [];
    },
    get(sql, params) {
      if (/FROM\s+billing_invoices[\s\S]+status\s*=\s*'paid'/.test(sql)) {
        return paidInvoicesByWs.has(params[0]) ? { id: 'inv-' + params[0] } : null;
      }
      if (/FROM\s+billing_intents[\s\S]+status\s*=\s*'pending'/.test(sql)) {
        const arr = pendingIntentsByWs.get(params[0]) || [];
        if (arr.length === 0) return null;
        return arr[0]; // mais recente
      }
      if (/SELECT email,\s*name FROM users WHERE id/.test(sql)) {
        return users.get(params[0]) || null;
      }
      return null;
    },
    run(sql, params) {
      if (/UPDATE workspaces SET subscription_status\s*=\s*'active'/.test(sql)) {
        workspaceUpdates.push({ id: params[0], status: 'active' });
        return;
      }
      if (/UPDATE\s+workspaces[\s\S]*subscription_status\s*=\s*'past_due'/.test(sql)) {
        workspaceUpdates.push({ id: params[0], status: 'past_due' });
        return;
      }
      if (/INSERT INTO billing_intents/.test(sql)) {
        billingIntentsInserted.push({
          workspace_id: params[1], plan: params[2],
          provider_ref: params[3],
        });
        return;
      }
    },
  };
}

function mockMPService(configured, shouldThrow = false) {
  return {
    isConfigured: () => configured,
    PLAN_PRICES: { starter: 49.90, pro: 99.90, agency: 199.90 },
    createPreference: async ({ workspaceId, plan, couponCode }) => {
      if (shouldThrow) throw new Error('MP API down');
      return {
        id: 'pref-' + workspaceId,
        init_point: `https://mp.com/pay/${workspaceId}`,
        sandbox_init_point: `https://mp-sandbox.com/pay/${workspaceId}`,
      };
    },
  };
}

function mockCouponService() {
  return {
    getPendingCouponForWorkspace: (wsId, plan) => {
      if (wsId === 'ws-with-coupon') {
        return { code: 'EXIT50', description: '50% OFF no 1º mês' };
      }
      return null;
    },
  };
}

function mockEvents() {
  return {
    emit: (name, payload) => emittedEvents.push({ name, payload }),
  };
}

function mockAlertManager() {
  return {
    send: (level, title, details) => alertsSent.push({ level, title, details }),
  };
}

// Pré-cache de módulos npm que não estão instalados no sandbox. Usamos
// Module._cache direto pra evitar require.resolve() que falha pra deps
// não-instaladas. Aplica antes do primeiro setupModules.
function stubMissingDeps() {
  const Module = require('module');
  const stub = (name, exp) => {
    const fakePath = require('path').join(__dirname, '__fake_' + name);
    Module._cache[fakePath] = { id: fakePath, filename: fakePath, loaded: true, exports: exp };
    const origResolve = Module._resolveFilename;
    if (!stub._patched) {
      Module._resolveFilename = function (request, parent, ...rest) {
        if (stub._stubs[request]) return stub._stubs[request];
        return origResolve.call(this, request, parent, ...rest);
      };
      stub._patched = true;
      stub._stubs = {};
    }
    stub._stubs[name] = fakePath;
  };
  stub('node-cron', { schedule: () => ({ stop() {} }) });
}
stubMissingDeps();

// Util: prepara o ambiente do require pra um cenário específico
function setupModules({ mpConfigured = true, mpThrows = false } = {}) {
  // Limpa caches dos módulos que vamos mockar (pra cada teste rodar limpo)
  const paths = [
    '../../src/utils/database',
    '../../src/utils/logger',
    '../../src/utils/events',
    '../../src/services/MercadoPagoService',
    '../../src/services/CouponService',
    '../../src/observability/alertManager',
    '../../src/jobs/billingCron',
  ];
  for (const p of paths) {
    try { delete require.cache[require.resolve(p)]; } catch (_) {}
  }

  const dbPath = require.resolve('../../src/utils/database');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: mockDB() };

  const logPath = require.resolve('../../src/utils/logger');
  require.cache[logPath] = { id: logPath, filename: logPath, loaded: true,
    exports: { info(){}, warn(){}, error(){}, debug(){} } };

  const eventsPath = require.resolve('../../src/utils/events');
  require.cache[eventsPath] = { id: eventsPath, filename: eventsPath, loaded: true,
    exports: mockEvents() };

  const mpPath = require.resolve('../../src/services/MercadoPagoService');
  require.cache[mpPath] = { id: mpPath, filename: mpPath, loaded: true,
    exports: mockMPService(mpConfigured, mpThrows) };

  const couponPath = require.resolve('../../src/services/CouponService');
  require.cache[couponPath] = { id: couponPath, filename: couponPath, loaded: true,
    exports: mockCouponService() };

  const alertPath = require.resolve('../../src/observability/alertManager');
  require.cache[alertPath] = { id: alertPath, filename: alertPath, loaded: true,
    exports: mockAlertManager() };

  // Mock node-cron pra não escalonar nada
  try {
    const cronPath = require.resolve('node-cron');
    require.cache[cronPath] = { id: cronPath, filename: cronPath, loaded: true,
      exports: { schedule: () => ({ stop() {} }) } };
  } catch (_) {}

  return require('../../src/jobs/billingCron');
}

function resetState() {
  workspaces = [];
  users = new Map();
  paidInvoicesByWs = new Set();
  pendingIntentsByWs = new Map();
  billingIntentsInserted = [];
  workspaceUpdates = [];
  emittedEvents = [];
  alertsSent = [];
}

console.log('\n=== billingCron.processExpiredTrials (Fase 2) ===\n');

// ─── Cenário 1: trial pago vira active ─────────────────────────────
(async () => {
  resetState();
  const cron = setupModules();
  workspaces.push({
    id: 'ws-paid', name: 'Acme', plan: 'pro', owner_id: 'u1',
    subscription_status: 'trialing',
    trial_end_at: new Date(Date.now() - 86400000).toISOString(),
  });
  paidInvoicesByWs.add('ws-paid');
  users.set('u1', { email: 'a@a.com', name: 'Alice' });

  const r = await cron.processExpiredTrials();
  log(r.length === 1 && r[0].action === 'activated', 'paid trial → activated');
  log(workspaceUpdates.some(u => u.id === 'ws-paid' && u.status === 'active'),
      'paid trial → UPDATE status=active');
  log(billingIntentsInserted.length === 0, 'paid trial → no new intent');
  log(emittedEvents.length === 0, 'paid trial → no event emitted');

  // ─── Cenário 2: trial não pago + MP configurado + cupom ──────────
  resetState();
  const cron2 = setupModules({ mpConfigured: true });
  workspaces.push({
    id: 'ws-with-coupon', name: 'BetaCo', plan: 'pro', owner_id: 'u2',
    subscription_status: 'trialing',
    trial_end_at: new Date(Date.now() - 3600000).toISOString(),
  });
  users.set('u2', { email: 'b@b.com', name: 'Bob' });

  const r2 = await cron2.processExpiredTrials();
  log(r2.length === 1 && r2[0].action === 'past_due',
      'unpaid + MP ok → past_due');
  log(r2[0].payment_link_generated === true,
      'unpaid + MP ok → link generated flag');
  log(billingIntentsInserted.length === 1,
      'unpaid + MP ok → 1 billing_intent inserted');
  log(billingIntentsInserted[0].workspace_id === 'ws-with-coupon',
      'intent linked to correct workspace');
  log(emittedEvents.some(e => e.name === 'subscription.first_invoice_pending'),
      'event subscription.first_invoice_pending emitted');
  const ev = emittedEvents.find(e => e.name === 'subscription.first_invoice_pending');
  log(ev && ev.payload.coupon_label === '50% OFF no 1º mês',
      'event includes coupon_label from pending coupon');
  log(ev && typeof ev.payload.payment_url === 'string' && ev.payload.payment_url.includes('mp'),
      'event includes payment_url');
  log(alertsSent.some(a => a.title.includes('Trial expirado')),
      'alert sent to ops');

  // ─── Cenário 3: trial não pago + MP NÃO configurado ──────────────
  resetState();
  const cron3 = setupModules({ mpConfigured: false });
  workspaces.push({
    id: 'ws-no-mp', name: 'Gamma', plan: 'pro', owner_id: 'u3',
    subscription_status: 'trialing',
    trial_end_at: new Date(Date.now() - 86400000).toISOString(),
  });
  users.set('u3', { email: 'c@c.com', name: 'Cara' });

  const r3 = await cron3.processExpiredTrials();
  log(r3.length === 1 && r3[0].action === 'past_due',
      'unpaid + no MP → past_due');
  log(r3[0].payment_link_generated === false,
      'unpaid + no MP → no link generated');
  log(billingIntentsInserted.length === 0,
      'unpaid + no MP → no billing_intent inserted');
  log(!emittedEvents.some(e => e.name === 'subscription.first_invoice_pending'),
      'unpaid + no MP → no email event');

  // ─── Cenário 4: idempotência (já tem pending intent < 24h) ───────
  resetState();
  const cron4 = setupModules({ mpConfigured: true });
  workspaces.push({
    id: 'ws-already-intent', name: 'Delta', plan: 'starter', owner_id: 'u4',
    subscription_status: 'trialing',
    trial_end_at: new Date(Date.now() - 86400000).toISOString(),
  });
  users.set('u4', { email: 'd@d.com', name: 'Diana' });
  pendingIntentsByWs.set('ws-already-intent', [{
    id: 'intent-old', created_at: new Date(Date.now() - 3600000).toISOString(),
  }]);

  const r4 = await cron4.processExpiredTrials();
  log(r4.length === 1 && r4[0].action === 'past_due',
      'unpaid + recent intent → past_due');
  log(r4[0].payment_link_generated === false,
      'unpaid + recent intent → NO new link');
  log(billingIntentsInserted.length === 0,
      'unpaid + recent intent → no duplicate billing_intent');

  // ─── Cenário 5: intent antigo (>24h) → cria novo ─────────────────
  resetState();
  const cron5 = setupModules({ mpConfigured: true });
  workspaces.push({
    id: 'ws-old-intent', name: 'Epsilon', plan: 'starter', owner_id: 'u5',
    subscription_status: 'trialing',
    trial_end_at: new Date(Date.now() - 86400000).toISOString(),
  });
  users.set('u5', { email: 'e@e.com', name: 'Edu' });
  pendingIntentsByWs.set('ws-old-intent', [{
    id: 'intent-very-old', created_at: new Date(Date.now() - 48 * 3600000).toISOString(),
  }]);

  const r5 = await cron5.processExpiredTrials();
  log(r5[0].payment_link_generated === true,
      'unpaid + intent >24h → new link generated');
  log(billingIntentsInserted.length === 1,
      'unpaid + intent >24h → 1 new billing_intent');

  // ─── Cenário 6: plano 'free' → past_due sem link ─────────────────
  resetState();
  const cron6 = setupModules({ mpConfigured: true });
  workspaces.push({
    id: 'ws-free', name: 'Free Co', plan: 'free', owner_id: 'u6',
    subscription_status: 'trialing',
    trial_end_at: new Date(Date.now() - 86400000).toISOString(),
  });
  users.set('u6', { email: 'f@f.com', name: 'Fred' });

  const r6 = await cron6.processExpiredTrials();
  log(r6[0].action === 'past_due', 'free → past_due');
  log(r6[0].payment_link_generated === false,
      'free → no link (plan not billable)');
  log(billingIntentsInserted.length === 0, 'free → no billing_intent');

  // ─── Cenário 7: MP createPreference lança → cron NÃO trava ───────
  resetState();
  const cron7 = setupModules({ mpConfigured: true, mpThrows: true });
  workspaces.push({
    id: 'ws-mp-fails', name: 'Zeta', plan: 'pro', owner_id: 'u7',
    subscription_status: 'trialing',
    trial_end_at: new Date(Date.now() - 86400000).toISOString(),
  });
  users.set('u7', { email: 'z@z.com', name: 'Zeta' });

  const r7 = await cron7.processExpiredTrials();
  log(r7.length === 1, 'mp throws → cron continues, returns 1 result');
  log(r7[0].action === 'past_due', 'mp throws → workspace still goes past_due');
  log(r7[0].payment_link_generated === false, 'mp throws → no link');

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
