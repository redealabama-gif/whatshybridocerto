/**
 * WHL Page Bridge — runs in the page world of web.whatsapp.com.
 *
 * Loaded via <script src="chrome-extension://<id>/injected/wa-page-bridge.js">
 * from the document_start injector content script.
 *
 * Responsibilities:
 *   1. Wait for window.require (webpack runtime) to be available.
 *   2. Resolve the post-2.3000.x WhatsApp Web modules (WAWebChatCollection,
 *      WAWebContactCollection, WAWebBlocklistCollection, WAWebMsgCollection,
 *      WAWebWidFactory, WAWebSendMsgChatAction, etc.).
 *   3. Expose them at window.WHL_Store with stable, version-independent names.
 *   4. Notify the isolated world via window.postMessage({ source: 'WHL_PAGE_BRIDGE' }).
 *   5. Serve commands from the isolated world via window.addEventListener('message').
 *
 * The bridge is the SINGLE source of truth for talking to WhatsApp internals.
 * The isolated content scripts MUST NOT try to read window.Store/window.require.
 */

(function () {
  'use strict';

  if (window.__WHL_PAGE_BRIDGE_LOADED__) return;
  window.__WHL_PAGE_BRIDGE_LOADED__ = true;

  const TAG = '[WHL Page Bridge]';
  const SOURCE_OUT = 'WHL_PAGE_BRIDGE';
  const SOURCE_IN = 'WHL_ISOLATED';

  function detectVersion() {
    try {
      return document.querySelector('meta[name="version"]')?.content
        || window.Debug?.VERSION
        || localStorage.getItem('WAVersion')
        || 'unknown';
    } catch { return 'unknown'; }
  }

  // ── safeRequire: never throws ─────────────────────────────────────────
  function safeRequire(name) {
    try {
      if (typeof window.require !== 'function') return null;
      return window.require(name);
    } catch (_) { return null; }
  }

  // Resolve a member from a module accepting both shapes:
  //   require('Foo') -> { Foo: ... }     (new)
  //   require('Foo') -> { default: { Foo: ... } }   (older webpack)
  // Accepts an array of candidate names — first hit wins.
  function pick(mod, names) {
    if (!mod) return null;
    const list = Array.isArray(names) ? names : [names];
    for (const n of list) {
      if (n && mod[n] != null) return mod[n];
      if (n && mod.default && mod.default[n] != null) return mod.default[n];
    }
    return null;
  }

  // ── Module resolution map ─────────────────────────────────────────────
  // Each entry returns { module, fields: [...] } describing the canonical
  // exposed object. Add new candidates here when WhatsApp renames things.
  function resolveModules() {
    const found = {};
    const missing = [];

    // tryModule supports multiple candidate export names so WA renames
    // (2.3000.x dropped legacy member names) don't break resolution.
    function tryModule(label, modName, exportNames) {
      const mod = safeRequire(modName);
      if (!mod) { missing.push(`${label}(${modName})`); return null; }
      const names = exportNames == null ? [] : (Array.isArray(exportNames) ? exportNames : [exportNames]);
      let val = null;
      if (names.length) {
        val = pick(mod, names);
      } else {
        val = mod.default || mod;
      }
      // Last-resort: accept the module itself if it looks usable
      if (!val) val = mod.default || mod;
      if (!val) { missing.push(`${label}(${modName}.${names.join('|') || 'default'})`); return null; }
      found[label] = val;
      return val;
    }

    tryModule('Chat',           'WAWebChatCollection',          ['ChatCollection']);
    tryModule('Contact',        'WAWebContactCollection',       ['ContactCollection']);
    tryModule('Blocklist',      'WAWebBlocklistCollection',     ['BlocklistCollection']);
    tryModule('Msg',            'WAWebMsgCollection',           ['MsgCollection']);
    // WidFactory: accept either the namespace or just createWid
    tryModule('Wid',            'WAWebWidFactory',              ['WidFactory', 'createWid']);
    tryModule('SendTextMsg',    'WAWebSendMsgChatAction',       ['sendTextMsgToChat', 'sendTextMessageToChat']);
    tryModule('Cmd',            'WAWebCmd',                     ['Cmd']) || tryModule('Cmd', 'WAWebCmd');
    tryModule('ChatModel',      'WAWebChatModel',               ['ChatModel', 'Chat']);
    tryModule('MsgModel',       'WAWebMsgModel',                ['MsgModel', 'Msg']);
    tryModule('MsgKey',         'WAWebMsgKey',                  ['MsgKey', 'newId']);
    tryModule('SendMsgRecord',  'WAWebSendMsgRecordAction',     ['addAndSendMsgToChat', 'sendMsgRecord'])
      || tryModule('SendMsgRecord', 'WAWebSendMsgRecordAction');
    tryModule('ContactGetters', 'WAWebContactGetters');
    tryModule('ContactMethods', 'WAWebContactMethods');
    tryModule('ContactBlock',   'WAWebContactBlockAction');
    tryModule('ContactUnblock', 'WAWebContactUnblockAction');
    tryModule('Presence',       'WAWebPresence');
    tryModule('PresenceChat',   'WAWebPresenceChatAction');
    tryModule('Chatstate',      'WAWebChatstateAction');
    tryModule('ChatstateComp',  'WAWebSendChatstateComposing');
    tryModule('NavigateToChat', 'WAWebNavigateToChat');
    tryModule('StatusV3',       'WAWebStatusV3');
    tryModule('MediaDownload',  'WAWebMediaDownload');
    tryModule('ViewOnceMsg',    'WAWebViewOnceMsg');

    return { found, missing };
  }

  // ── Boot polling ──────────────────────────────────────────────────────
  let _ready = false;
  let _bootStartedAt = Date.now();
  const READY_MAX_WAIT_MS = 60_000;
  const READY_POLL_INTERVAL = 250;

  function postOut(payload) {
    try {
      window.postMessage({ source: SOURCE_OUT, ...payload }, '*');
    } catch (_) {}
  }

  function boot() {
    if (_ready) return;

    const elapsed = Date.now() - _bootStartedAt;

    if (typeof window.require !== 'function') {
      if (elapsed > READY_MAX_WAIT_MS) {
        postOut({ type: 'STORE_FAILED', reason: 'window.require never appeared', version: detectVersion() });
        return;
      }
      setTimeout(boot, READY_POLL_INTERVAL);
      return;
    }

    const { found, missing } = resolveModules();
    const haveCore = !!(found.Chat && found.Contact);

    if (!haveCore) {
      if (elapsed > READY_MAX_WAIT_MS) {
        postOut({ type: 'STORE_FAILED', reason: 'core modules missing: ' + missing.slice(0, 5).join(','), version: detectVersion() });
        return;
      }
      setTimeout(boot, READY_POLL_INTERVAL);
      return;
    }

    const version = detectVersion();
    const store = {
      ...found,
      // Legacy aliases for backwards compatibility with older callers
      SendMessage: found.SendTextMsg,
      _raw: { /* lazy: populated on demand below */ },
      _version: version,
      _readyAt: Date.now(),
      _modulesLoaded: Object.keys(found),
      _missing: missing,
    };
    // Lazy raw access — only resolve when first read (avoids cost at boot)
    Object.defineProperty(store._raw, 'require', {
      get() { return window.require; },
    });

    window.WHL_Store = store;
    _ready = true;

    console.log(`${TAG} WAVersion=${version}`);
    console.log(`${TAG} Modules ready: ${Object.keys(found).join(', ')}`);
    if (missing.length) {
      console.warn(`${TAG} Missing modules (non-fatal): ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}`);
    }

    postOut({
      type: 'STORE_READY',
      version,
      modules: Object.keys(found),
      missing,
      readyAt: store._readyAt,
    });

    // Also dispatch a DOM CustomEvent for any page-world consumer
    try {
      window.dispatchEvent(new CustomEvent('WHL_STORE_READY', { detail: { version, modules: Object.keys(found) } }));
    } catch (_) {}
  }

  // ── Command handlers (called by the isolated world) ────────────────────
  function getActiveChatId() {
    try {
      const Chat = window.WHL_Store?.Chat;
      const arr = Chat?.getModelsArray?.() || Chat?._models || [];
      const active = arr.find(c => c.active === true || c.__x_active === true);
      return active?.id?._serialized || null;
    } catch (_) { return null; }
  }

  function pickPhoneId(wid) {
    // Accepts strings like '5511...@c.us', '155757190365423@lid', '...@g.us'
    if (!wid) return null;
    return String(wid);
  }

  async function cmdGetChats({ filter } = {}) {
    const Chat = window.WHL_Store?.Chat;
    if (!Chat) throw new Error('Chat collection not available');
    const arr = Chat.getModelsArray?.() || Chat._models || [];
    const out = arr.map(c => {
      const id = c.id?._serialized || '';
      return {
        id,
        // Pull both prefixed and legacy names so callers in either world cope:
        archive: c.__x_archive === true || c.archive === true,
        unreadCount: c.__x_unreadCount ?? c.unreadCount ?? 0,
        t: c.__x_t ?? c.t ?? 0,
        muteExpiration: c.__x_muteExpiration ?? c.muteExpiration ?? 0,
        isGroup: id.endsWith('@g.us'),
        isLid: id.endsWith('@lid'),
        isUser: id.endsWith('@c.us') || id.endsWith('@s.whatsapp.net'),
        name: c.name || c.formattedTitle || c.__x_name || '',
      };
    });
    if (filter === 'archived') return out.filter(c => c.archive);
    if (filter === 'normal') return out.filter(c => !c.archive && !c.isGroup);
    if (filter === 'groups') return out.filter(c => c.isGroup);
    return out;
  }

  async function cmdGetContacts() {
    const Contact = window.WHL_Store?.Contact;
    if (!Contact) throw new Error('Contact collection not available');
    const arr = Contact.getModelsArray?.() || Contact._models || [];
    return arr.map(c => ({
      id: c.id?._serialized || '',
      name: c.__x_name || c.name || '',
      pushname: c.__x_pushname || c.pushname || '',
      isMyContact: c.__x_isMyContact ?? c.isMyContact ?? false,
      isBusiness: c.__x_isBusiness ?? c.isBusiness ?? false,
    }));
  }

  async function cmdGetBlocked() {
    const Blocklist = window.WHL_Store?.Blocklist;
    if (!Blocklist) throw new Error('Blocklist not available');
    const arr = Blocklist.getModelsArray?.() || Blocklist._models || [];
    return arr.map(c => ({
      id: c.id?._serialized || c.id?.user || String(c.id || ''),
    })).filter(c => c.id);
  }

  async function cmdGetActiveChat() {
    return { id: getActiveChatId() };
  }

  async function cmdOpenChat({ chatId }) {
    const Chat = window.WHL_Store?.Chat;
    const Cmd = window.WHL_Store?.Cmd;
    if (!Chat) throw new Error('Chat collection not available');
    const chat = Chat.get?.(chatId) || (Chat._index && Chat._index[chatId]);
    if (!chat) throw new Error('CHAT_NOT_FOUND');
    if (Cmd?.openChatAt) { await Cmd.openChatAt(chat); return { opened: true, via: 'Cmd.openChatAt' }; }
    if (Cmd?.default?.openChatAt) { await Cmd.default.openChatAt(chat); return { opened: true, via: 'Cmd.default.openChatAt' }; }
    if (chat.open) { await chat.open(); return { opened: true, via: 'chat.open' }; }
    throw new Error('NO_OPEN_METHOD');
  }

  async function cmdSendMessage({ chatId, text }) {
    const Chat = window.WHL_Store?.Chat;
    const sendText = window.WHL_Store?.SendTextMsg;
    if (!Chat) throw new Error('Chat collection not available');
    const chat = Chat.get?.(chatId) || (Chat._index && Chat._index[chatId]);
    if (!chat) throw new Error('CHAT_NOT_FOUND');
    // SendTextMsg may be the function itself OR a namespace containing it.
    const sendFn = typeof sendText === 'function'
      ? sendText
      : (sendText?.sendTextMsgToChat || sendText?.sendTextMessageToChat || null);
    if (typeof sendFn === 'function') {
      const r = await sendFn(chat, text, {});
      return { sent: true, via: 'sendTextMsgToChat', result: !!r };
    }
    throw new Error('NO_SEND_METHOD');
  }

  async function cmdHealth() {
    const s = window.WHL_Store;
    return {
      ready: !!s,
      version: s?._version || detectVersion(),
      modulesLoaded: s?._modulesLoaded || [],
      missing: s?._missing || [],
      readyAt: s?._readyAt || null,
    };
  }

  const HANDLERS = {
    health: cmdHealth,
    getActiveChat: cmdGetActiveChat,
    getChats: cmdGetChats,
    getContacts: cmdGetContacts,
    getBlocked: cmdGetBlocked,
    openChat: cmdOpenChat,
    sendMessage: cmdSendMessage,
  };

  window.addEventListener('message', async (ev) => {
    const data = ev?.data;
    if (!data || data.source !== SOURCE_IN || !data.type) return;
    const { type, requestId, payload } = data;
    const handler = HANDLERS[type];
    if (!handler) {
      postOut({ type: 'RESPONSE', requestId, error: 'UNKNOWN_COMMAND:' + type });
      return;
    }
    try {
      if (!_ready && type !== 'health') {
        // Wait briefly for boot — gives callers a chance instead of immediate failure
        const start = Date.now();
        while (!_ready && Date.now() - start < 5000) {
          await new Promise(r => setTimeout(r, 100));
        }
      }
      const data = await handler(payload || {});
      postOut({ type: 'RESPONSE', requestId, data });
    } catch (e) {
      postOut({ type: 'RESPONSE', requestId, error: e?.message || String(e) });
    }
  });

  // Kick off boot
  boot();

  // Re-broadcast STORE_READY on demand (some isolated callers init late)
  window.addEventListener('message', (ev) => {
    if (ev?.data?.source === SOURCE_IN && ev.data.type === 'ping' && _ready) {
      postOut({
        type: 'STORE_READY',
        version: window.WHL_Store._version,
        modules: window.WHL_Store._modulesLoaded,
        missing: window.WHL_Store._missing,
        readyAt: window.WHL_Store._readyAt,
        rebroadcast: true,
      });
    }
  });
})();
