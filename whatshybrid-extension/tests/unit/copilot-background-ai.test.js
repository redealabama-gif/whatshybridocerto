/**
 * IA-24 — o CopilotEngine (modo SUGGEST, padrão) gerava sugestão com IA a cada
 * mensagem recebida, em segundo plano, e ninguém exibia o resultado (o listener
 * de 'copilot:suggestions' foi removido do SuggestionInjector). Com chave de IA
 * local configurada, era uma chamada de IA (e crédito) por mensagem, sem efeito.
 * O pedido explícito (SmartReplies → generateSuggestions) continua usando a IA.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const SRC = fs.readFileSync(path.join(__dirname, '../../modules/copilot-engine.js'), 'utf8');
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

function loadEngine() {
  const calls = { ai: 0 };
  const complete = async () => { calls.ai++; return { content: 'Resposta gerada pela IA local para o cliente.', provider: 'openai' }; };
  const sandbox = {
    console: quiet,
    document: { readyState: 'complete', querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {} },
    setTimeout: (fn) => setImmediate(fn), clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { origin: 'https://web.whatsapp.com' },
    addEventListener() {}, removeEventListener() {}, postMessage() {}, dispatchEvent() {},
    chrome: { runtime: { id: 'x', sendMessage() {}, onMessage: { addListener() {} } }, storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } } },
    AIService: { getConfiguredProviders: () => ['openai'], complete, generateText: complete },
    AIGateway: { complete },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'copilot-engine.js' });
  return { CE: sandbox.CopilotEngine, calls };
}

test('IA-24: mensagem recebida em segundo plano NÃO chama a IA', async () => {
  const { CE, calls } = loadEngine();
  await CE.handleIncomingMessage({ chatId: '5511900000071@c.us', message: 'Qual o horário de vocês?', sender: 'Cliente', timestamp: Date.now() });
  assert.strictEqual(calls.ai, 0, `chamou a IA ${calls.ai}x sem ninguém pedir`);
});

test('IA-24 (controle): pedido explícito de sugestão continua usando a IA', async () => {
  const { CE, calls } = loadEngine();
  const analysis = await CE.analyzeMessage('Qual o horário de vocês?', '5511900000072@c.us');
  await CE.generateSuggestions('5511900000072@c.us', analysis);
  assert.ok(calls.ai >= 1, 'deveria ter chamado a IA no pedido explícito');
});
