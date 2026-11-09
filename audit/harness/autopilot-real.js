#!/usr/bin/env node
/**
 * Verificação de aceitação — AUTOPILOT com IA REAL.
 *
 * Módulos REAIS da extensão (smartbot-autopilot-v2, confidence-system,
 * knowledge-base, copilot-engine) num Chromium, contra um WhatsApp simulado no
 * formato ATUAL da página (data-id só com o id da mensagem), e o backend REAL
 * (start-backend-real.sh) com a chave de IA real. NADA é enviado a ninguém: o
 * "enviar" do WhatsApp simulado só registra o texto.
 *
 * Dublês (e por quê):
 *  - a ponte com a Store do WhatsApp responde só "qual chat está aberto"
 *    (no WhatsApp real quem responde é a Store; isso só se confirma lá);
 *  - BackendClient: a mesma chamada HTTP do backend-client.js, feita pelo Node
 *    (evita CORS da página simulada), com o mesmo formato de erro;
 *  - a trava entre abas do service worker: um mapa compartilhado (a lógica real
 *    tem teste próprio: ext/tests/unit/autopilot-multi-tab.test.js);
 *  - EventBus e chrome.storage: implementações mínimas em memória.
 *
 * Uso: node audit/harness/autopilot-real.js <backend> <db-path> [saida.json]
 * Pré-requisito: backend real no ar (start-backend-real.sh) com chave de IA.
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const B = process.argv[2] || 'http://127.0.0.1:3000';
const DB_PATH = process.argv[3];
const OUT = process.argv[4] || path.resolve(__dirname, '../evidencias/fase3/60-autopilot-real.json');
const EXT = path.resolve(__dirname, '../../whatshybrid-extension');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
const MODULES = ['modules/confidence-system.js', 'modules/knowledge-base.js', 'modules/copilot-engine.js', 'modules/smartbot-autopilot-v2.js'].map((f) => [f, read(f)]);

// ── Treinamento da clínica (sintético) — o mesmo no backend e na base local ──
const TRAINING = {
  faqs: [
    { id: 'faq-horario', question: 'Qual o horário de funcionamento?', answer: 'Atendemos de segunda a sexta, das 8h às 18h, e aos sábados das 8h às 12h.' },
    { id: 'faq-convenio', question: 'Vocês aceitam convênio?', answer: 'Aceitamos Amil Dental, OdontoPrev e SulAmérica Odonto.' },
    { id: 'faq-endereco', question: 'Onde fica a clínica?', answer: 'Ficamos na Rua das Flores, 120, sala 3, Centro.' },
  ],
  products: [
    { id: 'prod-clareamento', name: 'Clareamento dental', price: 650, description: 'Clareamento no consultório, sessão de 1 hora.', category: 'Estética', stock: 99 },
    { id: 'prod-limpeza', name: 'Limpeza (profilaxia)', price: 180, description: 'Limpeza completa com raspagem e polimento.', category: 'Prevenção', stock: 99 },
  ],
  businessInfo: { name: 'Clínica Sorriso Fácil', description: 'Clínica odontológica', hours: 'Seg a sex 8h–18h; sáb 8h–12h', address: 'Rua das Flores, 120, sala 3, Centro', payment: 'PIX ou cartão em até 6x' },
};

// Conversas (o histórico que está na tela) — 'in' = contato, 'out' = dono da conta.
const CLINICA = [['in', 'Boa tarde! Vi o perfil de vocês no Instagram'], ['out', 'Boa tarde! Que bom que chamou 😊 Como posso ajudar?']];
const PESSOAL = [['in', 'Você prometeu e não cumpriu de novo'], ['out', 'Calma, deixa eu te explicar']];
const AMIGO = [['in', 'E aí, sumido!'], ['out', 'Fala! Correria aqui kkk']];

const MADURA = { copilot: true, feedbackGood: 55 }; // ~96% de confiança (55 aprovações)
const SCENARIOS = [
  { id: 'S01_conta_nova', desc: 'Conta nova (confiança 0, modo copiloto desligado) — FAQ coberta', conf: { copilot: false, feedbackGood: 0 }, conv: CLINICA, msg: 'Qual o horário de funcionamento de vocês?' },
  { id: 'S02_faq', desc: 'Conta madura — pergunta coberta por FAQ', conf: MADURA, conv: CLINICA, msg: 'Qual o horário de funcionamento de vocês?' },
  { id: 'S03_produto', desc: 'Conta madura — preço de produto cadastrado', conf: MADURA, conv: CLINICA, msg: 'Quanto custa o clareamento?' },
  { id: 'S04_sem_base', desc: 'Conta madura — pergunta sem base', conf: MADURA, conv: CLINICA, msg: 'Vocês atendem em domicílio?' },
  { id: 'S05_preco_sem_base', desc: 'Conta madura — preço de serviço NÃO cadastrado', conf: MADURA, conv: CLINICA, msg: 'Quanto custa um implante?' },
  { id: 'S06_reclamacao', desc: 'Conta madura — reclamação e cancelamento', conf: MADURA, conv: CLINICA, msg: 'Oi, quero cancelar minha consulta, o atendimento foi péssimo' },
  { id: 'S07_pessoal', desc: 'Conta madura — conversa pessoal tensa', conf: MADURA, conv: PESSOAL, msg: 'Melhor a gente não se falar hoje' },
  { id: 'S08_cumprimento_pessoal', desc: 'Conta madura — cumprimento de um amigo (conversa pessoal)', conf: MADURA, conv: AMIGO, msg: 'Boa noite! Tudo bem?' },
  { id: 'S09_cumprimento_cliente', desc: 'Conta madura — cumprimento de cliente', conf: MADURA, conv: CLINICA, msg: 'Bom dia!' },
  { id: 'S10_grupo', desc: 'Conta madura — mensagem em grupo', conf: MADURA, conv: CLINICA, msg: 'Qual o horário de funcionamento?', group: true },
  { id: 'S13_outra_conversa', desc: 'Conta madura — FAQ chega numa conversa que NÃO está aberta (sem o abridor do content.js nesta página)', conf: MADURA, conv: CLINICA, msg: 'Qual o horário de funcionamento de vocês?', activeOther: true },
];

async function http(method, url, body, token) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90000) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch (_) { json = { _text: text.slice(0, 300) }; }
  return { status: r.status, json };
}

const bubble = ([dir, text], i) => `<div role="row"><div data-id="3EB0AP${String(i).padStart(14, '0')}">${i === 0 ? '<div data-testid="msg-container">' : '<div>'}
  <div class="copyable-text" data-pre-plain-text="[09:0${i}] X: "><span class="selectable-text copyable-text"><span>${text}</span></span></div>
  ${dir === 'out' ? '<span data-icon="msg-dblcheck"></span>' : ''}</div></div></div>`;
const page = (title, conv) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="main"><header><span title="${title}">${title}</span></header>
<div data-testid="conversation-panel-messages" id="msgs">${conv.map(bubble).join('')}</div>
<footer><div contenteditable="true" role="textbox" id="box"></div><button data-testid="send" id="send">enviar</button></footer></div>
<script>
window.__sent = [];
document.getElementById('send').addEventListener('click', () => {
  const box = document.getElementById('box');
  const text = (box.innerText || box.textContent || '').trim();
  if (!text) return;
  window.__sent.push(text);
  const n = document.querySelectorAll('#msgs [data-id]').length;
  const row = document.createElement('div'); row.setAttribute('role', 'row');
  row.innerHTML = '<div data-id="3EB0SENT' + String(n).padStart(12, '0') + '"><div class="copyable-text"><span class="selectable-text copyable-text"><span></span></span></div><span data-icon="msg-check"></span></div>';
  row.querySelector('span span').textContent = text;
  document.getElementById('msgs').appendChild(row); box.textContent = '';
});
</script></body></html>`;

// Dublês mínimos, avaliados ANTES dos módulos reais.
const STUBS = (chatId) => `
(function(){
  const mem = {};
  const get = (keys) => { const o = {}; (Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(mem))).forEach((k) => { if (k in mem) o[k] = mem[k]; }); return o; };
  window.chrome = { runtime: { id: 'x', lastError: null, getURL: (p) => p, onMessage: { addListener(){} },
    sendMessage(m, cb) {
      if (m && m.type === 'WHL_AUTOPILOT_CLAIM') { window.__claim(m.key).then((r) => { if (typeof cb === 'function') cb(r); }); return; }
      if (typeof cb === 'function') cb(undefined); return Promise.resolve(undefined);
    } },
    storage: { onChanged: { addListener(){} }, local: {
      get(k, cb){ const r = get(k); if (cb) { cb(r); return; } return Promise.resolve(r); },
      set(o, cb){ Object.assign(mem, o); if (cb) { cb(); return; } return Promise.resolve(); },
      remove(k, cb){ (Array.isArray(k) ? k : [k]).forEach((x) => delete mem[x]); if (cb) { cb(); return; } return Promise.resolve(); },
      getBytesInUse(_k, cb){ if (cb) cb(0); return Promise.resolve(0); } } } };
  const h = {};
  window.__events = [];
  window.EventBus = { on(e, f){ (h[e] = h[e] || []).push(f); }, off(){}, emit(e, d){
    if (e !== 'message:received') window.__events.push({ e, reason: d && d.reason, primaryReason: d && d.primaryReason, escalation: d && d.escalation, suggestion: d && d.suggestion, score: d && d.score });
    (h[e] || []).forEach((f) => { try { f(d); } catch (_) {} }); } };
  // Ponte com a Store do WhatsApp: só "qual chat está aberto" (dublê).
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || d.source !== 'WHL_ISOLATED') return;
    if (d.type === 'getActiveChat') window.postMessage({ source: 'WHL_PAGE_BRIDGE', type: 'RESPONSE', requestId: d.requestId, data: { id: ${JSON.stringify(chatId)} } }, window.location.origin);
  });
  // BackendClient: mesma chamada e mesmo formato de erro do backend-client.js.
  window.BackendClient = { isConnected: () => true, ai: { process: async (chatId, message, options = {}) => {
    const r = await window.__api('/api/v2/ai/process', { chatId, message, language: options.language || 'pt-BR', businessRules: options.businessRules || [], persona: options.persona || null, history: Array.isArray(options.history) ? options.history : [] });
    if (r.status >= 400) { const err = new Error((r.json && (r.json.message || r.json.error)) || ('HTTP ' + r.status)); err.status = r.status; err.code = (r.json && r.json.code) || ('HTTP_' + r.status); err.body = r.json; throw err; }
    return r.json;
  } } };
})();`;

async function openScenarioPage(browser, sc, ctx, tabTag) {
  const chatId = sc.group ? '120363000000000001@g.us' : `55119${sc.id.slice(1, 3)}0000001@c.us`;
  // Chat que a ponte diz estar ABERTO: o mesmo da mensagem, salvo no cenário "outra conversa".
  const activeChatId = sc.activeOther ? '5511900000000001@c.us' : chatId;
  const pg = await browser.newPage();
  const logs = [];
  pg.on('console', (m) => { const t = m.text(); if (/Autopilot|Confidence/.test(t)) logs.push(t.slice(0, 240)); });
  pg.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message.slice(0, 200)));
  pg.on('framenavigated', (f) => { if (f === pg.mainFrame()) logs.push('NAVEGOU ' + f.url().slice(0, 160)); });
  await pg.route('https://web.whatsapp.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: page(sc.conv === CLINICA ? 'Cliente Clínica' : 'Contato', sc.conv) }));
  await pg.exposeFunction('__claim', (key) => ctx.claim(key, tabTag || sc.id));
  await pg.exposeFunction('__api', async (p, body) => {
    const r = await http('POST', `${B}${p}`, body, ctx.token);
    ctx.calls.push({ scenario: sc.id, tab: tabTag || null, path: p, status: r.status, request: { message: body.message, historyCount: (body.history || []).length },
      response: r.json && { success: r.json.success, response: r.json.response, error: r.json.error, intent: r.json.metadata && r.json.metadata.intent, autopilot: r.json.metadata && r.json.metadata.autopilot } });
    return r;
  });
  await pg.goto('https://web.whatsapp.com/');
  await pg.addScriptTag({ content: STUBS(activeChatId) });
  for (const [f, src] of MODULES) {
    try { await pg.addScriptTag({ content: src }); } catch (e) { logs.push(`LOAD ${f}: ${e.message.slice(0, 160)}`); }
  }
  // Treinamento na base LOCAL (a mesma que a tela de treinamento grava) e confiança do cenário.
  await pg.evaluate(async ({ t, conf }) => {
    const kb = window.knowledgeBase;
    if (kb && kb.init && !kb.initialized) { try { await kb.init(); } catch (_) {} }
    for (const f of t.faqs) await kb.addFAQ(f.question, f.answer, 'Geral');
    for (const p of t.products) await kb.addProduct({ name: p.name, price: p.price, description: p.description, category: p.category, stock: p.stock });
    const cs = window.confidenceSystem;
    if (cs.init && !cs.initialized) { try { await cs.init(); } catch (_) {} }
    cs.metrics.feedbackGood = conf.feedbackGood;
    cs.calculateScore();
    cs.copilotEnabled = !!conf.copilot;
    window.AutopilotV2.setConfig({ delay: { min: 100, max: 200 }, typingDelay: { min: 0, max: 1 }, DELAY_BETWEEN_CHATS: 0, MAX_RESPONSES_PER_HOUR: 100, WORKING_HOURS: { enabled: false } });
    await window.AutopilotV2.start();
  }, { t: TRAINING, conf: sc.conf });
  return { pg, chatId, logs };
}

async function waitDone(pg, ms = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await pg.evaluate(() => {
      if (!window.AutopilotV2) return { gone: true };
      const st = window.AutopilotV2.getStats();
      return { sent: window.__sent.length, events: window.__events.filter((e) => /suggestion-only|stopped/.test(e.e)).length, skipped: (st.skippedGroups || 0) + (st.skippedBlacklisted || 0) + (st.skippedNoText || 0), q: (window.AutopilotV2.getQueue ? window.AutopilotV2.getQueue().length : null) };
    });
    if (s.gone) return;
    if (s.sent || s.events || s.skipped) { await pg.waitForTimeout(1500); return; }
    await pg.waitForTimeout(500);
  }
}

async function collect(pg, extra) {
  return pg.evaluate(() => (!window.AutopilotV2 ? { sent: window.__sent || [], events: window.__events || [], stats: null, pageReloaded: true } : { sent: window.__sent, events: window.__events.filter((e) => e.e !== 'confidence:score-changed'), stats: window.AutopilotV2.getStats(), score: window.confidenceSystem && window.confidenceSystem.score, copilot: window.confidenceSystem && window.confidenceSystem.copilotEnabled }))
    .then((r) => ({ ...r, ...extra }));
}

(async () => {
  // Conta, treinamento no backend e um admin para o kill switch.
  const su = await http('POST', `${B}/api/v1/auth/signup`, { email: `ap-real-${Date.now()}@example.com`, password: 'Audit#Senha2026', name: 'Clinica Sorriso Facil', company: 'Clinica Sorriso Facil', plan: 'pro' });
  if (!su.json.accessToken) throw new Error('signup: ' + JSON.stringify(su.json).slice(0, 200));
  const token = su.json.accessToken;
  const sync = await http('POST', `${B}/api/v1/training/sync`, TRAINING, token);
  const claims = new Map();
  const ctx = { token, calls: [], claim: (key, tab) => { const prev = claims.get(key); if (prev !== undefined && prev !== tab) return { granted: false, reason: 'claimed_by_other_tab' }; claims.set(key, tab); return { granted: true }; } };

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
  const results = [];
  const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
  for (const sc of SCENARIOS) {
    if (ONLY && !ONLY.includes(sc.id)) continue;
    const { pg, chatId, logs } = await openScenarioPage(browser, sc, ctx);
    await pg.evaluate(({ chatId, msg, id }) => window.EventBus.emit('message:received', { chatId, message: msg, fromMe: false, messageId: id, timestamp: Date.now() }), { chatId, msg: sc.msg, id: `3EB0IN${sc.id}` });
    await waitDone(pg);
    results.push(await collect(pg, { id: sc.id, desc: sc.desc, msg: sc.msg, chatId, calls: ctx.calls.filter((c) => c.scenario === sc.id), navegacoes: logs.filter((l) => l.startsWith('NAVEGOU')).length - 1, logs: process.env.ALL_LOGS ? logs : logs.slice(-6) }));
    if (process.env.ALL_LOGS) console.log(logs.join('\n'));
    await pg.close();
  }
  if (ONLY && !ONLY.includes('S11_duas_abas') && !ONLY.includes('S12_kill_switch')) { await browser.close(); console.log(JSON.stringify(results.map((r) => ({ id: r.id, sent: r.sent, events: r.events, pageReloaded: r.pageReloaded })), null, 1)); return; }

  // Duas abas do WhatsApp Web, a mesma mensagem chega nas duas.
  const sc2 = { id: 'S11_duas_abas', desc: 'Conta madura — duas abas abertas, mesma mensagem (FAQ)', conf: MADURA, conv: CLINICA, msg: 'Vocês aceitam convênio?' };
  const tabs = [await openScenarioPage(browser, sc2, ctx, 'aba1'), await openScenarioPage(browser, sc2, ctx, 'aba2')];
  const chat2 = tabs[0].chatId;
  await Promise.all(tabs.map((t) => t.pg.evaluate(({ chatId, msg }) => window.EventBus.emit('message:received', { chatId, message: msg, fromMe: false, messageId: '3EB0SAMEMSGAP01', timestamp: Date.now() }), { chatId: chat2, msg: sc2.msg })));
  await Promise.all(tabs.map((t) => waitDone(t.pg)));
  const tabRes = await Promise.all(tabs.map((t, i) => collect(t.pg, { tab: i + 1 })));
  results.push({ id: sc2.id, desc: sc2.desc, msg: sc2.msg, sent: tabRes.flatMap((t) => t.sent), tabs: tabRes.map((t) => ({ tab: t.tab, sent: t.sent, events: t.events })), calls: ctx.calls.filter((c) => c.scenario === sc2.id) });
  for (const t of tabs) await t.pg.close();

  // Kill switch "ai" ligado no backend (admin) — o Autopilot tem de parar sem enviar.
  let ks = { set: null, reset: null };
  if (DB_PATH) {
    // Admin separado, promovido no banco ANTES da 1ª requisição autenticada dele.
    const adm = await http('POST', `${B}/api/v1/auth/signup`, { email: `ap-admin-${Date.now()}@example.com`, password: 'Audit#Senha2026', name: 'Admin Teste', company: 'Admin Teste Kill', plan: 'pro' });
    const Database = require(path.resolve(__dirname, '../../node_modules/better-sqlite3'));
    const db = new Database(DB_PATH); db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', adm.json.user.id); db.close();
    const admToken = adm.json.accessToken;
    ks.set = (await http('POST', `${B}/api/v1/admin/kill-switch/set`, { adminKey: process.env.ADMIN_KILL_SWITCH_KEY || 'CHANGE_ME_IN_PRODUCTION', feature: 'ai', enabled: true }, admToken)).status;
    const sc3 = { id: 'S12_kill_switch', desc: 'Conta madura — kill switch "ai" ligado pelo admin', conf: MADURA, conv: CLINICA, msg: 'Qual o horário de funcionamento de vocês?' };
    const { pg, chatId, logs } = await openScenarioPage(browser, sc3, ctx);
    await pg.evaluate(({ chatId, msg }) => window.EventBus.emit('message:received', { chatId, message: msg, fromMe: false, messageId: '3EB0INKILLSW', timestamp: Date.now() }), { chatId, msg: sc3.msg });
    await waitDone(pg, 20000);
    results.push(await collect(pg, { id: sc3.id, desc: sc3.desc, msg: sc3.msg, chatId, calls: ctx.calls.filter((c) => c.scenario === sc3.id), logs: logs.slice(-6), running: await pg.evaluate(() => window.AutopilotV2.getStats && window.AutopilotV2.isRunning ? window.AutopilotV2.isRunning() : null) }));
    await pg.close();
    ks.reset = (await http('POST', `${B}/api/v1/admin/kill-switch/reset`, { adminKey: process.env.ADMIN_KILL_SWITCH_KEY || 'CHANGE_ME_IN_PRODUCTION' }, admToken)).status;
  }
  await browser.close();

  const out = { generatedAt: new Date().toISOString(), backend: B, trainingSync: sync.json, killSwitch: ks, results };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  const short = (s, n = 160) => (s == null ? '' : String(s).replace(/\s+/g, ' ').slice(0, n));
  for (const r of results) {
    const evs = (r.events || (r.tabs || []).flatMap((t) => t.events) || []).filter((e) => /suggestion-only|stopped|skipped/.test(e.e));
    const call = (r.calls || [])[0];
    console.log(`\n[${r.id}] ${r.desc}\n  msg: "${r.msg}"\n  ENVIADO: ${r.sent && r.sent.length ? r.sent.map((t) => `"${short(t, 220)}"`).join(' | ') : 'não'}${r.navegacoes ? `\n  ⚠️ a página RECARREGOU ${r.navegacoes}x (navegação)` : ''}${r.pageReloaded ? ' (página recarregada)' : ''}`);
    if (evs.length) console.log(`  eventos: ${evs.map((e) => `${e.e}:${e.reason || ''}${e.primaryReason ? '/' + e.primaryReason : ''}`).join(', ')}`);
    const sug = evs.find((e) => e.suggestion);
    if (sug) console.log(`  sugestão p/ revisão: "${short(sug.suggestion, 220)}"`);
    if (call) console.log(`  backend: HTTP ${call.status} intent=${call.response && call.response.intent} guarda=${JSON.stringify(call.response && call.response.autopilot && { allow: call.response.autopilot.allowAutoSend, tier: call.response.autopilot.riskTier, min: call.response.autopilot.minConfidence, reasons: call.response.autopilot.reasons })} hist=${call.request.historyCount}`);
    else console.log('  backend: não chamado');
  }
  console.log(`\nkill switch: set=${ks.set} reset=${ks.reset}; treinamento: ${JSON.stringify(sync.json && (sync.json.synced || sync.json.stats))}`);
})().catch((e) => { console.error(e); process.exit(1); });
