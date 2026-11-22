/**
 * REDESIGN — verificação no navegador real das 9 páginas, em desktop e
 * celular. Mede o que a folha prometeu (em vez de eu olhar a captura e
 * achar), e exercita os componentes que o JavaScript controla.
 *
 * Uso (na raiz, com o backend já no ar):
 *   node audit/harness/redesign-visual.js [http://127.0.0.1:3191] [dir-de-saida]
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = (process.argv[2] || 'http://127.0.0.1:3191').replace(/\/$/, '');
const OUT = process.argv[3] || '/tmp/redesign';
const PAGINAS = ['index.html', 'login.html', 'signup.html', 'dashboard.html', 'help.html',
                 'privacy.html', 'terms.html', 'forgot-password.html', 'reset-password.html'];
const VIEWS = [
  { nome: 'desktop', width: 1440, height: 1000, dsf: 2 },
  { nome: 'mobile',  width: 390,  height: 844,  dsf: 2 },
];

const falhas = [];
const reg = (m) => { falhas.push(m); console.log('  ✗ ' + m); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

  for (const v of VIEWS) {
    const ctx = await b.newContext({
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: v.dsf,
    });
    console.log('\n══ ' + v.nome + ' (' + v.width + 'x' + v.height + ') ══');

    for (const pg of PAGINAS) {
      const page = await ctx.newPage();
      const erros = [], req404 = [];
      page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text().slice(0, 160)); });
      page.on('pageerror', (e) => erros.push('pageerror: ' + e.message.slice(0, 160)));
      page.on('response', (r) => { if (r.status() >= 400) req404.push(r.status() + ' ' + r.url().replace(BASE, '')); });

      await page.goto(BASE + '/' + pg, { waitUntil: 'load' }).catch((e) => erros.push('goto: ' + e.message));
      // rola a página inteira para disparar todo .reveal e todo lazy-load
      await page.evaluate(async () => {
        const h = document.body.scrollHeight;
        for (let y = 0; y < h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
        window.scrollTo(0, 0);
      }).catch(() => {});
      await page.waitForTimeout(1200);

      const m = await page.evaluate(async () => {
        await document.fonts.ready;
        const cs = (el, p) => el ? getComputedStyle(el)[p] : null;
        const fams = new Set();
        const tams = new Set();
        const raios = new Set();
        document.querySelectorAll('body *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return;
          const s = getComputedStyle(el);
          if (el.textContent && el.textContent.trim() && el.children.length === 0) {
            fams.add(s.fontFamily.split(',')[0].replace(/['"]/g, ''));
            tams.add(s.fontSize);
          }
          ['borderTopLeftRadius'].forEach((k) => { if (s[k] !== '0px') raios.add(s[k]); });
        });
        const h1 = document.querySelector('h1');
        const sec = document.querySelector('[data-sec]');
        return {
          fontesCarregadas: [...new Set([...document.fonts].map((f) => f.family.replace(/['"]/g, '')))].sort(),
          familiasUsadas: [...fams].sort(),
          tamanhos: [...tams].sort((a, b) => parseFloat(a) - parseFloat(b)),
          raios: [...raios].sort(),
          h1: h1 ? { px: cs(h1, 'fontSize'), fam: cs(h1, 'fontFamily').split(',')[0].replace(/['"]/g, '') } : null,
          cabecalho: sec ? {
            display: cs(sec, 'display'),
            textAlign: cs(sec, 'textAlign'),
            cols: cs(sec, 'gridTemplateColumns'),
          } : null,
          // Estouro horizontal medido do jeito que o visitante sente: a pagina
          // ROLA de lado? scrollWidth - innerWidth nao serve — enfeites
          // position:fixed inflam scrollWidth sem criar rolagem nenhuma, e foi
          // isso que me fez acusar estouro em pagina que nao estoura.
          // ATENCAO: `scroll-behavior: smooth` (css/futuristic.css:32) faz
          // o scrollTo NAO mover na hora. A primeira versao desta medida
          // lia scrollX logo em seguida e recebia 0 — eu relatei "zero
          // rolagem horizontal" em tres PRs com base nisso, e era falso:
          // medindo certo, a pagina rolava 144 px de lado. Forco `auto` e
          // espero dois quadros antes de ler.
          estouro: (() => {
            const raiz = document.documentElement;
            const antes = raiz.style.scrollBehavior;
            raiz.style.setProperty('scroll-behavior', 'auto', 'important');
            const x0 = window.scrollX;
            window.scrollTo(99999, window.scrollY);
            const max = window.scrollX;
            window.scrollTo(x0, window.scrollY);
            raiz.style.scrollBehavior = antes;
            return max;
          })(),
          culpados: (() => {
            const lim = window.innerWidth;
            const out = [];
            document.querySelectorAll('body *').forEach((el) => {
              const r = el.getBoundingClientRect();
              if (!r.width || !r.height) return;
              if (r.right > lim + 1 || r.left < -1) {
                if ([...el.children].some((c) => {
                  const cr = c.getBoundingClientRect();
                  return cr.right > lim + 1 || cr.left < -1;
                })) return;           // só o nó mais interno
                out.push((el.tagName.toLowerCase() +
                  (el.id ? '#' + el.id : '') +
                  (el.className && typeof el.className === 'string'
                    ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '')) +
                  ' [' + Math.round(r.left) + '→' + Math.round(r.right) + ']');
              }
            });
            return [...new Set(out)].slice(0, 6);
          })(),
          // gradiente de texto ainda ativo em algum título?
          gradTitulo: [...document.querySelectorAll('.text-gradient')]
            .filter((e) => getComputedStyle(e).webkitTextFillColor === 'rgba(0, 0, 0, 0)').length,
          italico: [...document.querySelectorAll('.text-gradient')]
            .filter((e) => getComputedStyle(e).fontStyle === 'italic').length,
          totalGrad: document.querySelectorAll('.text-gradient').length,
        };
      }).catch((e) => ({ erro: e.message }));

      const arq = path.join(OUT, pg.replace('.html', '') + '-' + v.nome + '.png');
      await page.screenshot({ path: arq, fullPage: pg === 'index.html' }).catch(() => {});

      console.log('  ' + pg.padEnd(22) +
        ' tipos=' + (m.tamanhos || []).length +
        ' raios=' + (m.raios || []).length +
        ' h1=' + (m.h1 ? m.h1.px + '/' + m.h1.fam : '-') +
        ' estouro=' + m.estouro + 'px' +
        ' erros=' + erros.length + (req404.length ? ' http>=400=' + req404.length : ''));
      if (m.erro) reg(pg + '/' + v.nome + ': avaliação falhou: ' + m.erro);
      if (erros.length) reg(pg + '/' + v.nome + ': console → ' + erros.slice(0, 3).join(' | '));
      if (req404.length) reg(pg + '/' + v.nome + ': recurso faltando → ' + req404.slice(0, 3).join(' | '));
      if (m.estouro > 1) reg(pg + '/' + v.nome + ': estouro horizontal de ' + m.estouro + 'px → ' + JSON.stringify(m.culpados));
      if (pg === 'index.html') {
        if (m.gradTitulo) reg('index/' + v.nome + ': ' + m.gradTitulo + ' de ' + m.totalGrad + ' .text-gradient ainda com texto transparente');
        if (m.italico !== m.totalGrad) reg('index/' + v.nome + ': só ' + m.italico + ' de ' + m.totalGrad + ' .text-gradient em itálico');
        if (!m.cabecalho) reg('index/' + v.nome + ': nenhum [data-sec] encontrado');
        else console.log('       cabeçalho 01: display=' + m.cabecalho.display + ' align=' + m.cabecalho.textAlign + ' cols=' + m.cabecalho.cols);
        if (!(m.fontesCarregadas || []).includes('JetBrains Mono'))
          reg('index/' + v.nome + ': JetBrains Mono não entrou em document.fonts → ' + JSON.stringify(m.fontesCarregadas));
        console.log('       famílias em uso: ' + JSON.stringify(m.familiasUsadas));
        console.log('       raios em uso:    ' + JSON.stringify(m.raios));
        console.log('       ' + (m.tamanhos || []).length + ' tamanhos: ' + JSON.stringify(m.tamanhos));
      }
      await page.close();
    }
    await ctx.close();
  }

  // ── componentes que o JS controla, só no desktop ──
  console.log('\n══ componentes (index.html, 1440) ══');
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message.slice(0, 160)));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // 1. alternador mensal/anual muda os preços
  const precoAntes = await page.$$eval('[data-preco]', (e) => e.map((x) => x.textContent.trim()));
  await page.click('#pricing-toggle button[data-ciclo="annual"]');
  await page.waitForTimeout(500);
  const precoDepois = await page.$$eval('[data-preco]', (e) => e.map((x) => x.textContent.trim()));
  const mudou = JSON.stringify(precoAntes) !== JSON.stringify(precoDepois);
  console.log('  alternador de ciclo: ' + (mudou ? '✓ preços mudaram' : '✗ preços iguais') +
    '  mensal=' + JSON.stringify(precoAntes.slice(0, 4)) + ' anual=' + JSON.stringify(precoDepois.slice(0, 4)));
  if (!mudou) reg('alternador mensal/anual não altera os preços');

  // 2. slider de ROI recalcula.
  // Os ids de saida sao #roi-hours/#roi-cost/#roi-annual e o numero visivel e
  // #roi-input-num (js/landing-revamp.js:124-131). Medir ".roi-value", que nao
  // existe no HTML, so produz null em ambos os lados e uma falha inventada.
  const leROI = () => page.evaluate(() =>
    ['roi-input-num', 'roi-hours', 'roi-cost', 'roi-annual']
      .map((id) => (document.getElementById(id) || {}).textContent || '(sem elemento)'));
  const roiAntes = await leROI();
  await page.$eval('#roi-slider', (el) => {
    el.value = String(Math.round((Number(el.max) + Number(el.min)) / 2) + 37);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }).catch((e) => reg('slider de ROI: ' + e.message));
  await page.waitForTimeout(500);
  const roiDepois = await leROI();
  const roiMudou = JSON.stringify(roiAntes) !== JSON.stringify(roiDepois);
  console.log('  slider de ROI: ' + (roiMudou ? '✓ recalculou' : '✗ não mudou') +
    '\n       antes:  ' + JSON.stringify(roiAntes) + '\n       depois: ' + JSON.stringify(roiDepois));
  if (!roiMudou) reg('slider de ROI não recalcula');

  // 3. FAQ abre e fecha
  // Em vez de perseguir a transicao, espero folgado (1,5 s para uma transicao
  // de 0,4 s) e pergunto o que importa de verdade: o texto da resposta esta
  // alcancavel pelo ponteiro naquele ponto da tela?
  const abriu = await page.evaluate(async () => {
    const esp = (ms) => new Promise((r) => setTimeout(r, ms));
    const it = document.querySelector('.faq-item');
    const resp = it.querySelector('.faq-answer');
    // elementFromPoint usa coordenadas da JANELA: sem trazer o item a vista,
    // o ponto cai fora da tela e devolve null — falha inventada.
    it.scrollIntoView({ block: 'center' });
    await esp(400);
    const alcancavel = () => {
      const r = resp.getBoundingClientRect();
      if (r.height < 4) return false;
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(12, r.height / 2));
      return !!el && (resp === el || resp.contains(el));
    };
    it.querySelector('.faq-question').click();
    await esp(1500);
    const aberto = it.classList.contains('open');
    const alturaResp = resp.getBoundingClientRect().height;
    const visivel = alcancavel();
    it.querySelector('.faq-question').click();
    await esp(1500);
    return { aberto, alturaResp, visivel,
             alturaFechada: resp.getBoundingClientRect().height,
             fechou: !it.classList.contains('open') };
  });
  const faqOk = abriu.aberto && abriu.fechou && abriu.visivel && abriu.alturaResp > 10 && abriu.alturaFechada < 4;
  console.log('  FAQ: ' + (faqOk ? '✓' : '✗') + ' abriu=' + abriu.aberto +
    ' altura=' + Math.round(abriu.alturaResp) + 'px alcançável=' + abriu.visivel +
    ' → fechou=' + abriu.fechou + ' (altura ' + Math.round(abriu.alturaFechada) + 'px)');
  if (!faqOk) reg('FAQ não abre/fecha corretamente');

  // 4. ancoras do menu levam às seções
  const ancoras = await page.$$eval('.nav-links a[href^="#"]', (as) => as.map((a) => a.getAttribute('href')));
  const mortas = await page.evaluate((hs) => hs.filter((h) => !document.querySelector(h)), ancoras);
  console.log('  âncoras do menu: ' + ancoras.length + ' testadas, ' + mortas.length + ' sem destino ' + JSON.stringify(mortas));
  if (mortas.length) reg('âncoras sem destino: ' + mortas.join(', '));

  if (erros.length) reg('erros de página durante os componentes: ' + erros.join(' | '));
  await page.close();

  // ── nav mobile ──
  const ctxM = await b.newContext({ viewport: { width: 390, height: 844 } });
  const pm = await ctxM.newPage();
  await pm.goto(BASE + '/index.html', { waitUntil: 'load' });
  await pm.waitForTimeout(1200);
  // O drawer nao muda de altura: em <=768px ele fica deslocado e transparente
  // (css/futuristic.css:425-446) e a classe .open devolve transform, opacity e
  // pointer-events. A transicao e de 0,25 s; espero 1,5 s e pergunto se um link
  // do menu esta de fato clicavel — que e o contrato, nao a opacidade.
  const navM = await pm.evaluate(async () => {
    const esp = (ms) => new Promise((r) => setTimeout(r, ms));
    const t = document.querySelector('.nav-toggle');
    if (!t) return { erro: 'sem .nav-toggle' };
    const ln = document.querySelector('.nav-links');
    const le = () => {
      const s = getComputedStyle(ln);
      const a = ln.querySelector('a');
      const r = a ? a.getBoundingClientRect() : null;
      const alvo = r && r.height ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      return { open: ln.classList.contains('open'), opacity: s.opacity,
               pe: s.pointerEvents, aria: t.getAttribute('aria-expanded'),
               linkClicavel: !!alvo && (a === alvo || a.contains(alvo)) };
    };
    const antes = le();
    t.click(); await esp(1500);
    const depois = le();
    t.click(); await esp(1500);
    return { antes, depois, fechou: !ln.classList.contains('open'),
             fechado: le() };
  });
  const navOk = !navM.erro && navM.depois.open && Number(navM.depois.opacity) > 0.95
    && navM.depois.pe === 'auto' && navM.depois.aria === 'true'
    && navM.depois.linkClicavel && navM.fechou && !navM.fechado.linkClicavel;
  console.log('  menu no celular: ' + (navM.erro ? '✗ ' + navM.erro : (navOk ? '✓ abriu e fechou' : '✗ falhou')) +
    (navM.erro ? '' : '\n       fechado: ' + JSON.stringify(navM.antes) +
                      '\n       aberto:  ' + JSON.stringify(navM.depois) +
                      '\n       fechado de novo: ' + JSON.stringify(navM.fechado)));
  if (!navOk) reg('menu do celular não abre/fecha');
  await pm.screenshot({ path: path.join(OUT, 'nav-mobile-aberto.png') });
  await pm.close();

  await b.close();
  console.log('\nCapturas em ' + OUT);
  console.log(falhas.length ? '\nFALHAS (' + falhas.length + '):\n  ' + falhas.join('\n  ') : '\nSEM FALHAS');
  process.exit(falhas.length ? 1 : 0);
})();
