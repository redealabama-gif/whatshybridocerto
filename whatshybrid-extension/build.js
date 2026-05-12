/**
 * Build script da extensão WhatsHybrid Pro — v9.0.0 (rev 2)
 *
 * Estratégia: concat + minify (manual fallback OR esbuild se disponível).
 *   - Remove comentários // e bloco
 *   - Remove whitespace redundante
 *   - Preserva strings, regex, template literals intactos
 *
 * Saída:
 *   dist/core-bundle.js     (i18n + constants + utils)
 *   dist/content-bundle.js  (essential runtime)
 *   dist/advanced-bundle.js (lazy-loaded pelo background)
 *
 * Uso:
 *   node build.js          # produção (minify)
 *   node build.js --dev    # development (sem minify)
 *   node build.js --no-min # concat sem minify
 */

const fs = require('fs');
const path = require('path');

const isDev = process.argv.includes('--dev');
const noMinify = process.argv.includes('--no-min') || isDev;
const projectRoot = __dirname;

const distDir = path.join(projectRoot, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

// v9.5.0 BUG #156: concat wpp-hooks-parts → wpp-hooks.js antes do build.
// O arquivo é injetado como <script src=> via web_accessible_resources e
// NÃO faz parte dos bundles. Em v9.4.7 era um stub vazio; partes não eram
// carregadas; sapl.js (self-healing) achava window.whl_hooks_main undefined.
(function rebuildWppHooks() {
  const partsDir = path.join(projectRoot, 'content', 'wpp-hooks-parts');
  if (!fs.existsSync(partsDir)) return;
  // Skip macOS AppleDouble files ("._foo.js" resource forks). They look like
  // valid filenames to readdir but contain binary metadata, and when
  // concatenated into wpp-hooks.js they produce
  // SyntaxError: Invalid or unexpected token at the page-world load —
  // which silently breaks every require()-based feature that depends on
  // window.whl_hooks_* (extrairContatos, presence hooks, view-once, etc).
  const parts = fs.readdirSync(partsDir)
    .filter(f => f.endsWith('.js') && !f.startsWith('._'))
    .sort();
  if (!parts.length) return;
  let out = `/**
 * wpp-hooks.js — concatenado de wpp-hooks-parts/*.js (gerado por build.js).
 * Não editar; mexa nos arquivos em content/wpp-hooks-parts/ e re-build.
 */
console.log('[WHL WPP Hooks] carregando');
`;
  for (const p of parts) {
    out += `\n// ─── BEGIN ${p} ───\n`;
    out += fs.readFileSync(path.join(partsDir, p), 'utf8');
    out += `\n// ─── END ${p} ───\n`;
  }
  fs.writeFileSync(path.join(projectRoot, 'content', 'wpp-hooks.js'), out);
  console.log(`[Build] wpp-hooks.js: concatenado de ${parts.length} pedaços (${(out.length/1024).toFixed(1)}KB)`);
})();

const manifestStrat = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'build-manifest.json'), 'utf8')
);

let esbuild = null;
try { esbuild = require('esbuild'); } catch (_) {}

/**
 * Minifier manual em JS puro.
 * Remove comentários e whitespace redundante.
 * Preserva strings, regex, template literals.
 */
function manualMinify(code) {
  let out = '';
  let i = 0;
  const len = code.length;

  while (i < len) {
    const c = code[i];
    const next = code[i + 1];

    // Line comment //
    if (c === '/' && next === '/') {
      while (i < len && code[i] !== '\n') i++;
      continue;
    }
    // Block comment /* */
    if (c === '/' && next === '*') {
      i += 2;
      while (i < len - 1 && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // String literals
    if (c === '"' || c === "'") {
      const q = c;
      out += c; i++;
      while (i < len) {
        if (code[i] === '\\') { out += code[i] + (code[i+1] || ''); i += 2; continue; }
        if (code[i] === q) { out += code[i]; i++; break; }
        out += code[i]; i++;
      }
      continue;
    }
    // Template literal
    if (c === '`') {
      out += c; i++;
      while (i < len) {
        if (code[i] === '\\') { out += code[i] + (code[i+1] || ''); i += 2; continue; }
        if (code[i] === '`') { out += code[i]; i++; break; }
        if (code[i] === '$' && code[i+1] === '{') {
          out += '${'; i += 2;
          let depth = 1;
          while (i < len && depth > 0) {
            if (code[i] === '{') depth++;
            else if (code[i] === '}') depth--;
            out += code[i]; i++;
            if (depth === 0) break;
          }
          continue;
        }
        out += code[i]; i++;
      }
      continue;
    }
    // Regex literal
    if (c === '/') {
      let lastNonSpace = '';
      for (let j = out.length - 1; j >= 0; j--) {
        if (!/\s/.test(out[j])) { lastNonSpace = out[j]; break; }
      }
      const isRegex = !lastNonSpace || /[=({[,;!&|?:+\-*%^~<>]/.test(lastNonSpace) ||
                      /\b(return|typeof|in|of|instanceof|new|delete|void|throw)$/.test(out.slice(-12));
      if (isRegex) {
        out += '/'; i++;
        while (i < len) {
          if (code[i] === '\\') { out += code[i] + (code[i+1] || ''); i += 2; continue; }
          if (code[i] === '[') {
            out += '['; i++;
            while (i < len && code[i] !== ']') {
              if (code[i] === '\\') { out += code[i] + (code[i+1] || ''); i += 2; continue; }
              out += code[i]; i++;
            }
            if (i < len) { out += ']'; i++; }
            continue;
          }
          if (code[i] === '/') {
            out += '/'; i++;
            while (i < len && /[gimsuy]/.test(code[i])) { out += code[i]; i++; }
            break;
          }
          out += code[i]; i++;
        }
        continue;
      }
    }
    // Whitespace collapse
    if (/\s/.test(c)) {
      while (i < len && /\s/.test(code[i])) i++;
      const prev = out[out.length - 1] || '';
      const nx = code[i] || '';
      if (/[a-zA-Z0-9_$]/.test(prev) && /[a-zA-Z0-9_$]/.test(nx)) out += ' ';
      continue;
    }
    out += c; i++;
  }
  return out;
}

async function minify(code) {
  if (noMinify) return code;
  if (esbuild) {
    try {
      const r = await esbuild.transform(code, {
        minify: true, target: 'chrome100', legalComments: 'none',
      });
      return r.code;
    } catch (e) {
      console.warn(`  ⚠️ esbuild falhou, fallback manual: ${e.message}`);
    }
  }
  return manualMinify(code);
}

function concatScripts(scripts, label) {
  const parts = [`/* WhatsHybrid Pro ${label} v9.4.6 */`];
  let totalRaw = 0;

  // v9.4.6: detecta arquivos que são FRAGMENTOS de uma função/escopo compartilhado.
  // Esses arquivos não podem ser envolvidos em IIFE individual — precisam ser
  // concatenados como um único bloco. Convenção: arquivos em content/content-parts/.
  // O conjunto inteiro vira UMA IIFE compartilhada.
  //
  // Antes (Bug #108): cada slice era uma IIFE separada → função canSendAntiBan
  // que começava em 01-bootstrap e terminava em 02-bridge-handlers ficava órfã,
  // try/catch engolia o erro silenciosamente, fix direto no arquivo era impossível.
  const fragments = [];
  const standaloneScripts = [];

  for (const rel of scripts) {
    if (rel.includes('content/content-parts/')) {
      fragments.push(rel);
    } else {
      standaloneScripts.push(rel);
    }
  }

  // Concatena fragmentos numa IIFE única ANTES dos arquivos standalone
  if (fragments.length > 0) {
    let fragmentBody = '';
    for (const rel of fragments) {
      const full = path.join(projectRoot, rel);
      if (!fs.existsSync(full)) { console.warn(`  ⚠️  ${rel} não encontrado`); continue; }
      const content = fs.readFileSync(full, 'utf8');
      totalRaw += content.length;
      // Marca cada slice com comentário pra debug, sem quebrar escopo
      fragmentBody += `\n/* ===== ${rel} ===== */\n${content}\n`;
    }
    parts.push(`(function(){try{${fragmentBody}}catch(e){console.error('[WHL:${label}] content-parts (merged):',e);}})();`);
  }

  // Standalone scripts continuam com IIFE individual (cada arquivo é independente)
  for (const rel of standaloneScripts) {
    const full = path.join(projectRoot, rel);
    if (!fs.existsSync(full)) { console.warn(`  ⚠️  ${rel} não encontrado`); continue; }
    const content = fs.readFileSync(full, 'utf8');
    totalRaw += content.length;
    parts.push(`(function(){try{${content}}catch(e){console.error('[WHL:${label}] ${rel}:',e);}})();`);
  }

  return { code: parts.join('\n'), rawBytes: totalRaw };
}

async function build() {
  console.log(`\n🔨 WhatsHybrid Extension Build v9.0.0`);
  console.log(`   Minifier: ${esbuild ? 'esbuild' : noMinify ? 'OFF' : 'manual'}\n`);

  const bundles = [
    { name: 'core-bundle',     scripts: manifestStrat.core },
    { name: 'content-bundle',  scripts: manifestStrat.content },
    { name: 'advanced-bundle', scripts: manifestStrat.advanced },
  ];

  const stats = [];
  for (const b of bundles) {
    const { code, rawBytes } = concatScripts(b.scripts, b.name);
    const finalCode = await minify(code);
    const outPath = path.join(distDir, b.name + '.js');
    fs.writeFileSync(outPath, finalCode);

    const sizeKB = (finalCode.length / 1024).toFixed(1);
    const rawKB = (rawBytes / 1024).toFixed(1);
    const ratio = rawBytes > 0 ? ((1 - finalCode.length / rawBytes) * 100).toFixed(0) : 0;
    console.log(`✅ ${b.name}.js: ${sizeKB}KB (raw ${rawKB}KB, -${ratio}%) — ${b.scripts.length} scripts`);
    stats.push({ name: b.name, size: finalCode.length, raw: rawBytes });
  }

  // Atualiza manifest.json
  const manifestPath = path.join(projectRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  // v9.5.9: keep the document_start page-bridge injector ahead of the bundles.
  // The injector is tiny and must run before WhatsApp Web's webpack initializes,
  // so it can drop the <script src=injected/wa-page-bridge.js> tag in time.
  manifest.content_scripts = [
    {
      matches: ['https://web.whatsapp.com/*'],
      js: ['content-scripts/page-bridge-injector.js'],
      run_at: 'document_start',
      all_frames: false,
    },
    {
      matches: ['https://web.whatsapp.com/*'],
      js: ['dist/core-bundle.js', 'dist/content-bundle.js'],
      run_at: 'document_idle',
      all_frames: false,
      css: [
        'content/top-panel.css',
        'chatbackup/injected.css',
        'modules/modules.css',
      ],
    },
  ];
  if (manifest.web_accessible_resources?.[0]?.resources) {
    for (const r of ['injected/wa-page-bridge.js', 'injected/whl-privacy-shield.js']) {
      if (!manifest.web_accessible_resources[0].resources.includes(r)) {
        manifest.web_accessible_resources[0].resources.push(r);
      }
    }
  }
  if (manifest.web_accessible_resources?.[0]?.resources) {
    if (!manifest.web_accessible_resources[0].resources.includes('dist/*')) {
      manifest.web_accessible_resources[0].resources.push('dist/*');
    }
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Build report
  fs.writeFileSync(
    path.join(distDir, 'build-report.json'),
    JSON.stringify({
      version: require('./package.json').version,
      built_at: new Date().toISOString(),
      minifier: esbuild ? 'esbuild' : noMinify ? 'none' : 'manual',
      bundles: stats,
      total_size: stats.reduce((s, b) => s + b.size, 0),
      total_raw: stats.reduce((s, b) => s + b.raw, 0),
    }, null, 2)
  );

  console.log('\n📝 manifest.json: 139 scripts → 2 bundles');
  console.log('   advanced-bundle.js carregado dinamicamente\n');
}

build().catch(err => { console.error('❌ Build failed:', err); process.exit(1); });
