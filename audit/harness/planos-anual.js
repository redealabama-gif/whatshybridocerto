/**
 * Verifica a seção de planos no navegador real: 4 cards, textos em respostas,
 * alternador mensal/anual mudando preço + nota + href dos CTAs.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const path2 = require('path');
const RAIZ = path2.join(__dirname, '..', '..', 'whatshybrid-backend', 'public');
const TIPOS = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.json': 'application/json', '.ico': 'image/x-icon' };

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const abs = path.join(RAIZ, p);
  if (!abs.startsWith(RAIZ) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404); return res.end('404');
  }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(abs)] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(res);
});

(async () => {
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();

  const erros = [];
  page.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  // Ruído do ambiente, não defeito da página:
  //  - /config.js é rota do backend; este harness serve só os arquivos de
  //    public/ e não tem como respondê-la;
  //  - js/vendor/cobe.js nunca foi baixado e cai em CDN (SITE-03), que o
  //    proxy da sandbox bloqueia (ERR_TUNNEL_CONNECTION_FAILED).
  const RUIDO = /config\.js|cobe|unpkg|jsdelivr|esm\.sh|ERR_TUNNEL|favicon/i;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (RUIDO.test(t)) return;
    erros.push('console: ' + t);
  });
  page.on('requestfailed', (r) => {
    if (!RUIDO.test(r.url())) erros.push('req falhou: ' + r.url());
  });

  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.locator('#pricing').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);

  const falhas = [];
  const ok = (cond, msg) => { if (!cond) falhas.push(msg); };

  // 1) quatro cards, na ordem, cada um com nome e preço
  const nomes = await page.locator('.pricing-grid .plan h3').allTextContents();
  ok(JSON.stringify(nomes) === JSON.stringify(['Free', 'Starter', 'Pro', 'Business']),
     '1) ordem dos cards: ' + JSON.stringify(nomes));

  // 2) os 4 ficam na MESMA fileira do grid. Usa offsetTop (posição de
  // layout) e não getBoundingClientRect: o card .featured tem
  // transform: scale(1.03) e o rect dele sobe ~19px sem mudar de linha.
  const tops = await page.locator('.pricing-grid .plan').evaluateAll(
    (els) => els.map((e) => e.offsetTop));
  ok(new Set(tops).size === 1, '2) cards em fileiras diferentes (offsetTop=' + tops + ')');

  // 3) nenhuma palavra "token" sobrou na seção de planos
  const textoPlanos = await page.locator('#pricing').innerText();
  ok(!/token/i.test(textoPlanos), '3) ainda fala em token: ' +
     (textoPlanos.match(/.{0,40}token.{0,40}/i) || [''])[0]);

  // 4) as cotas prometidas
  for (const [plano, frase] of [['Starter', '500 respostas da IA por mês'],
                                ['Pro', '2.500 respostas por mês'],
                                ['Business', '10.000 respostas da IA por mês']]) {
    const card = page.locator('.pricing-grid .plan', { has: page.locator('h3', { hasText: new RegExp('^' + plano + '$') }) });
    const t = await card.innerText();
    ok(t.includes(frase), `4) card ${plano} sem "${frase}"`);
  }

  // 5) estado inicial = mensal
  const precoDe = async (plano) => (await page.locator('.pricing-grid .plan', {
    has: page.locator('h3', { hasText: new RegExp('^' + plano + '$') })
  }).locator('.plan-price-value').innerText()).trim();

  ok(await precoDe('Starter') === '49,90', '5) Starter mensal != 49,90');
  ok(await precoDe('Pro') === '99,90', '5) Pro mensal != 99,90');
  ok(await precoDe('Business') === '299,90', '5) Business mensal != 299,90');
  ok(await page.locator('[data-nota-anual]:visible').count() === 0, '5) nota anual visível no mensal');
  ok(await page.locator('[data-cta-plano="pro"]').getAttribute('href') === 'signup.html?plan=pro',
     '5) href do CTA Pro no mensal');

  // 6) clica em Anual
  await page.locator('#pricing-toggle button[data-ciclo="annual"]').click();
  await page.waitForTimeout(250);

  ok(await precoDe('Starter') === '41,58', '6) Starter anual != 41,58');
  ok(await precoDe('Pro') === '83,25', '6) Pro anual != 83,25');
  ok(await precoDe('Business') === '249,92', '6) Business anual != 249,92');
  ok(await precoDe('Free') === '0', '6) Free deixou de ser 0 no anual');
  ok(await page.locator('[data-nota-anual]:visible').count() === 3,
     '6) notas anuais visíveis: ' + await page.locator('[data-nota-anual]:visible').count());
  const notas = await page.locator('[data-nota-anual]').allTextContents();
  ok(notas[0].includes('R$ 499,00') && notas[1].includes('R$ 999,00') && notas[2].includes('R$ 2.999,00'),
     '6) textos das notas: ' + JSON.stringify(notas));
  for (const [plano, esperado] of [['starter', 'signup.html?plan=starter&cycle=annual'],
                                   ['pro', 'signup.html?plan=pro&cycle=annual'],
                                   ['business', 'signup.html?plan=business&cycle=annual']]) {
    const href = await page.locator(`[data-cta-plano="${plano}"]`).getAttribute('href');
    ok(href === esperado, `6) href ${plano}: ${href}`);
  }
  ok(await page.locator('#pricing-toggle button[data-ciclo="annual"]').getAttribute('aria-pressed') === 'true',
     '6) aria-pressed do botão anual');

  // 7) volta pra mensal
  await page.locator('#pricing-toggle button[data-ciclo="monthly"]').click();
  await page.waitForTimeout(250);
  ok(await precoDe('Starter') === '49,90', '7) não voltou pro mensal');
  ok(await page.locator('[data-nota-anual]:visible').count() === 0, '7) nota anual ficou visível');
  ok(await page.locator('[data-cta-plano="starter"]').getAttribute('href') === 'signup.html?plan=starter',
     '7) href não voltou');

  // 8) ?cycle=annual já abre no anual
  await page.goto(base + '/index.html?cycle=annual#pricing', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  ok(await precoDe('Starter') === '41,58', '8) ?cycle=annual não abriu no anual');

  // 9) celular: sem rolagem horizontal
  const mob = await ctx.newPage();
  await mob.goto(base + '/index.html', { waitUntil: 'load' });
  await mob.setViewportSize({ width: 390, height: 844 });
  await mob.locator('#pricing').scrollIntoViewIfNeeded();
  await mob.waitForTimeout(400);
  // O overflow horizontal da PÁGINA já existia antes desta mudança (31-48px,
  // variando conforme a fase da animação de .bg-glow / .hero-mesh /
  // .logo-strip-track). Medido aqui o que ESTA seção causa: nada.
  const overSec = await mob.evaluate(() => {
    const sec = document.getElementById('pricing');
    const w = window.innerWidth;
    const fora = [...sec.querySelectorAll('*')].filter((e) => {
      if (e instanceof SVGElement) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && Math.round(r.right) > w + 1;
    }).map((e) => e.tagName.toLowerCase() + '.' + (e.className || '').toString().trim().split(/\s+/)[0]);
    return { fora, right: Math.round(sec.getBoundingClientRect().right), w };
  });
  ok(overSec.fora.length === 0 && overSec.right <= overSec.w,
     '9) a seção de planos passa da tela no celular: ' + JSON.stringify(overSec));
  const nomesMob = await mob.locator('.pricing-grid .plan h3').allTextContents();
  ok(nomesMob.length === 4, '9) celular não mostra os 4 cards');
  await mob.screenshot({ path: (process.argv[2] || '.') + '/planos-celular.png', fullPage: false });

  // print do desktop no anual
  await page.locator('#pricing').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.locator('#pricing').screenshot({ path: (process.argv[2] || '.') + '/planos-anual.png' });

  console.log('erros de página/console:', erros.length ? erros.join(' | ') : 'nenhum');
  console.log(falhas.length ? 'FALHAS:\n  ' + falhas.join('\n  ') : 'TODAS AS CHECAGENS PASSARAM');
  await browser.close();
  srv.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
