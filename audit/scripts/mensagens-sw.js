#!/usr/bin/env node
/**
 * Auditoria IA — mensagens chrome.runtime.sendMessage enviadas pelos arquivos
 * que RODAM (bundles, sidepanel, training) × handlers do service worker.
 * Uso: node audit/scripts/mensagens-sw.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const EXT = path.resolve(__dirname, '../../whatshybrid-extension');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');

const bm = JSON.parse(read('build-manifest.json'));
const scriptsOf = (html) => [...read(html).matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => path.posix.normalize(path.posix.join(path.posix.dirname(html), m[1])));
const runtime = [...new Set([...bm.core, ...bm.content, ...bm.advanced, ...scriptsOf('sidepanel.html'), ...scriptsOf('training/training.html'), 'sidepanel-router.js'])]
  .filter((f) => fs.existsSync(path.join(EXT, f)));

// enviados: sendMessage({ type|action: 'X' ...
const sent = new Map();
for (const f of runtime) {
  const src = read(f);
  for (const m of src.matchAll(/sendMessage\(\s*\{\s*(?:[\s\S]{0,80}?)\b(type|action)\s*:\s*['"`]([A-Za-z0-9_:-]+)['"`]/g)) {
    const k = m[2];
    if (!sent.has(k)) sent.set(k, new Set());
    sent.get(k).add(f);
  }
}

// tratados no service worker
const sw = ['background.js', 'background/message-handler.js', 'background/campaign-handler.js', 'background/ai-handlers.js'].map(read).join('\n');
const handled = new Set();
for (const m of sw.matchAll(/^\s*['"]?([A-Za-z0-9_:-]+)['"]?\s*:\s*handle\w+/gm)) handled.add(m[1]);
for (const m of sw.matchAll(/(?:type|action)\s*===?\s*['"]([A-Za-z0-9_:-]+)['"]/g)) handled.add(m[1]);
for (const m of sw.matchAll(/case\s+['"]([A-Za-z0-9_:-]+)['"]\s*:/g)) handled.add(m[1]);

// mensagens que o content script trata (sidepanel → aba): onMessage em arquivos do content
const content = [...bm.core, ...bm.content, ...bm.advanced].filter((f) => fs.existsSync(path.join(EXT, f))).map(read).join('\n');
const handledInContent = new Set();
for (const m of content.matchAll(/(?:type|action)\s*===?\s*['"]([A-Za-z0-9_:-]+)['"]/g)) handledInContent.add(m[1]);
for (const m of content.matchAll(/case\s+['"]([A-Za-z0-9_:-]+)['"]\s*:/g)) handledInContent.add(m[1]);

const rows = [...sent.entries()].sort().map(([k, files]) => ({
  k, files: [...files], sw: handled.has(k), content: handledInContent.has(k),
}));
const orphan = rows.filter((r) => !r.sw && !r.content);
const out = ['# Mensagens chrome.runtime.sendMessage × handlers', '', `Tipos enviados por arquivos que rodam: ${rows.length} · tratados no SW: ${rows.filter((r) => r.sw).length} · tratados no content: ${rows.filter((r) => r.content).length} · **sem handler encontrado: ${orphan.length}**`, '', '| tipo/action | enviado por | SW | content |', '|---|---|---|---|'];
for (const r of rows) out.push(`| ${r.k} | ${r.files.slice(0, 3).join(', ')}${r.files.length > 3 ? ` (+${r.files.length - 3})` : ''} | ${r.sw ? '✔' : '—'} | ${r.content ? '✔' : '—'} |`);
fs.writeFileSync(path.resolve(__dirname, '../evidencias/61-mensagens-sw.md'), out.join('\n') + '\n');
console.log(out.slice(0, 3).join('\n'));
console.log('Sem handler:', orphan.map((r) => `${r.k} (${r.files[0]})`).join(', ') || 'nenhuma');
