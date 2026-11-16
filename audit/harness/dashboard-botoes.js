/**
 * DASH-01 — por que nenhum botão do dashboard responde.
 *
 * Abre o dashboard real no Chromium, cadastra/loga um usuário, captura TODO
 * erro de JS da página e clica em cada botão que o dono citou, registrando o
 * que acontece (navegação, modal, nada).
 *
 * Uso: node audit/harness/dashboard-botoes.js [baseUrl]
 */
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const EMAIL = `dash${Date.now()}@teste.local`;
const SENHA = 'Senha#Forte2026';

const BOTOES = [
  'Ir para extensão', 'Ver meu saldo', 'Instalar agora', 'Comprar tokens',
  'Comprar', 'Assinar com renovação automática', 'Pagamento único',
  'Mudar de plano', 'Cancelar', 'Sair'
];

(async () => {
  // o projeto fixa outra versão do Playwright; usar o Chromium do ambiente
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ locale: 'pt-BR' });
  const page = await ctx.newPage();

  const erros = [];
  const consoleErr = [];
  const req404 = [];
  page.on('pageerror', (e) => erros.push(String(e && (e.stack || e.message || e)).split('\n').slice(0, 3).join(' | ')));
  page.on('console', (m) => { if (m.type() === 'error') consoleErr.push(m.text().slice(0, 200)); });
  page.on('response', (r) => { if (r.status() >= 400) req404.push(r.status() + ' ' + r.url().replace(BASE, '')); });

  console.log('== 1. cadastro ==');
  await page.goto(BASE + '/signup.html', { waitUntil: 'networkidle' });
  const r = await page.evaluate(async ([base, email, senha]) => {
    const res = await fetch(base + '/api/v1/auth/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Dono Teste', email, password: senha, company: 'Loja Teste' })
    });
    return { status: res.status, body: (await res.text()).slice(0, 300) };
  }, [BASE, EMAIL, SENHA]);
  console.log('   signup HTTP', r.status, r.status >= 400 ? r.body : '');

  console.log('== 2. login ==');
  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', SENHA);
  await page.evaluate(() => document.querySelector('form')?.requestSubmit());
  await page.waitForTimeout(2500);
  console.log('   url depois do login:', page.url().replace(BASE, '') || '/');

  if (!/dashboard/.test(page.url())) {
    await page.goto(BASE + '/dashboard.html', { waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(1500);
  console.log('   url do painel:', page.url().replace(BASE, ''));

  console.log('\n== 3. ERROS DE JS NA CARGA DA PÁGINA ==');
  if (!erros.length) console.log('   (nenhum pageerror)');
  erros.forEach((e, i) => console.log('   [' + (i + 1) + '] ' + e));
  console.log('   -- console.error --');
  if (!consoleErr.length) console.log('   (nenhum)');
  consoleErr.slice(0, 10).forEach((e, i) => console.log('   [' + (i + 1) + '] ' + e));
  console.log('   -- respostas >=400 --');
  if (!req404.length) console.log('   (nenhuma)');
  [...new Set(req404)].slice(0, 12).forEach((e) => console.log('   ' + e));

  console.log('\n== 4. handlers ligados? ==');
  const diag = await page.evaluate(() => {
    const out = { onclickInline: 0, semOnclick: [], funcoesGlobais: {} };
    document.querySelectorAll('button, a.btn, [role="button"]').forEach((b) => {
      const txt = (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (!txt) return;
      if (b.getAttribute('onclick')) out.onclickInline++;
      else out.semOnclick.push(txt);
    });
    for (const nome of ['switchTab', 'unbindActivationKey', 'subscribeRecurring', 'startCheckout', 'openBuyTokens', 'copyActivationKey', 'changePlan', 'cancelSubscription', 'buyTokenPackage'])
      out.funcoesGlobais[nome] = typeof window[nome];
    out.funcoesGlobais['api'] = typeof window.api;
    out.funcoesGlobais['api.logout'] = window.api ? typeof window.api.logout : 'sem api';
    return out;
  });
  console.log('   botões com onclick inline:', diag.onclickInline);
  console.log('   botões SEM onclick:', diag.semOnclick.length, diag.semOnclick.slice(0, 8));
  console.log('   funções globais:', JSON.stringify(diag.funcoesGlobais));

  console.log('\n== 5. clicando em cada botão citado (passando por todas as abas) ==');
  for (const aba of ['overview', 'extension', 'tokens', 'subscription']) {
    const ok = await page.evaluate((a) => (typeof window.switchTab === 'function' ? (window.switchTab(a), true) : false), aba);
    if (!ok) { console.log('   switchTab() não existe — não dá para abrir as abas'); break; }
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => typeof window.switchTab === 'function' && window.switchTab('overview'));
  await page.waitForTimeout(300);
  for (const nome of BOTOES) {
    const antesUrl = page.url();
    const antesErros = erros.length;
    const achou = await page.evaluate((txt) => {
      const alvos = [...document.querySelectorAll('button, a, [role="button"]')];
      const b = alvos.find((x) => (x.textContent || '').trim().replace(/\s+/g, ' ').toLowerCase().includes(txt.toLowerCase())
        && x.offsetParent !== null);
      if (!b) return null;
      b.click();
      return { tag: b.tagName, onclick: !!b.getAttribute('onclick'), href: b.getAttribute('href') || null, id: b.id || null };
    }, nome);
    await page.waitForTimeout(600);
    if (!achou) { console.log(`   [NÃO ACHEI] ${nome}`); continue; }
    const mudouUrl = page.url() !== antesUrl;
    const novoErro = erros.length > antesErros ? erros[erros.length - 1] : null;
    const modal = await page.evaluate(() => {
      const m = [...document.querySelectorAll('.modal, [class*="modal"], dialog')].find((x) => x.offsetParent !== null || x.open);
      return m ? (m.className || m.tagName) : null;
    });
    const estado = mudouUrl ? 'NAVEGOU -> ' + page.url().replace(BASE, '')
      : modal ? 'abriu modal (' + String(modal).slice(0, 40) + ')'
      : novoErro ? 'ERRO: ' + novoErro.slice(0, 120)
      : 'NADA ACONTECEU';
    console.log(`   [${estado}] ${nome}  (id=${achou.id} onclick=${achou.onclick} href=${achou.href})`);
    if (mudouUrl && !/dashboard/.test(page.url())) {
      await page.goto(BASE + '/dashboard.html', { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
    }
  }

  await page.screenshot({ path: (process.env.OUT || '/tmp') + '/dashboard.png', fullPage: true });
  await browser.close();
})().catch((e) => { console.error('HARNESS QUEBROU:', e); process.exit(1); });
