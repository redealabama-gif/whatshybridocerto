/**
 * Integração — ingestão do canário (/api/v1/canary).
 *
 * Sobe o router real contra um SQLite temporário (com a migration 020_canary_runs
 * aplicada) e exercita via HTTP. Cobre auth por token, validação de status e a
 * gravação na tabela canary_runs.
 */

const request = require('supertest');
const { ensureDb, buildApp, database, cleanupDb } = require('./helpers/app');

const TOKEN = 'canary-token-para-os-testes-de-ci-0123456789';
let app;

beforeAll(async () => {
  await ensureDb();
  process.env.CANARY_TOKEN = TOKEN;
  app = buildApp({ '/api/v1/canary': require('../../src/routes/canary') });
});

afterAll(() => cleanupDb());

describe('POST /api/v1/canary/report', () => {
  test('grava relatório válido com token correto', async () => {
    const res = await request(app)
      .post('/api/v1/canary/report')
      .set('X-Canary-Token', TOKEN)
      .send({
        status: 'healthy',
        source: 'whatsapp-web',
        waVersion: '2.3000',
        brokenCount: 0,
        degradedCount: 0,
        durationMs: 1234,
        report: { checks: { hasStore: true } },
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe('string');

    const row = await database.get(
      'SELECT status, wa_version, duration_ms FROM canary_runs WHERE id = ?',
      [res.body.id]
    );
    expect(row.status).toBe('healthy');
    expect(row.wa_version).toBe('2.3000');
    expect(Number(row.duration_ms)).toBe(1234);
  });

  test('grava status broken com contadores', async () => {
    const res = await request(app)
      .post('/api/v1/canary/report')
      .set('X-Canary-Token', TOKEN)
      .send({ status: 'broken', brokenCount: 3, report: { errors: ['seletor X sumiu'] } });

    expect(res.status).toBe(201);
    const row = await database.get('SELECT status, broken_count FROM canary_runs WHERE id = ?', [
      res.body.id,
    ]);
    expect(row.status).toBe('broken');
    expect(Number(row.broken_count)).toBe(3);
  });

  test('rejeita token inválido (401)', async () => {
    const res = await request(app)
      .post('/api/v1/canary/report')
      .set('X-Canary-Token', 'token-errado')
      .send({ status: 'healthy' });
    expect(res.status).toBe(401);
  });

  test('rejeita status inválido (400)', async () => {
    const res = await request(app)
      .post('/api/v1/canary/report')
      .set('X-Canary-Token', TOKEN)
      .send({ status: 'banana' });
    expect(res.status).toBe(400);
  });
});
