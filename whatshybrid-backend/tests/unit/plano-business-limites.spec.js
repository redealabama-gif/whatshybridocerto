/**
 * PLN-03 (metade backend) — o plano Business foi adicionado em
 * TokenService.PLAN_RESPOSTAS, MercadoPagoService.PLAN_PRICES, nos 19 gates de
 * FEATURE_PLANS e no planOrder do LicenseService, mas NÃO nas duas tabelas de
 * limites:
 *
 *   src/middleware/subscription.js:98   PLAN_LIMITS  (free, starter, pro, enterprise)
 *   src/services/LicenseService.js:22   PLAN_LIMITS  (free, starter, pro, enterprise)
 *
 * Efeito no middleware: checkLimit() faz `const limits = PLAN_LIMITS[plan]` e,
 * em seguida, `if (!limits || ...) return next()`. Com plan='business' o
 * objeto é undefined e TODA checagem de cota é pulada em silêncio — hoje as 4
 * cotas conferidas (contacts, deals, campaigns, tasks) são -1 no Pro, então o
 * resultado coincide com a intenção; basta alguém pôr um teto finito no Pro
 * para o Business virar ilimitado sem ninguém notar.
 *
 * Efeito no LicenseService: create({plan:'business'}) lança 'Plano inválido' e
 * validate()/upgrade() leem `limits.maxContacts` de undefined (TypeError).
 * (Arquivo sem nenhum call site em src/ hoje — defeito latente, corrigido
 * junto porque é a mesma causa.)
 */
const { PLAN_LIMITS, FEATURE_PLANS } = require('../../src/middleware/subscription');
const { PLAN_LIMITS: LICENSE_LIMITS } = require('../../src/services/LicenseService');
const { PLAN_RESPOSTAS } = require('../../src/services/TokenService');

describe('PLN-03: plano Business nas tabelas de limites', () => {
  test('middleware/subscription.js conhece o business', () => {
    expect(PLAN_LIMITS.business).toBeDefined();
  });

  test('cotas de CRM do Business não são menores que as do Pro', () => {
    const pro = PLAN_LIMITS.pro;
    const bus = PLAN_LIMITS.business;
    for (const chave of ['contacts', 'deals', 'tasks', 'campaigns']) {
      const p = pro[chave];
      const b = bus[chave];
      const ok = b === -1 || (p !== -1 && b >= p);
      expect(ok).toBe(true);
    }
  });

  test('Business mantém teto diário de disparo (anti-ban) acima do Pro', () => {
    const b = PLAN_LIMITS.business.bulk_contacts_per_day;
    expect(b).not.toBe(-1);
    expect(b).toBeGreaterThan(PLAN_LIMITS.pro.bulk_contacts_per_day);
  });

  test('Business tem teto diário de IA finito e acima do Pro', () => {
    const b = PLAN_LIMITS.business.ai_requests_per_day;
    expect(b).not.toBe(-1);
    expect(b).toBeGreaterThan(PLAN_LIMITS.pro.ai_requests_per_day);
  });

  test('o teto diário de IA cabe a cota mensal do plano (não barra quem pagou)', () => {
    // 10.000 respostas/mês ÷ 30 dias ≈ 334/dia na média. O teto diário existe
    // pra conter pico/loop, não pra impedir o uso do que foi vendido.
    const porDia = PLAN_RESPOSTAS.business / 30;
    expect(PLAN_LIMITS.business.ai_requests_per_day).toBeGreaterThan(porDia);
  });

  test('todo plano citado em FEATURE_PLANS tem entrada em PLAN_LIMITS', () => {
    const citados = new Set();
    for (const planos of Object.values(FEATURE_PLANS)) {
      for (const p of planos) citados.add(p);
    }
    const semLimite = [...citados].filter((p) => !PLAN_LIMITS[p]);
    expect(semLimite).toEqual([]);
  });

  test('LicenseService: create({plan:"business"}) não cai em "Plano inválido"', () => {
    expect(LICENSE_LIMITS.business).toBeDefined();
    expect(LICENSE_LIMITS.business.aiEnabled).toBe(true);
    expect(LICENSE_LIMITS.business.maxUsers).toBeGreaterThanOrEqual(LICENSE_LIMITS.pro.maxUsers);
  });

  test('LicenseService: todo plano do planOrder tem limites', () => {
    for (const p of ['free', 'starter', 'pro', 'business', 'enterprise']) {
      expect(LICENSE_LIMITS[p]).toBeDefined();
    }
  });
});
