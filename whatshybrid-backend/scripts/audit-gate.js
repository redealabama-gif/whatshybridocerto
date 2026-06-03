#!/usr/bin/env node
/**
 * Gate de SEGURANÇA de dependências (bloqueante) — zero-dependência.
 *
 * Roda `npm audit --json` e FALHA o CI quando há vulnerabilidade high/critical
 * na superfície que importa, a menos que o advisory esteja explicitamente no
 * allowlist (.audit-allowlist.json) com justificativa e data de expiração.
 *
 * É o análogo de segurança do coverage-gate.js: um RATCHET. O baseline atual é
 * limpo (0 high/critical em produção). Qualquer high/critical NOVO em produção
 * quebra o build até ser corrigido — ou conscientemente allowlisted (com motivo
 * e validade) por um humano.
 *
 * Política (enterprise, defensável):
 *   - PRODUÇÃO (--omit=dev): high/critical → BLOQUEIA (a menos que allowlisted).
 *     É o que de fato é embarcado e executado em runtime.
 *   - DEV/build (devDependencies): high/critical → WARNING informativo.
 *     Não roda em produção; rastreado, não release-blocking.
 *   - moderate/low: WARNING (alvo de redução incremental, não bloqueia ainda).
 *
 * Allowlist (.audit-allowlist.json): array de entradas
 *   { "ghsa": "GHSA-xxxx", "package": "nome", "reason": "...", "expires": "YYYY-MM-DD" }
 * Uma entrada expirada deixa de suprimir o advisory (volta a bloquear) e emite
 * aviso de higiene — força revisão periódica.
 *
 * Uso:  node scripts/audit-gate.js
 * Exit: 0 = ok; 1 = high/critical de produção não-allowlisted; 2 = erro interno.
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ALLOWLIST_PATH = path.resolve(__dirname, '..', '.audit-allowlist.json');
const BLOCKING = new Set(['high', 'critical']);

/** Roda `npm audit --json [--omit=dev]` e devolve o objeto parseado. */
function runAudit({ omitDev }) {
  const args = ['audit', '--json'];
  if (omitDev) args.push('--omit=dev');
  // npm audit sai com código !=0 quando acha vulnerabilidade — capturamos o
  // stdout de qualquer jeito (o JSON é emitido mesmo com exit != 0).
  const r = spawnSync('npm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '').trim();
  if (!out) {
    throw new Error(`npm audit não retornou JSON (stderr: ${(r.stderr || '').slice(0, 300)})`);
  }
  try {
    return JSON.parse(out);
  } catch (e) {
    throw new Error(`falha ao parsear saída do npm audit: ${e.message}`);
  }
}

/**
 * Extrai advisories (high/critical) do formato do npm v7+:
 *   audit.vulnerabilities[pkg].via[] = string | { source, name, title, url, severity }
 */
function extractAdvisories(audit) {
  const found = [];
  const seen = new Set();
  const vulns = audit && audit.vulnerabilities ? audit.vulnerabilities : {};
  for (const node of Object.values(vulns)) {
    for (const via of node.via || []) {
      if (typeof via !== 'object' || !via.severity) continue;
      if (!BLOCKING.has(via.severity)) continue;
      const ghsa = ghsaFromUrl(via.url) || `SRC-${via.source}`;
      const key = `${ghsa}::${via.name || node.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        ghsa,
        package: via.name || node.name,
        severity: via.severity,
        title: via.title || '(sem título)',
        url: via.url || '',
      });
    }
  }
  return found;
}

function ghsaFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/GHSA-[a-z0-9-]+/i);
  return m ? m[0] : null;
}

/** Lê o allowlist e separa entradas válidas (não expiradas) das expiradas. */
function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return { active: [], expired: [] };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  } catch (e) {
    throw new Error(`.audit-allowlist.json inválido: ${e.message}`);
  }
  const entries = Array.isArray(raw) ? raw : raw.allow || [];
  const today = new Date().toISOString().slice(0, 10);
  const active = [];
  const expired = [];
  for (const e of entries) {
    if (!e || !e.ghsa) continue;
    if (e.expires && e.expires < today) expired.push(e);
    else active.push(e);
  }
  return { active, expired };
}

function isAllowed(adv, active) {
  return active.some((e) => e.ghsa === adv.ghsa && (!e.package || e.package === adv.package));
}

function main() {
  console.log('\n🔐 Gate de segurança de dependências (npm audit)\n');

  const { active, expired } = loadAllowlist();
  if (expired.length) {
    console.log('⚠️  Entradas de allowlist EXPIRADAS (voltam a bloquear — revise):');
    for (const e of expired)
      console.log(`   - ${e.ghsa} (${e.package || '*'}) expirou em ${e.expires}`);
    console.log('');
  }

  // ── Produção: bloqueia ──────────────────────────────────────────────────
  const prod = extractAdvisories(runAudit({ omitDev: true }));
  const blocking = prod.filter((a) => !isAllowed(a, active));
  const suppressed = prod.filter((a) => isAllowed(a, active));

  console.log(
    `Produção (--omit=dev): ${prod.length} high/critical | ${suppressed.length} allowlisted | ${blocking.length} bloqueantes`
  );
  for (const a of suppressed)
    console.log(`   ⏭️  allowlisted: ${a.severity} ${a.package} ${a.ghsa}`);
  for (const a of blocking)
    console.log(`   ❌ ${a.severity} ${a.package} ${a.ghsa} — ${a.title}\n      ${a.url}`);

  // ── Dev/build: apenas warning ───────────────────────────────────────────
  let devOnly = [];
  try {
    const full = extractAdvisories(runAudit({ omitDev: false }));
    const prodKeys = new Set(prod.map((a) => `${a.ghsa}::${a.package}`));
    devOnly = full.filter((a) => !prodKeys.has(`${a.ghsa}::${a.package}`));
  } catch (_) {
    /* full audit é best-effort */
  }
  if (devOnly.length) {
    console.log(
      `\nDev/build (não-produção): ${devOnly.length} high/critical — WARNING (não bloqueia):`
    );
    for (const a of devOnly)
      console.log(`   ::warning::${a.severity} ${a.package} ${a.ghsa} — ${a.title}`);
  }

  if (blocking.length > 0) {
    console.error(
      `\n✗ ${blocking.length} vulnerabilidade(s) high/critical de PRODUÇÃO não corrigida(s)/allowlisted.`
    );
    console.error(
      '  Corrija (npm audit fix / bump) ou adicione ao .audit-allowlist.json com motivo+expiração.\n'
    );
    process.exit(1);
  }
  console.log('\n✅ Sem high/critical de produção fora do allowlist.\n');
  process.exit(0);
}

try {
  main();
} catch (e) {
  console.error(`\n✗ audit-gate falhou: ${e.message}`);
  process.exit(2);
}
