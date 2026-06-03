/**
 * Integração — webhook do Stripe (/api/v1/webhooks/payment/stripe).
 *
 * Dá ao Stripe a MESMA "prova de sistema" que o MercadoPago já tinha: sobe o
 * router REAL contra um SQLite real com migrations e exercita o caminho do
 * dinheiro ponta a ponta via HTTP. O ÚNICO boundary mockado é o StripeService
 * (validação de assinatura — o HMAC externo); todo o resto é real: roteamento,
 * express.raw (rawBody), inbox/outbox, ativação, idempotência, refund e o BANCO
 * (SQL/schema/FK/transações).
 *
 * Pega a classe de bug que unit tests com DB mockado NÃO pegam: SQL incorreto,
 * drift de schema, semântica real de transação e idempotência por provider_ref.
 *
 * Observação: o handler responde 200 e processa de forma ASSÍNCRONA — por isso
 * os asserts usam waitFor() esperando o efeito real aparecer no banco.
 *
 * O app é montado inline (sem express.json global): a rota traz seu próprio
 * express.raw({ type: 'application/json' }) e precisa do corpo cru.
 */

const express = require('express');
const request = require('supertest');

// Único mock: validação de assinatura (HMAC externo do Stripe).
jest.mock('../../src/services/StripeService', () => ({
  validateWebhookSignature: jest.fn(() => true),
}));

const { ensureDb, database, cleanupDb } = require('./helpers/app');
const stripeService = require('../../src/services/StripeService');
const { errorHandler } = require('../../src/middleware/errorHandler');

let app;
const WS = 'ws-stripe-1';
const OWNER = 'user-stripe-1';

function seedWorkspace({ id = WS, owner = OWNER, plan = 'free', status = 'incomplete' } = {}) {
  database.run(`INSERT INTO users (id, email, password, status) VALUES (?, ?, ?, 'active')`, [
    owner,
    `${owner}@example.com`,
    'x',
  ]);
  database.run(
    `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status) VALUES (?, ?, ?, ?, ?)`,
    [id, 'WS Stripe', owner, plan, status]
  );
}

function post(event) {
  return request(app)
    .post('/api/v1/webhooks/payment/stripe')
    .set('stripe-signature', 't=1,v1=stub')
    .set('Content-Type', 'application/json')
    .send(event);
}

// Poll até o efeito real no DB aparecer (o processamento roda após o 200).
async function waitFor(fn, { timeoutMs = 5000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try {
      v = fn();
    } catch (_) {
      v = undefined;
    }
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  await ensureDb();
  app = express();
  // SEM express.json global — a rota usa express.raw internamente.
  app.use('/api/v1/webhooks/payment', require('../../src/routes/webhooks-stripe'));
  app.use(errorHandler);
});

afterAll(() => cleanupDb());

beforeEach(() => {
  for (const t of [
    'webhook_inbox',
    'token_transactions',
    'workspace_credits',
    'billing_invoices',
    'workspaces',
    'users',
  ]) {
    try {
      database.run(`DELETE FROM ${t}`);
    } catch (_) {
      /* ignore */
    }
  }
  stripeService.validateWebhookSignature.mockReturnValue(true);
});

describe('assinatura', () => {
  test('assinatura inválida → 401 e nada gravado no inbox', async () => {
    stripeService.validateWebhookSignature.mockReturnValueOnce(false);
    const res = await post({
      id: 'evt_bad',
      type: 'checkout.session.completed',
      data: { object: {} },
    });
    expect(res.status).toBe(401);
    const inbox = database.get(`SELECT id FROM webhook_inbox WHERE provider_event_id = ?`, [
      'evt_bad',
    ]);
    expect(inbox).toBeFalsy();
  });
});

describe('checkout.session.completed — ativação (DB real)', () => {
  function checkout(sessionId, eventId) {
    return {
      id: eventId,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          customer: 'cus_1',
          subscription: 'sub_1',
          amount_total: 9990, // centavos → 99.90
          currency: 'brl',
          metadata: { workspace_id: WS, plan: 'pro', user_id: OWNER },
        },
      },
    };
  }

  test('checkout aprovado → workspace ativado (stripe) + invoice paid', async () => {
    seedWorkspace({ plan: 'free', status: 'incomplete' });

    const res = await post(checkout('cs_1', 'evt_1'));
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const inv = await waitFor(() =>
      database.get(
        `SELECT status, amount, currency FROM billing_invoices WHERE provider = 'stripe' AND provider_ref = ?`,
        ['cs_1']
      )
    );
    expect(inv).toBeTruthy();
    expect(inv.status).toBe('paid');
    expect(inv.amount).toBeCloseTo(99.9, 2);
    expect(inv.currency).toBe('BRL');

    const ws = database.get(
      `SELECT plan, subscription_status, payment_provider, stripe_customer_id, stripe_subscription_id, next_billing_at FROM workspaces WHERE id = ?`,
      [WS]
    );
    expect(ws.plan).toBe('pro');
    expect(ws.subscription_status).toBe('active');
    expect(ws.payment_provider).toBe('stripe');
    expect(ws.stripe_customer_id).toBe('cus_1');
    expect(ws.stripe_subscription_id).toBe('sub_1');
    expect(ws.next_billing_at).toBeTruthy();
  });

  test('idempotência: re-entrega do mesmo checkout NÃO cria 2ª invoice', async () => {
    seedWorkspace();

    await post(checkout('cs_2', 'evt_2'));
    await waitFor(() =>
      database.get(`SELECT 1 AS ok FROM billing_invoices WHERE provider_ref = ?`, ['cs_2'])
    );
    await post(checkout('cs_2', 'evt_2')); // re-entrega idêntica
    // dá tempo pro 2º processamento rodar
    await new Promise((r) => setTimeout(r, 150));

    const cnt = database.get(
      `SELECT COUNT(*) AS n FROM billing_invoices WHERE provider = 'stripe' AND provider_ref = ?`,
      ['cs_2']
    );
    expect(cnt.n).toBe(1); // idempotente por provider_ref
    const inboxN = database.get(
      `SELECT COUNT(*) AS n FROM webhook_inbox WHERE provider_event_id = ?`,
      ['evt_2']
    );
    expect(inboxN.n).toBe(1); // dedup no nível do DB (UNIQUE provider+event_id)
  });
});

describe('charge.refunded — estorno (DB real)', () => {
  test('refund → workspace suspenso, invoice refunded e saldo de tokens zerado', async () => {
    seedWorkspace({ plan: 'pro', status: 'active' });
    // Invoice paga prévia que o handler localiza por provider_ref = payment_intent.
    database.run(
      `INSERT INTO billing_invoices (id, workspace_id, provider, provider_ref, plan, amount, currency, status, paid_at)
       VALUES ('inv-stripe-1', ?, 'stripe', 'pi_ref_1', 'pro', 99.9, 'BRL', 'paid', CURRENT_TIMESTAMP)`,
      [WS]
    );
    database.run(
      `INSERT INTO workspace_credits (workspace_id, tokens_total, tokens_used) VALUES (?, 1000, 100)`,
      [WS]
    );

    const res = await post({
      id: 'evt_refund_1',
      type: 'charge.refunded',
      data: { object: { id: 'ch_1', payment_intent: 'pi_ref_1' } },
    });
    expect(res.status).toBe(200);

    const ws = await waitFor(() => {
      const w = database.get(
        `SELECT subscription_status, auto_renew_enabled FROM workspaces WHERE id = ?`,
        [WS]
      );
      return w && w.subscription_status === 'cancelled' ? w : null;
    });
    expect(ws.subscription_status).toBe('cancelled');
    expect(ws.auto_renew_enabled).toBe(0);

    const inv = database.get(`SELECT status FROM billing_invoices WHERE id = 'inv-stripe-1'`);
    expect(inv.status).toBe('refunded');

    const credits = database.get(
      `SELECT tokens_total, tokens_used FROM workspace_credits WHERE workspace_id = ?`,
      [WS]
    );
    // saldo zerado: tokens_total rebaixado para tokens_used
    expect(credits.tokens_total).toBe(credits.tokens_used);
    expect(credits.tokens_total).toBe(100);
  });
});
