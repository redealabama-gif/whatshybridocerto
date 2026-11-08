#!/usr/bin/env node
/**
 * Auditoria IA — Etapa 1: inventário e grafo de carregamento.
 *
 * Para cada arquivo relacionado a IA na extensão responde:
 *   - onde ele é CARREGADO de fato (core/content/advanced bundle, sidepanel.html,
 *     training/training.html, importScripts do service worker, lazy-loader,
 *     injeção no page world via web_accessible_resources);
 *   - quais globais (window.X) ele define;
 *   - quem referencia esses globais (arquivos que rodam).
 *
 * Uso (na raiz do repo):  node audit/scripts/inventario-ia.js > audit/inventario-ia.md
 * Somente leitura — não altera nada.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EXT = path.join(ROOT, 'whatshybrid-extension');
const rel = (p) => path.relative(EXT, p).split(path.sep).join('/');

// ── Fontes de carregamento ──────────────────────────────────────────────
const bm = JSON.parse(fs.readFileSync(path.join(EXT, 'build-manifest.json'), 'utf8'));
const loadMap = new Map(); // arquivo → Set(onde)
const addLoad = (file, where) => {
  const k = file.replace(/^\.\//, '');
  if (!loadMap.has(k)) loadMap.set(k, new Set());
  loadMap.get(k).add(where);
};
for (const key of ['core', 'content', 'advanced']) for (const f of bm[key] || []) addLoad(f, `${key}-bundle`);

const scriptsOf = (htmlRel) => {
  const html = fs.readFileSync(path.join(EXT, htmlRel), 'utf8');
  const dir = path.posix.dirname(htmlRel);
  return [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => path.posix.normalize(path.posix.join(dir, m[1])));
};
for (const f of scriptsOf('sidepanel.html')) addLoad(f, 'sidepanel.html');
for (const f of scriptsOf('training/training.html')) addLoad(f, 'training.html');

const bg = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
for (const m of bg.matchAll(/'((?:background|constants)\/[\w./-]+\.js)'/g)) addLoad(m[1], 'service-worker');

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
for (const cs of manifest.content_scripts || []) for (const f of cs.js || []) addLoad(f, 'manifest content_scripts');

// page world: scripts injetados por <script src> (wpp-hooks, bridge, etc.)
for (const f of ['content/wpp-hooks.js', 'injected/wa-page-bridge.js', 'injected/whl-privacy-shield.js', 'content/extractor.contacts.js', 'chatbackup/extractor.js'])
  if (fs.existsSync(path.join(EXT, f))) addLoad(f, 'page-world (injetado)');

// lazy-loader: modules/${nome}.js para nomes em LAZY_MODULES
const lazySrc = fs.readFileSync(path.join(EXT, 'modules/optimizations/lazy-loader.js'), 'utf8');
const lazyBlock = (lazySrc.match(/LAZY_MODULES:\s*\{([\s\S]*?)\n {4}\}/) || [])[1] || '';
const lazyNames = [...lazyBlock.matchAll(/'([\w-]+)':\s*\{/g)].map((m) => m[1]);
for (const n of lazyNames) addLoad(`modules/${n}.js`, 'lazy-loader (page world via <script>)');

// ── Arquivos JS da extensão ─────────────────────────────────────────────
const SKIP = /(^|\/)(node_modules|dist|tests|lib|\.git|icons|i18n|_locales)(\/|$)/;
const allJs = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const r = rel(p);
    if (SKIP.test(r)) continue;
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js') && !e.name.startsWith('._')) allJs.push(r);
  }
})(EXT);

const AI_RE = /(^|[\/-])(ai|copilot|suggest|smart-repl|smartbot|autopilot|training|knowledge|memory|few-shot|rag|confidence|trust|escalation|learning|persona|intent|sentiment|embedding|kill-switch|tab-coordinator|backend-singleton|backend-client|gateway|response-cache|smart-cache|request-batcher|lazy-loader|human-typing|anti-ban|idb-storage|sync-manager|plan-gate|simulation|speech|voice|document-importer|dynamic-prompt|hybrid|validated|ab-testing|analytics-collector|quality|behavioral|auto-learning|multi-persona|smart-templates|customer-feedback|automation-engine|smart-suggestions)/i;
const aiFiles = allJs.filter((f) => AI_RE.test(f));

const src = new Map(allJs.map((f) => [f, fs.readFileSync(path.join(EXT, f), 'utf8')]));
const isLoaded = (f) => loadMap.has(f);
const runtimeFiles = allJs.filter(isLoaded);

// globais definidos
const globalsOf = (code) => {
  const s = new Set();
  for (const m of code.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) s.add(m[1]);
  for (const m of code.matchAll(/\bglobalThis\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) s.add(m[1]);
  return [...s].filter((g) => g.length > 3 && !/^(on\w+|location|__\w+)$/.test(g));
};

const rows = [];
for (const f of aiFiles.sort()) {
  const code = src.get(f);
  const globals = globalsOf(code);
  const loadedBy = isLoaded(f) ? [...loadMap.get(f)].join(', ') : '—';
  const refs = new Set();
  for (const g of globals) {
    const re = new RegExp(`\\b${g.replace(/\$/g, '\\$')}\\b`);
    for (const rf of runtimeFiles) {
      if (rf === f) continue;
      if (re.test(src.get(rf))) refs.add(rf);
    }
  }
  // referência por nome de arquivo (string) em arquivos que rodam
  const base = path.posix.basename(f);
  const byName = runtimeFiles.filter((rf) => rf !== f && src.get(rf).includes(base));
  rows.push({ f, loadedBy, globals, refs: [...refs], byName, lines: code.split('\n').length });
}

const loadedCount = rows.filter((r) => r.loadedBy !== '—').length;
const out = [];
out.push('# Inventário de IA — grafo de carregamento (extensão)');
out.push('');
out.push(`Gerado por \`node audit/scripts/inventario-ia.js\` em ${new Date().toISOString()}.`);
out.push('');
out.push(`- Arquivos de IA encontrados: **${rows.length}** · carregados em algum runtime: **${loadedCount}** · sem nenhum carregamento: **${rows.length - loadedCount}**`);
out.push(`- Fontes de carregamento consideradas: core/content/advanced (build-manifest.json), sidepanel.html (${scriptsOf('sidepanel.html').length} scripts), training/training.html, importScripts do service worker, manifest content_scripts, scripts injetados no page world, lazy-loader (${lazyNames.join(', ')}).`);
out.push('- "Referenciado por" = arquivos **que rodam** que mencionam um global definido pelo arquivo.');
out.push('');
out.push('| Arquivo | Linhas | Carregado em | Globais definidos | Referenciado por (runtime) |');
out.push('|---|---:|---|---|---|');
for (const r of rows) {
  const refs = r.refs.length ? r.refs.slice(0, 6).join('<br>') + (r.refs.length > 6 ? `<br>(+${r.refs.length - 6})` : '') : (r.byName.length ? `(por nome) ${r.byName.slice(0, 3).join(', ')}` : '—');
  out.push(`| \`${r.f}\` | ${r.lines} | ${r.loadedBy === '—' ? '**⚫ nenhum**' : r.loadedBy} | ${r.globals.slice(0, 5).map((g) => '`' + g + '`').join(' ') || '—'} | ${refs} |`);
}
out.push('');
out.push('## Arquivos de IA SEM carregamento');
out.push('');
for (const r of rows.filter((x) => x.loadedBy === '—')) {
  out.push(`- \`${r.f}\` (${r.lines} linhas) — globais: ${r.globals.map((g) => '`' + g + '`').join(', ') || '—'}; mencionado por runtime: ${r.refs.length || r.byName.length ? [...r.refs, ...r.byName].join(', ') : 'ninguém'}`);
}
process.stdout.write(out.join('\n') + '\n');
