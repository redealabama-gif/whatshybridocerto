#!/usr/bin/env node
// Contrato do bloco "notebook que abre ao rolar" (#mostra), inspirado no
// MacBook Scroll da Aceternity UI e reconstruído em CSS.
//
// O que este arquivo trava:
//   1. a seção existe e fica ENTRE o hero e o bloco 01 (#how);
//   2. a tampa gira de verdade conforme a rolagem (não é decoração parada);
//   3. em prefers-reduced-motion a tela aparece ABERTA e o título legível —
//      nunca uma tela deitada e ilegível;
//   4. o conjunto cabe na janela, em desktop e celular;
//   5. a seção não cria rolagem horizontal;
//   6. a imagem é lazy, tem srcset e dois tamanhos;
//   7. a rolagem pela pista não estoura o orçamento de quadros.
//
// Uso: node audit/harness/notebook-rolagem.js [url]
const { chromium } = require('playwright');
const URL_BASE = process.argv[2] || 'http://127.0.0.1:3000/';

let falhas = 0;
function ok(cond, titulo, detalhe) {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + titulo + (detalhe ? '  [' + detalhe + ']' : ''));
  if (!cond) falhas++;
}

async function naPista(page, fracao) {
  await page.evaluate((f) => {
    const s = document.querySelector('#mostra');
    const alvo = s.offsetTop - window.innerHeight + (s.offsetHeight + window.innerHeight) * f;
    window.scrollTo({ top: alvo, behavior: 'instant' });
  }, fracao);
  await page.waitForTimeout(180);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

  for (const [rotulo, vp] of [['desktop 1440x900', { width: 1440, height: 900 }], ['celular 390x844', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', e => erros.push(e.message));
    await page.goto(URL_BASE, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    console.log('\n--- ' + rotulo + ' ---');

    // 1. existe e está no lugar
    const lugar = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('section[id]')].map(s => s.id);
      return { ids, i: ids.indexOf('mostra'), iHow: ids.indexOf('how') };
    });
    ok(lugar.i >= 0, 'a seção #mostra existe');
    ok(lugar.i >= 0 && lugar.iHow === lugar.i + 1, 'vem logo antes do bloco 01 (#how)', 'ordem: ' + lugar.ids.slice(Math.max(0, lugar.i - 1), lugar.i + 2).join(' > '));

    // 6. a imagem
    const img = await page.evaluate(() => {
      const el = document.querySelector('.mb-tela');
      if (!el) return null;
      return { loading: el.getAttribute('loading'), srcset: el.getAttribute('srcset') || '', alt: (el.getAttribute('alt') || '').length, w: el.getAttribute('width'), h: el.getAttribute('height') };
    });
    ok(img && img.loading === 'lazy', 'a imagem é lazy');
    ok(img && (img.srcset.match(/\dw/g) || []).length >= 2, 'a imagem tem srcset com 2 tamanhos', img ? img.srcset : '');
    ok(img && img.alt > 20, 'a imagem tem alt descritivo', img ? img.alt + ' caracteres' : '');
    ok(img && img.w && img.h, 'a imagem declara width/height (não empurra o layout)');

    // 4. cabe na janela, no meio da abertura e no fim
    for (const f of [0.3, 0.6]) {
      await naPista(page, f);
      const c = await page.evaluate(() => {
        const r = document.querySelector('.mb-conjunto').getBoundingClientRect();
        return { topo: Math.round(r.top), fundo: Math.round(r.bottom), jan: window.innerHeight, w: Math.round(r.width), h: Math.round(r.height) };
      });
      ok(c.topo >= -2 && c.fundo <= c.jan + 2, 'o conjunto cabe na janela em ' + (f * 100) + '% da pista', c.w + 'x' + c.h + ', topo ' + c.topo + ' fundo ' + c.fundo + ' de ' + c.jan);
    }

    // 2. a tampa gira conforme a rolagem
    const amostras = [];
    for (const f of [0.05, 0.2, 0.35, 0.6]) {
      await naPista(page, f);
      amostras.push(await page.evaluate(() => getComputedStyle(document.querySelector('.mb-tampa')).transform));
    }
    const distintos = new Set(amostras).size;
    ok(distintos >= 3, 'a tampa muda de transform ao longo da pista', distintos + ' estados distintos em 4 amostras');
    ok(amostras[amostras.length - 1] === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(amostras[amostras.length - 1]), 'no fim da abertura a tela está de pé (sem rotação)', amostras[amostras.length - 1].slice(0, 46));

    // 5. sem rolagem horizontal
    const ovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ovf <= 1, 'a página não ganhou rolagem horizontal', ovf + 'px');

    // 7. custo de quadro — MEDIDA RELATIVA, de propósito.
    //
    // Medir ms por quadro aqui dentro não diz nada sobre a máquina de
    // ninguém: neste contêiner headless, um trecho SEM animação nenhuma
    // (#pricing) deu p50 de 350ms. O número mede o contêiner. O que dá
    // para afirmar daqui é a diferença: o mesmo trecho, na mesma
    // passagem, com e sem o notebook na tela. Se a animação custasse
    // caro, a diferença apareceria.
    const varre = async () => page.evaluate(async () => {
      const s = document.querySelector('#mostra');
      const ini = s.offsetTop - window.innerHeight, fim = s.offsetTop + s.offsetHeight;
      window.scrollTo({ top: ini, behavior: 'instant' });
      await new Promise(r => setTimeout(r, 350));
      const d = []; let ant = performance.now(), i = 0;
      await new Promise(res => {
        (function f(t) {
          d.push(t - ant); ant = t;
          window.scrollTo({ top: ini + (fim - ini) * (i / 80), behavior: 'instant' });
          if (++i <= 80) requestAnimationFrame(f); else res();
        })(performance.now());
      });
      d.shift(); const o = [...d].sort((a, b) => a - b);
      return { p50: +o[(o.length * .5) | 0].toFixed(1), p95: +o[(o.length * .95) | 0].toFixed(1) };
    });
    // Aquecimento e depois TRÊS pares alternados, com a mediana de cada
    // lado. Uma amostra só não serve: no celular a leitura pulava entre
    // 16,7 e 33,3ms — exatamente um quadro — mesmo com o notebook
    // escondido. Com 6 amostras pareadas os dois lados deram 16,7ms
    // cravado, então o pulo era a primeira passagem fria, não custo.
    const mostrar = (v) => page.evaluate((x) => {
      document.querySelector('.mb-conjunto').style.visibility = x ? '' : 'hidden';
    }, v);
    const meio = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    await varre();
    const cs = [], ss = [];
    for (let i = 0; i < 3; i++) {
      await mostrar(true);  cs.push(await varre());
      await mostrar(false); ss.push(await varre());
    }
    await mostrar(true);
    const com = { p50: meio(cs.map(x => x.p50)), p95: meio(cs.map(x => x.p95)) };
    const sem = { p50: meio(ss.map(x => x.p50)), p95: meio(ss.map(x => x.p95)) };
    ok(com.p50 <= sem.p50 + 8, 'o notebook não piora o p50 do trecho em mais de 8ms',
       'com ' + com.p50 + 'ms, sem ' + sem.p50 + 'ms');
    ok(com.p95 <= sem.p95 * 1.25 + 20, 'o notebook não piora o p95 do trecho em mais de 25%',
       'com ' + com.p95 + 'ms, sem ' + sem.p95 + 'ms');

    // 8. a animação não usa a thread principal: é scroll-driven do CSS,
    //    sem listener de rolagem e sem JavaScript nenhum.
    const anim = await page.evaluate(() => {
      const a = document.querySelector('.mb-tampa').getAnimations();
      return a.map(x => ({ nome: x.animationName || '?', linha: x.timeline ? x.timeline.constructor.name : 'nenhuma' }));
    });
    ok(anim.length >= 1 && anim.every(a => a.linha === 'ViewTimeline'),
       'a abertura é uma animação de ViewTimeline do CSS (sem JS)', JSON.stringify(anim));

    ok(erros.length === 0, 'nenhum erro de JS na página', erros.join(' | '));
    await ctx.close();
  }

  // 3. movimento reduzido: tela aberta e título legível
  console.log('\n--- prefers-reduced-motion: reduce ---');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await naPista(page, 0.2);
  const red = await page.evaluate(() => ({
    t: getComputedStyle(document.querySelector('.mb-tampa')).transform,
    op: +getComputedStyle(document.querySelector('.mb-legenda')).opacity,
    visivel: document.querySelector('.mb-tela').getBoundingClientRect().height > 100,
  }));
  ok(red.t === 'none', 'a tampa fica sem transform (tela aberta)', red.t);
  ok(red.op === 1, 'o título fica legível (opacidade 1)', String(red.op));
  ok(red.visivel, 'a tela da extensão está visível');
  await ctx.close();

  await browser.close();
  console.log('\n' + (falhas === 0 ? 'TODAS AS VERIFICAÇÕES PASSARAM' : falhas + ' VERIFICAÇÃO(ÕES) FALHARAM'));
  process.exit(falhas === 0 ? 0 : 1);
})();
