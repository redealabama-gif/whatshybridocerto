#!/usr/bin/env node
/**
 * Runner dos testes unitários standalone ZERO-DEPENDÊNCIA.
 *
 * Estes `.test.js` rodam com `node` puro (sem `npm ci`): mockam DB/serviços via
 * require.cache e chamam process.exit() no fim. O Jest (npm run test:unit) IGNORA
 * `.test.js` de propósito (ele engole o process.exit), então até agora estes
 * testes existiam mas NÃO eram exercidos por nenhum job de CI. Este runner os
 * coloca sob o gate do job `static-checks` (que não instala deps).
 *
 * Allowlist EXPLÍCITA: os testes que dependem de SDK real (stripe/mercadopago/
 * better-sqlite3) NÃO entram aqui — esses rodam no job Jest com as deps. Cada
 * teste roda em subprocesso porque chama process.exit().
 */
const { spawnSync } = require('child_process');
const path = require('path');

const TESTS = [
  'auth-service.test.js',
  'autopilot-maturity.test.js',
  'billing-cron-expired-trials.test.js',
  'billing-phase3.test.js',
  'billing-link-service.test.js',
  'webhooks-payment-saas.test.js',
  'coupon-service.test.js',
  'orchestrator-registry.test.js',
  'postgres-driver.test.js',
  'token-service.test.js',
];

console.log(`\n🧪 Backend — ${TESTS.length} teste(s) unitário(s) zero-dep\n`);

let failures = 0;
for (const t of TESTS) {
  const file = path.join(__dirname, t);
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (r.status !== 0) {
    failures++;
    console.error(`\n✗ FALHOU: ${t} (exit ${r.status})\n`);
  }
}

console.log(`\n=== zero-dep unit: ${TESTS.length - failures}/${TESTS.length} arquivo(s) OK ===`);
process.exit(failures > 0 ? 1 : 0);
