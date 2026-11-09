/**
 * IA-15 — o cache local de respostas não pode servir a resposta personalizada
 * de um cliente para outro. A chave era intent|entities|sentiment|category,
 * sem o chat: com perguntas parecidas (similaridade ≥ 0,7), o cliente B
 * recebia a resposta gerada para o cliente A ("Oi Maria, seu pedido…").
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const SRC = fs.readFileSync(path.join(__dirname, '../../modules/ai-response-cache.js'), 'utf8');
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

function loadCache() {
  const sandbox = {
    console: quiet, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } },
    addEventListener() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'ai-response-cache.js' });
  return new sandbox.AIResponseCache();
}

const CTX = { intent: 'order_status', entities: ['pedido'], sentiment: 0, category: 'pedidos' };
const ASK_A = 'Qual o status do meu pedido?';
const ASK_B = 'Qual o status do meu pedido??';
const ANSWER_A = 'Oi Maria! Seu pedido 1234 saiu para entrega hoje.';

test('IA-15: resposta cacheada para o cliente A NÃO é servida ao cliente B', async () => {
  const cache = loadCache();
  cache.set(ASK_A, { ...CTX, chatId: '5511900000001@c.us' }, ANSWER_A, 0.9);
  const hit = await cache.get(ASK_B, { ...CTX, chatId: '5511900000002@c.us' });
  assert.strictEqual(hit, null, `servido ao cliente B: ${hit && hit.response}`);
});

test('IA-15 (controle): no mesmo chat o cache continua funcionando', async () => {
  const cache = loadCache();
  cache.set(ASK_A, { ...CTX, chatId: '5511900000001@c.us' }, ANSWER_A, 0.9);
  const hit = await cache.get(ASK_B, { ...CTX, chatId: '5511900000001@c.us' });
  assert.ok(hit && hit.fromCache, 'deveria ser hit no mesmo chat');
});

test('IA-15: o CopilotEngine passa o chat para o cache (get e set)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../modules/copilot-engine.js'), 'utf8');
  const calls = [...src.matchAll(/aiResponseCache\.(get|set)\(([\s\S]*?)\);/g)].map((m) => m[2]);
  assert.strictEqual(calls.length, 2, 'esperava 1 get e 1 set');
  for (const c of calls) assert.match(c, /chatId/, `chamada sem chatId: ${c.slice(0, 120)}`);
});
