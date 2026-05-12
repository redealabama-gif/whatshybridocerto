/**
 * WHL Privacy Shield — page-world half.
 *
 * Runs in the page context of web.whatsapp.com (injected at document_start
 * via content-scripts/page-bridge-injector.js). Responsibilities:
 *   - Patch window.WebSocket BEFORE WhatsApp opens its socket, so we can
 *     drop the small presence packets (online / composing) at the wire.
 *   - Once window.require is ready, monkey-patch the appropriate WA
 *     modules (WASendPresenceStatusProtocol, WAWebPresenceUtils,
 *     ChatModel.presence) so the suppression also happens before the
 *     packet is built.
 *   - Listen for state-change commands from the isolated world via
 *     window.postMessage and update local state.
 *
 * State source of truth lives in the ISOLATED world (modules/privacy-shield.js),
 * which mirrors it via chrome.storage. The page world reads localStorage
 * for initial state (so it can start blocking immediately at document_start),
 * but the isolated world re-broadcasts the canonical state shortly after.
 */
(function () {
  'use strict';
  if (window.__WHL_PRIVACY_SHIELD_PAGE__) return;
  window.__WHL_PRIVACY_SHIELD_PAGE__ = true;

  const TAG = '[WHL PrivacyShield/page]';
  const KEY_ONLINE = 'whl_privacy_hide_online';
  const KEY_TYPING = 'whl_privacy_hide_typing';
  const SOURCE_OUT = 'WHL_PRIVACY_PAGE';
  const SOURCE_IN = 'WHL_PRIVACY_ISOLATED';

  // Initial state read from localStorage — same keys the isolated world uses.
  // We re-broadcast immediately and accept overrides from the isolated world
  // when it later sends a `state` message.
  const state = {
    hideOnline: localStorage.getItem(KEY_ONLINE) === 'true',
    hideTyping: localStorage.getItem(KEY_TYPING) === 'true',
  };

  const DEBUG = localStorage.getItem('whl_debug') === 'true';
  function log(...args) { if (DEBUG) console.log(TAG, ...args); }

  // ── WebSocket patch (highest priority — runs at document_start) ─────────
  // The patch covers cases where the require()-level hooks miss because
  // WhatsApp re-bundles its modules. Same approach as WAIncognito: filter
  // small text frames containing presence/composing markers. Binary frames
  // are passed through untouched.
  let _wsHooked = false;
  function hookWebSocketEarly() {
    if (_wsHooked) return;
    if (typeof window.WebSocket !== 'function') return;
    _wsHooked = true;

    const OriginalWS = window.WebSocket;

    function isPresencePacket(data) {
      if (typeof data !== 'string') return false;
      if (data.length > 800) return false;
      try {
        if (state.hideOnline && data.includes('"presence"') && data.includes('"available"')) return 'online';
        if (state.hideTyping && (data.includes('"composing"') || data.includes('"paused"'))) return 'typing';
      } catch (_) {}
      return false;
    }

    function PatchedWebSocket(...args) {
      const ws = new OriginalWS(...args);
      const origSend = ws.send.bind(ws);
      ws.send = function (data) {
        const kind = isPresencePacket(data);
        if (kind) {
          log('🔇 WS dropped', kind, 'packet');
          return;
        }
        return origSend(data);
      };
      return ws;
    }
    PatchedWebSocket.prototype = OriginalWS.prototype;
    Object.setPrototypeOf(PatchedWebSocket, OriginalWS);
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
      try { PatchedWebSocket[k] = OriginalWS[k]; } catch (_) {}
    }
    try {
      Object.defineProperty(window, 'WebSocket', {
        value: PatchedWebSocket,
        writable: true,
        configurable: true,
      });
      log('✅ WebSocket patched at document_start');
    } catch (e) {
      console.warn(TAG, 'WebSocket patch failed:', e?.message || e);
    }
  }

  // Patch immediately — this is the most important step.
  hookWebSocketEarly();

  // ── require()-level hooks (best-effort, applied once webpack is ready) ──
  let _reqHooksInstalled = false;
  function tryReqHooks() {
    if (_reqHooksInstalled) return true;
    if (typeof window.require !== 'function') return false;

    let any = false;

    // Hook 1: WASendPresenceStatusProtocol.sendPresenceStatusProtocol
    try {
      const mod = window.require('WASendPresenceStatusProtocol');
      if (mod?.sendPresenceStatusProtocol && !mod.__whl_patched) {
        const orig = mod.sendPresenceStatusProtocol;
        mod.sendPresenceStatusProtocol = function (presenceType, ...rest) {
          if (state.hideOnline && presenceType === 'available') {
            log('🔇 sendPresenceStatusProtocol(available) blocked');
            return Promise.resolve();
          }
          return orig.call(this, presenceType, ...rest);
        };
        mod.__whl_patched = true;
        any = true;
        log('✅ WASendPresenceStatusProtocol patched');
      }
    } catch (_) {}

    // Hook 2: WAWebSendChatstateComposing
    try {
      const mod = window.require('WAWebSendChatstateComposing');
      const fn = mod?.sendChatstateComposing || mod?.default?.sendChatstateComposing;
      if (fn && !mod.__whl_patched) {
        const orig = fn;
        const patched = function (...args) {
          if (state.hideTyping) {
            log('🔇 sendChatstateComposing blocked');
            return Promise.resolve();
          }
          return orig.apply(this, args);
        };
        if (mod.sendChatstateComposing) mod.sendChatstateComposing = patched;
        else mod.default.sendChatstateComposing = patched;
        mod.__whl_patched = true;
        any = true;
        log('✅ WAWebSendChatstateComposing patched');
      }
    } catch (_) {}

    // Hook 3: WAWebChatstateAction.sendChatstateAction (or similar)
    try {
      const mod = window.require('WAWebChatstateAction');
      const candidates = ['sendChatstateAction', 'sendChatstate', 'sendChatStateComposing', 'sendChatStatePaused'];
      let patchedAny = false;
      for (const k of candidates) {
        const fn = mod?.[k];
        if (typeof fn === 'function' && !mod['__whl_patched_' + k]) {
          mod[k] = function (...args) {
            // First arg is typically the chatstate ('composing' / 'paused' / 'recording')
            const cs = args[0];
            if (state.hideTyping && (cs === 'composing' || cs === 'paused' || cs === 'recording')) {
              log('🔇 ' + k + '(' + cs + ') blocked');
              return Promise.resolve();
            }
            return fn.apply(this, args);
          };
          mod['__whl_patched_' + k] = true;
          patchedAny = true;
        }
      }
      if (patchedAny) {
        any = true;
        log('✅ WAWebChatstateAction patched');
      }
    } catch (_) {}

    // Hook 4: Legacy fallback — old WAWebPresenceUtils name
    try {
      const mod = window.require('WAWebPresenceUtils');
      if (mod?.sendComposing && !mod.__whl_patched) {
        const orig = mod.sendComposing;
        mod.sendComposing = function (...args) {
          if (state.hideTyping) {
            log('🔇 sendComposing blocked');
            return Promise.resolve();
          }
          return orig.apply(this, args);
        };
        mod.__whl_patched = true;
        any = true;
      }
    } catch (_) {}

    if (any) {
      _reqHooksInstalled = true;
      return true;
    }
    return false;
  }

  function pollReqHooks() {
    let attempts = 0;
    const id = setInterval(() => {
      if (tryReqHooks() || ++attempts > 80) clearInterval(id);
    }, 250);
  }
  pollReqHooks();

  // ── Inbound state updates from the isolated world ──────────────────────
  window.addEventListener('message', (ev) => {
    const d = ev?.data;
    if (!d || d.source !== SOURCE_IN || !d.type) return;
    if (d.type === 'state') {
      if (typeof d.hideOnline === 'boolean') state.hideOnline = d.hideOnline;
      if (typeof d.hideTyping === 'boolean') state.hideTyping = d.hideTyping;
      // Refresh require hooks in case the user just enabled the feature.
      tryReqHooks();
      log('state updated:', state);
      // Reply so the isolated world can confirm.
      try {
        window.postMessage({ source: SOURCE_OUT, type: 'state-ack', state: { ...state } }, '*');
      } catch (_) {}
    }
    if (d.type === 'reinstall') {
      _reqHooksInstalled = false;
      tryReqHooks();
    }
  });

  // Announce that the page half is ready.
  try {
    window.postMessage({ source: SOURCE_OUT, type: 'ready', state: { ...state } }, '*');
  } catch (_) {}
  log('page-world half loaded');
})();
