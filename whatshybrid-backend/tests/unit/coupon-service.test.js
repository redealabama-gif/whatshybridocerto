/**
 * CouponService — testes formais (Fase 1 cobrança real)
 *
 * Cobertura:
 *   - normalizeCode: aceita/rejeita formatos
 *   - validate: cobre todos os reasons (not_found, inactive, expired,
 *               depleted, plan_not_eligible, ok)
 *   - previewDiscount: cálculo de %, fixed, e cap em final >= 0
 *   - getPendingCouponForWorkspace: ignora cupom já usado
 *
 * O CouponService importa o módulo de DB. Aqui mockamos via
 * require.cache antes do require pra evitar dependência de banco real
 * ou fixtures. O mock simula os mínimos métodos usados: get, run,
 * transaction (síncrono retornando função).
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(40);

const path = require('path');

let passed = 0, failed = 0;
function log(ok, name, msg = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}${msg ? ' — ' + msg : ''}`); }
  else { failed++; console.log(`  ✗ ${name}${msg ? ' — ' + msg : ''}`); }
}

// ─── Mock DB ─────────────────────────────────────────────────────────
const couponsRows = new Map();
const workspaces = new Map();
const redemptions = [];

function mockDB() {
  return {
    get(sql, params) {
      // flag /s pra `.` casar newline — os SQLs do CouponService quebram linha
      if (/FROM\s+coupons\s+WHERE\s+code/s.test(sql)) {
        return couponsRows.get(params[0]) || null;
      }
      if (/FROM\s+workspaces\s+WHERE\s+id/s.test(sql)) {
        return workspaces.get(params[0]) || null;
      }
      return null;
    },
    run(sql, params) {
      if (/UPDATE\s+workspaces\s+SET\s+coupon_code/.test(sql)) {
        const ws = workspaces.get(params[1]) || {};
        ws.coupon_code = params[0];
        ws.coupon_applied_at = new Date().toISOString();
        ws.coupon_first_invoice_used_at = null;
        workspaces.set(params[1], ws);
        return;
      }
      if (/UPDATE\s+workspaces\s+SET\s+coupon_first_invoice_used_at/.test(sql)) {
        const ws = workspaces.get(params[0]) || {};
        ws.coupon_first_invoice_used_at = new Date().toISOString();
        workspaces.set(params[0], ws);
        return;
      }
      if (/INSERT\s+INTO\s+coupon_redemptions/.test(sql)) {
        redemptions.push({ id: params[0], coupon_code: params[1], workspace_id: params[2] });
        return;
      }
      if (/UPDATE\s+coupons\s+SET\s+redeemed_count/.test(sql)) {
        const c = couponsRows.get(params[0]);
        if (c) c.redeemed_count = (c.redeemed_count || 0) + 1;
        return;
      }
    },
    transaction(fn) {
      // Versão síncrona; retorna função wrapper como better-sqlite3
      return (...args) => fn(...args);
    },
  };
}

// Mock o módulo de DB antes do require do CouponService
const dbPath = require.resolve('../../src/utils/database');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: mockDB(),
};

// Mock o logger pra não poluir o output dos testes
const loggerPath = require.resolve('../../src/utils/logger');
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { info() {}, warn() {}, error() {}, debug() {} },
};

// Mock UUID wrapper — projeto usa um wrapper sync sobre módulo ESM uuid
// que precisa de initUUID() async; em teste, basta uma sequência simples.
let uuidCounter = 0;
const uuidPath = require.resolve('../../src/utils/uuid-wrapper');
require.cache[uuidPath] = {
  id: uuidPath, filename: uuidPath, loaded: true,
  exports: {
    v4: () => `test-uuid-${++uuidCounter}`,
    uuidv4: () => `test-uuid-${++uuidCounter}`,
    initUUID: async () => {},
    generateUUID: async () => `test-uuid-${++uuidCounter}`,
  },
};

const couponService = require('../../src/services/CouponService');

console.log('\n=== CouponService ===\n');

// ─── normalizeCode ──────────────────────────────────────────────────
log(couponService.normalizeCode('EXIT50') === 'EXIT50', 'normalize accepts valid uppercase');
log(couponService.normalizeCode('exit50') === 'EXIT50', 'normalize uppercases lowercase');
log(couponService.normalizeCode('  EXIT50  ') === 'EXIT50', 'normalize trims whitespace');
log(couponService.normalizeCode('ab') === null, 'normalize rejects too short (<3 chars)');
log(couponService.normalizeCode('AB') === null, 'normalize rejects 2 chars');
log(couponService.normalizeCode('X'.repeat(33)) === null, 'normalize rejects too long (>32 chars)');
log(couponService.normalizeCode('EXIT 50') === null, 'normalize rejects spaces inside');
log(couponService.normalizeCode("DROP'; --") === null, 'normalize rejects SQL injection chars');
log(couponService.normalizeCode(null) === null, 'normalize rejects null');
log(couponService.normalizeCode(123) === null, 'normalize rejects number');

// ─── validate ───────────────────────────────────────────────────────
// Cleanup
couponsRows.clear();

const r1 = couponService.validate('NOPE', 'pro');
log(r1.valid === false && r1.reason === 'not_found', 'validate: not_found when missing');

couponsRows.set('INACTIVE', {
  code: 'INACTIVE', kind: 'percent', value: 0.5, active: 0,
  redeemed_count: 0, first_invoice_only: 1,
});
const r2 = couponService.validate('INACTIVE', 'pro');
log(r2.valid === false && r2.reason === 'inactive', 'validate: inactive when active=0');

const pastDate = new Date(Date.now() - 86400000).toISOString();
couponsRows.set('EXPIRED', {
  code: 'EXPIRED', kind: 'percent', value: 0.5, active: 1,
  valid_until: pastDate, redeemed_count: 0,
});
const r3 = couponService.validate('EXPIRED', 'pro');
log(r3.valid === false && r3.reason === 'expired', 'validate: expired when valid_until in past');

const futureDate = new Date(Date.now() + 86400000).toISOString();
couponsRows.set('FUTURE', {
  code: 'FUTURE', kind: 'percent', value: 0.5, active: 1,
  valid_from: futureDate, redeemed_count: 0,
});
const r3b = couponService.validate('FUTURE', 'pro');
log(r3b.valid === false && r3b.reason === 'expired', 'validate: expired when valid_from in future');

couponsRows.set('DEPLETED', {
  code: 'DEPLETED', kind: 'percent', value: 0.5, active: 1,
  redeemed_count: 100, max_redemptions: 100,
});
const r4 = couponService.validate('DEPLETED', 'pro');
log(r4.valid === false && r4.reason === 'depleted', 'validate: depleted when redeemed_count >= max');

couponsRows.set('PROONLY', {
  code: 'PROONLY', kind: 'percent', value: 0.3, active: 1,
  applies_to_plans: 'pro,agency', redeemed_count: 0,
});
const r5a = couponService.validate('PROONLY', 'starter');
log(r5a.valid === false && r5a.reason === 'plan_not_eligible',
    'validate: plan_not_eligible when plan outside CSV');
const r5b = couponService.validate('PROONLY', 'pro');
log(r5b.valid === true, 'validate: ok when plan inside CSV');

couponsRows.set('EXIT50', {
  code: 'EXIT50', kind: 'percent', value: 0.5, active: 1,
  description: '50% OFF no 1º mês', first_invoice_only: 1,
  redeemed_count: 0,
});
const r6 = couponService.validate('EXIT50', 'pro');
log(r6.valid === true, 'validate: EXIT50 ok for pro');
log(r6.valid && r6.coupon.code === 'EXIT50', 'validate returns coupon row');

const r7 = couponService.validate('exit50', 'pro');
log(r7.valid === true, 'validate: normalizes case (exit50 → EXIT50)');

const r8 = couponService.validate(null, 'pro');
log(r8.valid === false && r8.reason === 'invalid_format', 'validate: rejects null code');

// ─── previewDiscount ────────────────────────────────────────────────
const p1 = couponService.previewDiscount('EXIT50', 'pro', 99.90);
log(p1.valid === true, 'preview: EXIT50 valid');
log(p1.originalAmount === 99.90 && p1.discountAmount === 49.95 && p1.finalAmount === 49.95,
    `preview: 50% of 99.90 → 49.95 (got ${p1.finalAmount})`);
log(p1.firstInvoiceOnly === true, 'preview: firstInvoiceOnly flag');
log(p1.label === '50% OFF no 1º mês', 'preview: label from description');

couponsRows.set('DOZE', {
  code: 'DOZE', kind: 'fixed', value: 12, active: 1, redeemed_count: 0,
});
const p2 = couponService.previewDiscount('DOZE', 'pro', 99.90);
log(p2.valid === true && p2.discountAmount === 12 && p2.finalAmount === 87.90,
    `preview: fixed 12 off 99.90 → 87.90 (got ${p2.finalAmount})`);

const p3 = couponService.previewDiscount('DOZE', 'pro', 5);
log(p3.valid === true && p3.discountAmount === 5 && p3.finalAmount === 0,
    `preview: fixed 12 off 5 caps at 5 (got ${p3.finalAmount})`);

const p4 = couponService.previewDiscount('EXIT50', 'pro', 0);
log(p4.valid === false && p4.reason === 'invalid_amount', 'preview: amount=0 rejected');

const p5 = couponService.previewDiscount('EXIT50', 'pro', -10);
log(p5.valid === false && p5.reason === 'invalid_amount', 'preview: amount negative rejected');

const p6 = couponService.previewDiscount('NOPE', 'pro', 100);
log(p6.valid === false && p6.reason === 'not_found', 'preview: propaga reason de validate');

// ─── getPendingCouponForWorkspace ───────────────────────────────────
workspaces.set('WS1', { id: 'WS1', coupon_code: 'EXIT50', coupon_first_invoice_used_at: null });
const pending1 = couponService.getPendingCouponForWorkspace('WS1', 'pro');
log(pending1 && pending1.code === 'EXIT50', 'pending: returns coupon when not used');

workspaces.set('WS2', { id: 'WS2', coupon_code: 'EXIT50',
                         coupon_first_invoice_used_at: new Date().toISOString() });
const pending2 = couponService.getPendingCouponForWorkspace('WS2', 'pro');
log(pending2 === null, 'pending: null when already used');

workspaces.set('WS3', { id: 'WS3', coupon_code: null });
const pending3 = couponService.getPendingCouponForWorkspace('WS3', 'pro');
log(pending3 === null, 'pending: null when no coupon');

workspaces.set('WS4', { id: 'WS4' });
const pending4 = couponService.getPendingCouponForWorkspace('WS4', 'pro');
log(pending4 === null, 'pending: null when workspace has no coupon column set');

// Cupom apontado pelo workspace, mas que ficou inativo desde o signup
couponsRows.set('LATER_INACTIVE', {
  code: 'LATER_INACTIVE', kind: 'percent', value: 0.5, active: 0,
  redeemed_count: 0,
});
workspaces.set('WS5', { id: 'WS5', coupon_code: 'LATER_INACTIVE',
                         coupon_first_invoice_used_at: null });
const pending5 = couponService.getPendingCouponForWorkspace('WS5', 'pro');
log(pending5 === null, 'pending: null when coupon is no longer valid');

// ─── applyToWorkspace ───────────────────────────────────────────────
workspaces.set('WS_APPLY', { id: 'WS_APPLY' });
const apply1 = couponService.applyToWorkspace('EXIT50', 'WS_APPLY', 'pro');
log(apply1.code === 'EXIT50', 'apply: returns {code,label}');
log(workspaces.get('WS_APPLY').coupon_code === 'EXIT50', 'apply: persists coupon_code in workspace');

let threw = false;
try { couponService.applyToWorkspace('NOPE', 'WS_X', 'pro'); }
catch (e) { threw = e.code === 'INVALID_COUPON' && e.reason === 'not_found'; }
log(threw, 'apply: throws INVALID_COUPON for invalid code');

// ─── recordRedemption ───────────────────────────────────────────────
redemptions.length = 0;
couponsRows.set('REDEEM_TEST', {
  code: 'REDEEM_TEST', kind: 'percent', value: 0.5, active: 1,
  first_invoice_only: 1, redeemed_count: 0,
});
workspaces.set('WS_REDEEM', { id: 'WS_REDEEM', coupon_code: 'REDEEM_TEST' });

const redId = couponService.recordRedemption({
  couponCode: 'REDEEM_TEST',
  workspaceId: 'WS_REDEEM',
  plan: 'pro',
  originalAmount: 99.90,
  discountAmount: 49.95,
  finalAmount: 49.95,
  invoiceId: 'inv-1',
  status: 'paid',
});
log(typeof redId === 'string' && redId.length > 0, 'redeem: returns redemption id');
log(redemptions.length === 1, 'redeem: inserts redemption row');
log(couponsRows.get('REDEEM_TEST').redeemed_count === 1, 'redeem: increments coupons counter');
log(workspaces.get('WS_REDEEM').coupon_first_invoice_used_at != null,
    'redeem: marks first_invoice_used when first_invoice_only=1');

// Cupom multi-uso NÃO deve marcar first_invoice_used
couponsRows.set('MULTI', {
  code: 'MULTI', kind: 'percent', value: 0.1, active: 1,
  first_invoice_only: 0, redeemed_count: 0,
});
workspaces.set('WS_MULTI', { id: 'WS_MULTI', coupon_code: 'MULTI' });
couponService.recordRedemption({
  couponCode: 'MULTI', workspaceId: 'WS_MULTI', plan: 'pro',
  originalAmount: 100, discountAmount: 10, finalAmount: 90,
});
log(workspaces.get('WS_MULTI').coupon_first_invoice_used_at == null,
    'redeem: does NOT mark first_invoice_used for multi-use coupon');

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
