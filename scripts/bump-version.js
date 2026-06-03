#!/usr/bin/env node
/**
 * bump-version.js
 * WhatsHybrid Pro — Sincronizador de versão
 *
 * Atualiza a versão em TODOS os arquivos relevantes de uma só vez:
 *   - package.json (root)
 *   - whatshybrid-extension/package.json
 *   - whatshybrid-extension/manifest.json
 *   - whatshybrid-backend/package.json
 *   - whatshybrid-extension/utils/version.js (fallback hardcoded)
 *
 * Uso: node scripts/bump-version.js 8.1.0
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const newVer  = process.argv[2];

if (!newVer || !/^\d+\.\d+\.\d+$/.test(newVer)) {
  console.error('Uso: node scripts/bump-version.js <MAJOR.MINOR.PATCH>');
  process.exit(1);
}

const FILES = [
  { file: 'package.json',                               type: 'json' },
  { file: 'whatshybrid-extension/package.json',         type: 'json' },
  { file: 'whatshybrid-backend/package.json',           type: 'json' },
  { file: 'whatshybrid-extension/manifest.json',        type: 'json' },
  { file: 'whatshybrid-extension/utils/version.js',     type: 'text', pattern: /(['"])(\d+\.\d+\.\d+)\1/g },
];

let updated = 0;

for (const entry of FILES) {
  const filePath = path.join(ROOT, entry.file);
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠  Não encontrado: ${entry.file}`);
    continue;
  }

  const content = fs.readFileSync(filePath, 'utf8');

  if (entry.type === 'json') {
    const obj = JSON.parse(content);
    const old = obj.version;
    obj.version = newVer;
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n');
    console.log(`  ✔  ${entry.file}  ${old} → ${newVer}`);
  } else {
    const updated_ = content.replace(entry.pattern, (_, q, _v) => `${q}${newVer}${q}`);
    fs.writeFileSync(filePath, updated_);
    console.log(`  ✔  ${entry.file}  → ${newVer}`);
  }
  updated++;
}

console.log(`\n✅ Versão ${newVer} aplicada em ${updated} arquivo(s).\n`);
console.log('   Próximos passos:');
console.log('   1. git add -A && git commit -m "chore: bump version to ' + newVer + '"');
console.log('   2. git tag v' + newVer);
console.log('   3. git push && git push --tags');
console.log('   4. npm run build:extension && npm run pack:extension\n');
