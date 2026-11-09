/**
 * Integração — IA-10: POST /api/v1/training/sync não perde o treinamento.
 *
 * Antes (audit/evidencias/24-treinamento-sync-colisao.md): o id local do item
 * era chave primária GLOBAL; um 2º workspace com o mesmo id (troca de conta no
 * mesmo navegador) caía em UNIQUE constraint — e o DELETE do workspace já tinha
 * rodado, sem transação → as FAQs de B iam a zero, com HTTP 200 success:false.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

const { ensureDb, buildApp, database, cleanupDb } = require('./helpers/app');

const A = { ws: 'ws-train-a', user: 'user-train-a' };
const B = { ws: 'ws-train-b', user: 'user-train-b' };
const bearer = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const auth = (t) => ({ Authorization: `Bearer ${bearer(t.user)}` });

let app;
const faqsOf = (t) => database.all('SELECT id, question FROM faqs WHERE workspace_id = ? ORDER BY question', [t.ws]);
const sync = (t, body) => request(app).post('/api/v1/training/sync').set(auth(t)).send(body);

beforeAll(async () => {
  await ensureDb();
  app = buildApp({ '/api/v1/training': require('../../src/routes/training') });
});

afterAll(() => cleanupDb());

beforeEach(() => {
  jest.restoreAllMocks();
  for (const tbl of ['faqs', 'workspaces', 'users']) {
    try { database.run(`DELETE FROM ${tbl}`); } catch (_) { /* driver */ }
  }
  for (const t of [A, B]) {
    database.run(
      `INSERT INTO users (id, email, password, name, role, status, workspace_id) VALUES (?, ?, ?, ?, 'owner', 'active', ?)`,
      [t.user, `${t.user}@example.com`, 'x', `Owner ${t.user}`, t.ws]
    );
    database.run(
      `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status) VALUES (?, ?, ?, 'pro', 'active')`,
      [t.ws, `WS ${t.ws}`, t.user]
    );
  }
});

const OWN = { id: 'faq-b-propria', question: 'Qual o horário?', answer: 'Seg a Sex 9h–18h.' };
const SHARED = { id: '1794166000000', question: 'Quanto custa?', answer: 'R$ 189/mês.' };

describe('IA-10 — id local já usado por outro workspace', () => {
  test('B sincroniza a própria FAQ + uma com o mesmo id de A → as duas ficam em B', async () => {
    expect((await sync(B, { faqs: [OWN] })).status).toBe(200);
    expect((await sync(A, { faqs: [SHARED] })).status).toBe(200);
    const res = await sync(B, { faqs: [OWN, SHARED] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(faqsOf(B).map((f) => f.question)).toEqual(['Qual o horário?', 'Quanto custa?']);
    expect(faqsOf(A).map((f) => f.question)).toEqual(['Quanto custa?']); // A intacto
  });

  test('B envia só o conjunto local de A → B não fica zerado', async () => {
    expect((await sync(A, { faqs: [SHARED] })).status).toBe(200);
    const res = await sync(B, { faqs: [SHARED] });
    expect(res.body.success).toBe(true);
    expect(faqsOf(B)).toHaveLength(1);
  });
});

describe('IA-10 — falha no meio do sync', () => {
  test('erro num INSERT → nada é apagado (transação) e a resposta NÃO é 2xx', async () => {
    expect((await sync(B, { faqs: [OWN] })).status).toBe(200);
    const realRun = database.run;
    let inserts = 0;
    jest.spyOn(database, 'run').mockImplementation(function (sql, params) {
      if (/INSERT INTO faqs/.test(sql) && ++inserts === 2) throw new Error('falha simulada no INSERT');
      return realRun.call(this, sql, params);
    });
    const res = await sync(B, { faqs: [{ id: 'n1', question: 'Nova 1', answer: 'r1' }, { id: 'n2', question: 'Nova 2', answer: 'r2' }] });
    jest.restoreAllMocks();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
    expect(faqsOf(B).map((f) => f.question)).toEqual(['Qual o horário?']); // a antiga continua lá
  });
});

describe('IA-45 — FAQ importada de planilha chega ao banco', () => {
  // O importador da tela de treinamento (document-importer.js) gravava FAQs
  // como { q, a }; o sync só lia question/answer e descartava todas em silêncio
  // (HTTP 200, faqs=0). Dados já salvos assim no navegador precisam entrar.
  test('FAQ no formato { q, a } é gravada', async () => {
    const res = await sync(B, { faqs: [OWN, { id: 1794260810048.123, q: 'Vocês parcelam no cartão?', a: 'Sim, em até 6x sem juros.', keywords: [] }] });
    expect(res.status).toBe(200);
    expect(res.body.synced.faqs).toBe(2);
    expect(faqsOf(B).map((f) => f.question)).toEqual(['Qual o horário?', 'Vocês parcelam no cartão?']);
  });
});
