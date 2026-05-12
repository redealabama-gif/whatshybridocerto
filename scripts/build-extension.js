#!/usr/bin/env node
/**
 * build-extension.js
 * WhatsHybrid Pro — Build oficial da extensão Chrome
 *
 * Gera um diretório limpo em dist/extension/ pronto para empacotamento.
 * Remove arquivos de dev, valida manifest e sincroniza versões.
 *
 * Uso: node scripts/build-extension.js [--env production|staging]
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Configuração ──────────────────────────────────────────────────────────
const ROOT      = path.resolve(__dirname, '..');
const SRC_DIR   = path.join(ROOT, 'whatshybrid-extension');
const DIST_DIR  = path.join(ROOT, 'dist', 'extension');
const BRAND_CFG = path.join(ROOT, 'BRAND_CONFIG.json');

// Arquivos/pastas excluídos do build final
const EXCLUDE = [
  'node_modules',
  'tests',
  '.DS_Store',
  'Thumbs.db',
  '*.test.js',
  '*.spec.js',
  '*.broken_*',
  'smoke-test.js',
];

// ─── Utilitários ───────────────────────────────────────────────────────────
function log(msg)  { console.log(`  ✔  ${msg}`); }
function warn(msg) { console.warn(`  ⚠  ${msg}`); }
function fail(msg) { console.error(`  ✖  ${msg}`); process.exit(1); }

function shouldExclude(name) {
  return EXCLUDE.some(pattern => {
    if (pattern.startsWith('*')) return name.endsWith(pattern.slice(1));
    return name === pattern;
  });
}

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (shouldExclude(entry.name)) continue;

    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ─── Etapa 1: Limpar dist ──────────────────────────────────────────────────
function cleanDist() {
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
    log('dist/extension/ limpo');
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

// ─── Etapa 2: Copiar fontes ─────────────────────────────────────────────────
function copySources() {
  copyDir(SRC_DIR, DIST_DIR);
  log(`Fontes copiadas de whatshybrid-extension/ → dist/extension/`);
}

// ─── Etapa 3: Aplicar branding ─────────────────────────────────────────────
function applyBranding() {
  const brandId = process.env.BUILD_BRAND || 'default';
  if (!fs.existsSync(BRAND_CFG)) {
    warn('BRAND_CONFIG.json não encontrado — usando branding padrão');
    return;
  }

  const allBrands = JSON.parse(fs.readFileSync(BRAND_CFG, 'utf8'));
  const brand = allBrands[brandId] || allBrands['default'];
  if (!brand) {
    warn(`Branding "${brandId}" não encontrado em BRAND_CONFIG.json`);
    return;
  }

  // Patch manifest.json com dados do branding
  const manifestPath = path.join(DIST_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (brand.name)        manifest.name        = brand.name;
  if (brand.description) manifest.description = brand.description;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Gravar brand_runtime.json para uso em runtime
  fs.writeFileSync(
    path.join(DIST_DIR, 'brand_runtime.json'),
    JSON.stringify({ brandId, ...brand, builtAt: new Date().toISOString() }, null, 2)
  );

  log(`Branding aplicado: ${brandId} (${brand.name || 'sem nome'})`);
}

// ─── Etapa 4: Validar manifest ─────────────────────────────────────────────
function validateManifest() {
  const manifestPath = path.join(DIST_DIR, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    fail(`manifest.json inválido: ${err.message}`);
  }

  if (!manifest.manifest_version) fail('manifest_version ausente');
  if (!manifest.name)             fail('name ausente no manifest');
  if (!manifest.version)          fail('version ausente no manifest');

  log(`manifest.json válido — v${manifest.version} (MV${manifest.manifest_version})`);
  return manifest.version;
}

// ─── Etapa 5: Sincronizar versões ──────────────────────────────────────────
function syncVersions(manifestVersion) {
  // Root monorepo
  const rootPkgPath = path.join(ROOT, 'package.json');
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));

  // Backend
  const backendPkgPath = path.join(ROOT, 'whatshybrid-backend', 'package.json');
  let backendVersion = null;
  if (fs.existsSync(backendPkgPath)) {
    const backendPkg = JSON.parse(fs.readFileSync(backendPkgPath, 'utf8'));
    backendVersion = backendPkg.version;
  }

  const issues = [];
  if (rootPkg.version !== manifestVersion) {
    issues.push(`root package.json (${rootPkg.version}) ≠ manifest (${manifestVersion})`);
  }

  if (backendVersion && backendVersion !== manifestVersion) {
    warn(`backend version (${backendVersion}) difere do manifest (${manifestVersion}) — pode ser intencional`);
  }

  if (issues.length > 0) {
    warn(`Versões fora de sincronia:\n    ${issues.join('\n    ')}`);
    warn('Execute: node scripts/bump-version.js <version> para sincronizar');
  } else {
    log(`Versões sincronizadas: ${manifestVersion}`);
  }
}

// ─── Etapa 6: Gravar build-info.json ──────────────────────────────────────
function writeBuildInfo(version) {
  const info = {
    version,
    buildAt: new Date().toISOString(),
    env: process.env.NODE_ENV || 'production',
    brand: process.env.BUILD_BRAND || 'default',
    git: (() => {
      try {
        const { execSync } = require('child_process');
        return {
          commit: execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(),
          branch: execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim(),
        };
      } catch { return { commit: 'unknown', branch: 'unknown' }; }
    })(),
  };
  fs.writeFileSync(path.join(DIST_DIR, 'build-info.json'), JSON.stringify(info, null, 2));
  log(`build-info.json gerado (commit: ${info.git.commit})`);
}

// ─── Main ──────────────────────────────────────────────────────────────────
console.log('\n🔨 WhatsHybrid Pro — Build da Extensão\n');
cleanDist();
copySources();
applyBranding();
const version = validateManifest();
syncVersions(version);
writeBuildInfo(version);
console.log(`\n✅ Build concluído → dist/extension/  (v${version})\n`);
