/**
 * 🌐 BackendClient v1.0 - Cliente de API para Backend
 * Conecta a extensão ao WhatsHybrid Backend API
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const CONFIG = {
    STORAGE_KEY: 'whl_backend_client',
    DEFAULT_BASE_URL: (globalThis.WHL_ENDPOINTS?.BACKEND_DEFAULT || 'http://localhost:3000'),
    // FIX PEND-MED-001: Fallback backend URLs for high availability
    FALLBACK_URLS: (globalThis.WHL_ENDPOINTS?.BACKEND_FALLBACKS || [
      'http://localhost:3000',
      'http://localhost:3001'
    ]),
    REQUEST_TIMEOUT: 30000,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000,
    HEALTH_CHECK_INTERVAL: 60000,  // Check backend health every 60s
    HEALTH_CHECK_TIMEOUT: 5000,     // Health check timeout
    MAX_HEALTH_FAILURES: 3,         // Switch to fallback after 3 failed health checks
    // ✅ BACKEND HABILITADO
    // Configure o backend em localhost:3000 antes de usar
    ENABLED: true
  };

  // SECURITY FIX P0-038: Prevent Prototype Pollution from storage
  function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const sanitized = {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key) && !dangerousKeys.includes(key)) {
        const value = obj[key];
        if (Array.isArray(value)) {
          sanitized[key] = value.map(item =>
            (item && typeof item === 'object') ? sanitizeObject(item) : item
          );
        } else if (value && typeof value === 'object') {
          sanitized[key] = sanitizeObject(value);
        } else {
          sanitized[key] = value;
        }
      }
    }

    return sanitized;
  }

  let state = {
    baseUrl: null,
    accessToken: null,
    refreshToken: null,
    user: null,
    workspace: null,
    connected: false,
    socket: null,
    // FIX PEND-MED-001: Backend health tracking for failover
    backendHealth: {
      currentUrlIndex: 0,           // Index into FALLBACK_URLS
      consecutiveFailures: 0,       // Track failures for current backend
      lastHealthCheck: 0,           // Timestamp of last health check
      healthCheckTimer: null,       // Interval timer for health checks
      isHealthy: true,              // Overall health status
      failoverHistory: []           // Track failover events for monitoring
    }
  };

  let initialized = false;

  // ============================================
  // BACKEND CONFIG COMPAT (v7.9.13+)
  // Unifica múltiplos schemas usados pelo projeto:
  // - whl_backend_client (este módulo)
  // - backend_url / backend_token (módulos legados: CopilotEngine, MessageCapture, Background)
  // - whl_backend_config (background/training sync)
  // - whl_backend_url (subscription-manager)
  // ============================================

  function normalizeBaseUrl(url) {
    const v = String(url || '').trim();
    return v ? v.replace(/\/$/, '') : '';
  }

  async function syncLegacyBackendConfig() {
    try {
      const baseUrl = normalizeBaseUrl(getBaseUrl());
      const token = state.accessToken || null;

      // Escrever apenas se houver URL válida (evita poluir storage com strings vazias)
      const payload = {};
      if (baseUrl) {
        payload.backend_url = baseUrl;
        payload.whl_backend_url = baseUrl;
        payload.whl_backend_config = {
          url: baseUrl,
          token
        };
      }
      // Token legado (consumido por CopilotEngine/Background)
      if (token) {
      payload.backend_token = token;
      // Alias para compatibilidade (CRM/Tasks e módulos legados)
      payload.whl_auth_token = token;
    } else {
        // Se desconectado, limpar token legado para não usar credencial expirada
        payload.backend_token = null;
        payload.whl_auth_token = null;
        if (payload.whl_backend_config) payload.whl_backend_config.token = null;
      }

      // Evitar set vazio
      if (Object.keys(payload).length) {
        await chrome.storage.local.set(payload);
      }
    } catch (e) {
      console.warn('[BackendClient] Falha ao sincronizar compat backend config:', e?.message || e);
    }
  }

  // ============================================
  // FIX PEND-MED-001: HEALTH CHECK & FAILOVER
  // ============================================

  /**
   * Gets the current backend URL with failover support
   * @returns {string} Current backend URL
   */
  function getCurrentBackendUrl() {
    if (state.baseUrl) {
      return state.baseUrl;
    }

    // Use failover URL if available
    const urlIndex = state.backendHealth.currentUrlIndex;
    return CONFIG.FALLBACK_URLS[urlIndex] || CONFIG.DEFAULT_BASE_URL;
  }

  /**
   * Checks backend health status
   * @returns {Promise<boolean>} true if healthy, false otherwise
   */
  async function checkBackendHealth() {
    const url = getCurrentBackendUrl();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.HEALTH_CHECK_TIMEOUT);

      const response = await fetch(`${url}/health`, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        // Reset failure counter on success
        state.backendHealth.consecutiveFailures = 0;
        state.backendHealth.isHealthy = true;
        state.backendHealth.lastHealthCheck = Date.now();
        return true;
      }

      return false;
    } catch (error) {
      console.warn('[BackendClient] Health check failed:', error.message);
      return false;
    }
  }

  /**
   * Handles backend failure and attempts failover
   */
  async function handleBackendFailure() {
    state.backendHealth.consecutiveFailures++;

    console.warn(`[BackendClient] Backend failure ${state.backendHealth.consecutiveFailures}/${CONFIG.MAX_HEALTH_FAILURES}`);

    // Failover if exceeded max failures
    if (state.backendHealth.consecutiveFailures >= CONFIG.MAX_HEALTH_FAILURES) {
      await attemptFailover();
    }
  }

  /**
   * Attempts to failover to next backend URL
   */
  async function attemptFailover() {
    const currentIndex = state.backendHealth.currentUrlIndex;
    const nextIndex = (currentIndex + 1) % CONFIG.FALLBACK_URLS.length;

    // If we've tried all URLs, stay on last one but log error
    if (nextIndex === 0 && state.backendHealth.failoverHistory.length > 0) {
      console.error('[BackendClient] All fallback backends failed. Staying on current URL.');
      state.backendHealth.isHealthy = false;
      return;
    }

    const previousUrl = CONFIG.FALLBACK_URLS[currentIndex];
    const nextUrl = CONFIG.FALLBACK_URLS[nextIndex];

    console.warn(`[BackendClient] Failing over: ${previousUrl} → ${nextUrl}`);

    state.backendHealth.currentUrlIndex = nextIndex;
    state.backendHealth.consecutiveFailures = 0;
    state.baseUrl = nextUrl;

    // Record failover event
    state.backendHealth.failoverHistory.push({
      timestamp: Date.now(),
      from: previousUrl,
      to: nextUrl,
      reason: 'health_check_failure'
    });

    // Keep only last 10 failover events
    if (state.backendHealth.failoverHistory.length > 10) {
      state.backendHealth.failoverHistory = state.backendHealth.failoverHistory.slice(-10);
    }

    // Sync updated URL to legacy configs
    await syncLegacyBackendConfig();
    await saveState();

    // Emit failover event
    if (window.EventBus) {
      window.EventBus.emit('backend:failover', {
        from: previousUrl,
        to: nextUrl
      });
    }
  }

  /**
   * Starts periodic health checks
   */
  function startHealthChecks() {
    // Clear existing timer
    if (state.backendHealth.healthCheckTimer) {
      clearInterval(state.backendHealth.healthCheckTimer);
    }

    // Perform initial health check
    checkBackendHealth();

    // Schedule periodic checks
    state.backendHealth.healthCheckTimer = setInterval(async () => {
      const isHealthy = await checkBackendHealth();

      if (!isHealthy) {
        await handleBackendFailure();
      }
    }, CONFIG.HEALTH_CHECK_INTERVAL);

    console.log(`[BackendClient] Health checks started (interval: ${CONFIG.HEALTH_CHECK_INTERVAL}ms)`);
  }

  /**
   * Stops periodic health checks
   */
  function stopHealthChecks() {
    if (state.backendHealth.healthCheckTimer) {
      clearInterval(state.backendHealth.healthCheckTimer);
      state.backendHealth.healthCheckTimer = null;
      console.log('[BackendClient] Health checks stopped');
    }
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================
  async function init() {
    if (initialized) return;

    // ⚠️ Verificar se backend está habilitado
    if (!CONFIG.ENABLED) {
      console.log('[BackendClient] ⚠️ Backend desabilitado (CONFIG.ENABLED = false)');
      initialized = true;
      state.connected = false;

      if (window.EventBus) {
        window.EventBus.emit('backend:initialized', { connected: false, disabled: true });
      }
      return;
    }

    try {
      await loadState();

      // Auto-connect se tiver tokens
      if (state.accessToken) {
        await validateToken();
      }

      initialized = true;
      console.log('[BackendClient] ✅ Inicializado');

      // FIX PEND-MED-001: Start health checks for failover monitoring
      startHealthChecks();

      if (window.EventBus) {
        window.EventBus.emit('backend:initialized', { connected: state.connected });
      }
    } catch (error) {
      console.error('[BackendClient] ❌ Erro na inicialização:', error);
    }
  }

  async function loadState() {
    try {
      const stored = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
      if (stored[CONFIG.STORAGE_KEY]) {
        // SECURITY FIX P0-038: Sanitize to prevent Prototype Pollution
        const loaded = JSON.parse(stored[CONFIG.STORAGE_KEY]);
        const sanitized = sanitizeObject(loaded);
        state = { ...state, ...sanitized };
      }

      // Migração/compat: sempre tentar recuperar do schema legado, para que a
      // URL persista mesmo antes do usuário fazer login. Token só é recuperado
      // se ainda não houver um no schema novo.
      {
        const legacy = await chrome.storage.local.get(['whl_backend_config', 'backend_url', 'backend_token', 'whl_backend_url']);
        const sanitizedLegacy = sanitizeObject(legacy);
        const legacyCfg = sanitizedLegacy?.whl_backend_config;

        const legacyUrl =
          normalizeBaseUrl(legacyCfg?.url) ||
          normalizeBaseUrl(sanitizedLegacy?.backend_url) ||
          normalizeBaseUrl(sanitizedLegacy?.whl_backend_url) ||
          '';
        const legacyToken = legacyCfg?.token || sanitizedLegacy?.backend_token || null;

        if (legacyUrl && !state.baseUrl) state.baseUrl = legacyUrl;
        if (legacyToken && !state.accessToken) state.accessToken = legacyToken;
      }
    } catch (e) {
      console.warn('[BackendClient] Falha ao carregar estado:', e);
    }
  }

  async function saveState() {
    try {
      await chrome.storage.local.set({
        [CONFIG.STORAGE_KEY]: JSON.stringify({
          baseUrl: state.baseUrl,
          accessToken: state.accessToken,
          refreshToken: state.refreshToken,
          user: state.user,
          workspace: state.workspace
        })
      });

      // Manter schemas legados em sincronia para evitar módulos "parciais"
      await syncLegacyBackendConfig();
    } catch (e) {
      console.error('[BackendClient] Falha ao salvar estado:', e);
    }
  }

  // ============================================
  // CONFIGURAÇÃO
  // ============================================
  function setBaseUrl(url) {
    state.baseUrl = normalizeBaseUrl(url);
    saveState();
  }

  function getBaseUrl() {
    // FIX PEND-MED-001: Use getCurrentBackendUrl() for automatic failover support
    return getCurrentBackendUrl();
  }

  function isConnected() {
    if (!CONFIG.ENABLED) return false;
    return state.connected && !!state.accessToken;
  }

  function getUser() {
    return state.user;
  }

  function getWorkspace() {
    return state.workspace;
  }

  // ============================================
  // HTTP CLIENT
  // ============================================
  /**
   * Executa fetch via FETCH_PROXY (chrome.runtime.sendMessage) para evitar CORS
   * quando rodando no contexto de web.whatsapp.com.
   * Se o background não estiver disponível, cai no fetch() direto.
   */
  function fetchViaProxy(url, method, headers, body, timeout) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        reject(new Error('chrome.runtime não disponível'));
        return;
      }
      chrome.runtime.sendMessage({
        type: 'FETCH_PROXY',
        url,
        method: method || 'GET',
        headers: headers || {},
        body: body || undefined,  // background FETCH_PROXY handler faz JSON.stringify
        timeout: timeout || 30000,
      }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp) {
          reject(new Error('Resposta vazia do FETCH_PROXY'));
          return;
        }
        if (!resp.success) {
          const err = new Error(resp.error || 'FETCH_PROXY falhou');
          if (resp.status) err.status = resp.status;
          reject(err);
          return;
        }
        resolve(resp);
      });
    });
  }

  async function request(endpoint, options = {}) {
    // ⚠️ Retornar erro se backend está desabilitado
    if (!CONFIG.ENABLED) {
      throw new Error('Backend desabilitado. Configure CONFIG.ENABLED = true para habilitar.');
    }

    const url = `${getBaseUrl()}${endpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      ...(state.accessToken && { 'Authorization': `Bearer ${state.accessToken}` }),
      ...options.headers
    };

    const requestBody = options.body;

    let lastError = null;

    for (let attempt = 0; attempt < CONFIG.RETRY_ATTEMPTS; attempt++) {
      try {
        let data, responseStatus, responseOk;

        // FIX CORS: Tentar via FETCH_PROXY (background service worker) primeiro.
        // Isso evita que fetch() direto de web.whatsapp.com seja bloqueado por
        // CORS/CSP ao tentar atingir localhost:3000 ou backend remoto.
        try {
          const proxyResp = await fetchViaProxy(
            url,
            options.method || 'GET',
            headers,
            requestBody,
            CONFIG.REQUEST_TIMEOUT
          );
          // FETCH_PROXY retorna {success, status, data (já parsed)} ou {success, status, text}
          responseStatus = proxyResp.status || 200;
          responseOk = responseStatus >= 200 && responseStatus < 300;
          data = proxyResp.data !== undefined
            ? proxyResp.data
            : (typeof proxyResp.text === 'string' ? JSON.parse(proxyResp.text) : proxyResp);
        } catch (proxyErr) {
          // FETCH_PROXY indisponível (ex: sidepanel descarregado) — fallback para fetch direto
          console.warn('[BackendClient] FETCH_PROXY indisponível, usando fetch() direto:', proxyErr.message);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
          const fetchConfig = {
            method: options.method || 'GET',
            headers,
            signal: controller.signal,
            ...(requestBody && { body: JSON.stringify(requestBody) })
          };
          const response = await fetch(url, fetchConfig);
          clearTimeout(timeoutId);
          data = await response.json();
          responseStatus = response.status;
          responseOk = response.ok;
        }

        // Normalizar response object para o resto do código
        const response = { status: responseStatus, ok: responseOk };

        if (!response.ok) {
          // Token expirado - tentar refresh
          if (response.status === 401 && state.refreshToken && !options._isRetry) {
            const refreshed = await refreshAccessToken();
            if (refreshed) {
              return request(endpoint, { ...options, _isRetry: true });
            }
          }

          // FIX v9.3.0: anexa metadados HTTP no erro pra que callers possam diferenciar
          // entre erros de rede, 402 (sem créditos), 429 (rate limit), 5xx etc.
          // Antes era um Error genérico — caller não conseguia tomar decisão informada.
          const httpError = new Error(data.message || `HTTP ${response.status}`);
          httpError.status = response.status;
          httpError.code = data.code || `HTTP_${response.status}`;
          httpError.body = data;
          throw httpError;
        }

        return data;
      } catch (error) {
        lastError = error;

        // v9.3.3: 4xx (exceto 401 já tratado, 408 timeout, 429 rate limit) são
        // erros de cliente — não fazem sentido retry. Antes: 400 (validação),
        // 403 (forbidden), 404 (not found) eram retried 3x com backoff
        // exponencial = ~7 segundos perdidos antes de mostrar erro ao usuário.
        if (error.status &&
            error.status >= 400 && error.status < 500 &&
            error.status !== 401 &&  // 401 já refresh-handled acima
            error.status !== 408 &&  // request timeout — pode ser transitório
            error.status !== 429) {  // rate limit — backend pediu retry
          throw error;
        }

        // FIX PEND-MED-001: Track backend failures for automatic failover
        if (error.name === 'AbortError' || error.message.includes('fetch')) {
          await handleBackendFailure();
        }

        if (attempt < CONFIG.RETRY_ATTEMPTS - 1) {
          await sleep(CONFIG.RETRY_DELAY * Math.pow(2, attempt));
        }
      }
    }

    throw lastError;
  }

  function get(endpoint, params = {}) {
    const query = new URLSearchParams(params).toString();
    return request(`${endpoint}${query ? '?' + query : ''}`);
  }

  function post(endpoint, body) {
    return request(endpoint, { method: 'POST', body });
  }

  function put(endpoint, body) {
    return request(endpoint, { method: 'PUT', body });
  }

  function del(endpoint) {
    return request(endpoint, { method: 'DELETE' });
  }

  // ============================================
  // AUTENTICAÇÃO
  // ============================================
  async function register(email, password, name) {
    const data = await post('/api/v1/auth/register', { email, password, name });
    
    state.accessToken = data.accessToken;
    state.refreshToken = data.refreshToken;
    state.user = data.user;
    state.workspace = data.workspace;
    state.connected = true;
    
    await saveState();
    connectSocket();
    
    if (window.EventBus) {
      window.EventBus.emit('backend:authenticated', { user: state.user });
    }

    return data;
  }

  async function login(email, password) {
    const data = await post('/api/v1/auth/login', { email, password });

    // v9.3.3 BUG FIX: se o usuário tem 2FA ativado, backend retorna
    //   { requires_totp: true, pre_auth_token: '...' }
    // SEM accessToken. Antes a extensão setava state.accessToken = undefined
    // e ficava "conectada" com token inválido. Próximo request: 401.
    // Agora retornamos a flag pra UI lidar (mostrar campo de código TOTP).
    if (data.requires_totp) {
      return {
        requires_totp: true,
        pre_auth_token: data.pre_auth_token,
      };
    }

    if (!data.accessToken) {
      throw new Error('Login response missing accessToken');
    }

    state.accessToken = data.accessToken;
    state.refreshToken = data.refreshToken;
    state.user = data.user;
    state.workspace = data.workspace;
    state.connected = true;

    await saveState();
    connectSocket();

    if (window.EventBus) {
      window.EventBus.emit('backend:authenticated', { user: state.user });
    }

    return data;
  }

  // v9.3.3: completa login após 2FA
  async function loginTotp(preAuthToken, code) {
    const data = await post('/api/v1/auth/login/totp', {
      pre_auth_token: preAuthToken,
      code,
    });

    if (!data.accessToken) {
      throw new Error('TOTP response missing accessToken');
    }

    state.accessToken = data.accessToken;
    state.refreshToken = data.refreshToken;
    state.user = data.user;
    state.workspace = data.workspace;
    state.connected = true;

    await saveState();
    connectSocket();

    if (window.EventBus) {
      window.EventBus.emit('backend:authenticated', { user: state.user });
    }

    return data;
  }

  async function logout() {
    try {
      await post('/api/v1/auth/logout', {});
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

    disconnectSocket();
    
    state.accessToken = null;
    state.refreshToken = null;
    state.user = null;
    state.workspace = null;
    state.connected = false;
    
    await saveState();

    // Garantir limpeza de schemas legados ao desconectar
    await syncLegacyBackendConfig();
    
    if (window.EventBus) {
      window.EventBus.emit('backend:disconnected');
    }
  }

  // v9.3.3: lock pra evitar race condition em refresh.
  // Sem lock: 5 requests paralelos com 401 disparariam 5 refreshes paralelos,
  // mas o backend rotaciona refresh tokens (1º refresh invalida o token original).
  // Resultado: do 2º refresh em diante, 401 → state limpo → usuário deslogado.
  let _refreshPromise = null;

  async function refreshAccessToken() {
    // Se já há refresh em andamento, espera pelo mesmo
    if (_refreshPromise) {
      return _refreshPromise;
    }

    _refreshPromise = (async () => {
      try {
        const data = await post('/api/v1/auth/refresh', { refreshToken: state.refreshToken });
        state.accessToken = data.accessToken;
        state.refreshToken = data.refreshToken;
        await saveState();
        console.log('[BackendClient] Token refreshed successfully');
        return true;
      } catch (error) {
        console.error('[BackendClient] Token refresh failed:', error);
        // IMPORTANTE: Limpar tokens para evitar loops de refresh
        state.accessToken = null;
        state.refreshToken = null;
        state.connected = false;
        state.user = null;
        await saveState();
        console.log('[BackendClient] Tokens cleared - user needs to login again');

        // v9.3.6: emite evento pra UI mostrar tela de re-login.
        // Antes UI ficava acreditando que estava conectada e ações
        // futuras falhavam silenciosamente até user perceber.
        try {
          if (window.EventBus) {
            window.EventBus.emit('backend:disconnected', { reason: 'refresh_failed' });
          }
          // Também desconecta socket pra parar de tentar reconectar com token velho
          disconnectSocket();
        } catch (_) {}

        return false;
      } finally {
        // Libera lock após 100ms (proteção contra burst de requests
        // que ainda estão chegando do timeout original)
        setTimeout(() => { _refreshPromise = null; }, 100);
      }
    })();

    return _refreshPromise;
  }

  async function validateToken() {
    try {
      const data = await get('/api/v1/auth/me');
      state.user = data.user;
      state.workspace = data.workspace;
      state.connected = true;
      connectSocket();
      return true;
    } catch (error) {
      state.connected = false;
      return false;
    }
  }

  async function getCurrentUser() {
    return get('/api/v1/auth/me');
  }

  // ============================================
  // SOCKET.IO
  // ============================================
  
  // ============================================
  // RECONEXÃO AUTOMÁTICA (v7.5.0)
  // ============================================
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 10;
  const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

  function scheduleReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log('[BackendClient] Máximo de tentativas atingido');
      updateSocketUI(false, 'Falha na reconexão');
      return;
    }
    
    const delay = RECONNECT_DELAYS[Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1)];
    reconnectAttempts++;
    
    console.log('[BackendClient] Reconectando em', delay/1000, 's (tentativa', reconnectAttempts + ')');
    updateSocketUI(false, 'Reconectando... (' + reconnectAttempts + ')');
    
    setTimeout(() => {
      if (state.accessToken && !state.socket?.connected) {
        connectSocket();
      }
    }, delay);
  }

  function resetReconnect() {
    reconnectAttempts = 0;
  }


  
  // ============================================
  // HEARTBEAT (v7.5.0)
  // ============================================
  let heartbeatInterval = null;

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(() => {
      if (state.socket?.connected) {
        state.socket.emit('ping');
        console.log('[BackendClient] ❤️ Heartbeat enviado');
      }
    }, 30000);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }


  function connectSocket() {
    if (state.socket || !state.accessToken) return;

    try {
      // Verifica se Socket.IO está disponível
      if (typeof io === 'undefined') {
        // Tenta carregar dinamicamente
        loadSocketIO().then(() => {
          if (typeof io !== 'undefined') {
            initializeSocket();
          } else {
            console.warn('[BackendClient] Socket.IO não disponível após carregamento');
            updateSocketUI(false, 'Aguardando login');
          }
        }).catch(err => {
          console.warn('[BackendClient] Erro ao carregar Socket.IO:', err);
          updateSocketUI(false, 'Aguardando login');
        });
        return;
      }

      initializeSocket();
    } catch (error) {
      console.error('[BackendClient] Socket connection failed:', error);
      updateSocketUI(false, 'Erro de conexão');
    }
  }

  async function loadSocketIO() {
    return new Promise((resolve, reject) => {
      if (typeof io !== 'undefined') {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('lib/socket.io.min.js');
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function initializeSocket() {
    try {
      state.socket = io(getBaseUrl(), {
        auth: { token: state.accessToken },
        transports: ['websocket', 'polling']
      });

      state.socket.on('connect', () => {
        console.log('[BackendClient] Socket conectado');
        resetReconnect();
        startHeartbeat();
        state.socket.emit('join:workspace', state.workspace?.id);
        updateSocketUI(true, 'Conectado');
        
        // v7.5.0: Sincronizar tudo após conexão
        setTimeout(() => {
          console.log('[BackendClient] 🔄 Iniciando sincronização completa...');
          syncAll();
        }, 1000);
        
        if (window.EventBus) {
          window.EventBus.emit('backend:socket:connected');
        }
      });

      state.socket.on('disconnect', (reason) => {
        console.log('[BackendClient] Socket desconectado:', reason);
        if (reason !== 'io client disconnect' && state.accessToken) {
          scheduleReconnect();
        }
        updateSocketUI(false, 'Desconectado');
        if (window.EventBus) {
          window.EventBus.emit('backend:socket:disconnected');
        }
      });

      state.socket.on('connect_error', (err) => {
        console.warn('[BackendClient] Socket connect error:', err.message);
        updateSocketUI(false, 'Erro: ' + err.message);
      });

      // Forward events to EventBus
      const events = [
        'contact:created', 'contact:updated', 'contact:deleted',
        'message:created', 'conversation:updated',
        'campaign:created', 'campaign:updated',
        'deal:created', 'deal:updated',
        'task:created', 'task:updated', 'task:completed'
      ];

      events.forEach(event => {
        state.socket.on(event, (data) => {
          if (window.EventBus) {
            window.EventBus.emit(`backend:${event}`, data);
          }
        });
      });
    } catch (error) {
      console.error('[BackendClient] Socket init failed:', error);
      updateSocketUI(false, 'Erro de inicialização');
    }
  }

  function updateSocketUI(connected, text) {
    const statusIcon = document.getElementById('backend_ws_status');
    const statusText = document.getElementById('backend_ws_text');
    const hintText = document.getElementById('backend_ws_hint');
    
    if (statusIcon) {
      statusIcon.textContent = connected ? '🟢' : '🔴';
    }
    if (statusText) {
      statusText.textContent = text || (connected ? 'Conectado' : 'Desconectado');
    }
    if (hintText) {
      hintText.style.display = connected ? 'none' : 'block';
      if (!connected && text && text.includes('Erro')) {
        hintText.textContent = '❌ ' + text;
        hintText.style.color = '#ef4444';
      } else if (!connected) {
        hintText.textContent = '⚠️ Faça login acima para ativar a sincronização em tempo real';
        hintText.style.color = 'var(--mod-text-muted)';
      }
    }
  }

  function disconnectSocket() {
    stopHeartbeat();
    if (state.socket) {
      state.socket.disconnect();
      state.socket = null;
    }
  }

  // ============================================
  // API METHODS
  // ============================================

  // Contacts
  const contacts = {
    list: (params) => get('/api/v1/contacts', params),
    get: (id) => get(`/api/v1/contacts/${id}`),
    create: (data) => post('/api/v1/contacts', data),
    update: (id, data) => put(`/api/v1/contacts/${id}`, data),
    delete: (id) => del(`/api/v1/contacts/${id}`),
    import: (contacts) => post('/api/v1/contacts/import', { contacts })
  };

  // Conversations
  const conversations = {
    list: (params) => get('/api/v1/conversations', params),
    get: (id) => get(`/api/v1/conversations/${id}`),
    addMessage: (id, content, type) => post(`/api/v1/conversations/${id}/messages`, { content, message_type: type }),
    update: (id, data) => put(`/api/v1/conversations/${id}`, data)
  };

  // Campaigns
  const campaigns = {
    list: (params) => get('/api/v1/campaigns', params),
    get: (id) => get(`/api/v1/campaigns/${id}`),
    create: (data) => post('/api/v1/campaigns', data),
    update: (id, data) => put(`/api/v1/campaigns/${id}`, data),
    delete: (id) => del(`/api/v1/campaigns/${id}`)
  };

  // CRM
  const crm = {
    deals: {
      list: (params) => get('/api/v1/crm/deals', params),
      get: (id) => get(`/api/v1/crm/deals/${id}`),
      create: (data) => post('/api/v1/crm/deals', data),
      update: (id, data) => put(`/api/v1/crm/deals/${id}`, data),
      delete: (id) => del(`/api/v1/crm/deals/${id}`)
    },
    pipeline: {
      get: () => get('/api/v1/crm/pipeline'),
      createStage: (data) => post('/api/v1/crm/pipeline/stages', data),
      updateStage: (id, data) => put(`/api/v1/crm/pipeline/stages/${id}`, data),
      deleteStage: (id) => del(`/api/v1/crm/pipeline/stages/${id}`)
    },
    labels: {
      list: () => get('/api/v1/crm/labels'),
      create: (data) => post('/api/v1/crm/labels', data),
      update: (id, data) => put(`/api/v1/crm/labels/${id}`, data),
      delete: (id) => del(`/api/v1/crm/labels/${id}`)
    },
    // v9.3.3: sync e data exposed via BackendClient
    // Antes crm.js fazia fetch direto, perdia retry/refresh do BackendClient
    // Se token expirava durante sync, o usuário perdia trabalho silenciosamente.
    sync: (payload) => post('/api/v1/crm/sync', payload),
    getData: () => get('/api/v1/crm/data'),
  };

  // Tasks
  const tasks = {
    list: (params) => get('/api/v1/tasks', params),
    getOverdue: () => get('/api/v1/tasks/overdue'),
    get: (id) => get(`/api/v1/tasks/${id}`),
    create: (data) => post('/api/v1/tasks', data),
    update: (id, data) => put(`/api/v1/tasks/${id}`, data),
    complete: (id) => post(`/api/v1/tasks/${id}/complete`),
    delete: (id) => del(`/api/v1/tasks/${id}`)
  };

  // Templates
  const templates = {
    list: (params) => get('/api/v1/templates', params),
    get: (id) => get(`/api/v1/templates/${id}`),
    create: (data) => post('/api/v1/templates', data),
    update: (id, data) => put(`/api/v1/templates/${id}`, data),
    use: (id) => post(`/api/v1/templates/${id}/use`),
    delete: (id) => del(`/api/v1/templates/${id}`)
  };

  // AI
  const ai = {
    complete: (messages, options = {}) => post('/api/v1/ai/complete', { messages, ...options }),

    // v9.3.0: process() chama o AIOrchestrator real (memory + RAG + commercial intel +
    // strategy + behavior adapter + few-shot graduados + quality cycle + safety + auto-learn).
    // Use ESTA chamada pra sugestões reais — NÃO use complete() que é pass-through cru.
    //
    // Body: { chatId, message, language?, businessRules? }
    // Retorna: { success, response, metadata: { intent, qualityScore, clientStage, ... }, intelligence }
    process: (chatId, message, options = {}) => post('/api/v2/ai/process', {
      chatId,
      message,
      language: options.language || 'pt-BR',
      businessRules: options.businessRules || [],
    }),

    // Feedback do usuário — fecha ciclo de aprendizado.
    // Aceita objeto completo OU os 3 args básicos (interactionId, feedback, opts).
    feedback: (interactionIdOrPayload, feedback, opts = {}) => {
      // Forma extendida: passou objeto direto
      if (typeof interactionIdOrPayload === 'object' && interactionIdOrPayload !== null) {
        return post('/api/v1/ai/learn/feedback', interactionIdOrPayload);
      }
      // Forma simples: (interactionId, 'positive'|'negative', { userMessage, assistantResponse })
      const rating = feedback === 'positive' ? 'positive' :
                     feedback === 'negative' ? 'negative' : feedback;
      return post('/api/v1/ai/learn/feedback', {
        interactionId: interactionIdOrPayload,
        rating,
        chatId: opts.chatId || null,
        userMessage: opts.userMessage || '',
        assistantResponse: opts.assistantResponse || '',
        correctedResponse: opts.correctedResponse || null,
        feedbackType: opts.feedbackType || 'rating',
      });
    },

    getCredits: () => get('/api/v1/ai/credits'),
    getUsage: (days) => get('/api/v1/ai/usage', { days }),
    knowledge: {
      list: (params) => get('/api/v1/ai/knowledge', params),
      add: (data) => post('/api/v1/ai/knowledge', data),
      delete: (id) => del(`/api/v1/ai/knowledge/${id}`)
    }
  };

  // v9.3.0: Autopilot maturity — graduação training → ready → live
  const autopilotMaturity = {
    /** GET status atual + porcentagem de progresso */
    status: () => get('/api/v1/autopilot/maturity'),
    /**
     * Registra outcome de uma sugestão.
     * @param {'approved'|'edited'|'rejected'} outcome
     */
    record: (outcome, opts = {}) => post('/api/v1/autopilot/maturity/record', {
      outcome,
      interactionId: opts.interactionId || null,
      intent: opts.intent || null,
    }),
    /** READY → LIVE (decisão humana) */
    promote: () => post('/api/v1/autopilot/maturity/promote'),
    /** PAUSED → LIVE (após queda de qualidade) */
    resume: () => post('/api/v1/autopilot/maturity/resume'),
    /** Reseta tudo pra TRAINING */
    reset: () => post('/api/v1/autopilot/maturity/reset'),
  };

  // Webhooks
  const webhooks = {
    list: () => get('/api/v1/webhooks'),
    get: (id) => get(`/api/v1/webhooks/${id}`),
    create: (data) => post('/api/v1/webhooks', data),
    update: (id, data) => put(`/api/v1/webhooks/${id}`, data),
    test: (id) => post(`/api/v1/webhooks/${id}/test`),
    delete: (id) => del(`/api/v1/webhooks/${id}`)
  };

  // Settings
  const settings = {
    getWorkspace: () => get('/api/v1/settings/workspace'),
    updateWorkspace: (data) => put('/api/v1/settings/workspace', data),
    generateApiKey: () => post('/api/v1/settings/workspace/api-key'),
    // v9.4.6: updateAiKeys REMOVIDO. Endpoint /api/v1/settings/ai-keys foi removido
    // em v9.4.6 (era 410 Gone desde v9.4.0). Backend-Only AI: cliente não configura keys.
    getUser: () => get('/api/v1/settings/user'),
    updateUser: (data) => put('/api/v1/settings/user', data),
    getBilling: () => get('/api/v1/settings/billing'),
    export: () => get('/api/v1/settings/export')
  };

  // ============================================
  // SYNC
  // ============================================
  async function syncContacts(localContacts) {
    const result = await contacts.import(localContacts);
    
    if (window.EventBus) {
      window.EventBus.emit('backend:sync:contacts', result);
    }

    return result;
  }

  async function syncAll() {
    if (!isConnected()) {
      throw new Error('Not connected to backend');
    }

    const results = {
      contacts: await contacts.list({ limit: 1000 }),
      deals: await crm.deals.list(),
      tasks: await tasks.list(),
      templates: await templates.list(),
      labels: await crm.labels.list()
    };

    if (window.EventBus) {
      window.EventBus.emit('backend:sync:complete', results);
    }

    return results;
  }

  // ============================================
  // HELPERS
  // ============================================
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function debug() {
    return {
      initialized,
      connected: state.connected,
      baseUrl: getBaseUrl(),
      hasToken: !!state.accessToken,
      user: state.user,
      workspace: state.workspace,
      socketConnected: state.socket?.connected
    };
  }

  // ============================================
  // SINCRONIZAÇÃO EM TEMPO REAL
  // ============================================
  
  // Sincronização de Contatos via Socket
  function syncContactsRealtime() {
    if (!state.socket?.connected) return;
    state.socket.emit('sync:contacts', { timestamp: Date.now() });
    console.log('[BackendClient] 📇 Sync contatos solicitado');
  }
  
  // Sincronização de Deals via Socket
  function syncDealsRealtime() {
    if (!state.socket?.connected) return;
    state.socket.emit('sync:deals', { timestamp: Date.now() });
    console.log('[BackendClient] 💰 Sync deals solicitado');
  }
  
  // Sincronização de Tarefas via Socket
  function syncTasksRealtime() {
    if (!state.socket?.connected) return;
    state.socket.emit('sync:tasks', { timestamp: Date.now() });
    console.log('[BackendClient] ✅ Sync tarefas solicitado');
  }
  
  // Sincronização de Mensagens via Socket
  function syncMessagesRealtime() {
    if (!state.socket?.connected) return;
    state.socket.emit('sync:messages', { timestamp: Date.now() });
    console.log('[BackendClient] 💬 Sync mensagens solicitado');
  }
  
  // Sincronização completa em tempo real
  function syncAllRealtime() {
    if (!state.socket?.connected) return;
    console.log('[BackendClient] 🔄 Iniciando sincronização completa em tempo real...');
    syncContactsRealtime();
    setTimeout(syncDealsRealtime, 500);
    setTimeout(syncTasksRealtime, 1000);
    setTimeout(syncMessagesRealtime, 1500);
  }
  
  // Atualizar UI do sidepanel após conexão socket
  function updateSidepanelSocketUI(connected, message) {
    const statusEl = document.getElementById('sp_socket_status');
    if (statusEl) {
      statusEl.innerHTML = connected 
        ? '🟢 Conectado' 
        : '🔴 ' + (message || 'Desconectado');
      statusEl.style.color = connected ? '#25D366' : '#ea4335';
    }
    
    // Emitir evento para outros módulos
    if (window.EventBus) {
      window.EventBus.emit('socket:status', { connected, message });
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  window.BackendClient = {
    // Lifecycle
    init,
    
    // Configuration
    setBaseUrl,
    getBaseUrl,
    isConnected,
    getUser,
    getWorkspace,
    
    // Auth
    register,
    login,
    loginTotp, // v9.3.3 — finaliza login com 2FA
    logout,
    getCurrentUser,
    
    // API
    contacts,
    conversations,
    campaigns,
    crm,
    tasks,
    templates,
    ai,
    autopilotMaturity, // v9.3.0
    webhooks,
    settings,
    
    // Sync
    syncContacts,
    syncAll,

    // Real-time Sync
    syncContactsRealtime,
    syncDealsRealtime,
    syncTasksRealtime,
    syncMessagesRealtime,
    syncAllRealtime,
    updateSidepanelSocketUI,

    // FIX PEND-MED-001: Health Check & Failover
    checkBackendHealth,
    getCurrentBackendUrl,
    startHealthChecks,
    stopHealthChecks,
    getBackendHealth: () => ({ ...state.backendHealth }),
    
    // Raw HTTP
    get,
    post,
    put,
    del,
    request,
    
    // Debug
    debug
  };

  console.log('[BackendClient] 🌐 Cliente de backend v1.0 carregado');
  
  // Cleanup ao descarregar
  window.addEventListener('beforeunload', () => {
    disconnectSocket();
  });
  
  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(init, 500);
    });
  } else {
    setTimeout(init, 500);
  }
})();

