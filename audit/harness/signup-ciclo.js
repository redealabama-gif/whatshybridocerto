/** signup.html: card Business, textos em respostas, ciclo anual ponta a ponta. */
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const path2 = require('path');
const RAIZ = path2.join(__dirname, '..', '..', 'whatshybrid-backend', 'public');
const TIPOS = { '.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.mp4':'video/mp4','.json':'application/json','.ico':'image/x-icon' };
const srv = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html';
  if (p === '/config.js') { res.writeHead(200,{'Content-Type':'application/javascript'}); return res.end('window.APP_CONFIG={};'); }
  const abs=path.join(RAIZ,p);
  if(!abs.startsWith(RAIZ)||!fs.existsSync(abs)||fs.statSync(abs).isDirectory()){res.writeHead(404);return res.end('404');}
  res.writeHead(200,{'Content-Type':TIPOS[path.extname(abs)]||'application/octet-stream'}); fs.createReadStream(abs).pipe(res); });

(async () => {
  await new Promise(r => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));

  const falhas = [];
  const ok = (c, m) => { if (!c) falhas.push(m); };

  // ---- A) mensal, sem parâmetros
  await page.goto(base + '/signup.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const planos = await page.locator('.plan-option h4').allTextContents();
  ok(planos.length === 4, 'A) nº de planos: ' + planos.length + ' → ' + JSON.stringify(planos));
  ok(planos.some(t => t.trim().startsWith('Business')), 'A) sem card Business');
  const txt = await page.locator('.plans-grid').innerText();
  ok(!/token/i.test(txt), 'A) ainda fala em token: ' + (txt.match(/.{0,30}token.{0,30}/i)||[''])[0]);
  ok(txt.includes('500 respostas da IA/mês'), 'A) Starter sem "500 respostas da IA/mês"');
  ok(txt.includes('2.500 respostas da IA/mês'), 'A) Pro sem "2.500 respostas da IA/mês"');
  ok(txt.includes('10.000 respostas da IA/mês'), 'A) Business sem "10.000 respostas da IA/mês"');
  ok(await page.locator('#aviso-anual').isVisible() === false, 'A) aviso anual visível no mensal');
  const linhas = await page.locator('.plan-option').evaluateAll(e => [...new Set(e.map(x => x.offsetTop))].length);
  ok(linhas === 1, 'A) cards do signup em ' + linhas + ' fileiras');

  // ---- B) ?plan=business&cycle=annual
  await page.goto(base + '/signup.html?plan=business&cycle=annual', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const sel = await page.locator('.plan-option.selected').getAttribute('data-plan');
  ok(sel === 'business', 'B) plano pré-selecionado: ' + sel);
  // O aviso mora dentro de #form-step-2, que só ganha .active no passo 2.
  // Aqui (passo 1) o que importa é ele estar ARMADO (hidden = false).
  ok(await page.locator('#aviso-anual').evaluate(e => !e.hidden), 'B) aviso anual não foi armado');
  const precos = await page.locator('.plan-option [data-preco-card]').allTextContents();
  ok(precos.join('|').includes('R$ 2.999,00/ano'), 'B) preço anual do Business: ' + JSON.stringify(precos));
  ok(precos.join('|').includes('R$ 499,00/ano'), 'B) preço anual do Starter: ' + JSON.stringify(precos));
  ok(precos.join('|').includes('R$ 999,00/ano'), 'B) preço anual do Pro: ' + JSON.stringify(precos));
  const guardado = await page.evaluate(() => { try { return localStorage.getItem('whl_ciclo_preferido'); } catch (_) { return 'erro'; } });
  ok(guardado === 'annual', 'B) preferência guardada: ' + guardado);

  // ---- C) resumo (passo 3)
  await page.fill('#company', 'Loja Teste Anual');
  await page.fill('#name', 'Dona Teste');
  await page.fill('#email', 'teste-anual@example.com');
  await page.fill('#password', 'Cliente#Teste2026');
  const conf = page.locator('#password-confirm');
  if (await conf.count()) await conf.fill('Cliente#Teste2026');
  await page.locator('#terms').check();
  await page.locator('#form-step-1 button[type="submit"]:visible').click();
  await page.waitForTimeout(400);
  // no passo 2 o aviso tem de estar visível de verdade
  ok(await page.locator('#aviso-anual').isVisible(), 'C) aviso anual invisível no passo 2');
  await page.locator('#form-step-2 button[type="submit"]:visible').click();
  await page.waitForTimeout(400);
  const resumoPlano = (await page.locator('#summary-plan').innerText()).trim();
  ok(resumoPlano === 'Business (anual)', 'C) resumo do plano: "' + resumoPlano + '"');
  const resumoPreco = (await page.locator('#summary-price').innerText()).trim();
  ok(resumoPreco === 'R$ 2.999,00/ano', 'C) resumo do preço: "' + resumoPreco + '"');

  // ---- D) trocar de plano dentro do passo 2 mantém o ciclo
  await page.goto(base + '/signup.html?plan=business&cycle=annual', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  // os cards só ficam visíveis no passo 2
  await page.fill('#company', 'Loja D'); await page.fill('#name', 'Pessoa D');
  await page.fill('#email', 'd@example.com'); await page.fill('#password', 'Cliente#Teste2026');
  const confD = page.locator('#password-confirm');
  if (await confD.count()) await confD.fill('Cliente#Teste2026');
  await page.locator('#terms').check();
  await page.locator('#form-step-1 button[type="submit"]:visible').click();
  await page.waitForTimeout(400);
  await page.locator('[data-plan="pro"]').click();
  await page.waitForTimeout(200);
  const d = await page.evaluate(() => ({
    sel: document.querySelector('.plan-option.selected').dataset.plan,
    aviso: !document.getElementById('aviso-anual').hidden
  }));
  ok(d.sel === 'pro' && d.aviso, 'D) ao trocar de plano: ' + JSON.stringify(d));

  // ---- E) celular
  const mob = await ctx.newPage();
  await mob.setViewportSize({ width: 390, height: 844 });
  await mob.goto(base + '/signup.html?plan=business&cycle=annual', { waitUntil: 'load' });
  await mob.waitForTimeout(500);
  const over = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 1, 'E) rolagem horizontal no celular: ' + over + 'px');
  await mob.screenshot({ path: (process.argv[2] || '.') + '/signup-celular.png' });

  await page.goto(base + '/signup.html?plan=business&cycle=annual', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: (process.argv[2] || '.') + '/signup-anual.png', fullPage: false });

  console.log('erros de página:', erros.length ? erros.join(' | ') : 'nenhum');
  console.log(falhas.length ? 'FALHAS:\n  ' + falhas.join('\n  ') : 'TODAS AS CHECAGENS PASSARAM');
  await browser.close(); srv.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
