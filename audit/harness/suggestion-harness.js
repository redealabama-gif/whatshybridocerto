#!/usr/bin/env node
/**
 * Auditoria IA — Sugestão de resposta REAL (modules/ai-suggestion-fixed.js) no
 * Chromium. Mede O QUE a extensão manda ao backend (última mensagem + histórico)
 * em dois DOMs:
 *   - "antigo": .message-in / .message-out (o que o código espera);
 *   - "atual":  formato observado no WhatsApp real do usuário (diagnóstico
 *               WHL_RecoverDiag/DOM): linhas com data-id = só o id, SEM
 *               .message-in/.message-out e com UM único data-testid="msg-container".
 * BackendClient é um dublê que registra a chamada e devolve uma resposta.
 *
 * Uso: node audit/harness/suggestion-harness.js
 * Saída: audit/evidencias/40-sugestao-contexto.{json,md}
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const EXT = path.resolve(__dirname, '../../whatshybrid-extension');
const OUT = path.resolve(__dirname, '../evidencias');
const SRC = fs.readFileSync(path.join(EXT, 'modules/ai-suggestion-fixed.js'), 'utf8');

const { CONV, bubbleOld, bubbleNew, page } = require('./wa-dom');

const STUBS = `
window.chrome = { runtime: { id: 'x', sendMessage(){}, onMessage: { addListener(){} }, getURL: (p) => p }, storage: { local: { get(k, cb){ if (cb) { cb({}); return; } return Promise.resolve({}); }, set(o, cb){ if (cb) cb(); return Promise.resolve(); } }, onChanged: { addListener(){} } } };
window.__calls = [];
window.BackendClient = { isConnected: () => true, _initialized: true, getBaseUrl: () => 'http://127.0.0.1:3000',
  ai: { process: async (chatId, message, opts) => { window.__calls.push({ chatId, message, history: opts && opts.history, language: opts && opts.language }); return { success: true, response: 'RESPOSTA DO BACKEND', metadata: { intent: 'pricing' } }; } } };
window.CopilotEngine = { getActivePersona: () => null };
`;

async function run(browser, label, html) {
  const p = await browser.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route('https://web.whatsapp.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await p.goto('https://web.whatsapp.com/');
  await p.addScriptTag({ content: STUBS });
  await p.addScriptTag({ content: SRC });
  await p.waitForSelector('#whl-ai-btn-fixed', { timeout: 8000 });
  await p.evaluate(() => window.AISuggestionFixed.generateSuggestion());
  await p.waitForTimeout(9000);
  const r = await p.evaluate(() => ({ calls: window.__calls, panel: document.getElementById('whl-ai-panel-fixed')?.innerText?.slice(0, 200) }));
  await p.close();
  return { label, ...r, errors: errs };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
  const old = await run(browser, 'DOM antigo (.message-in/.message-out)', page(CONV.map(bubbleOld).join('')));
  const cur = await run(browser, 'DOM atual — msg-container no 1º balão', page(CONV.map((m, i) => bubbleNew(m, i, 0)).join('')));
  const curLast = await run(browser, 'DOM atual — msg-container no último balão', page(CONV.map((m, i) => bubbleNew(m, i, CONV.length - 1)).join('')));
  await browser.close();
  const md = ['# Sugestão de resposta: o que a extensão envia ao backend', '', `Conversa real na tela (${CONV.length} mensagens). Última do cliente: "${CONV[CONV.length - 1][1]}"`, ''];
  for (const r of [old, cur, curLast]) {
    const c = r.calls[0];
    md.push(`## ${r.label}`);
    if (!c) { md.push(`- **nenhuma chamada ao backend** · painel: ${JSON.stringify(r.panel)} · erros: ${JSON.stringify(r.errors)}`, ''); continue; }
    md.push(`- mensagem respondida (lastUserMsg): ${JSON.stringify(c.message)}`);
    md.push(`- histórico enviado: ${Array.isArray(c.history) ? c.history.length : 0} mensagens → ${JSON.stringify(c.history)}`);
    md.push(`- language: ${c.language} · chatId: ${c.chatId}`, '');
  }
  fs.writeFileSync(path.join(OUT, '40-sugestao-contexto.json'), JSON.stringify({ old, cur, curLast }, null, 2));
  fs.writeFileSync(path.join(OUT, '40-sugestao-contexto.md'), md.join('\n') + '\n');
  console.log(md.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
