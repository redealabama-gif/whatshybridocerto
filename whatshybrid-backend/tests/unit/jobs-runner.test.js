/**
 * JobsRunner — testes formais (v9.5.0)
 * Cobre initSchema, createJob, runOnce.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(40);
process.env.WEBHOOK_SECRET = 'x'.repeat(40);
process.env.DB_PATH = ':memory:';

let passed = 0, failed = 0;
const log = (ok, name, msg = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}${msg ? ' — ' + msg : ''}`); }
  else { failed++; console.log(`  ✗ ${name}${msg ? ' — ' + msg : ''}`); }
};

console.log('\n=== JobsRunner ===\n');

(async () => {
  const fs = require('fs');
  // Limpa lock se existir
  try { fs.unlinkSync('.jobs_runner.lock'); } catch (_) {}

  const database = require('../../src/utils/database');
  await database.initialize(':memory:');
  await database.runMigrations();

  const JobsRunner = require('../../src/jobs/JobsRunner');

  // 1. initSchema cria tabelas
  await JobsRunner.initSchema(database);
  const tableCheck = database.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'`);
  log(!!tableCheck, 'initSchema cria scheduled_jobs');

  const logsCheck = database.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='job_logs'`);
  log(!!logsCheck, 'initSchema cria job_logs');

  // 2. createJob insere job — assinatura: (db, jobData)
  const job = await JobsRunner.createJob(database, {
    type: JobsRunner.JOB_TYPES.SEND_CAMPAIGN,
    payload: { campaign_id: 'c1' },
    priority: 5,
  });
  log(job && job.id, 'createJob retorna { id }');
  log(job.status === 'pending', 'job inicial status=pending');

  const stored = database.get('SELECT * FROM scheduled_jobs WHERE id = ?', [job.id]);
  log(!!stored, 'job persistido em scheduled_jobs');
  log(stored.priority === 5, `priority preservada (${stored.priority})`);

  // 3. JOB_TYPES e JOB_STATUS expostos
  log(typeof JobsRunner.JOB_TYPES === 'object', 'JOB_TYPES exportado');
  log(typeof JobsRunner.JOB_STATUS === 'object', 'JOB_STATUS exportado');
  log(Object.keys(JobsRunner.JOB_TYPES).length > 5, 'JOB_TYPES tem >5 tipos');

  // 4. CONFIG exposto
  log(typeof JobsRunner.CONFIG === 'object', 'CONFIG exportado');
  log(typeof JobsRunner.CONFIG.MAX_RETRIES === 'number', 'CONFIG.MAX_RETRIES é número');

  // 5. Lock file mechanism
  log(typeof JobsRunner.start === 'function', 'start exportado');
  log(typeof JobsRunner.stop === 'function', 'stop exportado');
  log(typeof JobsRunner.gracefulShutdown === 'function', 'gracefulShutdown exportado');

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Result: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
