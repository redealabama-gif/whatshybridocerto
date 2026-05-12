/**
 * StripeService — testes formais (v9.5.0)
 * Cobre validateWebhookSignature, modo dry-run, replay protection.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(40);
process.env.WEBHOOK_SECRET = 'x'.repeat(40);

const crypto = require('crypto');

let passed = 0, failed = 0;
const log = (ok, name, msg = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}${msg ? ' — ' + msg : ''}`); }
  else { failed++; console.log(`  ✗ ${name}${msg ? ' — ' + msg : ''}`); }
};

console.log('\n=== StripeService ===\n');

// Setup: força modo dry-run inicialmente, depois reconfigura via require.cache
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

// Reset cache to ensure fresh init
delete require.cache[require.resolve('../../src/services/StripeService')];
const dryRunSvc = require('../../src/services/StripeService');

// 1. dry-run quando STRIPE_SECRET_KEY ausente
log(!dryRunSvc.isConfigured(), 'isConfigured() retorna false em dry-run');
log(dryRunSvc.dryRun === true, 'dryRun flag definida');

// 2. validateWebhookSignature: sem secret → false
const r1 = dryRunSvc.validateWebhookSignature({ headers: {}, rawBody: '{}' });
log(r1 === false, 'validateWebhookSignature retorna false sem WEBHOOK_SECRET');

// Setup com secret real
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_xxx';
delete require.cache[require.resolve('../../src/services/StripeService')];
const svc = require('../../src/services/StripeService');

// 3. isConfigured agora true
log(svc.isConfigured() === true, 'isConfigured() retorna true com secret');

// 4. validateWebhookSignature com timestamp atual + sig correta → true
const ts = Math.floor(Date.now() / 1000);
const rawBody = JSON.stringify({ id: 'evt_test', type: 'invoice.paid' });
const signedPayload = `${ts}.${rawBody}`;
const sig = crypto.createHmac('sha256', 'whsec_test_secret_xxx').update(signedPayload).digest('hex');

const r2 = svc.validateWebhookSignature({
  headers: { 'stripe-signature': `t=${ts},v1=${sig}` },
  rawBody,
});
log(r2 === true, 'valida signature correta');

// 5. signature inválida → false
const r3 = svc.validateWebhookSignature({
  headers: { 'stripe-signature': `t=${ts},v1=${sig.replace(/.$/, sig.endsWith('a') ? 'b' : 'a')}` },
  rawBody,
});
log(r3 === false, 'rejeita signature alterada');

// 6. timestamp antigo (>5min) → false (replay protection)
const oldTs = ts - 600;
const oldSignedPayload = `${oldTs}.${rawBody}`;
const oldSig = crypto.createHmac('sha256', 'whsec_test_secret_xxx').update(oldSignedPayload).digest('hex');
const r4 = svc.validateWebhookSignature({
  headers: { 'stripe-signature': `t=${oldTs},v1=${oldSig}` },
  rawBody,
});
log(r4 === false, 'rejeita timestamp >5min (replay protection)');

// 7. Header malformado → false
const r5 = svc.validateWebhookSignature({
  headers: { 'stripe-signature': 'malformed' },
  rawBody,
});
log(r5 === false, 'rejeita signature header malformado');

// 8. Sem header → false
const r6 = svc.validateWebhookSignature({ headers: {}, rawBody });
log(r6 === false, 'rejeita request sem stripe-signature header');

// 9. Body como Buffer também funciona
const bufBody = Buffer.from(rawBody);
const r7 = svc.validateWebhookSignature({
  headers: { 'stripe-signature': `t=${ts},v1=${sig}` },
  rawBody: bufBody,
});
log(r7 === true, 'aceita rawBody como Buffer');

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Result: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
