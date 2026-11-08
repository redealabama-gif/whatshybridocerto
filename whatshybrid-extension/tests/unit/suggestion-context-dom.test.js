/**
 * IA-06 — causa raiz da sugestão "curta e genérica": no WhatsApp atual (1 único
 * data-testid="msg-container" por página, sem .message-in/.message-out, data-id
 * só com o id da mensagem — diagnóstico WHL_RecoverDiag do usuário), a sugestão
 * lia UM balão. A IA recebia 1 mensagem de histórico, às vezes a errada
 * (audit/evidencias/50-extensao-e2e-atual.json).
 *
 * Carrega o modules/ai-suggestion-fixed.js REAL num contexto vm, com um
 * mini-DOM (tests/unit/_mini-dom.js) montado com o HTML de cada formato.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');
const { createDocument } = require('./_mini-dom');

const SRC = fs.readFileSync(path.join(__dirname, '../../modules/ai-suggestion-fixed.js'), 'utf8');
const BRIDGE_SRC = fs.readFileSync(path.join(__dirname, '../../injected/wa-page-bridge.js'), 'utf8');
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
// objetos criados no contexto vm têm outros protótipos: compara como JSON
const plain = (x) => JSON.parse(JSON.stringify(x));

const CONV = [
  ['in', 'Boa tarde! Vi o anúncio de vocês no Instagram'],
  ['out', 'Boa tarde! Que bom que chamou 😊 Como posso ajudar?'],
  ['in', 'Queria saber do plano para clínica odontológica'],
  ['out', 'Temos o plano Pro, ideal para clínicas. Quantos dentistas atendem aí?'],
  ['in', 'Somos 3 dentistas e 2 recepcionistas'],
  ['in', 'Quanto fica por mês para esse tamanho? E tem fidelidade?'],
];
const EXPECTED_ROLES = ['user', 'assistant', 'user', 'assistant', 'user', 'user'];

// Formato antigo (o que o código esperava).
const bubbleOld = ([dir, text], i) => `<div class="${dir === 'out' ? 'message-out' : 'message-in'}" data-id="${dir === 'out'}_5511988887777@c.us_3EB0OLD00000000${i}">
  <div class="copyable-text" data-pre-plain-text="[10:0${i}] X: "><span class="selectable-text copyable-text"><span>${text}</span></span></div>
  ${dir === 'out' ? '<span data-icon="msg-dblcheck"></span>' : ''}</div>`;
// Formato atual: data-id = id puro, um único msg-container na página.
const bubbleNew = ([dir, text], i, mcAt) => `<div role="row"><div data-id="3EB0NEW00000000000${i}">${i === mcAt ? '<div data-testid="msg-container">' : '<div>'}
  <div class="copyable-text" data-pre-plain-text="[10:0${i}] X: "><span class="selectable-text copyable-text"><span>${text}</span></span></div>
  ${dir === 'out' ? '<span data-icon="msg-dblcheck"></span>' : ''}</div></div></div>`;
const page = (bubbles) => `<html><head></head><body><div id="main"><header><span title="Clínica Sorriso">Clínica Sorriso</span></header>
<div data-testid="conversation-panel-messages">${bubbles}</div><footer><div contenteditable="true" role="textbox"></div></footer></div></body></html>`;

function loadSuggestion(html, extra = {}) {
  let innerWindow = null;
  const document = createDocument(html);
  const listeners = [];
  const sandbox = {
    console: quiet, document,
    setTimeout: (fn, ms) => (extra.realTimers ? setTimeout(fn, ms) : 0),
    clearTimeout: (t) => { if (extra.realTimers) clearTimeout(t); },
    setInterval: () => 0, clearInterval() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { origin: 'https://web.whatsapp.com' },
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    // a resposta vem do próprio window (como no navegador): o window de DENTRO do vm
    postMessage: (data) => { if (extra.onPostMessage) extra.onPostMessage(data, (reply) => listeners.slice().forEach((fn) => fn({ source: innerWindow, data: reply }))); },
    chrome: { runtime: { id: 'x', sendMessage() {}, onMessage: { addListener() {} } }, storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  innerWindow = vm.runInContext('window', sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'ai-suggestion-fixed.js' });
  const internals = sandbox.AISuggestionFixed && sandbox.AISuggestionFixed._internals;
  return { sandbox, internals };
}

function extract(html) {
  const { internals } = loadSuggestion(html);
  assert.ok(internals && typeof internals.extractMessages === 'function', 'AISuggestionFixed._internals.extractMessages não exposto');
  return plain(internals.extractMessages());
}

test('IA-06: DOM atual (msg-container no 1º balão) → as 6 mensagens, a última é a pergunta', () => {
  const msgs = extract(page(CONV.map((m, i) => bubbleNew(m, i, 0)).join('')));
  assert.strictEqual(msgs.length, 6, `extraiu ${msgs.length}: ${JSON.stringify(msgs)}`);
  assert.strictEqual(msgs[5].content, CONV[5][1]);
});

test('IA-06: DOM atual (msg-container no último balão) → as 6 mensagens', () => {
  const msgs = extract(page(CONV.map((m, i) => bubbleNew(m, i, CONV.length - 1)).join('')));
  assert.strictEqual(msgs.length, 6, `extraiu ${msgs.length}: ${JSON.stringify(msgs)}`);
});

test('IA-06: DOM atual → direção pelos ícones de entrega (✓✓ = você)', () => {
  const msgs = extract(page(CONV.map((m, i) => bubbleNew(m, i, 0)).join('')));
  assert.deepStrictEqual(msgs.map((m) => m.role), EXPECTED_ROLES);
});

test('IA-06 (controle): DOM antigo continua com as 6 mensagens e a direção certa', () => {
  const msgs = extract(page(CONV.map(bubbleOld).join('')));
  assert.strictEqual(msgs.length, 6);
  assert.deepStrictEqual(msgs.map((m) => m.role), EXPECTED_ROLES);
});

test('IA-06: Store via ponte da página → direção exata (fromMe) e mídia sem base64', async () => {
  const { internals } = loadSuggestion(page(''), {
    realTimers: true,
    onPostMessage: (data, reply) => {
      if (data && data.source === 'WHL_ISOLATED' && data.type === 'getActiveChatMessages') {
        reply({ source: 'WHL_PAGE_BRIDGE', type: 'RESPONSE', requestId: data.requestId, data: { id: 'x@c.us', messages: [
          { fromMe: false, type: 'chat', body: 'Oi, quanto custa?' },
          { fromMe: true, type: 'chat', body: 'O plano Pro custa R$ 189/mês.' },
          { fromMe: false, type: 'image', body: '', caption: '' },
          { fromMe: false, type: 'chat', body: '', isNotification: true },
          { fromMe: false, type: 'chat', body: 'E tem fidelidade?' },
        ] } });
      }
    },
  });
  assert.ok(internals && typeof internals.extractMessagesFromStore === 'function', 'extractMessagesFromStore não exposto');
  const msgs = plain(await internals.extractMessagesFromStore());
  assert.deepStrictEqual(msgs, [
    { role: 'user', content: 'Oi, quanto custa?' },
    { role: 'assistant', content: 'O plano Pro custa R$ 189/mês.' },
    { role: 'user', content: '[MÍDIA: imagem]' },
    { role: 'user', content: 'E tem fidelidade?' },
  ]);
});

test('IA-06: ponte da página responde getActiveChatMessages com a Store', async () => {
  const replies = [];
  const listeners = [];
  const msgs = [
    { id: { fromMe: false }, type: 'chat', body: 'Oi, quanto custa?', t: 1 },
    { id: { fromMe: true }, type: 'chat', body: 'R$ 189/mês.', t: 2 },
    { id: { fromMe: false }, type: 'image', body: '/9j/4AAQSkZJRgABAQ…base64', caption: 'segue a foto', t: 3 },
  ];
  const chat = { active: true, id: { _serialized: '5511988887777@c.us' }, msgs: { getModelsArray: () => msgs } };
  const sandbox = {
    console: quiet,
    document: { querySelector: () => null },
    localStorage: { getItem: () => null },
    setTimeout, clearTimeout,
    CustomEvent: class CustomEvent { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    dispatchEvent() {},
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    postMessage: (data) => { if (data && data.source === 'WHL_PAGE_BRIDGE') replies.push(data); },
    require: (name) => ({
      WAWebChatCollection: { ChatCollection: { getModelsArray: () => [chat] } },
      WAWebContactCollection: { ContactCollection: { getModelsArray: () => [] } },
    })[name] || null,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(BRIDGE_SRC, sandbox, { filename: 'wa-page-bridge.js' });
  const ev = { source: sandbox, data: { source: 'WHL_ISOLATED', type: 'getActiveChatMessages', requestId: 'r1', payload: { limit: 20 } } };
  for (const fn of listeners) await fn(ev);
  const found = replies.find((x) => x.type === 'RESPONSE' && x.requestId === 'r1');
  const r = found && plain(found);
  assert.ok(r, 'sem resposta da ponte');
  assert.strictEqual(r.error, undefined, `erro da ponte: ${r.error}`);
  assert.strictEqual(r.data.messages.length, 3);
  assert.deepStrictEqual(r.data.messages.map((m) => m.fromMe), [false, true, false]);
  assert.strictEqual(r.data.messages[2].body, '', 'não deve repassar o base64 da miniatura');
  assert.strictEqual(r.data.messages[2].caption, 'segue a foto');
});
