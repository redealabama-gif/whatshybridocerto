/**
 * IA-61 — AIRouter respeita o Retry-After do provedor no 429.
 *
 * Antes: todo 429 colocava o provedor em cooldown fixo de 1h, mesmo quando o
 * provedor pedia só alguns segundos (header Retry-After). Numa chave
 * compartilhada sob carga, o provedor voltava muito depois do necessário.
 * Agora o cooldown usa o Retry-After (segundos ou data HTTP), limitado a [1s, 1h].
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(40);
process.env.WEBHOOK_SECRET = 'x'.repeat(40);
process.env.OPENAI_API_KEY = 'sk-test';

const router = require('../../src/ai/services/AIRouterService');

describe('AIRouter Retry-After (IA-61)', () => {
  test('429 sem Retry-After → cooldown 1h (padrão mantido)', () => {
    const c = router.classifyError({ status: 429 }, 'groq');
    expect(c.type).toBe('rate_limit');
    expect(c.durationMs).toBe(60 * 60 * 1000);
  });

  test('429 com Retry-After: 20 → cooldown 20s', () => {
    const c = router.classifyError({ status: 429, retryAfter: '20' }, 'groq');
    expect(c.durationMs).toBe(20 * 1000);
  });

  test('Retry-After acima de 1h é limitado a 1h', () => {
    const c = router.classifyError({ status: 429, retryAfter: '99999' }, 'groq');
    expect(c.durationMs).toBe(60 * 60 * 1000);
  });

  test('Retry-After 0 vira o mínimo de 1s (não cooldown zero)', () => {
    const c = router.classifyError({ status: 429, retryAfter: '0' }, 'groq');
    expect(c.durationMs).toBe(1000);
  });

  test('Retry-After como data HTTP futura → espera até a data', () => {
    const futuro = new Date(Date.now() + 45 * 1000).toUTCString();
    const c = router.classifyError({ status: 429, retryAfter: futuro }, 'openai');
    expect(c.durationMs).toBeGreaterThanOrEqual(40 * 1000);
    expect(c.durationMs).toBeLessThanOrEqual(46 * 1000);
  });

  test('Retry-After inválido cai no padrão de 1h', () => {
    const c = router.classifyError({ status: 429, retryAfter: 'xyz' }, 'openai');
    expect(c.durationMs).toBe(60 * 60 * 1000);
  });

  test('_parseRetryAfter: segundos, nulo e inválido', () => {
    expect(router._parseRetryAfter('30')).toBe(30000);
    expect(router._parseRetryAfter(null)).toBeNull();
    expect(router._parseRetryAfter('não-é-data')).toBeNull();
  });
});
