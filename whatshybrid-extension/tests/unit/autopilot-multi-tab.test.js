/**
 * IA-05 — com duas abas do WhatsApp Web abertas, a mesma mensagem é respondida
 * UMA vez. Cada "aba" roda o autopilot REAL num contexto vm próprio (globais
 * isolados, como abas de verdade); o service worker é o handler REAL de
 * background/autopilot-claim.js. Antes: 2 respostas ao mesmo cliente
 * (audit/evidencias/30-autopilot.md).
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');
const { makeEnv, incoming, waitFor, FAST } = require('./_autopilot-env');

const AP_SRC = fs.readFileSync(path.join(__dirname, '../../modules/smartbot-autopilot-v2.js'), 'utf8');
const SW_FILE = path.join(__dirname, '../../background/autopilot-claim.js');
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

// Service worker: carrega o handler real (se existir) num contexto próprio.
function loadServiceWorker() {
  if (!fs.existsSync(SW_FILE)) return null;
  const store = {};
  const ctx = vm.createContext({
    chrome: { storage: { session: { get: async (k) => ({ [k]: store[k] }), set: async (o) => { Object.assign(store, o); } } } },
    console: quiet, setTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(SW_FILE, 'utf8'), ctx);
  return typeof ctx.handleAutopilotClaim === 'function' ? ctx.handleAutopilotClaim : null;
}

function makeTab(tabId, sw) {
  const env = makeEnv({
    onRuntimeMessage: (m, cb) => {
      if (m && m.type === 'WHL_AUTOPILOT_CLAIM' && sw) {
        sw(m, { tab: { id: tabId } }, (r) => { if (typeof cb === 'function') cb(r); });
        return;
      }
      if (typeof cb === 'function') cb(undefined);
    },
  });
  const ctx = vm.createContext({
    window: env.window, document: env.document, chrome: env.chrome,
    navigator: { userAgent: 'node-test' }, console: quiet,
    setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
    CustomEvent: class CustomEvent { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
  });
  vm.runInContext(AP_SRC, ctx);
  return { env, AP: env.window.AutopilotV2 };
}

test('IA-05: duas abas, a mesma mensagem → UMA resposta ao cliente', async () => {
  const sw = loadServiceWorker();
  const tabs = [makeTab(101, sw), makeTab(102, sw)];
  try {
    for (const t of tabs) { t.AP.setConfig(FAST); await t.AP.start(); }
    const m = incoming('5511900000031', 'Bom dia', 7); // mesmo messageId nas duas abas
    for (const t of tabs) t.env.window.EventBus.emit('message:received', { ...m });
    const total = () => tabs.reduce((n, t) => n + t.env.stateRef.sendLog.length, 0);
    await waitFor(() => total() >= 1, 15000);
    await new Promise((r) => setTimeout(r, 4000)); // dá tempo de a 2ª aba (indevidamente) responder
    assert.strictEqual(total(), 1, `respostas enviadas ao mesmo cliente: ${total()}`);
  } finally {
    for (const t of tabs) { try { t.AP.stop(); } catch (_) {} }
  }
});

test('IA-05 (controle): mensagens diferentes nas duas abas → cada uma responde a sua', async () => {
  const sw = loadServiceWorker();
  const tabs = [makeTab(201, sw), makeTab(202, sw)];
  try {
    for (const t of tabs) { t.AP.setConfig(FAST); await t.AP.start(); }
    tabs[0].env.window.EventBus.emit('message:received', incoming('5511900000041', 'Bom dia', 1));
    tabs[1].env.window.EventBus.emit('message:received', incoming('5511900000042', 'Boa tarde', 2));
    const ok = await waitFor(() => tabs.every((t) => t.env.stateRef.sendLog.length === 1), 15000);
    assert.ok(ok, `envios por aba: ${tabs.map((t) => t.env.stateRef.sendLog.length).join(', ')}`);
  } finally {
    for (const t of tabs) { try { t.AP.stop(); } catch (_) {} }
  }
});

test('IA-05: service worker não responde a reserva → NÃO envia (revisão)', async () => {
  const { runOne } = require('./_autopilot-env');
  const r = await runOne({
    onRuntimeMessage: (m, cb) => {
      if (m && m.type === 'WHL_AUTOPILOT_CLAIM') return; // nunca responde
      if (typeof cb === 'function') cb(undefined);
    },
  }, '5511900000051', 'Bom dia');
  assert.strictEqual(r.sent.length, 0, `enviou sem a trava: ${JSON.stringify(r.sent)}`);
  assert.ok(r.suggestionOnly.some((s) => s.reason === 'claim_unavailable'), `esperava claim_unavailable, veio ${JSON.stringify(r.suggestionOnly)}`);
});
