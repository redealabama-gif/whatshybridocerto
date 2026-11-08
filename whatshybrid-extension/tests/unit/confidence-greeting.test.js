/**
 * IA-03 (extensão) — ConfidenceSystem.isSimpleGreeting: "saudação simples" é
 * só o cumprimento. Antes, qualquer mensagem começando com "Oi," ou "Bom dia!"
 * (inclusive "Oi, quero meu dinheiro de volta, vou no Procon") ganhava
 * confiança 95 e seguia para o envio automático.
 */
const assert = require('node:assert');
const path = require('path');
const { test } = require('../_harness');

function loadConfidenceSystem() {
  const MODULE = path.join(__dirname, '../../modules/confidence-system.js');
  delete require.cache[require.resolve(MODULE)];
  const prev = { window: global.window, chrome: global.chrome };
  global.window = { confidenceSystem: {} }; // impede o init() automático
  global.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
  require(MODULE);
  const CS = global.window.ConfidenceSystem;
  global.window = prev.window; global.chrome = prev.chrome;
  return new CS();
}

test('IA-03: "Oi, <pedido>" não é saudação simples', () => {
  const cs = loadConfidenceSystem();
  for (const m of [
    'Oi, quanto custa o plano mensal de vocês? Tem desconto no anual?',
    'Bom dia! Vocês entregam em Campinas? Qual o prazo?',
    'Oi, quero meu dinheiro de volta, vou no Procon',
  ]) {
    assert.strictEqual(cs.isSimpleGreeting(m), false, `tratou como saudação simples: ${m}`);
  }
});

test('IA-03 (controle): cumprimento puro continua saudação simples', () => {
  const cs = loadConfidenceSystem();
  for (const m of ['Oi', 'Bom dia', 'Oi, tudo bem?', 'boa tarde!', 'E aí, beleza?']) {
    assert.strictEqual(cs.isSimpleGreeting(m), true, `deveria ser saudação simples: ${m}`);
  }
});
