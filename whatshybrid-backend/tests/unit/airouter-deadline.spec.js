'use strict';

/**
 * IA-11 — provedor lento não pode segurar a requisição nem multiplicar o custo.
 * Antes (audit/evidencias/22-provedor-lento.txt): 501 s e 12 chamadas para UMA
 * sugestão — 4 tentativas no classificador de intenção + 4 na OpenAI + 4 na
 * Groq, cada uma esperando o timeout inteiro (40 s) e com backoff.
 *
 * Um servidor HTTP local que NUNCA responde faz o papel do provedor travado.
 */

const http = require('http');
const { AIRouterService } = require('../../src/ai/services/AIRouterService');
const HybridIntentClassifier = require('../../src/ai/classifiers/HybridIntentClassifier');

let server;
let base;
let hits = 0;
const sockets = new Set();

beforeAll(async () => {
  server = http.createServer(() => { hits++; /* nunca responde */ });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/v1`;
});

afterAll(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));
});

beforeEach(() => { hits = 0; });

test('AIRouter: provedores travados → desiste no prazo global e não repete', async () => {
  const router = new AIRouterService({
    openai: { apiKey: 'k-openai', baseUrl: base, timeout: 1500 },
    groq: { apiKey: 'k-groq', baseUrl: base, timeout: 1500 },
  });
  const t0 = Date.now();
  await expect(router.complete([{ role: 'user', content: 'oi' }], { deadlineMs: 2500 })).rejects.toThrow();
  const elapsed = Date.now() - t0;
  expect({ chamadas: hits, segundos: Math.round(elapsed / 100) / 10 }).toEqual({
    chamadas: expect.any(Number), segundos: expect.any(Number),
  });
  expect(hits).toBeLessThanOrEqual(2);
  expect(elapsed).toBeLessThan(4500);
}, 90000);

test('classificador de intenção: LLM travado → 1 tentativa curta e cai no regex', async () => {
  const clf = new HybridIntentClassifier({ openaiApiKey: 'k-openai' });
  clf.llmProvider.baseUrl = base;
  clf.llmProvider.timeout = 3000;
  const t0 = Date.now();
  const r = await clf.classify('Comprei semana passada e até agora não chegou, estou bem chateado');
  const elapsed = Date.now() - t0;
  expect(hits).toBe(1);
  expect(elapsed).toBeLessThan(6000);
  expect(r.source).toBe('regex_fallback');
}, 90000);
