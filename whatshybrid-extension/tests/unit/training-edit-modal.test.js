/**
 * IA-48 — tela de treinamento: clicar numa FAQ, produto ou exemplo não abria a
 * edição (nem o botão Excluir).
 *
 * Os itens nascem com id NUMÉRICO (Date.now() na tela, Date.now()+Math.random()
 * no importador); o clique lê card.dataset.id, que é TEXTO, e o modal procurava
 * com f.id === id → nunca achava e saía calado. Sem edição não havia como
 * corrigir ou apagar uma FAQ/produto errado — e a IA continuava usando.
 * Prova real: audit/evidencias/fase3/61-treinamento-tela-real.json ("apagar a
 * FAQ ... pela interface" → o botão Excluir nunca aparece).
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const EXT = path.join(__dirname, '../..');

function loadTraining() {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) {
      const classes = new Set();
      els.set(id, { id, value: '', textContent: '', innerHTML: '', checked: false, style: {}, dataset: {},
        classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
        reset() {}, focus() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
    }
    return els.get(id);
  };
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    document: { addEventListener() {}, getElementById: el, querySelector: () => null, querySelectorAll: () => [] },
    chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } },
    confirm: () => true,
    setTimeout: () => 0, clearTimeout() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'training/training.js'), 'utf8'), sandbox, { filename: 'training.js' });
  const TrainingApp = vm.runInContext('TrainingApp', sandbox);
  const tela = Object.create(TrainingApp.prototype);
  Object.assign(tela, {
    examples: [], faqs: [], products: [], businessInfo: {}, currentEditId: null,
    saveKnowledgeBase: async () => {}, saveExamples: async () => {}, _scheduleBackendSync() {},
    renderFaqs() {}, renderProducts() {}, renderExamples() {}, updateStats() {}, closeModal() {}, showToast() {},
  });
  return { tela, el };
}

// id como o importador gera e como o clique o entrega (card.dataset.id)
const FAQ = { id: 1794260810048.6543, q: 'Vocês aceitam convênio?', a: 'Sim.', question: 'Vocês aceitam convênio?', answer: 'Sim.' };
const PROD = { id: 1794260811000, name: 'Clareamento dental', price: 650 };
const EX = { id: 1794260812000, input: 'Tem horário sábado?', output: 'Sábado das 8h às 12h.' };

test('IA-48: clicar numa FAQ abre a edição com o botão Excluir', () => {
  const { tela, el } = loadTraining();
  tela.faqs = [FAQ];
  tela.openFaqModal(String(FAQ.id));
  assert.strictEqual(tela.currentEditId, FAQ.id, 'a FAQ não foi encontrada pelo id do card');
  assert.strictEqual(el('btnDeleteFaq').style.display, 'block');
  assert.strictEqual(el('faqQuestion').value, FAQ.q);
});

test('IA-48: Excluir apaga a FAQ clicada', async () => {
  const { tela } = loadTraining();
  tela.faqs = [FAQ, { ...FAQ, id: 1, q: 'Outra' }];
  tela.openFaqModal(String(FAQ.id));
  await tela.deleteFaq();
  assert.deepStrictEqual(Array.from(tela.faqs, (f) => f.id), [1]);
});

test('IA-48: clicar num produto abre a edição', () => {
  const { tela, el } = loadTraining();
  tela.products = [PROD];
  tela.openProductModal(String(PROD.id));
  assert.strictEqual(tela.currentEditId, PROD.id, 'o produto não foi encontrado pelo id do card');
  assert.strictEqual(el('btnDeleteProduct').style.display, 'block');
});

test('IA-48: clicar num exemplo abre a edição', () => {
  const { tela, el } = loadTraining();
  tela.examples = [EX];
  tela.openExampleModal(String(EX.id));
  assert.strictEqual(tela.currentEditId, EX.id, 'o exemplo não foi encontrado pelo id do card');
  assert.strictEqual(el('btnDeleteExample').style.display, 'block');
});
