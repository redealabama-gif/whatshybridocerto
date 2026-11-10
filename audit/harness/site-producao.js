// Verificação do SITE (cadastro, login, painel) num navegador de verdade.
// Uso (na raiz, com o backend de teste no ar — audit/harness/start-backend.sh):
//   node audit/harness/site-producao.js http://127.0.0.1:3000 <dir-de-prints>
// Use 127.0.0.1 (e não localhost): é um endereço que NÃO está na lista de CORS,
// como acontece em produção quando o cliente abre o site por www. ou outro nome.
// O roteiro faz vários logins: suba o backend com AUTH_RATE_LIMIT_MAX alto
// (AUTH_RATE_LIMIT_MAX=100000 bash audit/harness/start-backend.sh ...), senão a
// proteção contra tentativas repetidas bloqueia a partir da 2ª rodada.
// Sai com código 1 se alguma verificação falhar.
const fs = require('fs');
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), path.join(__dirname, '../..')] }));

const B = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = process.argv[3] || null;
const SENHA = 'Cliente#Teste2026';
// O que a CDN entrega hoje para lucide@latest (1.x). Usado para reproduzir o site
// antigo, que carregava https://unpkg.com/lucide@latest.
const LUCIDE_ATUAL = fs.readFileSync(path.join(__dirname, '../../whatshybrid-backend/public/js/vendor/lucide.min.js'));

const resultados = [];
function registrar(nome, ok, detalhe) {
  resultados.push({ nome, ok, detalhe });
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome} — ${detalhe}`);
}

async function novaPagina(br, { cdn = 'atual', bloquear = [] } = {}) {
  const ctx = await br.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' }); // navegador de cliente brasileiro
  await ctx.route('https://unpkg.com/lucide@latest**', (r) => (cdn === 'fora'
    ? r.abort()
    : r.fulfill({ status: 200, contentType: 'application/javascript', body: LUCIDE_ATUAL })));
  for (const padrao of bloquear) await ctx.route(padrao, (r) => r.abort());
  const p = await ctx.newPage();
  p._erros = [];
  p.on('pageerror', (e) => p._erros.push(e.message.slice(0, 160)));
  p.on('response', (r) => { if (r.status() >= 400) p._erros.push(`HTTP ${r.status()} ${r.url().replace(B, '')}`); });
  return { ctx, p };
}
const print = async (p, nome) => { if (OUT) await p.screenshot({ path: path.join(OUT, `${nome}.png`) }); };
const visivel = (p) => p.evaluate(() => {
  const card = document.querySelector('#form-step-3 .card');
  if (!card) return [];
  return [...card.querySelectorAll('.summary-row')]
    .filter((el) => el.offsetParent !== null && getComputedStyle(el).display !== 'none')
    .map((el) => el.innerText.replace(/\s+/g, ' ').trim());
});
const toastTexto = (p) => p.evaluate(() => [...document.querySelectorAll('.toast, [class*="toast"]')].map((t) => t.innerText.trim()).filter(Boolean).join(' | '));

async function cadastroAteResumo(p, { plano, cupom = false }) {
  const email = `site-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  if (cupom) {
    // o cupom só vale depois do formulário de saída da página inicial (ele grava este "resgate")
    await p.addInitScript(() => sessionStorage.setItem('wh_coupon_claim', JSON.stringify({ code: 'EXIT50', exp: Date.now() + 600000 })));
  }
  await p.goto(`${B}/signup.html?plan=${plano}${cupom ? '&coupon=EXIT50' : ''}`);
  await p.waitForTimeout(1200);
  await p.fill('#company', 'Loja Teste');
  await p.fill('#name', 'Cliente Teste');
  await p.fill('#email', email);
  await p.fill('#password', SENHA);
  await p.check('#terms');
  await p.click('#form-step-1 button[type="submit"]');
  await p.waitForTimeout(500);
  await p.click('#form-step-2 button[type="submit"]');
  await p.waitForTimeout(500);
  return email;
}

(async () => {
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });

  // 1. Resumo do cadastro, plano Pro, sem cupom
  {
    const { ctx, p } = await novaPagina(br);
    await cadastroAteResumo(p, { plano: 'pro' });
    const linhas = await visivel(p);
    await print(p, '1-resumo-pro-sem-cupom');
    const temCupom = linhas.some((l) => /cupom|1º mês|2º mês/i.test(l));
    const preco = linhas.find((l) => /^Preço/.test(l)) || '';
    registrar('resumo Pro sem cupom', !temCupom && /99,90/.test(preco), JSON.stringify(linhas));
    // 2. Concluir o cadastro ("Começar trial grátis") → painel
    await p.click('#signup-submit');
    await p.waitForTimeout(3500);
    const url = p.url();
    const toast = await toastTexto(p);
    await print(p, '2-apos-cadastro');
    const ok = /dashboard\.html/.test(url);
    registrar('"Começar trial grátis" leva ao painel', ok, `url=${url.replace(B, '')} aviso=${JSON.stringify(toast)} erros=${JSON.stringify(p._erros.filter((e) => /api\//.test(e)))}`);
    await ctx.close();
  }

  // 3. Resumo do cadastro, plano Pro, com cupom EXIT50 (50% no 1º mês)
  {
    const { ctx, p } = await novaPagina(br);
    await cadastroAteResumo(p, { plano: 'pro', cupom: true });
    const linhas = await visivel(p);
    await print(p, '3-resumo-pro-com-cupom');
    const primeiro = linhas.find((l) => /^1º mês/.test(l)) || '';
    const depois = linhas.find((l) => /2º mês/.test(l)) || '';
    registrar('resumo Pro com EXIT50', /49,95/.test(primeiro) && /99,90/.test(depois), JSON.stringify(linhas));
    await ctx.close();
  }

  // Conta para os testes de login
  const email = `login-${Date.now()}@example.com`;
  {
    const r = await fetch(`${B}/api/v1/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: SENHA, name: 'Cliente', company: 'Loja' }) });
    if (r.status !== 201) throw new Error(`não consegui criar a conta de teste: ${r.status}`);
  }
  async function entrar(p, senha) {
    await p.goto(`${B}/login.html`);
    await p.waitForTimeout(1000);
    await p.fill('#email', email);
    await p.fill('#password', senha);
    await p.click('#login-form button[type="submit"]');
    await p.waitForTimeout(2500);
  }

  // 4. Senha errada → mensagem na tela, continua no login
  {
    const { ctx, p } = await novaPagina(br);
    await entrar(p, 'senha-errada-123');
    const toast = await toastTexto(p);
    await print(p, '4-senha-errada');
    registrar('senha errada mostra o motivo', /login\.html/.test(p.url()) && /credenciais|senha|inválid/i.test(toast), `url=${p.url().replace(B, '')} aviso=${JSON.stringify(toast)}`);
    await ctx.close();
  }

  // 5. "Entrar" → painel
  {
    const { ctx, p } = await novaPagina(br);
    await entrar(p, SENHA);
    await print(p, '5-login');
    registrar('"Entrar" leva ao painel', /dashboard\.html/.test(p.url()), `url=${p.url().replace(B, '')} aviso=${JSON.stringify(await toastTexto(p))}`);
    await ctx.close();
  }

  // 6. Ícones do painel (todos os data-lucide viram desenho). Sessão aberta
  //    direto pela API, para não depender do formulário de login.
  {
    const r = await fetch(`${B}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: SENHA }) });
    const sessao = await r.json();
    const { ctx, p } = await novaPagina(br);
    await p.addInitScript((s) => { localStorage.setItem('wh_jwt', s.accessToken); localStorage.setItem('wh_user', JSON.stringify(s.user)); }, sessao);
    await p.goto(`${B}/dashboard.html`);
    await p.waitForTimeout(2000);
    const faltando = await p.evaluate(() => [...document.querySelectorAll('i[data-lucide]')].map((i) => i.getAttribute('data-lucide')));
    await print(p, '6-painel');
    registrar('ícones do painel aparecem', /dashboard\.html/.test(p.url()) && faltando.length === 0, faltando.length ? `sem desenho: ${JSON.stringify([...new Set(faltando)])}` : `todos desenhados (url=${p.url().replace(B, '')})`);
    await ctx.close();
  }

  // 7. Script de ícones não carrega (CDN fora do ar) → login continua funcionando e a senha não vai para a URL
  {
    const { ctx, p } = await novaPagina(br, { cdn: 'fora', bloquear: ['**/js/vendor/lucide.min.js'] });
    await entrar(p, SENHA);
    const url = p.url();
    await print(p, '7-login-sem-icones');
    registrar('login com o script de ícones fora do ar', /dashboard\.html/.test(url) && !url.includes(encodeURIComponent(SENHA)) && !url.includes('password='), `url=${url.replace(B, '')}`);
    await ctx.close();
  }

  // 8. Script principal do site quebrado → a senha nunca vai para a URL
  {
    const { ctx, p } = await novaPagina(br, { bloquear: ['**/js/futuristic.js'] });
    await p.goto(`${B}/login.html`);
    await p.waitForTimeout(800);
    await p.fill('#email', email);
    await p.fill('#password', SENHA);
    await p.click('#login-form button[type="submit"]').catch(() => {});
    await p.waitForTimeout(1500);
    const url = p.url();
    registrar('senha fora da URL mesmo com o script quebrado', !url.includes('password='), `url=${url.replace(B, '')}`);
    await ctx.close();
  }

  // 9. Cursor normal (sem a bolinha) no cadastro, login e painel
  {
    const { ctx, p } = await novaPagina(br);
    const cursores = {};
    for (const pagina of ['signup.html', 'login.html', 'index.html']) {
      await p.goto(`${B}/${pagina}`);
      await p.waitForTimeout(600);
      cursores[pagina] = await p.evaluate(() => getComputedStyle(document.body).cursor);
    }
    const escondido = Object.entries(cursores).filter(([, c]) => c === 'none');
    registrar('cursor normal (sem bolinha)', escondido.length === 0, JSON.stringify(cursores));
    await ctx.close();
  }

  await br.close();
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length} de ${resultados.length} passaram`);
  if (OUT) fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(resultados, null, 1));
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
