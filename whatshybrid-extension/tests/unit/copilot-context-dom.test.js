/**
 * IA-21 — CopilotEngine.extractMessagesFromDOM no WhatsApp atual. É dele que o
 * autopilot tira o histórico mandado ao backend (buildAutopilotHistory) e o
 * fallback local tira o contexto. No DOM atual (data-id só com o id da
 * mensagem) achava 1 mensagem; sem argumento (0 = "todo o histórico", como no
 * caminho da Store) também devolvia 1 (audit/evidencias/41-copilot-extracao.md).
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');
const { createDocument } = require('./_mini-dom');

const SRC = fs.readFileSync(path.join(__dirname, '../../modules/copilot-engine.js'), 'utf8');
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
const plain = (x) => JSON.parse(JSON.stringify(x));

const CONV = [
  ['in', 'Boa tarde! Vi o anúncio de vocês no Instagram'],
  ['out', 'Boa tarde! Que bom que chamou 😊 Como posso ajudar?'],
  ['in', 'Queria saber do plano para clínica odontológica'],
  ['out', 'Temos o plano Pro, ideal para clínicas. Quantos dentistas atendem aí?'],
  ['in', 'Somos 3 dentistas e 2 recepcionistas'],
  ['in', 'Quanto fica por mês para esse tamanho? E tem fidelidade?'],
];
const bubbleNew = ([dir, text], i) => `<div role="row"><div data-id="3EB0NEW00000000000${i}">${i === 0 ? '<div data-testid="msg-container">' : '<div>'}
  <div class="copyable-text" data-pre-plain-text="[10:0${i}] X: "><span class="selectable-text copyable-text"><span>${text}</span></span></div>
  ${dir === 'out' ? '<span data-icon="msg-dblcheck"></span>' : ''}</div></div></div>`;
const HTML = `<html><head></head><body><div id="main"><header><span title="Clínica Sorriso">Clínica Sorriso</span></header>
<div data-testid="conversation-panel-messages">${CONV.map(bubbleNew).join('')}</div></div></body></html>`;

function loadEngine() {
  const sandbox = {
    console: quiet, document: createDocument(HTML),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { origin: 'https://web.whatsapp.com' },
    addEventListener() {}, removeEventListener() {}, postMessage() {}, dispatchEvent() {},
    chrome: { runtime: { id: 'x', sendMessage() {}, onMessage: { addListener() {} } }, storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'copilot-engine.js' });
  return sandbox.CopilotEngine;
}

test('IA-21: DOM atual → histórico com as 6 mensagens e a direção certa', () => {
  const msgs = plain(loadEngine().extractMessagesFromDOM(30));
  assert.strictEqual(msgs.length, 6, `extraiu ${msgs.length}: ${JSON.stringify(msgs.map((m) => m.content))}`);
  assert.deepStrictEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user', 'user']);
  assert.strictEqual(msgs[5].content, CONV[5][1]);
});

test('IA-21: sem argumento (0 = todo o histórico) → não fica só com a última', () => {
  const msgs = plain(loadEngine().extractMessagesFromDOM());
  assert.strictEqual(msgs.length, 6, `extraiu ${msgs.length}`);
});

test('IA-21 (controle): janela menor continua respeitada', () => {
  const msgs = plain(loadEngine().extractMessagesFromDOM(2));
  assert.deepStrictEqual(msgs.map((m) => m.content), [CONV[4][1], CONV[5][1]]);
});
