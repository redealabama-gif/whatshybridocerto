#!/usr/bin/env node
/**
 * build-sources-hash.js — guard de "bundle desatualizado".
 *
 * O que REALMENTE roda na extensão são os dist/*-bundle.js (gerados por build.js
 * a partir de modules/*, content/wpp-hooks-parts/*, etc.). Se alguém edita a
 * fonte e NÃO roda `npm run build`, o runtime não muda — foi exatamente o que
 * aconteceu no PR #211 (a edição só passou a valer depois do rebuild).
 *
 * Este script tira um SHA-256 de TODA a fonte que alimenta os bundles e grava em
 * dist/build-sources.json. O build.js chama --write a cada build; o CI roda
 * --check e FALHA se a fonte mudou sem o rebuild correspondente.
 *
 *   node scripts/build-sources-hash.js --write   # grava (chamado pelo build)
 *   node scripts/build-sources-hash.js --check   # CI: falha se drift (default)
 *
 * Independente de minificador (esbuild/manual): faz hash da FONTE, não do bundle.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const HASH_FILE = path.join(ROOT, 'dist', 'build-sources.json');

// content/wpp-hooks.js é GERADO (concat dos parts) — não entra no hash; sua
// fonte são os wpp-hooks-parts/*, que incluímos abaixo.
const GENERATED = new Set(['content/wpp-hooks.js']);

function sourceFiles() {
  const files = new Set();
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'build-manifest.json'), 'utf8'));
  for (const key of ['core', 'content', 'advanced']) {
    for (const rel of manifest[key] || []) {
      const norm = String(rel).replace(/\\/g, '/');
      if (!GENERATED.has(norm)) files.add(norm);
    }
  }
  const partsRel = 'content/wpp-hooks-parts';
  const partsDir = path.join(ROOT, partsRel);
  if (fs.existsSync(partsDir)) {
    for (const f of fs.readdirSync(partsDir)) {
      if (f.endsWith('.js')) files.add(partsRel + '/' + f);
    }
  }
  return [...files].sort();
}

function compute() {
  const h = crypto.createHash('sha256');
  let counted = 0;
  for (const rel of sourceFiles()) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue; // build.js também pula ausentes (ex.: libs externas)
    h.update(rel + '\0');
    h.update(fs.readFileSync(full));
    h.update('\0');
    counted++;
  }
  return { sha256: h.digest('hex'), fileCount: counted };
}

function write() {
  const r = compute();
  fs.mkdirSync(path.dirname(HASH_FILE), { recursive: true });
  fs.writeFileSync(HASH_FILE, JSON.stringify(r, null, 2) + '\n');
  console.log(`[bundles] hash gravado: ${r.sha256.slice(0, 12)}… (${r.fileCount} fontes)`);
  return r;
}

function check() {
  const now = compute();
  if (!fs.existsSync(HASH_FILE)) {
    console.error('[bundles] ❌ dist/build-sources.json não existe — rode `npm run build`.');
    process.exit(1);
  }
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(HASH_FILE, 'utf8')); } catch (_) {}
  if (saved.sha256 !== now.sha256) {
    console.error('[bundles] ❌ DRIFT: a fonte da extensão mudou, mas os bundles NÃO foram regerados.');
    console.error(`           fonte agora: ${now.sha256.slice(0, 12)}… (${now.fileCount} arq)`);
    console.error(`           registrado:  ${String(saved.sha256).slice(0, 12)}… (${saved.fileCount} arq)`);
    console.error('           → Rode `npm run build` e committe dist/*-bundle.js + dist/build-sources.json.');
    process.exit(1);
  }
  console.log(`[bundles] ✅ bundles em sincronia com a fonte (${now.fileCount} arquivos).`);
}

module.exports = { compute, write, check, sourceFiles };

if (require.main === module) {
  if (process.argv.includes('--write')) write();
  else check();
}
