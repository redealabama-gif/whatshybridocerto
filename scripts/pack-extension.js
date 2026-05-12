#!/usr/bin/env node
/**
 * pack-extension.js
 * WhatsHybrid Pro — Empacotador oficial da extensão Chrome
 *
 * Lê dist/extension/ (gerado por build-extension.js) e cria
 * um arquivo ZIP pronto para entrega ao cliente ou upload na Chrome Web Store.
 *
 * Uso: node scripts/pack-extension.js
 * Saída: dist/whatshybrid-pro-v<VERSION>[-<BRAND>].zip
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');

const ROOT     = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist', 'extension');
const OUT_DIR  = path.join(ROOT, 'dist');

// ─── Verificações ──────────────────────────────────────────────────────────
function fail(msg) { console.error(`  ✖  ${msg}`); process.exit(1); }
function log(msg)  { console.log(`  ✔  ${msg}`); }

if (!fs.existsSync(DIST_DIR)) {
  fail('dist/extension/ não encontrado. Execute primeiro: npm run build:extension');
}

const manifestPath = path.join(DIST_DIR, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  fail('manifest.json não encontrado em dist/extension/');
}

// ─── Leitura de versão e branding ──────────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version  = manifest.version;

let brandSuffix = '';
const buildInfoPath = path.join(DIST_DIR, 'build-info.json');
if (fs.existsSync(buildInfoPath)) {
  const info = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
  if (info.brand && info.brand !== 'default') {
    brandSuffix = `-${info.brand}`;
  }
}

const zipName = `whatshybrid-pro-v${version}${brandSuffix}.zip`;
const zipPath = path.join(OUT_DIR, zipName);

// ─── Remover ZIP anterior da mesma versão ──────────────────────────────────
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
  log(`ZIP anterior removido: ${zipName}`);
}

// ─── Criar ZIP usando zip nativo ou cross-zip via Node ─────────────────────
console.log(`\n📦 Empacotando extensão v${version}…\n`);

try {
  // Tentativa com zip nativo (Linux/Mac)
  execSync(`zip -r "${zipPath}" .`, { cwd: DIST_DIR, stdio: 'pipe' });
  log(`ZIP criado com zip nativo`);
} catch {
  // Fallback: implementação pura Node.js sem dependências externas
  log('zip nativo não disponível, usando implementação Node.js pura…');
  createZipNode(DIST_DIR, zipPath);
}

// ─── Calcular e exibir checksum ────────────────────────────────────────────
const { createHash } = require('crypto');
const hash = createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
const sizeKb = (fs.statSync(zipPath).size / 1024).toFixed(1);

// Gravar .sha256 junto ao ZIP
fs.writeFileSync(`${zipPath}.sha256`, `${hash}  ${zipName}\n`);

console.log(`\n✅ Extensão empacotada com sucesso!\n`);
console.log(`   Arquivo : dist/${zipName}`);
console.log(`   Tamanho : ${sizeKb} KB`);
console.log(`   SHA-256 : ${hash}`);
console.log(`   Hash gravado em: dist/${zipName}.sha256\n`);

// ─── ZIP puro em Node.js (sem dependências) ────────────────────────────────
function createZipNode(sourceDir, outputZip) {
  // Implementação mínima de ZIP (store, sem compressão) usando Buffer
  // Suficiente para extensões Chrome (que são ZIPs não comprimidos)
  const files = [];
  collectFiles(sourceDir, sourceDir, files);

  const centralDir = [];
  const parts = [];
  let offset = 0;

  for (const { relativePath, data } of files) {
    const nameBytes = Buffer.from(relativePath, 'utf8');
    const crc = crc32(data);
    const size = data.length;

    // Local file header
    const localHeader = Buffer.alloc(30 + nameBytes.length);
    localHeader.writeUInt32LE(0x04034b50, 0);   // signature
    localHeader.writeUInt16LE(20, 4);             // version needed
    localHeader.writeUInt16LE(0, 6);              // flags
    localHeader.writeUInt16LE(0, 8);              // compression (store)
    localHeader.writeUInt16LE(0, 10);             // mod time
    localHeader.writeUInt16LE(0, 12);             // mod date
    localHeader.writeUInt32LE(crc >>> 0, 14);     // crc-32
    localHeader.writeUInt32LE(size, 18);          // compressed size
    localHeader.writeUInt32LE(size, 22);          // uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26); // name length
    localHeader.writeUInt16LE(0, 28);             // extra length
    nameBytes.copy(localHeader, 30);

    // Central directory entry
    const cdEntry = Buffer.alloc(46 + nameBytes.length);
    cdEntry.writeUInt32LE(0x02014b50, 0);  // cd signature
    cdEntry.writeUInt16LE(20, 4);           // version made by
    cdEntry.writeUInt16LE(20, 6);           // version needed
    cdEntry.writeUInt16LE(0, 8);            // flags
    cdEntry.writeUInt16LE(0, 10);           // compression
    cdEntry.writeUInt16LE(0, 12);           // mod time
    cdEntry.writeUInt16LE(0, 14);           // mod date
    cdEntry.writeUInt32LE(crc >>> 0, 16);   // crc-32
    cdEntry.writeUInt32LE(size, 20);        // compressed size
    cdEntry.writeUInt32LE(size, 24);        // uncompressed size
    cdEntry.writeUInt16LE(nameBytes.length, 28);
    cdEntry.writeUInt16LE(0, 30);           // extra length
    cdEntry.writeUInt16LE(0, 32);           // comment length
    cdEntry.writeUInt16LE(0, 34);           // disk number start
    cdEntry.writeUInt16LE(0, 36);           // internal attrs
    cdEntry.writeUInt32LE(0, 38);           // external attrs
    cdEntry.writeUInt32LE(offset, 42);      // offset of local header
    nameBytes.copy(cdEntry, 46);

    parts.push(localHeader, data);
    centralDir.push(cdEntry);
    offset += localHeader.length + data.length;
  }

  const cdBuffer  = Buffer.concat(centralDir);
  const cdSize    = cdBuffer.length;
  const cdOffset  = offset;
  const totalFiles = files.length;

  // End of central directory record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);               // disk number
  eocd.writeUInt16LE(0, 6);               // disk with cd
  eocd.writeUInt16LE(totalFiles, 8);
  eocd.writeUInt16LE(totalFiles, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);              // comment length

  fs.writeFileSync(outputZip, Buffer.concat([...parts, cdBuffer, eocd]));
}

function collectFiles(baseDir, currentDir, result) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    const relPath  = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      collectFiles(baseDir, fullPath, result);
    } else {
      result.push({ relativePath: relPath, data: fs.readFileSync(fullPath) });
    }
  }
}

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ -1);
}
