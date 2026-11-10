/**
 * LIC-01 — a extensão trazia uma chave-mestra fixa no código.
 *
 * subscription-manager.js comparava o que o cliente digitava com
 * CONFIG.masterKey e, se batesse, ativava o plano Enterprise com 999.999
 * créditos LOCALMENTE, sem perguntar ao servidor. Todo cliente recebe o código
 * da extensão (dá para ler a chave), então qualquer um liberava as funções
 * pagas de graça. O servidor já valida a chave-mestra (só quando
 * SUBSCRIPTION_MASTER_KEY está configurada; em produção sem ela, recusa):
 * quem decide tem de ser ele.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const EXT = path.join(__dirname, '../..');
const SRC = fs.readFileSync(path.join(EXT, 'modules/subscription-manager.js'), 'utf8');
const CHAVE_ANTIGA = ['Cristi', '@no123'].join(''); // a que vinha embutida

function carregar(respostaDoServidor) {
  const store = { whl_backend_url: 'https://api.exemplo.test' };
  const pedidos = [];
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    chrome: { storage: { local: {
      get: (k, cb) => { const r = {}; (Array.isArray(k) ? k : [k]).forEach((x) => { if (store[x] !== undefined) r[x] = store[x]; }); if (cb) { cb(r); return undefined; } return Promise.resolve(r); },
      set: (o, cb) => { Object.assign(store, o); if (cb) { cb(); return undefined; } return Promise.resolve(); },
      remove: (k, cb) => { if (cb) cb(); return Promise.resolve(); },
    } }, runtime: { sendMessage() {}, onMessage: { addListener() {} } } },
    fetch: async (url, opts) => {
      pedidos.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
      const { status, json } = respostaDoServidor(url, opts && opts.body ? JSON.parse(opts.body) : null);
      return { ok: status >= 200 && status < 300, status, json: async () => json };
    },
    crypto: { getRandomValues: (a) => a },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    document: { readyState: 'complete', addEventListener() {} },
    addEventListener() {},
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'subscription-manager.js' });
  return { SM: sandbox.SubscriptionManager, pedidos, store };
}

test('LIC-01: a chave-mestra fixa não libera nada sem o servidor confirmar', async () => {
  // produção sem SUBSCRIPTION_MASTER_KEY: o servidor não reconhece a chave
  const { SM, pedidos } = carregar(() => ({ status: 404, json: { valid: false, code: 'CODE_NOT_FOUND', message: 'Código de assinatura inválido.' } }));
  const r = await SM.activateSubscription(CHAVE_ANTIGA);
  assert.strictEqual(r.success, false, `ativou sem o servidor: ${JSON.stringify(r)}`);
  assert.ok(pedidos.some((p) => /subscription\/validate/.test(p.url)), 'nem perguntou ao servidor');
});

test('LIC-01: a chave-mestra não está no código da extensão', () => {
  assert.ok(!SRC.includes(CHAVE_ANTIGA) && !/masterKey\s*:/.test(SRC), 'a chave continua no código entregue ao cliente');
});

test('LIC-01 (controle): servidor configurado reconhece a chave-mestra → ativa', async () => {
  const { SM, pedidos } = carregar((url, body) => (/subscription\/validate/.test(url) && body && body.code === 'chave-do-dono'
    ? { status: 200, json: { valid: true, plan: 'enterprise', status: 'active', credits: 999999, isMasterKey: true } }
    : { status: 401, json: { error: 'x' } }));
  const r = await SM.activateSubscription('chave-do-dono');
  assert.strictEqual(r.success, true, JSON.stringify(r));
  assert.ok(pedidos.some((p) => p.body && p.body.code === 'chave-do-dono'), 'mandou a chave alterada (maiúsculas?)');
});

test('LIC-01 (controle): código comprado digitado em minúsculas continua funcionando', async () => {
  const { SM, pedidos } = carregar((url, body) => (body && body.code === 'WHL-ABCD-EFGH-JKLM'
    ? { status: 200, json: { valid: true, plan: 'pro', status: 'active', credits: 1000 } }
    : { status: 404, json: { valid: false } }));
  const r = await SM.activateSubscription('whl-abcd-efgh-jklm');
  assert.strictEqual(r.success, true, JSON.stringify(pedidos.map((p) => p.body)));
});
