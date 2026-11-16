/**
 * Prova que o vídeo da home aparece — desktop e celular.
 *
 * Regressão que eu mesmo causei na correção do DASH-01: ao trocar o
 * onerror inline por addEventListener, usei `capture: true`. Um <video> tem
 * vários <source>, e o que não casa com o `media` falha sozinho (normal). Com
 * capture, esse erro de um source chegava ao listener e escondia o vídeo
 * inteiro. O onerror antigo ficava NO <video> e só dispara quando nenhum
 * source toca.
 *
 * Uso (com o backend em pé): node audit/harness/home-video.js
 */
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:3000';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  for (const [nome, vp] of [['desktop', { width: 1280, height: 800 }], ['celular', { width: 390, height: 844 }]]) {
    const page = await (await browser.newContext({ viewport: vp, locale: 'pt-BR' })).newPage();
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const v = document.querySelector('video[data-hide-on-error]');
      if (!v) return { achou: false };
      const cs = getComputedStyle(v);
      return {
        achou: true,
        display: cs.display,
        visivel: v.offsetParent !== null && v.getBoundingClientRect().width > 0,
        largura: Math.round(v.getBoundingClientRect().width),
        temNoVideo: !!v.parentElement?.classList.contains('no-video'),
        prontidao: v.readyState,          // >=1 = metadados carregados
        src: v.currentSrc.split('/').pop(),
      };
    });
    console.log(nome.padEnd(8), JSON.stringify(r));
    if (!r.achou || r.display === 'none' || r.temNoVideo) { console.error('FALHOU em ' + nome); process.exitCode = 1; }
  }
  await browser.close();
})().catch(e => { console.error('QUEBROU:', e.message); process.exit(1); });
