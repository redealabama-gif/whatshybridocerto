'use strict';

/**
 * IA-11 (teto de tentativas) — provedor respondendo 500 rápido não pode
 * multiplicar o custo. Depois do prazo global, ainda eram 11 chamadas por
 * sugestão (audit/evidencias/fase2/matriz/20-backend-cenarios-depois.md, S3
 * "500"): até 4 tentativas no classificador e 4 em cada provedor de geração.
 */

const http = require('http');
const { AIRouterService } = require('../../src/ai/services/AIRouterService');
const HybridIntentClassifier = require('../../src/ai/classifiers/HybridIntentClassifier');

let server;
let base;
let hits = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits++;
    req.resume();
    req.on('end', () => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'erro interno do provedor' } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/v1`;
});

afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => { hits = 0; });

test('AIRouter: provedores com 500 → no máximo 3 chamadas (1 nova tentativa no principal + 1 no reserva)', async () => {
  const router = new AIRouterService({
    openai: { apiKey: 'k-openai', baseUrl: base },
    groq: { apiKey: 'k-groq', baseUrl: base },
  });
  await expect(router.complete([{ role: 'user', content: 'oi' }], { tenantId: 't-cap' })).rejects.toThrow();
  expect(hits).toBeLessThanOrEqual(3);
}, 60000);

test('classificador de intenção: LLM com 500 → 1 chamada e cai no regex', async () => {
  const clf = new HybridIntentClassifier({ openaiApiKey: 'k-openai' });
  clf.llmProvider.baseUrl = base;
  const r = await clf.classify('Comprei semana passada e até agora não chegou, estou bem chateado');
  expect(hits).toBe(1);
  expect(r.source).toBe('regex_fallback');
}, 60000);
