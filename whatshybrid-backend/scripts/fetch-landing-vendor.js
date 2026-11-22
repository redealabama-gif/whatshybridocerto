#!/usr/bin/env node
/**
 * Vórtex Pro — auto-hospedagem dos assets externos da landing.
 *
 * Baixa para dentro de public/ as dependências que hoje vêm de CDN, deixando a
 * landing IMUNE a quedas do prod.spline.design / jsdelivr / esm.sh:
 *
 *   - cobe (lib do globo)   → public/js/vendor/cobe.js          (ESM self-contained)
 *   - viewer do Spline      → public/js/vendor/spline-viewer.js  (ESM self-contained)
 *   - cena 3D do robô       → public/assets/robot-scene.splinecode
 *
 * USO (num ambiente COM acesso à internet):
 *   cd whatshybrid-backend
 *   npm run vendor:landing            # falha (exit 1) se algum download falhar
 *   npm run vendor:landing -- --soft  # NÃO falha; usado no build do Docker
 *
 * Roda automaticamente no build da imagem (Dockerfile, modo --soft): produção
 * já sobe com os assets locais, sem precisar commitar binário no git. Se quiser
 * rodar manualmente, faça commit dos arquivos gerados. O front prefere as cópias
 * locais (index.html / js/globe.js) e só cai pros CDNs se elas não existirem.
 *
 * Sem dependências: usa só o módulo `https` nativo (Node >= 18).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const PUBLIC = path.join(__dirname, '..', 'public');

/**
 * Um bundle auto-hospedado não pode ter NENHUM import pendente — nem absoluto
 * (https://cdn…), nem relativo à raiz (/npm/…), nem relativo ao arquivo (./…).
 * Servido do nosso domínio, qualquer um deles vira 404 e o auto-hospedar perde
 * o sentido. O validador antigo só olhava `from "https://…"` e por isso dava OK
 * para arquivos quebrados.
 */
function validarEsmSelfContained(buf) {
  const txt = buf.toString('utf8');
  if (/^\s*<!doctype html|<html/i.test(txt.slice(0, 4096))) {
    throw new Error('veio HTML (provável erro do CDN)');
  }
  const pendentes = [
    ...txt.matchAll(/(?:^|[;}\s])(?:import|export)\s*(?:[^;'"]*?\sfrom\s*)?["']([^"']+)["']/g),
  ].map((m) => m[1]);
  if (pendentes.length) {
    throw new Error('não é self-contained — ainda importa de: ' + [...new Set(pendentes)].slice(0, 3).join(', '));
  }
  if (!/export\s*(\{|default|\*)/.test(txt)) {
    throw new Error('não exporta nada (não parece um módulo ESM)');
  }
}

/** Validação de um bundle que registra um custom element (não precisa exportar). */
function validarScriptSelfContained(buf) {
  const txt = buf.toString('utf8');
  if (/^\s*<!doctype html|<html/i.test(txt.slice(0, 4096))) {
    throw new Error('veio HTML (provável erro do CDN)');
  }
  if (/\bfrom\s*["']https?:\/\//.test(txt)) {
    throw new Error('não é self-contained — importa de URL externa');
  }
  if (buf.length < 50 * 1024) {
    throw new Error('arquivo pequeno demais para o viewer (' + buf.length + ' bytes)');
  }
}

const TARGETS = [
  {
    name: 'cobe (lib do globo)',
    out: path.join(PUBLIC, 'js', 'vendor', 'cobe.js'),
    // IMPORTANTE: precisa ser um bundle ESM self-contained (deps inlined), senão
    // o arquivo local ainda importa de fora e o auto-hospedar não serve de nada.
    //
    // As duas fontes que estavam aqui NÃO serviam, e o validador antigo não
    // pegava porque só olhava import de URL absoluta:
    //
    //   cdn.jsdelivr.net/npm/cobe@0.6.3/+esm  → import U from "/npm/phenomenon@1.6.0/+esm"
    //   esm.sh/cobe@0.6.3?bundle              → export * from "/cobe@0.6.3/es2022/cobe.bundle.mjs"
    //
    // Os dois usam caminho relativo à RAIZ. Servidos do nosso domínio, o
    // navegador resolveria /npm/... contra o nosso host e tomaria 404. O
    // arquivo abaixo é o bundle de verdade: 11.533 bytes, zero imports.
    sources: [
      'https://esm.sh/cobe@0.6.3/es2022/cobe.bundle.mjs',
      // Se a esm.sh mudar o alvo de compilação (es2022 → es20xx), o stub
      // ?bundle continua apontando pro caminho certo; seguimos o re-export.
      { stub: 'https://esm.sh/cobe@0.6.3?bundle' },
    ],
    validate: validarEsmSelfContained,
  },
  {
    // O arquivo mais importante dos três: é JAVASCRIPT DE TERCEIRO que roda no
    // navegador do cliente. A cena é só dado; o viewer executa. Enquanto ele
    // vier de CDN, uma invasão no pacote @splinetool/viewer roda código na
    // nossa landing. Antes só a cena era auto-hospedada.
    name: 'viewer do Spline (lib que executa no navegador)',
    out: path.join(PUBLIC, 'js', 'vendor', 'spline-viewer.js'),
    sources: [
      'https://unpkg.com/@splinetool/viewer@1.9.96/build/spline-viewer.js',
      'https://cdn.jsdelivr.net/npm/@splinetool/viewer@1.9.96/build/spline-viewer.js',
    ],
    validate: validarScriptSelfContained,
  },
  {
    name: 'cena 3D do robô (Spline)',
    out: path.join(PUBLIC, 'assets', 'robot-scene.splinecode'),
    sources: [
      'https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode',
    ],
    validate(buf) {
      const head = buf.slice(0, 512).toString('utf8');
      if (/<!doctype html|<html|host_not_allowed|access denied/i.test(head)) {
        throw new Error('veio HTML/erro em vez do binário da cena');
      }
      if (buf.length < 1024) throw new Error('arquivo suspeito de tão pequeno (' + buf.length + ' bytes)');
    },
  },
];

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('redirecionamentos demais'));
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'whatshybrid-vendor/1.0', Accept: '*/*' } },
      (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return resolve(get(next, redirects + 1));
        }
        if (code !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + code));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );
    req.setTimeout(30000, () => req.destroy(new Error('timeout (30s)')));
    req.on('error', reject);
  });
}

/**
 * Uma fonte { stub: url } busca primeiro um arquivo de re-export e segue o
 * caminho que ele aponta. A esm.sh responde ?bundle com um stub de 3 linhas
 * (`export * from "/cobe@0.6.3/es2022/cobe.bundle.mjs"`); o bundle de verdade
 * está no caminho de dentro. Assim o script sobrevive a uma mudança do alvo
 * de compilação da esm.sh sem precisar de edição.
 */
async function resolverStub(stubUrl) {
  const stub = await get(stubUrl);
  const txt = stub.toString('utf8');
  const m = txt.match(/export\s*\*\s*from\s*["']([^"']+)["']/) ||
            txt.match(/from\s*["']([^"']+)["']/);
  if (!m) throw new Error('o stub não aponta para nenhum arquivo');
  return new URL(m[1], stubUrl).toString();
}

async function fetchFirst(target) {
  let lastErr;
  for (const fonte of target.sources) {
    let url = typeof fonte === 'string' ? fonte : null;
    try {
      if (!url) {
        process.stdout.write('  • (seguindo stub ' + fonte.stub + ') … ');
        url = await resolverStub(fonte.stub);
        console.log('→ ' + url);
      }
      process.stdout.write('  • ' + url + ' … ');
      const buf = await get(url);
      if (!buf || buf.length === 0) throw new Error('resposta vazia');
      if (target.validate) target.validate(buf);
      console.log('ok (' + buf.length.toLocaleString('pt-BR') + ' bytes)');
      return { buf, url };
    } catch (e) {
      console.log('falhou (' + e.message + ')');
      lastErr = e;
    }
  }
  throw lastErr || new Error('nenhuma fonte respondeu');
}

async function main() {
  console.log('Auto-hospedando assets da landing em public/ …');
  let failures = 0;

  const manifesto = { gerado_em: new Date().toISOString(), assets: {} };

  for (const t of TARGETS) {
    console.log('\n▶ ' + t.name);
    try {
      const { buf, url } = await fetchFirst(t);
      fs.mkdirSync(path.dirname(t.out), { recursive: true });
      fs.writeFileSync(t.out, buf);
      const rel = path.relative(PUBLIC, t.out).split(path.sep).join('/');
      console.log('  ✓ salvo: ' + path.relative(process.cwd(), t.out) + '  (origem: ' + new URL(url).host + ')');
      manifesto.assets[rel] = { bytes: buf.length, origem: new URL(url).host, local: true };
    } catch (e) {
      failures += 1;
      const rel = path.relative(PUBLIC, t.out).split(path.sep).join('/');
      manifesto.assets[rel] = { local: false, erro: e.message };
      console.error('  ✗ ' + t.name + ': ' + e.message);
    }
  }

  // O manifesto é o que permite SABER, em produção, se a landing está
  // servindo os assets locais ou caindo no CDN. Sem ele, o `--soft || true`
  // do Dockerfile esconde a falha e ninguém descobre.
  fs.mkdirSync(PUBLIC, { recursive: true });
  fs.writeFileSync(
    path.join(PUBLIC, 'assets', 'vendor-manifest.json'),
    JSON.stringify(manifesto, null, 2) + '\n'
  );

  console.log('');
  if (failures) {
    const soft = process.argv.includes('--soft');
    console.error(failures + ' asset(s) não baixaram.');
    if (soft) {
      console.warn('Modo --soft: seguindo sem erro — o front usará o CDN como fallback em runtime.');
      process.exit(0);
    }
    console.error('Rode num ambiente com internet liberada (ou baixe manual pelo navegador e salve nos caminhos acima) e tente de novo.');
    process.exit(1);
  }
  console.log('Pronto! Assets locais:');
  for (const rel of Object.keys(manifesto.assets)) console.log('  public/' + rel);
  console.log('Inventário em public/assets/vendor-manifest.json.');
  console.log('A landing passa a usar as cópias locais automaticamente (CDN vira só fallback).');
}

// Só baixa quando chamado como script. Assim os testes podem exercitar os
// validadores sem disparar download nenhum.
if (require.main === module) {
  main().catch((e) => {
    console.error('Falhou:', e && e.message ? e.message : e);
    process.exit(1);
  });
}

module.exports = { TARGETS, validarEsmSelfContained, validarScriptSelfContained };
