/**
 * Regressão do sistema anti-ban (segurança da conta do cliente).
 *
 * São as invariantes que, se quebrarem, derrubam contas: o delay entre envios
 * NUNCA pode cair abaixo do mínimo (parece bot) nem disparar absurdamente, e o
 * limite diário tem que bloquear de verdade. Carrega o utils/anti-ban.js REAL
 * (instância window.antiBanSystem) com window/chrome stubados — sem editar a
 * fonte.
 */
const assert = require('node:assert');
const path = require('path');
const { test } = require('../_harness');

const ANTIBAN = path.join(__dirname, '../../utils/anti-ban.js');

let _ab = null;
async function getAntiBan() {
  if (_ab) return _ab;
  global.window = { dispatchEvent: () => {} };
  global.CustomEvent = class { constructor(type, opts) { this.type = type; if (opts) Object.assign(this, opts); } };
  global.chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    runtime: { sendMessage: () => Promise.resolve() },
  };
  delete require.cache[require.resolve(ANTIBAN)];
  const origLog = console.log; console.log = () => {};
  try { require(ANTIBAN); } finally { console.log = origLog; }
  _ab = global.window.antiBanSystem;
  await new Promise((r) => setTimeout(r, 0)); // deixa o init() assíncrono assentar
  return _ab;
}

test('calculateSmartDelay: NUNCA abaixo do mínimo nem acima de max*1.5 (invariante anti-ban)', async () => {
  const ab = await getAntiBan();
  const min = 3000, max = 8000, cap = max * 1.5;
  for (let i = 0; i < 5000; i++) {
    const d = ab.calculateSmartDelay(min, max);
    assert.ok(d >= min, `delay ${d} caiu abaixo do mínimo ${min}`);
    assert.ok(d <= cap, `delay ${d} passou do teto ${cap}`);
  }
});

test('canSendNow: permite abaixo do limite e bloqueia ao atingir o limite diário', async () => {
  const ab = await getAntiBan();
  ab.dailyLimit = 200; ab.businessHoursOnly = false; ab.lastResetDate = ab.getTodayDate();

  ab.sentToday = 0;
  assert.strictEqual((await ab.canSendNow()).allowed, true, 'deveria permitir em 0/200');

  ab.sentToday = 200;
  const blocked = await ab.canSendNow();
  assert.strictEqual(blocked.allowed, false, 'deveria bloquear em 200/200');
  assert.strictEqual(blocked.reason, 'daily_limit');
});

test('incrementSentCount: ok abaixo do aviso, warning em 80%, blocked no limite', async () => {
  const ab = await getAntiBan();
  ab.dailyLimit = 200; ab.warningThreshold = 0.8; ab.lastResetDate = ab.getTodayDate();

  ab.sentToday = 158;
  assert.strictEqual((await ab.incrementSentCount()).ok, true, '159/200 deveria ser ok');
  ab.sentToday = 159;
  assert.strictEqual((await ab.incrementSentCount()).warning, true, '160/200 (=80%) deveria avisar');
  ab.sentToday = 199;
  assert.strictEqual((await ab.incrementSentCount()).blocked, true, '200/200 deveria bloquear');
});

test('setDailyLimit: rejeita fora de 1..1000 e aceita valor válido', async () => {
  const ab = await getAntiBan();
  await assert.rejects(() => ab.setDailyLimit(0), 'limite 0 deveria ser rejeitado');
  await assert.rejects(() => ab.setDailyLimit(1001), 'limite 1001 deveria ser rejeitado');
  await ab.setDailyLimit(300);
  assert.strictEqual(ab.dailyLimit, 300);
});

test('getTodayDate: formato YYYY-MM-DD', async () => {
  const ab = await getAntiBan();
  assert.match(ab.getTodayDate(), /^\d{4}-\d{2}-\d{2}$/);
});
