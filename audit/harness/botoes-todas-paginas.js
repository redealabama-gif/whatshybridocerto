/**
 * BTN-00 — clica em TODO botão de TODA página e exige que ele reaja.
 *
 * Por que existe: o teste do DASH-01 só pegava handler inline (onclick=...).
 * Um botão SEM handler nenhum passava batido — foi o caso de "Falar com o
 * suporte". Este harness não olha o código: ele age como o usuário.
 *
 * Como cada clicável é tratado:
 *   link para outra página do site  -> confere por HTTP que o destino responde
 *                                      (não navega: navegar destruía os
 *                                      marcadores e falseava todo o resto)
 *   mailto: / tel: / link externo   -> anotado, não clicado
 *   o resto (botão, href="#", etc.) -> CLICADO, e tem que reagir: navegar,
 *                                      abrir modal, mostrar aviso, mexer no
 *                                      DOM ou fazer requisição
 *
 * Uso (na raiz, com o backend em pé):
 *   node audit/harness/botoes-todas-paginas.js [baseUrl]
 */
const { chromium } = require('playwright');

const BASE = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const EMAIL = `btn${Date.now()}@teste.local`;
const SENHA = 'Senha#Forte2026';

// Páginas públicas têm de ser varridas DESLOGADO: logado, login.html e
// signup.html redirecionam para o painel e nunca eram testadas — foi assim que
// a 1ª versão deste harness deixou os dois de fora sem avisar.
const PAGINAS_PUBLICAS = [
  'index.html', 'login.html', 'signup.html', 'help.html',
  'privacy.html', 'terms.html', 'forgot-password.html',
  'reset-password.html', 'api-docs.html',
];
const PAGINAS_LOGADO = ['dashboard.html'];

const ESPIAO = () => {
  window.__btn = { mut: 0 };
  new MutationObserver((ms) => { window.__btn.mut += ms.length; })
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
};

/** Marca os clicáveis na ordem do DOM. Idempotente: pode rodar a cada clique. */
const MARCAR = () => {
  let n = 0;
  const vistos = [];
  document.querySelectorAll('button, a, [role="button"], input[type="submit"]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!el.offsetParent || r.width < 4 || r.height < 4) return;
    if (el.disabled) return;
    const i = n++;
    el.setAttribute('data-btn-i', String(i));
    vistos.push({
      i: String(i),
      texto: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 42) || el.getAttribute('aria-label') || el.id || '(sem texto)',
      id: el.id || '', href: el.getAttribute('href'), act: el.getAttribute('data-act'),
    });
  });
  return vistos;
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  // Um confirm()/alert() É a reação do botão — o usuário real vê a caixa. O
  // Playwright descarta diálogos sozinho, então sem contar isto o "Cancelar"
  // da assinatura aparecia como morto.
  let dialogos = 0;
  page.on('dialog', (d) => { dialogos++; d.dismiss().catch(() => {}); });

  await page.goto(BASE + '/signup.html', { waitUntil: 'networkidle' });
  await page.evaluate(async ([b, e, s]) => fetch(b + '/api/v1/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Dono Teste', email: e, password: s, company: 'Loja Teste' }),
  }), [BASE, EMAIL, SENHA]);
  const entrar = async () => {
    await page.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
    await page.fill('#email', EMAIL); await page.fill('#password', SENHA);
    await page.evaluate(() => document.querySelector('form')?.requestSubmit());
    await page.waitForTimeout(2500);
  };
  // começa DESLOGADO: limpa qualquer sessão deixada pelo cadastro
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (_) {} });

  const mortos = [];
  const linksQuebrados = [];
  const externos = [];
  let logado = false;
  let clicados = 0;
  let links = 0;

  const abrir = async (pag, aba) => {
    await page.goto(BASE + '/' + pag, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(900);
    if (pag === 'dashboard.html' && !page.url().includes('dashboard')) {
      await entrar();
      await page.goto(BASE + '/' + pag, { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(900);
    }
    if (aba) { await page.evaluate((a) => window.switchTab && window.switchTab(a), aba); await page.waitForTimeout(400); }
  };

  for (const pag of [...PAGINAS_PUBLICAS, ...PAGINAS_LOGADO]) {
    if (PAGINAS_LOGADO.includes(pag) && !logado) { await entrar(); logado = true; }
    await abrir(pag, null);
    if (!page.url().includes(pag)) { console.log(`\n### ${pag} — redirecionou para ${page.url().replace(BASE, '')}, pulado`); continue; }
    const abas = pag === 'dashboard.html' ? ['overview', 'extension', 'tokens', 'billing'] : [null];
    console.log(`\n### ${pag}`);

    for (const aba of abas) {
      await abrir(pag, aba);
      const alvos = await page.evaluate(MARCAR);
      if (aba) console.log(`  -- aba ${aba}: ${alvos.length} clicáveis`);

      for (const alvo of alvos) {
        const href = alvo.href || '';
        const rot = `${pag}${aba ? '/' + aba : ''}`;

        if (/^(mailto:|tel:)/i.test(href)) { externos.push({ rot, ...alvo, nota: 'mailto/tel — depende de app de e-mail no computador do cliente' }); continue; }
        if (/^https?:\/\//i.test(href) && !href.startsWith(BASE)) { externos.push({ rot, ...alvo, nota: 'link externo' }); continue; }

        // Link para outra página do site: confere o destino por HTTP.
        if (href && href !== '#' && !href.startsWith('#') && !/^javascript:/i.test(href)) {
          links++;
          const alvoUrl = new URL(href, BASE + '/' + pag).toString();
          const st = await page.evaluate(async (u) => {
            try { const r = await fetch(u, { method: 'GET' }); return r.status; } catch (e) { return -1; }
          }, alvoUrl);
          if (st !== 200) { linksQuebrados.push({ rot, ...alvo, st, alvoUrl }); console.log(`  [LINK ${st}] ${alvo.texto} -> ${href}`); }
          continue;
        }

        // Botão de ação: clica e exige reação.
        clicados++;
        await page.evaluate(MARCAR);           // re-marca: o DOM pode ter mudado
        await page.evaluate(ESPIAO);
        let req = 0;
        const onReq = () => { req++; };
        page.on('request', onReq);
        const dlgAntes = dialogos;
        const antes = page.url();
        let como = 'mouse';
        try { await page.click(`[data-btn-i="${alvo.i}"]`, { timeout: 1500 }); }
        catch (_) { como = 'js'; await page.evaluate((i) => document.querySelector(`[data-btn-i="${i}"]`)?.click(), alvo.i).catch(() => {}); }
        await page.waitForTimeout(650);
        page.off('request', onReq);

        const dep = await page.evaluate(() => ({
          url: location.href,
          mut: (window.__btn && window.__btn.mut) || 0,
          modal: [...document.querySelectorAll('.modal,[class*="modal"],dialog')].some((m) => m.offsetParent !== null || m.open),
          toast: [...document.querySelectorAll('.toast,[class*="toast"]')].some((t) => (t.textContent || '').trim()),
        })).catch(() => ({ url: page.url(), mut: 1, modal: false, toast: false })); // evaluate falhou = navegou

        const navegou = dep.url !== antes;
        const abriuDialogo = dialogos > dlgAntes;
        if (!(navegou || dep.modal || dep.toast || dep.mut > 0 || req > 0 || abriuDialogo)) {
          mortos.push({ rot, ...alvo, como });
          console.log(`  [MORTO] ${alvo.texto}  (id=${alvo.id} act=${alvo.act} clique=${como})`);
        }
        if (navegou) await abrir(pag, aba);    // volta e re-marca na próxima iteração
      }
    }
  }

  console.log('\n' + '='.repeat(72));
  console.log(`botões de ação clicados: ${clicados}   |   links verificados: ${links}`);
  console.log(`\nMORTOS (não reagiram a nada): ${mortos.length}`);
  for (const m of mortos) console.log(`   ${m.rot}  "${m.texto}"  id=${m.id} act=${m.act}`);
  console.log(`\nLINKS QUEBRADOS: ${linksQuebrados.length}`);
  for (const l of linksQuebrados) console.log(`   ${l.rot}  "${l.texto}" -> ${l.href}  HTTP ${l.st}`);
  console.log(`\nnão clicados de propósito: ${externos.length}`);
  for (const e of externos) console.log(`   ${e.rot}  "${e.texto}"  ${e.href}  — ${e.nota}`);
  console.log('='.repeat(72));

  await browser.close();
  process.exitCode = (mortos.length + linksQuebrados.length) ? 1 : 0;
})().catch((e) => { console.error('QUEBROU:', e.message); process.exit(2); });
