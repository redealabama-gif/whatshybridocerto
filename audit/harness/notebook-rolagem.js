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
// p do briefing: -rect.top / (offsetHeight - innerHeight)
async function emP(page, P) {
  await page.evaluate((pp) => {
    const s = document.querySelector('#mostra');
    window.scrollTo({ top: s.offsetTop + (s.offsetHeight - innerHeight) * pp, behavior: 'instant' });
  }, P);
  await page.waitForTimeout(220);
}
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
    // O .mb-rabo foi REMOVIDO: so existia porque a tampa transbordava a
    // secao quando o notebook rolava solto. Com o palco `sticky` ela
    // nunca sai do palco, e o rabo virava um vao preto de 90vh.
    ok(!lugar.rabo, 'o vão vazio .mb-rabo não existe mais');
    // le com o pin ATIVO: antes disso o palco ainda esta no fluxo
    await emP(page, 0.5);
    const palco = await page.evaluate(() => {
      const e = document.querySelector('.mb-palco');
      return { pos: getComputedStyle(e).position, alt: Math.round(e.getBoundingClientRect().height),
               top: Math.round(e.getBoundingClientRect().top),
               z: getComputedStyle(e).zIndex,
               zNav: document.querySelector('.navbar') ? +getComputedStyle(document.querySelector('.navbar')).zIndex : 0 };
    });
    ok(palco.pos === 'sticky', 'o palco é sticky (o notebook fica parado enquanto rola)', palco.pos);
    // o palco agora comeca ABAIXO do header: 100svh - header.
    const hdr = await page.evaluate(() => {
      const n = document.querySelector('.navbar');
      return n ? Math.round(n.getBoundingClientRect().height) : 0;
    });
    ok(Math.abs(palco.alt - (vp.height - hdr)) < 10, 'o palco tem 100svh menos o header',
       palco.alt + 'px de ' + (vp.height - hdr));
    ok(Math.abs(palco.top - hdr) < 3, 'o palco cola logo abaixo do header', 'top ' + palco.top + ', header ' + hdr);
    ok(+palco.z > palco.zNav, 'o palco pinta acima do header fixo', 'palco z=' + palco.z + ', navbar z=' + palco.zNav);

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

    // AS 78 TECLAS
    const teclas = await page.evaluate(() => document.querySelectorAll('.mb-fila .mb-k, .mb-setas .mb-k').length);
    ok(teclas === 78, 'o teclado tem as 78 teclas da fonte', teclas + ' teclas');

    // O ENCAIXE: base e tampa nascem da MESMA largura; a tampa so fica
    // maior por causa do scaleX da animacao. Fixar 80% na base, como eu
    // tinha feito, contava o mesmo efeito duas vezes (dava 0,60).
    await naPista(page, 0.35);
    const t1 = await caixa(page, '.mb-casca'), b1 = await caixa(page, '.mb-base');
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
    // 43vw: o conjunto inteiro tem de caber no palco de 100vh junto com
    // o titulo. O painel FINAL e que ocupa ~90vw, por escala.
    // No celular o corpo e proporcionalmente maior de proposito: a 43vw
    // num aparelho de 390px a captura seria ilegivel.
    // a referencia tem a base em 31% da janela; o celular e maior de
    // proposito, senao a captura ficaria ilegivel.
    const faixa = vp.width <= 860 ? [0.60, 0.85] : [0.28, 0.36];
    ok(fatia > faixa[0] && fatia < faixa[1],
       'o corpo ocupa entre ' + (faixa[0]*100) + '% e ' + (faixa[1]*100) + '% da largura da janela',
       (fatia * 100).toFixed(0) + '%');

    // [1] ENCAIXE: a base tem de SOBREPOR a borda de baixo da tampa.
    // Sem isso a tela "flutua acima do teclado, sem conexao fisica".
    const enc = await page.evaluate(() => {
      const t = document.querySelector('.mb-casca').getBoundingClientRect();
      const b = document.querySelector('.mb-base').getBoundingClientRect();
      const zt = +getComputedStyle(document.querySelector('.mb-casca')).zIndex;
      const zf = 0;
      const zb = +getComputedStyle(document.querySelector('.mb-base')).zIndex;
      const barra = document.querySelector('.mb-barra');
      return { vao: Math.round(b.top - t.bottom), zt, zb, zf,
               barra: barra ? barra.getBoundingClientRect().width / b.width : 0 };
    });
    const B = b1.w;
    ok(enc.vao <= 0 && -enc.vao / B > .012 && -enc.vao / B < .035,
       'a base sobrepõe ~0,02B da borda de baixo da tampa (nada flutua)',
       (enc.vao / B).toFixed(3) + 'B');
    ok(t1.w / B > 1.18 && t1.w / B < 1.32, 'o topo da tampa tem ~1,25B', (t1.w / B).toFixed(3) + 'B');
    ok(enc.zb > enc.zt, 'a base pinta na frente da CASCA', 'base z=' + enc.zb + ', casca z=' + enc.zt);
    // O z-index da foto sobe em DEGRAU depois de 25% do progresso: no
    // repouso ela fica atras da base (nada dela cobre o teclado), e so
    // ao deslizar passa para a frente. Por isso ha duas medidas.
    // TESTE DE CAMADA POR elementsFromPoint, nao por z-index.
    // Eu checava `getComputedStyle().zIndex` e via 4 — numero que nao
    // significa NADA dentro de contexto de empilhamento. O z-index da
    // foto estava preso em `.mb-area` (que tinha `perspective`) e a
    // base pintava por cima. So o hit-test no centro do teclado pega
    // isso: la o primeiro elemento era `mb-k`, uma tecla.
    const noTeclado = async (P) => {
      await emP(page, P);
      return page.evaluate(() => {
        const k = document.querySelector('.mb-poco').getBoundingClientRect();
        const e = document.elementsFromPoint(k.left + k.width / 2, k.top + k.height / 2)[0];
        return e && e.className && typeof e.className === 'string' ? e.className.trim().split(/\s+/)[0] : 'nada';
      });
    };
    const daBase = (n) => ['mb-k', 'mb-fila', 'mb-poco', 'mb-base', 'mb-teclado', 'mb-setas'].includes(n);
    const daFoto = (n) => ['mb-foto', 'mb-tela'].includes(n);
    const r0 = await noTeclado(0);
    ok(daBase(r0), 'em p=0 o teclado está NA FRENTE (a foto parece atrás)', r0);
    for (const P of [0.45, 0.60, 0.75, 0.90, 1.00]) {
      const r = await noTeclado(P);
      ok(daFoto(r), 'em p=' + P.toFixed(2) + ' a FOTO cobre o centro do teclado', r);
    }
    ok(enc.barra > 0.74 && enc.barra < 0.86, 'a faixa da dobradiça tem ~0,80B', (enc.barra * 100).toFixed(0) + '%');
    // [1] o screenshot preenche a area interna do bezel: os dois
    // trapezios tem de ser CONCENTRICOS (mesmo pivo de rotacao).
    // volta para o repouso: a checagem de z-index acima deixou a pagina
    // em 0,7, onde a foto ja deslizou e cresceu.
    await naPista(page, 0.3);
    const conc = await page.evaluate(() => {
      const c = document.querySelector('.mb-casca').getBoundingClientRect();
      const f = document.querySelector('.mb-foto').getBoundingClientRect();
      const i = document.querySelector('.mb-tela');
      return { preto: (c.width - f.width) / 2, B: document.querySelector('.mb-base').getBoundingClientRect().width,
               razao: Math.abs(i.offsetWidth / i.offsetHeight - i.naturalWidth / i.naturalHeight) };
    });
    ok(Math.abs(conc.preto) / conc.B < .01, 'o screenshot e a casca são concêntricos (sem preto nas laterais)',
       (conc.preto / conc.B).toFixed(3) + 'B');
    ok(conc.razao < .02, 'a área do display tem a razão exata da imagem (nada cortado)', conc.razao.toFixed(3));

    // [2] PROFUNDIDADE: casca de alumínio e bezel preto são camadas
    // distintas; sem elas a tela é "só o print com um contorno fino".
    const camadas = await page.evaluate(() => {
      const cor = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).backgroundColor : null; };
      const lum = (c) => { const m = (c || '').match(/\d+/g); return m ? (+m[0] * .2126 + +m[1] * .7152 + +m[2] * .0722) : -1; };
      return { casca: lum(cor('.mb-casca')), bezel: lum(cor('.mb-corpo')), poco: lum(cor('.mb-poco')) };
    });
    ok(camadas.casca > camadas.bezel + 15, 'a casca de alumínio é mais clara que o bezel preto',
       'casca ' + camadas.casca.toFixed(0) + ' vs bezel ' + camadas.bezel.toFixed(0));
    ok(camadas.poco >= 0 && camadas.poco < 25, 'o teclado fica num poço escuro rebaixado',
       'luminância ' + camadas.poco.toFixed(0));

    // [5] os 12 ícones da fileira F, em SVG (glifo de fonte vira emoji)
    const icones = await page.evaluate(() =>
      document.querySelectorAll('.mb-fila')[0].querySelectorAll('.mb-ico').length);
    ok(icones === 12, 'as 12 teclas F têm ícone em SVG', icones + ' ícones');

    // [6] fundo preto quase total na seção
    const fundo = await page.evaluate(() => {
      const e = document.querySelector('#mostra');
      return getComputedStyle(e).backgroundImage.includes('gradient');
    });
    ok(fundo, 'a seção tem fundo próprio escuro (sem as linhas da página)');

    // O GESTO: o teclado sai pelo topo e a tampa fica.
    let baseCedo = null;
    for (const f of [0.25, 0.3, 0.35, 0.4, 0.45]) {
      await naPista(page, f);
      const c = await caixa(page, '.mb-base');
      if (c.b > 0 && c.t < vp.height) { baseCedo = c; break; }
    }
    baseCedo = baseCedo || await caixa(page, '.mb-base');
    await emP(page, 0.92);
    const baseTarde = await caixa(page, '.mb-base'), tampaTarde = await caixa(page, '.mb-foto');
    ok(baseCedo.b > 0 && baseCedo.t < vp.height, 'o teclado aparece na janela durante a montagem',
       'topo ' + baseCedo.t + ' fundo ' + baseCedo.b);
    // Com o palco fixo o teclado NAO sai mais pelo topo: ele fica e e
    // coberto pela foto. Era o gesto antigo, e era o errado.
    ok(baseTarde.b > 0 && baseTarde.t < vp.height, 'no fim o teclado continua no palco (coberto, não some)',
       'topo ' + baseTarde.t + ' fundo ' + baseTarde.b);
    ok(tampaTarde.b > 0 && tampaTarde.t < vp.height, 'no fim a FOTO continua na janela',
       'topo ' + tampaTarde.t + ' fundo ' + tampaTarde.b);
    const fim = await page.evaluate(() => {
      const f = document.querySelector('.mb-foto').getBoundingClientRect();
      return +(f.width / innerWidth * 100).toFixed(1);
    });
    ok(fim >= 88 && fim <= 98, 'em p=1 o painel plano ocupa ~90-96vw', fim + 'vw');

    // A tampa nao pode cair em cima do bloco 01.
    const invade = await page.evaluate(async () => {
      const s = document.querySelector('#mostra'), h = document.querySelector('#how');
      let pior = -1e9;
      for (let i = 0; i <= 10; i++) {
        const f = i / 10;
        window.scrollTo({ top: s.offsetTop - innerHeight + (s.offsetHeight + innerHeight) * f, behavior: 'instant' });
        await new Promise((r) => requestAnimationFrame(r));
        const t = document.querySelector('.mb-foto').getBoundingClientRect();
        pior = Math.max(pior, Math.round(t.bottom + scrollY) - h.offsetTop);
      }
      return pior;
    });
    ok(invade <= 0, 'a foto nunca entra no bloco 01', invade > 0 ? 'invade ' + invade + 'px' : 'folga de ' + (-invade) + 'px');

    // A tampa muda de verdade ao longo da pista.
    const estados = [];
    for (const f of [0.3, 0.5, 0.7, 0.9]) { await naPista(page, f); estados.push((await caixa(page, '.mb-foto')).absT + '/' + (await caixa(page, '.mb-foto')).w); }
    ok(new Set(estados).size >= 3, 'a foto muda de posição e tamanho ao longo da pista',
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
        window.scrollTo({ top: ini + (fim - ini) * (i / 40), behavior: 'instant' });
        if (++i <= 40) requestAnimationFrame(f); else res(); })(performance.now()); });
      d.shift(); const o = [...d].sort((a, b) => a - b);
      return { p50: +o[(o.length * .5) | 0].toFixed(1), p95: +o[(o.length * .95) | 0].toFixed(1) };
    });
    const mostrar = (v) => page.evaluate((x) => { document.querySelector('.mb-conjunto').style.visibility = x ? '' : 'hidden'; }, v);
    const meio = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    // CURTO-CIRCUITO: 5 pares sempre faziam esta checagem sozinha levar
    // quase uma hora neste conteiner. Dois pares que ja concordam
    // bastam; o terceiro so entra para desempatar.
    await varre();
    const cs = [], ss = [];
    for (let i = 0; i < 3; i++) {
      await mostrar(true);  cs.push(await varre());
      await mostrar(false); ss.push(await varre());
      if (i >= 1 && cs[0].p50 === cs[1].p50 && ss[0].p50 === ss[1].p50) break;
    }
    await mostrar(true);
    const com = { p50: meio(cs.map((x) => x.p50)), p95: meio(cs.map((x) => x.p95)) };
    const sem = { p50: meio(ss.map((x) => x.p50)), p95: meio(ss.map((x) => x.p95)) };
    // Tolerancia de UM quadro (16,7ms a 60Hz). Neste conteiner a leitura
    // anda em degraus de um quadro mesmo com o notebook escondido — com
    // 6 amostras pareadas os dois lados deram 16,7ms cravado. Exigir
    // menos que isso seria medir o conteiner, nao o codigo.
    ok(com.p50 <= sem.p50 + 17, 'o notebook não piora o p50 do trecho em mais de um quadro', 'com ' + com.p50 + 'ms, sem ' + sem.p50 + 'ms');
    ok(com.p95 <= sem.p95 * 1.25 + 20, 'o notebook não piora o p95 do trecho em mais de 25%', 'com ' + com.p95 + 'ms, sem ' + sem.p95 + 'ms');

    // [5] a casca fica PARADA; so a foto anima
    const parada = await page.evaluate(() => document.querySelector('.mb-casca').getAnimations().length);
    ok(parada === 0, 'a casca da tampa não anima (fica parada, ângulo constante)', parada + ' animações');
    const anim = await page.evaluate(() => document.querySelector('.mb-foto').getAnimations()
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
    anims: document.querySelector('.mb-foto').getAnimations().length,
    alturaTela: Math.round(document.querySelector('.mb-tela').getBoundingClientRect().height),
    tecladoVisivel: document.querySelector('.mb-base').getBoundingClientRect().height > 50,
  }));
  ok(red.anims === 0, 'a foto não anima (notebook montado e legível)', red.anims + ' animações');
  ok(red.alturaTela > 100, 'a tela da extensão está visível', red.alturaTela + 'px');
  ok(red.tecladoVisivel, 'o teclado continua na tela');
  await ctx.close();

  await browser.close();
  console.log('\n' + (falhas === 0 ? 'TODAS AS VERIFICAÇÕES PASSARAM' : falhas + ' VERIFICAÇÃO(ÕES) FALHARAM'));
  process.exit(falhas === 0 ? 0 : 1);
})();
