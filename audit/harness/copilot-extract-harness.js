#!/usr/bin/env node
/**
 * Auditoria IA — CopilotEngine.extractMessagesFromDOM (usado pelo histórico do
 * Autopilot e pelo fallback local) nos DOMs antigo × atual do WhatsApp.
 * Uso: node audit/harness/copilot-extract-harness.js
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { CONV, bubbleOld, bubbleNew, page, CHROME_STUB } = require('./wa-dom');
const EXT = process.env.EXT_DIR || path.resolve(__dirname, '../../whatshybrid-extension');
const TAG = process.env.TAG || '';
const SRC = fs.readFileSync(path.join(EXT, 'modules/copilot-engine.js'), 'utf8');
const lines = [];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
  const variants = [
    ['antigo', page(CONV.map(bubbleOld).join(''))],
    ['atual (msg-container no 1º balão)', page(CONV.map((m, i) => bubbleNew(m, i, 0)).join(''))],
    ['atual (msg-container no último balão)', page(CONV.map((m, i) => bubbleNew(m, i, CONV.length - 1)).join(''))],
  ];
  for (const [label, html] of variants) {
    const p = await b.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.route('https://web.whatsapp.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await p.goto('https://web.whatsapp.com/');
    await p.addScriptTag({ content: CHROME_STUB });
    await p.addScriptTag({ content: SRC });
    const r = await p.evaluate(() => {
      const E = window.CopilotEngine;
      const f = (n) => (E.extractMessagesFromDOM(n) || []).map((m) => `${m.role}: ${m.content}`);
      return { com30: f(30), semArg: f(undefined) };
    });
    lines.push(`- DOM ${label}: extractMessagesFromDOM(30) → **${r.com30.length}** msgs ${JSON.stringify(r.com30)}`);
    lines.push(`  extractMessagesFromDOM() (sem argumento, como em copilot-engine.js:1054) → **${r.semArg.length}** msgs ${JSON.stringify(r.semArg)}${errs.length ? ' · erros=' + errs.length : ''}`);
    await p.close();
  }
  await b.close();
  const md = ['# CopilotEngine.extractMessagesFromDOM — DOM antigo × atual', '', `Conversa com ${CONV.length} mensagens.`, '', ...lines];
  const outFile = TAG ? path.resolve(__dirname, `../evidencias/fase2/matriz/41-copilot-extracao-${TAG}.md`) : path.resolve(__dirname, '../evidencias/41-copilot-extracao.md');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, md.join('\n') + '\n');
  console.log(md.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
