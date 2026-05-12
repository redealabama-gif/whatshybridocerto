/**
 * WA Bridge Defensive — v9.5.9
 *
 * Wrapper resiliente sobre acesso a window.Store / window.WAModule.
 * Quando o WhatsApp Web atualiza e renomeia / remove uma key, este
 * wrapper:
 *   1. Tenta múltiplos caminhos (path principal + fallbacks conhecidos)
 *   2. Se nenhum funciona, registra telemetria pro backend
 *   3. Retorna null (caller decide entre tentar de novo, ativar modo
 *      manual, ou exibir banner)
 *
 * Uso:
 *   const Chat = WHL_WaBridge.get('chat');         // null se quebrar
 *   const msg  = WHL_WaBridge.get('msg', { critical: true }); // alerta
 *   if (!Chat) WHL_WaBridge.fallbackBanner('Modo manual ativo');
 *
 * Como adicionar/atualizar caminhos:
 *   Edita SELECTORS abaixo. Cada entry é uma lista de funções, em ordem
 *   de preferência. Primeiro que retornar truthy ganha.
 */

(function() {
  'use strict';
  if (window.WHL_WaBridge) return;

  // ── Configuração de seletores com fallbacks ─────────────────────────
  // Cada chave aceita um array de funções. Ordem importa.
  const SELECTORS = {
    // Store raiz
    store: [
      () => window.Store,
      () => window.WWebJS?.Store,
      () => window.WAModule?.default,
    ],

    // NOTA: WhatsApp Web 2.3000.x+ usa require() em vez de window.Store
    // Caminhos via window.require() são primários; window.Store é fallback legado.
    chat: [
      // Caminho novo: WAWebChatCollection (WA 2.3000.x+)
      () => { try { const CC = window.require?.('WAWebChatCollection'); return CC?.ChatCollection || CC?.default?.ChatCollection || null; } catch (_) { return null; } },
      // Fallback legado
      () => window.Store?.Chat,
      () => window.Store?.ChatCollection,
      () => window.WAModule?.ChatCollection,
    ],

    msg: [
      () => { try { const M = window.require?.('WAWebMsgCollection'); return M?.MsgCollection || M?.default?.MsgCollection || null; } catch (_) { return null; } },
      () => window.Store?.Msg,
      () => window.Store?.MsgCollection,
      () => window.WAModule?.MsgCollection,
    ],

    contact: [
      () => { try { const CC = window.require?.('WAWebContactCollection'); return CC?.ContactCollection || CC?.default?.ContactCollection || null; } catch (_) { return null; } },
      () => window.Store?.Contact,
      () => window.Store?.ContactCollection,
    ],

    blocklist: [
      () => { try { const BL = window.require?.('WAWebBlocklistCollection'); return BL?.BlocklistCollection || BL?.default?.BlocklistCollection || null; } catch (_) { return null; } },
      () => window.Store?.Blocklist,
    ],

    wid: [
      () => { try { const W = window.require?.('WAWebWidFactory'); return W?.WidFactory || W?.default?.WidFactory || null; } catch (_) { return null; } },
      () => window.Store?.Wid,
      () => window.Store?.WidFactory,
    ],

    sendMessage: [
      () => window.Store?.SendTextMsgToChat,
      () => window.Store?.SendMessage,
      () => window.Store?.WapQuery?.sendChatstateComposing,
    ],

    chatModel: [
      () => window.Store?.ChatModel,
    ],

    // Detecção de versão do WhatsApp Web
    version: [
      () => document.querySelector('meta[name="version"]')?.content,
      () => window.Debug?.VERSION,
      () => window.localStorage?.getItem('WAVersion'),
    ],
  };

  // ── State ────────────────────────────────────────────────────────────
  const _failed = new Set();        // selectors que já falharam (evita retelemetria)
  let _bannerShown = false;
  let _waVersion = null;

  // ── Telemetria ───────────────────────────────────────────────────────
  function reportFailure(selectorName, opts = {}) {
    const key = `${selectorName}|${detectVersion()}`;
    if (_failed.has(key)) return;
    _failed.add(key);

    try {
      const config = window.WHL_CONFIG || {};
      const apiUrl = config.API_URL || 'https://api.whatshybrid.com.br';
      const token = window.WHL_authToken || localStorage.getItem('whl_token');

      // Best-effort: não bloqueia se falhar
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
        keepalive: true, // sobrevive page unload
      }).catch(() => {/* swallow */});
    } catch (_) {}

    console.warn(`[WHL Bridge] Selector failure: ${selectorName} (WA ${detectVersion()})`);

    if (opts.critical) {
      showFallbackBanner(`WhatsApp atualizou. Modo manual ativo (recurso: ${selectorName})`);
    }
  }

  // ── API principal ────────────────────────────────────────────────────
  function get(selectorName, opts = {}) {
    const candidates = SELECTORS[selectorName];
    if (!candidates) {
      console.error(`[WHL Bridge] Selector desconhecido: ${selectorName}`);
      return null;
    }

    for (const candidate of candidates) {
      try {
        const result = candidate();
        if (result !== undefined && result !== null) {
          return result;
        }
      } catch (_) {
        // Silent — cada candidate pode lançar (ex: window.Store undefined)
      }
    }

    reportFailure(selectorName, opts);
    return null;
  }

  function detectVersion() {
    if (_waVersion) return _waVersion;
    for (const candidate of SELECTORS.version) {
      try {
        const v = candidate();
        if (v) { _waVersion = String(v); return _waVersion; }
      } catch (_) {}
    }
    return 'unknown';
  }

  /**
   * Tenta obter um seletor com retry exponencial.
   * Útil pra esperar Store estar pronto após page load.
   */
  async function getWithRetry(selectorName, { maxAttempts = 5, baseDelay = 500, critical = false } = {}) {
    for (let i = 0; i < maxAttempts; i++) {
      const result = get(selectorName, { critical: false });
      if (result) return result;
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, i)));
    }
    // Esgotou retries
    reportFailure(selectorName, { critical });
    return null;
  }

  /**
   * Verifica saúde geral. Roda no boot.
   */
  function healthCheck() {
    const required = ['chat', 'msg', 'contact', 'blocklist'];
    const missing = required.filter(s => !get(s));
    return {
      ok: missing.length === 0,
      missing,
      version: detectVersion(),
      timestamp: Date.now(),
    };
  }

  /**
   * Banner de fallback no topo do WhatsApp Web
   */
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
      document.body.appendChild(banner);

      // Auto-dismiss em 30s
      setTimeout(() => banner.remove(), 30000);
    } catch (_) {}
  }

  function hideFallbackBanner() {
    document.getElementById('whl-fallback-banner')?.remove();
    _bannerShown = false;
  }

  // ── Expor API pública ────────────────────────────────────────────────
  window.WHL_WaBridge = {
    get,
    getWithRetry,
    healthCheck,
    detectVersion,
    showFallbackBanner,
    hideFallbackBanner,
    reportFailure,
    // Para tests / debug
    _failed,
    SELECTORS,
  };

  // ── Health check inicial após load ───────────────────────────────────
  // Boot delayed: WhatsApp Web demora a injetar Store
  if (typeof window !== 'undefined' && window.location?.hostname?.includes('web.whatsapp.com')) {
    setTimeout(() => {
      const health = healthCheck();
      if (!health.ok) {
        console.warn('[WHL Bridge] Health check failed:', health);
        showFallbackBanner('Algumas integrações com WhatsApp não carregaram');
      } else {
        console.log('[WHL Bridge] Health OK', health);
      }
    }, 8000); // espera 8s pelo WhatsApp Web inicializar Store
  }
})();
