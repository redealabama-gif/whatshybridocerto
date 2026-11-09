/**
 * IA-10 (extensão) — o service worker só diz "sincronizado" quando o backend
 * confirma (success !== false). Antes decidia só por response.ok: um 200 com
 * success:false (falha ao gravar o treinamento) aparecia como sucesso.
 *
 * Carrega o background.js REAL num contexto vm com chrome stubado.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const SRC = fs.readFileSync(path.join(__dirname, '../../background.js'), 'utf8');
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

// chrome genérico: qualquer API vira função no-op que devolve Promise resolvida.
function anyApi() {
  const f = function () { return Promise.resolve(undefined); };
  return new Proxy(f, {
    get(t, p) {
      if (p === 'then') return undefined;
      if (!(p in t)) t[p] = anyApi();
      return t[p];
    },
  });
}

function loadBackground(fetchImpl) {
  const chrome = anyApi();
  chrome.storage = {
    local: {
      get: async () => ({ whl_backend_client: JSON.stringify({ baseUrl: 'http://backend.test', accessToken: 'tok' }) }),
      set: async () => {},
    },
    session: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener() {} },
  };
  const sandbox = {
    console: quiet, chrome, importScripts() {}, fetch: fetchImpl,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    self: { addEventListener() {} }, navigator: { userAgent: 'node-test' },
    URL, AbortController, TextEncoder, TextDecoder,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'background.js' });
  return sandbox;
}

function callSync(sw) {
  return new Promise((resolve) => {
    sw.handleSyncTrainingData({ data: { faqs: [{ id: '1', question: 'q', answer: 'a' }] } }, {}, resolve);
  });
}

test('IA-10: backend responde 200 com success:false → NÃO diz "sincronizado"', async () => {
  const sw = loadBackground(async () => ({
    ok: true, status: 200,
    json: async () => ({ success: false, synced: { faqs: 0 }, errors: ['faqs: UNIQUE constraint failed: faqs.id'] }),
  }));
  assert.strictEqual(typeof sw.handleSyncTrainingData, 'function', 'handleSyncTrainingData não encontrado no background.js');
  const r = JSON.parse(JSON.stringify(await callSync(sw)));
  assert.strictEqual(r.success, false, `mostrou sucesso: ${JSON.stringify(r)}`);
  assert.match(String(r.error || ''), /UNIQUE|falh/i);
});

test('IA-10 (controle): backend confirma (success:true) → "sincronizado"', async () => {
  const sw = loadBackground(async () => ({
    ok: true, status: 200,
    json: async () => ({ success: true, synced: { faqs: 1 } }),
  }));
  const r = JSON.parse(JSON.stringify(await callSync(sw)));
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.synced, 'backend');
});
