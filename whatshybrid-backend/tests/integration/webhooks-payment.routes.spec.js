/**
 * Integração — webhook SaaS do MercadoPago (/api/v1/webhooks/payment).
 *
 * Sobe o router REAL contra um SQLite temporário com as migrations aplicadas e
 * exercita o caminho do dinheiro ponta a ponta via HTTP (supertest). O ÚNICO
 * boundary mockado é o MercadoPagoService (HTTP externo do gateway) — todo o
 * resto é real: roteamento, asyncHandler, activateWorkspaceSubscription,
 * revokeWorkspaceForRefund, e o BANCO (SQL/schema/transações/migrations).
 *
 * Isto cobre a classe de bug que os unit tests com DB mockado NÃO pegam:
 * SQL incorreto, drift de schema, constraint/FK, semântica real de transação.
 *
 * Nota: o handler responde 200 e processa de forma ASSÍNCRONA. Por isso os
 * asserts esperam (waitFor) o efeito real aparecer no banco, em vez de assumir
 * que terminou quando a resposta HTTP chega.
 */

const request = require('supertest');

// Stub do gateway externo (único mock). DB e lógica de negócio são reais.
jest.mock('../../src/services/MercadoPagoService', () => ({
  PLAN_PRICES: { starter: 49.9, pro: 99.9 },
  validateWebhookSignature: jest.fn(() => true),
  getPayment: jest.fn(),
  getPreapproval: jest.fn(),
  getAuthorizedPayment: jest.fn(),
}));

const { ensureDb, buildApp, database, cleanupDb } = require('./helpers/app');
const mpService = require('../../src/services/MercadoPagoService');

let app;
const WS = 'ws-int-1';
const OWNER = 'user-int-1';

function seedWorkspace({ id = WS, owner = OWNER, plan = 'free', status = 'incomplete' } = {}) {
  database.run(`INSERT INTO users (id, email, password) VALUES (?, ?, ?)`,
    [owner, `${owner}@example.com`, 'x']);
  database.run(
    `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status) VALUES (?, ?, ?, ?, ?)`,
    [id, 'WS Integração', owner, plan, status]
  );
}

function post(paymentId, type = 'payment') {
  return request(app)
    .post('/api/v1/webhooks/payment/mercadopago-saas')
    .send({ type, data: { id: paymentId } });
}

// Poll até a condição (efeito real no DB) ser verdade — o processamento do
// webhook roda após o 200. better-sqlite3 é síncrono; o setTimeout cede o loop
// pra a continuação assíncrona do handler rodar.
async function waitFor(fn, { timeoutMs = 5000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = fn(); } catch (_) { v = undefined; }
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  await ensureDb();
  app = buildApp({ '/api/v1/webhooks/payment': require('../../src/routes/webhooks-payment-saas') });
});

afterAll(() => cleanupDb());

beforeEach(() => {
  // Limpa estado entre testes — filhos antes de pais (FK = ON no driver).
  for (const t of [
    'webhook_inbox', 'billing_invoices', 'billing_intents', 'subscription_codes',
    'token_transactions', 'workspace_credits', 'workspaces', 'users',
  ]) {
    try { database.run(`DELETE FROM ${t}`); } catch (_) {}
  }
  mpService.validateWebhookSignature.mockReturnValue(true);
  mpService.getPayment.mockReset();
});

describe('POST /mercadopago-saas — assinatura', () => {
  test('assinatura inválida → 401 e nada é gravado', async () => {
    mpService.validateWebhookSignature.mockReturnValue(false);
    const res = await post('pay-bad');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid signature');
    // não gravou inbox nem processou
    const inbox = database.get(`SELECT id FROM webhook_inbox WHERE provider_event_id = ?`, ['pay-bad']);
    expect(inbox).toBeFalsy();
  });
});

describe('POST /mercadopago-saas — ativação (DB real)', () => {
  test('payment aprovado → workspace ativado + invoice paid', async () => {
    seedWorkspace({ plan: 'free', status: 'incomplete' });
    mpService.getPayment.mockResolvedValue({
      status: 'approved', external_reference: `${WS}|pro`, transaction_amount: 99.9, currency_id: 'BRL',
    });

    const res = await post('pay-1');
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    // ensureSubscriptionCode é a última escrita do activate (após a transação);
    // se o código existe, invoice + workspace já estão consolidados.
    const code = await waitFor(() =>
      database.get(`SELECT code FROM subscription_codes WHERE workspace_id = ?`, [WS]));
    expect(code && /^WHL-/.test(code.code)).toBe(true);

    const inv = database.get(`SELECT status, amount, plan FROM billing_invoices WHERE provider_ref = ?`, ['pay-1']);
    expect(inv).toBeTruthy();
    expect(inv.status).toBe('paid');
    expect(inv.amount).toBe(99.9);
    expect(inv.plan).toBe('pro');

    const ws = database.get(
      `SELECT plan, subscription_status, next_billing_at, payment_provider FROM workspaces WHERE id = ?`, [WS]);
    expect(ws.plan).toBe('pro');
    expect(ws.subscription_status).toBe('active');
    expect(ws.next_billing_at).toBeTruthy();
    expect(ws.payment_provider).toBe('mercadopago');
  });

  test('idempotência: re-entrega do mesmo pagamento NÃO cria 2ª invoice', async () => {
    seedWorkspace();
    mpService.getPayment.mockResolvedValue({
      status: 'approved', external_reference: `${WS}|pro`, transaction_amount: 99.9, currency_id: 'BRL',
    });

    await post('pay-2');
    await waitFor(() => database.get(`SELECT 1 AS ok FROM billing_invoices WHERE provider_ref = ?`, ['pay-2']));
    await post('pay-2'); // re-entrega do mesmo evento
    // ambas as entregas chegaram a consultar o pagamento (= as duas processaram)
    await waitFor(() => mpService.getPayment.mock.calls.length >= 2);

    const cnt = database.get(`SELECT COUNT(*) AS n FROM billing_invoices WHERE provider_ref = ?`, ['pay-2']);
    expect(cnt.n).toBe(1); // idempotente na ativação (provider_ref): uma única invoice
    // bônus: o inbox também deduplica no nível do DB (UNIQUE provider+event_id)
    const inboxN = database.get(`SELECT COUNT(*) AS n FROM webhook_inbox WHERE provider_event_id = ?`, ['pay-2']);
    expect(inboxN.n).toBe(1);
  });
});

describe('POST /mercadopago-saas — estorno (DB real)', () => {
  test('refund de pagamento aprovado → revoga acesso e marca invoice refunded', async () => {
    seedWorkspace();
    // 1) ativa
    mpService.getPayment.mockResolvedValue({
      status: 'approved', external_reference: `${WS}|pro`, transaction_amount: 99.9, currency_id: 'BRL',
    });
    await post('pay-3');
    await waitFor(() => {
      const w = database.get(`SELECT subscription_status FROM workspaces WHERE id = ?`, [WS]);
      return w && w.subscription_status === 'active';
    });

    // 2) estorno do mesmo pagamento (mesma invoice via provider_ref)
    mpService.getPayment.mockResolvedValue({ status: 'refunded' });
    await post('pay-3');
    const ws = await waitFor(() => {
      const w = database.get(
        `SELECT subscription_status, auto_renew_enabled FROM workspaces WHERE id = ?`, [WS]);
      return w && w.subscription_status === 'cancelled' ? w : null;
    });

    expect(ws.subscription_status).toBe('cancelled');
    expect(ws.auto_renew_enabled).toBe(0);

    const inv = database.get(`SELECT status FROM billing_invoices WHERE provider_ref = ?`, ['pay-3']);
    expect(inv.status).toBe('refunded');
  });
});
