#!/usr/bin/env node
/**
 * Vórtex Pro — auto-hospedagem dos assets externos da landing.
 *
 * Baixa para dentro de public/ as dependências que hoje vêm de CDN, deixando a
 * landing IMUNE a quedas do prod.spline.design / jsdelivr / esm.sh:
 *
 *   - cobe (lib do globo)   → public/js/vendor/cobe.js          (ESM self-contained)
 *   - Spline inteiro        → public/js/vendor/spline/           (viewer + .js irmãos
 *                             + .wasm + decodificador Draco, com as URLs de CDN
 *                             cravadas no bundle reescritas para o caminho local)
 *   - cena 3D do robô       → public/assets/robot-scene.splinecode
 *   - Google Fonts          → public/fonts/*.woff2 + public/css/fonts.css
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

// ───────────────────────────── Spline ─────────────────────────────
//
// O bundle do viewer carrega, SOB DEMANDA, mais oito arquivos .js irmãos
// (import('./physics.js') e companhia, relativos ao próprio arquivo) e busca
// quatro .wasm e o decodificador Draco por URL ABSOLUTA cravada no código
// minificado. Auto-hospedar só o spline-viewer.js não resolvia nada: a cena
// continuava puxando process.wasm do unpkg a cada visita.
//
// Tudo vai para a MESMA pasta (public/js/vendor/spline/). Assim os imports
// relativos resolvem sozinhos e as URLs absolutas viram um prefixo só.
const SPLINE_VER = '1.9.96';
const SPLINE_DIR = path.join(PUBLIC, 'js', 'vendor', 'spline');
const SPLINE_BASE_WEB = '/js/vendor/spline';
const DRACO_VER = '1.5.2';

// PNG 1x1 totalmente transparente, embutido — não baixa nada de ninguém.
const PNG_TRANSPARENTE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Arquivos .js que o viewer importa por caminho relativo. Todos precisam
// estar presentes: se faltar um, o import dá 404 e NÃO cai em CDN nenhum —
// seria trocar "depende de CDN" por "quebra em silêncio".
const SPLINE_JS_IRMAOS = [
  'physics.js', 'opentype.js', 'process.js', 'navmesh.js',
  'boolean.js', 'ui.js', 'gaussian-splat-compression.js', 'howler.js',
];

// Pacotes .wasm separados, buscados por URL absoluta.
const SPLINE_WASM = [
  ['boolean-wasm', 'boolean.wasm'],
  ['modelling-wasm', 'process.wasm'],
  ['navmesh-wasm', 'navmesh.wasm'],
  ['ui-wasm', 'ui.wasm'],
];

/**
 * Reescreve as URLs de CDN cravadas no bundle do viewer para o caminho local.
 * São literais de string no código minificado; a troca é textual e o
 * resultado é conferido depois (nenhum host de terceiro pode sobrar).
 */
function reescreverUrlsDoViewer(buf) {
  let txt = buf.toString('utf8');
  const trocas = [
    [`https://unpkg.com/@splinetool/boolean-wasm@${SPLINE_VER}/build`, SPLINE_BASE_WEB],
    [`https://unpkg.com/@splinetool/modelling-wasm@${SPLINE_VER}/build`, SPLINE_BASE_WEB],
    [`https://unpkg.com/@splinetool/navmesh-wasm@${SPLINE_VER}/build`, SPLINE_BASE_WEB],
    [`https://unpkg.com/@splinetool/ui-wasm@${SPLINE_VER}/build/ui.wasm`, SPLINE_BASE_WEB + '/ui.wasm'],
    [`https://unpkg.com/@splinetool/runtime@${SPLINE_VER}/build/`, SPLINE_BASE_WEB + '/'],
    [`https://www.gstatic.com/draco/versioned/decoders/${DRACO_VER}/`, SPLINE_BASE_WEB + '/draco/'],
    // Logo do Spline, usado como background-image do badge dentro do shadow
    // DOM do viewer. A landing JÁ esconde esse badge por CSS
    // (`.feature-robot spline-viewer::part(logo) { display: none }`), então a
    // imagem nunca aparece — mas era pedida ao app.spline.design a cada
    // visita. Trocada por um PNG transparente embutido: não muda nada na
    // tela, só some com a requisição. Se um dia o badge voltar a ser
    // exibido, isto aqui precisa voltar atrás.
    ['https://app.spline.design/_assets/_icons/icon_favicon32x32.png', PNG_TRANSPARENTE],
  ];
  const feitas = [];
  for (const [de, para] of trocas) {
    const antes = txt.length;
    txt = txt.split(de).join(para);
    if (txt.length !== antes) feitas.push(de);
  }
  if (!feitas.length) throw new Error('nenhuma URL de CDN encontrada no bundle (versão mudou?)');

  // Nada de terceiro pode sobrar entre as URLs que o viewer BUSCA. As que
  // restam no arquivo são de comentário/atribuição (shadertoy, iquilezles) ou
  // de recursos do editor que a landing não usa.
  const proibidos = [/unpkg\.com/, /cdn\.jsdelivr\.net/, /www\.gstatic\.com/, /app\.spline\.design/];
  for (const re of proibidos) {
    const m = txt.match(re);
    if (m) throw new Error('sobrou referência a ' + m[0] + ' depois da reescrita');
  }
  return { buf: Buffer.from(txt, 'utf8'), feitas };
}

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

/** Um .wasm de verdade começa com o número mágico \0asm. */
function validarWasm(buf) {
  if (buf.length < 1024) throw new Error('pequeno demais (' + buf.length + ' bytes)');
  const magico = buf.slice(0, 4);
  if (!(magico[0] === 0x00 && magico[1] === 0x61 && magico[2] === 0x73 && magico[3] === 0x6d)) {
    throw new Error('não é WebAssembly (começa com ' + magico.toString('hex') + ')');
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
  if (buf.length < 10 * 1024) {
    throw new Error('arquivo pequeno demais (' + buf.length + ' bytes)');
  }
}

const TARGETS = [
  {
    // Rolagem suave. Os dois sites que o dono trouxe como referencia de
    // "premium" — deltacafes.com e landonorris.com — usam exatamente esta
    // biblioteca; medido no navegador, o <html> dos dois carrega a classe
    // "lenis". E a assinatura mais reconhecivel de site caprichado e custa
    // uns 3 KB.
    //
    // Vem auto-hospedada como todo o resto: o SITE-03c tirou esta landing
    // de CDN de terceiro e nao faz sentido reintroduzir um.
    name: 'lenis (rolagem suave)',
    out: path.join(PUBLIC, 'js', 'vendor', 'lenis.js'),
    sources: [
      'https://cdn.jsdelivr.net/npm/lenis@1.1.18/dist/lenis.min.js',
      'https://unpkg.com/lenis@1.1.18/dist/lenis.min.js',
    ],
    validate: validarScriptSelfContained,
  },
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
    // O arquivo mais importante do conjunto: é JAVASCRIPT DE TERCEIRO que roda
    // no navegador do cliente. A cena é só dado; o viewer executa. As URLs de
    // CDN cravadas nele são reescritas para o caminho local em `transform`.
    name: 'viewer do Spline (lib que executa no navegador)',
    out: path.join(SPLINE_DIR, 'spline-viewer.js'),
    sources: [
      `https://unpkg.com/@splinetool/viewer@${SPLINE_VER}/build/spline-viewer.js`,
      `https://cdn.jsdelivr.net/npm/@splinetool/viewer@${SPLINE_VER}/build/spline-viewer.js`,
    ],
    validate: validarScriptSelfContained,
    transform(buf) {
      const { buf: saida, feitas } = reescreverUrlsDoViewer(buf);
      console.log('    ↳ ' + feitas.length + ' URL(s) de CDN reescritas para ' + SPLINE_BASE_WEB);
      return saida;
    },
  },

  // Os .js irmãos: o viewer faz import('./physics.js') e companhia quando a
  // cena usa o recurso. Sem eles no mesmo diretório, 404 sem fallback.
  ...SPLINE_JS_IRMAOS.map((arq) => ({
    name: 'Spline — ' + arq + ' (import sob demanda do viewer)',
    out: path.join(SPLINE_DIR, arq),
    sources: [
      `https://unpkg.com/@splinetool/viewer@${SPLINE_VER}/build/${arq}`,
      `https://cdn.jsdelivr.net/npm/@splinetool/viewer@${SPLINE_VER}/build/${arq}`,
    ],
    validate: validarScriptSelfContained,
  })),

  // Os .wasm, que o bundle buscava por URL absoluta no unpkg.
  ...SPLINE_WASM.map(([pacote, arq]) => ({
    name: 'Spline — ' + arq + ' (' + pacote + ')',
    out: path.join(SPLINE_DIR, arq),
    sources: [
      `https://unpkg.com/@splinetool/${pacote}@${SPLINE_VER}/build/${arq}`,
      `https://cdn.jsdelivr.net/npm/@splinetool/${pacote}@${SPLINE_VER}/build/${arq}`,
    ],
    validate: validarWasm,
  })),

  // Decodificador Draco (geometria comprimida), que o viewer buscava no
  // www.gstatic.com do Google.
  ...['draco_wasm_wrapper.js', 'draco_decoder.wasm'].map((arq) => ({
    name: 'Spline — draco/' + arq,
    out: path.join(SPLINE_DIR, 'draco', arq),
    sources: [`https://www.gstatic.com/draco/versioned/decoders/${DRACO_VER}/${arq}`],
    validate: arq.endsWith('.wasm') ? validarWasm : validarScriptSelfContained,
  })),
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

// ───────────────────────────── Google Fonts ─────────────────────────────
//
// As 9 páginas carregavam as duas famílias de fonts.googleapis.com, que por
// sua vez serve os .woff2 de fonts.gstatic.com. Além da dependência de CDN,
// isso entrega o IP de cada visitante ao Google — sob a LGPD, transferência
// de dado pessoal que ninguém consentiu.
//
// A folha vem com dezenas de @font-face (um por subconjunto de caracteres).
// Baixamos TODOS: cada arquivo tem 10–20 KB, então pegar só o latin pouparia
// pouco e quebraria texto em grego, cirílico ou vietnamita.
//
// JetBrains Mono entrou com o redesign: é a família dos rótulos, índices de
// seção e números (ver public/css/redesign.css). Mono de verdade, porque
// `ui-monospace` muda de desenho em cada sistema — e rótulo que troca de
// largura entre Mac e Windows desalinha a grade.
const FONTES_URL =
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..800' +
  '&family=Inter:wght@400;500;600;700;800' +
  '&family=JetBrains+Mono:wght@400;500;600&display=swap';
// Sem User-Agent de navegador moderno a Google devolve .ttf em vez de .woff2.
const UA_NAVEGADOR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Baixa a folha do Google, troca cada URL remota pelo arquivo local e salva
 * tudo em public/fonts/ + public/css/fonts.css.
 */
async function vendorizarFontes(manifesto) {
  console.log('\n\u25b6 Google Fonts (Fraunces + Inter)');
  const dirFontes = path.join(PUBLIC, 'fonts');
  const saidaCss = path.join(PUBLIC, 'css', 'fonts.css');

  process.stdout.write('  \u2022 folha do Google \u2026 ');
  let css = (await get(FONTES_URL, 0, { 'User-Agent': UA_NAVEGADOR })).toString('utf8');
  if (!/@font-face/.test(css)) throw new Error('a folha veio sem @font-face');
  console.log('ok (' + css.length.toLocaleString('pt-BR') + ' bytes)');

  const blocos = [...css.matchAll(/\/\* ([a-z-]+) \*\/\s*@font-face\s*\{([^}]*)\}/g)];
  if (!blocos.length) throw new Error('nao consegui separar os @font-face');

  fs.mkdirSync(dirFontes, { recursive: true });
  const usados = new Set();
  let baixados = 0;

  for (const [, subset, corpo] of blocos) {
    const fam = (corpo.match(/font-family:\s*'([^']+)'/) || [])[1];
    const peso = ((corpo.match(/font-weight:\s*([^;]+);/) || [])[1] || '400').trim();
    const url = (corpo.match(/url\((https:\/\/[^)]+)\)/) || [])[1];
    if (!fam || !url) throw new Error('bloco @font-face sem familia ou url');

    // Nome legivel e estavel: familia-subset-peso.woff2 ("400 800" = variavel).
    // O espaco de uma familia composta ("JetBrains Mono") vira hifen: sem isso
    // o nome sai com espaco e a url() da folha fica invalida (CSS nao aceita
    // espaco em url() sem aspas), e a fonte simplesmente nao carrega.
    const slug = fam.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const nome = [slug, subset, peso.includes(' ') ? 'var' : peso].join('-') + '.woff2';
    if (usados.has(nome)) throw new Error('dois arquivos cairiam em ' + nome);
    usados.add(nome);

    const buf = await get(url, 0, { 'User-Agent': UA_NAVEGADOR });
    // Um .woff2 comeca com a assinatura "wOF2".
    if (buf.slice(0, 4).toString('ascii') !== 'wOF2') {
      throw new Error(nome + ': nao e woff2 (' + buf.slice(0, 4).toString('hex') + ')');
    }
    fs.writeFileSync(path.join(dirFontes, nome), buf);
    css = css.split(url).join('/fonts/' + nome);
    baixados += 1;
  }

  if (/https?:\/\//.test(css)) throw new Error('sobrou URL externa na folha depois da troca');

  const cabecalho = [
    '/* Fontes auto-hospedadas \u2014 NAO EDITE A MAO.',
    ' * Gerado por whatshybrid-backend/scripts/fetch-landing-vendor.js',
    ' * Fraunces, Inter e JetBrains Mono estao sob a SIL Open Font License 1.1.',
    ' */',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(saidaCss), { recursive: true });
  fs.writeFileSync(saidaCss, cabecalho + css);

  console.log('  \u2713 ' + baixados + ' arquivo(s) em public/fonts/ + public/css/fonts.css');
  manifesto.assets['css/fonts.css'] = {
    bytes: Buffer.byteLength(cabecalho + css),
    origem: 'fonts.googleapis.com',
    local: true,
    arquivos_woff2: baixados,
  };
}

function get(url, redirects = 0, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('redirecionamentos demais'));
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'whatshybrid-vendor/1.0', Accept: '*/*', ...extraHeaders } },
      (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return resolve(get(next, redirects + 1, extraHeaders));
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
      const { buf: bruto, url } = await fetchFirst(t);
      const buf = t.transform ? t.transform(bruto) : bruto;
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

  try {
    await vendorizarFontes(manifesto);
  } catch (e) {
    failures += 1;
    manifesto.assets['css/fonts.css'] = { local: false, erro: e.message };
    console.error('  ✗ Google Fonts: ' + e.message);
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
