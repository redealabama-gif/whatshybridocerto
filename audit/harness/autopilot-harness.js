#!/usr/bin/env node
/**
 * Auditoria IA — Autopilot REAL (modules/smartbot-autopilot-v2.js) num Chromium,
 * contra um WhatsApp simulado (DOM mínimo: chat aberto, campo de texto, botão
 * enviar que registra o que foi "enviado"). NADA é enviado a ninguém.
 *
 * Dublês: confidenceSystem, BackendClient.ai.process, CopilotEngine, EventBus,
 * chrome.* — cada cenário define o que o backend/sistema de confiança devolvem.
 *
 * Uso: node audit/harness/autopilot-harness.js
 * Saída: audit/evidencias/30-autopilot.{json,md}
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const EXT = path.resolve(__dirname, '../../whatshybrid-extension');
const OUT = path.resolve(__dirname, '../evidencias');
const SRC = fs.readFileSync(path.join(EXT, 'modules/smartbot-autopilot-v2.js'), 'utf8');
const CHAT = '5511999990001@c.us';

const PAGE = `<!doctype html><html><body>
<div id="main"><header><span title="Cliente Teste">Cliente Teste</span></header>
<div id="msgs"><div data-id="false_${CHAT}_3EB0AAAA0000000001" class="message-in">oi</div></div>
<footer><div contenteditable="true" role="textbox" id="box"></div>
<button data-testid="send" id="send">enviar</button></footer></div>
<script>
window.__sent = [];
document.getElementById('send').addEventListener('click', () => {
  const box = document.getElementById('box');
  const text = box.innerText || box.textContent;
  window.__sent.push(text);
  const d = document.createElement('div'); d.className = 'message-out';
  d.innerHTML = '<span>' + text + '</span><span data-icon="msg-check"></span>';
  document.getElementById('msgs').appendChild(d); box.textContent = '';
});
</script></body></html>`;

// Dublês por cenário (string avaliada na página)
const STUBS = (sc) => `
(function(){
  const store = {};
  window.chrome = { runtime: { id: 'x', sendMessage(m){ (window.__rt = window.__rt || []).push(m); }, onMessage: { addListener(){} }, getURL: (p) => p },
    storage: { onChanged: { addListener(){} }, local: {
      get(k, cb){ const r = {}; if (cb) { cb(r); return; } return Promise.resolve(r); },
      set(o, cb){ Object.assign(store, o); if (cb) { cb(); return; } return Promise.resolve(); },
      remove(k, cb){ if (cb) { cb(); return; } return Promise.resolve(); } } } };
  const h = {};
  window.EventBus = { on(e, f){ (h[e] = h[e] || []).push(f); }, emit(e, d){ (window.__bus = window.__bus || []).push([e, d && d.reason]); (h[e] || []).forEach((f) => { try { f(d); } catch(_){} }); }, off(){} };
  window.__backendCalls = 0;
  const SC = ${JSON.stringify(sc)};
  window.confidenceSystem = { initialized: true, copilotEnabled: true, score: SC.score, getScore: () => SC.score,
    canAutoSendSmart: async () => SC.confidence, recordAutoSend(){} };
  window.BackendClient = { isConnected: () => SC.backend !== 'offline', ai: { process: async () => {
    window.__backendCalls++;
    if (SC.backend === 'offline') throw Object.assign(new Error('Failed to fetch'), { status: 0 });
    return SC.backend; } } };
  window.CopilotEngine = { getActivePersona: () => null, loadConversationContext: async () => {}, analyzeMessage: async () => ({}),
    generateResponse: async () => ({ content: 'Resposta do fallback local (sem guarda)' }) };
})();`;

const SCENARIOS = [
  { id: 'A_guard_bloqueia', desc: 'Backend OK com guarda allowAutoSend=false (controle)', msg: 'Quero cancelar e falar com um humano',
    sc: { score: 95, confidence: { canSend: true, reason: 'ai_will_generate', answer: null },
      backend: { success: true, response: 'Claro, vou te ajudar com o cancelamento.', metadata: { autopilot: { allowAutoSend: false, escalate: true, reasons: ['human_requested'], riskTier: 'high', minConfidence: 101 } } } } },
  { id: 'B_sem_guarda', desc: 'Backend OK mas SEM metadata.autopilot (backend antigo / WHL_AUTOPILOT_GUARD=0)', msg: 'Quero meu dinheiro de volta, vou no Procon',
    sc: { score: 95, confidence: { canSend: true, reason: 'ai_will_generate', answer: null },
      backend: { success: true, response: 'Claro! Vamos devolver seu dinheiro hoje mesmo.', metadata: {} } } },
  { id: 'C_backend_offline', desc: 'Backend fora do ar → fallback local (controle)', msg: 'Qual o horário de vocês?',
    sc: { score: 95, confidence: { canSend: true, reason: 'ai_will_generate', answer: null }, backend: 'offline' } },
  { id: 'D_faq_sem_backend', desc: 'Sistema de confiança devolve resposta de FAQ (faq_match) — reclamação/pedido de humano', msg: 'Péssimo atendimento! Qual o prazo de entrega? Quero falar com um humano agora',
    sc: { score: 95, confidence: { canSend: true, reason: 'faq_match', confidence: 90, answer: 'Nosso prazo de entrega é de 5 a 7 dias úteis.' },
      backend: { success: true, response: 'x', metadata: { autopilot: { allowAutoSend: false, reasons: ['human_requested'] } } } } },
  { id: 'E_preco_inventado', desc: 'Pergunta de PREÇO sem base; backend classifica como saudação e libera (como no cenário S1 do backend)', msg: 'Oi, quanto custa o plano mensal de vocês? Tem desconto no anual?',
    sc: { score: 90, confidence: { canSend: true, reason: 'ai_will_generate', answer: null },
      backend: { success: true, response: 'O plano mensal custa R$ 97 e no anual você ganha 2 meses grátis!', metadata: { intent: 'greeting', autopilot: { allowAutoSend: true, escalate: false, reasons: [], riskTier: 'low', minConfidence: 70 } } } } },
];

async function runScenario(browser, s) {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => { const t = m.text(); if (/Autopilot/.test(t)) logs.push(t.slice(0, 200)); });
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await page.route('https://web.whatsapp.com/**', (r) => r.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.goto('https://web.whatsapp.com/');
  await page.addScriptTag({ content: STUBS(s.sc) });
  await page.addScriptTag({ content: SRC });
  await page.evaluate(() => {
    window.AutopilotV2.setConfig({ delay: { min: 50, max: 100 }, typingDelay: { min: 0, max: 1 }, DELAY_BETWEEN_CHATS: 0, MAX_RESPONSES_PER_HOUR: 100 });
    return window.AutopilotV2.start();
  });
  await page.evaluate(({ chat, msg }) => window.EventBus.emit('message:received', { chatId: chat, message: msg, fromMe: false, messageId: '3EB0INCOMING' + Math.random().toString(16).slice(2, 8), timestamp: Date.now() }), { chat: CHAT, msg: s.msg });
  await page.waitForTimeout(9000);
  const res = await page.evaluate(() => ({ sent: window.__sent, backendCalls: window.__backendCalls, bus: (window.__bus || []).filter((b) => b[0] !== 'message:received'), stats: window.AutopilotV2.getStats() }));
  await page.close();
  return { ...s, ...res, logs: logs.slice(-8) };
}

async function twoTabs(browser) {
  const sc = SCENARIOS[4].sc; // backend libera
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const page = await browser.newPage();
    await page.route('https://web.whatsapp.com/**', (r) => r.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto('https://web.whatsapp.com/');
    await page.addScriptTag({ content: STUBS(sc) });
    await page.addScriptTag({ content: SRC });
    await page.evaluate(() => { window.AutopilotV2.setConfig({ delay: { min: 50, max: 100 }, typingDelay: { min: 0, max: 1 }, DELAY_BETWEEN_CHATS: 0 }); return window.AutopilotV2.start(); });
    pages.push(page);
  }
  // a MESMA mensagem do cliente chega nas duas abas do WhatsApp Web
  const evt = { chatId: CHAT, message: 'Bom dia! Vocês abrem sábado?', fromMe: false, messageId: '3EB0SAMEMSG0001', timestamp: Date.now() };
  await Promise.all(pages.map((p) => p.evaluate((e) => window.EventBus.emit('message:received', e), evt)));
  await pages[0].waitForTimeout(9000);
  const res = await Promise.all(pages.map((p) => p.evaluate(() => ({ sent: window.__sent, tabCoordinator: typeof window.TabCoordinator, killSwitch: typeof window.KillSwitch }))));
  for (const p of pages) await p.close();
  return res;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
  const results = [];
  for (const s of SCENARIOS) results.push(await runScenario(browser, s));
  const tabs = await twoTabs(browser);
  await browser.close();

  const md = ['# Autopilot real no Chromium (WhatsApp simulado, dublês de backend)', '', '| cenário | mensagem do cliente | ENVIADO ao cliente? | texto enviado | chamadas ao backend | evento |', '|---|---|---|---|---|---|'];
  for (const r of results) {
    md.push(`| ${r.id} — ${r.desc} | ${r.msg} | ${r.sent.length ? '**SIM**' : 'não'} | ${r.sent.map((t) => JSON.stringify(t)).join(' / ') || '—'} | ${r.backendCalls} | ${r.bus.map((b) => b.join(':')).join(', ') || '—'} |`);
  }
  md.push('', '## Duas abas do WhatsApp Web abertas, mesma mensagem recebida', '');
  tabs.forEach((t, i) => md.push(`- aba ${i + 1}: enviou ${t.sent.length}x ${JSON.stringify(t.sent)} · window.TabCoordinator=${t.tabCoordinator} · window.KillSwitch=${t.killSwitch}`));
  md.push(`- **total de respostas enviadas ao MESMO cliente: ${tabs.reduce((a, t) => a + t.sent.length, 0)}**`);
  fs.writeFileSync(path.join(OUT, '30-autopilot.json'), JSON.stringify({ results, tabs }, null, 2));
  fs.writeFileSync(path.join(OUT, '30-autopilot.md'), md.join('\n') + '\n');
  console.log(md.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
