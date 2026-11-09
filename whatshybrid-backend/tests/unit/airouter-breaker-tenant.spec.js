'use strict';

/**
 * IA-12 — falhas de um cliente não podem desligar a IA dos outros.
 * Antes (audit/evidencias/20-backend-cenarios.md, S3): depois de as chamadas do
 * cliente B falharem (provedor com 500), o cliente A — com o provedor já OK —
 * recebia "No AI provider available" por 30 s (cooldown global por provedor)
 * e o orquestrador devolvia o texto cru da base com allowAutoSend:true.
 */

const http = require('http');
const { AIRouterService } = require('../../src/ai/services/AIRouterService');
const { evaluateAutoSend } = require('../../src/ai/safety/AutopilotGuard');

let server;
let base;
let mode = 'ok';
let hits = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits++;
    req.resume();
    req.on('end', () => {
      if (mode === 'fail') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'provedor fora do ar' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'x', model: 'gpt-4o-mini',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Bom dia! Tudo ótimo por aqui.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
      }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/v1`;
});

afterAll(() => new Promise((r) => server.close(r)));

function makeRouter() {
  const router = new AIRouterService({
    openai: { apiKey: 'k-openai', baseUrl: base, timeout: 2000 },
    groq: { apiKey: 'k-groq', baseUrl: base, timeout: 2000 },
  });
  for (const p of router.providers.values()) p.maxRetries = 0; // teste rápido
  return router;
}

const MSGS = [{ role: 'user', content: 'Bom dia, tudo bem?' }];

test('falhas do cliente B não deixam o cliente A sem IA', async () => {
  const router = makeRouter();
  mode = 'fail';
  await expect(router.complete(MSGS, { tenantId: 'tenant-B' })).rejects.toThrow();
  mode = 'ok';
  hits = 0;
  const r = await router.complete(MSGS, { tenantId: 'tenant-A' });
  expect(r.content).toBe('Bom dia! Tudo ótimo por aqui.');
  expect(hits).toBe(1);
});

test('controle: o próprio cliente B fica em espera (não martela o provedor)', async () => {
  const router = makeRouter();
  mode = 'fail';
  await expect(router.complete(MSGS, { tenantId: 'tenant-B' })).rejects.toThrow();
  mode = 'ok';
  hits = 0;
  await expect(router.complete(MSGS, { tenantId: 'tenant-B' })).rejects.toThrow(/No AI provider available/);
  expect(hits).toBe(0);
});

test('resposta de fallback da base (IA indisponível) → guarda nega o envio automático', () => {
  const g = evaluateAutoSend({ intent: 'greeting', message: 'Bom dia, tudo bem?', knowledgeCount: 3, llmFallback: true });
  expect(g.allowAutoSend).toBe(false);
  expect(g.reasons).toContain('llm_unavailable');
});
