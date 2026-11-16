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

  let dialogos = 0;
  const mortos = [];
  const sumiram = [];   // apareceram na coleta e sumiram antes do clique (modal fechado etc.)
  let total = 0;
  // Abrir ABA NOVA é reação: btnOpenCrmFullscreen usa chrome.tabs.create e
  // "Ver planos" usa window.open. Nenhum dos dois mexe na página atual, então
  // sem contar isto os dois apareciam como mortos em várias telas.
  let abasNovas = 0;
  ctx.on('page', () => { abasNovas++; });

  /**
   * Marca os clicáveis com uma CHAVE ESTÁVEL, não com o índice na ordem do DOM.
   * Com índice, abrir um modal deslocava todo mundo e 27 botões acabavam
   * pulados por "mudou de texto" — 19% da tela sem verificação nenhuma.
   * A chave é o id quando existe; senão, o texto mais a ordem entre os de
   * mesmo texto. Isso sobrevive a elementos inseridos antes dele.
   */
  const MARCAR = () => {
    const contagem = {};
    const out = [];
    document.querySelectorAll('button, a, [role="button"], input[type="submit"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!el.offsetParent || r.width < 4 || r.height < 4) return;
      if (el.disabled) return;                       // desabilitado é intencional
      const texto = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 42)
        || el.getAttribute('title') || el.id || '(sem texto)';
      const chave = el.id ? 'id:' + el.id : (contagem[texto] = (contagem[texto] || 0) + 1, 'tx:' + texto + '::' + contagem[texto]);
      el.setAttribute('data-btn-k', chave);
      out.push({ chave, texto, id: el.id || '', href: el.getAttribute('href') || '' });
    });
    return out;
  };

  async function varrer(page, rotulo) {
    const alvos = await page.evaluate(MARCAR);

    // Fila de trabalho: começa com o que está na tela e CRESCE quando um
    // clique abre um modal. Os botões do modal entram na FRENTE, para serem
    // testados enquanto ele está aberto — sem isso eles sumiam antes da vez
    // deles e ficavam sem verificação (eram os 14 pulados).
    const pendentes = alvos.filter((x) => !/^(mailto:|tel:|https?:)/i.test(x.href));
    const conhecidos = new Set(pendentes.map((x) => x.chave));
    let giros = 0;

    while (pendentes.length && giros++ < 900) {
      const a = pendentes.shift();

      // Re-marca antes de clicar: o DOM pode ter mudado desde a coleta.
      let agora = await page.evaluate(MARCAR);
      if (!agora.some((x) => x.chave === a.chave)) {
        // Sumiu: quase sempre é item de modal que outro clique fechou. Se a
        // gente sabe QUEM abriu esse modal, clica nele de novo e tenta uma vez.
        // Sem isto, um seletor de etiqueta com 20 botões testava só o primeiro.
        let voltou = false;
        if (a.abridor && !a.jaRetentou) {
          const selAb = `[data-btn-k="${a.abridor.replace(/"/g, '\\"')}"]`;
          const temAbridor = agora.some((x) => x.chave === a.abridor);
          if (temAbridor) {
            await page.click(selAb, { timeout: 1200 }).catch(() => {});
            await page.waitForTimeout(450);
            agora = await page.evaluate(MARCAR);
            voltou = agora.some((x) => x.chave === a.chave);
          }
        }
        if (!voltou) { sumiram.push({ rotulo, ...a }); continue; }
      }

      total++;
      let req = 0;
      const onReq = () => { req++; };
      page.on('request', onReq);
      // Abrir o seletor de arquivo também é reação (sp_select_file).
      let fileChooser = 0;
      const onFC = (fc) => { fileChooser++; fc.setFiles([]).catch(() => {}); };
      page.on('filechooser', onFC);
      const abasAntes = abasNovas;
      const dlgAntes = dialogos;
      await page.evaluate(ESPIAO);
      await page.evaluate(() => window.__btnReset && window.__btnReset());
      const antes = page.url();
      const sel = `[data-btn-k="${a.chave.replace(/"/g, '\\"')}"]`;
      try { await page.click(sel, { timeout: 1200 }); }
      catch (_) { await page.evaluate((q) => document.querySelector(q)?.click(), sel).catch(() => {}); }
      await page.waitForTimeout(500);
      page.off('request', onReq);
      page.off('filechooser', onFC);
      const dep = await page.evaluate(() => ({
        url: location.href,
        mut: (window.__btn && window.__btn.mut) || 0,
        toast: [...document.querySelectorAll('[class*="toast"],[id*="toast"]')].some((t) => (t.textContent || '').trim()),
        modal: [...document.querySelectorAll('[class*="modal"],dialog')].some((m) => m.offsetParent !== null || m.open),
      })).catch(() => ({ url: antes, mut: 0, toast: false, modal: false }));
      const reagiu = dep.url !== antes || dep.mut > 0 || dep.toast || dep.modal || req > 0
        || abasNovas > abasAntes || fileChooser > 0 || dialogos > dlgAntes;
      if (!reagiu) {
        mortos.push({ rotulo, ...a });
        console.log(`  [MORTO] ${rotulo}  "${a.texto}"  id=${a.id}`);
      }
      await page.evaluate((q) => document.querySelector(q)?.removeAttribute('data-btn-k'), sel).catch(() => {});

      // Apareceu coisa nova (modal)? Entra na frente da fila.
      const depois = await page.evaluate(MARCAR);
      const novos = depois
        .filter((x) => !conhecidos.has(x.chave) && !/^(mailto:|tel:|https?:)/i.test(x.href))
        .map((x) => ({ ...x, abridor: a.chave }));   // guarda quem revelou este botão
      for (const n of novos) conhecidos.add(n.chave);
      if (novos.length) pendentes.unshift(...novos);
    }
    if (giros >= 900) console.log(`  (limite de 900 cliques atingido em ${rotulo})`);
  }

  const sp = await ctx.newPage();
  sp.on('dialog', (d) => { dialogos++; d.dismiss().catch(() => {}); });
  await sp.goto(`chrome-extension://${extId}/sidepanel.html`);
  await sp.waitForTimeout(3500);

  for (const v of VIEWS) {
    await sp.evaluate((x) => (typeof showView === 'function' ? showView(x) : null), v).catch(() => {});
    await sp.waitForTimeout(900);
    console.log(`\n### painel / ${v}`);
    await varrer(sp, `painel/${v}`);
  }

  const tr = await ctx.newPage();
  tr.on('dialog', (d) => { dialogos++; d.dismiss().catch(() => {}); });
  await tr.goto(`chrome-extension://${extId}/training/training.html`).catch(() => {});
  await tr.waitForTimeout(2500);
  console.log('\n### training.html');
  await varrer(tr, 'training');

  console.log('\n' + '='.repeat(70));
  console.log(`clicáveis testados: ${total}`);
  console.log(`sumiram antes do clique (modal fechado etc.): ${sumiram.length}`);
  for (const x of sumiram) console.log(`   ${x.rotulo}  "${x.texto}"`);
  console.log(`MORTOS: ${mortos.length}`);
  for (const m of mortos) console.log(`   ${m.rotulo}  "${m.texto}"  id=${m.id}`);
  console.log('='.repeat(70));
  await ctx.close();
  process.exitCode = mortos.length ? 1 : 0;
})().catch((e) => { console.error('QUEBROU:', e.message); process.exit(2); });
