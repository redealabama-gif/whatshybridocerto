#!/usr/bin/env node
/**
 * Auditoria IA — EXTENSÃO REAL carregada no Chromium (--load-extension), logada
 * no backend de teste (provedor de IA falso), contra um WhatsApp Web simulado
 * (page.route em https://web.whatsapp.com). Clica no botão 🤖 de sugestão e
 * registra: o que chegou ao modelo (via log do provedor falso) e o que a
 * extensão mostrou/inseriu.
 *
 * Pré-requisito: backend (start-backend.sh) + fake-provider.js no ar.
 * Uso: node audit/harness/extension-e2e.js [dom: antigo|atual] [scratchDir]
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CONV, bubbleOld, bubbleNew, page } = require('./wa-dom');

const B = process.env.BACKEND || 'http://127.0.0.1:3000';
const F = process.env.FAKE || 'http://127.0.0.1:18080';
const VARIANT = process.argv[2] || 'atual';
const SCRATCH = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'audit-e2e-'));
// EXT_DIR: outra cópia da extensão (antes × depois); TAG grava em fase2/matriz/.
const SRC_EXT = process.env.EXT_DIR || path.resolve(__dirname, '../../whatshybrid-extension');
const TAG = process.env.TAG || '';
const OUT = TAG ? path.resolve(__dirname, '../evidencias/fase2/matriz') : path.resolve(__dirname, '../evidencias');

async function http(method, url, body, token) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}

(async () => {
  // cópia da extensão (o Chrome não escreve no repo)
  const extDir = path.join(SCRATCH, 'ext');
  fs.cpSync(SRC_EXT, extDir, { recursive: true, filter: (s) => !s.includes('node_modules') });

  // usuário + treinamento no backend de teste
  const su = await http('POST', `${B}/api/v1/auth/signup`, { email: `e2e${Date.now()}@audit.test`, password: 'Audit#Senha2026', name: 'Clínica Teste', company: 'Clínica Teste', plan: 'pro' });
  const token = su.json.accessToken;
  await http('POST', `${B}/api/v1/training/sync`, {
    faqs: [{ id: `faq-${Date.now()}`, question: 'Quanto custa o plano para clínica?', answer: 'Plano Pro para clínicas: R$ 189/mês para até 5 usuários, sem fidelidade; anual com 15% de desconto.' }],
  }, token);
  await fetch(`${F}/__reset`); await fetch(`${F}/__mode?m=ok`);

  const userData = path.join(SCRATCH, 'profile');
  const ctx = await chromium.launchPersistentContext(userData, {
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
    headless: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = sw.url().split('/')[2];
  await sw.evaluate(async ({ base, token, user, ws }) => {
    await chrome.storage.local.set({
      whl_backend_client: JSON.stringify({ baseUrl: base, accessToken: token, refreshToken: null, user, workspace: ws }),
      whl_backend_url: base,
    });
  }, { base: B, token, user: su.json.user, ws: su.json.workspace });

  const html = page(VARIANT === 'antigo' ? CONV.map(bubbleOld).join('') : CONV.map((m, i) => bubbleNew(m, i, 0)).join(''));
  const pg = await ctx.newPage();
  const logs = [];
  pg.on('console', (m) => { const t = m.text(); if (/AI-Btn|BackendClient|Orchestrator|CTX|ai\.process|LazyLoader|advanced/i.test(t)) logs.push(t.slice(0, 220)); });
  pg.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message.slice(0, 160)));
  await pg.route('https://web.whatsapp.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await pg.goto('https://web.whatsapp.com/');

  let btn = null;
  try { btn = await pg.waitForSelector('#whl-ai-btn-fixed', { timeout: 30000 }); } catch (_) { btn = null; }
  const result = { variant: VARIANT, extensionId: extId, buttonInjected: !!btn };
  if (btn) {
    await pg.waitForTimeout(3000); // BackendClient conectar
    await btn.click();
    await pg.waitForTimeout(15000);
    result.panel = await pg.evaluate(() => document.getElementById('whl-ai-panel-fixed')?.innerText?.slice(0, 400) || null);
    const calls = await (await fetch(`${F}/__log`)).json();
    const c = calls[calls.length - 1];
    result.providerCalls = calls.length;
    if (c) {
      const msgs = c.body.messages || [];
      result.modelSaw = {
        lastUserMessage: (msgs.filter((m) => m.role === 'user').pop() || {}).content,
        historyCount: msgs.filter((m) => m.role !== 'system').length,
        knowledgeInPrompt: /R\$ 189/.test(((msgs.find((m) => m.role === 'system') || {}).content) || ''),
        intent: ((((msgs.find((m) => m.role === 'system') || {}).content) || '').match(/Intent: (\w+)/) || [])[1],
      };
    }
  }
  result.logs = logs.slice(-25);
  await ctx.close();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `50-extensao-e2e-${VARIANT}${TAG ? '-' + TAG : ''}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
