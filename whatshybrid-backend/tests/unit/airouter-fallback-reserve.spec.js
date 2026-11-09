'use strict';

/**
 * IA-43 — um provedor principal lento consumia o prazo inteiro da requisição
 * e o reserva nunca era tentado. Com as chaves reais: a OpenAI travou numa
 * geração, a chamada foi abortada aos 23,5 s (prazo de 25 s) e a Groq — que
 * responde em menos de 1 s — ficou de fora; o orquestrador devolveu erro
 * (audit/evidencias/chaves-reais/depois.md, cenário colega_trabalho).
 *
 * Servidores HTTP locais: o "OpenAI" nunca responde; o "Groq" responde na hora.
 */

const http = require('http');
const { AIRouterService } = require('../../src/ai/services/AIRouterService');

const servers = [];
const sockets = new Set();
let groqHits = 0;

async function listen(handler) {
  const server = http.createServer(handler);
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}/v1`;
}

let openaiBase;
let groqBase;
const saved = process.env.AI_FALLBACK_RESERVE_MS;

beforeAll(async () => {
  process.env.AI_FALLBACK_RESERVE_MS = '2000';
  openaiBase = await listen(() => { /* travado: nunca responde */ });
  groqBase = await listen((req, res) => {
    groqHits++;
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'openai/gpt-oss-120b', choices: [{ message: { content: 'Beleza, vou acompanhar pela Jet.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 } }));
    });
  });
});

afterAll(async () => {
  if (saved === undefined) delete process.env.AI_FALLBACK_RESERVE_MS; else process.env.AI_FALLBACK_RESERVE_MS = saved;
  for (const s of sockets) s.destroy();
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
});

test('principal travado → sobra tempo para o reserva responder dentro do prazo', async () => {
  const router = new AIRouterService({
    openai: { apiKey: 'k-openai', baseUrl: openaiBase, timeout: 60000 },
    groq: { apiKey: 'k-groq', baseUrl: groqBase, timeout: 60000 },
  });
  const t0 = Date.now();
  const result = await router.complete([{ role: 'user', content: 'Esse rastreio é da transportadora Jet' }], { tenantId: 't-reserva', deadlineMs: 6000 });
  const ms = Date.now() - t0;
  expect(result.content).toBe('Beleza, vou acompanhar pela Jet.');
  expect(result.fallbackFrom).toBe('openai');
  expect(groqHits).toBe(1);
  expect(ms).toBeLessThan(6000);
}, 20000);
