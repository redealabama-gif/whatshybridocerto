/**
 * Smoke test — fluxo de tokens (saldo, histórico, packages)
 *
 * Pré-requisito: precisa de um usuário logado.
 */

const assert = require('node:assert/strict');

const BASE_URL = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const NS = `tok_${Date.now()}`;

let passed = 0, failed = 0;

async function step(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
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
  console.log(`\n🧪 SMOKE TEST: Tokens Flow @ ${BASE_URL}\n`);

  // Setup user
  const email = `${NS}@example.com`;
  const password = 'SmokeTest123!';
  const signupR = await http('POST', '/api/v1/auth/signup', {
    email, password, name: 'Tokens Test', plan: 'starter',
  });
  if (![200, 201].includes(signupR.status)) {
    console.log(`❌ Setup failed: signup ${signupR.status}`);
    process.exit(1);
  }
  const token = signupR.data.accessToken;
  const auth = { Authorization: `Bearer ${token}` };

  await step('GET /tokens/balance returns balance', async () => {
    const r = await http('GET', '/api/v1/tokens/balance', null, auth);
    assert.equal(r.status, 200);
    assert.ok(typeof r.data.balance === 'number' || typeof r.data.tokens === 'number');
  });

  await step('GET /tokens/history returns array', async () => {
    const r = await http('GET', '/api/v1/tokens/history', null, auth);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.transactions));
  });

  await step('GET /tokens/packages returns packages list', async () => {
    const r = await http('GET', '/api/v1/tokens/packages', null, auth);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.packages));
    assert.ok(r.data.packages.length > 0);
    assert.ok(r.data.packages[0].id);
    assert.ok(typeof r.data.packages[0].tokens === 'number');
    assert.ok(typeof r.data.packages[0].price_brl === 'number');
  });

  await step('GET /tokens/usage returns aggregated usage', async () => {
    const r = await http('GET', '/api/v1/tokens/usage', null, auth);
    assert.equal(r.status, 200);
  });

  console.log(`\n📊 RESULT: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
