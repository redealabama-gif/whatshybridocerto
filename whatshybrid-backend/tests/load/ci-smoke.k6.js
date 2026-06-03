/**
 * k6 Load SMOKE — variante curta p/ CI (gate de performance).
 *
 * O signup-flow.k6.js é o teste de carga "completo" (100 VUs, 5min) p/ rodar
 * sob demanda contra staging. Este é a versão de CI: ramp curto, mas com
 * THRESHOLDS que FALHAM o build.
 *
 * Design (estável e significativo num runner compartilhado):
 *   - setup() cria poucos usuários UMA vez (o signup faz bcryptjs, que é
 *     CPU-bound e bloqueia o event loop — não serve de carga repetida);
 *   - o hot loop é read-heavy + uma escrita barata (criar contato = INSERT),
 *     que mede a latência REAL de servir HTTP sob concorrência sem ser dominado
 *     por bcrypt;
 *   - gates: taxa de erro (correção sob carga) + p95 de leitura/escrita.
 *
 * Rodar local:  BASE_URL=http://localhost:3000 k6 run tests/load/ci-smoke.k6.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const flowOk = new Rate('flow_ok');

export const options = {
  setupTimeout: '60s',
  scenarios: {
    smoke: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 15 }, // sobe
        { duration: '25s', target: 25 }, // sustenta o pico
        { duration: '5s', target: 0 }, // desce
      ],
      gracefulStop: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // GATE: < 1% de requests com erro
    flow_ok: ['rate>0.98'], // GATE: > 98% dos fluxos completos ok
    'http_req_duration{type:read}': ['p(95)<800'], // GATE: leitura
    'http_req_duration{type:write}': ['p(95)<1200'], // GATE: escrita (INSERT)
  },
};

// Cria poucos usuários (tokens) uma única vez — fora do hot loop.
export function setup() {
  const tokens = [];
  for (let i = 0; i < 5; i++) {
    const email = `ciload_setup_${i}_${Date.now()}@example.com`;
    const r = http.post(
      `${BASE_URL}/api/v1/auth/signup`,
      JSON.stringify({
        email,
        password: 'CiLoad1234!',
        name: `S${i}`,
        company: 'CI',
        plan: 'starter',
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    try {
      const t = r.json('accessToken');
      if (t) tokens.push(t);
    } catch (_) {
      /* ignora */
    }
  }
  if (tokens.length === 0) throw new Error('setup falhou: nenhum token criado');
  return { tokens };
}

export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const auth = { Authorization: `Bearer ${token}` };

  // 1) leitura barata, sem auth
  const health = http.get(`${BASE_URL}/health`, { tags: { type: 'read' } });
  const okH = check(health, { 'health 200': (r) => r.status === 200 });

  // 2) leitura autenticada
  const bal = http.get(`${BASE_URL}/api/v1/tokens/balance`, {
    headers: auth,
    tags: { type: 'read' },
  });
  const okB = check(bal, { 'balance 200': (r) => r.status === 200 });

  // 3) escrita autenticada barata (INSERT de contato; phone único por iteração)
  const phone = `${__VU}${__ITER}${Date.now()}`.slice(0, 18);
  const create = http.post(
    `${BASE_URL}/api/v1/contacts`,
    JSON.stringify({ phone, name: `C${__VU}_${__ITER}` }),
    { headers: { 'Content-Type': 'application/json', ...auth }, tags: { type: 'write' } }
  );
  const okC = check(create, { 'contact 201': (r) => r.status === 201 });

  flowOk.add(okH && okB && okC);
  sleep(0.2);
}
