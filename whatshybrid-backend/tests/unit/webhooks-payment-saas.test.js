/**
 * Webhook SaaS (ativação de assinatura) — testes do CAMINHO DO DINHEIRO:
 * confirmação de pagamento virando acesso. Cobre activateWorkspaceSubscription
 * (exportada) + a guarda pura validatePaymentAmount.
 *
 * Invariantes protegidas (o que separa "pagou" de "tem acesso"):
 *   - ANTI-UNDERPAYMENT: amount fora da faixa do plano NÃO ativa (rejected) e
 *     dispara alerta. Sem isso, ativar 'pro' por R$ 0,01 seria possível.
 *   - IDEMPOTÊNCIA: payment_id já com invoice → { duplicate:true }; não reativa,
 *     não cria 2ª invoice, não re-registra cupom (webhook do MP é re-entregue).
 *   - ATIVAÇÃO: workspace vira plan/active + invoice 'paid' + intent completed.
 *   - next_billing_at CUMULATIVO: estende do ciclo futuro (não "desliza" pra
 *     now+30 quando webhook atrasa); recomeça de now se o ciclo já venceu.
 *   - CUPOM ONCE-ONLY: redenção 'paid' só quando há cupom pendente e
 *     coupon_first_invoice_used_at ainda não setado; desconto = cheio - pago.
 *   - ESTORNO/CHARGEBACK: refunded/charged_back de pagamento já aprovado REVOGA
 *     acesso (workspace → cancelled, auto_renew off, tokens zerados, auditoria),
 *     espelhando o handler do Stripe; idempotente se a invoice já está refunded.
 *
 * Mock de DB/serviços via require.cache ANTES do require do módulo — roda com
 * `node` puro (sem banco/SDK), igual ao billing-link-service.test.js.
 */

process.env.NODE_ENV = 'test';

let passed = 0, failed = 0;
function log(ok, name, msg = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}${msg ? ' — ' + msg : ''}`); }
  else { failed++; console.log(`  ✗ ${name}${msg ? ' — ' + msg : ''}`); }
}

// ─── 'express' é dep de node_modules e PODE não estar instalada no job
// zero-dep (static-checks roda sem `npm ci`). require.cache só funciona com
// caminho resolvido — e require.resolve('express') estoura sem node_modules.
// Então interceptamos só o specifier 'express' no loader, devolvendo um router
// stub (.post/.get no-op). Os demais são arquivos do repo (resolvíveis sem
// deps) e usam require.cache normalmente. ──────────────────────────────────
const Module = require('module');
const _origLoad = Module._load;
const routerStub = { post() {}, get() {}, put() {}, delete() {}, use() {} };
const expressStub = () => routerStub;
expressStub.Router = () => routerStub;
Module._load = function (request, ...rest) {
  if (request === 'express') return expressStub;
  return _origLoad.call(this, request, ...rest);
};

// ─── Estado mockável (resetado entre cenários) ───────────────────────
const state = {};
function reset() {
  state.invoiceByRef = null;          // idempotência: truthy → já processado
  state.workspaceRow = null;          // next_billing_at + coupon_*
  state.subscriptionCodeRow = null;   // código existente (null → gera novo)
  state.couponValidateResult = { valid: true, coupon: { code: 'EXIT50' } };
  // capturas:
  state.workspaceUpdates = [];        // params de UPDATE workspaces
  state.invoiceInserts = [];          // params de INSERT billing_invoices
  state.intentUpdates = [];           // params de UPDATE billing_intents
  state.codeInserts = [];             // params de INSERT subscription_codes
  state.codeUpdates = [];             // params de UPDATE subscription_codes
  state.redemptions = [];             // CouponService.recordRedemption args
  state.alerts = [];                  // alertManager.send args
  state.events = [];                  // events.emit args
  // estorno/chargeback:
  state.workspaceCancelled = [];      // UPDATE workspaces ... subscription_status='cancelled'
  state.invoiceUpdates = [];          // UPDATE billing_invoices (marca refunded)
  state.creditUpdates = [];           // UPDATE workspace_credits (zera tokens)
  state.tokenTxns = [];               // INSERT token_transactions (auditoria)
}
reset();

// ─── Mocks via require.cache ──────────────────────────────────────────
function inject(relPath, exportsObj) {
  const p = require.resolve(relPath);
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

let uuidCounter = 0;

inject('../../src/utils/database', {
  get(sql) {
    if (/FROM\s+billing_invoices/i.test(sql)) return state.invoiceByRef;
    if (/FROM\s+workspaces/i.test(sql)) return state.workspaceRow;
    // ensureSubscriptionCode: lookup do código existente (por workspace)
    if (/FROM\s+subscription_codes/i.test(sql) && /workspace_id/i.test(sql)) return state.subscriptionCodeRow;
    // ensureSubscriptionCode: checagem de colisão (por code) → sem colisão
    if (/FROM\s+subscription_codes/i.test(sql)) return null;
    return null;
  },
  run(sql, params) {
    if (/UPDATE\s+workspaces/i.test(sql)) {
      state.workspaceUpdates.push(params);
      if (/subscription_status\s*=\s*'cancelled'/i.test(sql)) state.workspaceCancelled.push(params);
    }
    else if (/UPDATE\s+billing_intents/i.test(sql)) state.intentUpdates.push(params);
    else if (/UPDATE\s+billing_invoices/i.test(sql)) state.invoiceUpdates.push(params);
    else if (/INSERT\s+INTO\s+billing_invoices/i.test(sql)) state.invoiceInserts.push(params);
    else if (/UPDATE\s+workspace_credits/i.test(sql)) state.creditUpdates.push(params);
    else if (/INSERT\s+INTO\s+token_transactions/i.test(sql)) state.tokenTxns.push(params);
    else if (/INSERT\s+INTO\s+subscription_codes/i.test(sql)) state.codeInserts.push(params);
    else if (/UPDATE\s+subscription_codes/i.test(sql)) state.codeUpdates.push(params);
  },
  // sqlite-driver: transaction(fn) executa fn na hora e devolve o retorno
  transaction(fn) { return fn(); },
});
inject('../../src/utils/logger', { info() {}, warn() {}, error() {}, debug() {} });
inject('../../src/middleware/errorHandler', { asyncHandler: (fn) => fn });
inject('../../src/middleware/auth', {
  authenticate: (req, res, next) => next && next(),
  authorize: () => (req, res, next) => next && next(),
});
inject('../../src/utils/uuid-wrapper', {
  v4: () => `uuid-${++uuidCounter}`,
  uuidv4: () => `uuid-${uuidCounter}`,
});
inject('../../src/services/MercadoPagoService', { PLAN_PRICES: { starter: 49.9, pro: 99.9 } });
inject('../../src/observability/alertManager', {
  send: (level, title, meta) => state.alerts.push({ level, title, meta }),
});
inject('../../src/services/CouponService', {
  validate: () => state.couponValidateResult,
  recordRedemption: (o) => state.redemptions.push(o),
});
inject('../../src/services/MetaCapiService', { async sendSubscribeForWorkspace() {} });
inject('../../src/services/GoogleAnalyticsMpService', { async sendPurchaseForWorkspace() {} });
inject('../../src/utils/events', { emit: (name, payload) => state.events.push({ name, payload }) });

const wh = require('../../src/routes/webhooks-payment-saas');
const { activateWorkspaceSubscription, validatePaymentAmount, revokeWorkspaceForRefund } = wh;

// dias entre agora e um ISO (arredondado p/ absorver drift de ms/setDate)
function daysFromNow(iso) {
  return Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
}

console.log('\n=== Webhook SaaS — ativação + idempotência (caminho do dinheiro) ===\n');

(async () => {
  // ─── A) validatePaymentAmount: guarda anti-underpayment (pura) ───────
  log(validatePaymentAmount('starter', 24.95).valid === true, 'starter dentro da faixa (24,95) → válido');
  log(validatePaymentAmount('starter', 12).valid === true, 'starter no piso (12) → válido');
  log(validatePaymentAmount('starter', 60).valid === true, 'starter no teto (60) → válido');
  log(validatePaymentAmount('starter', 11.99).valid === false, 'starter abaixo do piso → inválido');
  log(validatePaymentAmount('starter', 60.01).valid === false, 'starter acima do teto → inválido');
  const under = validatePaymentAmount('pro', 1);
  log(under.valid === false && typeof under.reason === 'string' && under.reason.length > 0, 'pro subpago → inválido COM reason');
  log(validatePaymentAmount('pro', 99.9).valid === true, 'pro cheio (99,90) → válido');
  log(validatePaymentAmount('pro', 0.01, 'USD').valid === true, 'moeda != BRL → validação pulada (válido)');
  log(validatePaymentAmount('agency', 1).valid === true, 'plano não mapeado → não bloqueia (válido, só alerta)');

  // ─── B) ativação REJEITA subpagamento (não ativa, não fatura, alerta) ─
  reset();
  const rej = await activateWorkspaceSubscription({ workspaceId: 'w1', plan: 'starter', paymentId: 'pay_low', amount: 1, currency: 'BRL' });
  log(rej.rejected === true, 'subpagamento → { rejected:true }');
  log(state.workspaceUpdates.length === 0, 'subpagamento NÃO atualiza workspace');
  log(state.invoiceInserts.length === 0, 'subpagamento NÃO cria invoice');
  log(state.alerts.some(a => a.level === 'warning'), 'subpagamento dispara alerta warning');

  reset();
  const over = await activateWorkspaceSubscription({ workspaceId: 'w1', plan: 'starter', paymentId: 'pay_hi', amount: 9999, currency: 'BRL' });
  log(over.rejected === true && state.workspaceUpdates.length === 0, 'sobrepagamento → rejeitado, não ativa');

  reset();
  state.workspaceRow = { next_billing_at: null, coupon_code: null };
  const usd = await activateWorkspaceSubscription({ workspaceId: 'w1', plan: 'starter', paymentId: 'pay_usd', amount: 1, currency: 'USD' });
  log(usd.activated === true, 'moeda != BRL ativa (faixa pulada — não há conversão pra validar)');

  // ─── C) IDEMPOTÊNCIA: invoice já existe p/ esse payment_id ────────────
  reset();
  state.invoiceByRef = { id: 'inv_existing' };
  const dup = await activateWorkspaceSubscription({ workspaceId: 'w1', plan: 'pro', paymentId: 'pay_dup', amount: 99.9 });
  log(dup.duplicate === true, 'pagamento já processado → { duplicate:true }');
  log(state.workspaceUpdates.length === 0, 'duplicado NÃO reativa workspace');
  log(state.invoiceInserts.length === 0, 'duplicado NÃO cria 2ª invoice');
  log(state.redemptions.length === 0, 'duplicado NÃO re-registra cupom');

  // ─── D) ATIVAÇÃO feliz: workspace + invoice + intent + código + evento ─
  reset();
  state.workspaceRow = { next_billing_at: null, coupon_code: null };
  const act = await activateWorkspaceSubscription({ workspaceId: 'w1', plan: 'pro', paymentId: 'pay_ok', amount: 99.9, currency: 'BRL' });
  log(act.activated === true, 'pagamento válido → { activated:true }');
  log(state.workspaceUpdates.length === 1 && state.workspaceUpdates[0][0] === 'pro', 'ativa workspace c/ plan=pro');
  log(state.intentUpdates.length === 1, 'marca billing_intent como completed');
  log(state.invoiceInserts.length === 1, 'cria 1 invoice');
  const inv = state.invoiceInserts[0];
  log(inv[2] === 'pro' && inv[4] === 99.9 && inv[5] === 'BRL', 'invoice c/ plan/amount/currency corretos');
  log(typeof act.subscription_code === 'string' && /^WHL-/.test(act.subscription_code), 'devolve subscription_code WHL-…');
  log(state.codeInserts.length === 1, 'gera código de assinatura novo (INSERT)');
  log(state.events.some(e => e.name === 'subscription.activated'), 'emite subscription.activated (e-mail transacional)');

  // ─── E) next_billing_at CUMULATIVO ───────────────────────────────────
  reset();
  state.workspaceRow = { next_billing_at: null, coupon_code: null };
  await activateWorkspaceSubscription({ workspaceId: 'w1', plan: 'pro', paymentId: 'pay_nb1', amount: 99.9 });
  log(Math.abs(daysFromNow(state.workspaceUpdates[0][1]) - 30) <= 1, 'sem ciclo atual → próxima cobrança ~30d');

  reset();
  state.workspaceRow = { next_billing_at: new Date(Date.now() + 60 * 86400000).toISOString(), coupon_code: null };
  await activateWorkspaceSubscription({ workspaceId: 'w1', plan: 'pro', paymentId: 'pay_nb2', amount: 99.9 });
  log(Math.abs(daysFromNow(state.workspaceUpdates[0][1]) - 90) <= 1, 'ciclo futuro → estende (base+30 ≈ 90d), não desliza p/ now+30');

  reset();
  state.workspaceRow = { next_billing_at: new Date(Date.now() - 10 * 86400000).toISOString(), coupon_code: null };
  await activateWorkspaceSubscription({ workspaceId: 'w1', plan: 'pro', paymentId: 'pay_nb3', amount: 99.9 });
  log(Math.abs(daysFromNow(state.workspaceUpdates[0][1]) - 30) <= 1, 'ciclo vencido → recomeça de now (~30d)');

  // ─── F) CUPOM once-only ───────────────────────────────────────────────
  reset();
  state.workspaceRow = { next_billing_at: null, coupon_code: 'EXIT50', coupon_first_invoice_used_at: null };
  state.couponValidateResult = { valid: true, coupon: { code: 'EXIT50' } };
  await activateWorkspaceSubscription({ workspaceId: 'w1', plan: 'pro', paymentId: 'pay_cup', amount: 49.95 });
  log(state.redemptions.length === 1, 'cupom pendente → 1 redenção registrada');
  const red = state.redemptions[0] || {};
  log(red.status === 'paid', 'redenção marcada como paid');
  log(red.originalAmount === 99.9 && red.finalAmount === 49.95 && red.discountAmount === 49.95, 'desconto = cheio - pago (99,90 - 49,95 = 49,95)');
  log(red.invoiceId === state.invoiceInserts[0][0], 'redenção referencia a invoice criada nesta ativação');

  reset();
  state.workspaceRow = { next_billing_at: null, coupon_code: 'EXIT50', coupon_first_invoice_used_at: '2026-01-01T00:00:00.000Z' };
  await activateWorkspaceSubscription({ workspaceId: 'w1', plan: 'pro', paymentId: 'pay_cup2', amount: 49.95 });
  log(state.redemptions.length === 0, 'cupom já usado (first_invoice setado) → NÃO re-registra (once-only)');

  reset();
  state.workspaceRow = { next_billing_at: null, coupon_code: null };
  await activateWorkspaceSubscription({ workspaceId: 'w1', plan: 'pro', paymentId: 'pay_nocup', amount: 99.9 });
  log(state.redemptions.length === 0, 'sem cupom → nenhuma redenção');

  reset();
  state.workspaceRow = { next_billing_at: null, coupon_code: 'BADCODE', coupon_first_invoice_used_at: null };
  state.couponValidateResult = { valid: false };
  await activateWorkspaceSubscription({ workspaceId: 'w1', plan: 'pro', paymentId: 'pay_badcup', amount: 99.9 });
  log(state.redemptions.length === 0, 'cupom inválido → nenhuma redenção');

  // ─── G) ESTORNO / CHARGEBACK → revoga acesso (espelha o Stripe) ───────
  reset();
  state.invoiceByRef = { id: 'inv1', workspace_id: 'w1', status: 'paid' };
  const ref1 = revokeWorkspaceForRefund('pay_ref', 'refunded');
  log(ref1.revoked === true && ref1.workspace_id === 'w1', 'refund → { revoked, workspace_id }');
  log(state.workspaceCancelled.length === 1 && state.workspaceCancelled[0][0] === 'w1', 'refund suspende workspace (subscription_status=cancelled)');
  log(state.invoiceUpdates.length === 1, 'refund marca invoice como refunded');
  log(state.creditUpdates.length === 1 && state.creditUpdates[0][0] === 'w1', 'refund zera saldo de tokens (workspace_credits)');
  log(state.tokenTxns.length === 1, 'refund grava auditoria em token_transactions');
  log(state.alerts.some(a => a.level === 'warning' && /Refund/.test(a.title)), 'refund dispara alerta warning (Refund)');

  reset();
  state.invoiceByRef = { id: 'inv2', workspace_id: 'w2', status: 'paid' };
  const cb = revokeWorkspaceForRefund('pay_cb', 'charged_back');
  log(cb.revoked === true && state.workspaceCancelled.length === 1, 'chargeback → revoga acesso (suspende workspace)');
  log(state.creditUpdates.length === 1, 'chargeback zera tokens');
  log(state.alerts.some(a => /Chargeback/.test(a.title)), 'chargeback dispara alerta (Chargeback)');

  // idempotência: invoice já refunded (webhook re-entregue) → não re-revoga
  reset();
  state.invoiceByRef = { id: 'inv3', workspace_id: 'w3', status: 'refunded' };
  const dupRef = revokeWorkspaceForRefund('pay_ref2', 'refunded');
  log(dupRef.duplicate === true, 'invoice já refunded → { duplicate:true }');
  log(state.workspaceCancelled.length === 0, 'duplicado NÃO re-suspende workspace');
  log(state.creditUpdates.length === 0, 'duplicado NÃO re-zera tokens');
  log(state.tokenTxns.length === 0, 'duplicado NÃO duplica auditoria');

  // invoice inexistente → skip (nada a revogar)
  reset();
  state.invoiceByRef = null;
  const noInv = revokeWorkspaceForRefund('pay_unknown', 'refunded');
  log(noInv.skipped === true, 'invoice inexistente → { skipped:true }');
  log(state.workspaceCancelled.length === 0 && state.creditUpdates.length === 0, 'sem invoice → não toca workspace/tokens');

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
