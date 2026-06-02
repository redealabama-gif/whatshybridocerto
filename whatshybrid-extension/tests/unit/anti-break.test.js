/**
 * Regressão do anti-break (resiliência de seletores do WhatsApp Web).
 *
 * O valor do módulo é a CASCATA: quando o WhatsApp muda o DOM, o primário
 * quebra mas um fallback mantém a extensão funcionando. Se isso regredir, a
 * extensão para "silenciosamente". Carrega o modules/anti-break-system.js REAL
 * (window.AntiBreakSystem) com window/document stubados — sem editar a fonte;
 * o `root` é injetado em findElement, então o casamento é determinístico.
 */
const assert = require('node:assert');
const path = require('path');
const { test } = require('../_harness');

global.window = global.window || { addEventListener: () => {} };
global.document = global.document || { readyState: 'complete', addEventListener: () => {}, querySelector: () => null };
global.chrome = global.chrome || { storage: { local: { get: async () => ({}), set: async () => {} } }, runtime: { sendMessage: () => Promise.resolve() } };

const ABS_PATH = path.join(__dirname, '../../modules/anti-break-system.js');
delete require.cache[require.resolve(ABS_PATH)];
const _log = console.log, _warn = console.warn;
console.log = () => {}; console.warn = () => {};
try { require(ABS_PATH); } finally { console.log = _log; console.warn = _warn; }
const ABS = global.window.AntiBreakSystem;

// findElement lê window.EventBus (guard opcional) em tempo de chamada.
function ensureWindow() { if (!global.window) global.window = { addEventListener: () => {} }; }

test('SELECTORS: cada entrada tem primary (string) + fallbacks (array)', () => {
  assert.ok(ABS && ABS.SELECTORS, 'AntiBreakSystem.SELECTORS ausente');
  const keys = Object.keys(ABS.SELECTORS);
  assert.ok(keys.length > 0, 'SELECTORS vazio');
  for (const k of keys) {
    const d = ABS.SELECTORS[k];
    assert.ok(typeof d.primary === 'string' && d.primary.length, k + ': primary inválido');
    assert.ok(Array.isArray(d.fallbacks), k + ': fallbacks não é array');
  }
});

test('findElement: acha pelo seletor PRIMÁRIO quando ele casa', () => {
  ensureWindow();
  const primary = ABS.SELECTORS.MAIN_CHAT.primary;
  const root = { querySelector: (s) => (s === primary ? { matched: 'primary' } : null) };
  const el = ABS.findElement('MAIN_CHAT', root);
  assert.ok(el && el.matched === 'primary', 'deveria casar pelo primário');
});

test('findElement: cai pro FALLBACK quando o primário some (resiliência anti-quebra)', () => {
  ensureWindow();
  const fb = ABS.SELECTORS.MAIN_CHAT.fallbacks[0];
  // primário não casa; só o primeiro fallback casa
  const root = { querySelector: (s) => (s === fb ? { matched: 'fallback' } : null) };
  const el = ABS.findElement('MAIN_CHAT', root);
  assert.ok(el && el.matched === 'fallback', 'deveria ter usado o fallback');
});

test('findElement: retorna null quando nada casa', () => {
  ensureWindow();
  const root = { querySelector: () => null };
  assert.strictEqual(ABS.findElement('MAIN_CHAT', root), null);
});

test('findElement: seletor desconhecido retorna null (não estoura)', () => {
  ensureWindow();
  assert.strictEqual(ABS.findElement('NAO_EXISTE_XYZ', { querySelector: () => ({}) }), null);
});
