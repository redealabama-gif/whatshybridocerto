'use strict';

/**
 * Testes do cache semântico (deflexão de LLM) — Fase 2b.
 *
 * Verifica o mecanismo no AIRouterService: quando o caller fornece uma
 * `options.cacheKey` ESTÁVEL, chamadas com mensagens diferentes mas a mesma
 * chave batem no cache (o provider/LLM é chamado UMA vez). Sem cacheKey, a
 * chave volta a depender das mensagens (comportamento antigo).
 */

// _trackRequest toca DB + TokenService — neutralizamos para o teste unitário.
jest.mock('../../src/utils/database', () => ({ run: () => {}, get: () => null, all: () => [] }));
jest.mock('../../src/services/TokenService', () => ({
  consume: () => {},
  getBalance: () => ({ balance: 100000 }),
}));

const { AIRouterService } = require('../../src/ai/services/AIRouterService');

function routerWithFakeProvider() {
  const router = new AIRouterService({});
  const calls = { n: 0 };
  const fake = {
    name: 'openai',
    isConfigured: () => true,
    isAvailable: () => true,
    complete: async () => {
      calls.n++;
      return { content: `resposta ${calls.n}`, usage: { promptTokens: 10, completionTokens: 5 }, model: 'fake' };
    },
  };
  router.providers.set('openai', fake); // BALANCED prioriza openai
  return { router, calls };
}

describe('AIRouterService.getCacheKey', () => {
  test('usa a cacheKey semântica estável quando fornecida', () => {
    const r = new AIRouterService({});
    const k = r.getCacheKey([{ role: 'user', content: 'qualquer coisa' }], { tenantId: 'w1', cacheKey: 'ABC' });
    expect(k).toBe('w1:sem:ABC');
  });

  test('sem cacheKey, a chave depende das mensagens (comportamento antigo)', () => {
    const r = new AIRouterService({});
    const k1 = r.getCacheKey([{ role: 'user', content: 'A' }], { tenantId: 'w1' });
    const k2 = r.getCacheKey([{ role: 'user', content: 'B' }], { tenantId: 'w1' });
    expect(k1).not.toBe(k2);
  });
});

describe('AIRouterService — deflexão por cacheKey semântica', () => {
  test('mensagens diferentes + mesma cacheKey => LLM chamado UMA vez', async () => {
    const { router, calls } = routerWithFakeProvider();
    const a = await router.complete([{ role: 'user', content: 'conversa A, histórico A' }], { tenantId: 'w1', cacheKey: 'K' });
    const b = await router.complete([{ role: 'user', content: 'conversa B, histórico B' }], { tenantId: 'w1', cacheKey: 'K' });
    expect(calls.n).toBe(1);
    expect(b.cached).toBe(true);
    expect(b.content).toBe(a.content); // mesma resposta servida do cache
  });

  test('cacheKeys diferentes => LLM chamado para cada uma', async () => {
    const { router, calls } = routerWithFakeProvider();
    await router.complete([{ role: 'user', content: 'x' }], { tenantId: 'w1', cacheKey: 'K1' });
    await router.complete([{ role: 'user', content: 'x' }], { tenantId: 'w1', cacheKey: 'K2' });
    expect(calls.n).toBe(2);
  });

  test('isolamento por tenant: mesma cacheKey, tenants diferentes => 2 chamadas', async () => {
    const { router, calls } = routerWithFakeProvider();
    await router.complete([{ role: 'user', content: 'x' }], { tenantId: 'w1', cacheKey: 'K' });
    await router.complete([{ role: 'user', content: 'x' }], { tenantId: 'w2', cacheKey: 'K' });
    expect(calls.n).toBe(2);
  });
});
