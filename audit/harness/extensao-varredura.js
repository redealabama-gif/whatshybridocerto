#!/usr/bin/env node
/**
 * F1 — varredura das telas da extensão (passada 1: cada tela abre limpa?).
 *
 * Extensão real no Chromium + WhatsApp simulado + backend de teste. Abre o
 * painel lateral e passa por TODAS as telas (showView), o popup e a página de
 * CRM. Em cada tela registra: erros de script, pedidos com falha, quantos
 * botões/campos visíveis, e tira um print.
 *
 * Uso (na raiz): node audit/harness/extensao-varredura.js http://127.0.0.1:3000 <dir-prints>
 * Sai 1 se alguma tela quebrar (erro de script ao abrir).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), path.join(__dirname, '../..')] }));

const B = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = process.argv[3] || null;
const SRC_EXT = path.resolve(__dirname, '../../whatshybrid-extension');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-varredura-'));

const VIEWS = ['principal', 'extrator', 'recover', 'config', 'backup', 'crm', 'tasks', 'ai', 'autopilot', 'backend', 'team', 'groups', 'quickreplies', 'sapl'];

async function http(m, p, b, t) {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}

// WhatsApp simulado mínimo (content scripts ativos)
const CONV = [['in', 'Boa tarde!'], ['out', 'Boa tarde! Como posso ajudar?'], ['in', 'Quanto custa o plano?']];
const bubble = ([dir, text], i) => `<div role="row"><div data-id="3EB0VR${String(i).padStart(14, '0')}">${i === 0 ? '<div data-testid="msg-container">' : '<div>'}
  <div class="copyable-text" data-pre-plain-text="[14:0${i}] X: "><span class="selectable-text copyable-text"><span>${text}</span></span></div>
  ${dir === 'out' ? '<span data-icon="msg-dblcheck"></span>' : ''}</div></div></div>`;
const waHtml = `<html><head></head><body><div id="main"><header><span title="Cliente Teste">Cliente Teste</span></header>
<div data-testid="conversation-panel-messages">${CONV.map(bubble).join('')}</div>
<footer><div contenteditable="true" role="textbox" data-testid="conversation-compose-box-input"></div></footer></div></body></html>`;

(async () => {
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const su = await http('POST', '/api/v1/auth/signup', { email: `varredura-${Date.now()}@example.com`, password: 'Audit#Senha2026', name: 'Cliente Teste', company: 'Loja Teste', plan: 'pro' });
  if (su.status !== 201) throw new Error('cadastro falhou: ' + su.status);
  const token = su.json.accessToken;

  const extDir = path.join(SCRATCH, 'ext');
  fs.cpSync(SRC_EXT, extDir, { recursive: true, filter: (s) => !s.includes('node_modules') });
  const ctx = await chromium.launchPersistentContext(path.join(SCRATCH, 'profile'), {
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', headless: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
    viewport: { width: 480, height: 960 }, // proporção de painel lateral
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = sw.url().split('/')[2];
  await sw.evaluate(async ({ base, token, user, workspace }) => {
    await chrome.storage.local.set({
      whl_backend_client: JSON.stringify({ baseUrl: base, accessToken: token, refreshToken: null, user, workspace }),
      whl_backend_url: base,
      whl_subscription: { planId: 'pro', status: 'active' },
    });
  }, { base: B, token, user: su.json.user, workspace: su.json.workspace });

  // WhatsApp simulado numa aba (vários módulos falam com ela)
  const wa = await ctx.newPage();
  await wa.route('https://web.whatsapp.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: waHtml }));
  await wa.goto('https://web.whatsapp.com/');
  await wa.waitForTimeout(2500);

  const relatorio = [];

  // ── Painel lateral: todas as views ─────────────────────────────────────────
  const sp = await ctx.newPage();
  const erros = [];
  sp.on('pageerror', (e) => erros.push(String(e.message).slice(0, 180)));
  sp.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text().slice(0, 180)); });
  sp.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) erros.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(B, '')}`); });
  sp.on('dialog', (d) => d.dismiss().catch(() => {}));
  sp.on('requestfailed', (r) => erros.push(`falhou: ${r.url().split('/').slice(-2).join('/')} ${r.failure()?.errorText}`));
  await sp.goto(`chrome-extension://${extId}/sidepanel.html`);
  await sp.waitForTimeout(4000);
  const errosBoot = [...new Set(erros)]; erros.length = 0;
  relatorio.push({ tela: 'sidepanel (abertura)', erros: errosBoot, controles: null });

  for (const view of VIEWS) {
    erros.length = 0;
    const trocou = await sp.evaluate((v) => { try { if (typeof showView === 'function') { showView(v); return true; } window.postMessage({ type: 'whl-show-view', view: v }, '*'); return false; } catch (e) { return 'erro: ' + e.message; } }, view);
    await sp.waitForTimeout(1800);
    const info = await sp.evaluate((v) => {
      const mapa = { principal: 'whlViewPrincipal', extrator: 'whlViewExtrator', recover: 'whlViewRecover', config: 'whlViewConfig', backup: 'whlViewBackup', crm: 'whlViewCrm', tasks: 'whlViewTasks', ai: 'whlViewAi', autopilot: 'whlViewAutoPilot', backend: 'whlViewBackend', team: 'whlViewTeam', groups: 'whlViewGroups', quickreplies: 'whlViewQuickReplies', sapl: 'whlViewSapl' };
      const el = document.getElementById(mapa[v]);
      if (!el) return { existe: false };
      const visivel = el.offsetParent !== null || getComputedStyle(el).display !== 'none';
      const vis = (sel) => [...el.querySelectorAll(sel)].filter((x) => x.offsetParent !== null);
      return {
        existe: true, visivel,
        botoes: vis('button').length,
        campos: vis('input, textarea, select').length,
        textoVazio: (el.innerText || '').trim().length < 5,
      };
    }, view);
    if (OUT) await sp.screenshot({ path: path.join(OUT, `sp-${view}.png`), fullPage: false }).catch(() => {});
    relatorio.push({ tela: `sidepanel/${view}`, trocou, ...info, erros: [...new Set(erros)] });
  }

  // ── Popup ──────────────────────────────────────────────────────────────────
  erros.length = 0;
  const pop = await ctx.newPage();
  const errosPop = [];
  pop.on('pageerror', (e) => errosPop.push(String(e.message).slice(0, 180)));
  pop.on('console', (m) => { if (m.type() === 'error') errosPop.push('console: ' + m.text().slice(0, 180)); });
  await pop.setViewportSize({ width: 400, height: 600 });
  await pop.goto(`chrome-extension://${extId}/popup/popup.html`);
  await pop.waitForTimeout(3000);
  const infoPop = await pop.evaluate(() => ({
    botoes: [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null).length,
    campos: [...document.querySelectorAll('input, textarea, select')].filter((x) => x.offsetParent !== null).length,
    texto: (document.body.innerText || '').trim().slice(0, 120),
  }));
  if (OUT) await pop.screenshot({ path: path.join(OUT, 'popup.png') }).catch(() => {});
  relatorio.push({ tela: 'popup', ...infoPop, erros: [...new Set(errosPop)] });

  // ── Página CRM ─────────────────────────────────────────────────────────────
  const crm = await ctx.newPage();
  const errosCrm = [];
  crm.on('pageerror', (e) => errosCrm.push(String(e.message).slice(0, 180)));
  crm.on('console', (m) => { if (m.type() === 'error') errosCrm.push('console: ' + m.text().slice(0, 180)); });
  await crm.setViewportSize({ width: 1280, height: 900 });
  await crm.goto(`chrome-extension://${extId}/crm/crm.html`);
  await crm.waitForTimeout(3000);
  const infoCrm = await crm.evaluate(() => ({
    botoes: [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null).length,
    campos: [...document.querySelectorAll('input, textarea, select')].filter((x) => x.offsetParent !== null).length,
  }));
  if (OUT) await crm.screenshot({ path: path.join(OUT, 'crm.png'), fullPage: false }).catch(() => {});
  relatorio.push({ tela: 'crm/crm.html', ...infoCrm, erros: [...new Set(errosCrm)] });

  await ctx.close();
  fs.rmSync(SCRATCH, { recursive: true, force: true });

  // ── Relatório ──────────────────────────────────────────────────────────────
  let quebradas = 0;
  for (const r of relatorio) {
    const ruim = (r.erros && r.erros.length) || r.existe === false || r.visivel === false || r.textoVazio === true;
    if (ruim) quebradas++;
    console.log(`${ruim ? 'ATENÇÃO' : 'OK     '} ${r.tela}` +
      (r.botoes != null ? ` — ${r.botoes} botões, ${r.campos} campos` : '') +
      (r.existe === false ? ' — VIEW NÃO EXISTE' : '') +
      (r.visivel === false ? ' — NÃO FICOU VISÍVEL' : '') +
      (r.textoVazio ? ' — VAZIA' : ''));
    for (const e of (r.erros || [])) console.log(`         · ${e}`);
  }
  console.log(`\n${relatorio.length - quebradas} de ${relatorio.length} telas abrem limpas`);
  if (OUT) fs.writeFileSync(path.join(OUT, 'relatorio.json'), JSON.stringify(relatorio, null, 1));
  process.exit(quebradas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
