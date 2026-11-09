/**
 * Integração — IA-40: /api/v2/ai/process com a fila ligada (Redis, como no
 * docker compose) e o worker fora do ar.
 *
 * Antes: a rota enfileirava e esperava o job por até AI_QUEUE_WAIT_MS (45 s)
 * mesmo sem nenhum worker consumindo a fila; só então caía no caminho
 * síncrono. A extensão desiste em 30 s e mostrava uma frase pronta
 * ("Ok! Em que posso ser útil?"). Com Redis e o backend real, sem o ai-worker:
 * cerca de 49 s (audit/evidencias/chaves-reais/fila-sem-worker-antes.md).
 *
 * A fila do BullMQ é substituída por um dublê com o mesmo contrato
 * (getWorkersCount, add, waitUntilFinished com TTL, getState, remove).
 */

const mockWorkerModule = { queues: {}, queueEvents: {}, QUEUES: { REALTIME: 'ai-realtime' } };
jest.mock('../../src/jobs/ai-worker', () => mockWorkerModule);

const request = require('supertest');
const jwt = require('jsonwebtoken');

const { ensureDb, buildApp, database, cleanupDb } = require('./helpers/app');

const T = { ws: 'ws-ai-fila', user: 'user-ai-fila' };
const bearer = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

let app;
let processMessage;
const saved = {};

function fakeQueue({ workers, state, finish }) {
  const job = {
    // Igual ao BullMQ: sem worker, rejeita quando o TTL acaba.
    waitUntilFinished: jest.fn((_events, ttl) => finish
      ? new Promise((resolve) => setTimeout(() => resolve(finish), 50))
      : new Promise((_, reject) => setTimeout(() => reject(new Error('Job wait timed out')), ttl))),
    getState: jest.fn(async () => state),
    remove: jest.fn(async () => {}),
  };
  const queue = { getWorkersCount: jest.fn(async () => workers), add: jest.fn(async () => job) };
  mockWorkerModule.queues['ai-realtime'] = queue;
  mockWorkerModule.queueEvents['ai-realtime'] = {};
  return { queue, job };
}

async function processTimed() {
  const t0 = Date.now();
  const res = await request(app).post('/api/v2/ai/process')
    .set({ Authorization: `Bearer ${bearer(T.user)}` })
    .send({ chatId: '5511999990000@c.us', message: 'Qual o prazo de entrega?', history: [] });
  return { res, ms: Date.now() - t0 };
}

beforeAll(async () => {
  for (const k of ['REDIS_DISABLED', 'AI_QUEUE_WAIT_MS', 'AI_QUEUE_PICKUP_MS']) saved[k] = process.env[k];
  process.env.AI_QUEUE_WAIT_MS = '4000';
  process.env.AI_QUEUE_PICKUP_MS = '300';
  await ensureDb();
  for (const tbl of ['workspace_credits', 'workspaces', 'users']) {
    try { database.run(`DELETE FROM ${tbl}`); } catch (_) { /* driver */ }
  }
  database.run(
    `INSERT INTO users (id, email, password, name, role, status, workspace_id) VALUES (?, ?, ?, ?, 'owner', 'active', ?)`,
    [T.user, `${T.user}@example.com`, 'x', 'Owner fila', T.ws]
  );
  database.run(
    `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status) VALUES (?, ?, ?, 'pro', 'active')`,
    [T.ws, 'WS fila', T.user]
  );
  database.run('INSERT INTO workspace_credits (workspace_id, tokens_total, tokens_used) VALUES (?, 100000, 0)', [T.ws]);
  const registry = require('../../src/registry/OrchestratorRegistry');
  jest.spyOn(registry, 'get').mockImplementation(() => ({ processMessage: (...a) => processMessage(...a) }));
  app = buildApp({ '/api/v2/ai': require('../../src/routes/ai-v2') });
  // Depois de montar o app: a rota lê REDIS_DISABLED a cada requisição, e o
  // limitador de requisições não tenta abrir um Redis de verdade no carregamento.
  process.env.REDIS_DISABLED = 'false';
});

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return cleanupDb();
});

beforeEach(() => {
  processMessage = jest.fn(async () => ({ success: true, response: 'resposta pelo caminho síncrono', metadata: {} }));
});

describe('IA-40 — fila ligada', () => {
  test('nenhum worker na fila → responde na hora pelo caminho síncrono, sem enfileirar', async () => {
    const { queue } = fakeQueue({ workers: 0, state: 'prioritized' });
    const { res, ms } = await processTimed();
    expect(res.status).toBe(200);
    expect(res.body.response).toBe('resposta pelo caminho síncrono');
    expect(queue.add).not.toHaveBeenCalled();
    expect(ms).toBeLessThan(2000);
  });

  test('worker registrado, mas ninguém pega o job → tira da fila e responde pelo síncrono', async () => {
    const { job } = fakeQueue({ workers: 1, state: 'prioritized' });
    const { res, ms } = await processTimed();
    expect(res.status).toBe(200);
    expect(res.body.response).toBe('resposta pelo caminho síncrono');
    expect(job.remove).toHaveBeenCalledTimes(1);
    expect(ms).toBeLessThan(2000);
  });

  test('controle: worker pega o job → a resposta vem da fila, sem rodar de novo no síncrono', async () => {
    const { job } = fakeQueue({ workers: 1, state: 'active', finish: { success: true, response: 'resposta pelo worker', metadata: {} } });
    const { res } = await processTimed();
    expect(res.status).toBe(200);
    expect(res.body.response).toBe('resposta pelo worker');
    expect(job.remove).not.toHaveBeenCalled();
    expect(processMessage).not.toHaveBeenCalled();
  });
});
