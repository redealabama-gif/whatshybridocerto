#!/usr/bin/env node
/**
 * Runner de testes da extensão — ZERO dependência (node puro).
 *
 * Descobre e roda tests/unit/*.test.js. Cada arquivo registra casos via
 * tests/_harness.js. Sai com código 1 se algum falhar (pro CI quebrar).
 *
 *   node tests/run-all.js            # roda tudo
 *   node tests/run-all.js --unit     # (só unit; é o que existe por ora)
 */

const fs = require('fs');
const path = require('path');
const { run } = require('./_harness');

const unitDir = path.join(__dirname, 'unit');
const files = fs.existsSync(unitDir)
  ? fs.readdirSync(unitDir).filter((f) => f.endsWith('.test.js')).sort()
  : [];

console.log(`\n🧪 Extensão — ${files.length} arquivo(s) de teste unitário\n`);

if (files.length === 0) {
  console.log('  (nenhum teste encontrado)');
  process.exit(0);
}

for (const f of files) {
  console.log('• ' + f);
  require(path.join(unitDir, f));
}
console.log('');

run().then((fail) => process.exit(fail > 0 ? 1 : 0));
