/**
 * IA-44 — o content.js tem o abridor de conversa robusto (openChatByPhone:
 * delega ao mundo da página pelo mesmo caminho do Disparo, com reservas por
 * DOM e busca), mas o declarava dentro da função fechada e nunca o punha em
 * window. O Autopilot, que roda no mesmo mundo isolado, procura
 * window.openChatByPhone e — sem achar — recarregava o WhatsApp Web por link.
 *
 * Carrega o content.js REAL (todas as partes, na ordem do build-manifest.json)
 * num ambiente permissivo e confere a exportação e o caminho pela página.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const EXT = path.join(__dirname, '../..');

function contentParts() {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'build-manifest.json'), 'utf8'));
  const lists = [];
  (function walk(o) {
    if (Array.isArray(o)) { if (o.some((x) => typeof x === 'string' && x.startsWith('content/content-parts/'))) lists.push(o); return; }
    if (o && typeof o === 'object') Object.values(o).forEach(walk);
  })(manifest);
  return lists[0].filter((f) => typeof f === 'string' && f.startsWith('content/content-parts/'));
}

// Objeto que aceita qualquer acesso/chamada (DOM, chrome.*) — só para o
// content.js carregar fora do navegador.
function anything(name) {
  const f = function () { return anything(`${name}()`); };
  return new Proxy(f, {
    get(t, p) {
      if (p === 'then') return undefined;
      if (p === Symbol.toPrimitive) return () => '';
      if (p === Symbol.iterator) return function* () {};
      if (p in t) return t[p];
      return anything(`${name}.${String(p)}`);
    },
    apply() { return anything(`${name}()`); },
    construct() { return anything(`new ${name}`); },
    set(t, p, v) { t[p] = v; return true; },
  });
}

function loadContent() {
  const posted = [];
  const listeners = [];
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    document: anything('document'),
    location: { href: 'https://web.whatsapp.com/', origin: 'https://web.whatsapp.com', search: '', hostname: 'web.whatsapp.com' },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    chrome: anything('chrome'),
    URLSearchParams, URL, TextEncoder, TextDecoder, AbortController, queueMicrotask, structuredClone,
    performance: { now: () => Date.now() },
    MutationObserver: class { observe() {} disconnect() {} },
    XMLHttpRequest: class { open() {} send() {} setRequestHeader() {} addEventListener() {} },
    Event: class { constructor(t) { this.type = t; } },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    KeyboardEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
    MouseEvent: class { constructor(t) { this.type = t; } },
    InputEvent: class { constructor(t) { this.type = t; } },
    HTMLElement: class {}, Node: class {}, Element: class {},
    getComputedStyle: () => ({}), matchMedia: () => ({ matches: false, addEventListener() {} }),
    crypto: { randomUUID: () => 'u', getRandomValues: (a) => a },
    Blob: class {}, FileReader: class {}, Image: class {}, Audio: class {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0,
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    postMessage: (d) => posted.push(d),
    navigator: { userAgent: 'node-test', clipboard: anything('clipboard') },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  const src = contentParts().map((f) => fs.readFileSync(path.join(EXT, f), 'utf8')).join('\n;\n');
  vm.runInContext(src, sandbox, { filename: 'content.js' });
  const win = vm.runInContext('window', sandbox);
  return { sandbox, win, posted, listeners };
}

test('IA-44: o content.js exporta window.openChatByPhone (o abridor que o Autopilot procura)', () => {
  const { sandbox } = loadContent();
  assert.strictEqual(typeof sandbox.openChatByPhone, 'function', 'window.openChatByPhone não existe — o Autopilot cai no link que recarrega o WhatsApp');
});

test('IA-44: window.openChatByPhone abre pelo mundo da página (mesmo caminho do Disparo), sem navegar', async () => {
  const { sandbox, win, posted, listeners } = loadContent();
  assert.strictEqual(typeof sandbox.openChatByPhone, 'function');
  const done = sandbox.openChatByPhone('5511988887777');
  await new Promise((r) => setImmediate(r));
  const req = posted.find((d) => d && d.type === 'WHL_OPEN_CHAT_DIRECT');
  assert.ok(req, `não pediu ao mundo da página; mensagens: ${JSON.stringify(posted.map((d) => d && d.type))}`);
  assert.strictEqual(String(req.phone).replace(/\D/g, ''), '5511988887777');
  listeners.slice().forEach((fn) => fn({ source: win, data: { type: 'WHL_OPEN_CHAT_DIRECT_RESULT', requestId: req.requestId, success: true } }));
  assert.strictEqual(await done, true);
});
