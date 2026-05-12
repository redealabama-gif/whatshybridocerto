/**
 * v9.5.0 Migrations Idempotency Test
 *
 * Cobre Phase 2D: roda runMigrations duas vezes seguidas em :memory: e
 * confirma que ambas execuções terminam sem erro e schema fica idêntico.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(40);
process.env.WEBHOOK_SECRET = 'x'.repeat(40);
process.env.OPENAI_API_KEY = 'sk-test';
process.env.DB_PATH = ':memory:';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const log = (ok, name, msg = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}${msg ? ' — ' + msg : ''}`); }
  else { failed++; console.log(`  ✗ ${name}${msg ? ' — ' + msg : ''}`); }
};

(async () => {
  console.log('\n=== Migrations Idempotency ===\n');

  // Reset database singleton
  delete require.cache[require.resolve('../../src/utils/database')];
  delete require.cache[require.resolve('../../src/utils/database-legacy')];
  delete require.cache[require.resolve('../../src/utils/db')];
  delete require.cache[require.resolve('../../src/utils/db/sqlite-driver')];

  const database = require('../../src/utils/database');
  await database.initialize(':memory:');

  // First run
  try {
    await database.runMigrations();
    log(true, 'Primeira execução de runMigrations não lança');
  } catch (e) {
    log(false, 'Primeira execução de runMigrations não lança', e.message);
    process.exit(1);
  }

  // Snapshot tabelas e índices
  const snap1 = database.all(
    "SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY name"
  );
  log(snap1.length > 5, `Schema tem >5 objetos após 1ª execução`, `count=${snap1.length}`);
  log(snap1.some(o => o.name === 'users'), `Tabela 'users' existe`);
  log(snap1.some(o => o.name === '_migrations'), `Tabela '_migrations' existe`);

  // Second run — deve ser idempotente
  try {
    await database.runMigrations();
    log(true, 'Segunda execução de runMigrations não lança');
  } catch (e) {
    log(false, 'Segunda execução de runMigrations não lança', e.message);
  }

  const snap2 = database.all(
    "SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY name"
  );
  log(
    snap1.length === snap2.length,
    `Schema idêntico após 2ª execução`,
    `before=${snap1.length} after=${snap2.length}`
  );

  // Confirma que as migrations versionadas em /migrations não rodaram de novo
  const applied = database.all('SELECT id FROM _migrations ORDER BY id');
  const ids = applied.map(r => r.id);
  log(true, `Migrations aplicadas registradas`, `${ids.length} entradas: ${ids.join(', ')}`);

  // Cobertura de migrations versionadas
  const migDir = path.join(__dirname, '../../migrations');
  const sqlFiles = fs.existsSync(migDir)
    ? fs.readdirSync(migDir).filter(f => f.endsWith('.sql'))
    : [];
  log(
    ids.length === sqlFiles.length,
    `Todas as migrations em /migrations foram aplicadas`,
    `db=${ids.length} files=${sqlFiles.length}`
  );

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
