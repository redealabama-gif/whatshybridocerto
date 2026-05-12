/**
 * 🛡️ Privacy Shield v2.0 — isolated half.
 *
 * Owns state for "hide online" and "hide typing", mirrors it to both
 * localStorage (for the page half to read at document_start) and
 * chrome.storage, and forwards changes to the page-world half
 * (injected/whl-privacy-shield.js) which performs the actual WebSocket
 * patch and require()-level monkey-patches.
 *
 * The page-world half cannot live here because:
 *   - `window.require` and the WhatsApp modules only exist in the page
 *     world, not in the isolated content-script world.
 *   - Patching `window.WebSocket` from the isolated world has no effect
 *     on the real WebSocket the page uses (different `window` object).
 *
 * v1.0 of this module made both of those mistakes — the require() calls
 * silently returned undefined and the WS patch was a no-op. v2.0 keeps
 * the same public API (window.WHL_PrivacyShield + EventBus events) so
 * existing UI works unchanged, but delegates the real work to the page
 * half via postMessage.
 */
(function () {
  'use strict';
  if (window.__WHL_PRIVACY_SHIELD_ISOLATED__) return;
  window.__WHL_PRIVACY_SHIELD_ISOLATED__ = true;

  const TAG = '[WHL PrivacyShield]';
  const KEYS = {
    ONLINE: 'whl_privacy_hide_online',
    TYPING: 'whl_privacy_hide_typing',
  };
  const SOURCE_OUT = 'WHL_PRIVACY_ISOLATED';
  const SOURCE_IN = 'WHL_PRIVACY_PAGE';

  const state = {
    hideOnline: localStorage.getItem(KEYS.ONLINE) === 'true',
    hideTyping: localStorage.getItem(KEYS.TYPING) === 'true',
  };

  const DEBUG = localStorage.getItem('whl_debug') === 'true';
  function log(...args) { if (DEBUG) console.log(TAG, ...args); }

  function persist() {
    try { localStorage.setItem(KEYS.ONLINE, String(state.hideOnline)); } catch (_) {}
    try { localStorage.setItem(KEYS.TYPING, String(state.hideTyping)); } catch (_) {}
    try {
      chrome.storage?.local?.set?.({
        whl_privacy_hide_online: state.hideOnline,
        whl_privacy_hide_typing: state.hideTyping,
      });
    } catch (_) {}
  }

  function pushToPage() {
    try {
      window.postMessage({
        source: SOURCE_OUT,
        type: 'state',
        hideOnline: state.hideOnline,
        hideTyping: state.hideTyping,
      }, '*');
    } catch (_) {}
  }

  function broadcast() {
    try {
      window.postMessage({
        type: 'WHL_PRIVACY_STATE_UPDATE',
        state: { hideOnline: state.hideOnline, hideTyping: state.hideTyping },
      }, window.location.origin);
    } catch (_) {}
    if (window.EventBus?.emit) {
      try {
        window.EventBus.emit('privacy:state', {
          hideOnline: state.hideOnline,
          hideTyping: state.hideTyping,
        });
      } catch (_) {}
    }
  }

  function applyAndSync() {
    persist();
    pushToPage();
    broadcast();
  }

  // ── Page-world handshake ─────────────────────────────────────────────
  let _pageReady = false;
  window.addEventListener('message', (ev) => {
    const d = ev?.data;
    if (!d || d.source !== SOURCE_IN || !d.type) return;
    if (d.type === 'ready') {
      _pageReady = true;
      log('page half ready; current state:', state);
      // Re-push our state in case the page half loaded from localStorage
      // before the isolated world had a chance to override.
      pushToPage();
    }
    if (d.type === 'state-ack') {
      log('page half acked state:', d.state);
    }
  });

  // ── Hydrate from chrome.storage (overrides localStorage if newer) ─────
  try {
    chrome.storage?.local?.get?.(
      ['whl_privacy_hide_online', 'whl_privacy_hide_typing'],
      (r) => {
        if (chrome.runtime?.lastError) return;
        let changed = false;
        if (typeof r?.whl_privacy_hide_online === 'boolean' &&
            r.whl_privacy_hide_online !== state.hideOnline) {
          state.hideOnline = r.whl_privacy_hide_online;
          changed = true;
        }
        if (typeof r?.whl_privacy_hide_typing === 'boolean' &&
            r.whl_privacy_hide_typing !== state.hideTyping) {
          state.hideTyping = r.whl_privacy_hide_typing;
          changed = true;
        }
        if (changed) applyAndSync();
        else pushToPage();
      }
    );
  } catch (_) { pushToPage(); }

  // ── Public API ───────────────────────────────────────────────────────
  window.WHL_PrivacyShield = {
    setHideOnline(v) {
      state.hideOnline = !!v;
      log('hideOnline =', state.hideOnline);
      applyAndSync();
    },
    toggleOnline() {
      state.hideOnline = !state.hideOnline;
      log('hideOnline =', state.hideOnline);
      applyAndSync();
      return state.hideOnline;
    },
    isHidingOnline: () => state.hideOnline,

    setHideTyping(v) {
      state.hideTyping = !!v;
      log('hideTyping =', state.hideTyping);
      applyAndSync();
    },
    toggleTyping() {
      state.hideTyping = !state.hideTyping;
      log('hideTyping =', state.hideTyping);
      applyAndSync();
      return state.hideTyping;
    },
    isHidingTyping: () => state.hideTyping,

    getState: () => ({ hideOnline: state.hideOnline, hideTyping: state.hideTyping }),

    /**
     * Ask the page-world half to re-attempt require()-level hooks.
     * Useful after a WhatsApp Web update silently broke them.
     */
    reinstall() {
      try {
        window.postMessage({ source: SOURCE_OUT, type: 'reinstall' }, '*');
      } catch (_) {}
    },

    _pageReady: () => _pageReady,
  };

  // ── Inbound commands from UI (top panel / sidepanel) ─────────────────
  window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin) return;
    const { type, payload } = e.data || {};
    if (type === 'WHL_PRIVACY_SET_ONLINE') {
      window.WHL_PrivacyShield.setHideOnline(payload?.hide ?? !state.hideOnline);
    } else if (type === 'WHL_PRIVACY_SET_TYPING') {
      window.WHL_PrivacyShield.setHideTyping(payload?.hide ?? !state.hideTyping);
    } else if (type === 'WHL_PRIVACY_TOGGLE_ONLINE') {
      window.WHL_PrivacyShield.toggleOnline();
    } else if (type === 'WHL_PRIVACY_TOGGLE_TYPING') {
      window.WHL_PrivacyShield.toggleTyping();
    } else if (type === 'WHL_PRIVACY_GET_STATE') {
      broadcast();
    }
  });

  // ── EventBus integration (matches v1.0 public surface) ───────────────
  setTimeout(() => {
    if (window.EventBus?.on) {
      window.EventBus.on('privacy:toggleOnline', () => window.WHL_PrivacyShield.toggleOnline());
      window.EventBus.on('privacy:toggleTyping', () => window.WHL_PrivacyShield.toggleTyping());
      window.EventBus.on('privacy:setOnline', (v) => window.WHL_PrivacyShield.setHideOnline(v));
      window.EventBus.on('privacy:setTyping', (v) => window.WHL_PrivacyShield.setHideTyping(v));
    }
  }, 2000);

  console.log(TAG, '🛡️ v2.0 isolated half loaded — online:', state.hideOnline, '| typing:', state.hideTyping);
})();
