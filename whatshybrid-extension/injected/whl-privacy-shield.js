/**
 * WHL Privacy Shield — page-world half.
 *
 * Runs in the page context of web.whatsapp.com (injected at document_start
 * via content-scripts/page-bridge-injector.js).
 *
 * Once window.require is ready, monkey-patches the WhatsApp modules that
 * dispatch our OUTBOUND presence so the packets are never sent:
 *   - "hide typing"  → WAWebChatStateBridge.sendChatState{Composing,Recording,Paused}
 *   - "hide online"  → WAWebContactPresenceBridge.setPresenceAvailable
 * WAWebPresenceChatAction is patched too as a redundant chokepoint, in case
 * something calls the action layer without going through the bridge.
 *
 * Receiving other people's presence (subscribeUserPresence / handleChatState)
 * is deliberately left untouched, so you still see when contacts are online
 * or typing.
 *
 * State source of truth lives in the ISOLATED world (modules/privacy-shield.js),
 * which mirrors it via chrome.storage. The page world reads localStorage for
 * initial state and accepts the canonical state from the isolated world via
 * window.postMessage.
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
  // The isolated world re-broadcasts the canonical state shortly after load.
  const state = {
    hideOnline: localStorage.getItem(KEY_ONLINE) === 'true',
    hideTyping: localStorage.getItem(KEY_TYPING) === 'true',
  };

  const DEBUG = localStorage.getItem('whl_debug') === 'true';
  function log(...args) { if (DEBUG) console.log(TAG, ...args); }

  // ── require()-level hooks ──────────────────────────────────────────────
  // Patched functions close over `state`, so toggling the feature on/off
  // takes effect immediately without re-patching.
  let _reqHooksInstalled = false;

  function patchFn(mod, name, shouldBlock) {
    if (!mod || typeof mod[name] !== 'function') return false;
    if (mod['__whl_patched_' + name]) return true;
    const orig = mod[name];
    try {
      mod[name] = function (...args) {
        if (shouldBlock()) {
          log('🔇 blocked', name);
          return Promise.resolve();
        }
        return orig.apply(this, args);
      };
      mod['__whl_patched_' + name] = true;
      log('✅ patched', name);
      return true;
    } catch (e) {
      log('patch failed for', name, e?.message || e);
      return false;
    }
  }

  function tryReqHooks() {
    if (_reqHooksInstalled) return true;
    if (typeof window.require !== 'function') return false;

    let any = false;
    const blockTyping = () => state.hideTyping;
    const blockOnline = () => state.hideOnline;

    // Hide typing — outbound chat-state sends (the network dispatch layer).
    try {
      const m = window.require('WAWebChatStateBridge');
      if (patchFn(m, 'sendChatStateComposing', blockTyping)) any = true;
      if (patchFn(m, 'sendChatStateRecording', blockTyping)) any = true;
      if (patchFn(m, 'sendChatStatePaused', blockTyping)) any = true;
    } catch (_) {}

    // Hide online — outbound "available" presence. setPresenceUnavailable is
    // left working so you can still appear offline.
    try {
      const m = window.require('WAWebContactPresenceBridge');
      if (patchFn(m, 'setPresenceAvailable', blockOnline)) any = true;
    } catch (_) {}

    // Redundant chokepoint at the action layer.
    try {
      const m = window.require('WAWebPresenceChatAction');
      if (patchFn(m, 'markComposing', blockTyping)) any = true;
      if (patchFn(m, 'markRecording', blockTyping)) any = true;
      if (patchFn(m, 'sendPresenceAvailable', blockOnline)) any = true;
    } catch (_) {}

    if (any) {
      _reqHooksInstalled = true;
      log('require hooks installed');
      return true;
    }
    return false;
  }

  function pollReqHooks() {
    if (tryReqHooks()) return;
    let attempts = 0;
    const id = setInterval(() => {
      if (tryReqHooks() || ++attempts > 120) clearInterval(id);
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
      // Make sure hooks are in place in case the user just enabled the feature.
      tryReqHooks();
      log('state updated:', state);
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
