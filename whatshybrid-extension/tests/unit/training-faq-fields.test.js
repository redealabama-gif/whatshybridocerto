/**
 * IA-45 — FAQ importada por planilha/TXT na tela de treinamento.
 *
 * O importador (training/modules/document-importer.js) gravava cada FAQ como
 * { q, a }. O sync com o backend (/api/v1/training/sync) e o Autopilot
 * (ConfidenceSystem.findFAQMatch) só leem question/answer: a FAQ aparecia na
 * tela, mas nunca chegava ao banco nem respondia cliente.
 * Prova real: audit/evidencias/fase3/61-treinamento-tela-real.json.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const EXT = path.join(__dirname, '../..');

function loadImporter() {
  const sandbox = { console: { log() {}, warn() {}, error() {} }, window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'training/modules/document-importer.js'), 'utf8'), sandbox);
  return sandbox.window.documentImporter;
}

function loadConfidenceSystem() {
  const MODULE = path.join(EXT, 'modules/confidence-system.js');
  delete require.cache[require.resolve(MODULE)];
  const prev = { window: global.window, chrome: global.chrome };
  global.window = { confidenceSystem: {} }; // impede o init() automático
  global.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
  require(MODULE);
  const CS = global.window.ConfidenceSystem;
  global.window = prev.window; global.chrome = prev.chrome;
  return new CS();
}

const file = (name, text) => ({ name, text: async () => text });

test('IA-45: FAQ importada de CSV tem question e answer (campos que o sync e o Autopilot leem)', async () => {
  const imp = loadImporter();
  const r = await imp.processFile(file('faqs.csv', 'pergunta,resposta\n"Vocês parcelam no cartão?","Sim, em até 6x sem juros."\n'));
  assert.strictEqual(r.type, 'faqs');
  assert.strictEqual(r.items[0].question, 'Vocês parcelam no cartão?');
  assert.strictEqual(r.items[0].answer, 'Sim, em até 6x sem juros.');
});

test('IA-45: FAQ importada de TXT (P:/R:) tem question e answer', async () => {
  const imp = loadImporter();
  const r = await imp.processFile(file('faqs.txt', 'P: Vocês aceitam convênio?\nR: Aceitamos Amil Dental e OdontoPrev.\n'));
  assert.strictEqual(r.type, 'faqs');
  assert.strictEqual(r.items[0].question, 'Vocês aceitam convênio?');
  assert.strictEqual(r.items[0].answer, 'Aceitamos Amil Dental e OdontoPrev.');
});

test('IA-45: o Autopilot encontra FAQ já salva no formato antigo { q, a }', () => {
  const cs = loadConfidenceSystem();
  const m = cs.findFAQMatch('Vocês parcelam no cartão?', [{ id: 1, q: 'Vocês parcelam no cartão?', a: 'Sim, em até 6x sem juros.' }]);
  assert.ok(m, 'FAQ { q, a } ignorada pelo Autopilot');
  assert.strictEqual(m.answer, 'Sim, em até 6x sem juros.');
  assert.ok(m.confidence > 80, `confiança ${m.confidence}`);
});
