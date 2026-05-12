/**
 * AIRouterService.classifyError — testes formais (v9.5.0)
 * Cobre classificação de erros (auth/rate_limit/server/timeout/unknown).
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(40);
process.env.WEBHOOK_SECRET = 'x'.repeat(40);
process.env.OPENAI_API_KEY = 'sk-test';

let passed = 0, failed = 0;
const log = (ok, name) => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
};

console.log('\n=== AIRouterService.classifyError ===\n');

const router = require('../../src/ai/services/AIRouterService');

// 1. 401 → auth, cooldown 24h
const c1 = router.classifyError({ status: 401 }, 'openai');
log(c1.type === 'auth' && c1.action === 'cooldown' && c1.durationMs === 24 * 60 * 60 * 1000, '401 → auth + cooldown 24h');

// 2. 403 → auth
const c2 = router.classifyError({ status: 403 }, 'openai');
log(c2.type === 'auth', '403 → auth');

// 3. msg "API key invalid" → auth
const c3 = router.classifyError({ message: 'Invalid API key' }, 'openai');
log(c3.type === 'auth', '"API key invalid" → auth');

// 4. 429 → rate_limit, cooldown 1h
const c4 = router.classifyError({ status: 429 }, 'openai');
log(c4.type === 'rate_limit' && c4.durationMs === 60 * 60 * 1000, '429 → rate_limit + cooldown 1h');

// 5. msg "rate limit exceeded" → rate_limit
const c5 = router.classifyError({ message: 'Rate limit exceeded' }, 'openai');
log(c5.type === 'rate_limit', '"rate limit" message → rate_limit');

// 6. 500 → server, cooldown 30s
const c6 = router.classifyError({ status: 500 }, 'openai');
log(c6.type === 'server' && c6.durationMs === 30 * 1000, '500 → server + cooldown 30s');

// 7. 502 → server
const c7 = router.classifyError({ status: 502 }, 'openai');
log(c7.type === 'server', '502 → server');

// 8. msg "timeout" → timeout, cooldown 2min
const c8 = router.classifyError({ message: 'Request timeout' }, 'openai');
log(c8.type === 'timeout' && c8.durationMs === 2 * 60 * 1000, '"timeout" → timeout + cooldown 2min');

// 9. msg "aborted" → timeout
const c9 = router.classifyError({ message: 'Request was aborted' }, 'openai');
log(c9.type === 'timeout', '"aborted" → timeout');

// 10. erro desconhecido → unknown, no cooldown
const c10 = router.classifyError({ message: 'Some random thing' }, 'openai');
log(c10.type === 'unknown' && c10.action === 'none', 'erro genérico → unknown sem cooldown');

// 11. Status como number string
const c11 = router.classifyError({ status: 503 }, 'openai');
log(c11.type === 'server', '503 → server');

// 12. error.response.status (axios style)
const c12 = router.classifyError({ response: { status: 429 } }, 'openai');
log(c12.type === 'rate_limit', 'response.status pega rate_limit');

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Result: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
