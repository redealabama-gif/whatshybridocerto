/**
 * Regressão do validador/normalizador de telefone.
 *
 * Telefone errado = mensagem pro número errado (ou contato válido rejeitado) e
 * chave de deduplicação furada no Recover. Carrega o content/utils/phone-
 * validator.js REAL (window.WHL_PhoneValidator) — sem editar a fonte. As funções
 * leem window.WHL_CONSTANTS?.PHONE_PATTERNS em tempo de chamada, com fallback
 * MIN_LENGTH 8 / MAX_LENGTH 15; garantimos um window mínimo.
 */
const assert = require('node:assert');
const { test } = require('../_harness');

if (!global.window) global.window = {};
const PV = require.resolve('../../content/utils/phone-validator.js');
delete require.cache[PV];
require(PV);
const P = global.window.WHL_PhoneValidator;

test('exposição: WHL_PhoneValidator com a API esperada', () => {
  assert.ok(P, 'WHL_PhoneValidator não foi exposto');
  for (const fn of ['sanitizePhone', 'normalizePhone', 'isValidPhone', 'parseWhatsAppId', 'formatForWhatsApp', 'batchValidatePhones', 'parsePhoneList']) {
    assert.strictEqual(typeof P[fn], 'function', 'faltou método ' + fn);
  }
});

test('sanitizePhone: remove tudo que não é dígito', () => {
  assert.strictEqual(P.sanitizePhone('+55 (11) 98765-4321'), '5511987654321');
});

test('normalizePhone: celular BR de 11 dígitos ganha DDI 55', () => {
  assert.strictEqual(P.normalizePhone('11987654321'), '5511987654321');
});

test('normalizePhone: número já com DDI 55 fica intacto', () => {
  assert.strictEqual(P.normalizePhone('5511987654321'), '5511987654321');
});

test('normalizePhone: fixo de 10 dígitos ganha DDI 55', () => {
  assert.strictEqual(P.normalizePhone('1133334444'), '551133334444');
});

test('normalizePhone: sem DDD (8-9 díg) e entradas inválidas viram null', () => {
  assert.strictEqual(P.normalizePhone('987654321'), null);
  assert.strictEqual(P.normalizePhone('123'), null);
  assert.strictEqual(P.normalizePhone(''), null);
  assert.strictEqual(P.normalizePhone(null), null);
});

test('isValidPhone: true p/ celular BR, false p/ curto', () => {
  assert.strictEqual(P.isValidPhone('11987654321'), true);
  assert.strictEqual(P.isValidPhone('123'), false);
});

test('parseWhatsAppId: extrai número de @c.us; lixo vira null', () => {
  assert.strictEqual(P.parseWhatsAppId('5511987654321@c.us'), '5511987654321');
  assert.strictEqual(P.parseWhatsAppId('lixo'), null);
});

test('formatForWhatsApp: normaliza ou devolve string vazia', () => {
  assert.strictEqual(P.formatForWhatsApp('11987654321'), '5511987654321');
  assert.strictEqual(P.formatForWhatsApp('bad'), '');
});

test('batchValidatePhones: separa válidos/inválidos e deduplica os válidos', () => {
  const r = P.batchValidatePhones(['11987654321', 'abc', '1133334444', '11987654321']);
  assert.deepStrictEqual(r.valid, ['5511987654321', '551133334444']);
  assert.deepStrictEqual(r.invalid, ['abc']);
});

test('parsePhoneList: quebra por linha, ignora vazias e valida', () => {
  const r = P.parsePhoneList('11987654321\n\nabc\n1133334444');
  assert.deepStrictEqual(r.valid, ['5511987654321', '551133334444']);
  assert.deepStrictEqual(r.invalid, ['abc']);
});
