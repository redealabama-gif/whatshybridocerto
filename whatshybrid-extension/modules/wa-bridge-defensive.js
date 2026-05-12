/**
 * WA Bridge Defensive — v9.5.9
 *
 * Isolated-world half of the bridge. The page-world half lives in
 * injected/wa-page-bridge.js and is injected by content-scripts/page-bridge-injector.js
 * at document_start.
 *
 * Architecture:
 *   - Page world (injected/wa-page-bridge.js): has real window.require, resolves
 *     WAWebChatCollection / WAWebContactCollection / etc and exposes window.WHL_Store.
 *   - Isolated world (this file): listens via window.postMessage for
 *     { source: 'WHL_PAGE_BRIDGE' } events, mirrors the state locally
 *     (modulesLoaded, version, ready), and provides a Promise-based command
 *     channel for callers needing live data (getChats, sendMessage, openChat).
 *
 * Public API (unchanged shape):
 *   WHL_WaBridge.get(name, opts)       — legacy: returns null in isolated world;
 *                                        prefer WHL_WaBridge.call(...) instead.
 *   WHL_WaBridge.getWithRetry(name)    — legacy: same as get with timeout.
 *   WHL_WaBridge.healthCheck()         — returns mirrored state.
 *   WHL_WaBridge.detectVersion()       — last seen WA version.
 *   WHL_WaBridge.showFallbackBanner()  — UI banner.
 *   WHL_WaBridge.reportFailure(name, opts) — telemetry to backend.
 *   WHL_WaBridge.call(cmd, payload, opts) — NEW: async call into page bridge.
 *   WHL_WaBridge.onReady(cb)           — NEW: callback when STORE_READY fires.
 */
(function () {
  'use strict';
  if (window.WHL_WaBridge) return;

  const SOURCE_OUT = 'WHL_ISOLATED';
  const SOURCE_IN = 'WHL_PAGE_BRIDGE';
  const PAGE_READY_TIMEOUT_MS = 15_000;

  // ── Mirrored state of the page bridge ─────────────────────────────────
  const state = {
    ready: false,
    version: 'unknown',
    modulesLoaded: [],
    missing: [],
    readyAt: 0,
    lastError: null,
  };

  const readyCallbacks = [];
  const pendingRequests = new Map(); // requestId -> { resolve, reject, timer }
  const _failed = new Set();
  let _bannerShown = false;

  function genRequestId() {
    return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ── Inbound page-bridge messages ──────────────────────────────────────
  window.addEventListener('message', (ev) => {
    const data = ev?.data;
    if (!data || data.source !== SOURCE_IN || !data.type) return;

    if (data.type === 'STORE_READY') {
      state.ready = true;
      state.version = data.version || state.version;
      state.modulesLoaded = data.modules || [];
      state.missing = data.missing || [];
      state.readyAt = data.readyAt || Date.now();
      console.log('[WHL Bridge] Health OK', {
        version: state.version,
        loaded: state.modulesLoaded.length,
        missing: state.missing.length,
      });
      if (!data.rebroadcast) {
        const cbs = readyCallbacks.splice(0);
        cbs.forEach(cb => { try { cb(state); } catch (_) {} });
      }
      hideFallbackBanner();
      return;
    }

    if (data.type === 'STORE_FAILED') {
      state.lastError = data.reason || 'unknown';
      console.warn('[WHL Bridge] Page bridge reported STORE_FAILED:', state.lastError);
      reportFailure('page-bridge-boot', { metadata: { reason: state.lastError } });
      showFallbackBanner('Não conseguimos conectar ao WhatsApp Web — modo manual ativo.');
      return;
    }

    if (data.type === 'RESPONSE' && data.requestId) {
      const pending = pendingRequests.get(data.requestId);
      if (!pending) return;
      pendingRequests.delete(data.requestId);
      clearTimeout(pending.timer);
      if (data.error) pending.reject(new Error(data.error));
      else pending.resolve(data.data);
      return;
    }
  });

  // ── Public: command channel into the page bridge ──────────────────────
  function call(cmd, payload = {}, opts = {}) {
    const timeoutMs = opts.timeoutMs || 10_000;
    return new Promise((resolve, reject) => {
      const requestId = genRequestId();
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error(`page-bridge timeout: ${cmd}`));
      }, timeoutMs);
      pendingRequests.set(requestId, { resolve, reject, timer });
      try {
        window.postMessage({ source: SOURCE_OUT, type: cmd, requestId, payload }, '*');
      } catch (e) {
        clearTimeout(timer);
        pendingRequests.delete(requestId);
        reject(e);
      }
    });
  }

  function onReady(cb) {
    if (state.ready) { try { cb(state); } catch (_) {} return; }
    readyCallbacks.push(cb);
  }

  function detectVersion() {
    return state.version || 'unknown';
  }

  // ── Telemetry ─────────────────────────────────────────────────────────
  function reportFailure(selectorName, opts = {}) {
    const key = `${selectorName}|${detectVersion()}`;
    if (_failed.has(key)) return;
    _failed.add(key);
    try {
      const config = window.WHL_CONFIG || {};
      const apiUrl = config.API_URL || 'https://api.whatshybrid.com.br';
      const token = window.WHL_authToken || localStorage.getItem('whl_token');
      fetch(`${apiUrl}/api/v1/telemetry/selector-failure`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          selector_name: selectorName,
          wa_version: detectVersion(),
          extension_version: chrome?.runtime?.getManifest?.()?.version || 'unknown',
          metadata: opts.metadata || {},
        }),
        keepalive: true,
      }).catch(() => {});
    } catch (_) {}
    if (opts.critical) {
      showFallbackBanner(`WhatsApp atualizou. Modo manual ativo (recurso: ${selectorName})`);
    }
  }

  // ── Legacy compatibility shims ────────────────────────────────────────
  // The old API returned page-world objects synchronously. We can't do that
  // from the isolated world, so we return null and recommend `call()` instead.
  // Any consumer that mutates Chat/Contact directly must be migrated, but at
  // least it won't throw on `WHL_WaBridge.get('chat')`.
  function get(selectorName) {
    if (!state.ready) return null;
    // If a module of that name is loaded in the page world, signal availability
    // via a sentinel object; callers that only check truthiness keep working.
    const name = String(selectorName || '').toLowerCase();
    const canonical = {
      chat: 'Chat', msg: 'Msg', contact: 'Contact', blocklist: 'Blocklist',
      wid: 'Wid', sendmessage: 'SendTextMsg', sendmsg: 'SendTextMsg',
    }[name] || selectorName;
    if (state.modulesLoaded.includes(canonical)) {
      return { __isolated_shim: true, name: canonical, note: 'use WHL_WaBridge.call() instead' };
    }
    return null;
  }

  async function getWithRetry(selectorName, { maxAttempts = 5, baseDelay = 500, critical = false } = {}) {
    for (let i = 0; i < maxAttempts; i++) {
      const r = get(selectorName);
      if (r) return r;
      await new Promise(r2 => setTimeout(r2, baseDelay * Math.pow(2, i)));
    }
    reportFailure(selectorName, { critical });
    return null;
  }

  function healthCheck() {
    return {
      ok: state.ready && state.modulesLoaded.length > 0,
      missing: state.missing,
      version: state.version,
      modulesLoaded: state.modulesLoaded,
      readyAt: state.readyAt,
      timestamp: Date.now(),
    };
  }

  // ── Fallback banner ───────────────────────────────────────────────────
  function showFallbackBanner(message = 'WhatsApp atualizou — modo manual ativo') {
    if (_bannerShown) return;
    _bannerShown = true;
    try {
      const banner = document.createElement('div');
      banner.id = 'whl-fallback-banner';
      banner.setAttribute('role', 'alert');
      banner.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0;
        background: linear-gradient(90deg, #ff9800, #f44336);
        color: white; padding: 12px 20px;
        font-family: 'Inter', sans-serif; font-size: 14px;
        text-align: center; z-index: 99999;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      `;
      banner.textContent = '⚠️ ' + message + ' — sugestões funcionam, envio é manual.';
      (document.body || document.documentElement).appendChild(banner);
      setTimeout(() => banner.remove(), 30000);
    } catch (_) {}
  }
  function hideFallbackBanner() {
    document.getElementById('whl-fallback-banner')?.remove();
    _bannerShown = false;
  }

  // ── Boot ──────────────────────────────────────────────────────────────
  window.WHL_WaBridge = {
    call,
    onReady,
    get,
    getWithRetry,
    healthCheck,
    detectVersion,
    showFallbackBanner,
    hideFallbackBanner,
    reportFailure,
    _failed,
    _state: state,
  };

  // Ping the page bridge in case it became ready before this script loaded.
  try {
    window.postMessage({ source: SOURCE_OUT, type: 'ping' }, '*');
  } catch (_) {}

  // Health watchdog: if we haven't heard STORE_READY within 15s, warn the user.
  if (window.location?.hostname?.includes('web.whatsapp.com')) {
    setTimeout(() => {
      if (!state.ready) {
        console.warn('[WHL Bridge] Page bridge never reached STORE_READY in 15s');
        reportFailure('page-bridge-timeout');
        showFallbackBanner('Algumas integrações com WhatsApp não carregaram');
      }
    }, PAGE_READY_TIMEOUT_MS);
  }
})();
