/**
 * k6 Load Test — Signup Flow
 *
 * Como rodar:
 *   k6 run tests/load/signup-flow.k6.js
 *
 * Targets:
 *   - 100 concurrent users sustained 5min
 *   - p95 < 500ms
 *   - error rate < 1%
 *   - CPU server < 80%
 *
 * Setup:
 *   brew install k6   # ou apt install k6 (https://k6.io/docs/get-started/installation)
 *
 * Env vars:
 *   BASE_URL=https://staging.whatshybrid.com.br k6 run signup-flow.k6.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Custom metrics
const signupErrors = new Counter('signup_errors');
const loginErrors = new Counter('login_errors');
const successRate = new Rate('success_rate');
const signupDuration = new Trend('signup_duration_ms');

export const options = {
  stages: [
    { duration: '30s', target: 20 },   // ramp-up devagar
    { duration: '1m',  target: 50 },   // aumenta
    { duration: '2m',  target: 100 },  // pico — sustenta 2min
    { duration: '1m',  target: 50 },   // desce
    { duration: '30s', target: 0 },    // termina
  ],
  thresholds: {
    'http_req_duration':         ['p(95)<500'],   // 95% < 500ms
    'http_req_duration{type:signup}': ['p(95)<800'], // signup pode ser mais lento (bcrypt)
    'http_req_failed':           ['rate<0.01'],   // < 1% errors
    'success_rate':              ['rate>0.95'],   // 95% sucesso
  },
};

export default function () {
  const id = `${__VU}_${__ITER}_${Date.now()}`;
  const email = `loadtest_${id}@example.com`;
  const password = 'LoadTest1234!';

  // 1. Health check
  const healthRes = http.get(`${BASE_URL}/health`, { tags: { type: 'health' } });
  check(healthRes, { 'health 200': (r) => r.status === 200 });

  sleep(0.2);

  // 2. Signup
  const signupStart = Date.now();
  const signupRes = http.post(
    `${BASE_URL}/api/v1/auth/signup`,
    JSON.stringify({
      email, password, name: `User ${id}`,
      company: 'Load Test Co',
      plan: 'starter',
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { type: 'signup' },
    }
  );
  signupDuration.add(Date.now() - signupStart);

  const signupOk = check(signupRes, {
    'signup 201': (r) => [200, 201].includes(r.status),
    'signup has token': (r) => {
      try { return r.json('accessToken') !== undefined; }
      catch { return false; }
    },
  });

  if (!signupOk) {
    signupErrors.add(1);
    successRate.add(false);
    return;
  }
  successRate.add(true);

  let accessToken;
  try { accessToken = signupRes.json('accessToken'); }
  catch { return; }

  sleep(0.5);

  // 3. Get balance (autenticado)
  const balanceRes = http.get(`${BASE_URL}/api/v1/tokens/balance`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    tags: { type: 'authenticated' },
  });
  check(balanceRes, { 'balance 200': (r) => r.status === 200 });

  sleep(0.3);

  // 4. AI settings GET
  const aiSettingsRes = http.get(`${BASE_URL}/api/v1/ai-settings`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    tags: { type: 'authenticated' },
  });
  check(aiSettingsRes, { 'ai-settings 200': (r) => r.status === 200 });

  sleep(0.5);

  // 5. Login (refresh)
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email, password }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { type: 'login' },
    }
  );
  const loginOk = check(loginRes, {
    'login 200': (r) => r.status === 200,
  });
  if (!loginOk) loginErrors.add(1);

  sleep(1);
}

export function handleSummary(data) {
  return {
    'tests/load/results/signup-summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  return `
╔══════════════════════════════════════════════════╗
║  WhatsHybrid Pro — Load Test Results             ║
╚══════════════════════════════════════════════════╝

Iterations: ${data.metrics.iterations.values.count}
VUs max:    ${data.metrics.vus_max.values.max}

HTTP duration:
  avg: ${data.metrics.http_req_duration.values.avg.toFixed(0)}ms
  p95: ${data.metrics.http_req_duration.values['p(95)'].toFixed(0)}ms
  p99: ${data.metrics.http_req_duration.values['p(99)'].toFixed(0)}ms

Failed:        ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%
Success rate:  ${(data.metrics.success_rate?.values.rate * 100 || 0).toFixed(2)}%

Signup errors: ${data.metrics.signup_errors?.values.count || 0}
Login errors:  ${data.metrics.login_errors?.values.count || 0}

Threshold breach:
${Object.entries(data.metrics)
  .filter(([_, v]) => v.thresholds && Object.values(v.thresholds).some(t => t.ok === false))
  .map(([k]) => `  ❌ ${k}`)
  .join('\n') || '  ✅ Todos thresholds passaram'}
`;
}
