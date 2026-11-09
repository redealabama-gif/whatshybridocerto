/**
 * Integração — IA-41: /api/v1/ai/complete (o MÉTODO 3 do popup de sugestão).
 *
 * Antes: a cadeia "normal" começava pela Groq com llama-3.3-70b-versatile, que
 * a Groq desativou (404). isRetryableError tratava 404 — e chave revogada
 * (401/403) — como "erro definitivo" e abortava SEM tentar a OpenAI, mesmo com
 * a chave da OpenAI funcionando. Com as chaves reais: 404 em todas as
 * conversas (audit/evidencias/chaves-reais/antes.md).
 *
 * As chamadas HTTP aos provedores (axios.post) são substituídas por um dublê;
 * rota, autenticação, assinatura, saldo e banco são reais.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const { ensureDb, buildApp, database, cleanupDb } = require('./helpers/app');
const config = require('../../config');

const T = { ws: 'ws-ai-complete', user: 'user-ai-complete' };
const bearer = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const DISPONIVEIS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];

let app;
let calls;
const saved = {};

function providerError(status, message, code) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data: { error: { message, code } } };
  return err;
}
function mockProviders(groqBehavior) {
  calls = [];
  jest.spyOn(axios, 'post').mockImplementation(async (url, body) => {
    calls.push({ url, body });
    if (url.includes('groq.com')) return groqBehavior();
    return { data: { choices: [{ message: { content: 'Resposta da OpenAI' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } };
  });
}
const complete = () => request(app).post('/api/v1/ai/complete')
  .set({ Authorization: `Bearer ${bearer(T.user)}` })
  .send({ messages: [{ role: 'user', content: 'Esse rastreio é da transportadora Jet' }], temperature: 0.7, maxTokens: 320 });

beforeAll(async () => {
  saved.groq = config.ai.groq.apiKey;
  saved.openai = config.ai.openai.apiKey;
  config.ai.groq.apiKey = 'gsk-teste';
  config.ai.openai.apiKey = 'sk-teste';
  await ensureDb();
  for (const tbl of ['workspace_credits', 'workspaces', 'users']) {
    try { database.run(`DELETE FROM ${tbl}`); } catch (_) { /* driver */ }
  }
  database.run(
    `INSERT INTO users (id, email, password, name, role, status, workspace_id) VALUES (?, ?, ?, ?, 'owner', 'active', ?)`,
    [T.user, `${T.user}@example.com`, 'x', 'Owner complete', T.ws]
  );
  database.run(
    `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status) VALUES (?, ?, ?, 'pro', 'active')`,
    [T.ws, 'WS complete', T.user]
  );
  database.run('INSERT INTO workspace_credits (workspace_id, tokens_total, tokens_used) VALUES (?, 100000, 0)', [T.ws]);
  app = buildApp({ '/api/v1/ai': require('../../src/routes/ai') });
});

afterAll(() => {
  config.ai.groq.apiKey = saved.groq;
  config.ai.openai.apiKey = saved.openai;
  return cleanupDb();
});
afterEach(() => jest.restoreAllMocks());

describe('IA-41 — a falha da Groq não derruba a sugestão', () => {
  test('modelo desativado na Groq (404) → cai para a OpenAI', async () => {
    mockProviders(() => { throw providerError(404, 'The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.', 'model_not_found'); });
    const res = await complete();
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('Resposta da OpenAI');
    expect(calls.map((c) => (c.url.includes('groq') ? 'groq' : 'openai'))).toEqual(['groq', 'openai']);
  });

  test('chave da Groq revogada (401) → cai para a OpenAI', async () => {
    mockProviders(() => { throw providerError(401, 'Invalid API Key', 'invalid_api_key'); });
    const res = await complete();
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('Resposta da OpenAI');
  });

  test('Groq devolve texto vazio (raciocínio consumiu o limite) → cai para a OpenAI', async () => {
    mockProviders(() => ({ data: { choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 100 } } }));
    const res = await complete();
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('Resposta da OpenAI');
  });

  test('a Groq recebe um modelo que existe hoje, com raciocínio baixo e espaço para a resposta', async () => {
    mockProviders(() => ({ data: { choices: [{ message: { content: 'Beleza, vou acompanhar pela Jet.' } }], usage: { prompt_tokens: 10, completion_tokens: 8 } } }));
    const res = await complete();
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('Beleza, vou acompanhar pela Jet.');
    const groqCall = calls.find((c) => c.url.includes('groq'));
    expect(DISPONIVEIS).toContain(groqCall.body.model);
    expect(groqCall.body.reasoning_effort).toBe('low');
    expect(groqCall.body.max_tokens).toBeGreaterThanOrEqual(512);
  });
});
