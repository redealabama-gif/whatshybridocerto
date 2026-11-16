/**
 * BTN-00 — clica em TODO botão de TODA página e exige que ele reaja.
 *
 * Por que existe: o teste do DASH-01 só pegava handler inline (onclick=...).
 * Um botão SEM handler nenhum passava batido — foi o caso de "Falar com o
 * suporte". Este harness não olha o código: ele clica como o usuário e observa
 * se alguma coisa acontece.
 *
 * Para cada elemento clicável registra: navegou, abriu modal, mostrou toast,
 * mexeu no DOM, fez requisição, abriu diálogo — ou NADA.
 *
 * Uso (com o backend em pé): node audit/harness/botoes-todas-paginas.js [baseUrl]
 */
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const EMAIL = `btn${Date.now()}@teste.local`;
const SENHA = 'Senha#Forte2026';

const PAGINAS = [
  'index.html', 'login.html', 'signup.html', 'help.html',
  'privacy.html', 'terms.html', 'forgot-password.html',
  'reset-password.html', 'api-docs.html', 'dashboard.html',
];

/** Instala os observadores que dizem se a página reagiu ao clique. */
const ESPIAO = () => {
  window.__btn = { mutacoes: 0, dialogos: [] };
  const obs = new MutationObserver((ms) => { window.__btn.mutacoes += ms.length; });
  obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  window.__btnReset = () => { window.__btn.mutacoes = 0; };
};

function assinatura(el) {
  const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 45);
  return [el.tagName.toLowerCase(), el.id || '', txt].join('|');
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', async (d) => { await d.dismiss().catch(() => {}); });

  // conta para o dashboard
  await page.goto(BASE + '/signup.html', { waitUntil: 'networkidle' });
  await page.evaluate(async ([b, e, s]) => fetch(b + '/api/v1/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Dono Teste', email: e, password: s, company: 'Loja Teste' }),
  }), [BASE, EMAIL, SENHA]);
  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
  await page.fill('#email', EMAIL); await page.fill('#password', SENHA);
  await page.evaluate(() => document.querySelector('form')?.requestSubmit());
  await page.waitForTimeout(2500);

  const mortos = [];
  const externos = [];
  let total = 0;

  for (const pag of PAGINAS) {
    await page.goto(BASE + '/' + pag, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(1200);
    if (!page.url().includes(pag)) { console.log(`\n### ${pag}  (redirecionou para ${page.url().replace(BASE, '')} — pulado)`); continue; }

    // No dashboard, passa por todas as abas para expor os botões escondidos.
    const abas = pag === 'dashboard.html' ? ['overview', 'extension', 'tokens', 'billing'] : [null];
    console.log(`\n### ${pag}`);

    for (const aba of abas) {
      if (aba) { await page.evaluate((a) => window.switchTab && window.switchTab(a), aba); await page.waitForTimeout(400); }

      const alvos = await page.evaluate((sigFn) => {
        const f = new Function('el', 'return (' + sigFn + ')(el)');
        const vistos = [];
        document.querySelectorAll('button, a, [role="button"], input[type="submit"]').forEach((el, i) => {
          const r = el.getBoundingClientRect();
          if (!el.offsetParent && el.tagName !== 'BODY') return;        // invisível
          if (r.width < 4 || r.height < 4) return;
          el.setAttribute('data-btn-i', String(i));
          vistos.push({
            i: String(i), sig: f(el),
            texto: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 45) || '(sem texto)',
            href: el.getAttribute('href'),
            act: el.getAttribute('data-act'),
            tipo: el.getAttribute('type'),
            noForm: !!el.closest('form'),
          });
        });
        return vistos;
      }, assinatura.toString());

      for (const alvo of alvos) {
        total++;
        const href = alvo.href || '';
        // Links que saem do site ou dependem de app externo: classificados sem clicar.
        if (/^(mailto:|tel:)/i.test(href)) { externos.push({ pag, aba, ...alvo, nota: 'mailto/tel — depende de app externo no computador do cliente' }); continue; }
        if (/^https?:\/\//i.test(href) && !href.startsWith(BASE)) { externos.push({ pag, aba, ...alvo, nota: 'link externo' }); continue; }

        const antesUrl = page.url();
        let req = 0;
        const onReq = () => { req++; };
        page.on('request', onReq);
        await page.evaluate(ESPIAO);
        await page.evaluate(() => window.__btnReset && window.__btnReset());

        let comoClicou = 'mouse';
        try {
          await page.click(`[data-btn-i="${alvo.i}"]`, { timeout: 1500 });
        } catch (_) {
          comoClicou = 'js';
          await page.evaluate((i) => document.querySelector(`[data-btn-i="${i}"]`)?.click(), alvo.i).catch(() => {});
        }
        await page.waitForTimeout(700);
        page.off('request', onReq);

        const dep = await page.evaluate(() => ({
          url: location.href,
          mut: (window.__btn && window.__btn.mutacoes) || 0,
          modal: [...document.querySelectorAll('.modal,[class*="modal"],dialog')].some((m) => m.offsetParent !== null || m.open),
          toast: [...document.querySelectorAll('.toast,[class*="toast"]')].some((t) => (t.textContent || '').trim()),
        })).catch(() => ({ url: page.url(), mut: 0, modal: false, toast: false }));

        const navegou = dep.url !== antesUrl;
        const reagiu = navegou || dep.modal || dep.toast || dep.mut > 0 || req > 0;
        if (!reagiu) {
          mortos.push({ pag, aba, ...alvo, comoClicou });
          console.log(`  [MORTO] ${alvo.texto}  (${alvo.sig.split('|')[0]}${alvo.href ? ' href=' + alvo.href : ''}${alvo.act ? ' act=' + alvo.act : ''})`);
        }

        if (navegou) {
          await page.goto(BASE + '/' + pag, { waitUntil: 'networkidle' }).catch(() => {});
          await page.waitForTimeout(900);
          if (pag === 'dashboard.html' && !page.url().includes('dashboard')) {
            // saiu da conta: entra de novo
            await page.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
            await page.fill('#email', EMAIL); await page.fill('#password', SENHA);
            await page.evaluate(() => document.querySelector('form')?.requestSubmit());
            await page.waitForTimeout(2200);
          }
          if (aba) { await page.evaluate((a) => window.switchTab && window.switchTab(a), aba); await page.waitForTimeout(400); }
        }
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`clicáveis testados: ${total}`);
  console.log(`MORTOS (não reagiram a nada): ${mortos.length}`);
  for (const m of mortos) console.log(`   ${m.pag}${m.aba ? ' / ' + m.aba : ''}  "${m.texto}"  href=${m.href} act=${m.act} clique=${m.comoClicou}`);
  console.log(`\nnão clicados de propósito: ${externos.length}`);
  for (const e of externos) console.log(`   ${e.pag}  "${e.texto}"  ${e.href}  — ${e.nota}`);
  console.log('='.repeat(70));

  await browser.close();
  process.exitCode = mortos.length ? 1 : 0;
})().catch((e) => { console.error('QUEBROU:', e.message); process.exit(2); });
