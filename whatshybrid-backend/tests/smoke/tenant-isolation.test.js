/**
 * Smoke test — isolamento de tenant (CRÍTICO)
 *
 * Cria 2 workspaces, tenta acessar dados cruzados.
 * Detecta vazamentos de workspace_id.
 */

const assert = require('node:assert/strict');

const BASE_URL = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const NS = Date.now();

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

async function setupUser(email, password) {
  const r = await http('POST', '/api/v1/auth/signup', {
    email, password, name: 'Test', plan: 'starter',
  });
  if (![200, 201].includes(r.status)) {
    throw new Error(`Setup failed: ${r.status} ${JSON.stringify(r.data)}`);
  }
  return { token: r.data.accessToken, user: r.data.user };
}

async function run() {
  console.log(`\n🧪 SMOKE TEST: Tenant Isolation @ ${BASE_URL}\n`);

  const a = await setupUser(`tenant_a_${NS}@example.com`, 'TenantA123!');
  const b = await setupUser(`tenant_b_${NS}@example.com`, 'TenantB123!');

  console.log(`  → User A: ${a.user.email}`);
  console.log(`  → User B: ${b.user.email}`);

  const authA = { Authorization: `Bearer ${a.token}` };
  const authB = { Authorization: `Bearer ${b.token}` };

  // A cria contato
  let contactAId;
  await step('User A creates contact', async () => {
    const r = await http('POST', '/api/v1/contacts', {
      phone: '5511999990000',
      name: 'Tenant A Contact',
    }, authA);
    assert.ok([200, 201].includes(r.status), `${r.status}`);
    contactAId = r.data.contact?.id || r.data.id;
    assert.ok(contactAId, 'contact ID returned');
  });

  await step('User B cannot see User A contact via list', async () => {
    const r = await http('GET', '/api/v1/contacts', null, authB);
    if (r.status !== 200) return; // se não acessível, ok
    const contacts = r.data.contacts || r.data || [];
    const found = contacts.find(c => c.id === contactAId);
    assert.ok(!found, 'tenant B viu contato do tenant A!');
  });

  await step('User B cannot fetch User A contact directly', async () => {
    const r = await http('GET', `/api/v1/contacts/${contactAId}`, null, authB);
    assert.ok(r.status === 404 || r.status === 403, `B accessed A contact (${r.status})`);
  });

  await step('User B cannot DELETE User A contact', async () => {
    const r = await http('DELETE', `/api/v1/contacts/${contactAId}`, null, authB);
    assert.ok(r.status === 404 || r.status === 403, `B deleted A contact (${r.status})`);
  });

  await step('User B cannot UPDATE User A contact', async () => {
    const r = await http('PUT', `/api/v1/contacts/${contactAId}`, {
      name: 'PWNED',
    }, authB);
    assert.ok(r.status === 404 || r.status === 403, `B updated A contact (${r.status})`);
  });

  // A consegue acessar o próprio
  await step('User A still has access to own contact', async () => {
    const r = await http('GET', `/api/v1/contacts/${contactAId}`, null, authA);
    assert.equal(r.status, 200);
  });

  console.log(`\n📊 RESULT: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
