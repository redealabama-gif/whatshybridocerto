/**
 * Regressão das GUARDAS DE SEGURANÇA da captura de mensagens.
 *
 * Estas funções existem por causa de ataques reais (SSRF, prototype pollution,
 * envenenamento de dados de treino). São puras; carregamos o
 * modules/message-capture.js REAL e usamos o namespace _internals (exposto só
 * para teste/diagnóstico, sem mudar a API de uso).
 */
const assert = require('node:assert');
const path = require('path');
const { test } = require('../_harness');

global.window = global.window || { addEventListener: () => {} };
global.document = global.document || { readyState: 'complete', addEventListener: () => {}, querySelector: () => null };
global.chrome = global.chrome || { storage: { local: { get: async () => ({}), set: async () => {} } }, runtime: { sendMessage: () => Promise.resolve(), id: 'test' } };

const MC_PATH = path.join(__dirname, '../../modules/message-capture.js');
delete require.cache[require.resolve(MC_PATH)];
const _log = console.log, _warn = console.warn;
console.log = () => {}; console.warn = () => {};
try { require(MC_PATH); } finally { console.log = _log; console.warn = _warn; }
const MI = global.window.MessageCapture._internals;

test('_internals expõe as guardas de segurança', () => {
  assert.ok(MI, '_internals ausente');
  for (const fn of ['validateBackendUrl', 'sanitizeObject', 'sanitizeMessageData']) {
    assert.strictEqual(typeof MI[fn], 'function', 'faltou ' + fn);
  }
});

test('validateBackendUrl: aceita https público e localhost; remove a barra final', () => {
  assert.strictEqual(MI.validateBackendUrl('https://api.whatshybrid.com/v1/'), 'https://api.whatshybrid.com/v1');
  assert.strictEqual(MI.validateBackendUrl('http://localhost:3000'), 'http://localhost:3000');
});

test('validateBackendUrl: bloqueia IP privado, metadata de cloud, protocolo não-http e vazio (SSRF)', () => {
  assert.throws(() => MI.validateBackendUrl('http://192.168.0.10'), /private IP/);
  assert.throws(() => MI.validateBackendUrl('http://10.0.0.5'), /private IP/);
  assert.throws(() => MI.validateBackendUrl('http://172.16.0.1'), /private IP/);
  assert.throws(() => MI.validateBackendUrl('http://169.254.169.254'), /private IP/); // metadata de cloud
  assert.throws(() => MI.validateBackendUrl('ftp://exemplo.com'), /protocol/);
  assert.throws(() => MI.validateBackendUrl(''), /must be a string/);
});

test('sanitizeObject: remove __proto__/constructor (inclusive aninhado), preserva o resto e não polui o protótipo', () => {
  const dirty = JSON.parse('{"a":1,"__proto__":{"x":9},"nested":{"constructor":"bad","ok":2}}');
  const s = MI.sanitizeObject(dirty);
  assert.ok(!Object.prototype.hasOwnProperty.call(s, '__proto__'), '__proto__ deveria ter sido removido');
  assert.ok(!Object.prototype.hasOwnProperty.call(s.nested, 'constructor'), 'constructor aninhado deveria sumir');
  assert.strictEqual(s.a, 1);
  assert.strictEqual(s.nested.ok, 2);
  assert.strictEqual(({}).x, undefined, 'não pode ter poluído Object.prototype');
});

test('sanitizeMessageData: whitelist de type/action, clamp de tamanho e null seguro', () => {
  assert.strictEqual(MI.sanitizeMessageData(null), null);
  assert.strictEqual(MI.sanitizeMessageData({ type: 'hackzz' }).type, 'text');     // type inválido -> text
  assert.strictEqual(MI.sanitizeMessageData({ action: 'explode' }).action, 'new'); // action inválida -> new
  assert.strictEqual(MI.sanitizeMessageData({ action: 'revoked' }).action, 'revoked');
  assert.strictEqual(MI.sanitizeMessageData({ action: 'edited' }).action, 'edited');
  assert.strictEqual(MI.sanitizeMessageData({ message: 'x'.repeat(20000) }).message.length, 10000);
  assert.strictEqual(MI.sanitizeMessageData({ isFromMe: 'yes' }).isFromMe, true); // coerção pra boolean
});
