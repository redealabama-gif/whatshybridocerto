/**
 * SITE-03 — a landing renderiza o globo e o robô 3D com TODO acesso externo
 * bloqueado?
 *
 * Serve apenas public/ e aborta qualquer requisição que não seja para o
 * servidor local. Se o globo desenhar e o <spline-viewer> montar um canvas
 * nessas condições, os assets estão mesmo auto-hospedados.
 *
 * Dois pedidos externos SOBRAM de propósito e estão listados em RESIDUAIS:
 *
 *   unpkg.com/@splinetool/*-wasm  — o viewer traz 6 URLs cravadas no próprio
 *     bundle minificado e busca esses .wasm sob demanda. Auto-hospedar exigiria
 *     reescrever código de terceiro; a cena renderiza sem eles.
 *   fonts.googleapis.com          — Google Fonts, dependência de CDN anterior
 *     e independente desta correção.
 *
 * Eles são reportados a cada execução, mas não reprovam: o que reprova é
 * qualquer pedido externo FORA dessa lista — aí um asset nosso voltou pro CDN.
 *
 * Uso (na raiz): node audit/harness/landing-sem-cdn.js [dir-para-prints]
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..', 'whatshybrid-backend', 'public');
const SAIDA = process.argv[2] || '.';
const TIPOS = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.json': 'application/json',
  '.ico': 'image/x-icon', '.splinecode': 'application/octet-stream',
};

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end('window.APP_CONFIG={};');
  }
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
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  const externas = [];
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    externas.push(u);
    return route.abort();
  });

  const logs = [];
  page.on('console', (m) => { if (/\[globe\]|\[3D\]/.test(m.text())) logs.push(m.text()); });
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));

  await page.goto(base + '/index.html', { waitUntil: 'load' });

  // Globo: rola até a seção e espera o canvas receber pixels.
  await page.locator('#alcance').scrollIntoViewIfNeeded();
  await page.waitForTimeout(3500);
  const globo = await page.evaluate(() => {
    const cv = document.querySelector('#alcance canvas');
    if (!cv) return { ok: false, motivo: 'sem <canvas> na seção do globo' };
    const gl = cv.getContext('webgl') || cv.getContext('webgl2');
    return { ok: !!gl && cv.clientWidth > 0, largura: cv.clientWidth, altura: cv.clientHeight, webgl: !!gl };
  });

  // Robô: o lazy-loader só dispara quando a seção entra na tela.
  await page.locator('#features-robot').scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(9000);
  const robo = await page.evaluate(() => {
    const host = document.getElementById('features-robot');
    if (!host) return { ok: false, motivo: 'sem #features-robot' };
    const v = host.querySelector('spline-viewer');
    const cv = v && v.shadowRoot && v.shadowRoot.querySelector('canvas');
    return {
      ok: !!(cv && cv.clientWidth > 0),
      registrado: !!customElements.get('spline-viewer'),
      montou: !!v,
      canvas: cv ? cv.clientWidth + 'x' + cv.clientHeight : null,
      classes: host.className,
    };
  });

  // Conhecidos e aceitos (ver cabeçalho). Qualquer outro host externo reprova.
  const RESIDUAIS = [
    /^https:\/\/unpkg\.com\/@splinetool\/[a-z-]+@[\d.]+\/build\//,
    /^https:\/\/fonts\.googleapis\.com\//,
    /^https:\/\/fonts\.gstatic\.com\//,
  ];
  const residuais = externas.filter((u) => RESIDUAIS.some((re) => re.test(u)));
  const inesperadas = externas.filter((u) => !RESIDUAIS.some((re) => re.test(u)));

  const falhas = [];
  if (!globo.ok) falhas.push('globo não renderizou: ' + JSON.stringify(globo));
  if (!robo.ok) falhas.push('robô 3D não renderizou: ' + JSON.stringify(robo));
  if (inesperadas.length) {
    falhas.push('pedido externo não previsto (algum asset nosso voltou pro CDN): ' +
      [...new Set(inesperadas)].slice(0, 5).join(', '));
  }

  console.log('globo :', JSON.stringify(globo));
  console.log('robô  :', JSON.stringify(robo));
  console.log('residuais conhecidos :', residuais.length
    ? [...new Set(residuais)].join('\n                      ') : 'nenhum');
  console.log('externos inesperados :', inesperadas.length
    ? [...new Set(inesperadas)].join(', ') : 'nenhum');
  console.log('logs  :', logs.length ? logs.join(' | ') : '(nenhum)');
  console.log('erros :', erros.length ? erros.join(' | ') : 'nenhum');
  await page.screenshot({ path: path.join(SAIDA, 'landing-sem-cdn.png') });
  console.log(falhas.length
    ? 'FALHAS:\n  ' + falhas.join('\n  ')
    : 'GLOBO E ROBÔ RENDERIZARAM COM OS ASSETS LOCAIS (só os residuais conhecidos saíram pra fora)');

  await browser.close();
  srv.close();
  process.exit(falhas.length ? 1 : 0);
})();
