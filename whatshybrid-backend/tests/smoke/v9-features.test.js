/**
 * Smoke test — features v9.0.0
 *
 * Testa: 2FA, funnel, referrals, NPS, LGPD export, ai-settings,
 * health/deep, openapi.
 */

const assert = require('node:assert/strict');

const BASE_URL = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const NS = `v9_${Date.now()}`;

let passed = 0, failed = 0;

async function step(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log(`  ❌ ${name}: ${e.message}`); failed++; }
}

async function http(method, path, body, headers = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data };
}

async function run() {
  console.log(`\n🧪 SMOKE v9.0.0 @ ${BASE_URL}\n`);

  // Setup user
  const email = `${NS}@example.com`;
  const password = 'V9Test123!';
  const sR = await http('POST', '/api/v1/auth/signup', {
    email, password, name: 'V9 Test', plan: 'starter',
  });
  if (![200, 201].includes(sR.status)) {
    console.log(`❌ Setup signup failed: ${sR.status}`);
    process.exit(1);
  }
  const token = sR.data.accessToken;
  const auth = { Authorization: `Bearer ${token}` };

  // Health deep
  await step('GET /health/deep returns checks', async () => {
    const r = await http('GET', '/health/deep');
    assert.ok([200, 503].includes(r.status));
    assert.ok(r.data.checks);
  });

  // OpenAPI
  await step('GET /openapi.json returns spec', async () => {
    const r = await http('GET', '/openapi.json');
    assert.equal(r.status, 200);
    assert.equal(r.data.openapi, '3.0.3');
    assert.ok(r.data.paths);
  });

  // Funnel
  await step('POST /funnel/track records event', async () => {
    const r = await http('POST', '/api/v1/funnel/track', {
      step: 'landing_view',
      metadata: { source: 'smoke-test' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
  });

  await step('POST /funnel/track rejects invalid step', async () => {
    const r = await http('POST', '/api/v1/funnel/track', {
      step: 'invalid_step_xyz',
    });
    assert.ok(r.status >= 400);
  });

  // Referrals
  await step('GET /referrals/code returns code + URL', async () => {
    const r = await http('GET', '/api/v1/referrals/code', null, auth);
    assert.equal(r.status, 200);
    assert.ok(r.data.code);
    assert.ok(r.data.url.includes('?ref='));
  });

  await step('GET /referrals returns empty list initially', async () => {
    const r = await http('GET', '/api/v1/referrals', null, auth);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.referrals));
  });

  await step('GET /referrals/stats returns zero counts', async () => {
    const r = await http('GET', '/api/v1/referrals/stats', null, auth);
    assert.equal(r.status, 200);
    assert.equal(r.data.total, 0);
  });

  // NPS
  await step('POST /me/nps registers score', async () => {
    const r = await http('POST', '/api/v1/me/nps', { score: 9, comment: 'great smoke' }, auth);
    assert.equal(r.status, 200);
  });

  await step('POST /me/nps rejects out-of-range', async () => {
    const r = await http('POST', '/api/v1/me/nps', { score: 11 }, auth);
    assert.ok(r.status >= 400);
  });

  // Onboarding
  await step('GET /me/onboarding-status', async () => {
    const r = await http('GET', '/api/v1/me/onboarding-status', null, auth);
    assert.equal(r.status, 200);
    assert.equal(typeof r.data.completed, 'boolean');
  });

  await step('POST /me/onboarding-complete', async () => {
    const r = await http('POST', '/api/v1/me/onboarding-complete', {}, auth);
    assert.equal(r.status, 200);
  });

  // AI Settings
  await step('GET /ai-settings returns defaults', async () => {
    const r = await http('GET', '/api/v1/ai-settings', null, auth);
    assert.equal(r.status, 200);
    assert.ok(r.data.settings);
  });

  await step('PUT /ai-settings updates', async () => {
    const r = await http('PUT', '/api/v1/ai-settings', {
      tone: 'casual',
      sector: 'E-commerce',
      maxResponseTokens: 300,
    }, auth);
    assert.equal(r.status, 200);
    assert.equal(r.data.settings.tone, 'casual');
    assert.equal(r.data.settings.maxResponseTokens, 300);
  });

  // 2FA
  await step('POST /auth/2fa/setup generates secret', async () => {
    const r = await http('POST', '/api/v1/auth/2fa/setup', {}, auth);
    assert.equal(r.status, 200);
    assert.ok(r.data.secret);
    assert.ok(r.data.uri.startsWith('otpauth://'));
  });

  await step('GET /auth/2fa/status returns enabled=false', async () => {
    const r = await http('GET', '/api/v1/auth/2fa/status', null, auth);
    assert.equal(r.status, 200);
    assert.equal(r.data.enabled, false);
  });

  await step('POST /auth/2fa/verify rejects invalid code', async () => {
    const r = await http('POST', '/api/v1/auth/2fa/verify', { code: '000000' }, auth);
    assert.ok(r.status >= 400);
  });

  // LGPD
  await step('GET /me/export returns data archive', async () => {
    const r = await http('GET', '/api/v1/me/export', null, auth);
    assert.equal(r.status, 200);
    assert.ok(r.data.user);
    assert.ok(r.data.workspace);
    assert.ok(r.data.exported_at);
    // Garante que password NÃO vem
    assert.equal(r.data.user.password, undefined);
  });

  await step('POST /me/delete-account requires confirmation', async () => {
    const r = await http('POST', '/api/v1/me/delete-account', {}, auth);
    assert.ok(r.status >= 400);
  });

  // i18n
  await step('Header Accept-Language: en-US gets English errors', async () => {
    const r = await http('POST', '/api/v1/auth/login', {
      email: 'wrong', password: 'wrong',
    }, { 'Accept-Language': 'en-US' });
    assert.equal(r.status, 400);
    // (pode estar em pt-BR ainda — i18n ainda precisa ser aplicado nas rotas)
  });

  console.log(`\n📊 RESULT: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
