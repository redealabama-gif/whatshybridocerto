/**
 * Integração — rotas públicas de cupom (/api/v1/coupons).
 *
 * Sobe o router real contra um SQLite temporário e exercita via HTTP (supertest).
 * Cobre o fluxo de captura de lead (a feature do modal de cupom) e a validação
 * pública de código.
 */

const request = require('supertest');
const { ensureDb, buildApp, database, cleanupDb } = require('./helpers/app');

let app;

beforeAll(async () => {
  await ensureDb();
  app = buildApp({ '/api/v1/coupons': require('../../src/routes/coupons') });
});

afterAll(() => cleanupDb());

describe('POST /api/v1/coupons/lead', () => {
  test('persiste lead válido e responde success', async () => {
    const res = await request(app)
      .post('/api/v1/coupons/lead')
      .send({
        name: 'Maria Teste',
        email: 'maria@example.com',
        phone: '(21) 99580-0771',
        coupon: 'EXIT50',
        source: 'exit-modal',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    // Persistiu de fato?
    const row = database.get('SELECT name, email, phone, coupon FROM coupon_leads WHERE email = ?', [
      'maria@example.com',
    ]);
    expect(row).toBeTruthy();
    expect(row.name).toBe('Maria Teste');
    expect(row.coupon).toBe('EXIT50');
  });

  test('rejeita email inválido com 400', async () => {
    const res = await request(app)
      .post('/api/v1/coupons/lead')
      .send({ name: 'João', email: 'nao-eh-email', phone: '21999999999' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('rejeita telefone curto com 400', async () => {
    const res = await request(app)
      .post('/api/v1/coupons/lead')
      .send({ name: 'João', email: 'joao@example.com', phone: '123' });
    expect(res.status).toBe(400);
  });

  test('rejeita nome ausente com 400', async () => {
    const res = await request(app)
      .post('/api/v1/coupons/lead')
      .send({ email: 'x@example.com', phone: '21999999999' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/coupons/validate/:code', () => {
  test('cupom inexistente → valid:false, reason not_found', async () => {
    const res = await request(app).get('/api/v1/coupons/validate/NAOEXISTE123?plan=starter');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toBe('not_found');
  });

  test('plano free → não elegível (sem 4xx, contrato estável)', async () => {
    const res = await request(app).get('/api/v1/coupons/validate/QUALQUER?plan=free');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toBe('plan_not_eligible');
  });

  test('cupom ativo válido → calcula desconto', async () => {
    // Semeia um cupom de 50% (value é fração: 0.5) pra todos os planos.
    database.run(
      `INSERT INTO coupons (code, description, kind, value, active, applies_to_plans, first_invoice_only)
       VALUES ('HALF50', 'Meio preço', 'percent', 0.5, 1, NULL, 0)`
    );
    const res = await request(app).get('/api/v1/coupons/validate/HALF50?plan=starter&amount=49.90');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.code).toBe('HALF50');
    expect(res.body.discountAmount).toBeCloseTo(24.95, 2);
    expect(res.body.finalAmount).toBeCloseTo(24.95, 2);
  });
});
