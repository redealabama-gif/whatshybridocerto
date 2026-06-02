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
 *   - HANDLER HTTP (handleMercadoPagoWebhook): assinatura inválida → 401 (porta
 *     de entrada), inbox/idempotência, e dispatch por tipo — preapproval
 *     (authorized/cancelled), subscription_authorized_payment (approved→ativa /
 *     rejected→past_due), payment avulso (plano, refund→revoga, tokenpkg).
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
  // handler HTTP (assinatura + dispatch):
  state.signatureValid = true;        // mpService.validateWebhookSignature
  state.preapprovalResult = null;     // mpService.getPreapproval
  state.authPaymentResult = null;     // mpService.getAuthorizedPayment
  state.paymentResult = null;         // mpService.getPayment
  state.tokenTxnExisting = null;      // idempotência tokenpkg (SELECT token_transactions)
  state.inboxOps = [];                // webhook_inbox INSERT/UPDATE
  state.workspaceCanceling = [];      // UPDATE ... subscription_status='canceling'
  state.workspacePastDue = [];        // UPDATE ... subscription_status='past_due'
  state.tokenCredits = [];            // TokenService.credit
  state.tokenResets = [];             // TokenService.resetMonthlyForPlan
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
    if (/FROM\s+token_transactions/i.test(sql)) return state.tokenTxnExisting;
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
      if (/subscription_status\s*=\s*'canceling'/i.test(sql)) state.workspaceCanceling.push(params);
      if (/subscription_status\s*=\s*'past_due'/i.test(sql)) state.workspacePastDue.push(params);
    }
    else if (/UPDATE\s+billing_intents/i.test(sql)) state.intentUpdates.push(params);
    else if (/UPDATE\s+billing_invoices/i.test(sql)) state.invoiceUpdates.push(params);
    else if (/INSERT\s+INTO\s+billing_invoices/i.test(sql)) state.invoiceInserts.push(params);
    else if (/UPDATE\s+workspace_credits/i.test(sql)) state.creditUpdates.push(params);
    else if (/INSERT\s+INTO\s+token_transactions/i.test(sql)) state.tokenTxns.push(params);
    else if (/INSERT\s+INTO\s+subscription_codes/i.test(sql)) state.codeInserts.push(params);
    else if (/UPDATE\s+subscription_codes/i.test(sql)) state.codeUpdates.push(params);
    else if (/INSERT\s+INTO\s+webhook_inbox/i.test(sql)) state.inboxOps.push({ op: 'insert' });
    else if (/UPDATE\s+webhook_inbox/i.test(sql)) {
      const m = sql.match(/status\s*=\s*'(\w+)'/);
      state.inboxOps.push({ op: 'update', status: m ? m[1] : null });
    }
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
inject('../../src/services/MercadoPagoService', {
  PLAN_PRICES: { starter: 49.9, pro: 99.9 },
  validateWebhookSignature: () => state.signatureValid,
  getPreapproval: async () => state.preapprovalResult,
  getAuthorizedPayment: async () => state.authPaymentResult,
  getPayment: async () => state.paymentResult,
});
inject('../../src/services/TokenService', {
  TOKEN_PACKAGES: { pkg_small: { tokens: 10000 } },
  credit: (...args) => state.tokenCredits.push(args),
  resetMonthlyForPlan: (...args) => state.tokenResets.push(args),
});
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
const { activateWorkspaceSubscription, validatePaymentAmount, revokeWorkspaceForRefund, handleMercadoPagoWebhook } = wh;

// req/res mínimos p/ exercitar o handler HTTP direto (sem express)
function mkReq({ type, id } = {}) {
  return { headers: {}, query: {}, body: { type, data: id ? { id } : undefined } };
}
function mkRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
}

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

  // ─── H) HANDLER HTTP — assinatura + dispatch por tipo de evento ───────
  // H1 — assinatura inválida → 401 e nada é processado (porta de entrada)
  reset();
  state.signatureValid = false;
  const r1 = mkRes();
  await handleMercadoPagoWebhook(mkReq({ type: 'payment', id: 'p1' }), r1);
  log(r1.statusCode === 401, 'assinatura inválida → HTTP 401');
  log(r1.body && r1.body.error === 'Invalid signature', '401 com { error: Invalid signature }');
  log(state.inboxOps.length === 0, 'assinatura inválida → nem grava inbox (rejeita antes)');
  log(state.workspaceUpdates.length === 0, 'assinatura inválida → não processa nada');

  // H2 — assinatura válida + payment de plano aprovado → 200, inbox, ativa
  reset();
  state.workspaceRow = { id: 'w1', plan: 'pro', next_billing_at: null, coupon_code: null };
  state.paymentResult = { status: 'approved', external_reference: 'w1|pro', transaction_amount: 99.9, currency_id: 'BRL' };
  const r2 = mkRes();
  await handleMercadoPagoWebhook(mkReq({ type: 'payment', id: 'p2' }), r2);
  log(r2.statusCode === 200 && r2.body.received === true, 'assinatura válida → HTTP 200 { received:true }');
  log(state.inboxOps.some(o => o.op === 'insert'), 'grava webhook_inbox (received) antes de processar');
  log(state.invoiceInserts.length === 1, 'payment de plano aprovado → ativa (invoice criada)');
  log(state.tokenResets.length === 1, 'plano aprovado → concede tokens do plano');
  log(state.inboxOps.some(o => o.op === 'update' && o.status === 'processed'), 'fim do fluxo → inbox processed');

  // H3 — tipo não-aceito → 200 (ack) mas marca inbox ignored e não processa
  reset();
  const r3 = mkRes();
  await handleMercadoPagoWebhook(mkReq({ type: 'plan_update', id: 'p3' }), r3);
  log(r3.statusCode === 200, 'tipo não-aceito ainda responde 200 (MP espera ack)');
  log(state.inboxOps.some(o => o.op === 'update' && o.status === 'ignored'), 'tipo não-aceito → inbox ignored');
  log(state.workspaceUpdates.length === 0, 'tipo não-aceito → sem processamento');

  // H4 — sem paymentId → ignored
  reset();
  const r4 = mkRes();
  await handleMercadoPagoWebhook({ headers: {}, query: {}, body: { type: 'payment' } }, r4);
  log(state.inboxOps.some(o => o.op === 'update' && o.status === 'ignored'), 'sem paymentId → inbox ignored');

  // H5 — preapproval authorized → ativa recorrente + tokens + alerta
  reset();
  state.preapprovalResult = { status: 'authorized', external_reference: 'subscription|w1|pro' };
  await handleMercadoPagoWebhook(mkReq({ type: 'preapproval', id: 'pre1' }), mkRes());
  log(state.workspaceUpdates.some(p => Array.isArray(p) && p.includes('pro')), 'preapproval authorized → workspace ativado (plan=pro)');
  log(state.tokenResets.length === 1, 'preapproval authorized → tokens iniciais');
  log(state.alerts.some(a => /recorrente ativada/i.test(a.title)), 'preapproval authorized → alerta');

  // H6 — preapproval cancelled → canceling
  reset();
  state.preapprovalResult = { status: 'cancelled', external_reference: 'subscription|w1|pro' };
  await handleMercadoPagoWebhook(mkReq({ type: 'preapproval', id: 'pre2' }), mkRes());
  log(state.workspaceCanceling.length === 1, 'preapproval cancelled → subscription_status=canceling');

  // H7 — subscription_authorized_payment approved → ativa cobrança recorrente
  reset();
  state.workspaceRow = { id: 'w1', plan: 'pro', next_billing_at: null, coupon_code: null };
  state.authPaymentResult = { status: 'approved', preapproval_id: 'pre1', transaction_amount: 99.9, currency_id: 'BRL' };
  await handleMercadoPagoWebhook(mkReq({ type: 'subscription_authorized_payment', id: 'ap1' }), mkRes());
  log(state.invoiceInserts.length === 1, 'recurring charge approved → ativa (invoice criada)');
  log(state.tokenResets.length === 1, 'recurring charge approved → tokens resetados');

  // H8 — recurring charge rejected → past_due + evento charge_failed
  reset();
  state.workspaceRow = { id: 'w1', plan: 'pro' };
  state.authPaymentResult = { status: 'rejected', preapproval_id: 'pre1' };
  await handleMercadoPagoWebhook(mkReq({ type: 'subscription_authorized_payment', id: 'ap2' }), mkRes());
  log(state.workspacePastDue.length === 1, 'recurring charge rejected → workspace past_due');
  log(state.events.some(e => e.name === 'subscription.charge_failed'), 'recurring charge rejected → emite subscription.charge_failed');

  // H9 — authorized_payment sem workspace correspondente → no-op
  reset();
  state.workspaceRow = null;
  state.authPaymentResult = { status: 'approved', preapproval_id: 'preX' };
  await handleMercadoPagoWebhook(mkReq({ type: 'subscription_authorized_payment', id: 'ap3' }), mkRes());
  log(state.invoiceInserts.length === 0 && state.workspacePastDue.length === 0, 'authorized_payment sem workspace → não faz nada');

  // H10 — payment refunded (via handler) → marca intent failed E revoga acesso
  reset();
  state.invoiceByRef = { id: 'inv1', workspace_id: 'w1', status: 'paid' };
  state.paymentResult = { status: 'refunded' };
  await handleMercadoPagoWebhook(mkReq({ type: 'payment', id: 'p_ref' }), mkRes());
  log(state.intentUpdates.length === 1, 'payment refunded → marca intent failed');
  log(state.workspaceCancelled.length === 1, 'payment refunded → revoga acesso (dispatch→revoke)');

  // H11 — payment rejected → intent failed, sem revogação
  reset();
  state.paymentResult = { status: 'rejected' };
  await handleMercadoPagoWebhook(mkReq({ type: 'payment', id: 'p_rej' }), mkRes());
  log(state.intentUpdates.length === 1 && state.workspaceCancelled.length === 0, 'payment rejected → intent failed, sem revogação');

  // H12 — tokenpkg aprovado → credita tokens + invoice + evento
  reset();
  state.paymentResult = { status: 'approved', external_reference: 'tokenpkg|w1|pkg_small', transaction_amount: 50, currency_id: 'BRL' };
  await handleMercadoPagoWebhook(mkReq({ type: 'payment', id: 'p_tok' }), mkRes());
  log(state.tokenCredits.length === 1, 'tokenpkg aprovado → credita tokens');
  log(state.invoiceInserts.length === 1, 'tokenpkg aprovado → cria invoice');
  log(state.events.some(e => e.name === 'tokens.topup_confirmed'), 'tokenpkg aprovado → emite tokens.topup_confirmed');

  // H13 — tokenpkg já creditado (idempotência) → não credita de novo
  reset();
  state.paymentResult = { status: 'approved', external_reference: 'tokenpkg|w1|pkg_small', transaction_amount: 50 };
  state.tokenTxnExisting = { id: 'tx1' };
  await handleMercadoPagoWebhook(mkReq({ type: 'payment', id: 'p_tok2' }), mkRes());
  log(state.tokenCredits.length === 0, 'tokenpkg já creditado → NÃO credita de novo (idempotência)');

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
