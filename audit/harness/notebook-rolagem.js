#!/usr/bin/env node
// Contrato do bloco "notebook que abre ao rolar" (#mostra), copiado do
// MacBook Scroll da Aceternity UI e reconstruido em HTML + CSS.
//
// O GESTO que este arquivo trava e o que o video da referencia mostra:
// a pagina rola, o TECLADO sai pelo topo, e a TAMPA e empurrada para
// baixo na mesma medida, ficando praticamente parada na tela. A versao
// anterior usava `position: sticky` no conjunto todo e so trocava a
// proporcao da tampa — o notebook inteiro ficava congelado. Os checks
// de "o conjunto cabe na janela" daquela versao testavam justamente o
// comportamento errado e foram removidos.
//
// Uso: node audit/harness/notebook-rolagem.js [url]
const { chromium } = require('playwright');
const URL_BASE = process.argv[2] || 'http://127.0.0.1:3000/';

let falhas = 0;
function ok(cond, titulo, detalhe) {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + titulo + (detalhe ? '  [' + detalhe + ']' : ''));
  if (!cond) falhas++;
}

// f = 0 com a pista entrando pela base da janela; f = 1 com o fim dela
// no topo. E a mesma parametrizacao do `offset` da fonte.
async function naPista(page, f) {
  await page.evaluate((ff) => {
    const s = document.querySelector('#mostra');
    window.scrollTo({ top: s.offsetTop - innerHeight + (s.offsetHeight + innerHeight) * ff, behavior: 'instant' });
  }, f);
  await page.waitForTimeout(170);
}
const caixa = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s); if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: Math.round(r.x), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom),
           w: Math.round(r.width), h: Math.round(r.height), absT: Math.round(r.top + scrollY), absB: Math.round(r.bottom + scrollY) };
}, sel);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

  for (const [rotulo, vp] of [['desktop 1440x900', { width: 1440, height: 900 }], ['celular 390x844', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    await page.goto(URL_BASE, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    console.log('\n--- ' + rotulo + ' ---');

    const lugar = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('section[id]')].map((s) => s.id);
      return { ids, i: ids.indexOf('mostra'), iHow: ids.indexOf('how'), rabo: !!document.querySelector('.mb-rabo') };
    });
    ok(lugar.i >= 0, 'a seção #mostra existe');
    ok(lugar.i >= 0 && lugar.iHow === lugar.i + 1, 'vem logo antes do bloco 01 (#how)',
       lugar.ids.slice(Math.max(0, lugar.i - 1), lugar.i + 2).join(' > '));
    ok(lugar.rabo, 'existe a área vazia .mb-rabo onde a tampa termina de descer');

    const img = await page.evaluate(() => {
      const e = document.querySelector('.mb-tela'); if (!e) return null;
      return { loading: e.getAttribute('loading'), srcset: e.getAttribute('srcset') || '',
               alt: (e.getAttribute('alt') || '').length, w: e.getAttribute('width'), h: e.getAttribute('height'),
               fit: getComputedStyle(e).objectFit };
    });
    ok(img && img.loading === 'lazy', 'a imagem é lazy');
    ok(img && (img.srcset.match(/\dw/g) || []).length >= 2, 'a imagem tem srcset com 2 tamanhos');
    ok(img && img.alt > 20, 'a imagem tem alt descritivo', img ? img.alt + ' caracteres' : '');
    ok(img && img.w && img.h, 'a imagem declara width/height');

    // A MOLDURA TEM A RAZAO DA IMAGEM: sem isso o `cover` corta. Com
    // 16:10 sumiam 23,2% da largura, levando junto o painel da direita.
    // Le a propriedade `aspect-ratio`, nao o retangulo renderizado: a
    // primeira versao media getBoundingClientRect() no meio da animacao,
    // com o scaleY(.6) aplicado, e acusava 4,3 contra 1,97.
    const razao = await page.evaluate(() => {
      const ar = getComputedStyle(document.querySelector('.mb-moldura')).aspectRatio;
      const [a, b] = ar.split('/').map((v) => parseFloat(v));
      const i = document.querySelector('.mb-tela');
      return { moldura: b ? a / b : a, imagem: i.naturalWidth / i.naturalHeight };
    });
    ok(Math.abs(razao.moldura - razao.imagem) < 0.03, 'a moldura tem a razão da imagem (nada é cortado)',
       'moldura ' + razao.moldura.toFixed(3) + ' vs imagem ' + razao.imagem.toFixed(3));

    // AS 78 TECLAS
    const teclas = await page.evaluate(() => document.querySelectorAll('.mb-fila .mb-k, .mb-setas .mb-k').length);
    ok(teclas === 78, 'o teclado tem as 78 teclas da fonte', teclas + ' teclas');

    // O ENCAIXE: base e tampa nascem da MESMA largura; a tampa so fica
    // maior por causa do scaleX da animacao. Fixar 80% na base, como eu
    // tinha feito, contava o mesmo efeito duas vezes (dava 0,60).
    await naPista(page, 0.35);
    const t1 = await caixa(page, '.mb-tampa'), b1 = await caixa(page, '.mb-base');
    ok(b1 && t1 && b1.w / t1.w > 0.62 && b1.w / t1.w < 0.90,
       'a base fica entre 0,62 e 0,90 da largura da tampa (referência: 0,81)',
       (b1.w / t1.w).toFixed(3));

    // O TAMANHO. Mede o CORPO no comeco, nao a tampa no fim: a tampa
    // termina em scale(1.5) e passa de 100% da janela de proposito (nas
    // capturas da referencia ela tambem sai cortada nas bordas). O
    // corpo e o numero estavel. Nas capturas do dono ele ocupa ~70% da
    // largura; o meu ja esteve em 36% (copiando os 512px fixos da
    // fonte) e em 85% (quando eu o inflei para caber na janela).
    await naPista(page, 0.3);
    const b2 = await caixa(page, '.mb-base');
    const fatia = b2.w / vp.width;
    ok(fatia > 0.55 && fatia < 0.95, 'o corpo ocupa entre 55% e 95% da largura da janela',
       (fatia * 100).toFixed(0) + '%');

    // O GESTO: o teclado sai pelo topo e a tampa fica.
    await naPista(page, 0.3);
    const baseCedo = await caixa(page, '.mb-base');
    await naPista(page, 0.85);
    const baseTarde = await caixa(page, '.mb-base'), tampaTarde = await caixa(page, '.mb-tampa');
    ok(baseCedo.b > 0 && baseCedo.t < vp.height, 'no começo o teclado está visível',
       'topo ' + baseCedo.t + ' fundo ' + baseCedo.b);
    ok(baseTarde.b < 0, 'no fim o teclado já saiu pelo topo da janela', 'fundo em ' + baseTarde.b);
    ok(tampaTarde.b > 0 && tampaTarde.t < vp.height, 'no fim a tampa continua na janela',
       'topo ' + tampaTarde.t + ' fundo ' + tampaTarde.b);

    // A tampa nao pode cair em cima do bloco 01.
    const invade = await page.evaluate(async () => {
      const s = document.querySelector('#mostra'), h = document.querySelector('#how');
      let pior = -1e9;
      for (let i = 0; i <= 10; i++) {
        const f = i / 10;
        window.scrollTo({ top: s.offsetTop - innerHeight + (s.offsetHeight + innerHeight) * f, behavior: 'instant' });
        await new Promise((r) => requestAnimationFrame(r));
        const t = document.querySelector('.mb-tampa').getBoundingClientRect();
        pior = Math.max(pior, Math.round(t.bottom + scrollY) - h.offsetTop);
      }
      return pior;
    });
    ok(invade <= 0, 'a tampa nunca entra no bloco 01', invade > 0 ? 'invade ' + invade + 'px' : 'folga de ' + (-invade) + 'px');

    // A tampa muda de verdade ao longo da pista.
    const estados = [];
    for (const f of [0.05, 0.3, 0.45, 0.8]) { await naPista(page, f); estados.push((await caixa(page, '.mb-tampa')).absT + '/' + (await caixa(page, '.mb-tampa')).w); }
    ok(new Set(estados).size >= 3, 'a tampa muda de posição e tamanho ao longo da pista',
       new Set(estados).size + ' estados em 4 amostras');

    const ovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ovf <= 1, 'a página não ganhou rolagem horizontal', ovf + 'px');

    // Custo de quadro: medida RELATIVA, mediana de 3 pares alternados.
    // Medir ms aqui nao diz nada da maquina de ninguem (um trecho SEM
    // animacao deu p50 de 350ms neste conteiner); a diferenca, sim.
    const varre = () => page.evaluate(async () => {
      const s = document.querySelector('#mostra');
      const ini = s.offsetTop - innerHeight, fim = s.offsetTop + s.offsetHeight;
      window.scrollTo({ top: ini, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 350));
      const d = []; let ant = performance.now(), i = 0;
      await new Promise((res) => { (function f(t) { d.push(t - ant); ant = t;
        window.scrollTo({ top: ini + (fim - ini) * (i / 80), behavior: 'instant' });
        if (++i <= 80) requestAnimationFrame(f); else res(); })(performance.now()); });
      d.shift(); const o = [...d].sort((a, b) => a - b);
      return { p50: +o[(o.length * .5) | 0].toFixed(1), p95: +o[(o.length * .95) | 0].toFixed(1) };
    });
    const mostrar = (v) => page.evaluate((x) => { document.querySelector('.mb-conjunto').style.visibility = x ? '' : 'hidden'; }, v);
    const meio = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    await varre();
    const cs = [], ss = [];
    for (let i = 0; i < 5; i++) { await mostrar(true); cs.push(await varre()); await mostrar(false); ss.push(await varre()); }
    await mostrar(true);
    const com = { p50: meio(cs.map((x) => x.p50)), p95: meio(cs.map((x) => x.p95)) };
    const sem = { p50: meio(ss.map((x) => x.p50)), p95: meio(ss.map((x) => x.p95)) };
    // Tolerancia de UM quadro (16,7ms a 60Hz). Neste conteiner a leitura
    // anda em degraus de um quadro mesmo com o notebook escondido — com
    // 6 amostras pareadas os dois lados deram 16,7ms cravado. Exigir
    // menos que isso seria medir o conteiner, nao o codigo.
    ok(com.p50 <= sem.p50 + 17, 'o notebook não piora o p50 do trecho em mais de um quadro', 'com ' + com.p50 + 'ms, sem ' + sem.p50 + 'ms');
    ok(com.p95 <= sem.p95 * 1.25 + 20, 'o notebook não piora o p95 do trecho em mais de 25%', 'com ' + com.p95 + 'ms, sem ' + sem.p95 + 'ms');

    const anim = await page.evaluate(() => document.querySelector('.mb-tampa').getAnimations()
      .map((a) => ({ nome: a.animationName || '?', linha: a.timeline ? a.timeline.constructor.name : 'nenhuma' })));
    ok(anim.length >= 1 && anim.every((a) => a.linha === 'ViewTimeline'),
       'a abertura é uma animação de ViewTimeline do CSS (sem JS)', JSON.stringify(anim));

    ok(erros.length === 0, 'nenhum erro de JS na página', erros.join(' | '));
    await ctx.close();
  }

  console.log('\n--- prefers-reduced-motion: reduce ---');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await naPista(page, 0.25);
  const red = await page.evaluate(() => ({
    t: getComputedStyle(document.querySelector('.mb-tampa')).transform,
    alturaTela: Math.round(document.querySelector('.mb-tela').getBoundingClientRect().height),
    tecladoVisivel: document.querySelector('.mb-base').getBoundingClientRect().height > 50,
  }));
  ok(red.t === 'none', 'a tampa fica sem transform (notebook fechado e reto)', red.t);
  ok(red.alturaTela > 100, 'a tela da extensão está visível', red.alturaTela + 'px');
  ok(red.tecladoVisivel, 'o teclado continua na tela');
  await ctx.close();

  await browser.close();
  console.log('\n' + (falhas === 0 ? 'TODAS AS VERIFICAÇÕES PASSARAM' : falhas + ' VERIFICAÇÃO(ÕES) FALHARAM'));
  process.exit(falhas === 0 ? 0 : 1);
})();
