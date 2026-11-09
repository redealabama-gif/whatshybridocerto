/**
 * Ambiente WhatsApp Web simulado para carregar o autopilot REAL
 * (modules/smartbot-autopilot-v2.js) em Node — mesma técnica do
 * autopilot-multi-chat.test.js, parametrizável por teste:
 *
 *   makeEnv({ process, canAutoSendSmart })
 *     process(chatId, text, opts)  → o que BackendClient.ai.process devolve
 *     canAutoSendSmart(message)    → decisão do ConfidenceSystem
 *
 * O nome começa com "_" para o run-all.js não tratá-lo como arquivo de teste.
 */
const path = require('path');

const MODULE = path.join(__dirname, '../../modules/smartbot-autopilot-v2.js');

function makeEnv(opts = {}) {
  const stateRef = {
    activeChat: '0000@c.us',
    lastTyped: '',
    sendLog: [],         // { chat, text } por envio efetivado
    runtimeEvents: [],   // eventos WHL_AUTOPILOT_EVENT
    runtimeMessages: [], // tudo que foi para chrome.runtime.sendMessage
    backendCalls: [],    // chamadas a BackendClient.ai.process
  };

  const inputEl = { focus() {}, dispatchEvent() {}, textContent: '' };
  const sendBtn = {
    click() { stateRef.sendLog.push({ chat: stateRef.activeChat, text: stateRef.lastTyped }); },
  };
  const confirmEl = { querySelector: () => ({}) };

  const document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ href: '', click() {} }),
    querySelector: (sel) => {
      const s = String(sel);
      if (s.includes('data-id')) {
        if (!stateRef.activeChat) return null;
        return { getAttribute: (a) => (a === 'data-id' ? `false_${stateRef.activeChat}_MSGID` : null) };
      }
      if (s.includes('message-out')) return confirmEl;
      if (s.includes('contenteditable') || s.includes('compose-box-input')) return inputEl;
      if (s.includes('data-testid="send"') || s.includes('data-icon="send"') || s.includes('Enviar')) return sendBtn;
      return null;
    },
  };

  const msgListeners = [];
  const window = {
    location: { origin: 'https://web.whatsapp.com' },
    addEventListener: (t, fn) => { if (t === 'message') msgListeners.push(fn); },
    removeEventListener: (t, fn) => { const i = msgListeners.indexOf(fn); if (i >= 0) msgListeners.splice(i, 1); },
    postMessage: (data) => {
      if (data && data.source === 'WHL_ISOLATED' && data.type === 'getActiveChat') {
        Promise.resolve().then(() => {
          const ev = { source: window, data: { source: 'WHL_PAGE_BRIDGE', type: 'RESPONSE', requestId: data.requestId, data: { id: stateRef.activeChat } } };
          msgListeners.slice().forEach((fn) => { try { fn(ev); } catch (_) {} });
        });
      }
    },
    dispatchEvent: () => {},
  };

  const handlers = {};
  const ebBase = {
    on: (evt, fn) => { (handlers[evt] = handlers[evt] || []).push(fn); },
    once: (evt, fn) => { (handlers[evt] = handlers[evt] || []).push(fn); },
    emit: (evt, data) => { (handlers[evt] || []).slice().forEach((fn) => { try { fn(data); } catch (_) {} }); },
    off: () => {},
  };
  window.EventBus = new Proxy(ebBase, { get: (t, p) => (p in t ? t[p] : () => {}) });
  window.WHL_EVENTS = {};

  window.Store = {
    Chat: { find: async (id) => ({ id: String(id) }) },
    Cmd: { openChatAt: async (chat) => { const id = String(chat && chat.id || ''); if (id) stateRef.activeChat = id; } },
  };

  window.HumanTyping = {
    type: async (_input, text) => { stateRef.lastTyped = String(text); },
    checkRateLimit: () => true,
    maybeRandomLongPause: async () => {},
    recordMessageSent: () => {},
  };

  window.confidenceSystem = {
    initialized: true,
    copilotEnabled: true,
    score: 95,
    getScore: () => 95,
    canAutoSendSmart: opts.canAutoSendSmart || (async () => ({ canSend: true, reason: 'greeting', confidence: 95, answer: null })),
    recordAutoSend: () => {},
  };

  const process = opts.process || (async () => ({
    success: true,
    response: 'Resposta padrão do backend.',
    metadata: { autopilot: { allowAutoSend: true, minConfidence: 70, riskTier: 'low', reasons: [], escalate: false } },
  }));
  window.BackendClient = {
    isConnected: () => true,
    ai: {
      process: async (chatId, text, o) => {
        stateRef.backendCalls.push({ chatId, text });
        return process(chatId, text, o);
      },
    },
  };

  const chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: (m, cb) => {
        stateRef.runtimeMessages.push(m);
        if (m && m.type === 'WHL_AUTOPILOT_EVENT') stateRef.runtimeEvents.push({ event: m.event, detail: m.detail });
        if (typeof opts.onRuntimeMessage === 'function') return opts.onRuntimeMessage(m, cb);
        // service worker de uma aba só: a reserva da mensagem (IA-05) é concedida
        if (m && m.type === 'WHL_AUTOPILOT_CLAIM' && typeof cb === 'function') return cb({ granted: true });
        if (typeof cb === 'function') cb(undefined);
        return undefined;
      },
      lastError: null,
    },
  };

  return { window, document, chrome, stateRef, handlers };
}

function loadAutopilot(env) {
  delete require.cache[require.resolve(MODULE)];
  global.window = env.window;
  global.document = env.document;
  global.chrome = env.chrome;
  global.navigator = { userAgent: 'node-test' };
  require(MODULE);
  const AP = env.window.AutopilotV2;
  const noop = () => {};
  env.restore = () => {
    try { AP && AP.stop && AP.stop(); } catch (_) {}
    global.window = {
      addEventListener: noop, removeEventListener: noop,
      postMessage: noop, dispatchEvent: noop, location: { origin: '' },
      WHL_EVENTS: {},
      EventBus: new Proxy({ on: noop, once: noop, emit: noop, off: noop }, { get: (t, p) => (p in t ? t[p] : noop) }),
    };
    global.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ click: noop }) };
    global.chrome = {
      runtime: { sendMessage: noop, onMessage: { addListener: noop }, lastError: null },
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, session: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: noop } },
    };
    global.navigator = { userAgent: 'node-test' };
  };
  return AP;
}

const FAST = { delay: { min: 0, max: 1 }, typingDelay: { min: 0, max: 1 }, minConfidence: 50, SKIP_GROUPS: true, DELAY_BETWEEN_CHATS: 0, MAX_RESPONSES_PER_HOUR: 100000 };

function incoming(phone, body, i = 0) {
  return { fromMe: false, from: `${phone}@c.us`, chatId: `${phone}@c.us`, body, messageId: `m_${phone}_${i}`, timestamp: Date.now() + i };
}

async function waitFor(predicate, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

/**
 * Roda UMA mensagem pelo autopilot e devolve o desfecho:
 * { sent: [{chat,text}], suggestionOnly: [{reason,...}], backendCalls }
 */
async function runOne(envOpts, phone, body) {
  const env = makeEnv(envOpts);
  const suggestionOnly = [];
  env.window.EventBus.on('autopilot:suggestion-only', (d) => suggestionOnly.push({ reason: d && d.reason, primaryReason: d && d.primaryReason }));
  const AP = loadAutopilot(env);
  try {
    AP.setConfig(FAST);
    await AP.start();
    env.window.EventBus.emit('message:received', incoming(phone, body));
    await waitFor(() => env.stateRef.sendLog.length > 0 || suggestionOnly.length > 0);
    // pequena folga: um envio indevido logo depois do evento também conta
    await new Promise((r) => setTimeout(r, 300));
    return { sent: env.stateRef.sendLog.slice(), suggestionOnly, backendCalls: env.stateRef.backendCalls.length, env };
  } finally { env.restore(); }
}

module.exports = { makeEnv, loadAutopilot, incoming, waitFor, runOne, FAST };
