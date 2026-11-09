/**
 * Integração — IA-52: exemplo de treinamento não duplica.
 *
 * A tela de treinamento cria o exemplo com id numérico (Date.now()) e o envia
 * pelo /api/v1/training/sync, que grava o id como texto ("1794263120901").
 * 10 s depois o WhatsApp Web envia a mesma lista ao /api/v1/ai/few-shot/sync,
 * que procurava e gravava o id como NÚMERO: o SQLite o guardava como
 * "1794263120901.0" → não reconhecia o exemplo e inseria outra cópia; a
 * resposta (as 2 cópias) voltava para a base local e o próximo sync do treino
 * gravava as 2. Prova real: sonda probe-exemplos (relatório, seção 13).
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

const { ensureDb, buildApp, database, cleanupDb } = require('./helpers/app');

const T = { ws: 'ws-ia52', user: 'user-ia52' };
const bearer = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const auth = () => ({ Authorization: `Bearer ${bearer(T.user)}` });
const EXEMPLO = { id: 1794263120901, input: 'Tem horário no sábado?', output: 'Tem sim, das 8h às 12h.', category: 'geral', tags: [] };
const exemplos = () => database.all('SELECT id, input FROM training_examples WHERE workspace_id = ?', [T.ws]);

let app;
beforeAll(async () => {
  await ensureDb();
  database.run(
    `INSERT INTO users (id, email, password, name, role, status, workspace_id) VALUES (?, ?, ?, ?, 'owner', 'active', ?)`,
    [T.user, `${T.user}@example.com`, 'x', 'Owner IA-52', T.ws]
  );
  database.run(
    `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status) VALUES (?, ?, ?, 'pro', 'active')`,
    [T.ws, 'WS IA-52', T.user]
  );
  await require('../../src/utils/uuid-wrapper').initUUID();
  app = buildApp({
    '/api/v1/training': require('../../src/routes/training'),
    '/api/v1/ai': require('../../src/routes/ai'),
    '/api/v1/examples': require('../../src/routes/examples'),
  });
});
afterAll(() => cleanupDb());
beforeEach(() => database.run('DELETE FROM training_examples WHERE workspace_id = ?', [T.ws]));

describe('IA-52 — o mesmo exemplo pelos dois caminhos de sync', () => {
  test('training/sync e depois few-shot/sync (lista em texto, como o WhatsApp envia) → 1 exemplo', async () => {
    expect((await request(app).post('/api/v1/training/sync').set(auth()).send({ examples: [EXEMPLO] })).status).toBe(200);
    const r = await request(app).post('/api/v1/ai/few-shot/sync').set(auth()).send({ examples: JSON.stringify([EXEMPLO]) });
    expect(r.status).toBe(200);
    expect(exemplos()).toHaveLength(1);
    expect(r.body.examples).toHaveLength(1);
  });

  test('training/sync e depois examples/sync (o que o service worker chama) → 1 exemplo', async () => {
    expect((await request(app).post('/api/v1/training/sync').set(auth()).send({ examples: [EXEMPLO] })).status).toBe(200);
    const r = await request(app).post('/api/v1/examples/sync').set(auth()).send({ examples: [EXEMPLO] });
    expect(r.status).toBe(200);
    expect(exemplos()).toHaveLength(1);
  });

  test('few-shot/sync repetido não duplica', async () => {
    await request(app).post('/api/v1/ai/few-shot/sync').set(auth()).send({ examples: [EXEMPLO] });
    await request(app).post('/api/v1/ai/few-shot/sync').set(auth()).send({ examples: [EXEMPLO] });
    expect(exemplos()).toHaveLength(1);
  });
});
