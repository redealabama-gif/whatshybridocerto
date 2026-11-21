/**
 * PLN-03 — o plano Business existe no backend (TokenService.PLAN_RESPOSTAS,
 * MercadoPagoService.PLAN_PRICES, os 19 gates de middleware/subscription.js),
 * mas NÃO existia na extensão:
 *
 *   modules/subscription-manager.js:186  PLAN_HIERARCHY = ['free','starter','pro','enterprise']
 *   modules/feature-gate.js:81           PLAN_HIERARCHY = ['free','starter','pro','enterprise']
 *
 * Consequência medida (antes da correção), para quem paga R$ 299,90/mês:
 *   1) getPlan() cai no `|| PLANS.free` → recebe features e limites do Free Lite;
 *   2) PLAN_HIERARCHY.indexOf('business') === -1 → currentIndex = -1 < qualquer
 *      requiredIndex, então TODO gate pago responde "Disponível a partir do
 *      plano Pro" — o cliente Business é mandado fazer upgrade pro plano
 *      abaixo do dele.
 *
 * Carrega os dois módulos REAIS com window stubado.
 */
const assert = require('node:assert');
const path = require('path');
const { test } = require('../_harness');

global.window = global.window || {};
global.document = global.document || {
  readyState: 'complete', addEventListener: () => {}, querySelector: () => null,
  querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add() {}, remove() {} } })
};
global.chrome = global.chrome || {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { sendMessage: () => Promise.resolve(), getManifest: () => ({ version: '0.0.0' }) }
};
global.localStorage = global.localStorage || { getItem: () => null, setItem: () => {}, removeItem: () => {} };

function carregar(rel) {
  const abs = path.join(__dirname, '../../', rel);
  delete require.cache[require.resolve(abs)];
  const _log = console.log, _warn = console.warn, _err = console.error;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { require(abs); } finally { console.log = _log; console.warn = _warn; console.error = _err; }
}

carregar('modules/subscription-manager.js');
const SM = global.window.SubscriptionManager;

test('PLN-03: PLANS.business existe (antes: undefined → getPlan() devolvia PLANS.free)', () => {
  assert.ok(SM && SM.PLANS, 'SubscriptionManager.PLANS ausente');
  const b = SM.PLANS.business;
  assert.ok(b, 'PLANS.business ausente — cliente de R$ 299,90 recebia o plano Free Lite');
  assert.strictEqual(b.id, 'business');
  assert.strictEqual(b.price, 299.90, 'preço do card da landing (R$ 299,90)');
});

test('PLN-03: PLAN_HIERARCHY coloca business entre pro e enterprise (igual ao backend)', () => {
  const h = SM.PLAN_HIERARCHY;
  assert.ok(Array.isArray(h), 'PLAN_HIERARCHY não é array');
  assert.ok(h.includes('business'), 'business fora da hierarquia → indexOf = -1');
  assert.ok(
    h.indexOf('business') > h.indexOf('pro'),
    'business tem de ficar acima do pro (planOrder do LicenseService: free,starter,pro,business,enterprise)'
  );
  assert.ok(h.indexOf('business') < h.indexOf('enterprise'), 'business abaixo do enterprise');
});

test('PLN-03: Business não perde nenhuma feature nem limite do Pro', () => {
  const pro = SM.PLANS.pro, bus = SM.PLANS.business;
  for (const [k, v] of Object.entries(pro.features)) {
    const b = bus.features[k];
    if (typeof v === 'number') {
      const ok = b === -1 || (typeof b === 'number' && b >= v) || v === -1 && b === -1;
      assert.ok(ok, `features.${k}: Pro=${v} e Business=${b} — Business não pode entregar menos`);
    } else if (typeof v === 'boolean') {
      assert.ok(!v || b === true, `features.${k}: ligado no Pro e desligado no Business`);
    } else if (typeof v === 'string') {
      assert.ok(b, `features.${k}: ausente no Business`);
    }
  }
  for (const [k, v] of Object.entries(pro.limits)) {
    const b = bus.limits[k];
    assert.ok(
      b === -1 || (typeof b === 'number' && b >= v) || v === -1,
      `limits.${k}: Pro=${v} e Business=${b} — Business não pode ter teto menor`
    );
  }
});

test('PLN-03: Business tem teto anti-ban em bulkContactsPerDay (não pode ser -1)', () => {
  const b = SM.PLANS.business.limits.bulkContactsPerDay;
  assert.notStrictEqual(b, -1, 'sem teto o disparo em massa derruba o número do cliente');
  assert.ok(b > SM.PLANS.pro.limits.bulkContactsPerDay, 'tem de ser maior que o Pro (2.000) pra justificar o preço');
});

// --- feature-gate: o gate pago tem de liberar o Business -------------------

carregar('modules/feature-gate.js');
const FG = global.window.FeatureGate;

test('PLN-03: FeatureGate.PLAN_HIERARCHY também conhece o business', () => {
  assert.ok(FG && Array.isArray(FG.PLAN_HIERARCHY), 'FeatureGate.PLAN_HIERARCHY ausente');
  assert.ok(FG.PLAN_HIERARCHY.includes('business'), 'business fora da hierarquia do gate');
  assert.ok(FG.PLAN_HIERARCHY.indexOf('business') > FG.PLAN_HIERARCHY.indexOf('pro'));
});

function smFalso(planId) {
  const plano = SM.PLANS[planId] || SM.PLANS.free;
  return {
    PLANS: SM.PLANS,
    isActive: () => true,
    getPlanId: () => planId,
    getFeature: (f) => plano.features[f],
    getLimit: (l) => plano.limits[l],
    checkLimit: () => ({ allowed: true }),
    canUseAI: () => true
  };
}

test('PLN-03: cliente Business não é mais mandado "fazer upgrade pro plano Pro"', () => {
  const antes = global.window.SubscriptionManager;
  try {
    for (const chave of ['module:copilot', 'feature:advanced_analytics', 'feature:api_access',
                         'feature:priority_support', 'action:export_json', 'module:training',
                         'module:autopilot', 'action:custom_labels']) {
      global.window.SubscriptionManager = smFalso('business');
      FG.invalidateCache();
      const r = FG.check(chave, false);
      assert.strictEqual(
        r.allowed, true,
        `${chave} negado ao Business (motivo="${r.reason}", mensagem="${r.message}")`
      );
    }
  } finally {
    global.window.SubscriptionManager = antes;
  }
});

test('PLN-03: o gate continua barrando quem está abaixo (não afrouxou nada)', () => {
  const antes = global.window.SubscriptionManager;
  try {
    global.window.SubscriptionManager = smFalso('starter');
    FG.invalidateCache();
    const r = FG.check('module:copilot', false);
    assert.strictEqual(r.allowed, false, 'copilot é pro+ — starter não pode passar');
    assert.strictEqual(r.reason, 'plan_required');

    global.window.SubscriptionManager = smFalso('business');
    FG.invalidateCache();
    const w = FG.check('feature:white_label', false);
    assert.strictEqual(w.allowed, false, 'white label é enterprise — business não pode passar');
  } finally {
    global.window.SubscriptionManager = antes;
  }
});
