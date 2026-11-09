/**
 * IA-53 — a base que o Autopilot consulta no WhatsApp Web ficava congelada.
 *
 * knowledge-base.js carrega whl_knowledge_base UMA vez (init) e guarda em
 * memória; o Autopilot (ConfidenceSystem.canAutoSendSmart) usa
 * window.knowledgeBase.getKnowledge(). Nada recarregava quando a tela de
 * treinamento (outra página) gravava: FAQ nova só valia para o Autopilot depois
 * de recarregar o WhatsApp Web. E outra cópia em memória (painel lateral), ao
 * salvar, gravava por cima a versão velha — apagando o treino feito depois.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const EXT = path.join(__dirname, '../..');
const KEY = 'whl_knowledge_base';
const FAQ_A = { id: 1, question: 'Qual o horário?', answer: 'Seg a sex, 8h às 18h.' };
const FAQ_B = { id: 2, question: 'Vocês parcelam no cartão?', answer: 'Em até 6x sem juros.' };

function pagina(store, listeners) {
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const local = {
    get(keys, cb) { const ks = Array.isArray(keys) ? keys : [keys]; const r = {}; ks.forEach((k) => { if (store[k] !== undefined) r[k] = clone(store[k]); }); if (cb) { cb(r); return undefined; } return Promise.resolve(r); },
    set(items, cb) {
      const ch = {}; for (const [k, v] of Object.entries(items)) { ch[k] = { oldValue: clone(store[k]), newValue: clone(v) }; store[k] = clone(v); }
      listeners.forEach((fn) => fn(ch, 'local')); if (cb) { cb(); return undefined; } return Promise.resolve();
    },
    remove(k, cb) { delete store[k]; if (cb) cb(); return Promise.resolve(); },
    getBytesInUse(_k, cb) { if (cb) { cb(10); return undefined; } return Promise.resolve(10); },
  };
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    chrome: { storage: { local, onChanged: { addListener: (fn) => listeners.push(fn) } } },
    document: { readyState: 'complete', addEventListener() {} },
    localStorage: { getItem: () => null }, Blob,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    BackendClient: { isConnected: () => false },
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'modules/knowledge-base.js'), 'utf8'), sandbox, { filename: 'knowledge-base.js' });
  return { kb: sandbox.knowledgeBase, local };
}
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const ids = (arr) => Array.from(arr || [], (x) => x.id).sort((a, b) => a - b);

test('IA-53: FAQ salva na tela de treinamento chega à base do Autopilot sem recarregar o WhatsApp', async () => {
  const store = { [KEY]: { faq: [FAQ_A], products: [] } }; const listeners = [];
  const whatsapp = pagina(store, listeners);
  await whatsapp.kb.init(); await flush();
  assert.deepStrictEqual(ids(whatsapp.kb.getKnowledge().faq), [1]);
  // a tela de treinamento (outra página) grava a base com a FAQ nova
  await whatsapp.local.set({ [KEY]: { faq: [FAQ_A, FAQ_B], products: [] } });
  await flush();
  assert.deepStrictEqual(ids(whatsapp.kb.getKnowledge().faq), [1, 2], 'o Autopilot continua com a base velha');
});

test('IA-53: outra cópia aberta (painel) não apaga, ao salvar, o treino feito depois que ela abriu', async () => {
  const store = { [KEY]: { faq: [FAQ_A], products: [] } }; const listeners = [];
  const painel = pagina(store, listeners);
  await painel.kb.init(); await flush();
  await painel.local.set({ [KEY]: { faq: [FAQ_A, FAQ_B], products: [] } }); // tela de treinamento
  await flush();
  await painel.kb.updateTone({ style: 'friendly' }); // painel salva outra coisa
  await flush();
  const salvo = typeof store[KEY] === 'string' ? JSON.parse(store[KEY]) : store[KEY];
  assert.deepStrictEqual(ids(salvo.faq), [1, 2], `FAQ do treino apagada pelo painel: ${JSON.stringify(ids(salvo.faq))}`);
});
