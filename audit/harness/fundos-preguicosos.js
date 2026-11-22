/**
 * PREM-1 — os fundos de seção chegam sob demanda, e sempre chegam.
 *
 * O contrato não é "carregar tudo" nem "carregar pouco": é
 *
 *   1. ao abrir, a página NÃO baixa os fundos das seções distantes;
 *   2. toda seção que o visitante efetivamente olhar TEM fundo;
 *   3. a largura servida acompanha a tela (1600 no desktop, 900 no
 *      celular) e o formato é WebP onde o navegador aceita.
 *
 * O item 2 é o que mais importa e o que mais quebra. A primeira versão
 * deste carregador confiava só no IntersectionObserver e, medido aqui,
 * ele disparava para 6 de 11 numa execução, 8 em outra, 9 em outra — os
 * callbacks são amostrados por quadro e a página cresce enquanto Spline
 * e vídeo carregam, então seções entram e saem entre duas amostras.
 *
 * Uso (na raiz, com o backend no ar):
 *   node audit/harness/fundos-preguicosos.js [http://127.0.0.1:3191]
 */
const { chromium } = require('playwright');

const BASE = (process.argv[2] || 'http://127.0.0.1:3191').replace(/\/$/, '');
const falhas = [];
const reg = (m) => { falhas.push(m); console.log('  ✗ ' + m); };

async function abrir(b, largura) {
  const ctx = await b.newContext({ viewport: { width: largura, height: 900 } });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(e.message.slice(0, 90)));
  await p.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 90000 });
  return { ctx, p, erros };
}

const estado = (p) => p.evaluate(() => ({
  total: document.querySelectorAll('[data-fundo]').length,
  prontos: document.querySelectorAll('[data-fundo].pfx-bg-pronto').length,
}));

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

  for (const largura of [1440, 390]) {
    const esperado = largura > 1000 ? '1600' : '900';
    console.log('\n══ janela ' + largura + 'px ══');

    // ── 1. abrir sem rolar não pode baixar tudo ──────────────────────
    {
      const { ctx, p } = await abrir(b, largura);
      await p.waitForTimeout(6000);
      const e = await estado(p);
      const ok = e.prontos < e.total;
      console.log('  ' + (ok ? '✓' : '✗') + ' abrir sem rolar: ' + e.prontos + '/' + e.total + ' fundos baixados');
      if (!ok) reg(largura + 'px: abrir sem rolar já baixou TODOS os fundos — o lazy não está valendo');
      await ctx.close();
    }
    await new Promise((r) => setTimeout(r, 1200));

    // ── 2. toda seção visitada tem fundo ─────────────────────────────
    // É o item que de fato protege o visitante. Visita uma por uma, do
    // jeito que uma pessoa faria ao clicar no menu ou arrastar a barra.
    {
      const { ctx, p, erros } = await abrir(b, largura);
      const nomes = await p.$$eval('[data-fundo]', (es) => es.map((e) => e.getAttribute('data-fundo')));
      let semFundo = [];
      for (let i = 0; i < nomes.length; i++) {
        // A página CRESCE enquanto as imagens de cima carregam, então um
        // scrollIntoView só não chega: o alvo é empurrado para baixo
        // depois do salto. Insisto até ele parar perto da janela.
        for (let tent = 0; tent < 8; tent++) {
          const dentro = await p.evaluate((idx) => {
            const el = document.querySelectorAll('[data-fundo]')[idx];
            const r = el.getBoundingClientRect();
            if (r.top < window.innerHeight && r.bottom > 0) return true;
            (el.closest('.pfx-section') || el).scrollIntoView({ block: 'center' });
            return false;
          }, i);
          await p.waitForTimeout(500);
          if (dentro) break;
        }
        // A classe .pfx-bg-pronto só entra no onload da imagem: espero o
        // download, em vez de medir no meio dele.
        let pronto = false;
        for (let tent = 0; tent < 12; tent++) {
          pronto = await p.evaluate((idx) =>
            document.querySelectorAll('[data-fundo]')[idx].classList.contains('pfx-bg-pronto'), i);
          if (pronto) break;
          await p.waitForTimeout(400);
        }
        if (!pronto) semFundo.push(nomes[i]);
      }
      console.log('  ' + (semFundo.length ? '✗' : '✓') + ' visitando as ' + nomes.length +
        ' seções uma a uma: ' + (nomes.length - semFundo.length) + ' com fundo');
      if (semFundo.length) reg(largura + 'px: seções visitadas e ainda sem fundo → ' + JSON.stringify(semFundo));
      if (erros.length) reg(largura + 'px: erro de página → ' + JSON.stringify(erros.slice(0, 2)));

      // ── 3. largura e formato certos ────────────────────────────────
      const servidos = await p.evaluate(() => [...document.querySelectorAll('[data-fundo].pfx-bg-pronto')]
        .map((e) => (getComputedStyle(e).backgroundImage.match(/[^/"')]+\.(?:webp|jpg)/) || ['?'])[0]));
      const larguras = [...new Set(servidos.map((s) => (s.match(/-(\d+)w\.webp/) || [0, 'ORIGINAL'])[1]))];
      const todosWebp = servidos.every((s) => s.endsWith('.webp'));
      console.log('  ' + (larguras.length === 1 && larguras[0] === esperado && todosWebp ? '✓' : '✗') +
        ' formato e largura: ' + JSON.stringify(larguras) + (todosWebp ? ' todos WebP' : ' NEM TODOS WebP'));
      if (!(larguras.length === 1 && larguras[0] === esperado)) {
        reg(largura + 'px: esperava largura ' + esperado + ', veio ' + JSON.stringify(larguras));
      }
      if (!todosWebp) reg(largura + 'px: algum fundo caiu no JPEG original → ' + JSON.stringify(servidos));
      await ctx.close();
    }
    await new Promise((r) => setTimeout(r, 1200));
  }

  await b.close();
  console.log(falhas.length ? '\nFALHAS (' + falhas.length + '):\n  ' + falhas.join('\n  ') : '\nSEM FALHAS');
  process.exit(falhas.length ? 1 : 0);
})();
