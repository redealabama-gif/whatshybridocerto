/**
 * IA-25 — o atalho Ctrl+Shift+S (SuggestionInjector) gerava a sugestão por um
 * caminho próprio, só com IA local: ignorava o backend (treinamento, memória,
 * guarda) e, no DOM atual do WhatsApp, nem achava as mensagens (sem a Store, o
 * id do chat vinha nulo e a extração saía vazia; com os seletores antigos, 1
 * balão). Agora usa o mesmo orquestrador do botão 🤖, com a conversa inteira.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');
const { createDocument } = require('./_mini-dom');

const SRC = fs.readFileSync(path.join(__dirname, '../../modules/suggestion-injector.js'), 'utf8');
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

function loadInjector({ process } = {}) {
  const calls = { backend: [], local: 0 };
  const sandbox = {
    console: quiet, document: createDocument(HTML),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { origin: 'https://web.whatsapp.com' },
    addEventListener() {}, removeEventListener() {}, postMessage() {}, dispatchEvent() {},
    chrome: { runtime: { id: 'x', sendMessage() {}, onMessage: { addListener() {} } }, storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } } },
    AIService: { getConfiguredProviders: () => ['openai'], generateText: async () => { calls.local++; return { content: 'Resposta da IA local.' }; } },
    CopilotEngine: {
      analyzeMessage: async () => ({}),
      generateResponse: async () => { calls.local++; return { content: 'Resposta da IA local.' }; },
    },
    BackendClient: {
      isConnected: () => true,
      ai: { process: async (chatKey, message, opts) => { calls.backend.push({ chatKey, message, history: (opts && opts.history) || [] }); return process ? process() : { success: true, response: 'Para 5 pessoas o plano Pro sai R$ 189/mês, sem fidelidade.' }; } },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'suggestion-injector.js' });
  const SI = sandbox.SuggestionInjector;
  assert.ok(SI && SI._internals, 'SuggestionInjector._internals não exposto');
  return { SI, calls };
}

test('IA-25: DOM atual → o atalho extrai as 6 mensagens', () => {
  const { SI } = loadInjector();
  const msgs = plain(SI._internals.extractMessagesFromDOM());
  assert.strictEqual(msgs.length, 6, `extraiu ${msgs.length}: ${JSON.stringify(msgs.map((m) => m.content))}`);
  assert.deepStrictEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user', 'user']);
});

test('IA-25: o atalho usa o orquestrador do backend com a pergunta certa e o histórico', async () => {
  const { SI, calls } = loadInjector();
  await SI._internals.requestSuggestionGeneration();
  assert.strictEqual(calls.backend.length, 1, `backend chamado ${calls.backend.length}x`);
  assert.strictEqual(calls.backend[0].message, CONV[5][1]);
  assert.ok(calls.backend[0].history.length >= 5, `histórico com ${calls.backend[0].history.length} mensagens`);
  assert.strictEqual(calls.local, 0, 'não deveria usar a IA local com o backend no ar');
  assert.strictEqual(plain(SI.getSuggestions())[0].text, 'Para 5 pessoas o plano Pro sai R$ 189/mês, sem fidelidade.');
});

test('IA-25: kill switch do backend → o atalho não cai na IA local', async () => {
  const { SI, calls } = loadInjector({ process: () => { const e = new Error('desativado'); e.code = 'KILL_SWITCH'; throw e; } });
  await SI._internals.requestSuggestionGeneration();
  assert.strictEqual(calls.local, 0, `usou a IA local ${calls.local}x com o kill switch ligado`);
});
