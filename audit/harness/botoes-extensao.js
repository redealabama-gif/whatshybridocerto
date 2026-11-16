/**
 * BTN-00 (extensão) — clica em TODO botão de TODA tela do painel e exige reação.
 *
 * O harness extensao-interacoes.js confere o EFEITO dos controles-chave, mas só
 * dos que foram listados. Um botão que ninguém listou podia estar morto sem
 * ninguém notar — foi assim que "Falar com o suporte" passou no site.
 * Aqui não se escolhe: clica em tudo.
 *
 * Uso (na raiz, com o backend em pé):
 *   node audit/harness/botoes-extensao.js [baseUrl]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), path.join(__dirname, '../..')] }));

const B = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const SRC_EXT = path.resolve(__dirname, '../../whatshybrid-extension');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'btn-ext-'));

const VIEWS = ['principal', 'extrator', 'recover', 'config', 'backup', 'crm', 'tasks',
  'ai', 'autopilot', 'backend', 'team', 'groups', 'quickreplies', 'sapl'];

const waHtml = `<html><body><div id="main"><header><span title="Cliente Teste">Cliente Teste</span></header>
<div id="pane-side"></div><div data-testid="conversation-panel-messages"></div>
<footer><div contenteditable="true" role="textbox" data-testid="conversation-compose-box-input"></div></footer></div></body></html>`;

async function http(m, p, b) {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}

const ESPIAO = () => {
  window.__btn = { mut: 0 };
  new MutationObserver((ms) => { window.__btn.mut += ms.length; })
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  window.__btnReset = () => { window.__btn.mut = 0; };
};

(async () => {
  const su = await http('POST', '/api/v1/auth/signup', {
    email: `btnext-${Date.now()}@example.com`, password: 'Audit#Senha2026',
    name: 'Cliente Teste', company: 'Loja Teste', plan: 'pro',
  });
  if (su.status !== 201) throw new Error('cadastro falhou: ' + su.status);

  const extDir = path.join(SCRATCH, 'ext');
  fs.cpSync(SRC_EXT, extDir, { recursive: true, filter: (s) => !s.includes('node_modules') });
  const ctx = await chromium.launchPersistentContext(path.join(SCRATCH, 'profile'), {
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', headless: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
    viewport: { width: 480, height: 960 },
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const extId = sw.url().split('/')[2];
  await sw.evaluate(async ({ base, token, user, workspace }) => {
    await chrome.storage.local.set({
      whl_backend_client: JSON.stringify({ baseUrl: base, accessToken: token, refreshToken: null, user, workspace }),
      whl_backend_url: base,
      whl_subscription: { planId: 'pro', status: 'active' },
    });
  }, { base: B, token: su.json.accessToken, user: su.json.user, workspace: su.json.workspace });

  const wa = await ctx.newPage();
  await wa.route('https://web.whatsapp.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: waHtml }));
  await wa.goto('https://web.whatsapp.com/');
  await wa.waitForTimeout(2000);

  const mortos = [];
  let total = 0;

  async function varrer(page, rotulo) {
    const alvos = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button, a, [role="button"], input[type="submit"]').forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (!el.offsetParent || r.width < 4 || r.height < 4) return;
        if (el.disabled) return;                       // desabilitado é intencional
        el.setAttribute('data-btn-i', String(i));
        out.push({
          i: String(i),
          texto: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 42) || el.getAttribute('title') || el.id || '(sem texto)',
          id: el.id || '', href: el.getAttribute('href') || '',
        });
      });
      return out;
    });

    for (const a of alvos) {
      if (/^(mailto:|tel:|https?:)/i.test(a.href)) continue;   // sai do painel
      total++;
      let req = 0;
      const onReq = () => { req++; };
      page.on('request', onReq);
      await page.evaluate(ESPIAO);
      await page.evaluate(() => window.__btnReset && window.__btnReset());
      const antes = page.url();
      try { await page.click(`[data-btn-i="${a.i}"]`, { timeout: 1200 }); }
      catch (_) { await page.evaluate((i) => document.querySelector(`[data-btn-i="${i}"]`)?.click(), a.i).catch(() => {}); }
      await page.waitForTimeout(500);
      page.off('request', onReq);
      const dep = await page.evaluate(() => ({
        url: location.href,
        mut: (window.__btn && window.__btn.mut) || 0,
        toast: [...document.querySelectorAll('[class*="toast"],[id*="toast"]')].some((t) => (t.textContent || '').trim()),
        modal: [...document.querySelectorAll('[class*="modal"],dialog')].some((m) => m.offsetParent !== null || m.open),
      })).catch(() => ({ url: antes, mut: 0, toast: false, modal: false }));
      if (!(dep.url !== antes || dep.mut > 0 || dep.toast || dep.modal || req > 0)) {
        mortos.push({ rotulo, ...a });
        console.log(`  [MORTO] ${rotulo}  "${a.texto}"  id=${a.id}`);
      }
      await page.evaluate((i) => document.querySelector(`[data-btn-i="${i}"]`)?.removeAttribute('data-btn-i'), a.i).catch(() => {});
    }
  }

  const sp = await ctx.newPage();
  sp.on('dialog', (d) => d.dismiss().catch(() => {}));
  await sp.goto(`chrome-extension://${extId}/sidepanel.html`);
  await sp.waitForTimeout(3500);

  for (const v of VIEWS) {
    await sp.evaluate((x) => (typeof showView === 'function' ? showView(x) : null), v).catch(() => {});
    await sp.waitForTimeout(900);
    console.log(`\n### painel / ${v}`);
    await varrer(sp, `painel/${v}`);
  }

  const tr = await ctx.newPage();
  tr.on('dialog', (d) => d.dismiss().catch(() => {}));
  await tr.goto(`chrome-extension://${extId}/training/training.html`).catch(() => {});
  await tr.waitForTimeout(2500);
  console.log('\n### training.html');
  await varrer(tr, 'training');

  console.log('\n' + '='.repeat(70));
  console.log(`clicáveis testados: ${total}`);
  console.log(`MORTOS: ${mortos.length}`);
  for (const m of mortos) console.log(`   ${m.rotulo}  "${m.texto}"  id=${m.id}`);
  console.log('='.repeat(70));
  await ctx.close();
  process.exitCode = mortos.length ? 1 : 0;
})().catch((e) => { console.error('QUEBROU:', e.message); process.exit(2); });
