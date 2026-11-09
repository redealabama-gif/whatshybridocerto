/**
 * Integração — IA-23: isolamento entre clientes nas rotas de IA.
 *
 * O teste de isolamento existente (tenant-isolation.routes.spec.js) só cobre
 * /contacts e /crm. Aqui: cada cliente usa SEMPRE o orquestrador do próprio
 * workspace em /api/v2/ai/process — sem cair num "default" compartilhado e sem
 * aceitar workspace/tenant vindo do corpo da requisição — e o cache do
 * AIRouter é separado por cliente. (Cobertura de lacuna: o código atual já
 * isola; o teste trava regressões.)
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

const { ensureDb, buildApp, database, cleanupDb } = require('./helpers/app');

const A = { ws: 'ws-iso-ai-a', user: 'user-iso-ai-a' };
const B = { ws: 'ws-iso-ai-b', user: 'user-iso-ai-b' };
const bearer = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const auth = (t) => ({ Authorization: `Bearer ${bearer(t.user)}` });

let app;
let registryGet;

beforeAll(async () => {
  await ensureDb();
  for (const tbl of ['workspace_credits', 'workspaces', 'users']) {
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
    database.run('INSERT INTO workspace_credits (workspace_id, tokens_total, tokens_used) VALUES (?, 100000, 0)', [t.ws]);
  }
  const registry = require('../../src/registry/OrchestratorRegistry');
  registryGet = jest.spyOn(registry, 'get').mockImplementation((tenantId) => ({
    processMessage: async () => ({ success: true, response: `resposta do ${tenantId}`, metadata: {} }),
  }));
  app = buildApp({ '/api/v2/ai': require('../../src/routes/ai-v2') });
});

afterAll(() => cleanupDb());
beforeEach(() => registryGet.mockClear());

const processAs = (t, extraBody = {}) =>
  request(app).post('/api/v2/ai/process').set(auth(t))
    .send({ chatId: '5511999990000@c.us', message: 'Qual o horário?', ...extraBody });

describe('IA-23 — /api/v2/ai/process usa o orquestrador do próprio cliente', () => {
  test('A e B (mesmo chatId) → cada um no seu workspace', async () => {
    const ra = await processAs(A);
    const rb = await processAs(B);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    expect(registryGet.mock.calls.map((c) => c[0])).toEqual([A.ws, B.ws]);
    expect(ra.body.response).toBe(`resposta do ${A.ws}`);
    expect(rb.body.response).toBe(`resposta do ${B.ws}`);
  });

  test('workspace/tenant no corpo da requisição é ignorado', async () => {
    const r = await processAs(A, { tenantId: B.ws, workspaceId: B.ws, workspace_id: B.ws });
    expect(r.status).toBe(200);
    expect(registryGet.mock.calls.map((c) => c[0])).toEqual([A.ws]);
  });
});

describe('IA-23 — cache do AIRouter separado por cliente', () => {
  test('mesma conversa, clientes diferentes → chaves de cache diferentes', () => {
    const { AIRouterService } = require('../../src/ai/services/AIRouterService');
    const router = new AIRouterService({});
    const msgs = [{ role: 'user', content: 'Qual o horário?' }];
    const ka = router.getCacheKey(msgs, { tenantId: A.ws });
    const kb = router.getCacheKey(msgs, { tenantId: B.ws });
    expect(ka).not.toBe(kb);
  });
});
