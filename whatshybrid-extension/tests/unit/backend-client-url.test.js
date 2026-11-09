/**
 * IA-13 — o BackendClient nunca troca a URL do backend definida pelo usuário
 * por http://localhost:3000. Antes: /health falhando no boot, ou 3 falhas
 * seguidas (blip de rede, deploy), gravavam localhost no lugar da URL
 * configurada e a "inteligência avançada" parava até alguém reconfigurar.
 *
 * Carrega o modules/backend-client.js REAL num contexto vm; fetch sempre falha.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const SRC = fs.readFileSync(path.join(__dirname, '../../modules/backend-client.js'), 'utf8');
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

function loadClient(persistedUrl) {
  const store = { whl_backend_client: JSON.stringify({ baseUrl: persistedUrl, accessToken: 'tok' }) };
  const writes = [];
  const sandbox = {
    console: quiet,
    document: { readyState: 'complete', addEventListener() {} },
    location: { origin: 'https://web.whatsapp.com' },
    addEventListener() {}, removeEventListener() {},
    setTimeout: (fn) => setImmediate(fn), clearTimeout() {},
    setInterval: () => 0, clearInterval() {},
    AbortController, URL,
    fetch: async () => { throw new TypeError('Failed to fetch'); },
    chrome: {
      runtime: { id: 'x', sendMessage() {}, onMessage: { addListener() {} } },
      storage: {
        local: {
          get: async (keys) => {
            const list = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const k of list) if (k in store) out[k] = store[k];
            return out;
          },
          set: async (o) => { writes.push(o); Object.assign(store, o); },
          remove: async () => {},
        },
        onChanged: { addListener() {} },
      },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'backend-client.js' });
  return { client: sandbox.BackendClient, writes, store };
}

const settle = () => new Promise((r) => setTimeout(r, 50));
const storedUrl = (store) => { try { return JSON.parse(store.whl_backend_client).baseUrl; } catch (_) { return null; } };

test('IA-13: /health falhando no boot NÃO troca a URL do usuário por localhost', async () => {
  const { client, store } = loadClient('https://api.minhaloja.com.br');
  await settle();
  assert.strictEqual(client.getBaseUrl(), 'https://api.minhaloja.com.br');
  assert.strictEqual(storedUrl(store), 'https://api.minhaloja.com.br');
});

test('IA-13: falhas seguidas (failover) NÃO trocam a URL do usuário por localhost', async () => {
  const { client, store } = loadClient('https://api.minhaloja.com.br');
  await settle();
  for (let i = 0; i < 3; i++) {
    try { await client.get('/api/v1/ai/credits'); } catch (_) { /* esperado: backend fora */ }
  }
  await settle();
  assert.strictEqual(client.getBaseUrl(), 'https://api.minhaloja.com.br');
  assert.strictEqual(storedUrl(store), 'https://api.minhaloja.com.br');
});

test('IA-13 (controle): URL local morta de versão antiga (localhost:3001) continua sendo corrigida no boot', async () => {
  const { client } = loadClient('http://localhost:3001');
  await settle();
  assert.strictEqual(client.getBaseUrl(), 'http://localhost:3000');
});
