/**
 * HealthScoreService.calculateScore — testes formais (v9.5.0)
 * Cobre cálculo de score com diferentes cenários de workspace.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(40);
process.env.WEBHOOK_SECRET = 'x'.repeat(40);
process.env.OPENAI_API_KEY = 'sk-test';
process.env.DB_PATH = ':memory:';

let passed = 0, failed = 0;
const log = (ok, name, msg = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}${msg ? ' — ' + msg : ''}`); }
  else { failed++; console.log(`  ✗ ${name}${msg ? ' — ' + msg : ''}`); }
};

console.log('\n=== HealthScoreService ===\n');

(async () => {
  const database = require('../../src/utils/database');
  await database.initialize(':memory:');
  await database.runMigrations();

  const { calculateScore } = require('../../src/services/HealthScoreService');

  const wsId = 'ws-health-test';
  // Setup user (FK target) — workspaces.owner_id → users.id
  database.run(
    `INSERT INTO users (id, email, password, name, role, workspace_id) VALUES (?, ?, ?, ?, ?, ?)`,
    ['u1', 'health@test.com', 'pwd', 'U', 'owner', wsId]
  );
  // Setup workspace
  database.run(
    `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status) VALUES (?, ?, ?, ?, ?)`,
    [wsId, 'Test', 'u1', 'pro', 'active']
  );
  database.run(
    `INSERT INTO workspace_credits (workspace_id, tokens_total, tokens_used) VALUES (?, ?, ?)`,
    [wsId, 100000, 0]
  );

  // 1. Workspace ativo sem nada → score baixo mas válido
  const r1 = calculateScore({ id: wsId, subscription_status: 'active' });
  log(r1 && typeof r1.score === 'number', 'retorna { score, reasons }');
  log(r1.score >= 0 && r1.score <= 100, `score em [0,100] (got=${r1.score})`);
  log(Array.isArray(r1.reasons), 'reasons é array');

  // 2. Workspace com billing past_due → reason past_due
  const r2 = calculateScore({ id: wsId, subscription_status: 'past_due' });
  log(r2.reasons.includes('past_due'), 'past_due flagado em reasons');

  // 3. Workspace com NPS alto deve ter score maior
  database.run(
    `INSERT INTO nps_responses (id, workspace_id, user_id, score, comment) VALUES (?, ?, ?, ?, ?)`,
    ['nps-1', wsId, 'u1', 10, 'great']
  );
  const r3 = calculateScore({ id: wsId, subscription_status: 'active' });
  log(r3.score >= r1.score, `NPS alto eleva score (${r1.score} → ${r3.score})`);
  log(!r3.reasons.includes('low_nps'), 'NPS 10 não flaga low_nps');

  // 4. Workspace com NPS baixo → low_nps
  database.run('DELETE FROM nps_responses WHERE workspace_id = ?', [wsId]);
  database.run(
    `INSERT INTO nps_responses (id, workspace_id, user_id, score, comment) VALUES (?, ?, ?, ?, ?)`,
    ['nps-2', wsId, 'u1', 2, 'bad']
  );
  const r4 = calculateScore({ id: wsId, subscription_status: 'active' });
  log(r4.reasons.includes('low_nps'), 'NPS 2 flaga low_nps');

  // 5. Subscription inactive → reason inactive_subscription
  const r5 = calculateScore({ id: wsId, subscription_status: 'cancelled' });
  log(r5.reasons.includes('inactive_subscription'), 'cancelled flaga inactive_subscription');

  // 6. trialing → 10 pts (não +15 nem 0)
  const r6 = calculateScore({ id: wsId, subscription_status: 'trialing' });
  // Se r5 tinha 0 pts de billing e r6 tem 10 pts, o delta é 10
  log(r6.score > r5.score, `trialing > cancelled (${r5.score} vs ${r6.score})`);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Result: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
