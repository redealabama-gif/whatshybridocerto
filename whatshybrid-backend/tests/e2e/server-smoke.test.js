/**
 * Smoke E2E test — boota o servidor real (SQLite in-memory) e valida que
 * os 10+ endpoints críticos respondem com status esperados.
 *
 * Não usa jest — cria seu próprio runner pra ser consistente com tests/unit/.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(40);
process.env.OPENAI_API_KEY = 'sk-test-fake';
process.env.WEBHOOK_SECRET = 'x'.repeat(40);
process.env.PAYMENT_WEBHOOK_SECRET = 'y'.repeat(40);
process.env.PORT = '3199'; // smoke test fixed port
process.env.DB_PATH = ':memory:';
process.env.REDIS_DISABLED = 'true';
process.env.DISABLE_BILLING_CRON = 'true';

const path = require('path');

(async () => {
  let passed = 0, failed = 0;
  const log = (ok, name, msg = '') => {
    if (ok) { passed++; console.log(`  ✓ ${name}${msg ? ' — ' + msg : ''}`); }
    else { failed++; console.log(`  ✗ ${name}${msg ? ' — ' + msg : ''}`); }
  };

  // Limpa lock potencial deixado por sessão prévia
  try {
    require('fs').unlinkSync(path.join(process.cwd(), '.jobs_runner.lock'));
  } catch (_) { /* não existe */ }

  console.log('\n=== Server Smoke E2E ===\n');

  // Boota
  let server, app, port;
  try {
    process.env.DB_PATH = ':memory:';
    require('../../src/server.js');
    // Aguarda registro completo
    await new Promise(r => setTimeout(r, 500));
    log(true, 'Server bootou sem crash');
  } catch (e) {
    log(false, 'Server bootou', e.message);
    console.error(e.stack);
    process.exit(1);
  }

  // Health checks via fetch local — usa a porta que o server escolheu
  const fetch = require('node-fetch');

  // O server.js usa config.port que vem de PORT env. Como setamos PORT=0,
  // pegamos a porta dinamicamente pela var global que server.js exporta?
  // Não tem export. Vamos usar uma porta fixa diferente:
  // (Redo: setamos PORT explícito acima no test pra ter previsibilidade.)
  port = parseInt(process.env.PORT || '3199', 10);
  const base = `http://localhost:${port}`;

  // 1. /health
  try {
    const r = await fetch(`${base}/health`);
    const j = await r.json();
    log(r.status === 200 && j.status === 'ok', '/health responde 200 ok', `status=${r.status}`);
  } catch (e) {
    log(false, '/health responde', e.message);
  }

  // 2. /api/v1/auth/signup
  let token;
  try {
    const r = await fetch(`${base}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `test-${Date.now()}@smoke.test`,
        password: 'A1b2c3d4ef@123',
        name: 'Smoke Test',
        company: 'Smoke Test Co',
      }),
    });
    const j = await r.json();
    token = j.token || j.accessToken;
    log(r.status === 200 || r.status === 201, '/api/v1/auth/signup', `status=${r.status} hasToken=${!!token}`);
  } catch (e) {
    log(false, '/api/v1/auth/signup', e.message);
  }

  // 3. /api/v1/auth/login (com mesma credencial)
  try {
    const r = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'invalid@smoke.test',
        password: 'wrongpass',
      }),
    });
    log(r.status === 401 || r.status === 400, '/api/v1/auth/login rejeita credencial errada', `status=${r.status}`);
  } catch (e) {
    log(false, '/api/v1/auth/login', e.message);
  }

  // 4. /api/v1/auth/me sem auth
  try {
    const r = await fetch(`${base}/api/v1/auth/me`);
    log(r.status === 401, '/api/v1/auth/me rejeita sem auth', `status=${r.status}`);
  } catch (e) {
    log(false, '/api/v1/auth/me', e.message);
  }

  // 5. /api/v1/auth/me com auth
  if (token) {
    try {
      const r = await fetch(`${base}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      log(r.status === 200, '/api/v1/auth/me responde 200 com auth', `status=${r.status}`);
    } catch (e) {
      log(false, '/api/v1/auth/me com auth', e.message);
    }
  }

  // 6. /api/v1/tokens/balance com auth
  if (token) {
    try {
      const r = await fetch(`${base}/api/v1/tokens/balance`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      log(r.status === 200, '/api/v1/tokens/balance responde 200', `status=${r.status}`);
    } catch (e) {
      log(false, '/api/v1/tokens/balance', e.message);
    }
  }

  // 7. /api/v1/ai/complete sem auth
  try {
    const r = await fetch(`${base}/api/v1/ai/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    log(r.status === 401, '/api/v1/ai/complete rejeita sem auth', `status=${r.status}`);
  } catch (e) {
    log(false, '/api/v1/ai/complete sem auth', e.message);
  }

  // 8. /api/v1/webhooks/payment/stripe sem assinatura
  try {
    const r = await fetch(`${base}/api/v1/webhooks/payment/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    log(r.status === 401 || r.status === 400, '/webhooks/payment/stripe sem signature → rejeitado', `status=${r.status}`);
  } catch (e) {
    log(false, '/webhooks/payment/stripe', e.message);
  }

  // 9. /api/v1/auth/refresh sem token
  try {
    const r = await fetch(`${base}/api/v1/auth/refresh`, { method: 'POST' });
    log(r.status >= 400, '/api/v1/auth/refresh sem token rejeita', `status=${r.status}`);
  } catch (e) {
    log(false, '/api/v1/auth/refresh', e.message);
  }

  // 10. /api/v1/extension/version (público)
  try {
    const r = await fetch(`${base}/api/v1/extension/version`);
    log(r.status === 200, '/api/v1/extension/version responde 200', `status=${r.status}`);
  } catch (e) {
    log(false, '/api/v1/extension/version', e.message);
  }

  // 11. CSRF token (público)
  try {
    const r = await fetch(`${base}/api/v1/auth/csrf-token`);
    // OK se 200 (gera) ou 404 (rota não existe nessa versão) — só queremos saber que o server roda
    log(r.status < 500, '/api/v1/auth/csrf-token não dá 5xx', `status=${r.status}`);
  } catch (e) {
    log(false, '/api/v1/auth/csrf-token', e.message);
  }

  // 12. /metrics endpoint (público pra Prometheus)
  try {
    const r = await fetch(`${base}/metrics`);
    log(r.status < 500, '/metrics não dá 5xx', `status=${r.status}`);
  } catch (e) {
    log(false, '/metrics', e.message);
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Result: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('✅ All tests passed');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed');
    process.exit(1);
  }
})();
