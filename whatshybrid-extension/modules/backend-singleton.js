(function () {
  'use strict';

  /**
   * BackendSingleton (compatibilidade)
   * - Evita conexões WebSocket sem autenticação
   * - Busca token do storage/config antes de conectar
   *
   * Obs: o projeto usa `BackendClient` como cliente principal; este módulo existe
   * para cobrir integrações legadas e cumprir verificação do manual.
   */

  async function getToken() {
    try {
      const stored = await chrome.storage.local.get('whl_backend_config');
      const cfg = stored?.whl_backend_config || {};
      return cfg.token || cfg.accessToken || cfg.jwt || null;
    } catch (_) {
      return null;
    }
  }

  function getBackendWsUrl() {
    const cfg = window?.WHL_CONFIG || {};
    return cfg.backendWsUrl || cfg.wsUrl || cfg.websocketUrl || '';
  }

  async function connect(url = '') {
    const wsUrl = String(url || getBackendWsUrl() || '');
    const token = await getToken();

    if (!token) {
      console.warn('[BackendSingleton] Conexão recusada: token não configurado');
      return null;
    }
    if (!wsUrl) {
      console.warn('[BackendSingleton] Conexão recusada: backendWsUrl não configurado');
      return null;
    }

    try {
      const fullUrl = wsUrl.includes('?')
        ? `${wsUrl}&token=${encodeURIComponent(token)}`
        : `${wsUrl}?token=${encodeURIComponent(token)}`;
      return new WebSocket(fullUrl);
    } catch (e) {
      console.error('[BackendSingleton] Erro ao conectar:', e);
      return null;
    }
  }

  window.BackendSingleton = {
    connect,
    getToken
  };
})();

