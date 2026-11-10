#!/usr/bin/env node
/**
 * LIC-02 — sessão única da extensão, com a extensão REAL em dois perfis de
 * navegador (computador A e computador B) contra o servidor de teste.
 * Uso: node audit/harness/sessao-unica-e2e.js [backend]
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'); const os = require('os'); const path = require('path');
const B = process.argv[2] || 'http://127.0.0.1:3000';
const SRC = path.resolve(__dirname, '../../whatshybrid-extension');

async function computador(nome) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sessao-${nome}-`));
  const ext = path.join(dir, 'ext'); fs.cpSync(SRC, ext, { recursive: true, filter: (s) => !s.includes('node_modules') });
  const ctx = await chromium.launchPersistentContext(path.join(dir, 'p'), { executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent('serviceworker');
  await sw.evaluate(async (b) => chrome.storage.local.set({ whl_backend_url: b, whl_backend_client: JSON.stringify({ baseUrl: b }) }), B);
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${sw.url().split('/')[2]}/sidepanel.html`);
  await p.waitForFunction(() => window.BackendClient && window.BackendClient.login, null, { timeout: 15000 });
  await p.waitForTimeout(1500);
  return { ctx, p };
}

(async () => {
  const email = `sessao-${Date.now()}@example.com`; const senha = 'Cliente#Teste2026';
  await fetch(`${B}/api/v1/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: senha, name: 'Cliente', company: 'Loja' }) });
  const A = await computador('A'); const C = await computador('B');
  const entrar = (c) => c.p.evaluate(async ([e, s]) => { await window.BackendClient.login(e, s); return window.BackendClient.isConnected(); }, [email, senha]);
  const usar = (c) => c.p.evaluate(async () => {
    try { await window.BackendClient.get('/api/v1/auth/me'); return { ok: true, conectado: window.BackendClient.isConnected() }; } catch (e) { return { ok: false, erro: e.code || e.message, conectado: window.BackendClient.isConnected() }; }
  });
  const out = {};
  out.A_entra = await entrar(A);
  out.A_usa = await usar(A);
  out.B_entra = await entrar(C);
  out.A_depois_do_B = await usar(A);
  out.B_usa = await usar(C);
  out.A_entra_de_novo = await entrar(A);
  out.B_depois = await usar(C);
  await A.ctx.close(); await C.ctx.close();
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
