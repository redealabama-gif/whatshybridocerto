/**
 * billingCron — DUNNING + SUSPENSÃO por inadimplência.
 *
 * Esta é a ponta do caminho do dinheiro que REVOGA acesso quando o cliente
 * para de pagar. suspendDelinquent e processDunning não tinham NENHUM teste —
 * eram a única parte do trio falha→dunning→suspensão sem rede de segurança.
 *
 * Invariantes cobertas:
 *   - processDunning — escalonamento por IDADE: dia 1→tentativa 1 (info),
 *     dia 3→2 (warning), dia 7→3 (critical); dias 5/6, 0 e >7 NÃO disparam.
 *   - processDunning — IDEMPOTÊNCIA: não redispara se attempts já alcançou o
 *     estágio (attempts >= stage.attempt) NEM se já disparou hoje
 *     (last_dunning_at >= meia-noite de hoje). Sem método de pagamento → vira
 *     só notificação (ainda bumpa attempt + alerta).
 *   - suspendDelinquent — só suspende past_due há >7 dias (via past_due_since),
 *     marca subscription_status='suspended' e alerta critical; não toca quem
 *     está past_due recente nem quem já está suspenso.
 *
 * Mock de DB/serviços via require.cache + stub de 'node-cron' (dep de
 * node_modules ausente no job zero-dep) via Module._resolveFilename, igual ao
 * billing-phase3.test.js. Roda com `node` puro.
 */

process.env.NODE_ENV = 'test';

let passed = 0, failed = 0;
function log(ok, name, msg = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}${msg ? ' — ' + msg : ''}`); }
  else { failed++; console.log(`  ✗ ${name}${msg ? ' — ' + msg : ''}`); }
}

// ─── Stub p/ deps de node_modules ausentes no zero-dep (node-cron) ────
// billingCron requer 'node-cron' no topo; sem npm ci ele não existe. Patch
// em _resolveFilename redireciona o specifier pra um fake no cache.
function stubMissingDeps() {
  const Module = require('module');
  if (!stubMissingDeps._patched) {
    stubMissingDeps._stubs = {};
    const orig = Module._resolveFilename;
    Module._resolveFilename = function (request, parent, ...rest) {
      if (stubMissingDeps._stubs[request]) return stubMissingDeps._stubs[request];
      return orig.call(this, request, parent, ...rest);
    };
    stubMissingDeps._patched = true;
  }
  const fakePath = require('path').join(__dirname, '__fake_node-cron');
  require('module')._cache[fakePath] = { id: fakePath, filename: fakePath, loaded: true, exports: { schedule: () => ({ stop() {} }) } };
  stubMissingDeps._stubs['node-cron'] = fakePath;
}
stubMissingDeps();

// ─── Estado mockável (resetado entre cenários) ───────────────────────
const dbState = {};
function reset() {
  dbState.dunningList = [];        // processDunning: linhas do db.all
  dbState.suspendCandidates = [];  // suspendDelinquent: workspaces p/ filtrar
  // capturas:
  dbState.suspended = [];          // ids marcados 'suspended'
  dbState.dunningUpdates = [];     // { id, attempt } de UPDATE dunning_attempts
  dbState.chargeAttempts = [];     // INSERT dunning_charge_attempts (params)
  dbState.alerts = [];             // alertManager.send
}
reset();

// ─── Mocks via require.cache ──────────────────────────────────────────
function inject(relPath, exportsObj) {
  const p = require.resolve(relPath);
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

inject('../../src/utils/database', {
  all(sql, params) {
    // processDunning: SELECT ... w.dunning_attempts ... past_due (sem filtro de data)
    if (/dunning_attempts/i.test(sql)) return dbState.dunningList;
    // suspendDelinquent: past_due_since <= ? (threshold de 7 dias)
    if (/FROM\s+workspaces/i.test(sql) && /past_due_since\s*<=/i.test(sql)) {
      const threshold = params[0];
      return dbState.suspendCandidates.filter(w =>
        w.subscription_status === 'past_due' && w.past_due_since && w.past_due_since <= threshold);
    }
    return [];
  },
  run(sql, params) {
    if (/UPDATE\s+workspaces[\s\S]*subscription_status\s*=\s*'suspended'/i.test(sql)) {
      dbState.suspended.push(params[0]);
    } else if (/UPDATE\s+workspaces[\s\S]*dunning_attempts/i.test(sql)) {
      dbState.dunningUpdates.push({ id: params[1], attempt: params[0] });
    } else if (/INSERT\s+INTO\s+dunning_charge_attempts/i.test(sql)) {
      dbState.chargeAttempts.push(params);
    }
  },
  get: () => null,
  transaction: (fn) => fn(),
});
inject('../../src/utils/logger', { info() {}, warn() {}, error() {}, debug() {} });
inject('../../src/observability/alertManager', {
  send: (level, title, meta) => dbState.alerts.push({ level, title, meta }),
});
// top-level require do billingCron; não usado por dunning/suspend, só precisa carregar
inject('../../src/services/BillingLinkService', { generatePaymentLink: async () => ({ ok: false }) });
// lazy requires do processDunning — unconfigured → caminho "sem método de pagamento"
inject('../../src/services/MercadoPagoService', { isConfigured: () => false });
inject('../../src/services/StripeService', { isConfigured: () => false });
inject('../../src/services/EmailService', { isConfigured: () => false, sendDunningEscalation: async () => {} });

const cron = require('../../src/jobs/billingCron');
const { suspendDelinquent, processDunning } = cron;

const daysAgoISO = (d) => new Date(Date.now() - d * 86400000).toISOString();
const upd = (id) => dbState.dunningUpdates.find(u => u.id === id);

console.log('\n=== billingCron — dunning + suspensão por inadimplência ===\n');

(async () => {
  // ─── A) suspendDelinquent: >7d past_due → suspended ───────────────────
  reset();
  dbState.suspendCandidates = [
    { id: 'sus1', name: 'A', plan: 'pro', subscription_status: 'past_due', past_due_since: daysAgoISO(8) },   // suspende
    { id: 'sus2', name: 'B', plan: 'pro', subscription_status: 'past_due', past_due_since: daysAgoISO(3) },   // recente demais
    { id: 'sus3', name: 'C', plan: 'pro', subscription_status: 'suspended', past_due_since: daysAgoISO(30) }, // já suspenso
  ];
  const suspended = suspendDelinquent();
  log(dbState.suspended.length === 1 && dbState.suspended[0] === 'sus1', 'suspende só o past_due há >7d (sus1)');
  log(suspended.length === 1 && suspended[0].id === 'sus1', 'retorna a lista suspensa');
  log(!dbState.suspended.includes('sus2'), 'past_due recente (3d) NÃO é suspenso');
  log(!dbState.suspended.includes('sus3'), 'já suspenso (não past_due) NÃO é re-tocado');
  log(dbState.alerts.some(a => a.level === 'critical' && /suspenso/i.test(a.title)), 'dispara alerta critical de suspensão');

  reset();
  const none = suspendDelinquent();
  log(Array.isArray(none) && none.length === 0 && dbState.suspended.length === 0, 'nenhum candidato → nada suspenso (sem erro)');

  // ─── B) processDunning: escalonamento por idade ───────────────────────
  reset();
  dbState.dunningList = [
    { id: 'd1',  name: 'd1',  plan: 'pro', dunning_attempts: 0, last_dunning_at: null, past_due_since: daysAgoISO(1.5) },  // → att 1
    { id: 'd3',  name: 'd3',  plan: 'pro', dunning_attempts: 0, last_dunning_at: null, past_due_since: daysAgoISO(3.5) },  // → att 2
    { id: 'd7',  name: 'd7',  plan: 'pro', dunning_attempts: 0, last_dunning_at: null, past_due_since: daysAgoISO(7.5) },  // → att 3
    { id: 'd5',  name: 'd5',  plan: 'pro', dunning_attempts: 0, last_dunning_at: null, past_due_since: daysAgoISO(5.5) },  // gap → nada
    { id: 'd0',  name: 'd0',  plan: 'pro', dunning_attempts: 0, last_dunning_at: null, past_due_since: daysAgoISO(0.5) },  // dia 0 → nada
    { id: 'd10', name: 'd10', plan: 'pro', dunning_attempts: 0, last_dunning_at: null, past_due_since: daysAgoISO(10.5) }, // >7 → nada
  ];
  const r = await processDunning();
  log(upd('d1') && upd('d1').attempt === 1, 'dia 1 → tentativa 1');
  log(upd('d3') && upd('d3').attempt === 2, 'dia 3 → tentativa 2');
  log(upd('d7') && upd('d7').attempt === 3, 'dia 7 → tentativa 3');
  log(!upd('d5') && !upd('d0') && !upd('d10'), 'dias 5, 0 e >7 NÃO disparam');
  log(r.length === 3, 'processa exatamente os 3 estágios válidos');
  log(dbState.alerts.some(a => a.level === 'info' && /1\/3/.test(a.title)), 'estágio 1 → severity info');
  log(dbState.alerts.some(a => a.level === 'warning' && /2\/3/.test(a.title)), 'estágio 2 → severity warning');
  log(dbState.alerts.some(a => a.level === 'critical' && /3\/3/.test(a.title)), 'estágio 3 → severity critical');
  log(dbState.chargeAttempts.length === 3, 'grava histórico (dunning_charge_attempts) dos 3');

  // ─── C) processDunning: idempotência ──────────────────────────────────
  // C1 — attempts já alcançou o estágio → não redispara
  reset();
  dbState.dunningList = [
    { id: 'i1', name: 'i1', plan: 'pro', dunning_attempts: 1, last_dunning_at: null, past_due_since: daysAgoISO(1.5) }, // att já 1, stage 1
  ];
  await processDunning();
  log(!upd('i1'), 'attempts >= stage.attempt → NÃO redispara (sem double-fire entre runs)');

  // C2 — já disparou hoje → não redispara, mesmo que o estágio avançasse
  reset();
  dbState.dunningList = [
    { id: 'i2', name: 'i2', plan: 'pro', dunning_attempts: 1, last_dunning_at: daysAgoISO(0), past_due_since: daysAgoISO(3.5) }, // stage 2, mas já hoje
  ];
  await processDunning();
  log(!upd('i2'), 'last_dunning_at = hoje → NÃO redispara no mesmo dia');

  // C3 — contraste: mesmo caso, mas último disparo foi ONTEM → dispara
  reset();
  dbState.dunningList = [
    { id: 'i3', name: 'i3', plan: 'pro', dunning_attempts: 1, last_dunning_at: daysAgoISO(1), past_due_since: daysAgoISO(3.5) },
  ];
  await processDunning();
  log(upd('i3') && upd('i3').attempt === 2, 'último disparo ontem → avança p/ tentativa 2');

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
