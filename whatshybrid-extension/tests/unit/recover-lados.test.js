/**
 * WA-04 — "559284891875 -> 559284891875": o mesmo número dos dois lados em
 * mensagens que não eram da própria conta.
 *
 * Dados reais do aparelho do dono (16/11/2026). Os registros bons tinham
 * chatId como TEXTO e lados certos; o ruim tinha chatId como OBJETO wid —
 * veio do caminho de captura pela tela, que manda `from: chatId, to: null`.
 * Com `to` nulo, o normalizador caía no próprio chatId e os dois lados viravam
 * o id do chat:
 *
 *   [MESMO NUMERO DOS 2 LADOS] 155757190365423 -> 155757190365423
 *       acao=revoked type=chat fromMe=false
 *       chatId={"_serialized":"155757190365423@lid","server":"lid",...}
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const FILE = path.join(__dirname, '../../modules/recover-advanced.js');
const DONO = '559284891875';
const LID = { _serialized: '155757190365423@lid', server: 'lid', user: '155757190365423' };

function carregar() {
  const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
  const guardado = {};
  const sandbox = {
    console: quiet,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout() {}, setInterval: () => 0, clearInterval() {}, queueMicrotask: (fn) => fn(),
    document: { readyState: 'complete', addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, getElementById: () => null, body: null },
    addEventListener() {}, removeEventListener() {},
    location: { origin: 'https://web.whatsapp.com', href: 'https://web.whatsapp.com/' },
    navigator: { userAgent: 'node' },
    fetch: async () => { throw new Error('sem rede'); },
    atob: (b) => Buffer.from(b, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    localStorage: { getItem: (k) => guardado[k] ?? null, setItem: (k, v) => { guardado[k] = String(v); }, removeItem: (k) => { delete guardado[k]; } },
    chrome: {
      runtime: { id: 't', sendMessage() {}, onMessage: { addListener() {} }, lastError: null },
      storage: {
        local: { get: (k, cb) => (cb ? cb({}) : Promise.resolve({})), set: (o, cb) => (cb ? cb() : Promise.resolve()), remove: (k, cb) => (cb ? cb() : Promise.resolve()) },
        onChanged: { addListener() {} },
      },
    },
    // a conta logada, de onde sai getOwner()
    Store: { Conn: { me: { _serialized: DONO + '@c.us' } } },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'recover-advanced.js' });
  return sandbox.RecoverAdvanced;
}

async function guardar(R, payload) {
  await R.addMessage(payload);
  return R.getMessages().find((m) => m.id === payload.id);
}

test('WA-04: a conta logada é reconhecida (getOwner)', () => {
  assert.strictEqual(carregar().getOwner(), DONO);
});

test('WA-04: mensagem RECEBIDA capturada pela tela não vira "eu -> eu"', async () => {
  const R = carregar();
  // exatamente o que o recover-visual-injector manda numa recebida
  const r = await guardar(R, {
    id: 'WA04_RECEBIDA', from: LID, to: null, chatId: LID,
    fromMe: false, action: 'revoked', type: 'chat', body: 'Não to preparado para amanhã',
  });
  assert.ok(r, 'registro não foi guardado');
  assert.notStrictEqual(r.from, r.to, `continuou "${r.from} -> ${r.to}"`);
  assert.strictEqual(r.to, DONO, 'numa mensagem recebida o destinatário é a própria conta');
});

test('WA-04: mensagem ENVIADA capturada pela tela tem a conta como remetente', async () => {
  const R = carregar();
  const r = await guardar(R, {
    id: 'WA04_ENVIADA', from: null, to: LID, chatId: LID,
    fromMe: true, action: 'deleted', type: 'chat', body: 'minha mensagem',
  });
  assert.strictEqual(r.from, DONO, 'numa mensagem enviada o remetente é a própria conta');
  assert.notStrictEqual(r.from, r.to);
});

test('WA-04 (controle): registro que já vinha certo não é mexido', async () => {
  const R = carregar();
  const r = await guardar(R, {
    id: 'WA04_OK', from: '553287250715', to: DONO, chatId: '155757190365423@lid',
    fromMe: false, action: 'revoked', type: 'ptt',
  });
  assert.strictEqual(r.from, '553287250715');
  assert.strictEqual(r.to, DONO);
});

test('WA-04 (controle): conversa consigo mesmo continua "eu -> eu"', async () => {
  const R = carregar();
  const r = await guardar(R, {
    id: 'WA04_EU', from: DONO + '@c.us', to: DONO + '@c.us', chatId: DONO + '@c.us',
    fromMe: true, action: 'deleted', type: 'chat', body: 'nota pra mim',
  });
  assert.strictEqual(r.from, DONO);
  assert.strictEqual(r.to, DONO, 'quebrou o chat "Mensagem para mim", que é legitimamente eu -> eu');
});
