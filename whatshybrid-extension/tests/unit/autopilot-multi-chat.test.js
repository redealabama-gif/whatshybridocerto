/**
 * Certificação do Cenário 1 do autopilot: várias pessoas chamando em
 * sequência, ele abre cada chat, responde e passa pro próximo — SEM enviar a
 * resposta de uma pessoa no chat de outra, e SEM perder mensagem se um chat
 * não abrir.
 *
 * Carrega o módulo REAL (modules/smartbot-autopilot-v2.js) com um WhatsApp Web
 * simulado: Store (abre chat → muda o "chat ativo"), DOM (campo de texto +
 * botão enviar que REGISTRA em qual chat o texto caiu), bridge de chat ativo,
 * ConfidenceSystem e BackendClient. As asserções provam:
 *
 *   1. 3 pessoas em fila → 3 respostas, cada uma no SEU chat (conteúdo casa
 *      com o destino: nada de resposta cruzada).
 *   2. Se o chat NÃO abre (WA falha), nada é enviado às cegas e a mensagem não
 *      se perde (re-enfileira e, esgotado, escala pra revisão humana).
 *   3. Se a mesma pessoa responde de novo, ela é respondida de novo.
 */
const assert = require('node:assert');
const path = require('path');
const { test } = require('../_harness');

const MODULE = path.join(__dirname, '../../modules/smartbot-autopilot-v2.js');

// Constrói um ambiente WhatsApp Web simulado e controlável.
function makeEnv() {
  const stateRef = {
    activeChat: '0000@c.us', // começa "em" um chat qualquer
    blockOpen: new Set(),    // chats cuja abertura é simulada como FALHA
    lastTyped: '',
    sendLog: [],             // { chat, text } por envio efetivado
    runtimeEvents: [],       // eventos emitidos via chrome.runtime (retry/escala)
  };

  const inputEl = { focus() {}, dispatchEvent() {}, textContent: '' };
  const sendBtn = {
    click() { stateRef.sendLog.push({ chat: stateRef.activeChat, text: stateRef.lastTyped }); },
  };
  const confirmEl = { querySelector: () => ({}) }; // sempre "tem ícone de enviado"

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
    // Bridge de "chat ativo": responde com o activeChat atual (assíncrono).
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

  // EventBus mínimo, tolerante: outros módulos já carregados (ex.: o
  // anti-break-system, que se auto-inicia via setTimeout e roda um health-check)
  // podem chamar métodos que não modelamos (registerSelectorStatus, etc.). O
  // Proxy devolve no-op pra qualquer método desconhecido, evitando crash de um
  // timer vazado de OUTRO teste em cima do nosso mock.
  const handlers = {};
  const ebBase = {
    on: (evt, fn) => { (handlers[evt] = handlers[evt] || []).push(fn); },
    once: (evt, fn) => { (handlers[evt] = handlers[evt] || []).push(fn); },
    emit: (evt, data) => { (handlers[evt] || []).slice().forEach((fn) => { try { fn(data); } catch (_) {} }); },
    off: () => {},
  };
  window.EventBus = new Proxy(ebBase, { get: (t, p) => (p in t ? t[p] : () => {}) });
  window.WHL_EVENTS = {};

  // Store do WhatsApp: achar chat + abrir (muda o chat ativo, salvo se bloqueado).
  window.Store = {
    Chat: { find: async (id) => ({ id: String(id) }) },
    Cmd: {
      openChatAt: async (chat) => {
        const id = String(chat && chat.id || '');
        if (id && !stateRef.blockOpen.has(id)) stateRef.activeChat = id;
      },
    },
  };

  // Digitação humana (rápida no teste) — captura o texto digitado.
  window.HumanTyping = {
    type: async (_input, text) => { stateRef.lastTyped = String(text); },
    checkRateLimit: () => true,
    maybeRandomLongPause: async () => {},
    recordMessageSent: () => {},
  };

  // ConfidenceSystem: alta confiança, copiloto ligado.
  window.confidenceSystem = {
    initialized: true,
    copilotEnabled: true,
    score: 95,
    getScore: () => 95,
    canAutoSendSmart: async () => ({ canSend: true, reason: 'ok', score: 95 }),
    recordAutoSend: () => {},
  };

  // Backend: aprova auto-envio e devolve resposta que CARREGA o chat de destino,
  // pra detectarmos qualquer cruzamento (resposta de A indo pro chat de B).
  window.BackendClient = {
    isConnected: () => true,
    ai: {
      process: async (chatId) => ({
        success: true,
        response: `RESP::${chatId}`,
        metadata: { autopilot: { allowAutoSend: true, minConfidence: 70, riskTier: 'low', reasons: [], escalate: false } },
      }),
    },
  };

  const chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: (m) => { if (m && m.type === 'WHL_AUTOPILOT_EVENT') stateRef.runtimeEvents.push({ event: m.event, detail: m.detail }); },
      lastError: null,
    },
  };

  return { window, document, chrome, stateRef, handlers };
}

function loadAutopilot(env) {
  delete require.cache[require.resolve(MODULE)];
  // Guarda os globais pra restaurar depois — sem isto, global.window/document
  // do mock vazam pra outros testes (um setInterval de outro módulo dispara
  // em cima do mock e quebra a suíte).
  env._prev = {
    window: global.window, document: global.document,
    chrome: global.chrome, navigator: global.navigator,
  };
  global.window = env.window;
  global.document = env.document;
  global.chrome = env.chrome;
  global.navigator = { userAgent: 'node-test' };
  require(MODULE);
  // Restaura para stubs BENIGNOS (nunca lançam) em vez de devolver o global
  // anterior: o módulo deixa timers em voo (ex.: o setTimeout de 30s do
  // orchestrator_timeout numa Promise.race, cujo perdedor não é cancelado) que
  // podem disparar updateUI/etc DEPOIS do teste. Com stubs no-op isso é
  // inofensivo. Os demais testes definem seus próprios globais antes de usar,
  // e o process.exit do run-all mata os timers vazados ao fim da suíte.
  const noop = () => {};
  env.restore = () => {
    global.window = {
      addEventListener: noop, removeEventListener: noop,
      postMessage: noop, dispatchEvent: noop, location: { origin: '' },
      WHL_EVENTS: {},
      EventBus: new Proxy({ on: noop, once: noop, emit: noop, off: noop }, { get: (t, p) => (p in t ? t[p] : noop) }),
    };
    global.document = {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ click: noop }),
    };
    global.chrome = {
      runtime: { sendMessage: noop, onMessage: { addListener: noop }, lastError: null },
      storage: {
        local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
        onChanged: { addListener: noop },
      },
    };
    global.navigator = { userAgent: 'node-test' };
  };
  return env.window.AutopilotV2;
}

function msg(phone, i) {
  return { fromMe: false, from: `${phone}@c.us`, chatId: `${phone}@c.us`, body: `mensagem ${i}`, messageId: `m_${phone}_${i}`, timestamp: Date.now() + i };
}

async function waitFor(predicate, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

// ── Teste 1: 3 pessoas em sequência, cada resposta no chat certo ────────────
test('autopilot responde 3 pessoas em sequência, cada uma no seu chat (sem cruzar)', async () => {
  const env = makeEnv();
  const AP = loadAutopilot(env);
  AP.setConfig({ delay: { min: 0, max: 1 }, typingDelay: { min: 0, max: 1 }, minConfidence: 50, SKIP_GROUPS: true, DELAY_BETWEEN_CHATS: 0, MAX_RESPONSES_PER_HOUR: 100000 });
  await AP.start();
  assert.ok(AP.isRunning(), 'autopilot deveria estar rodando após start()');

  const phones = ['5511000000001', '5511000000002', '5511000000003'];
  phones.forEach((p, i) => env.window.EventBus.emit('message:received', msg(p, i)));

  try {
    const ok = await waitFor(() => env.stateRef.sendLog.length >= 3);
    assert.ok(ok, `esperava 3 envios, houve ${env.stateRef.sendLog.length}`);

    // Cada envio: o conteúdo (RESP::<chat>) tem que casar com o chat onde caiu.
    for (const entry of env.stateRef.sendLog) {
      assert.strictEqual(entry.text, `RESP::${entry.chat}`,
        `resposta cruzada! texto ${entry.text} caiu no chat ${entry.chat}`);
    }
    // E os 3 destinos foram exatamente as 3 pessoas (sem faltar/sobrar).
    const chatsRespondidos = env.stateRef.sendLog.map((e) => e.chat).sort();
    assert.deepStrictEqual(chatsRespondidos, phones.map((p) => `${p}@c.us`).sort());
  } finally { try { AP.stop(); } catch (_) {} env.restore(); }
});

// ── Teste 2: chat não abre → NÃO envia às cegas e não perde a mensagem ──────
test('autopilot NÃO envia no chat errado quando a abertura falha (escala p/ humano)', async () => {
  const env = makeEnv();
  const target = '5511000000009@c.us';
  env.stateRef.activeChat = '5511000000008@c.us'; // operador está em OUTRO chat
  env.stateRef.blockOpen.add(target);             // abrir o alvo sempre falha

  let escalated = false;
  env.window.EventBus.on('autopilot:suggestion-only', (d) => {
    if (d && d.item && d.item.chatId === target) escalated = true;
  });

  const AP = loadAutopilot(env);
  AP.setConfig({ delay: { min: 0, max: 1 }, typingDelay: { min: 0, max: 1 }, minConfidence: 50, SKIP_GROUPS: true, DELAY_BETWEEN_CHATS: 0, MAX_RESPONSES_PER_HOUR: 100000 });
  await AP.start();
  assert.ok(AP.isRunning(), 'autopilot deveria estar rodando após start()');
  env.window.EventBus.emit('message:received', msg('5511000000009', 0));

  // "Reagiu" = re-enfileirou (open_unconfirmed) OU escalou (open_failed). Basta
  // a 1ª reação pra provar que NÃO enviou às cegas E não perdeu a mensagem —
  // sem esperar o ciclo inteiro de escalação (mantém o teste rápido).
  const reacted = () => escalated || env.stateRef.runtimeEvents.some((e) =>
    (e.event === 'skipped' && e.detail && e.detail.reason === 'open_unconfirmed') ||
    (e.event === 'suggestion-only' && e.detail && e.detail.reason === 'open_failed'));

  try {
    const didReact = await waitFor(reacted, 30000);
    assert.ok(didReact, 'deveria ter re-tentado/escalado ao não conseguir abrir o chat');
    // O ponto crítico: NADA foi enviado — nem no chat errado, nem em lugar nenhum.
    assert.strictEqual(env.stateRef.sendLog.length, 0,
      `não podia ter enviado nada; enviou: ${JSON.stringify(env.stateRef.sendLog)}`);
  } finally { try { AP.stop(); } catch (_) {} env.restore(); }
});

// ── Teste 3: mesma pessoa responde de novo → é respondida de novo ───────────
test('autopilot responde de novo quando a mesma pessoa manda outra mensagem', async () => {
  const env = makeEnv();
  const AP = loadAutopilot(env);
  AP.setConfig({ delay: { min: 0, max: 1 }, typingDelay: { min: 0, max: 1 }, minConfidence: 50, SKIP_GROUPS: true, DELAY_BETWEEN_CHATS: 0, MAX_RESPONSES_PER_HOUR: 100000 });
  await AP.start();
  assert.ok(AP.isRunning(), 'autopilot deveria estar rodando após start()');

  try {
    env.window.EventBus.emit('message:received', msg('5511000000777', 0));
    const first = await waitFor(() => env.stateRef.sendLog.length >= 1);
    assert.ok(first, 'primeira resposta não saiu');

    // Mesma pessoa manda outra mensagem (msgId diferente).
    env.window.EventBus.emit('message:received', msg('5511000000777', 1));
    const second = await waitFor(() => env.stateRef.sendLog.length >= 2);
    assert.ok(second, 'segunda resposta (re-interação) não saiu');
    // Ambas no chat certo.
    for (const entry of env.stateRef.sendLog) {
      assert.strictEqual(entry.chat, '5511000000777@c.us');
      assert.strictEqual(entry.text, 'RESP::5511000000777@c.us');
    }
  } finally { try { AP.stop(); } catch (_) {} env.restore(); }
});
