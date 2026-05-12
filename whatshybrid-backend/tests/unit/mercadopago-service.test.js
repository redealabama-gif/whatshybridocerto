/**
 * MercadoPagoService — testes formais (v9.5.0)
 * Cobre validateWebhookSignature em prod e dev.
 */

process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'x'.repeat(40);
process.env.WEBHOOK_SECRET = 'x'.repeat(40);

const crypto = require('crypto');

let passed = 0, failed = 0;
const log = (ok, name, msg = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}${msg ? ' — ' + msg : ''}`); }
  else { failed++; console.log(`  ✗ ${name}${msg ? ' — ' + msg : ''}`); }
};

console.log('\n=== MercadoPagoService ===\n');

// 1. Sem secret em prod → false
delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
delete require.cache[require.resolve('../../src/services/MercadoPagoService')];
const noSecret = require('../../src/services/MercadoPagoService');
const r1 = noSecret.validateWebhookSignature({ headers: {}, query: {} });
log(r1 === false, 'prod sem secret → rejeita');

// 2. Setup com secret real
process.env.MERCADOPAGO_WEBHOOK_SECRET = 'mp_secret_xxxx';
delete require.cache[require.resolve('../../src/services/MercadoPagoService')];
const svc = require('../../src/services/MercadoPagoService');

// 3. Sem headers necessários → false
const r2 = svc.validateWebhookSignature({ headers: {}, query: {} });
log(r2 === false, 'rejeita sem x-signature/x-request-id');

// 4. Signature válida → true
const ts = String(Date.now());
const dataId = '12345';
const xRequestId = 'req-abc';
const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
const sig = crypto.createHmac('sha256', 'mp_secret_xxxx').update(manifest).digest('hex');

const r3 = svc.validateWebhookSignature({
  headers: {
    'x-signature': `ts=${ts},v1=${sig}`,
    'x-request-id': xRequestId,
  },
  query: { 'data.id': dataId },
});
log(r3 === true, 'aceita signature correta');

// 5. Signature alterada → false
const tamperedSig = sig.replace(/.$/, sig.endsWith('a') ? 'b' : 'a');
const r4 = svc.validateWebhookSignature({
  headers: {
    'x-signature': `ts=${ts},v1=${tamperedSig}`,
    'x-request-id': xRequestId,
  },
  query: { 'data.id': dataId },
});
log(r4 === false, 'rejeita signature alterada');

// 6. Manifest com query.id também funciona (alternative key)
const r5 = svc.validateWebhookSignature({
  headers: {
    'x-signature': `ts=${ts},v1=${sig}`,
    'x-request-id': xRequestId,
  },
  query: { id: dataId },
});
log(r5 === true, 'aceita query.id (alternative)');

// 7. Header malformado → false
const r6 = svc.validateWebhookSignature({
  headers: {
    'x-signature': 'malformed',
    'x-request-id': xRequestId,
  },
  query: { 'data.id': dataId },
});
log(r6 === false, 'rejeita x-signature malformado');

// 8. Em dev sem secret → true (com warning)
process.env.NODE_ENV = 'development';
delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
delete require.cache[require.resolve('../../src/services/MercadoPagoService')];
const devSvc = require('../../src/services/MercadoPagoService');
const r7 = devSvc.validateWebhookSignature({ headers: {}, query: {} });
log(r7 === true, 'dev sem secret → aceita (com warning)');

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Result: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
