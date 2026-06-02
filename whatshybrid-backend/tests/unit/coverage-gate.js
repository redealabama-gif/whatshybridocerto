#!/usr/bin/env node
/**
 * Gate de COBERTURA zero-dependência.
 *
 * Roda a suíte zero-dep (tests/unit/run-zerodep.js) sob a cobertura V8 NATIVA
 * do Node (env NODE_V8_COVERAGE) — sem c8/istanbul, sem `npm ci`. Computa a
 * cobertura de LINHA de cada arquivo crítico e falha se algum cair abaixo do
 * piso. É um RATCHET: os pisos travam a cobertura atual (medida menos uma
 * margem); remover um teste ou adicionar código não-testado a um desses
 * arquivos derruba o número e quebra o CI.
 *
 * Por que não Jest --coverage? O Jest só roda `.spec.js` e IGNORA os `.test.js`
 * zero-dep — justamente os que cobrem o caminho do dinheiro. Além disso o job
 * static-checks roda sem deps. A cobertura V8 nativa mede exatamente a suíte
 * que de fato exercita esses arquivos.
 *
 * Atualizar pisos: rode localmente, veja a coluna "atual" e suba o piso (nunca
 * abaixe sem motivo — o ponto é não regredir). Rode: node tests/unit/coverage-gate.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Pisos de cobertura de LINHA (%). Ratchet: piso ≈ medido - margem (~5pts).
// Só arquivos exercitados pela suíte ZERO-DEP entram aqui (os testados via Jest
// — AIRouter/HealthScore/JobsRunner — não são medidos por esta suíte).
const THRESHOLDS = {
  // caminho do dinheiro (foco do endurecimento recente)
  'src/services/BillingLinkService.js': 90,
  'src/services/CouponService.js': 90,
  'src/services/TokenService.js': 62,
  'src/jobs/billingCron.js': 55,
  'src/routes/webhooks-payment-saas.js': 48,
  // core/segurança com teste zero-dep dedicado
  'src/services/AuthService.js': 68,
  'src/registry/OrchestratorRegistry.js': 88,
  'src/ai/services/AutopilotMaturityService.js': 92,
  'src/utils/db/postgres-driver.js': 40,
};

const BACKEND = path.resolve(__dirname, '../..'); // .../whatshybrid-backend
const targets = Object.keys(THRESHOLDS);

// ── 1) Roda a suíte zero-dep sob cobertura V8 nativa ──────────────────
const covDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whl-cov-'));
console.log('\n🧪 Gate de cobertura — rodando suíte zero-dep sob NODE_V8_COVERAGE\n');
const run = spawnSync(process.execPath, [path.join(__dirname, 'run-zerodep.js')], {
  stdio: 'inherit',
  env: { ...process.env, NODE_V8_COVERAGE: covDir },
});
if (run.status !== 0) {
  console.error('\n✗ Testes zero-dep falharam — gate de cobertura abortado.');
  try { fs.rmSync(covDir, { recursive: true, force: true }); } catch (_) {}
  process.exit(run.status || 1);
}

// ── 2) Computa cobertura de linha por arquivo (merge max entre processos) ──
// Para cada arquivo: aplica os ranges do V8 (sort outer→inner, innermost-wins)
// montando contagem por byte; faz merge por MÁXIMO entre os vários processos
// (um arquivo pode ser carregado por mais de um teste).
const perFile = {};
for (const t of targets) {
  const source = fs.readFileSync(path.join(BACKEND, t), 'utf8');
  perFile[t] = { source, counts: new Int32Array(source.length).fill(-1) };
}
for (const jf of fs.readdirSync(covDir).filter(f => f.endsWith('.json'))) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(covDir, jf))); } catch (_) { continue; }
  for (const sc of (j.result || [])) {
    const t = targets.find(tt => sc.url.endsWith('/' + tt) || sc.url.endsWith(tt));
    if (!t) continue;
    const pf = perFile[t];
    const ranges = [];
    for (const fn of sc.functions) for (const r of fn.ranges) ranges.push(r);
    ranges.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    const local = new Int32Array(pf.counts.length).fill(-1);
    for (const r of ranges) {
      const end = Math.min(r.endOffset, local.length);
      for (let i = r.startOffset; i < end; i++) local[i] = r.count;
    }
    for (let i = 0; i < local.length; i++) if (local[i] > pf.counts[i]) pf.counts[i] = local[i];
  }
}
try { fs.rmSync(covDir, { recursive: true, force: true }); } catch (_) {}

function lineCoverage({ source, counts }) {
  let total = 0, cov = 0, off = 0;
  for (const line of source.split('\n')) {
    let hasCode = false, covered = false;
    for (let k = 0; k < line.length; k++) {
      const ch = line[k];
      if (ch !== ' ' && ch !== '\t' && ch !== '\r') {
        hasCode = true;
        if (counts[off + k] > 0) { covered = true; break; }
      }
    }
    if (hasCode) { total++; if (covered) cov++; }
    off += line.length + 1;
  }
  const pct = total === 0 ? 100 : Math.round((cov / total) * 1000) / 10;
  return { pct, cov, total };
}

// ── 3) Compara com os pisos ───────────────────────────────────────────
console.log('\n=== Cobertura de linha vs piso ===\n');
console.log('  ' + 'arquivo'.padEnd(46) + 'atual'.padStart(7) + 'piso'.padStart(7) + '   status');
let failures = 0;
for (const t of targets) {
  const { pct, cov, total } = lineCoverage(perFile[t]);
  const floor = THRESHOLDS[t];
  const ok = pct >= floor;
  if (!ok) failures++;
  console.log(
    `  ${ok ? '✓' : '✗'} ${t.padEnd(44)}${String(pct).padStart(6)}%${String(floor).padStart(6)}%   ${ok ? 'ok' : 'ABAIXO'} (${cov}/${total})`
  );
}
console.log(`\n=== cobertura: ${targets.length - failures}/${targets.length} arquivo(s) acima do piso ===`);
if (failures > 0) {
  console.error(`\n✗ ${failures} arquivo(s) abaixo do piso de cobertura. Adicione testes ou ajuste o piso conscientemente.`);
  process.exit(1);
}
console.log('✅ Cobertura dentro do esperado.\n');
process.exit(0);
