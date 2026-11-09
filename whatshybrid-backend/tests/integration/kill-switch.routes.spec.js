/**
 * Integração — IA-04: o kill switch PARA de verdade a IA e o autopilot.
 *
 * Antes: o estado do kill switch só era lido por GET /status; nenhuma rota de
 * IA o consultava (audit/evidencias/20-backend-cenarios.md, S6: com "ai" e
 * "autopilot" ligados, /api/v2/ai/process seguia chamando o provedor). A chave
 * padrão CHANGE_ME_IN_PRODUCTION era aceita e o estado sumia no restart.
 *
 * O orquestrador é substituído por um dublê (o que importa aqui é SE ele é
 * chamado); rotas, auth, assinatura e banco são reais.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

const { ensureDb, buildApp, database, cleanupDb } = require('./helpers/app');

const ADMIN_KEY = 'ks-key-integration-0001';
const ADM = { ws: 'ws-ks-admin', user: 'user-ks-admin', role: 'admin' };
const A = { ws: 'ws-ks-a', user: 'user-ks-a', role: 'user' };
const B = { ws: 'ws-ks-b', user: 'user-ks-b', role: 'user' };

const bearer = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const auth = (t) => ({ Authorization: `Bearer ${bearer(t.user)}` });

let app;
let processMessage;

function seed(t) {
  database.run(
    `INSERT INTO users (id, email, password, name, role, status, workspace_id) VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    [t.user, `${t.user}@example.com`, 'x', `Owner ${t.user}`, t.role, t.ws]
  );
  database.run(
    `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status) VALUES (?, ?, ?, 'pro', 'active')`,
    [t.ws, `WS ${t.ws}`, t.user]
  );
  database.run(`INSERT INTO workspace_credits (workspace_id, tokens_total, tokens_used) VALUES (?, 100000, 0)`, [t.ws]);
}

function buildWithFreshRouters() {
  const registry = require('../../src/registry/OrchestratorRegistry');
  jest.spyOn(registry, 'get').mockImplementation(() => ({ processMessage }));
  return buildApp({
    '/api/v1/admin/kill-switch': require('../../src/routes/admin-killswitch'),
    '/api/v2/ai': require('../../src/routes/ai-v2'),
  });
}

const setKill = (body) =>
  request(app).post('/api/v1/admin/kill-switch/set').set(auth(ADM)).send({ adminKey: ADMIN_KEY, ...body });
const resetKill = () =>
  request(app).post('/api/v1/admin/kill-switch/reset').set(auth(ADM)).send({ adminKey: ADMIN_KEY });
const processAs = (t) =>
  request(app).post('/api/v2/ai/process').set(auth(t)).send({ chatId: '5511999990000@c.us', message: 'Qual o horário de vocês?' });

beforeAll(async () => {
  process.env.ADMIN_KILL_SWITCH_KEY = ADMIN_KEY;
  await ensureDb();
  for (const tbl of ['workspace_credits', 'workspaces', 'users']) {
    try { database.run(`DELETE FROM ${tbl}`); } catch (_) { /* driver */ }
  }
  [ADM, A, B].forEach(seed);
  app = buildWithFreshRouters();
});

afterAll(() => cleanupDb());

beforeEach(async () => {
  processMessage = jest.fn(async () => ({
    success: true,
    response: 'Abrimos de segunda a sexta, das 9h às 18h.',
    metadata: { autopilot: { allowAutoSend: true, escalate: false, reasons: [], primaryReason: null, riskTier: 'low', minConfidence: 70 } },
  }));
  await resetKill();
});

describe('IA-04 — kill switch "ai"', () => {
  test('controle: desligado → /process responde e chama o orquestrador', async () => {
    const res = await processAs(A);
    expect(res.status).toBe(200);
    expect(processMessage).toHaveBeenCalledTimes(1);
  });

  test('ligado (global) → /process responde 503 e NÃO chama o orquestrador', async () => {
    expect((await setKill({ feature: 'ai', enabled: true })).status).toBe(200);
    const res = await processAs(A);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('kill_switch');
    expect(processMessage).not.toHaveBeenCalled();
  });

  test('ligado só para um usuário → os outros seguem funcionando', async () => {
    expect((await setKill({ feature: 'ai', enabled: true, userId: B.user })).status).toBe(200);
    expect((await processAs(B)).status).toBe(503);
    expect((await processAs(A)).status).toBe(200);
  });
});

describe('IA-04 — kill switch "autopilot"', () => {
  test('ligado → a sugestão continua, mas a guarda nega o auto-envio', async () => {
    expect((await setKill({ feature: 'autopilot', enabled: true })).status).toBe(200);
    const res = await processAs(A);
    expect(res.status).toBe(200);
    expect(res.body.metadata.autopilot.allowAutoSend).toBe(false);
    expect(res.body.metadata.autopilot.primaryReason).toBe('kill_switch');
  });
});

describe('IA-04 — chave e persistência', () => {
  test('produção sem ADMIN_KILL_SWITCH_KEY → a chave padrão é recusada', async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevKey = process.env.ADMIN_KILL_SWITCH_KEY;
    process.env.NODE_ENV = 'production';
    delete process.env.ADMIN_KILL_SWITCH_KEY;
    try {
      const res = await request(app)
        .post('/api/v1/admin/kill-switch/set')
        .set(auth(ADM))
        .send({ adminKey: 'CHANGE_ME_IN_PRODUCTION', feature: 'ai', enabled: true });
      expect(res.status).not.toBe(200);
    } finally {
      process.env.NODE_ENV = prevEnv;
      process.env.ADMIN_KILL_SWITCH_KEY = prevKey;
    }
  });

  test('o estado sobrevive a um restart (nova instância do módulo)', async () => {
    expect((await setKill({ feature: 'ai', enabled: true })).status).toBe(200);
    let freshApp;
    jest.isolateModules(() => {
      freshApp = buildApp({ '/api/v1/admin/kill-switch': require('../../src/routes/admin-killswitch') });
    });
    const res = await request(freshApp).get('/api/v1/admin/kill-switch/status').set(auth(A));
    expect(res.status).toBe(200);
    expect(res.body.killSwitch.ai).toBe(true);
  });
});
