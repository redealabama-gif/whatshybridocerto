/**
 * Smoke test — fluxo completo de autenticação
 *
 * Roda contra um servidor em $TEST_BASE_URL (default: http://localhost:3000).
 * Não usa frameworks pesados (Jest/Mocha) — só Node + assert nativo, pra ser
 * o mais leve possível e rodar até em CI mínimo.
 *
 * Execute: BASE_URL=http://localhost:3000 node tests/smoke/auth-flow.test.js
 */

const assert = require('node:assert/strict');

const BASE_URL = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const NS = `smoke_${Date.now()}`;

let passed = 0, failed = 0;
const results = [];

async function step(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    results.push({ name, ok: true });
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    results.push({ name, ok: false, error: e.message });
    failed++;
  }
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
  console.log(`\n🧪 SMOKE TEST: Auth Flow @ ${BASE_URL}\n`);

  // Health check
  await step('GET /health responds 200', async () => {
    const r = await http('GET', '/health');
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'ok');
  });

  await step('GET /health/deep responds with checks', async () => {
    const r = await http('GET', '/health/deep');
    assert.ok([200, 503].includes(r.status));
    assert.ok(r.data.checks);
    assert.ok(r.data.checks.db);
  });

  // Signup
  const testEmail = `${NS}@example.com`;
  const testPassword = 'SmokeTest123!';
  let accessToken, refreshToken, userId;

  await step('POST /auth/signup creates user', async () => {
    const r = await http('POST', '/api/v1/auth/signup', {
      email: testEmail,
      password: testPassword,
      name: 'Smoke Test',
      company: 'Smoke Co',
      plan: 'starter',
    });
    assert.ok([200, 201].includes(r.status), `Got ${r.status}: ${JSON.stringify(r.data)}`);
    assert.ok(r.data.accessToken);
    accessToken = r.data.accessToken;
    refreshToken = r.data.refreshToken;
    userId = r.data.user?.id;
  });

  await step('POST /auth/signup duplicate email rejected', async () => {
    const r = await http('POST', '/api/v1/auth/signup', {
      email: testEmail,
      password: testPassword,
      name: 'Dup',
    });
    assert.ok(r.status >= 400 && r.status < 500);
  });

  // Login
  await step('POST /auth/login with correct password works', async () => {
    const r = await http('POST', '/api/v1/auth/login', {
      email: testEmail,
      password: testPassword,
    });
    assert.equal(r.status, 200);
    assert.ok(r.data.accessToken);
  });

  await step('POST /auth/login with wrong password fails', async () => {
    const r = await http('POST', '/api/v1/auth/login', {
      email: testEmail,
      password: 'wrong-password',
    });
    assert.ok(r.status >= 400 && r.status < 500);
  });

  // Authenticated endpoint
  await step('GET /auth/me with token returns user', async () => {
    const r = await http('GET', '/api/v1/auth/me', null, {
      Authorization: `Bearer ${accessToken}`,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.user?.email, testEmail);
  });

  await step('GET /auth/me without token fails', async () => {
    const r = await http('GET', '/api/v1/auth/me');
    assert.equal(r.status, 401);
  });

  // Refresh rotation
  let newAccessToken, newRefreshToken;
  await step('POST /auth/refresh rotates token', async () => {
    const r = await http('POST', '/api/v1/auth/refresh', { refreshToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.accessToken);
    assert.ok(r.data.refreshToken);
    assert.notEqual(r.data.refreshToken, refreshToken, 'refresh token deve rotacionar');
    newAccessToken = r.data.accessToken;
    newRefreshToken = r.data.refreshToken;
  });

  await step('REUSE detection: old refresh token now invalid', async () => {
    const r = await http('POST', '/api/v1/auth/refresh', { refreshToken });
    assert.ok(r.status >= 400, 'old refresh deveria falhar (rotação)');
  });

  // Forgot password
  await step('POST /auth/forgot-password always returns 200', async () => {
    const r = await http('POST', '/api/v1/auth/forgot-password', {
      email: testEmail,
    });
    assert.equal(r.status, 200);
    assert.ok(r.data.ok);
  });

  await step('POST /auth/forgot-password unknown email also returns 200', async () => {
    const r = await http('POST', '/api/v1/auth/forgot-password', {
      email: 'nonexistent@example.com',
    });
    assert.equal(r.status, 200);
  });

  // Summary
  console.log(`\n📊 RESULT: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    console.log('❌ SMOKE TEST FAILED');
    process.exit(1);
  }
  console.log('✅ All smoke tests passed');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
