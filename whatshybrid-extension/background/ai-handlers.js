/**
 * WhatsHybrid Background - AI / Memory / Few-shot / Proxy handlers
 *
 * Este arquivo foi extraído do `background.js` para reduzir tamanho e melhorar manutenibilidade
 * sem alterar comportamento (HIGH-011).
 */

// ============================================
// AI SYSTEM HANDLERS
// ============================================

// Memory queue for offline storage
let memoryQueue = [];
const MAX_MEMORY_QUEUE = 500;
const MEMORY_EVENT_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const MEMORY_QUEUE_STORAGE_KEY = 'whl_memory_queue';

// Carregar queue do storage ao inicializar (previne perda quando SW é terminado)
(async () => {
  try {
    const result = await chrome.storage.local.get([MEMORY_QUEUE_STORAGE_KEY]);
    if (result[MEMORY_QUEUE_STORAGE_KEY] && Array.isArray(result[MEMORY_QUEUE_STORAGE_KEY])) {
      memoryQueue = result[MEMORY_QUEUE_STORAGE_KEY];
      console.log('[Background] ✅ Memory queue carregada do storage:', memoryQueue.length, 'eventos');
    }
  } catch (error) {
    console.error('[Background] ❌ Erro ao carregar memory queue:', error);
  }
})();

/**
 * Enfileira evento de memória
 */
async function enqueueMemoryEvent(event) {
  try {
    memoryQueue.push({
      ...event,
      timestamp: event.timestamp || Date.now()
    });
    
    // Limita tamanho da fila
    if (memoryQueue.length > MAX_MEMORY_QUEUE) {
      memoryQueue = memoryQueue.slice(-MAX_MEMORY_QUEUE);
    }
    
    // Remove eventos muito antigos
    const cutoff = Date.now() - MEMORY_EVENT_MAX_AGE;
    memoryQueue = memoryQueue.filter(e => e.timestamp > cutoff);
    
    // Salva fila
    await chrome.storage.local.set({ whl_memory_queue: memoryQueue });
    
    console.log('[Background] Evento de memória enfileirado. Fila:', memoryQueue.length);
  } catch (error) {
    console.error('[Background] Erro ao enfileirar evento:', error);
  }
}

/**
 * Envia fila de memórias para o backend com exponential backoff
 * @param {Object} settings - Configurações do backend
 * @param {number} retryCount - Contador de tentativas (para recursão)
 * @returns {Promise<Object>} Resultado da sincronização
 */
async function flushMemoryQueue(settings, retryCount = 0) {
  if (memoryQueue.length === 0) return { success: true, synced: 0 };

  const MAX_RETRIES = 5;
  const BASE_DELAY = 1000; // 1 segundo
  const MAX_DELAY = 5 * 60 * 1000; // 5 minutos

  try {
    // Backend config compat: aceitar múltiplos schemas
    const stored = await chrome.storage.local.get(['whl_backend_config', 'whl_backend_client', 'backend_url', 'backend_token', 'whl_backend_url']);
    const cfg = stored?.whl_backend_config || null;

    let backendUrl = cfg?.url || settings?.backend_url || stored?.backend_url || stored?.whl_backend_url || (globalThis.WHL_ENDPOINTS?.BACKEND_DEFAULT || 'http://localhost:3000');
    let token = cfg?.token || settings?.backend_token || stored?.backend_token || null;

    if ((!backendUrl || !token) && stored?.whl_backend_client) {
      try {
        const parsed = JSON.parse(stored.whl_backend_client);
        backendUrl = backendUrl || parsed?.baseUrl || backendUrl;
        token = token || parsed?.accessToken || token;
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }

    backendUrl = String(backendUrl || (globalThis.WHL_ENDPOINTS?.BACKEND_DEFAULT || 'http://localhost:3000')).replace(/\/$/, '');

    if (!token) {
      console.warn('[Background] Token não configurado, memórias não serão sincronizadas');
      return { success: false, error: 'NO_TOKEN' };
    }

    // Marcar eventos com retry count
    const eventsToSync = memoryQueue.map(e => ({
      ...e,
      retryCount: (e.retryCount || 0) + 1
    }));

    const response = await fetch(`${backendUrl}/api/v1/memory/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        // Compat: backend v1 espera "memories"; mantemos "events" por legado
        memories: eventsToSync.map(e => {
          const mem = (e && e.memory) ? e.memory : (e || {});
          return {
            id: mem.id || e.id,
            chatId: mem.chatId || e.chatId || e.chatKey || mem.chatKey,
            chatTitle: mem.chatTitle || mem.chat_title || mem.title || '',
            phoneNumber: mem.phoneNumber || mem.phone_number || mem.phone || '',
            summary: mem.summary || mem.profile || '',
            facts: mem.facts || [],
            interactions: mem.interactions || [],
            context: mem.context || {},
            metrics: mem.metrics || {},
            version: mem.version || e.version || 1,
            updatedAt: mem.updatedAt || mem.updated_at || e.timestamp || Date.now(),
            _deleted: !!(mem._deleted || e._deleted)
          };
        }),
        events: eventsToSync
      })
    });

    if (response.ok) {
      console.log(`[Background] ✅ Memórias sincronizadas: ${memoryQueue.length} eventos`);
      memoryQueue = [];
      await chrome.storage.local.set({ whl_memory_queue: [] });
      return { success: true, synced: eventsToSync.length };
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn(`[Background] ⚠️ Falha na sincronização (tentativa ${retryCount + 1}/${MAX_RETRIES}): ${error.message}`);

    // Se excedeu máximo de tentativas
    if (retryCount >= MAX_RETRIES) {
      console.error('[Background] ❌ Máximo de tentativas excedido. Eventos serão mantidos na fila.');

      // Marcar eventos com erro
      memoryQueue = memoryQueue.map(e => ({
        ...e,
        retryCount: (e.retryCount || 0) + 1,
        needsManualSync: true,
        lastError: error.message,
        lastRetryAt: Date.now()
      }));

      await chrome.storage.local.set({ whl_memory_queue: memoryQueue });
      return { success: false, error: 'MAX_RETRIES_EXCEEDED', pending: memoryQueue.length };
    }

    // Calcular delay exponencial: 1s, 2s, 4s, 8s, 16s, max 5min
    const delay = Math.min(BASE_DELAY * Math.pow(2, retryCount), MAX_DELAY);
    console.log(`[Background] 🔄 Tentando novamente em ${Math.round(delay/1000)}s...`);

    // Aguardar e tentar novamente (recursivo)
    await new Promise(resolve => setTimeout(resolve, delay));
    return flushMemoryQueue(settings, retryCount + 1);
  }
}

/**
 * Handler: MEMORY_PUSH
 */
async function handleMemoryPush(message, sender, sendResponse) {
  try {
    await enqueueMemoryEvent(message.event || { type: 'unknown' });
    
    // Tenta sincronizar se habilitado
    const settings = await chrome.storage.local.get(['backend_token', 'backend_url', 'memory_sync_enabled']);
    if (settings.memory_sync_enabled) {
      await flushMemoryQueue(settings);
    }
    
    sendResponse({ success: true });
  } catch (error) {
    console.error('[Background] Erro em MEMORY_PUSH:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handler: MEMORY_QUERY
 */
async function handleMemoryQuery(message, sender, sendResponse) {
  try {
    const settings = await chrome.storage.local.get(['backend_token', 'backend_url']);
    const backendUrl = settings?.backend_url || (globalThis.WHL_ENDPOINTS?.BACKEND_DEFAULT || 'http://localhost:3000');
    const token = settings?.backend_token;
    
    if (!token) {
      sendResponse({ success: false, error: 'Backend não configurado' });
      return;
    }
    
    // Rota corrigida (Memória v1)
    const response = await fetch(`${backendUrl}/api/v1/memory/query?chatKey=${encodeURIComponent(message.chatKey)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      sendResponse({ success: true, memory: data.memory });
    } else {
      sendResponse({ success: false, error: `HTTP ${response.status}` });
    }
  } catch (error) {
    console.error('[Background] Erro em MEMORY_QUERY:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handler: GET_CONFIDENCE
 */
async function handleGetConfidence(message, sender, sendResponse) {
  try {
    const data = await chrome.storage.local.get('whl_confidence_system');
    if (data.whl_confidence_system) {
      const confidence = JSON.parse(data.whl_confidence_system);
      sendResponse({ success: true, confidence });
    } else {
      sendResponse({ success: true, confidence: { score: 0, level: 'beginner' } });
    }
  } catch (error) {
    console.error('[Background] Erro em GET_CONFIDENCE:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handler: UPDATE_CONFIDENCE
 */
async function handleUpdateConfidence(message, sender, sendResponse) {
  try {
    const event = message.event || {};
    
    // Envia para backend se configurado
    const settings = await chrome.storage.local.get(['backend_token', 'backend_url']);
    const backendUrl = settings?.backend_url || (globalThis.WHL_ENDPOINTS?.BACKEND_DEFAULT || 'http://localhost:3000');
    const token = settings?.backend_token;
    
    if (token) {
      // Rota corrigida para Node.js
      fetch(`${backendUrl}/api/v1/ai/learn/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(event)
      }).catch(err => console.warn('[Background] Erro ao enviar confidence:', err));
    }
    
    sendResponse({ success: true });
  } catch (error) {
    console.error('[Background] Erro em UPDATE_CONFIDENCE:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handler: TOGGLE_COPILOT
 */
async function handleToggleCopilot(message, sender, sendResponse) {
  try {
    const enabled = !!message.enabled;
    await chrome.storage.local.set({ whl_copilot_enabled: enabled });
    sendResponse({ success: true, enabled });
  } catch (error) {
    console.error('[Background] Erro em TOGGLE_COPILOT:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handler: FEW_SHOT_PUSH
 */
async function handleFewShotPush(message, sender, sendResponse) {
  try {
    const examples = message.examples || [];
    await chrome.storage.local.set({ whl_few_shot_examples: examples });
    sendResponse({ success: true, count: examples.length });
  } catch (error) {
    console.error('[Background] Erro em FEW_SHOT_PUSH:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handler: FEW_SHOT_SYNC
 */
async function handleFewShotSync(message, sender, sendResponse) {
  try {
    const settings = await chrome.storage.local.get(['backend_token', 'backend_url']);
    const backendUrl = settings?.backend_url || (globalThis.WHL_ENDPOINTS?.BACKEND_DEFAULT || 'http://localhost:3000');
    const token = settings?.backend_token;
    
    if (!token) {
      sendResponse({ success: false, error: 'Backend não configurado' });
      return;
    }
    
    const examplesData = await chrome.storage.local.get(['whl_few_shot_examples']);
    const examples = examplesData.whl_few_shot_examples || [];

    // GHOST-002 FIX: Usar rota correta /api/v1/examples/sync ao invés de /api/v1/ai/few-shot/sync (ghost route)
    const response = await fetch(`${backendUrl}/api/v1/examples/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ examples })
    });
    
    if (response.ok) {
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: `HTTP ${response.status}` });
    }
  } catch (error) {
    console.error('[Background] Erro em FEW_SHOT_SYNC:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Handler: FETCH_PROXY
 * Permite requisições externas via background (evita CORS no contexto do sidepanel/content)
 *
 * FIX HIGH SECURITY: Antes aceitava qualquer URL — vetor de SSRF.
 * Agora valida contra allowlist de hosts/protocolos. Bloqueia file://, data:,
 * IPs internos não-localhost, e hosts não autorizados.
 */

// Allowlist de hosts permitidos para FETCH_PROXY.
// Mantém compatibilidade com host_permissions do manifest + backends comuns.
// v9.4.4 BUG #119: hosts removidos (api.openai.com, api.anthropic.com,
// api.groq.com, generativelanguage.googleapis.com, speech.googleapis.com)
// pra alinhar com manifest após Backend-Only AI. Manifest também removeu
// host_permissions desses domínios — defesa em profundidade dupla.
// Speech.googleapis ainda existe em training/speech-to-text.js mas é
// dead code (Bug #117 neutralizou _getKey).
const FETCH_PROXY_ALLOWED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
];

// Sufixos de domínio aceitos (subdomínios)
const FETCH_PROXY_ALLOWED_SUFFIXES = [
  // Backend próprio do user. .whatshybrid.com / .com.br / etc devem ser
  // configurados via WHL_ENDPOINTS pelo deployment.
];

function isFetchProxyUrlAllowed(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch (_) {
    return { ok: false, reason: 'invalid_url' };
  }

  // Bloqueia protocolos perigosos
  if (!['http:', 'https:'].includes(u.protocol)) {
    return { ok: false, reason: `protocol_blocked:${u.protocol}` };
  }

  const host = u.hostname.toLowerCase();

  // Bloqueia IPs de rede privada (exceto localhost explícito)
  // 169.254.x.x = AWS metadata; 10.x.x.x, 172.16-31.x.x, 192.168.x.x = LAN
  if (/^(169\.254|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(host)) {
    return { ok: false, reason: `private_ip_blocked:${host}` };
  }

  // Allowlist
  if (FETCH_PROXY_ALLOWED_HOSTS.includes(host)) return { ok: true };
  if (FETCH_PROXY_ALLOWED_SUFFIXES.some(suf => host.endsWith(suf))) return { ok: true };

  // Permitir BACKEND_URL configurado dinamicamente via storage
  // (será validado no caller via apiConfig — aqui passamos por consideração)
  return { ok: false, reason: `host_not_allowed:${host}` };
}

async function handleFetchProxy(message, sender, sendResponse) {
  try {
    const url = message.url;
    const method = message.method || 'GET';
    const headers = message.headers || {};
    const body = message.body;
    
    if (!url) {
      sendResponse({ success: false, error: 'URL não fornecida' });
      return;
    }

    // FIX SSRF: validar URL contra allowlist antes de qualquer fetch
    const validation = isFetchProxyUrlAllowed(url);
    if (!validation.ok) {
      // Tenta uma checagem extra: usuários podem ter customizado backend URL via storage
      try {
        const cfg = await new Promise(resolve => {
          chrome.storage?.local?.get?.(['whl_backend_url', 'backend_url'], data => resolve(data || {}));
        });
        const customBackend = cfg.whl_backend_url || cfg.backend_url;
        if (customBackend) {
          const customUrl = new URL(customBackend);
          const targetUrl = new URL(url);
          // Só permite se o host bate com o backend configurado pelo usuário
          if (customUrl.hostname === targetUrl.hostname && customUrl.port === targetUrl.port) {
            // OK — backend customizado pelo usuário
          } else {
            console.warn(`[FETCH_PROXY] Bloqueado (SSRF): ${validation.reason} | url=${url}`);
            sendResponse({ success: false, error: 'URL não permitida pela política da extensão', code: 'SSRF_BLOCKED' });
            return;
          }
        } else {
          console.warn(`[FETCH_PROXY] Bloqueado (SSRF): ${validation.reason} | url=${url}`);
          sendResponse({ success: false, error: 'URL não permitida pela política da extensão', code: 'SSRF_BLOCKED' });
          return;
        }
      } catch (storageErr) {
        console.warn(`[FETCH_PROXY] Bloqueado (SSRF): ${validation.reason} | url=${url}`);
        sendResponse({ success: false, error: 'URL não permitida', code: 'SSRF_BLOCKED' });
        return;
      }
    }
    
    // FIX MED: AbortController com timeout — sem isso, slow-server attacks ou
    // upstream lento bloqueiam o service worker indefinidamente.
    const timeoutMs = Math.min(parseInt(message.timeout, 10) || 30000, 60000); // max 60s
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    
    const contentType = response.headers?.get?.('content-type') || '';
    
    const text = await response.text();

    
    let data = text;

    
    // Compat: manter contrato com consumidores (AIGateway) quando provider retorna JSON
    
    if (contentType.includes('application/json') || /^\s*[\[{]/.test(text) || /^\s*\[/.test(text)) {
    
      try {
    
        data = JSON.parse(text);
    
      } catch (_) {
    
        // manter texto bruto
    
      }
    
    }

    
    sendResponse({
    
      success: true,
    
      status: response.status,
    
      ok: response.ok,
    
      statusText: response.statusText,
    
      contentType,
    
      data
    
    });
  } catch (error) {
    console.error('[Background] Erro em FETCH_PROXY:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// ─── EXPORTS PARA SERVICE WORKER GLOBAL SCOPE ────────────────────────────────
// Necessário para que background.js acesse estas funções via importScripts
self.handleMemoryPush       = handleMemoryPush;
self.handleMemoryQuery      = handleMemoryQuery;
self.handleGetConfidence    = handleGetConfidence;
self.handleUpdateConfidence = handleUpdateConfidence;
self.handleToggleCopilot    = handleToggleCopilot;
self.handleFewShotPush      = handleFewShotPush;
self.handleFewShotSync      = handleFewShotSync;
self.handleFetchProxy       = handleFetchProxy;
