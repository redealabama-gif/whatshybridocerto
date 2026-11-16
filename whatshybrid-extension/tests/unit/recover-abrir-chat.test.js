/**
 * WA-05 — "O número +244 194828361906 não está no WhatsApp".
 *
 * O dono viu esse aviso ao clicar em baixar no histórico, com OUTRA conversa
 * aberta. O número não existe: são os dígitos do `@lid` do chat guardado no
 * registro (chatId "244194828361906@lid"), tratados como telefone.
 *
 * Duas causas, cobertas aqui e em recover-midia.test.js:
 *   1. openChatById chamava Store.Chat.find(), que procura OU CRIA — e criar
 *      faz o WhatsApp consultar o servidor por aquele "telefone".
 *   2. o painel navegava mesmo em registro de TEXTO, que não tem arquivo.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const FILE = path.join(__dirname, '../../modules/recover-advanced.js');

function carregar({ chats = [], comGet = true, cliques = [] } = {}) {
  const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
  const guardado = {};
  const chamadas = { find: 0, openChatAt: [], openChatBottom: [], clicados: [] };

  const colecao = {
    getModelsArray: () => chats,
    find: async (id) => { chamadas.find++; return { id, criadoPeloFind: true }; },
  };
  if (comGet) colecao.get = (id) => chats.find((c) => String(c.id && c.id._serialized) === String(id)) || null;

  const sandbox = {
    console: quiet,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout() {}, setInterval: () => 0, clearInterval() {}, queueMicrotask: (fn) => fn(),
    document: {
      readyState: 'complete', addEventListener() {}, querySelectorAll: () => [], body: null,
      getElementById: () => null,
      querySelector: (sel) => {
        chamadas.clicados.push(sel);
        const achado = cliques.find((c) => c === sel);
        return achado ? { click: () => chamadas.clicados.push('CLIQUE ' + sel) } : null;
      },
    },
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
        local: {
          get: (k, cb) => (cb ? cb({}) : Promise.resolve({})),
          set: (o, cb) => (cb ? cb() : Promise.resolve()),
          remove: (k, cb) => (cb ? cb() : Promise.resolve()),
        },
        onChanged: { addListener() {} },
      },
    },
    Store: {
      Chat: colecao,
      Cmd: {
        openChatAt: async (c) => { chamadas.openChatAt.push(c); },
        openChatBottom: async (c) => { chamadas.openChatBottom.push(c); },
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'recover-advanced.js' });
  return { R: sandbox.RecoverAdvanced, chamadas };
}

const chatDe = (id) => ({ id: { _serialized: id }, nome: id });

test('WA-05: chat que a conta não tem NÃO é criado (nada de Store.Chat.find)', async () => {
  const { R, chamadas } = carregar({ chats: [chatDe('5521999@c.us')] });
  const abriu = await R.openChatById('244194828361906@lid');
  assert.strictEqual(abriu, false, 'disse que abriu um chat que não existe');
  assert.strictEqual(
    chamadas.find,
    0,
    'chamou Store.Chat.find — é ele que faz o WhatsApp perguntar pelo "+244 194828361906"'
  );
  assert.strictEqual(chamadas.openChatAt.length, 0);
});

test('WA-05: chat que existe continua abrindo normalmente', async () => {
  const alvo = chatDe('5521999@c.us');
  const { R, chamadas } = carregar({ chats: [alvo] });
  assert.strictEqual(await R.openChatById('5521999@c.us'), true);
  assert.strictEqual(chamadas.openChatAt.length, 1);
  assert.strictEqual(chamadas.openChatAt[0], alvo);
  assert.strictEqual(chamadas.find, 0);
});

test('WA-05: chatId em objeto (wid) também é encontrado', async () => {
  const alvo = chatDe('155757190365423@lid');
  const { R } = carregar({ chats: [alvo] });
  const abriu = await R.openChatById({ _serialized: '155757190365423@lid', server: 'lid', user: '155757190365423' });
  assert.strictEqual(abriu, true, 'não aceitou o chatId em formato de objeto');
});

test('WA-05: sem get na coleção, varre os modelos carregados (ainda sem criar)', async () => {
  const alvo = chatDe('5531888@c.us');
  const { R, chamadas } = carregar({ chats: [alvo], comGet: false });
  assert.strictEqual(await R.openChatById('5531888@c.us'), true);
  assert.strictEqual(chamadas.find, 0);
});

test('WA-05: com @lid não se procura chat pelo título (casaria a conversa errada)', async () => {
  const { R, chamadas } = carregar({ chats: [] });
  await R.openChatById('244194828361906@lid');
  const porTitulo = chamadas.clicados.filter((s) => s.includes('title*='));
  assert.deepStrictEqual(porTitulo, [], 'procurou conversa pelo título usando dígitos de @lid: ' + porTitulo.join(', '));
});

test('WA-05 (controle): com id de telefone o fallback por título continua existindo', async () => {
  const { R, chamadas } = carregar({ chats: [] });
  await R.openChatById('5521999@c.us');
  assert.ok(
    chamadas.clicados.some((s) => s.includes('title*="5521999"')),
    'perdeu o fallback por título para id de telefone'
  );
});
