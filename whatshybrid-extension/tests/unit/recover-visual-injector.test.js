/**
 * Recover — id da mensagem no banner (modules/recover-visual-injector.js).
 *
 * Regressão da 9.6.2: no WhatsApp atual o balão tem data-testid="msg-container"
 * (sem data-id) e o data-id fica num div acima. O código antigo tirava "msg-"
 * do data-testid e TODAS as mensagens ficavam com o id "container" — o que
 * pôs "Essa mensagem foi apagada" em todas.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const FILE = path.join(__dirname, '../../modules/recover-visual-injector.js');

function loadInjector() {
  const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
  const sandbox = {
    console: quiet,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    document: { readyState: 'complete', addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
    addEventListener() {},
    chrome: { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'recover-visual-injector.js' });
  return sandbox.RecoverVisualInjector._internals;
}

// Elemento mínimo: atributos + ancestral com data-id (closest).
function el(attrs, parent) {
  return {
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k) => k in attrs,
    closest(sel) {
      if (sel !== '[data-id]') return null;
      let n = this;
      while (n) { if (n.hasAttribute('data-id')) return n; n = n.parent; }
      return null;
    },
    parent,
  };
}

const { extractMessageId, isValidMsgId } = loadInjector();

test('Banner: balão msg-container sem data-id usa o data-id do ancestral', () => {
  const row = el({ 'data-id': 'true_5521995800771@c.us_3EB0A1B2C3D4E5F60001' });
  const container = el({ 'data-testid': 'msg-container' }, row);
  assert.strictEqual(extractMessageId(container), '3EB0A1B2C3D4E5F60001');
});

test('Banner: nunca devolve "container" (o bug que pôs "apagada" em todas)', () => {
  const orphan = el({ 'data-testid': 'msg-container' });
  assert.strictEqual(extractMessageId(orphan), null);
  assert.strictEqual(isValidMsgId('container'), false);
});

test('Banner: em grupo/@lid pega o id da mensagem, não o número do grupo', () => {
  const row = el({ 'data-id': 'false_120363012345678901@g.us_3EB0FFEE00112233_5511987654321@c.us' });
  assert.strictEqual(extractMessageId(el({ class: 'message-in' }, row)), '3EB0FFEE00112233');
  const lid = el({ 'data-id': 'false_123456789012345@lid_A5F3C2D1E0B9A8F7E6D5C4B3A2918070' });
  assert.strictEqual(extractMessageId(lid), 'A5F3C2D1E0B9A8F7E6D5C4B3A2918070');
});

test('Banner: ids diferentes para mensagens diferentes', () => {
  const ids = ['3EB0AAAA00000001', '3EB0AAAA00000002', '3A1B2C3D4E5F6A7B8C9D'].map((id) =>
    extractMessageId(el({ 'data-testid': 'msg-container' }, el({ 'data-id': `true_5521995800771@c.us_${id}` }))));
  assert.deepStrictEqual(ids, ['3EB0AAAA00000001', '3EB0AAAA00000002', '3A1B2C3D4E5F6A7B8C9D']);
});

test('Banner: data-id só com o id (formato do WhatsApp atual)', () => {
  const row = el({ 'data-id': '3EB0B584D3AEA026CD34F9' });
  assert.strictEqual(extractMessageId(el({}, row)), '3EB0B584D3AEA026CD34F9');
  assert.strictEqual(extractMessageId(row), '3EB0B584D3AEA026CD34F9');
});
