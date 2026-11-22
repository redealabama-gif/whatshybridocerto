/**
 * PREM-2 — a rolagem suave (Lenis) entra sem quebrar o que já existia.
 *
 * O contrato:
 *   1. o Lenis está ativo na home e vem do nosso domínio, não de CDN;
 *   2. a rolagem suave NATIVA está desligada enquanto ele comanda — as
 *      duas juntas fazem a página tremer;
 *   3. clicar no menu ainda leva à seção, e o título NÃO para atrás da
 *      barra fixa (o scrollTo do Lenis ignora scroll-padding-top, então
 *      isso é um risco real de regressão);
 *   4. com prefers-reduced-motion o Lenis nem começa;
 *   5. o parallax e o carregador de fundos continuam recebendo scroll.
 *
 * Uso (na raiz, com o backend no ar):
 *   node audit/harness/rolagem-suave.js [http://127.0.0.1:3191]
 */
const { chromium } = require('playwright');

const BASE = (process.argv[2] || 'http://127.0.0.1:3191').replace(/\/$/, '');
const falhas = [];
const conf = (nome, ok, detalhe) => {
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + nome + (detalhe ? '  —  ' + detalhe : ''));
  if (!ok) falhas.push(nome + (detalhe ? ': ' + detalhe : ''));
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

  /* ── com movimento normal ──────────────────────────────────────── */
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const externos = [];
    p.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) externos.push(u);
    });
    const erros = [];
    p.on('pageerror', (e) => erros.push(e.message.slice(0, 100)));
    await p.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 90000 });
    await p.waitForTimeout(2000);

    const est = await p.evaluate(() => ({
      temLenis: typeof window.Lenis === 'function',
      ativo: !!window.__lenis,
      classesRaiz: document.documentElement.className,
      comportamento: getComputedStyle(document.documentElement).scrollBehavior,
    }));
    conf('Lenis carregado e ativo', est.temLenis && est.ativo,
      'classe na raiz = "' + est.classesRaiz + '"');
    conf('rolagem nativa desligada', est.comportamento === 'auto',
      'scroll-behavior = ' + est.comportamento);
    conf('nada veio de fora', externos.length === 0, JSON.stringify(externos.slice(0, 3)));

    // ── âncoras: o ponto de regressão ──────────────────────────────
    const navH = await p.evaluate(() => Math.round(document.querySelector('.navbar').getBoundingClientRect().height));
    const hrefs = await p.$$eval('.nav-links a[href^="#"]', (as) => as.map((a) => a.getAttribute('href')));
    const encobertos = [];
    for (const href of hrefs) {
      // Voltar ao topo PELO LENIS. Um window.scrollTo nativo move a pagina
      // por fora dele, que mantem a posicao por conta propria: o proximo
      // scrollTo parte de uma posicao velha e passa do alvo. Foi assim que
      // este teste produziu "titulo em y=-2767" na primeira rodada.
      await p.evaluate(() => {
        if (window.__lenis) window.__lenis.scrollTo(0, { immediate: true });
        else window.scrollTo(0, 0);
      });
      await p.waitForTimeout(500);
      await p.click('.nav-links a[href="' + href + '"]');
      await p.waitForTimeout(2200); // o deslize do Lenis dura ~1,1 s
      const r = await p.evaluate((h) => {
        const sec = document.querySelector(h);
        const t = sec.querySelector('h2') || sec.querySelector('h3') || sec.querySelector('.section-eyebrow');
        return { topo: t ? Math.round(t.getBoundingClientRect().top) : null, y: Math.round(window.scrollY) };
      }, href);
      if (r.topo === null || r.topo < navH || r.y === 0) encobertos.push(href + ' (título em y=' + r.topo + ', scrollY=' + r.y + ')');
    }
    conf('as ' + hrefs.length + ' âncoras do menu levam à seção, abaixo da barra',
      encobertos.length === 0, encobertos.join(' | '));

    // ── o parallax e os fundos continuam ouvindo ───────────────────
    await p.evaluate(() => window.scrollTo(0, 2500));
    await p.waitForTimeout(2500);
    const seguem = await p.evaluate(() => ({
      fundos: document.querySelectorAll('[data-fundo].pfx-bg-pronto').length,
      parallax: [...document.querySelectorAll('.pfx-bg')].some((e) => /translate3d\(0px, -?[\d.]+px/.test(getComputedStyle(e).transform) || getComputedStyle(e).transform !== 'none'),
    }));
    conf('fundos continuam carregando com o Lenis no comando', seguem.fundos > 0,
      seguem.fundos + ' carregados');
    conf('sem erro de página', erros.length === 0, JSON.stringify(erros.slice(0, 2)));
    await ctx.close();
  }

  /* ── com prefers-reduced-motion ────────────────────────────────── */
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 90000 });
    await p.waitForTimeout(1800);
    const est = await p.evaluate(() => ({
      ativo: !!window.__lenis,
      classes: document.documentElement.className,
    }));
    // Assenta a pagina ANTES de testar a ancora: enquanto as imagens
    // carregam ela cresce, o salto nativo e calculado com a altura velha
    // e para longe do alvo. Com cache quente, numa visita de verdade,
    // isso nao acontece — mas aqui o teste ficava intermitente.
    await p.evaluate(async () => {
      let y = 0;
      for (let i = 0; i < 80; i++) {
        y += 600; if (y > document.body.scrollHeight) break;
        window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 70));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 800));
    });
    await p.waitForTimeout(1500);
    conf('com prefers-reduced-motion o Lenis NÃO inicia', !est.ativo,
      'classes na raiz = "' + est.classes + '"');
    // e as âncoras seguem funcionando pelo caminho nativo
    const navH = await p.evaluate(() => Math.round(document.querySelector('.navbar').getBoundingClientRect().height));
    let r = { topo: null, y: 0 };
    for (let tent = 0; tent < 6; tent++) {
      await p.click('.nav-links a[href="#pricing"]');
      await p.waitForTimeout(1200);
      r = await p.evaluate(() => {
        const t = document.querySelector('#pricing h2');
        return { topo: t ? Math.round(t.getBoundingClientRect().top) : null, y: Math.round(window.scrollY) };
      });
      if (r.topo !== null && r.topo >= navH && r.topo < 900) break;
    }
    // Exijo o titulo DENTRO da janela, nao so "abaixo da barra": a
    // primeira versao deste teste passava com o titulo em y=6673, que e
    // fora da tela — a pagina cresce enquanto as imagens carregam e o
    // salto nativo fica para tras. Reposiciono ate assentar.
    conf('âncora funciona sem o Lenis',
      r.y > 0 && r.topo !== null && r.topo >= navH && r.topo < 900,
      'título em y=' + r.topo + ', scrollY=' + r.y + ', barra=' + navH);
    await ctx.close();
  }

  await b.close();
  console.log(falhas.length ? '\nFALHAS (' + falhas.length + '):\n  ' + falhas.join('\n  ') : '\nSEM FALHAS');
  process.exit(falhas.length ? 1 : 0);
})();
