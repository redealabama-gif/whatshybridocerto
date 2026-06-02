/**
 * Integração — rota admin de leads de cupom (/api/v1/admin/coupon-leads).
 *
 * Exercita o caminho completo de autorização: authenticate (JWT real) +
 * requireAdmin, contra usuários semeados no banco. Cobre 401 (sem token),
 * 403 (role não-admin) e 200 (admin lista os leads capturados).
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
// Helper PRIMEIRO: define as env vars (JWT_SECRET etc.) antes de carregar config.
const { ensureDb, buildApp, database, cleanupDb } = require('./helpers/app');
const config = require('../../config');

let app;

/** Cria um user no banco e devolve um JWT válido pra ele. */
function seedUserAndToken({ id, role }) {
  database.run(
    `INSERT INTO users (id, email, password, name, role, status, workspace_id)
     VALUES (?, ?, 'x', ?, ?, 'active', ?)`,
    [id, `${id}@example.com`, id, role, `ws-${id}`]
  );
  const token = jwt.sign({ userId: id }, config.jwt.secret, { algorithm: 'HS256' });
  return token;
}

beforeAll(async () => {
  await ensureDb();
  app = buildApp({ '/api/v1/admin': require('../../src/routes/admin') });

  // Lead pra listar
  database.run(
    `INSERT INTO coupon_leads (id, name, email, phone, coupon, source)
     VALUES ('lead-it-1', 'Cliente Lead', 'lead@example.com', '21999990000', 'EXIT50', 'exit-modal')`
  );
});

afterAll(() => cleanupDb());

describe('GET /api/v1/admin/coupon-leads', () => {
  test('sem token → 401', async () => {
    const res = await request(app).get('/api/v1/admin/coupon-leads');
    expect(res.status).toBe(401);
  });

  test('role não-admin → 403', async () => {
    const token = seedUserAndToken({ id: 'user-plain', role: 'owner' });
    const res = await request(app)
      .get('/api/v1/admin/coupon-leads')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('admin → 200 e lista os leads', async () => {
    const token = seedUserAndToken({ id: 'user-admin', role: 'admin' });
    const res = await request(app)
      .get('/api/v1/admin/coupon-leads')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const emails = res.body.data.map((l) => l.email);
    expect(emails).toContain('lead@example.com');
  });

  test('admin com busca filtra por nome/email', async () => {
    const token = seedUserAndToken({ id: 'user-admin2', role: 'admin' });
    const res = await request(app)
      .get('/api/v1/admin/coupon-leads?search=lead@example')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((l) => /lead@example/.test(l.email))).toBe(true);
  });

  test('DELETE remove o lead', async () => {
    const token = seedUserAndToken({ id: 'user-admin3', role: 'admin' });
    const del = await request(app)
      .delete('/api/v1/admin/coupon-leads/lead-it-1')
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const row = database.get('SELECT id FROM coupon_leads WHERE id = ?', ['lead-it-1']);
    expect(row).toBeFalsy();
  });
});
