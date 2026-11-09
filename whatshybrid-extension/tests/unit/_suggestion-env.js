/**
 * Ambiente comum dos testes do popup "Sugestão de IA" (ai-suggestion-fixed.js):
 * conversa no DOM atual do WhatsApp (mini-DOM), painel do popup como elementos
 * simulados que guardam o innerHTML, e o smart-suggestions.js real carregado
 * junto (é dele a lista de frases prontas DEFAULT_RESPONSES).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDocument } = require('./_mini-dom');

const SRC = fs.readFileSync(path.join(__dirname, '../../modules/ai-suggestion-fixed.js'), 'utf8');
const SMART = fs.readFileSync(path.join(__dirname, '../../modules/smart-suggestions.js'), 'utf8');
const SAFETY = fs.readFileSync(path.join(__dirname, '../../modules/ai-safety-filter.js'), 'utf8');
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

// Frases prontas de smart-suggestions.js (DEFAULT_RESPONSES) — as dos prints do usuário.
const FRASES_PRONTAS = [
  'Entendi. Como posso ajudar com isso?',
  'Certo! Pode me dar mais detalhes?',
  'Ok! Em que posso ser útil?',
  'Compreendo. Posso ajudar com mais alguma informação?',
];

// 'out' = enviada pelo dono da conta; 'in' = recebida do contato.
const CONV = [
  ['out', 'Boa noite! Conseguiu ver o código de rastreio do meu pedido?'],
  ['in', 'PX123456789BR'],
  ['in', 'O prazo é de uns 7 dias'],
  ['in', 'Esse rastreio é da transportadora Jet'],
];
const bubble = ([dir, text], i) => `<div role="row"><div data-id="3EB0SUG00000000000${i}">${i === 0 ? '<div data-testid="msg-container">' : '<div>'}
  <div class="copyable-text" data-pre-plain-text="[20:3${i}] X: "><span class="selectable-text copyable-text"><span>${text}</span></span></div>
  ${dir === 'out' ? '<span data-icon="msg-dblcheck"></span>' : ''}</div></div></div>`;
const HTML = `<html><head></head><body><div id="main"><header><span title="Loja de suplementos">Loja de suplementos</span></header>
<div data-testid="conversation-panel-messages">${CONV.map(bubble).join('')}</div><footer><div contenteditable="true" role="textbox"></div></footer></div></body></html>`;

function fakeEl() {
  const el = {
    _html: '',
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    style: {}, dataset: {},
    addEventListener() {}, removeEventListener() {}, remove() {}, focus() {},
    setAttribute() {}, getAttribute: () => null,
    // showSuggestion() liga os botões por body.querySelector('#whl-ai-sug-*')
    querySelector: () => fakeEl(), querySelectorAll: () => [],
  };
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = String(v); } });
  return el;
}

function loadSuggestionEnv({ backend, safetyFilter = false } = {}) {
  const document = createDocument(HTML);
  const els = { 'whl-ai-body': fakeEl(), 'whl-ai-panel-fixed': fakeEl(), 'whl-ai-btn-fixed': fakeEl() };
  const getById = document.getElementById;
  // Elementos do popup (#whl-ai-*: corpo, botões Editar/Aprovar/Tentar de novo...)
  // existem só no innerHTML simulado: devolve um elemento simulado por id.
  document.getElementById = (id) => {
    if (/^whl-ai/.test(id) && !els[id]) els[id] = fakeEl();
    return els[id] || getById(id);
  };
  // escapeHtml() usa div.textContent = x; div.innerHTML — o mini-DOM não tem esse setter.
  document.createElement = () => {
    const el = fakeEl();
    let text = '';
    Object.defineProperty(el, 'textContent', {
      get() { return text; },
      set(v) { text = String(v); el._html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    });
    return el;
  };
  const sandbox = {
    console: quiet, document,
    // Timers reais só para esperas curtas (ex.: 1,5 s da Store); os longos (injeção
    // do botão aos 2 s, corrida de 30 s do MÉTODO 0) não disparam no teste.
    setTimeout: (fn, ms) => (ms >= 2000 ? 0 : setTimeout(fn, ms)),
    clearTimeout: (t) => { if (t) clearTimeout(t); },
    setInterval: () => 0, clearInterval() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { origin: 'https://web.whatsapp.com' },
    addEventListener() {}, removeEventListener() {}, postMessage() {},
    chrome: { runtime: { id: 'x', sendMessage() {}, onMessage: { addListener() {} } }, storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } } },
  };
  if (backend) sandbox.BackendClient = backend;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SMART, sandbox, { filename: 'smart-suggestions.js' });
  if (safetyFilter) vm.runInContext(SAFETY, sandbox, { filename: 'ai-safety-filter.js' });
  vm.runInContext(SRC, sandbox, { filename: 'ai-suggestion-fixed.js' });
  return { sandbox, body: els['whl-ai-body'] };
}

module.exports = { loadSuggestionEnv, FRASES_PRONTAS, CONV };
