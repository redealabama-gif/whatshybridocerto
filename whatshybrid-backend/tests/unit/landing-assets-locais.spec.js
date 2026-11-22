/**
 * SITE-03 — a landing carregava o globo e o robô 3D de CDN de terceiros.
 *
 * O repo já tinha o scripts/fetch-landing-vendor.js e o Dockerfile:36 já o
 * rodava, mas:
 *
 *   1) as duas fontes do cobe entregavam um STUB, não um bundle. O validador
 *      só olhava `from "https://…"` e deixava passar:
 *        cdn.jsdelivr.net/npm/cobe@0.6.3/+esm → import U from "/npm/phenomenon@1.6.0/+esm"
 *        esm.sh/cobe@0.6.3?bundle             → export * from "/cobe@0.6.3/es2022/cobe.bundle.mjs"
 *      Servido do nosso domínio, esse caminho relativo à raiz vira 404.
 *   2) o spline-viewer.js — JavaScript de terceiro que EXECUTA no navegador do
 *      cliente — nem sequer era auto-hospedado; só a cena (que é dado).
 *   3) nada garantia que os arquivos existissem: faltando, o front caía no CDN
 *      em silêncio.
 *
 * Estes testes trancam os três pontos.
 */
const fs = require('fs');
const path = require('path');
const {
  TARGETS,
  validarEsmSelfContained,
  validarScriptSelfContained,
} = require('../../scripts/fetch-landing-vendor.js');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const ler = (rel) => fs.readFileSync(path.join(PUBLIC, rel));

describe('SITE-03 — assets da landing auto-hospedados', () => {
  test('os três arquivos existem no repositório', () => {
    for (const rel of ['js/vendor/cobe.js', 'js/vendor/spline-viewer.js', 'assets/robot-scene.splinecode']) {
      const p = path.join(PUBLIC, rel);
      expect({ rel, existe: fs.existsSync(p) }).toEqual({ rel, existe: true });
    }
  });

  test('cobe.js é um bundle ESM sem nenhum import pendente', () => {
    expect(() => validarEsmSelfContained(ler('js/vendor/cobe.js'))).not.toThrow();
  });

  test('spline-viewer.js não importa de URL externa', () => {
    expect(() => validarScriptSelfContained(ler('js/vendor/spline-viewer.js'))).not.toThrow();
  });

  test('a cena do robô é binário de verdade, não página de erro', () => {
    const buf = ler('assets/robot-scene.splinecode');
    expect(buf.length).toBeGreaterThan(100 * 1024);
    expect(/<!doctype html|<html|host_not_allowed/i.test(buf.slice(0, 512).toString('utf8'))).toBe(false);
  });

  // --- o validador precisa reprovar o que passava antes -------------------

  test('o validador REPROVA o stub da jsdelivr (import relativo à raiz)', () => {
    const stub = Buffer.from('import U from"/npm/phenomenon@1.6.0/+esm";export{U as default};');
    expect(() => validarEsmSelfContained(stub)).toThrow(/self-contained/);
  });

  test('o validador REPROVA o stub da esm.sh (re-export relativo à raiz)', () => {
    const stub = Buffer.from('/* esm.sh */\nexport * from "/cobe@0.6.3/es2022/cobe.bundle.mjs";\n');
    expect(() => validarEsmSelfContained(stub)).toThrow(/self-contained/);
  });

  test('o validador continua reprovando import de URL absoluta e HTML', () => {
    expect(() => validarEsmSelfContained(Buffer.from('import x from "https://cdn.exemplo/x.js";export{x}')))
      .toThrow(/self-contained/);
    expect(() => validarEsmSelfContained(Buffer.from('<!doctype html><html></html>')))
      .toThrow(/HTML/);
  });

  test('o validador aprova o bundle de verdade', () => {
    const real = Buffer.from('var a=1;function k(){return a}export{k as default};');
    expect(() => validarEsmSelfContained(real)).not.toThrow();
  });

  // --- o front tem de preferir o local ------------------------------------

  test('index.html tenta o viewer LOCAL antes de qualquer CDN', () => {
    const src = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    const m = src.match(/var VIEWER_CDNS = \[([\s\S]*?)\];/);
    expect(m).toBeTruthy();
    const urls = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(urls[0]).toBe('js/vendor/spline-viewer.js');
    expect(urls.length).toBeGreaterThan(1); // CDN segue como rede de segurança
  });

  test('globe.js tenta o cobe LOCAL antes de qualquer CDN', () => {
    const src = fs.readFileSync(path.join(PUBLIC, 'js', 'globe.js'), 'utf8');
    const iLocal = src.indexOf('/js/vendor/cobe.js');
    const iCdn = src.search(/https:\/\/(unpkg|cdn\.jsdelivr|esm)\./);
    expect(iLocal).toBeGreaterThan(-1);
    expect(iCdn).toBeGreaterThan(iLocal);
  });

  test('o script de vendor cobre os três alvos', () => {
    const saidas = TARGETS.map((t) => path.relative(PUBLIC, t.out).split(path.sep).join('/'));
    expect(saidas.sort()).toEqual(
      ['assets/robot-scene.splinecode', 'js/vendor/cobe.js', 'js/vendor/spline-viewer.js']
    );
  });
});
