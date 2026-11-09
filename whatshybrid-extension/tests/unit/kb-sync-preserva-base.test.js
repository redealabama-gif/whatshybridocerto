/**
 * IA-46 — a sincronização com o servidor apagava/revertia a base local.
 *
 * No WhatsApp Web rodam dois sincronizadores da base (whl_knowledge_base):
 *  - knowledge-base.js, 3 s depois de abrir, baixava /api/v1/knowledge e
 *    SUBSTITUÍA a base local pelo que veio. O servidor guarda ali o
 *    workspace_knowledge.data, que o /training/sync sobrescreve só com os
 *    dados do negócio → FAQs e produtos sumiam (o Autopilot ficava sem nada);
 *  - knowledge-sync-manager.js trocava a lista local pela do servidor (cópia
 *    antiga) ao abrir e gravava de volta a união do servidor depois de cada
 *    envio → FAQ nova feita com o WhatsApp fechado sumia e FAQ apagada voltava.
 * E knowledge-base.js gravava a base como TEXTO (JSON.stringify), enquanto a
 * tela de treinamento e o outro sincronizador leem como objeto.
 * Prova real: audit/evidencias/fase3/61-treinamento-tela-real.json (linhaDoTempo).
 *
 * Carrega os dois módulos REAIS (como no content.js) com chrome.storage e
 * BackendClient falsos e um relógio controlado.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const EXT = path.join(__dirname, '../..');
const KEY = 'whl_knowledge_base';

const FAQ_A = { id: 1, question: 'Qual o horário?', answer: 'Seg a sex, 8h às 18h.' };
const FAQ_B = { id: 2, question: 'Vocês parcelam?', answer: 'Em até 6x sem juros.' };
const FAQ_C = { id: 3, question: 'Aceitam convênio?', answer: 'Amil Dental e OdontoPrev.' };
const P1 = { id: 10, name: 'Limpeza', price: 180 };
const P2 = { id: 11, name: 'Clareamento dental', price: 650 };
const NEGOCIO = { name: 'Clínica Sorriso Fácil', segment: 'Odontologia', hours: 'Seg a sex 8h–18h' };
// O que o /training/sync deixa em workspace_knowledge.data: só o negócio, "achatado".
const BLOB_TREINO = { ...NEGOCIO, description: '', phone: '', paymentMethods: [], customInstructions: '' };

function serverMerge(existing, incoming) { // mesma lógica de mergeKnowledge (routes/knowledge.js)
  const out = { ...existing };
  for (const k in incoming) {
    if (Array.isArray(incoming[k])) {
      const m = new Map(); (existing[k] || []).forEach((i) => i.id && m.set(i.id, i)); incoming[k].forEach((i) => i.id && m.set(i.id, i));
      out[k] = [...m.values()];
    } else if (incoming[k] && typeof incoming[k] === 'object') out[k] = serverMerge(existing[k] || {}, incoming[k]);
    else out[k] = incoming[k];
  }
  return out;
}

function makeWorld({ local, server }) {
  const store = { [KEY]: local, whl_kb_sync_state: { lastSync: 1 } };
  const listeners = [];
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const local$ = {
    get(keys, cb) {
      const ks = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
      const r = {}; ks.forEach((k) => { if (store[k] !== undefined) r[k] = clone(store[k]); });
      if (cb) { cb(r); return undefined; } return Promise.resolve(r);
    },
    set(items, cb) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: clone(store[k]), newValue: clone(v) }; store[k] = clone(v); }
      listeners.forEach((fn) => fn(changes, 'local'));
      if (cb) { cb(); return undefined; } return Promise.resolve();
    },
    remove(k, cb) { delete store[k]; if (cb) cb(); return Promise.resolve(); },
    getBytesInUse(_k, cb) { if (cb) { cb(1000); return undefined; } return Promise.resolve(1000); },
  };
  const srv = { blob: clone(server), requests: [] };
  const BackendClient = {
    isConnected: () => true,
    async get(p) { srv.requests.push(`GET ${p}`); if (p === '/api/v1/knowledge') return { success: true, knowledge: clone(srv.blob) }; return { success: true }; },
    async post(p, body) { srv.requests.push(`POST ${p}`); return this._post(p, body); },
    async request(p, opts = {}) {
      const m = (opts.method || 'GET').toUpperCase(); srv.requests.push(`${m} ${p}`);
      if (m === 'GET' && p === '/api/v1/knowledge/sync') return { success: true, data: clone(srv.blob) };
      if (m === 'GET') return { success: true, examples: [] };
      return this._post(p, opts.body);
    },
    _post(p, body) {
      if (p === '/api/v1/knowledge/sync') {
        const incoming = typeof body.knowledge === 'string' ? body.knowledge : clone(body.knowledge);
        srv.blob = serverMerge(srv.blob || {}, incoming);
        return { success: true, knowledge: clone(srv.blob) };
      }
      return { success: true, examples: [] };
    },
  };
  // Relógio controlado
  let now = 0; let seq = 0; const timers = new Map();
  const setTimeout_ = (fn, ms) => { const id = ++seq; timers.set(id, { at: now + (ms || 0), fn }); return id; };
  const clearTimeout_ = (id) => { timers.delete(id); };
  const domReady = [];
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    chrome: { storage: { local: local$, onChanged: { addListener: (fn) => listeners.push(fn) } }, runtime: { sendMessage() {}, onMessage: { addListener() {} } } },
    document: { readyState: 'loading', addEventListener: (t, fn) => { if (t === 'DOMContentLoaded') domReady.push(fn); } },
    localStorage: { getItem: () => null },
    Blob, setTimeout: setTimeout_, clearTimeout: clearTimeout_,
    setInterval: () => 0, clearInterval() {},
    addEventListener() {},
    Date: { now: () => 1794000000000 + now },
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.BackendClient = BackendClient;
  vm.createContext(sandbox);
  for (const f of ['modules/knowledge-base.js', 'modules/knowledge-sync-manager.js']) {
    vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), sandbox, { filename: f });
  }
  async function flush() { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); }
  async function advance(ms) {
    const end = now + ms;
    for (;;) {
      await flush();
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); now = Math.max(now, due[1].at); await due[1].fn();
    }
    now = end; await flush();
  }
  async function open() { domReady.splice(0).forEach((fn) => fn()); await advance(0); }
  const stored = () => store[KEY];
  const parsed = () => (typeof store[KEY] === 'string' ? JSON.parse(store[KEY]) : store[KEY]);
  return { sandbox, srv, advance, open, stored, parsed, local$ };
}

const ids = (arr) => Array.from(arr || [], (x) => x.id).sort((a, b) => a - b); // Array do Node (o vm tem outro Array)

test('IA-46: abrir o WhatsApp depois do treino não apaga FAQs nem produtos (servidor só com dados do negócio)', async () => {
  const w = makeWorld({ local: { faq: [FAQ_A, FAQ_B, FAQ_C], products: [P1, P2], business: NEGOCIO }, server: BLOB_TREINO });
  await w.open();
  await w.advance(30000);
  assert.ok(w.srv.requests.includes('GET /api/v1/knowledge'), `o pull não rodou: ${w.srv.requests.join(', ')}`);
  const kb = w.parsed();
  assert.deepStrictEqual(ids(kb.faq), [1, 2, 3], `FAQs locais depois de abrir o WhatsApp: ${JSON.stringify(ids(kb.faq))}`);
  assert.deepStrictEqual(ids(kb.products), [10, 11], `produtos locais: ${JSON.stringify(ids(kb.products))}`);
});

test('IA-46: knowledge-base.js grava a base como objeto (a tela de treinamento lê objeto)', async () => {
  const w = makeWorld({ local: { faq: [FAQ_A], products: [], business: NEGOCIO }, server: BLOB_TREINO });
  await w.open();
  await w.advance(1000);
  await w.sandbox.knowledgeBase.saveKnowledge({ faq: [FAQ_A, FAQ_B], products: [P1], business: NEGOCIO });
  assert.strictEqual(typeof w.stored(), 'object', `gravada como ${typeof w.stored()}`);
});

test('IA-46: base antiga gravada como texto não vira centenas de chaves ao abrir o WhatsApp', async () => {
  const w = makeWorld({ local: JSON.stringify({ faq: [FAQ_A, FAQ_B], products: [P1], business: NEGOCIO }), server: { ...BLOB_TREINO, faq: [FAQ_A] } });
  await w.open();
  await w.advance(30000);
  const kb = w.parsed();
  const numericas = Object.keys(kb).filter((k) => /^\d+$/.test(k)).length;
  assert.strictEqual(numericas, 0, `${numericas} chaves de caractere na base local`);
  assert.deepStrictEqual(ids(kb.faq), [1, 2]);
});

test('IA-46: FAQ criada/editada com o WhatsApp fechado não é desfeita pela cópia antiga do servidor', async () => {
  const antiga = { ...FAQ_A, answer: 'RESPOSTA ANTIGA' };
  const w = makeWorld({ local: { faq: [FAQ_A, FAQ_B, FAQ_C], products: [P1, P2], business: NEGOCIO }, server: { faq: [antiga, FAQ_B], products: [P1], business: NEGOCIO } });
  await w.open();
  await w.advance(30000);
  const kb = w.parsed();
  assert.deepStrictEqual(ids(kb.faq), [1, 2, 3], `FAQs: ${JSON.stringify(ids(kb.faq))}`);
  assert.strictEqual(kb.faq.find((f) => f.id === 1).answer, FAQ_A.answer, 'edição local desfeita pela cópia do servidor');
  assert.deepStrictEqual(ids(kb.products), [10, 11]);
});

test('IA-46: FAQ apagada na tela não volta depois do envio ao servidor', async () => {
  const w = makeWorld({ local: { faq: [FAQ_A, FAQ_B], products: [P1], business: NEGOCIO }, server: { faq: [FAQ_A, FAQ_B], products: [P1], business: NEGOCIO } });
  await w.open();
  await w.advance(30000);
  // a tela de treinamento apaga a FAQ B (outra página grava o storage)
  await w.local$.set({ [KEY]: { ...w.parsed(), faq: [FAQ_A] } });
  await w.advance(30000);
  assert.ok(w.srv.requests.filter((r) => r === 'POST /api/v1/knowledge/sync').length >= 1, 'não enviou ao servidor');
  assert.deepStrictEqual(ids(w.parsed().faq), [1], `FAQ apagada voltou: ${JSON.stringify(ids(w.parsed().faq))}`);
});

test('IA-46 (controle): aparelho novo, base local vazia → recebe o que o servidor tem', async () => {
  const w = makeWorld({ local: undefined, server: { faq: [FAQ_A, FAQ_B], products: [P1], business: NEGOCIO } });
  await w.open();
  await w.advance(30000);
  const kb = w.parsed();
  assert.deepStrictEqual(ids(kb.faq), [1, 2]);
  assert.deepStrictEqual(ids(kb.products), [10]);
});

test('IA-46: a tela de treinamento abre com as FAQs/produtos de uma base antiga gravada como texto', async () => {
  const kbTexto = JSON.stringify({ faq: [FAQ_A, FAQ_B], products: [P1, P2], business: NEGOCIO });
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    chrome: { storage: { local: { get: async (k) => (k === KEY ? { [KEY]: kbTexto } : {}), set: async () => {} } } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'training/training.js'), 'utf8'), sandbox, { filename: 'training.js' });
  const TrainingApp = vm.runInContext('TrainingApp', sandbox);
  const tela = { updateStats() {}, showToast() {} };
  await TrainingApp.prototype.loadAllData.call(tela);
  assert.deepStrictEqual(ids(tela.faqs), [1, 2], `FAQs na tela: ${JSON.stringify(ids(tela.faqs))}`);
  assert.deepStrictEqual(ids(tela.products), [10, 11], `produtos na tela: ${JSON.stringify(ids(tela.products))}`);
});
