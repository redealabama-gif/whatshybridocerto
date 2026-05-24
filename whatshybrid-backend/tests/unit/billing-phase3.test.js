/**
 * Cobrança real — Fase 3 — testes unitários
 *
 * Cobertura:
 *   A. BillingLinkService.generatePaymentLink
 *      - happy path: gera intent + emite evento
 *      - force=false + recent intent → retorna recent_intent_exists
 *      - force=true + recent intent → gera novo intent
 *      - MP não configurado → mp_not_configured
 *      - plano free → plan_not_billable
 *      - MP throws → mp_call_failed
 *      - workspace sem owner email → no_owner_email
 *
 *   B. billingCron.processExpiredSubscriptions
 *      - workspace com preapproval ativo + due recente (<3d) → awaiting
 *      - workspace com preapproval + due >3d → past_due + link
 *      - workspace sem preapproval → past_due + link
 *      - cron retorna lista populada com payment_link_generated
 *
 *   C. MercadoPagoService.createPreapproval com cupom
 *      - first_invoice_only=1 → NÃO aplica (logs)
 *      - first_invoice_only=0 → aplica permanente
 *      - sem cupom → preço cheio
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(40);

let passed = 0, failed = 0;
function log(ok, name, msg = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}${msg ? ' — ' + msg : ''}`); }
  else { failed++; console.log(`  ✗ ${name}${msg ? ' — ' + msg : ''}`); }
}

// ─── Stub para deps NPM não instaladas no sandbox ───────────────────
function stubMissingDeps() {
  const Module = require('module');
  if (!stubMissingDeps._patched) {
    stubMissingDeps._stubs = {};
    const orig = Module._resolveFilename;
    Module._resolveFilename = function (request, parent, ...rest) {
      if (stubMissingDeps._stubs[request]) return stubMissingDeps._stubs[request];
      return orig.call(this, request, parent, ...rest);
    };
    stubMissingDeps._patched = true;
  }
  function reg(name, exp) {
    const fakePath = require('path').join(__dirname, '__fake_' + name);
    Module._cache[fakePath] = { id: fakePath, filename: fakePath, loaded: true, exports: exp };
    stubMissingDeps._stubs[name] = fakePath;
  }
  reg('node-cron', { schedule: () => ({ stop() {} }) });
  // axios é importado pelo MercadoPagoService — só usado em createPreapproval
  // (que vamos testar passando direto pelas etapas até axios). Stub básico
  // que retorna 200 com dados mínimos.
  reg('axios', {
    post: async (url, payload) => {
      // Captura o payload pra inspeção
      reg._lastPost = { url, payload };
      return {
        data: {
          id: 'mp-preapproval-123',
          init_point: 'https://mp.com/auth/preapproval-123',
          status: 'pending',
        },
      };
    },
    get: async () => ({ data: {} }),
  });
}
stubMissingDeps();

// ─── State para mocks ──────────────────────────────────────────────
let dbState;
function freshState() {
  dbState = {
    workspaces: new Map(),
    users: new Map(),
    pendingIntents: new Map(),  // wsId → [{id, created_at}]
    insertedIntents: [],
    insertedRedemptions: [],
    workspaceUpdates: [],
    emittedEvents: [],
    couponsAvailable: new Map(),
  };
}
freshState();

// ─── Mocks via require.cache ────────────────────────────────────────
function installMocks({ mpConfigured = true, mpThrows = false, mpThrowMessage = 'MP API down' } = {}) {
  const reset = (rel) => { try { delete require.cache[require.resolve(rel)]; } catch (_) {} };
  [
    '../../src/utils/database', '../../src/utils/logger', '../../src/utils/events',
    '../../src/services/MercadoPagoService', '../../src/services/CouponService',
    '../../src/services/BillingLinkService', '../../src/observability/alertManager',
    '../../src/jobs/billingCron',
  ].forEach(reset);

  const dbPath = require.resolve('../../src/utils/database');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
    get(sql, params) {
      if (/FROM\s+billing_intents[\s\S]+status\s*=\s*'pending'/.test(sql)) {
        const arr = dbState.pendingIntents.get(params[0]) || [];
        return arr[0] || null;
      }
      if (/FROM\s+users\s+WHERE\s+id/.test(sql)) {
        return dbState.users.get(params[0]) || null;
      }
      if (/FROM\s+workspaces\s+WHERE\s+id/.test(sql)) {
        return dbState.workspaces.get(params[0]) || null;
      }
      if (/FROM\s+coupons\s+WHERE\s+code/.test(sql)) {
        return dbState.couponsAvailable.get(params[0]) || null;
      }
      if (/FROM\s+billing_invoices/.test(sql)) {
        return null; // trials desse teste nunca têm invoice paga
      }
      return null;
    },
    all(sql, params) {
      if (/FROM\s+workspaces[\s\S]*subscription_status\s*=\s*'trialing'/.test(sql)) {
        return [...dbState.workspaces.values()].filter(w => w.subscription_status === 'trialing');
      }
      if (/FROM\s+workspaces[\s\S]*subscription_status\s*=\s*'active'/.test(sql)) {
        return [...dbState.workspaces.values()].filter(w =>
          w.subscription_status === 'active' &&
          w.next_billing_at &&
          new Date(w.next_billing_at) <= new Date(params[0])
        );
      }
      return [];
    },
    run(sql, params) {
      if (/UPDATE\s+workspaces[\s\S]*subscription_status\s*=\s*'past_due'/.test(sql)) {
        dbState.workspaceUpdates.push({ id: params[0], status: 'past_due' });
        const ws = dbState.workspaces.get(params[0]);
        if (ws) ws.subscription_status = 'past_due';
        return;
      }
      if (/INSERT\s+INTO\s+billing_intents/.test(sql)) {
        dbState.insertedIntents.push({
          id: params[0], workspace_id: params[1], plan: params[2],
          provider_ref: params[3], metadata: params[4],
        });
        return;
      }
    },
    transaction: (fn) => (...args) => fn(...args),
  }};

  const logPath = require.resolve('../../src/utils/logger');
  require.cache[logPath] = { id: logPath, filename: logPath, loaded: true,
    exports: { info(){}, warn(){}, error(){}, debug(){} } };

  const evPath = require.resolve('../../src/utils/events');
  require.cache[evPath] = { id: evPath, filename: evPath, loaded: true,
    exports: { emit: (name, payload) => dbState.emittedEvents.push({ name, payload }) } };

  // CouponService mockado: getPendingCouponForWorkspace responde de
  // acordo com workspaces.coupon_code; validate/previewDiscount
  // simulam o real.
  const couponPath = require.resolve('../../src/services/CouponService');
  require.cache[couponPath] = { id: couponPath, filename: couponPath, loaded: true, exports: {
    getPendingCouponForWorkspace: (wsId, plan) => {
      const ws = dbState.workspaces.get(wsId);
      if (!ws || !ws.coupon_code) return null;
      const c = dbState.couponsAvailable.get(ws.coupon_code);
      return c || null;
    },
    validate: (code, plan) => {
      const c = dbState.couponsAvailable.get(code);
      if (!c) return { valid: false, reason: 'not_found' };
      return { valid: true, coupon: c };
    },
    previewDiscount: (code, plan, amount) => {
      const c = dbState.couponsAvailable.get(code);
      if (!c) return { valid: false, reason: 'not_found' };
      const discount = c.kind === 'percent'
        ? Math.round(amount * c.value * 100) / 100
        : Math.min(c.value, amount);
      return {
        valid: true,
        code: c.code,
        kind: c.kind,
        label: c.description || c.code,
        firstInvoiceOnly: !!c.first_invoice_only,
        originalAmount: amount,
        discountAmount: discount,
        finalAmount: Math.max(0, Math.round((amount - discount) * 100) / 100),
      };
    },
  }};

  const mpPath = require.resolve('../../src/services/MercadoPagoService');
  require.cache[mpPath] = { id: mpPath, filename: mpPath, loaded: true, exports: {
    isConfigured: () => mpConfigured,
    PLAN_PRICES: { starter: 49.90, pro: 99.90, agency: 199.90 },
    createPreference: async (opts) => {
      if (mpThrows) throw new Error(mpThrowMessage);
      return {
        id: 'pref-' + opts.workspaceId,
        init_point: `https://mp.com/pay/${opts.workspaceId}`,
        sandbox_init_point: `https://mp-sandbox.com/pay/${opts.workspaceId}`,
      };
    },
  }};

  const alertPath = require.resolve('../../src/observability/alertManager');
  require.cache[alertPath] = { id: alertPath, filename: alertPath, loaded: true,
    exports: { send: () => {} } };
}

// ════════════════════════════════════════════════════════════════════
console.log('\n=== Fase 3: BillingLinkService.generatePaymentLink ===\n');

(async () => {

  // A.1 — happy path
  freshState();
  installMocks();
  dbState.workspaces.set('ws1', {
    id: 'ws1', plan: 'pro', owner_id: 'u1', subscription_status: 'past_due',
  });
  dbState.users.set('u1', { email: 'a@a.com', name: 'Alice' });
  let bls = require('../../src/services/BillingLinkService');
  let r = await bls.generatePaymentLink(
    dbState.workspaces.get('ws1'), null, { source: 'test' }
  );
  log(r.ok === true, 'happy: returns ok');
  log(typeof r.payment_url === 'string' && r.payment_url.includes('mp'),
      'happy: payment_url string');
  log(dbState.insertedIntents.length === 1, 'happy: 1 billing_intent inserted');
  log(JSON.parse(dbState.insertedIntents[0].metadata).source === 'test',
      'happy: metadata.source preserved');
  log(dbState.emittedEvents.some(e => e.name === 'subscription.first_invoice_pending'),
      'happy: emits event');

  // A.2 — force=false + recent intent → bloqueia
  freshState(); installMocks();
  dbState.workspaces.set('ws2', { id: 'ws2', plan: 'pro', owner_id: 'u2' });
  dbState.users.set('u2', { email: 'b@b.com', name: 'Bob' });
  dbState.pendingIntents.set('ws2', [{
    id: 'old-intent', created_at: new Date(Date.now() - 3600000).toISOString(),
  }]);
  bls = require('../../src/services/BillingLinkService');
  r = await bls.generatePaymentLink(dbState.workspaces.get('ws2'), null);
  log(r.ok === false && r.reason === 'recent_intent_exists',
      'force=false + recent intent → recent_intent_exists');
  log(r.intent_id === 'old-intent', 'reports existing intent_id');
  log(dbState.insertedIntents.length === 0, 'no new intent inserted');

  // A.3 — force=true → ignora recent intent
  freshState(); installMocks();
  dbState.workspaces.set('ws3', { id: 'ws3', plan: 'pro', owner_id: 'u3' });
  dbState.users.set('u3', { email: 'c@c.com', name: 'Cara' });
  dbState.pendingIntents.set('ws3', [{
    id: 'old', created_at: new Date(Date.now() - 60000).toISOString(),
  }]);
  bls = require('../../src/services/BillingLinkService');
  r = await bls.generatePaymentLink(dbState.workspaces.get('ws3'), null, { force: true });
  log(r.ok === true, 'force=true → bypasses idempotency');
  log(dbState.insertedIntents.length === 1, 'force=true → new intent inserted');

  // A.4 — MP not configured
  freshState(); installMocks({ mpConfigured: false });
  dbState.workspaces.set('ws4', { id: 'ws4', plan: 'pro', owner_id: 'u4' });
  bls = require('../../src/services/BillingLinkService');
  r = await bls.generatePaymentLink(dbState.workspaces.get('ws4'), null);
  log(r.ok === false && r.reason === 'mp_not_configured',
      'mp not configured → mp_not_configured');

  // A.5 — plano free
  freshState(); installMocks();
  dbState.workspaces.set('ws5', { id: 'ws5', plan: 'free', owner_id: 'u5' });
  bls = require('../../src/services/BillingLinkService');
  r = await bls.generatePaymentLink(dbState.workspaces.get('ws5'), null);
  log(r.ok === false && r.reason === 'plan_not_billable',
      'free plan → plan_not_billable');

  // A.6 — MP throws
  freshState(); installMocks({ mpThrows: true, mpThrowMessage: 'rate limited' });
  dbState.workspaces.set('ws6', { id: 'ws6', plan: 'pro', owner_id: 'u6' });
  dbState.users.set('u6', { email: 'e@e.com', name: 'Edu' });
  bls = require('../../src/services/BillingLinkService');
  r = await bls.generatePaymentLink(dbState.workspaces.get('ws6'), null);
  log(r.ok === false && r.reason === 'mp_call_failed',
      'MP throws → mp_call_failed');
  log(r.error === 'rate limited', 'mp_call_failed includes error string');

  // A.7 — no owner email
  freshState(); installMocks();
  dbState.workspaces.set('ws7', { id: 'ws7', plan: 'pro', owner_id: 'u7' });
  // intencionalmente: dbState.users NÃO seta u7
  bls = require('../../src/services/BillingLinkService');
  r = await bls.generatePaymentLink(dbState.workspaces.get('ws7'), null);
  log(r.ok === false && r.reason === 'no_owner_email',
      'no owner → no_owner_email');

  // A.8 — cupom pendente propaga coupon_label
  freshState(); installMocks();
  dbState.workspaces.set('ws8', { id: 'ws8', plan: 'pro', owner_id: 'u8', coupon_code: 'EXIT50' });
  dbState.users.set('u8', { email: 'f@f.com', name: 'Fred' });
  dbState.couponsAvailable.set('EXIT50', {
    code: 'EXIT50', kind: 'percent', value: 0.5, description: '50% OFF no 1º mês',
    active: 1, first_invoice_only: 1,
  });
  bls = require('../../src/services/BillingLinkService');
  r = await bls.generatePaymentLink(dbState.workspaces.get('ws8'), null);
  log(r.ok === true, 'with coupon → ok');
  log(r.coupon_label === '50% OFF no 1º mês',
      'with coupon → coupon_label propagated');
  const ev = dbState.emittedEvents.find(e => e.name === 'subscription.first_invoice_pending');
  log(ev && ev.payload.coupon_label === '50% OFF no 1º mês',
      'event payload includes coupon_label');

  // ════════════════════════════════════════════════════════════════════
  console.log('\n=== Fase 3: billingCron.processExpiredSubscriptions ===\n');

  // B.1 — workspace com preapproval + due <3d → awaiting (NÃO past_due)
  freshState(); installMocks();
  dbState.workspaces.set('ws-pa1', {
    id: 'ws-pa1', plan: 'pro', owner_id: 'u-pa1',
    subscription_status: 'active',
    next_billing_at: new Date(Date.now() - 86400000).toISOString(), // 1d atrasado
    mp_preapproval_id: 'mp-pre-1',
  });
  dbState.users.set('u-pa1', { email: 'pa1@x.com', name: 'PA1' });
  let cron = require('../../src/jobs/billingCron');
  let renewals = await cron.processExpiredSubscriptions();
  log(renewals.length === 1, 'preapproval+1d: 1 result');
  log(renewals[0].action === 'awaiting_preapproval_charge',
      'preapproval+1d: awaiting (não past_due)');
  log(!dbState.workspaceUpdates.some(u => u.id === 'ws-pa1' && u.status === 'past_due'),
      'preapproval+1d: NO past_due update');
  log(dbState.insertedIntents.length === 0,
      'preapproval+1d: no new intent');

  // B.2 — workspace com preapproval + due > 3d → past_due + link (MP fail)
  freshState(); installMocks();
  dbState.workspaces.set('ws-pa2', {
    id: 'ws-pa2', plan: 'pro', owner_id: 'u-pa2',
    subscription_status: 'active',
    next_billing_at: new Date(Date.now() - 5 * 86400000).toISOString(), // 5d atrasado
    mp_preapproval_id: 'mp-pre-2',
  });
  dbState.users.set('u-pa2', { email: 'pa2@x.com', name: 'PA2' });
  cron = require('../../src/jobs/billingCron');
  renewals = await cron.processExpiredSubscriptions();
  log(renewals[0].action === 'renewal_due',
      'preapproval+5d: renewal_due (MP falhou após grace)');
  log(renewals[0].payment_link_generated === true,
      'preapproval+5d: link generated');
  log(dbState.insertedIntents.length === 1, 'preapproval+5d: 1 intent inserted');

  // B.3 — workspace SEM preapproval → past_due + link
  freshState(); installMocks();
  dbState.workspaces.set('ws-no-pa', {
    id: 'ws-no-pa', plan: 'starter', owner_id: 'u-no-pa',
    subscription_status: 'active',
    next_billing_at: new Date(Date.now() - 3600000).toISOString(), // 1h atrasado
    mp_preapproval_id: null,
  });
  dbState.users.set('u-no-pa', { email: 'nopa@x.com', name: 'NoPA' });
  cron = require('../../src/jobs/billingCron');
  renewals = await cron.processExpiredSubscriptions();
  log(renewals[0].action === 'renewal_due',
      'no preapproval: renewal_due');
  log(renewals[0].payment_link_generated === true,
      'no preapproval: link generated');
  log(dbState.workspaceUpdates.some(u => u.id === 'ws-no-pa' && u.status === 'past_due'),
      'no preapproval: status → past_due');

  // ════════════════════════════════════════════════════════════════════
  console.log('\n=== Fase 3: MercadoPagoService.createPreapproval com cupom ===\n');

  // C.1 — cupom first_invoice_only=1 → NÃO aplica
  freshState();
  // Aqui vamos chamar o serviço REAL (não-mockado) para validar comportamento
  // Limpa caches relevantes e instala mocks pra CouponService + axios
  [
    '../../src/services/MercadoPagoService',
    '../../src/services/CouponService',
    '../../src/utils/logger',
  ].forEach(p => { try { delete require.cache[require.resolve(p)]; } catch (_) {} });
  process.env.MERCADOPAGO_ACCESS_TOKEN = 'test_token_xxxx';
  process.env.PUBLIC_BASE_URL = 'https://test.example.com';

  // Reinstala logger limpo
  const logPath = require.resolve('../../src/utils/logger');
  require.cache[logPath] = { id: logPath, filename: logPath, loaded: true,
    exports: { info(){}, warn(){}, error(){}, debug(){} } };

  // CouponService stub: retorna first_invoice_only=1
  const couponPath = require.resolve('../../src/services/CouponService');
  require.cache[couponPath] = { id: couponPath, filename: couponPath, loaded: true, exports: {
    previewDiscount: (code, plan, amount) => ({
      valid: true,
      code: 'EXIT50',
      kind: 'percent',
      label: '50% OFF no 1º mês',
      firstInvoiceOnly: true,
      originalAmount: amount,
      discountAmount: amount * 0.5,
      finalAmount: amount * 0.5,
    }),
  }};

  const mpReal = require('../../src/services/MercadoPagoService');
  const result1 = await mpReal.createPreapproval({
    workspaceId: 'ws-c1', plan: 'pro',
    email: 'c1@x.com', couponCode: 'EXIT50',
  });
  log(result1.coupon_applied === null,
      'first_invoice_only=1 → coupon_applied: null');

  // C.2 — cupom permanente (first_invoice_only=0) → aplica
  delete require.cache[require.resolve('../../src/services/MercadoPagoService')];
  delete require.cache[require.resolve('../../src/services/CouponService')];
  require.cache[couponPath] = { id: couponPath, filename: couponPath, loaded: true, exports: {
    previewDiscount: (code, plan, amount) => ({
      valid: true,
      code: 'AMIGO10',
      kind: 'percent',
      label: '10% OFF pra sempre',
      firstInvoiceOnly: false,
      originalAmount: amount,
      discountAmount: amount * 0.1,
      finalAmount: Math.round((amount * 0.9) * 100) / 100,
    }),
  }};
  const mpReal2 = require('../../src/services/MercadoPagoService');
  const result2 = await mpReal2.createPreapproval({
    workspaceId: 'ws-c2', plan: 'pro',
    email: 'c2@x.com', couponCode: 'AMIGO10',
  });
  log(result2.coupon_applied !== null,
      'first_invoice_only=0 → coupon_applied populated');
  log(result2.coupon_applied?.code === 'AMIGO10',
      'first_invoice_only=0 → code present');
  log(result2.coupon_applied?.monthlyAmount === 89.91,
      `first_invoice_only=0 → monthlyAmount 99.90*0.9=89.91 (got ${result2.coupon_applied?.monthlyAmount})`);

  // C.3 — sem cupom → preço cheio, coupon_applied null
  delete require.cache[require.resolve('../../src/services/MercadoPagoService')];
  const mpReal3 = require('../../src/services/MercadoPagoService');
  const result3 = await mpReal3.createPreapproval({
    workspaceId: 'ws-c3', plan: 'pro', email: 'c3@x.com',
  });
  log(result3.coupon_applied === null, 'no coupon → coupon_applied: null');

  // ────────────────────────────────────────────────────────────────────
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(err => {
  console.error('TEST RUN ERROR:', err);
  process.exit(2);
});
