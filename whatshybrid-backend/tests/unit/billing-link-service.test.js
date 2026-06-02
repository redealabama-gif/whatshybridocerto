/**
 * BillingLinkService — testes do CAMINHO DO DINHEIRO (geração de link de pagamento).
 *
 * Cobertura (o que protege receita/UX de cobrança):
 *   - idempotência: com intent 'pending' recente (<24h) e sem force, NÃO chama
 *     o MercadoPago de novo (evita link/cobrança duplicada) → recent_intent_exists
 *   - force=true ignora a idempotência e gera link novo
 *   - guardas: missing_workspace, mp_not_configured, plan_not_billable,
 *     no_owner_email, mp_call_failed
 *   - sucesso: payment_url, intent_id, INSERT em billing_intents e evento
 *     subscription.first_invoice_pending emitido
 *   - cupom pendente vira coupon_label E é repassado ao createPreference
 *   - sandbox usa sandbox_init_point
 *   - helper isRecentEnough (janela de 24h)
 *
 * Mock de DB/serviços via require.cache ANTES do require do serviço — roda com
 * `node` puro (sem banco/SDK), igual ao coupon-service.test.js.
 */

process.env.NODE_ENV = 'test';

let passed = 0, failed = 0;
function log(ok, name, msg = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}${msg ? ' — ' + msg : ''}`); }
  else { failed++; console.log(`  ✗ ${name}${msg ? ' — ' + msg : ''}`); }
}

// ─── Estado mockável (resetado entre cenários) ───────────────────────
let pendingIntentRow = null;     // o que getRecentPendingIntent acha
let ownerRow = null;             // o que SELECT users devolve
let insertedIntents = [];        // billing_intents inseridos
let mpConfigured = true;
let mpThrow = false;
let createPreferenceCalls = [];
let pendingCoupon = null;        // CouponService.getPendingCouponForWorkspace
let emittedEvents = [];

function reset() {
  pendingIntentRow = null; ownerRow = { email: 'dono@x.com', name: 'Dono' };
  insertedIntents = []; mpConfigured = true; mpThrow = false;
  createPreferenceCalls = []; pendingCoupon = null; emittedEvents = [];
  delete process.env.MERCADOPAGO_USE_SANDBOX;
}
reset();

// ─── Mocks via require.cache ──────────────────────────────────────────
function inject(relPath, exportsObj) {
  const p = require.resolve(relPath);
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

inject('../../src/utils/database', {
  get(sql) {
    if (/FROM\s+billing_intents/s.test(sql)) return pendingIntentRow;
    if (/FROM\s+users\s+WHERE\s+id/s.test(sql)) return ownerRow;
    return null;
  },
  run(sql, params) {
    if (/INSERT\s+INTO\s+billing_intents/s.test(sql)) {
      insertedIntents.push({ id: params[0], workspace_id: params[1], plan: params[2], provider_ref: params[3], metadata: params[4] });
    }
  },
});
inject('../../src/utils/logger', { info() {}, warn() {}, error() {}, debug() {} });
inject('../../src/services/MercadoPagoService', {
  isConfigured: () => mpConfigured,
  async createPreference(opts) {
    createPreferenceCalls.push(opts);
    if (mpThrow) throw new Error('mp boom');
    return { id: 'pref_abc', init_point: 'https://mp/checkout/prod', sandbox_init_point: 'https://mp/checkout/sandbox' };
  },
});
inject('../../src/services/CouponService', {
  getPendingCouponForWorkspace: () => pendingCoupon,
});
inject('../../src/utils/events', { emit: (name, payload) => emittedEvents.push({ name, payload }) });

const svc = require('../../src/services/BillingLinkService');

console.log('\n=== BillingLinkService (caminho do dinheiro) ===\n');

(async () => {
  // 1) guardas básicas
  reset();
  log((await svc.generatePaymentLink(null)).reason === 'missing_workspace', 'missing_workspace quando ws inválido');

  reset(); mpConfigured = false;
  log((await svc.generatePaymentLink({ id: 'w1', plan: 'pro' })).reason === 'mp_not_configured', 'mp_not_configured quando MP off');

  reset();
  log((await svc.generatePaymentLink({ id: 'w1', plan: 'free' })).reason === 'plan_not_billable', 'plan_not_billable para plano não-cobrável');

  // 2) IDEMPOTÊNCIA — intent pendente recente e sem force → não chama MP
  reset();
  pendingIntentRow = { id: 'intent_old', provider_ref: 'pref_old', created_at: new Date().toISOString() };
  const idem = await svc.generatePaymentLink({ id: 'w1', plan: 'pro', owner_id: 'u1' });
  log(idem.ok === false && idem.reason === 'recent_intent_exists', 'recent_intent_exists com intent <24h e sem force');
  log(idem.intent_id === 'intent_old', 'reusa o intent_id existente');
  log(createPreferenceCalls.length === 0, 'NÃO chama createPreference (evita cobrança duplicada)');

  // 3) force=true ignora a idempotência
  reset();
  pendingIntentRow = { id: 'intent_old', provider_ref: 'pref_old', created_at: new Date().toISOString() };
  const forced = await svc.generatePaymentLink({ id: 'w1', plan: 'pro', owner_id: 'u1' }, { email: 'dono@x.com', name: 'Dono' }, { force: true });
  log(forced.ok === true && createPreferenceCalls.length === 1, 'force=true gera link novo mesmo com intent recente');

  // 4) intent ANTIGO (>24h) não conta como recente → segue e gera
  reset();
  pendingIntentRow = { id: 'intent_velho', provider_ref: 'x', created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() };
  const oldOk = await svc.generatePaymentLink({ id: 'w1', plan: 'pro', owner_id: 'u1' });
  log(oldOk.ok === true, 'intent >24h não bloqueia (gera link)');

  // 5) sem e-mail do dono → no_owner_email
  reset(); ownerRow = null;
  const noEmail = await svc.generatePaymentLink({ id: 'w1', plan: 'pro', owner_id: 'u1' }, null);
  log(noEmail.reason === 'no_owner_email', 'no_owner_email quando não resolve e-mail');

  // 6) sucesso SEM cupom: url, intent, insert e evento
  reset();
  const ok = await svc.generatePaymentLink({ id: 'w1', plan: 'pro', owner_id: 'u1' }, { email: 'dono@x.com', name: 'Dono' });
  log(ok.ok === true && ok.payment_url === 'https://mp/checkout/prod', 'sucesso devolve payment_url (init_point)');
  log(typeof ok.intent_id === 'string' && ok.intent_id.length > 0, 'sucesso devolve intent_id');
  log(insertedIntents.length === 1 && insertedIntents[0].plan === 'pro', 'persiste billing_intent (status pending)');
  log(emittedEvents.some(e => e.name === 'subscription.first_invoice_pending'), 'emite subscription.first_invoice_pending');
  log(ok.coupon_label === undefined, 'sem cupom → coupon_label indefinido');

  // 7) sucesso COM cupom: label + repassa couponCode ao MP
  reset();
  pendingCoupon = { code: 'EXIT50', description: '50% OFF primeira fatura' };
  const okc = await svc.generatePaymentLink({ id: 'w1', plan: 'starter', owner_id: 'u1' }, { email: 'dono@x.com', name: 'Dono' });
  log(okc.coupon_label === '50% OFF primeira fatura', 'cupom pendente vira coupon_label');
  log(createPreferenceCalls[0] && createPreferenceCalls[0].couponCode === 'EXIT50', 'repassa couponCode ao createPreference');

  // 8) mp_call_failed quando createPreference estoura
  reset(); mpThrow = true;
  const boom = await svc.generatePaymentLink({ id: 'w1', plan: 'pro', owner_id: 'u1' }, { email: 'dono@x.com', name: 'Dono' });
  log(boom.ok === false && boom.reason === 'mp_call_failed', 'mp_call_failed quando MP estoura');

  // 9) sandbox usa sandbox_init_point
  reset(); process.env.MERCADOPAGO_USE_SANDBOX = 'true';
  const sb = await svc.generatePaymentLink({ id: 'w1', plan: 'pro', owner_id: 'u1' }, { email: 'dono@x.com', name: 'Dono' });
  log(sb.payment_url === 'https://mp/checkout/sandbox', 'sandbox usa sandbox_init_point');

  // 10) helper isRecentEnough (janela de 24h)
  log(svc.isRecentEnough(null) === false, 'isRecentEnough(null) = false');
  log(svc.isRecentEnough({ created_at: new Date().toISOString() }) === true, 'isRecentEnough(agora) = true');
  log(svc.isRecentEnough({ created_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() }) === false, 'isRecentEnough(>24h) = false');

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
