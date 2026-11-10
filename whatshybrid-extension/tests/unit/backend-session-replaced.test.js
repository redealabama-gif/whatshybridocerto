/**
 * LIC-02 (extensão) — uma sessão ativa por conta.
 *
 * O servidor passa a derrubar a sessão da extensão quando a mesma conta entra
 * pela extensão em outro computador (401 SESSION_REPLACED). A extensão precisa:
 *  - se identificar no login (client: 'extension');
 *  - ao ser derrubada, limpar a sessão e avisar o usuário — sem travar: a
 *    chamada de renovação, ao receber 401, tentava renovar de novo e ficava
 *    esperando por ela mesma.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const SRC = fs.readFileSync(path.join(__dirname, '../../modules/backend-client.js'), 'utf8');

function carregar(responder) {
  const store = { whl_backend_client: JSON.stringify({ baseUrl: 'https://api.exemplo.test', accessToken: 'tok-A', refreshToken: 'ref-A', user: { id: 'u1' } }) };
  const pedidos = []; const eventos = []; const avisos = [];
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    document: { readyState: 'complete', addEventListener() {}, getElementById: () => null, querySelector: () => null },
    location: { origin: 'https://web.whatsapp.com' },
    addEventListener() {}, removeEventListener() {},
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    AbortController, URL, URLSearchParams,
    EventBus: { emit: (e, d) => eventos.push([e, d]), on() {} },
    NotificationsModule: { toast: (msg) => avisos.push(msg) },
    fetch: async (url, opts) => {
      const body = opts && opts.body ? JSON.parse(opts.body) : null;
      pedidos.push({ url: String(url), body });
      const { status, json } = responder(String(url), body);
      return { ok: status >= 200 && status < 300, status, json: async () => json };
    },
    chrome: {
      runtime: { id: 'x', sendMessage() { throw new Error('sem proxy'); }, onMessage: { addListener() {} } },
      storage: { local: {
        get: async (keys) => { const out = {}; (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) out[k] = store[k]; }); return out; },
        set: async (o) => { Object.assign(store, o); }, remove: async () => {},
      }, onChanged: { addListener() {} } },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'backend-client.js' });
  return { client: sandbox.BackendClient, pedidos, eventos, avisos, store };
}
const prazo = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`travou (${ms} ms)`)), ms))]);

test('LIC-02: o login da extensão se identifica como extensão', async () => {
  const { client, pedidos } = carregar((url) => (/auth\/login$/.test(url)
    ? { status: 200, json: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1' }, workspace: { id: 'w1' } } }
    : { status: 200, json: { status: 'ok' } }));
  await client.login('cliente@example.com', 'Senha#2026');
  const login = pedidos.find((p) => /auth\/login$/.test(p.url));
  assert.ok(login, 'não chamou o login');
  assert.strictEqual(login.body.client, 'extension');
});

test('LIC-02: derrubada por login em outro computador → sai, avisa e não trava', async () => {
  const replaced = { status: 401, json: { error: 'Unauthorized', code: 'SESSION_REPLACED', message: 'Sua conta foi conectada em outro computador' } };
  let derrubada = false; // o login no outro computador acontece depois que esta extensão já abriu
  const { client, eventos, avisos, store } = carregar((url) => {
    if (/health/.test(url)) return { status: 200, json: { status: 'ok' } };
    if (!derrubada) return { status: 200, json: { user: { id: 'u1' }, workspace: { id: 'w1' } } };
    return replaced;
  });
  await client.init(); // carrega a sessão salva (a extensão faz isso 500 ms depois de abrir)
  assert.ok(client.isConnected(), 'a sessão salva não carregou');
  derrubada = true;
  await prazo(client.get('/api/v1/auth/me').catch(() => null), 3000);
  const salvo = JSON.parse(store.whl_backend_client);
  assert.strictEqual(salvo.accessToken, null, 'continuou com o token da sessão derrubada');
  assert.ok(eventos.some(([e, d]) => e === 'backend:disconnected' && d && d.reason === 'session_replaced'), JSON.stringify(eventos));
  assert.ok(avisos.some((m) => /outro computador/i.test(m)), `aviso ao usuário: ${JSON.stringify(avisos)}`);
});
