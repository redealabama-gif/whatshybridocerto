/**
 * IA-59 — tela de treinamento vazia apagava o treinamento no servidor.
 *
 * A tela só lê a base local (chrome.storage). Quando ela está vazia — aparelho
 * novo, ou base apagada pelo defeito da IA-46 antes da correção — a tela abria
 * sem nenhuma FAQ/produto/exemplo e o primeiro "salvar" mandava essas listas ao
 * /api/v1/training/sync, que apaga e regrava tudo do cliente no servidor: o que
 * estava salvo lá (e que a IA usava) sumia. O servidor tem GET
 * /api/v1/training/sync com tudo, mas a extensão nunca o chamava.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const EXT = path.join(__dirname, '../..');
const DO_SERVIDOR = {
  faqs: [{ id: '1794260810048', question: 'Vocês parcelam no cartão?', answer: 'Em até 6x sem juros.', category: 'general', keywords: '[]' }],
  products: [{ id: '1794260811000', name: 'Clareamento dental', description: 'Sessão de 1 hora', price: 650, currency: 'BRL', stock_status: 'available', tags: '[]' }],
  examples: [{ id: '1794260812000', input: 'Tem horário no sábado?', output: 'Sábado das 8h às 12h.', category: 'geral', tags: '[]', usage_count: 0 }],
  businessInfo: { name: 'Clínica Sorriso Fácil', hours: 'Seg a sex 8h–18h' },
};

function tela(store, { conectaDepoisDe = 0 } = {}) {
  const pedidos = [];
  const enviados = [];
  let consultas = 0;
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    chrome: { storage: { local: {
      get: async (k) => { const ks = Array.isArray(k) ? k : [k]; const r = {}; ks.forEach((x) => { if (store[x] !== undefined) r[x] = JSON.parse(JSON.stringify(store[x])); }); return r; },
      set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
    } }, runtime: { sendMessage: async (m) => { enviados.push(JSON.parse(JSON.stringify(m))); return { success: true }; } } },
    setTimeout, clearTimeout,
    // A sessão é lida do storage de forma assíncrona: conectado só depois de N consultas.
    BackendClient: { isConnected: () => ++consultas > conectaDepoisDe, get: async (url) => { pedidos.push(url); return url === '/api/v1/training/sync' ? JSON.parse(JSON.stringify(DO_SERVIDOR)) : null; } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'training/training.js'), 'utf8'), sandbox, { filename: 'training.js' });
  const TrainingApp = vm.runInContext('TrainingApp', sandbox);
  const app = Object.create(TrainingApp.prototype);
  Object.assign(app, { updateStats() {}, showToast() {}, renderAll() {}, updateConnectionStatus() {}, _markSynced: async () => {}, _renderLastSyncTime() {} });
  return { app, pedidos, enviados };
}

test('IA-59: base local vazia → a tela restaura do servidor (antes de qualquer salvar)', async () => {
  const store = { whl_knowledge_base: { faq: [], products: [], business: {} }, whl_few_shot_examples: '[]' };
  const { app } = tela(store);
  await app.loadAllData();
  await app._restorePromise; // em segundo plano: a tela não trava
  assert.deepStrictEqual(Array.from(app.faqs || [], (f) => f.question), ['Vocês parcelam no cartão?'], 'a tela abriu sem as FAQs do servidor');
  assert.strictEqual(app.faqs[0].answer, 'Em até 6x sem juros.');
  assert.deepStrictEqual(Array.from(app.products || [], (p) => `${p.name} = ${p.price}`), ['Clareamento dental = 650']);
  assert.strictEqual((app.examples || []).length, 1);
  const kb = store.whl_knowledge_base;
  assert.strictEqual((kb.faq || []).length, 1, 'não gravou a base local restaurada (o Autopilot usa a local)');
  assert.strictEqual(kb.business && kb.business.name, 'Clínica Sorriso Fácil');
});

test('IA-59: a tela abre antes de o BackendClient terminar de ler a sessão → espera e restaura', async () => {
  const store = { whl_knowledge_base: { name: 'Clínica' }, whl_few_shot_examples: '[]' };
  const { app } = tela(store, { conectaDepoisDe: 5 });
  await app.loadAllData();
  await app._restorePromise;
  assert.deepStrictEqual(Array.from(app.faqs || [], (f) => f.question), ['Vocês parcelam no cartão?']);
});

test('IA-59: FAQ criada enquanto a restauração espera → fica junto, e o envio ao servidor leva as duas', async () => {
  const store = { whl_knowledge_base: { name: 'Clínica' }, whl_few_shot_examples: '[]' };
  const { app, enviados } = tela(store, { conectaDepoisDe: 5 });
  await app.loadAllData(); // a tela já responde
  app.faqs.push({ id: 99, q: 'Tem estacionamento?', a: 'Sim, conveniado.', question: 'Tem estacionamento?', answer: 'Sim, conveniado.' });
  app._scheduleBackendSync('saveFaq');
  await app._restorePromise;
  await new Promise((r) => setTimeout(r, 2300)); // debounce de 2 s do envio
  assert.deepStrictEqual(Array.from(app.faqs, (f) => f.question).sort(), ['Tem estacionamento?', 'Vocês parcelam no cartão?']);
  assert.strictEqual(enviados.length, 1, `envios: ${enviados.length}`);
  assert.deepStrictEqual(enviados[0].data.faqs.map((f) => f.question).sort(), ['Tem estacionamento?', 'Vocês parcelam no cartão?'], 'o envio levou lista parcial');
});

test('IA-59 (controle): com treino local, a tela não consulta o servidor nem troca nada', async () => {
  const store = { whl_knowledge_base: { faq: [{ id: 1, question: 'Local?', answer: 'Sim.' }], products: [], business: {} }, whl_few_shot_examples: '[]' };
  const { app, pedidos } = tela(store);
  await app.loadAllData();
  assert.deepStrictEqual(pedidos, []);
  assert.deepStrictEqual(Array.from(app.faqs, (f) => f.question), ['Local?']);
});
