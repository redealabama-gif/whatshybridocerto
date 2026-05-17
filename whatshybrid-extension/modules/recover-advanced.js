/**
 * WhatsHybrid Recover Advanced v7.5.0
 * Sistema completo de recuperação de mensagens
 * 
 * Implementa todas as 34 tarefas do Recover (6.1-6.18 + 8.1-8.16)
 */
(function() {
  'use strict';

  // ============================================
  // CONFIGURAÇÃO
  // ============================================
  const CONFIG = {
    MAX_MESSAGES: 100,           // 8.16 - Limite de mensagens
    MAX_MEDIA_SIZE: 5242880,     // 8.16 - 5MB
    PAGE_SIZE: 20,               // 8.14 - Paginação
    STORAGE_KEY: 'whl_recover_history',
    FAVORITES_KEY: 'whl_recover_favorites',
    NOTIFICATIONS_KEY: 'whl_recover_notifications',
    RETRY_ATTEMPTS: 3,           // 8.13 - Retry com backoff
    RETRY_DELAYS: [1000, 2000, 4000],
    BACKEND_URL: (globalThis.WHL_ENDPOINTS?.BACKEND_DEFAULT || 'http://localhost:3000')
  };

  // SECURITY FIX P0-035: Prevent Prototype Pollution from external data
  function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return {};

    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const sanitized = {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key) && !dangerousKeys.includes(key)) {
        const value = obj[key];
        // Recursively sanitize nested objects
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          sanitized[key] = sanitizeObject(value);
        } else {
          sanitized[key] = value;
        }
      }
    }

    return sanitized;
  }

  // PEND-MED-006: Múltiplos seletores CSS para resiliência contra mudanças do WhatsApp
  const SELECTORS = {
    CHATLIST_HEADER: [
      '[data-testid="chatlist-header"]',
      '[data-testid="header"]',
      'header[data-testid]',
      '#pane-side header',
      '.chatlist-header',
      'div[role="banner"]'
    ],
    CONVERSATION_PANEL: [
      '[data-testid="conversation-panel-messages"]',
      '#main [role="application"]',
      '[data-testid="conversation-panel-body"]',
      '.message-list',
      '#main .copyable-area',
      'div[data-tab="8"]'
    ],
    RECALLED_MESSAGE: [
      '[data-testid="recalled-message"]',
      '.message-revoked',
      'div[data-revoked="true"]',
      'span[data-icon="recalled"]',
      '.message-deleted',
      'div[title*="deleted"]',
      'div[title*="This message was deleted"]'
    ],
    MEDIA_THUMB: [
      '[data-testid="image-thumb"]',
      '[data-testid="video-thumb"]',
      '[data-testid="audio-play"]',
      '[data-testid="media-thumb"]',
      'img[src*="blob:"]',
      '.media-thumb',
      '[role="img"]',
      'video',
      'audio'
    ],
    DOWNLOAD_BUTTON: [
      '[data-testid="download"]',
      '[data-testid="media-download"]',
      '[aria-label*="Download"]',
      '[aria-label*="Baixar"]',
      'button[title*="Download"]',
      'button[title*="Baixar"]',
      'span[data-icon="download"]',
      '.download-button'
    ]
  };

  // Helper: Tenta múltiplos seletores até encontrar elemento
  function findElement(selectors, parent = document) {
    if (typeof selectors === 'string') selectors = [selectors];
    for (const selector of selectors) {
      try {
        const el = parent.querySelector(selector);
        if (el) return el;
      } catch (e) {
        // Seletor inválido, continuar
      }
    }
    return null;
  }

  // Helper: Tenta múltiplos seletores e retorna todos elementos encontrados
  function findElements(selectors, parent = document) {
    if (typeof selectors === 'string') selectors = [selectors];
    const found = [];
    for (const selector of selectors) {
      try {
        const els = parent.querySelectorAll(selector);
        if (els.length > 0) {
          found.push(...Array.from(els));
        }
      } catch (e) {
        // Seletor inválido, continuar
      }
    }
    return found;
  }

  // ============================================
  // BACKEND HELPERS (URL + AUTH UNIFICADOS)
  // - Evita hardcode de localhost em produção
  // - Reaproveita BackendClient (Bearer token + retries) quando disponível
  // - Mantém fallback para fetch direto quando BackendClient não está carregado
  // ============================================
  function getBackendBaseUrl() {
    return window.BackendClient?.getBaseUrl?.() || CONFIG.BACKEND_URL;
  }

  async function getBackendTokenFallback() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
        const stored = await chrome.storage.local.get(['backend_token', 'whl_backend_config']);
        return stored?.backend_token || stored?.whl_backend_config?.token || null;
      }
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    return null;
  }

  async function backendPost(endpoint, body) {
    // Preferir BackendClient: já inclui Authorization, timeout e retry
    if (window.BackendClient?.post) {
      return await window.BackendClient.post(endpoint, body);
    }

    // Fallback: fetch direto com token (se existir)
    const baseUrl = getBackendBaseUrl();
    const token = await getBackendTokenFallback();
    const headers = {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` })
    };
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
    }
    return data;
  }

  // ============================================
  // HELPERS: TAMANHO REAL DE BASE64 (bytes)
  // (corrige uso incorreto de .length em string base64)
  // ============================================
  function stripDataUrlPrefix(b64) {
    const s = String(b64 || '').trim();
    if (!s) return '';
    if (s.startsWith('data:')) {
      const idx = s.indexOf(',');
      return idx >= 0 ? s.slice(idx + 1) : s;
    }
    return s;
  }

  function estimateBase64Bytes(b64) {
    const s = stripDataUrlPrefix(b64);
    if (!s) return 0;
    const len = s.length;
    let padding = 0;
    if (s.endsWith('==')) padding = 2;
    else if (s.endsWith('=')) padding = 1;
    return Math.max(0, Math.floor((len * 3) / 4) - padding);
  }

  // ============================================
  // PHASE 1: CORE MESSAGE VERSIONS
  // ============================================
  
  // Estrutura principal de versões por mensagem
  const messageVersions = new Map();

  // Modelo de estados
  const MESSAGE_STATES = {
    NORMAL: 'normal',
    CREATED: 'created',
    EDITED: 'edited',
    REVOKED_GLOBAL: 'revoked_global',
    DELETED_LOCAL: 'deleted_local',
    FAILED: 'failed',
    CACHED_ONLY: 'cached_only',
    SNAPSHOT_INITIAL: 'snapshot_initial',
    SNAPSHOT_LOADED: 'snapshot_loaded',
    REMOVED: 'removed',
    STATUS_PUBLISHED: 'status_published',
    STATUS_DELETED: 'status_deleted'
  };

  // Estados que compõem o "Universo Revogado" — apenas eventos REAIS de
  // deleção/edição/falha. Estados como CACHED_ONLY / SNAPSHOT_INITIAL /
  // SNAPSHOT_LOADED são apenas marcações de "temos cópia local da mensagem"
  // e NÃO devem causar marca de "Apagada" no DOM.
  const REVOKED_UNIVERSE_STATES = [
    MESSAGE_STATES.DELETED_LOCAL,
    MESSAGE_STATES.REVOKED_GLOBAL,
    MESSAGE_STATES.EDITED,
    MESSAGE_STATES.FAILED,
    MESSAGE_STATES.STATUS_DELETED,
    MESSAGE_STATES.REMOVED
  ];

  // ============================================
  // ESTADO
  // ============================================
  const state = {
    messages: [],
    favorites: new Set(),
    contactNotifications: new Set(),
    filters: { 
      type: 'all',      // all, revoked, deleted, edited, media
      chat: null,       // filtrar por número
      dateFrom: null, 
      dateTo: null,
      direction: 'all', // PHASE 2: all, incoming, outgoing, third_party
      state: 'all'      // PHASE 2: all, revoked_global, deleted_local, edited, revoked_universe
    },
    page: 0,
    initialized: false,
    cachedOwner: null // PHASE 2: Cache do owner para evitar múltiplas detecções
  };

  // ============================================
  // 8.12 - CACHE LRU INTELIGENTE
  // ============================================
  class LRUCache {
    constructor(maxSize = 50) {
      this.maxSize = maxSize;
      this.cache = new Map();
    }

    get(key) {
      if (!this.cache.has(key)) return null;
      const value = this.cache.get(key);
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }

    set(key, value) {
      if (this.cache.has(key)) {
        this.cache.delete(key);
      } else if (this.cache.size >= this.maxSize) {
        // Remove oldest (first item)
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      this.cache.set(key, value);
    }

    has(key) {
      return this.cache.has(key);
    }

    clear() {
      this.cache.clear();
    }

    get size() {
      return this.cache.size;
    }
  }

  const mediaCache = new LRUCache(50);

  // ============================================
  // INICIALIZAÇÃO
  // ============================================
  async function init() {
    if (state.initialized) return;
    
    console.log('[RecoverAdvanced] 🚀 Inicializando...');
    
    await loadFromStorage();
    setupEventListeners();
    
    // PHASE 1: Migrar mensagens antigas para novo sistema
    if (state.messages.length > 0) {
      migrateFromLegacy(state.messages);
    }
    
    state.initialized = true;
    console.log('[RecoverAdvanced] ✅ Inicializado -', state.messages.length, 'mensagens carregadas');
    console.log('[RecoverAdvanced] ✅ messageVersions:', messageVersions.size, 'entradas');
  }

  // ============================================
  // ANTI-DUPLICAÇÃO E VALIDAÇÃO DE TELEFONE
  // ============================================
  
  /**
   * Verifica se um número de telefone é válido (não é aleatório/placeholder)
   * @param {string} phone - Número de telefone
   * @returns {boolean} true se for um número válido
   */
  function isRealPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return false;
    
    // Limpar e verificar
    const cleaned = phone.replace(/\D/g, '');
    
    // Deve ter 8-15 dígitos
    if (cleaned.length < 8 || cleaned.length > 15) return false;
    
    // Verificar padrões de números aleatórios/placeholder
    // Números repetidos (ex: 1111111111, 0000000000)
    if (/^(\d)\1+$/.test(cleaned)) return false;
    
    // Números sequenciais (ex: 1234567890)
    if (/^0123456789|^1234567890|^9876543210/.test(cleaned)) return false;
    
    // Números começando com muitos zeros (geralmente inválidos)
    if (cleaned.startsWith('000')) return false;
    
    // Números muito curtos após limpeza
    if (cleaned.length < 8) return false;
    
    // Deve começar com código de país válido ou DDD brasileiro
    // Brasil: DDI 55, DDD 11-99
    // Outros países: DDI 1-999
    const startsWithValidCode = /^(1|2|3|4|5|6|7|8|9)/.test(cleaned);
    
    return startsWithValidCode;
  }

  /**
   * Gera uma chave única para deduplicação de mensagens
   * @param {Object} msg - Mensagem
   * @returns {string} Chave única
   */
  function generateDeduplicationKey(msg) {
    const body = (msg.body || msg.text || msg.originalBody || '').trim().slice(0, 100);
    const from = cleanPhoneNumber(msg.from || '') || 'unknown';
    const to = cleanPhoneNumber(msg.to || msg.chatId || '') || 'unknown';
    const timestamp = msg.timestamp || msg.ts || 0;
    
    // Normalizar timestamp para intervalo de 1 minuto (evita duplicatas por pequenas diferenças)
    const normalizedTs = Math.floor(timestamp / 60000);
    
    // Criar hash do conteúdo
    const contentHash = hashString(body + from + to);
    
    return `${contentHash}_${normalizedTs}`;
  }

  /**
   * Simples função de hash para strings
   */
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Remove duplicatas do array de mensagens, mantendo apenas as com números reais
   * @param {Array} messages - Array de mensagens
   * @returns {Array} Array sem duplicatas
   */
  function deduplicateMessages(messages) {
    if (!Array.isArray(messages)) return [];
    
    const seen = new Map(); // dedupKey -> mensagem
    const result = [];
    
    for (const msg of messages) {
      const dedupKey = generateDeduplicationKey(msg);
      const fromValid = isRealPhoneNumber(msg.from);
      const toValid = isRealPhoneNumber(msg.to || msg.chatId);
      
      // Se já temos esta mensagem
      if (seen.has(dedupKey)) {
        const existing = seen.get(dedupKey);
        const existingFromValid = isRealPhoneNumber(existing.from);
        const existingToValid = isRealPhoneNumber(existing.to || existing.chatId);
        
        // Preferir a versão com números válidos
        if ((fromValid || toValid) && !(existingFromValid || existingToValid)) {
          // Nova mensagem tem números melhores, substituir
          const idx = result.indexOf(existing);
          if (idx !== -1) {
            result[idx] = msg;
          }
          seen.set(dedupKey, msg);
        }
        // Se ambos têm números válidos ou ambos inválidos, manter o primeiro
        continue;
      }
      
      // Nova mensagem única
      seen.set(dedupKey, msg);
      result.push(msg);
    }
    
    // Filtrar mensagens que não têm nenhum número válido (provavelmente duplicatas com dados falsos)
    // Mas manter pelo menos mensagens com ID válido e conteúdo
    return result.filter(msg => {
      const hasValidFrom = isRealPhoneNumber(msg.from);
      const hasValidTo = isRealPhoneNumber(msg.to || msg.chatId);
      const hasContent = !!(msg.body || msg.originalBody || msg.mediaType);
      const hasValidId = msg.id && msg.id.length > 10;
      
      // Manter se tem pelo menos um número válido OU tem ID e conteúdo válidos
      return (hasValidFrom || hasValidTo) || (hasValidId && hasContent);
    });
  }

  async function loadFromStorage() {
    try {
      // Usar chrome.storage.local para compartilhar entre contextos
      const result = await new Promise(resolve => {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.get([CONFIG.STORAGE_KEY, CONFIG.FAVORITES_KEY, CONFIG.NOTIFICATIONS_KEY, 'whl_message_versions'], resolve);
        } else {
          // Fallback para localStorage (content script)
          resolve({
            [CONFIG.STORAGE_KEY]: localStorage.getItem(CONFIG.STORAGE_KEY),
            [CONFIG.FAVORITES_KEY]: localStorage.getItem(CONFIG.FAVORITES_KEY),
            [CONFIG.NOTIFICATIONS_KEY]: localStorage.getItem(CONFIG.NOTIFICATIONS_KEY),
            'whl_message_versions': localStorage.getItem('whl_message_versions')
          });
        }
      });
      
      // PHASE 1: Carregar messageVersions primeiro
      let versionsData = result['whl_message_versions'];
      if (typeof versionsData === 'string') {
        try {
          versionsData = JSON.parse(versionsData);
        } catch (e) {
          console.warn('[RecoverAdvanced] Erro ao parsear messageVersions:', e);
          versionsData = null;
        }
      }
      if (versionsData && typeof versionsData === 'object') {
        // Restaurar Map de messageVersions
        Object.entries(versionsData).forEach(([id, entry]) => {
          messageVersions.set(id, entry);
        });
        console.log('[RecoverAdvanced] ✅ messageVersions carregado:', messageVersions.size, 'entradas');
      }
      
      // Carregar histórico
      let saved = result[CONFIG.STORAGE_KEY];
      if (typeof saved === 'string') {
        try {
          saved = JSON.parse(saved);
        } catch (e) {
          console.warn('[RecoverAdvanced] Erro ao parsear dados salvos:', e);
          saved = null;
        }
      }
      if (Array.isArray(saved)) {
        // CORREÇÃO 4.1: Aplicar análise de sentimento ao carregar mensagens
        let messages = saved.slice(0, CONFIG.MAX_MESSAGES).map(m => {
          // SECURITY FIX P0-035: Sanitize message from storage to prevent Prototype Pollution
          const sanitizedMsg = sanitizeObject(m);

          // ✅ Garantir chatId para permitir abrir o chat/localizar a mensagem a partir do histórico
          const entry = messageVersions.get(sanitizedMsg?.id);
          const raw = sanitizedMsg?.chatId || sanitizedMsg?.chat || entry?.chatId || null;
          let chatId = raw;
          if (!chatId) {
            const fallback = String(sanitizedMsg?.to || sanitizedMsg?.from || '').trim();
            const digits = fallback.replace(/\D/g, '');
            if (digits.length >= 10 && digits.length <= 15) {
              chatId = digits + '@c.us';
            }
          }

          return {
            ...sanitizedMsg,
            chatId,
            sentiment: sanitizedMsg.sentiment || (sanitizedMsg.body ? analyzeSentiment(sanitizedMsg.body) : 'neutral')
          };
        });
        
        // CORREÇÃO: Remover duplicatas e mensagens com números inválidos
        state.messages = deduplicateMessages(messages);
        console.log('[RecoverAdvanced] ✅ Deduplicação aplicada:', saved.length, '->', state.messages.length, 'mensagens');
      }
      
      // Carregar favoritos
      let favs = result[CONFIG.FAVORITES_KEY];
      if (typeof favs === 'string') {
        try {
          favs = JSON.parse(favs);
        } catch (e) {
          console.warn('[RecoverAdvanced] Erro ao parsear favoritos:', e);
          favs = null;
        }
      }
      if (Array.isArray(favs)) {
        state.favorites = new Set(favs);
      }
      
      // Carregar configurações de notificações por contato
      let notifs = result[CONFIG.NOTIFICATIONS_KEY];
      if (typeof notifs === 'string') {
        try {
          notifs = JSON.parse(notifs);
        } catch (e) {
          console.warn('[RecoverAdvanced] Erro ao parsear notificações:', e);
          notifs = null;
        }
      }
      if (Array.isArray(notifs)) {
        state.contactNotifications = new Set(notifs);
      }
      
      console.log('[RecoverAdvanced] ✅ Storage carregado:', state.messages.length, 'mensagens');
    } catch (e) {
      console.warn('[RecoverAdvanced] Erro ao carregar storage:', e);
    }
  }

  async function saveToStorage() {
    try {
      // Limitar tamanho
      const toSave = state.messages.slice(0, CONFIG.MAX_MESSAGES);
      
      // PHASE 1: Converter messageVersions Map para objeto serializável
      const versionsToSave = {};
      messageVersions.forEach((entry, id) => {
        versionsToSave[id] = entry;
      });
      
      const data = {
        [CONFIG.STORAGE_KEY]: toSave,
        [CONFIG.FAVORITES_KEY]: [...state.favorites],
        [CONFIG.NOTIFICATIONS_KEY]: [...state.contactNotifications],
        'whl_message_versions': versionsToSave
      };
      
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set(data);
      } else {
        // Fallback para localStorage
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(toSave));
        localStorage.setItem(CONFIG.FAVORITES_KEY, JSON.stringify([...state.favorites]));
        localStorage.setItem(CONFIG.NOTIFICATIONS_KEY, JSON.stringify([...state.contactNotifications]));
        localStorage.setItem('whl_message_versions', JSON.stringify(versionsToSave));
      }
    } catch (e) {
      console.warn('[RecoverAdvanced] Erro ao salvar storage:', e);
    }
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================
  function setupEventListeners() {
    // Receber mensagens do wpp-hooks.js
    window.addEventListener('message', async (e) => {
      if (e.origin !== window.location.origin) return;
      
      const recoverTypes = [
        'WHL_RECOVER_MESSAGE',
        'WHL_RECOVER_NEW_MESSAGE', 
        'WHL_RECOVERED_MESSAGE',
        'WHL_MESSAGE_REVOKED',
        'WHL_MESSAGE_DELETED',
        'WHL_MESSAGE_EDITED'
      ];
      
      if (recoverTypes.includes(e.data?.type)) {
        await handleNewMessage(e.data.payload || e.data);
      }
    });

    // EventBus listeners
    if (window.EventBus) {
      window.EventBus.on('recover:new_message', handleNewMessage);
      window.EventBus.on('recover:set_filter', ({ type, value }) => setFilter(type, value));
      window.EventBus.on('recover:sync', syncWithBackend);
      window.EventBus.on('recover:export', ({ format }) => {
        if (format === 'csv') exportToCSV();
        else if (format === 'txt') exportToTXT();
        else if (format === 'pdf') exportToPDF();
      });
    }
  }

  // ============================================
  // PHASE 1: MESSAGE VERSIONS REGISTRY
  // ============================================
  
  // ============================================
  // BUG 3: ANTI-DUPLICAÇÃO ROBUSTA
  // ============================================
  
  // Configurable threshold for duplicate detection
  const DUPLICATE_TIME_THRESHOLD_MS = 5000; // 5 seconds
  
  function normalizeContent(content) {
    if (!content || typeof content !== 'string') return '';
    return content.trim().toLowerCase().replace(/\s+/g, ' ');
  }
  
  function isDuplicateEvent(msgId, newEvent) {
    const entry = messageVersions.get(msgId);
    if (!entry || !entry.history || entry.history.length === 0) return false;
    
    const {
      state: newState,
      body: newBody,
      timestamp: newTimestamp
    } = newEvent;
    
    const normalizedNewBody = normalizeContent(newBody);
    
    // Check last 3 events for duplicates (most likely to be recent duplicates)
    const recentEvents = entry.history.slice(-3);
    
    for (const existingEvent of recentEvents) {
      const {
        state: existingState,
        body: existingBody,
        timestamp: existingTimestamp
      } = existingEvent;
      
      // 1. Check if states match
      if (existingState !== newState) continue;
      
      // 2. Check if content matches (normalized)
      const normalizedExistingBody = normalizeContent(existingBody);
      if (normalizedExistingBody !== normalizedNewBody) continue;
      
      // 3. Check if timestamps are close (configurable threshold)
      const timeDiff = Math.abs((newTimestamp || 0) - (existingTimestamp || 0));
      if (timeDiff < DUPLICATE_TIME_THRESHOLD_MS) {
        console.log('[RecoverAdvanced] Duplicate event detected and ignored:', {
          msgId,
          state: newState,
          timeDiff: `${timeDiff}ms`
        });
        return true; // It's a duplicate
      }
    }
    
    return false; // Not a duplicate
  }
  
  function registerMessageEvent(msgData, state, origin = 'unknown') {
    const id = msgData.id || msgData.msgId || Date.now().toString();
    
    // BUG 3: Check for duplicates BEFORE adding
    const newEvent = {
      state,
      body: msgData.body || msgData.text || msgData.caption || '',
      previousBody: msgData.previousBody || msgData.previousContent || null,
      mediaType: msgData.mediaType || msgData.mimetype || null,
      mediaDataPreview: msgData.mediaDataPreview || msgData.thumbnail || null,
      mediaDataFull: null, // Só preenchido quando usuário solicitar
      transcription: msgData.transcription || null,
      timestamp: msgData.timestamp || Date.now(),
      origin,
      capturedAt: Date.now()
    };
    
    if (!messageVersions.has(id)) {
      // Criar nova entrada
      messageVersions.set(id, {
        id,
        chatId: msgData.chatId || msgData.chat || extractChatId(msgData),
        from: extractPhoneNumber(msgData.from || msgData.author || msgData.sender),
        to: extractPhoneNumber(msgData.to || msgData.chatId),
        type: msgData.type || 'chat',
        direction: determineDirection(msgData),
        owner: getOwner(),
        history: []
      });
    }
    
    const entry = messageVersions.get(id);
    
    // BUG 3: Only add if not duplicate
    if (!isDuplicateEvent(id, newEvent)) {
      // BUG 2: NUNCA sobrescrever - apenas adicionar ao history
      entry.history.push(newEvent);
      
      // BUG 2: Save imediately after each registration
      saveToStorage().catch(e => {
        console.warn('[RecoverAdvanced] Falha ao salvar após registrar evento:', e);
      });
    }
    
    // Atualizar campos principais se necessário
    if (msgData.from) entry.from = extractPhoneNumber(msgData.from);
    if (msgData.to) entry.to = extractPhoneNumber(msgData.to);
    if (msgData.type) entry.type = msgData.type;
    
    return entry;
  }

  // Obter histórico completo de uma mensagem
  function getMessageHistory(id) {
    return messageVersions.get(id) || null;
  }

  // Obter estado atual (último estado no histórico)
  function getCurrentState(id) {
    const entry = messageVersions.get(id);
    if (!entry || entry.history.length === 0) return null;
    return entry.history[entry.history.length - 1].state;
  }

  // Verificar se mensagem está no "Universo Revogado"
  function isInRevokedUniverse(id) {
    const entry = messageVersions.get(id);
    if (!entry) return false;
    return entry.history.some(h => REVOKED_UNIVERSE_STATES.includes(h.state));
  }

  // Obter todas as mensagens do Universo Revogado
  function getRevokedUniverseMessages() {
    const result = [];
    messageVersions.forEach((entry, id) => {
      if (isInRevokedUniverse(id)) {
        result.push(entry);
      }
    });
    return result;
  }

  // ============================================
  // PHASE 1: LEGACY MIGRATION
  // ============================================
  
  function mapLegacyActionToState(action) {
    const mapping = {
      'revoked': MESSAGE_STATES.REVOKED_GLOBAL,
      'deleted': MESSAGE_STATES.DELETED_LOCAL,
      'edited': MESSAGE_STATES.EDITED,
      'failed': MESSAGE_STATES.FAILED
    };
    return mapping[action] || MESSAGE_STATES.CACHED_ONLY;
  }

  // Migrar mensagens do formato antigo (array plano) para messageVersions
  function migrateFromLegacy(legacyMessages) {
    if (!Array.isArray(legacyMessages)) return;
    
    legacyMessages.forEach(msg => {
      const state = mapLegacyActionToState(msg.action);
      registerMessageEvent(msg, state, 'legacy_migration');
    });
    
    console.log(`[RecoverAdvanced] Migrados ${legacyMessages.length} registros do formato antigo`);
  }

  // ============================================
  // 6.1-6.7 - CAPTURA DE MENSAGENS
  // ============================================
  async function handleNewMessage(data) {
    if (!data) return;
    
    const msg = {
      id: data.id || data.msgId || Date.now().toString(),
      // ✅ Manter o chatId original (necessário para abrir o chat e localizar a mensagem no WhatsApp)
      // (sem o sufixo @c.us / @g.us, algumas rotinas de navegação/download falham)
      chatId: data.chatId || data.chat || data.to || null,
      from: extractPhone(data.from || data.author || data.sender),
      to: extractPhone(data.to || data.chatId || data.chat),
      body: data.body || data.text || data.caption || '',
      type: data.type || 'chat',           // 6.4-6.7: chat, image, video, audio, ptt, sticker, document
      action: data.action || data.kind || 'revoked',  // 6.1-6.3: revoked, deleted, edited
      timestamp: data.timestamp || data.ts || Date.now(),
      mediaData: null,
      mediaType: data.mediaType || data.mimetype || null,
      filename: data.filename || null,
      previousContent: data.previousContent || data.originalBody || null,  // Para mensagens editadas
      sentiment: null
    };

    // 8.4 - Análise de sentimento
    if (msg.body) {
      msg.sentiment = analyzeSentiment(msg.body);
    }

    // 6.16-6.18 - Capturar mídia em qualidade original
    if (data.mediaData && data.mediaData !== '__HAS_MEDIA__') {
      msg.mediaData = data.mediaData;
    } else if (data.mediaKey || ['image', 'video', 'audio', 'ptt', 'sticker', 'document'].includes(msg.type)) {
      // 8.1 - Tentar download ativo
      const downloaded = await downloadMediaActive(data);
      if (downloaded?.success && downloaded.data) {
        msg.mediaData = downloaded.data;
      }
    }

    // 8.15 - Compressão se necessário (tamanho REAL em bytes, não .length)
    if (typeof msg.mediaData === 'string' && msg.mediaData && msg.mediaData !== '__HAS_MEDIA__') {
      const normalized = stripDataUrlPrefix(msg.mediaData);
      const bytes = estimateBase64Bytes(normalized);
      if (bytes > CONFIG.MAX_MEDIA_SIZE) {
        const compressed = await compressMedia(normalized, msg.type);
        if (estimateBase64Bytes(compressed) > CONFIG.MAX_MEDIA_SIZE) {
          console.warn('[RecoverAdvanced] ⚠️ Mídia acima do limite após compressão - armazenando placeholder');
          msg.mediaData = '__HAS_MEDIA__';
        } else {
          msg.mediaData = compressed;
        }
      } else {
        msg.mediaData = normalized;
      }
    }

    // PHASE 1: Registrar no novo sistema de versões
    const messageState = mapLegacyActionToState(msg.action);
    // SECURITY FIX P0-035: Sanitize external data to prevent Prototype Pollution
    const sanitizedData = sanitizeObject(data);
    const sanitizedMsg = sanitizeObject(msg);
    registerMessageEvent({
      ...sanitizedData,
      ...sanitizedMsg,
      mediaDataPreview: msg.mediaData
    }, messageState, 'handle_new_message');

    // Verificar se a mensagem tem números válidos (evitar adicionar duplicatas com números falsos)
    const fromValid = isRealPhoneNumber(msg.from);
    const toValid = isRealPhoneNumber(msg.to);
    
    if (!fromValid && !toValid) {
      console.log('[RecoverAdvanced] ⚠️ Mensagem ignorada - números inválidos:', msg.from, msg.to);
      // Ainda salvar para não perder, mas marcar
      msg._invalidNumbers = true;
    }

    // Verificar se já existe uma mensagem similar (evitar duplicatas)
    const dedupKey = generateDeduplicationKey(msg);
    const existingIdx = state.messages.findIndex(m => generateDeduplicationKey(m) === dedupKey);
    
    if (existingIdx !== -1) {
      const existing = state.messages[existingIdx];
      const existingFromValid = isRealPhoneNumber(existing.from);
      const existingToValid = isRealPhoneNumber(existing.to);
      
      // Substituir apenas se a nova versão tiver números melhores
      if ((fromValid || toValid) && !(existingFromValid || existingToValid)) {
        console.log('[RecoverAdvanced] 🔄 Substituindo duplicata com números válidos');
        state.messages[existingIdx] = msg;
      } else {
        console.log('[RecoverAdvanced] ⚠️ Duplicata ignorada:', dedupKey);
      }
    } else {
      // Adicionar ao início (mais recente primeiro) - MANTER COMPATIBILIDADE
      state.messages.unshift(msg);
      
      // Manter limite
      if (state.messages.length > CONFIG.MAX_MESSAGES) {
        state.messages = state.messages.slice(0, CONFIG.MAX_MESSAGES);
      }
    }

    await saveToStorage();

    // 8.5/8.11 - Notificações
    if (state.contactNotifications.has(msg.from) || state.contactNotifications.has('all')) {
      await showNotification(msg);
    }

    // Emitir evento para UI
    if (window.EventBus) {
      window.EventBus.emit('recover:message_added', msg);
    }

    console.log('[RecoverAdvanced] ✅ Mensagem capturada:', msg.action, msg.type, msg.from);
  }

  // ============================================
  // PHASE 2: ENHANCED PHONE EXTRACTION
  // ============================================
  
  function cleanPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return '';
    
    // Remover sufixos do WhatsApp
    let cleaned = phone
      .replace(/@c\.us$/i, '')
      .replace(/@s\.whatsapp\.net$/i, '')
      .replace(/@g\.us$/i, '')
      .replace(/@broadcast$/i, '')
      .replace(/@lid$/i, '')
      .replace(/@newsletter$/i, '');
    
    // Manter apenas números
    cleaned = cleaned.replace(/\D/g, '');
    
    return cleaned;
  }

  function isValidPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return false;
    // Número válido: 8-15 dígitos
    return phone.length >= 8 && phone.length <= 15 && /^\d+$/.test(phone);
  }

  function extractPhoneNumber(value) {
    if (!value) return 'Desconhecido';
    
    // Lista de campos a tentar (em ordem de prioridade)
    const fieldsToTry = [
      // Direto
      () => value,
      // Objeto com _serialized
      () => value?._serialized,
      () => value?.user,
      () => value?.id,
      // Campos específicos
      () => value?.to,
      () => value?.to?._serialized,
      () => value?.to?.user,
      () => value?.from,
      () => value?.from?._serialized,
      () => value?.from?.user,
      // Chat
      () => value?.chat?.id?.user,
      () => value?.chat?.id?._serialized,
      () => value?.chat?.contact?.id?.user,
      () => value?.chat?.contact?.number,
      // ID
      () => value?.id?.remote?.user,
      () => value?.id?.remote?._serialized,
      () => value?.id?.participant?.user,
      () => value?.id?.participant?._serialized,
      // Author
      () => value?.author,
      () => value?.author?._serialized,
      () => value?.author?.user,
      // Sender
      () => value?.sender,
      () => value?.sender?._serialized,
      () => value?.phoneNumber,
      () => value?.number
    ];
    
    for (const getter of fieldsToTry) {
      try {
        const result = getter();
        if (result && typeof result === 'string') {
          const cleaned = cleanPhoneNumber(result);
          if (isValidPhoneNumber(cleaned)) {
            return cleaned;
          }
        }
      } catch (e) {
        continue;
      }
    }
    
    // Fallback: tentar converter objeto para string
    if (typeof value === 'object') {
      const str = String(value);
      const cleaned = cleanPhoneNumber(str);
      if (isValidPhoneNumber(cleaned)) {
        return cleaned;
      }
    }
    
    return 'Desconhecido';
  }

  // ============================================
  // 6.13-6.15 - EXTRAÇÃO DE TELEFONE (LEGACY)
  // ============================================
  function extractPhone(value) {
    // Backward compatibility: use new extractPhoneNumber
    return extractPhoneNumber(value);
  }

  // ============================================
  // PHASE 2: DIRECTION AND OWNER DETECTION
  // ============================================
  
  function getOwner() {
    if (state.cachedOwner) return state.cachedOwner;
    
    try {
      // Método 1: Store.Conn.me._serialized
      // FIX: optional chaining na leitura real, não só na condição.
      // Se Conn.me for undefined em deploy diferente, não lança mais.
      const meSerialized = window.Store?.Conn?.me?._serialized;
      if (meSerialized) {
        state.cachedOwner = cleanPhoneNumber(meSerialized);
        return state.cachedOwner;
      }

      // Método 2: Store.Conn.wid._serialized
      if (window.Store?.Conn?.wid?._serialized) {
        state.cachedOwner = cleanPhoneNumber(window.Store.Conn.wid._serialized);
        return state.cachedOwner;
      }
      
      // Método 3: localStorage - last-wid-md
      const storedMd = localStorage.getItem('last-wid-md');
      if (storedMd) {
        try {
          const parsed = JSON.parse(storedMd);
          const phoneNumber = cleanPhoneNumber(parsed._serialized || parsed);
          if (isValidPhoneNumber(phoneNumber)) {
            state.cachedOwner = phoneNumber;
            return state.cachedOwner;
          }
        } catch (e) {
          console.warn('[RecoverAdvanced] Erro ao parsear last-wid-md:', e);
        }
      }
      
      // Método 4: localStorage - last-wid
      const stored = localStorage.getItem('last-wid');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          const phoneNumber = cleanPhoneNumber(parsed._serialized || parsed);
          if (isValidPhoneNumber(phoneNumber)) {
            state.cachedOwner = phoneNumber;
            return state.cachedOwner;
          }
        } catch (e) {
          console.warn('[RecoverAdvanced] Erro ao parsear last-wid:', e);
        }
      }
      
      // Método 5: Tentar do DOM
      const header = findElement(SELECTORS.CHATLIST_HEADER);
      const profileEl = header?.querySelector('img');
      if (profileEl?.src) {
        const match = profileEl.src.match(/u=(\d+)/);
        if (match && isValidPhoneNumber(match[1])) {
          state.cachedOwner = match[1];
          return state.cachedOwner;
        }
      }
    } catch (e) {
      console.warn('[RecoverAdvanced] Erro ao detectar owner:', e);
    }
    
    return null;
  }

  function mentionsOwner(msg, owner) {
    if (!msg || !owner) return false;
    
    // Verificar menções
    if (msg.mentionedJidList) {
      return msg.mentionedJidList.some(jid => 
        cleanPhoneNumber(jid) === owner
      );
    }
    
    // Verificar quotedMsg (resposta a mim)
    if (msg.quotedMsg || msg.quotedStanzaID) {
      const quotedFrom = extractPhoneNumber(msg.quotedMsg?.from || msg.quotedParticipant);
      if (quotedFrom === owner) return true;
    }
    
    return false;
  }

  function determineDirection(msg) {
    const owner = getOwner();
    if (!owner) return 'unknown';
    
    const from = extractPhoneNumber(msg.from || msg.author || msg.sender);
    const to = extractPhoneNumber(msg.to || msg.chatId);
    
    // Mensagem enviada por mim
    if (msg.fromMe === true || from === owner) {
      return 'outgoing';
    }
    
    // Mensagem destinada a mim (chat privado ou menção)
    if (to === owner || mentionsOwner(msg, owner)) {
      return 'incoming';
    }
    
    // Mensagem entre terceiros (em grupo/comunidade)
    return 'third_party';
  }

  function extractChatId(msg) {
    if (!msg) return null;
    
    // Tentar várias fontes
    const sources = [
      msg.chatId,
      msg.chat?.id?._serialized,
      msg.chat?.id,
      msg.id?.remote?._serialized,
      msg.id?.remote,
      msg.from?.chat,
      msg.to
    ];
    
    for (const source of sources) {
      if (source) {
        const cleaned = typeof source === 'string' ? source : source?._serialized || String(source);
        if (cleaned && cleaned.includes('@')) {
          return cleaned;
        }
      }
    }
    
    return null;
  }

  // ============================================
  // 8.1 - DOWNLOAD ATIVO DE MÍDIAS
  // ============================================
  async function downloadMediaActive(msg) {
    // v7.9.13: retorno detalhado (sem remover métodos existentes)
    // Mantém os 3 métodos (Store, mediaData, backend) e o fluxo de retry/backoff.
    if (!msg) {
      return {
        success: false,
        errors: [{ method: 'validation', error: 'Mensagem inválida' }],
        summary: 'validation: Mensagem inválida',
        errorType: 'INVALID_MESSAGE',
        userMessage: 'Mensagem inválida para recuperação de mídia'
      };
    }

    // CORREÇÃO 3.2: Verificar cache LRU primeiro
    const cacheKey = msg.id || msg.msgId || JSON.stringify(msg);
    if (mediaCache.has(cacheKey)) {
      console.log('[RecoverAdvanced] 📦 Mídia encontrada no cache');
      return { success: true, data: mediaCache.get(cacheKey), method: 'cache' };
    }

    const errors = [];

    // 8.13 - Retry com backoff
    for (let attempt = 0; attempt < CONFIG.RETRY_ATTEMPTS; attempt++) {
      try {
        // Método 1: Via Store do WhatsApp — com fallback para aliases renomeados
        // FIX CRÍTICO: window.Store.DownloadManager é renomeado a cada update do WA.
        // Procura por aliases alternativos antes de desistir.
        const downloadManagerAliases = [
          window.Store?.DownloadManager,
          window.Store?.MediaDownload,
          window.Store?.Download,
          window.Store?.MediaManager
        ];
        const dlManager = downloadManagerAliases.find(m => m?.downloadMedia);
        if (dlManager?.downloadMedia) {
          try {
            const media = await dlManager.downloadMedia(msg);
            if (media) {
              const base64 = await blobToBase64(media);
              if (base64) {
                // CORREÇÃO 3.2: Armazenar no cache
                mediaCache.set(cacheKey, base64);
                return { success: true, data: base64, method: 'store' };
              }
            }
          } catch (e) {
            const errorMsg = e?.message || String(e);
            errors.push({ method: 'store', attempt, error: errorMsg });

            // Categorizar erro específico
            if (errorMsg.includes('404') || errorMsg.includes('not found')) {
              errors.push({
                method: 'store',
                attempt,
                error: errorMsg,
                errorType: 'MEDIA_NOT_FOUND',
                userMessage: 'Mídia não encontrada nos servidores do WhatsApp (possivelmente revogada)'
              });
            } else if (errorMsg.includes('403') || errorMsg.includes('forbidden')) {
              errors.push({
                method: 'store',
                attempt,
                error: errorMsg,
                errorType: 'MEDIA_FORBIDDEN',
                userMessage: 'Acesso à mídia negado (mídia pode ter expirado)'
              });
            }
          }
        }

        // Método 2: Backend (qualidade ORIGINAL via mediaKey + directPath).
        // Tem prioridade sobre msg.mediaData porque mediaData costuma ser
        // apenas o thumbnail in-line, não a mídia original.
        if (msg.mediaKey) {
          try {
            const data = await backendPost('/api/v1/recover/media/download', {
              mediaKey: msg.mediaKey,
              directPath: msg.directPath,
              mimetype: msg.mimetype
            });
            if (data?.base64) {
              mediaCache.set(cacheKey, data.base64);
              return { success: true, data: data.base64, method: 'backend' };
            }
          } catch (e) {
            const errorMsg = e?.message || String(e);
            errors.push({ method: 'backend', attempt, error: errorMsg });
          }
        }

        // Método 3 (último recurso): mediaData inline — geralmente thumbnail.
        if (msg.mediaData && msg.mediaData !== '__HAS_MEDIA__') {
          mediaCache.set(cacheKey, msg.mediaData);
          return { success: true, data: msg.mediaData, method: 'mediaData' };
        }
      } catch (e) {
        const errorMsg = e?.message || String(e);
        console.warn(`[RecoverAdvanced] Download attempt ${attempt + 1} failed:`, errorMsg);
        errors.push({ method: 'general', attempt, error: errorMsg });
        if (attempt < CONFIG.RETRY_ATTEMPTS - 1) {
          await sleep(CONFIG.RETRY_DELAYS[attempt]);
        }
      }
    }

    // Classificar tipo de erro e criar mensagem para usuário
    let errorType = 'UNKNOWN';
    let userMessage = 'Não foi possível recuperar a mídia após múltiplas tentativas';

    const allErrors = errors.map(e => e.error).join(' ').toLowerCase();

    if (allErrors.includes('404') || allErrors.includes('not found')) {
      errorType = 'MEDIA_REVOKED';
      userMessage = '❌ Mídia revogada: Esta mídia foi deletada dos servidores do WhatsApp e não pode ser recuperada. Recomendação: Ative o cache preventivo nas configurações para evitar perda de mídias futuras.';
    } else if (allErrors.includes('403') || allErrors.includes('forbidden') || allErrors.includes('unauthorized')) {
      errorType = 'MEDIA_EXPIRED';
      userMessage = '⏱️ Mídia expirada: O link de acesso à mídia expirou. Mídias antigas podem não estar mais disponíveis para download.';
    } else if (allErrors.includes('network') || allErrors.includes('timeout') || allErrors.includes('fetch')) {
      errorType = 'NETWORK_ERROR';
      userMessage = '🌐 Erro de rede: Falha na conexão com os servidores. Verifique sua internet e tente novamente.';
    } else if (allErrors.includes('decrypt') || allErrors.includes('mediakey')) {
      errorType = 'DECRYPTION_ERROR';
      userMessage = '🔐 Erro de descriptografia: A chave de mídia está corrompida ou inválida.';
    } else if (!msg.mediaKey && !msg.mediaData) {
      errorType = 'NO_MEDIA_DATA';
      userMessage = '📭 Sem dados de mídia: Esta mensagem não contém informações suficientes para recuperar a mídia.';
    }

    const summary = errors.length ? errors.map(e => `${e.method}: ${e.error}`).join('; ') : 'Falha desconhecida';
    return {
      success: false,
      errors,
      summary,
      errorType,
      userMessage
    };
  }

  function blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result?.split(',')[1] || null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================
  // BUG 4: NAVIGATION HELPERS FOR MEDIA DOWNLOAD
  // ============================================
  
  /**
   * BUG 4: Open chat by ID
   * @param {string} chatId - Chat ID to open
   * @returns {Promise<boolean>} - true if chat was opened
   */
  async function openChatById(chatId) {
    try {
      // Method 1: Via Store.Cmd
      if (window.Store?.Chat?.find && window.Store?.Cmd?.openChatAt) {
        const chat = await window.Store.Chat.find(chatId);
        if (chat) {
          await window.Store.Cmd.openChatAt(chat);
          return true;
        }
      }
      
      // Method 2: Via Store.Chat
      if (window.Store?.Chat?.find) {
        const chat = await window.Store.Chat.find(chatId);
        if (chat && window.Store.Cmd?.openChatBottom) {
          await window.Store.Cmd.openChatBottom(chat);
          return true;
        }
      }
      
      // Method 3: Via DOM (find chat in list and click)
      const chatListItem = document.querySelector(`[data-id="${chatId}"]`) ||
                          document.querySelector(`[title*="${chatId.split('@')[0]}"]`);
      if (chatListItem) {
        chatListItem.click();
        return true;
      }
      
      return false;
    } catch (e) {
      console.error('[RecoverAdvanced] openChatById failed:', e);
      return false;
    }
  }

  /**
   * BUG 4: Scroll to message
   * @param {string} messageId - Message ID to scroll to
   * @returns {Promise<boolean>} - true if scrolled successfully
   */
  async function scrollToMessage(messageId) {
    try {
      // Method 1: Via Store.Cmd
      if (window.Store?.Cmd?.scrollToMsg) {
        await window.Store.Cmd.scrollToMsg(messageId);
        return true;
      }
      
      // Method 2: Via DOM
      const msgElement = document.querySelector(`[data-id="${messageId}"]`);
      if (msgElement) {
        msgElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      }
      
      // Method 3: Search in message list
      const messageList = findElement(SELECTORS.CONVERSATION_PANEL);
      if (messageList) {
        // Scroll up gradually to find message
        for (let i = 0; i < 10; i++) {
          messageList.scrollTop -= 500;
          await sleep(300);

          const found = document.querySelector(`[data-id="${messageId}"]`);
          if (found) {
            found.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return true;
          }
        }
      }
      
      return false;
    } catch (e) {
      console.error('[RecoverAdvanced] scrollToMessage failed:', e);
      return false;
    }
  }

  // ============================================
  // BUG 1: DOWNLOAD FULL-SIZE MEDIA (REAL, NOT THUMBNAIL)
  // ============================================
  
  /**
   * BUG 1 + BUG 4 SOLUTION: Download real media content, not just thumbnail
   * Implements navigation + DOM traversal + Store API + Backend fallback
   * 
   * @param {string} messageId - The ID of the message to download media from
   * @param {string} mediaType - Type of media (image, video, audio, document, etc.)
   * @returns {Promise<Object>} Result object with success flag, data, and method used
   */
  async function downloadRealMedia(messageId, mediaType) {
    console.log('[RecoverAdvanced] 🔽 Downloading real media for:', messageId, mediaType);
    
    try {
      // BUG 4: Step 1: Get message data to find chatId
      const entry = messageVersions.get(messageId);
      const chatId = entry?.chatId;
      
      if (!chatId) {
        console.warn('[RecoverAdvanced] No chatId found for message:', messageId);
        // Try fallback methods
        return await downloadFullMedia(messageId);
      }
      
      // BUG 4: Step 2: Open the chat
      console.log('[RecoverAdvanced] Opening chat:', chatId);
      const chatOpened = await openChatById(chatId);
      if (!chatOpened) {
        console.warn('[RecoverAdvanced] Failed to open chat, using fallback');
        return await downloadFullMedia(messageId);
      }
      
      // BUG 4: Step 3: Wait for chat to load
      await sleep(2000);
      
      // BUG 4: Step 4: Scroll to message
      console.log('[RecoverAdvanced] Scrolling to message:', messageId);
      const scrolled = await scrollToMessage(messageId);
      if (!scrolled) {
        console.warn('[RecoverAdvanced] Failed to scroll to message');
      }
      
      await sleep(1000);
      
      // BUG 4: Step 5: Find message element and download
      const msgElement = document.querySelector(`[data-id="${messageId}"]`) ||
                         document.querySelector(`[data-id*="${messageId}"]`);
      
      if (msgElement) {
        // Find the media container
        const mediaContainer = findElement(SELECTORS.MEDIA_THUMB, msgElement);

        if (mediaContainer) {
          // Click to open full view
          mediaContainer.click();
          await sleep(1000);

          // Find download button in full view
          const downloadBtn = findElement(SELECTORS.DOWNLOAD_BUTTON);

          if (downloadBtn) {
            downloadBtn.click();
            return { success: true, method: 'dom_navigation', message: 'Download triggered' };
          }
        }
      }
      
      // Fallback to Store API
      return await downloadFullMedia(messageId);
      
    } catch (e) {
      console.error('[RecoverAdvanced] downloadRealMedia failed:', e);
      return { success: false, error: e.message };
    }
  }
  
  /**
   * Helper: Download media from Store message object
   * @param {Object} msg - WhatsApp message object from Store
   * @returns {Promise<Object>} Result object with success flag, data, and method used
   */
  async function downloadMediaFromStore(msg) {
    try {
      if (!msg.mediaData) {
        console.warn('[RecoverAdvanced] No mediaData in message');
        return null;
      }
      
      // Method 1: Direct blob
      if (msg.mediaData.mediaBlob) {
        const base64 = await blobToBase64(msg.mediaData.mediaBlob);
        return { success: true, data: base64, method: 'media_blob' };
      }
      
      // FIX CRÍTICO: DownloadManager renomeado a cada deploy — usa aliases
      const _dlManager = [
        window.Store?.DownloadManager,
        window.Store?.MediaDownload,
        window.Store?.Download,
        window.Store?.MediaManager
      ].find(m => m?.downloadMedia || m?.downloadAndDecrypt);

      // Method 2: Download and decrypt via mediaKey + filehash
      if (msg.mediaKey && msg.filehash && _dlManager?.downloadAndDecrypt) {
        try {
          const decrypted = await _dlManager.downloadAndDecrypt({
            directPath: msg.directPath,
            mediaKey: msg.mediaKey,
            type: msg.type,
            filehash: msg.filehash
          });
          
          if (decrypted) {
            const base64 = await blobToBase64(decrypted);
            return { success: true, data: base64, method: 'download_decrypt' };
          }
        } catch (e) {
          console.warn('[RecoverAdvanced] downloadAndDecrypt failed:', e);
        }
      }
      
      // Method 3: Use DownloadManager.downloadMedia (com alias fallback)
      if (_dlManager?.downloadMedia) {
        try {
          const blob = await _dlManager.downloadMedia(msg);
          if (blob) {
            const base64 = await blobToBase64(blob);
            return { success: true, data: base64, method: 'download_media' };
          }
        } catch (e) {
          console.warn('[RecoverAdvanced] downloadMedia failed:', e);
        }
      }
      
      return { success: false, error: 'No download method succeeded' };
    } catch (e) {
      console.error('[RecoverAdvanced] downloadMediaFromStore failed:', e);
      return { success: false, error: e.message };
    }
  }
  
  // ============================================
  // EXISTING: DOWNLOAD FULL-SIZE MEDIA
  // ============================================
  async function downloadFullMedia(messageId) {
    try {
      const entry = messageVersions.get(messageId);
      if (!entry) {
        console.warn('[RecoverAdvanced] Message not found:', messageId);
        return null;
      }
      
      // Check if already have full media
      const latestEvent = entry.history[entry.history.length - 1];
      if (latestEvent?.mediaDataFull) {
        console.log('[RecoverAdvanced] Full media already cached');
        return latestEvent.mediaDataFull;
      }
      
      // Try to find the message in Store and download
      let mediaData = null;
      
      // Method 1: Use WHL_RecoverHelpers if available
      if (window.WHL_RecoverHelpers?.findMessageById) {
        const msg = await window.WHL_RecoverHelpers.findMessageById(messageId);
        if (msg) {
          // FIX CRÍTICO: usa alias fallback para DownloadManager renomeado
          const _dlMgr = [
            window.Store?.DownloadManager,
            window.Store?.MediaDownload,
            window.Store?.Download,
            window.Store?.MediaManager
          ].find(m => m?.downloadMedia);
          if (_dlMgr?.downloadMedia) {
            try {
              const blob = await _dlMgr.downloadMedia(msg);
              if (blob) {
                mediaData = await blobToBase64(blob);
              }
            } catch (e) {
              console.warn('[RecoverAdvanced] DownloadManager failed:', e);
            }
          }
          
          // Fallback: Try getBuffer()
          if (!mediaData && msg.mediaData && typeof msg.mediaData.getBuffer === 'function') {
            try {
              const buffer = await msg.mediaData.getBuffer();
              if (buffer) {
                const blob = new Blob([buffer], { type: msg.mimetype || 'application/octet-stream' });
                mediaData = await blobToBase64(blob);
              }
            } catch (e) {
              console.warn('[RecoverAdvanced] getBuffer failed:', e);
            }
          }
          
          // Fallback 2: Use directPath if available
          if (!mediaData && msg.directPath) {
            try {
              const data = await backendPost('/api/v1/recover/media/download', {
                directPath: msg.directPath,
                mediaKey: msg.mediaKey,
                mimetype: msg.mimetype
              });
              mediaData = data?.base64 || null;
            } catch (e) {
              console.warn('[RecoverAdvanced] Backend download failed:', e);
            }
          }
        }
      }
      
      // Save to mediaDataFull in the latest event
      if (mediaData && latestEvent) {
        latestEvent.mediaDataFull = mediaData;
        await saveToStorage();
        console.log('[RecoverAdvanced] Full media downloaded and saved');
      }
      
      return mediaData;
    } catch (e) {
      console.error('[RecoverAdvanced] downloadFullMedia failed:', e);
      return null;
    }
  }
  
  // Helper: Save full media to a specific message event
  async function saveMediaFull(messageId, mediaData) {
    try {
      const entry = messageVersions.get(messageId);
      if (!entry || !entry.history || entry.history.length === 0) {
        console.warn('[RecoverAdvanced] Cannot save media: message not found');
        return false;
      }
      
      // Save to the latest event
      const latestEvent = entry.history[entry.history.length - 1];
      latestEvent.mediaDataFull = mediaData;
      
      await saveToStorage();
      console.log('[RecoverAdvanced] Full media saved for message:', messageId);
      return true;
    } catch (e) {
      console.error('[RecoverAdvanced] saveMediaFull failed:', e);
      return false;
    }
  }

  // ============================================
  // 8.2 - TRANSCRIÇÃO DE ÁUDIOS
  // ============================================
  async function transcribeAudio(audioBase64) {
    try {
      // Método 1: Backend (mais confiável)
      const data = await backendPost('/api/v1/recover/transcribe', { audio: audioBase64 });
      if (data?.text) return data.text;
    } catch (e) {
      console.warn('[RecoverAdvanced] Transcrição via backend falhou:', e.message);
    }

    // Método 2: Web Speech API (Chrome)
    if ('webkitSpeechRecognition' in window) {
      try {
        return await transcribeWithWebSpeech(audioBase64);
      } catch (e) {
        console.warn('[RecoverAdvanced] Web Speech falhou:', e.message);
      }
    }

    return null;
  }

  async function transcribeWithWebSpeech(audioBase64) {
    return new Promise((resolve, reject) => {
      const recognition = new webkitSpeechRecognition();
      recognition.lang = 'pt-BR';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onresult = (e) => resolve(e.results[0][0].transcript);
      recognition.onerror = (e) => reject(e.error);
      recognition.onend = () => resolve(null);

      // Tocar áudio para reconhecimento
      const audio = new Audio(`data:audio/ogg;base64,${audioBase64}`);
      audio.onended = () => recognition.stop();
      audio.play().then(() => recognition.start()).catch(reject);

      // Timeout
      setTimeout(() => {
        recognition.stop();
        resolve(null);
      }, 30000);
    });
  }

  // ============================================
  // 8.3 - OCR EM IMAGENS
  // ============================================
  async function extractTextFromImage(imageBase64) {
    try {
      // Método 1: Backend (mais confiável)
      const data = await backendPost('/api/v1/recover/ocr', { image: imageBase64 });
      if (data?.text) return data.text;
    } catch (e) {
      console.warn('[RecoverAdvanced] OCR via backend falhou:', e.message);
    }

    // Método 2: Tesseract.js (se disponível)
    if (window.Tesseract) {
      try {
        const result = await window.Tesseract.recognize(
          `data:image/jpeg;base64,${imageBase64}`,
          'por',
          { logger: () => {} }
        );
        return result?.data?.text || null;
      } catch (e) {
        console.warn('[RecoverAdvanced] Tesseract falhou:', e.message);
      }
    }

    return null;
  }

  // ============================================
  // 8.4 - ANÁLISE DE SENTIMENTO
  // ============================================
  function analyzeSentiment(text) {
    if (!text || typeof text !== 'string') return 'neutral';

    const lower = text.toLowerCase();
    
    const positiveWords = [
      'obrigado', 'obrigada', 'ótimo', 'ótima', 'excelente', 'perfeito', 'perfeita',
      'legal', 'bom', 'boa', 'maravilhoso', 'maravilhosa', 'incrível', 'parabéns',
      'feliz', 'amor', 'amei', 'adorei', 'top', 'show', 'massa', 'dahora',
      '👍', '❤️', '😊', '🎉', '😍', '🥰', '💕', '✨', '🙏', '👏'
    ];

    const negativeWords = [
      'ruim', 'péssimo', 'péssima', 'horrível', 'problema', 'erro', 'falha',
      'raiva', 'triste', 'decepcionado', 'decepcionada', 'irritado', 'irritada',
      'odeio', 'odiei', 'merda', 'porra', 'droga', 'inferno', 'desgraça',
      '👎', '😠', '😢', '💔', '😤', '😡', '🤬', '😭', '😞'
    ];

    let score = 0;
    positiveWords.forEach(w => { if (lower.includes(w)) score++; });
    negativeWords.forEach(w => { if (lower.includes(w)) score--; });

    if (score > 0) return 'positive';
    if (score < 0) return 'negative';
    return 'neutral';
  }

  // ============================================
  // 8.5 - NOTIFICAÇÕES DESKTOP
  // ============================================
  async function showNotification(msg) {
    if (!('Notification' in window)) return;

    // Pedir permissão se necessário
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    if (Notification.permission !== 'granted') return;

    const titles = {
      revoked: '❌ Mensagem Revogada',
      deleted: '🗑️ Mensagem Apagada',
      edited: '✏️ Mensagem Editada'
    };

    const icons = {
      revoked: '❌',
      deleted: '🗑️',
      edited: '✏️'
    };

    const notification = new Notification(titles[msg.action] || '📩 Mensagem Recuperada', {
      body: `De: ${msg.from}\n${msg.body?.substring(0, 100) || '[Mídia]'}`,
      icon: icons[msg.action] || '📩',
      tag: `recover-${msg.id}`,
      requireInteraction: false
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    // Auto-close após 5s
    setTimeout(() => notification.close(), 5000);
  }

  // ============================================
  // 8.6 - EXPORTAÇÃO CSV/TXT/PDF
  // ============================================
  function exportToCSV() {
    const filtered = getFilteredMessages();
    if (filtered.length === 0) {
      alert('Nenhuma mensagem para exportar.');
      return;
    }

    const headers = ['ID', 'De', 'Para', 'Tipo', 'Ação', 'Mensagem', 'Sentimento', 'Data'];
    const rows = filtered.map(m => [
      m.id,
      m.from,
      m.to || '',
      m.type,
      m.action,
      (m.body || '').replace(/"/g, '""').replace(/\n/g, ' '),
      m.sentiment || '',
      new Date(m.timestamp).toLocaleString('pt-BR')
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(r => r.map(c => `"${c}"`).join(','))
    ].join('\n');

    download(csv, `recover_${Date.now()}.csv`, 'text/csv;charset=utf-8');
    console.log('[RecoverAdvanced] ✅ CSV exportado:', filtered.length, 'mensagens');
  }

  function exportToTXT() {
    const filtered = getFilteredMessages();
    if (filtered.length === 0) {
      alert('Nenhuma mensagem para exportar.');
      return;
    }

    const lines = filtered.map(m => {
      const date = new Date(m.timestamp).toLocaleString('pt-BR');
      const action = { revoked: 'REVOGADA', deleted: 'APAGADA', edited: 'EDITADA' }[m.action] || m.action?.toUpperCase();
      const sentiment = m.sentiment ? ` | Sentimento: ${m.sentiment}` : '';
      
      return `[${date}] ${action} | De: ${m.from}${sentiment}\n${m.body || '[Mídia: ' + m.type + ']'}\n${'─'.repeat(50)}`;
    });

    const txt = `WhatsHybrid Recover - Exportado em ${new Date().toLocaleString('pt-BR')}\nTotal: ${filtered.length} mensagens\n${'═'.repeat(50)}\n\n${lines.join('\n\n')}`;

    download(txt, `recover_${Date.now()}.txt`, 'text/plain;charset=utf-8');
    console.log('[RecoverAdvanced] ✅ TXT exportado:', filtered.length, 'mensagens');
  }

  // BUG 5: Fixed exportToPDF - CSP-compliant (no external jsPDF)
  function exportToPDF() {
    const filtered = getFilteredMessages();
    if (filtered.length === 0) {
      alert('Nenhuma mensagem para exportar.');
      return;
    }

    // BUG 5 FIX: Use HTML/print method only (CSP-compliant)
    // No external jsPDF loading to avoid CSP violations
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>WhatsHybrid Recover - Export</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
          h1 { color: #00a884; border-bottom: 2px solid #00a884; padding-bottom: 10px; }
          .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
          .msg { border-left: 3px solid #00a884; padding: 10px 15px; margin: 15px 0; background: #f5f5f5; }
          .msg-header { color: #666; font-size: 11px; margin-bottom: 5px; }
          .msg-body { font-size: 14px; line-height: 1.5; }
          .action-revoked { border-left-color: #e74c3c; }
          .action-deleted { border-left-color: #f39c12; }
          .action-edited { border-left-color: #3498db; }
          @media print {
            .msg { break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <h1>📱 WhatsHybrid Recover</h1>
        <div class="meta">
          <p>Exportado em: ${new Date().toLocaleString('pt-BR')}</p>
          <p>Total: ${filtered.length} mensagens recuperadas</p>
        </div>
        ${filtered.map(m => `
          <div class="msg action-${m.action || 'revoked'}">
            <div class="msg-header">
              [${new Date(m.timestamp).toLocaleString('pt-BR')}] 
              ${(m.action || 'revoked').toUpperCase()} | De: ${m.from || 'Desconhecido'}
            </div>
            <div class="msg-body">${(m.body || `[Mídia: ${m.type}]`).replace(/\n/g, '<br>')}</div>
          </div>
        `).join('')}
      </body>
      </html>
    `;
    
    const win = window.open('', '_blank', 'width=800,height=600');
    win.document.write(html);
    win.document.close();
    
    // Auto-trigger print dialog
    setTimeout(() => {
      win.print();
    }, 500);
    
    console.log('[RecoverAdvanced] ✅ PDF export via print:', filtered.length, 'mensagens');
  }

  function download(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ============================================
  // 8.7 - SINCRONIZAÇÃO COM BACKEND
  // ============================================
  async function syncWithBackend() {
    try {
      const data = await backendPost('/api/v1/recover/sync', {
        messages: state.messages,
        timestamp: Date.now()
      });
      console.log('[RecoverAdvanced] ✅ Sincronizado com backend:', data?.synced, 'mensagens');
      
      // Mesclar mensagens do backend (mais recentes primeiro)
      if (data?.messages?.length) {
        const existingIds = new Set(state.messages.map(m => m.id));
        const newMessages = data.messages.filter(m => !existingIds.has(m.id));
        state.messages = [...newMessages, ...state.messages].slice(0, CONFIG.MAX_MESSAGES);
        await saveToStorage();
      }
      
      return true;
    } catch (e) {
      console.warn('[RecoverAdvanced] Sync falhou:', e.message);
    }
    return false;
  }

  // ============================================
  // 8.8 - AGRUPAMENTO POR CHAT
  // ============================================
  function getGroupedByChat() {
    const groups = new Map();
    
    getFilteredMessages().forEach(msg => {
      const chat = msg.from || 'unknown';
      if (!groups.has(chat)) {
        groups.set(chat, {
          chat,
          messages: [],
          count: 0,
          lastMessage: null
        });
      }
      
      const group = groups.get(chat);
      group.messages.push(msg);
      group.count++;
      
      if (!group.lastMessage || msg.timestamp > group.lastMessage.timestamp) {
        group.lastMessage = msg;
      }
    });
    
    // Ordenar por última mensagem
    return Array.from(groups.values()).sort((a, b) => 
      (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0)
    );
  }

  // ============================================
  // 8.9 - FAVORITOS
  // ============================================
  function toggleFavorite(id) {
    if (state.favorites.has(id)) {
      state.favorites.delete(id);
    } else {
      state.favorites.add(id);
    }
    saveToStorage();
    return state.favorites.has(id);
  }

  function isFavorite(id) {
    return state.favorites.has(id);
  }

  function getFavorites() {
    return state.messages.filter(m => state.favorites.has(m.id));
  }

  // ============================================
  // 8.10 - COMPARAR VERSÕES EDITADAS
  // ============================================
  function compareEdited(id) {
    const msg = state.messages.find(m => m.id === id);
    if (!msg || msg.action !== 'edited') return null;

    const original = msg.previousContent || '';
    const edited = msg.body || '';

    return {
      original,
      edited,
      diff: generateDiff(original, edited)
    };
  }

  function generateDiff(original, edited) {
    const origWords = original.split(/\s+/);
    const editWords = edited.split(/\s+/);
    
    const added = editWords.filter(w => !origWords.includes(w));
    const removed = origWords.filter(w => !editWords.includes(w));
    
    return {
      added,
      removed,
      addedText: added.join(' '),
      removedText: removed.join(' ')
    };
  }

  // ============================================
  // 8.11 - NOTIFICAÇÕES POR CONTATO
  // ============================================
  function setContactNotification(phone, enabled) {
    const cleanPhone = extractPhone(phone);
    if (enabled) {
      state.contactNotifications.add(cleanPhone);
    } else {
      state.contactNotifications.delete(cleanPhone);
    }
    saveToStorage();
    return enabled;
  }

  function getContactNotifications() {
    return [...state.contactNotifications];
  }

  // ============================================
  // 8.14 - PAGINAÇÃO
  // ============================================
  function getPage(page = 0) {
    const filtered = getFilteredMessages();
    const start = page * CONFIG.PAGE_SIZE;
    const end = start + CONFIG.PAGE_SIZE;
    
    return {
      messages: filtered.slice(start, end),
      page,
      totalPages: Math.ceil(filtered.length / CONFIG.PAGE_SIZE),
      total: filtered.length,
      hasNext: end < filtered.length,
      hasPrev: page > 0
    };
  }

  function nextPage() {
    const result = getPage(state.page + 1);
    if (result.messages.length > 0) {
      state.page++;
    }
    return getPage(state.page);
  }

  function prevPage() {
    if (state.page > 0) {
      state.page--;
    }
    return getPage(state.page);
  }

  // ============================================
  // 8.15 - COMPRESSÃO DE MÍDIA
  // ============================================
  async function compressMedia(base64, type) {
    if (!base64 || type === 'audio' || type === 'ptt' || type === 'document') {
      return base64; // Não comprimir áudios e documentos
    }

    try {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 800;
          
          let width = img.width;
          let height = img.height;
          
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = (height * maxDim) / width;
              width = maxDim;
            } else {
              width = (width * maxDim) / height;
              height = maxDim;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          const compressed = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
          resolve(compressed);
        };
        
        img.onerror = () => resolve(base64);
        img.src = `data:image/jpeg;base64,${base64}`;
      });
    } catch (e) {
      return base64;
    }
  }

  // ============================================
  // 6.8-6.11 - FILTROS
  // ============================================
  function setFilter(type, value) {
    if (type === 'type') {
      state.filters.type = value || 'all';
    } else if (type === 'chat') {
      state.filters.chat = value || null;
    } else if (type === 'dateFrom') {
      state.filters.dateFrom = value ? new Date(value).getTime() : null;
    } else if (type === 'dateTo') {
      state.filters.dateTo = value ? new Date(value).getTime() : null;
    } else if (type === 'direction') {
      // PHASE 2: Filtro de direção
      state.filters.direction = value || 'all';
    } else if (type === 'state') {
      // PHASE 2: Filtro de estado
      state.filters.state = value || 'all';
    }
    
    state.page = 0; // Reset página ao mudar filtro
    
    if (window.EventBus) {
      window.EventBus.emit('recover:filter_changed', state.filters);
    }
  }

  function getFilteredMessages() {
    let filtered = [...state.messages];

    // Filtro por tipo de ação
    if (state.filters.type !== 'all') {
      if (state.filters.type === 'media') {
        filtered = filtered.filter(m => 
          ['image', 'video', 'audio', 'ptt', 'document', 'sticker'].includes(m.type)
        );
      } else if (state.filters.type === 'favorites') {
        // CORREÇÃO 2.1: Adicionar filtro de favoritos
        filtered = filtered.filter(m => state.favorites.has(m.id));
      } else if (state.filters.type === 'view_once') {
        // ViewOnceSaver: filtrar mensagens capturadas do tipo ver-uma-vez
        filtered = filtered.filter(m => m.action === 'view_once' || m.isViewOnce === true);
      } else {
        filtered = filtered.filter(m => m.action === state.filters.type);
      }
    }

    // PHASE 2: Filtro por direção
    if (state.filters.direction !== 'all') {
      filtered = filtered.filter(m => {
        // Calcular direção se não estiver armazenada
        const msgDirection = m.direction || determineDirection(m);
        return msgDirection === state.filters.direction;
      });
    }

    // PHASE 2: Filtro por estado (verifica histórico no messageVersions)
    if (state.filters.state !== 'all') {
      if (state.filters.state === 'revoked_universe') {
        filtered = filtered.filter(m => isInRevokedUniverse(m.id));
      } else {
        filtered = filtered.filter(m => {
          const entry = messageVersions.get(m.id);
          if (!entry) return false;
          return entry.history.some(h => h.state === state.filters.state);
        });
      }
    }

    // Filtro por chat/número
    if (state.filters.chat) {
      const search = state.filters.chat.toLowerCase().replace(/\D/g, '');
      filtered = filtered.filter(m => 
        (m.from || '').includes(search) || 
        (m.to || '').includes(search)
      );
    }

    // Filtro por data
    if (state.filters.dateFrom) {
      filtered = filtered.filter(m => (m.timestamp || 0) >= state.filters.dateFrom);
    }

    if (state.filters.dateTo) {
      filtered = filtered.filter(m => (m.timestamp || 0) <= state.filters.dateTo);
    }

    return filtered;
  }

  // ============================================
  // ESTATÍSTICAS
  // ============================================
  function getStats() {
    const all = state.messages;
    return {
      total: all.length,
      revoked: all.filter(m => m.action === 'revoked').length,
      deleted: all.filter(m => m.action === 'deleted').length,
      edited: all.filter(m => m.action === 'edited').length,
      favorites: state.favorites.size,
      byType: {
        chat: all.filter(m => m.type === 'chat').length,
        image: all.filter(m => m.type === 'image').length,
        video: all.filter(m => m.type === 'video').length,
        audio: all.filter(m => ['audio', 'ptt'].includes(m.type)).length,
        sticker: all.filter(m => m.type === 'sticker').length,
        document: all.filter(m => m.type === 'document').length
      },
      bySentiment: {
        positive: all.filter(m => m.sentiment === 'positive').length,
        negative: all.filter(m => m.sentiment === 'negative').length,
        neutral: all.filter(m => m.sentiment === 'neutral').length
      }
    };
  }

  // ============================================
  // LIMPEZA
  // ============================================
  function clearHistory() {
    state.messages = [];
    state.favorites.clear();
    state.page = 0;
    saveToStorage();
    
    if (window.EventBus) {
      window.EventBus.emit('recover:cleared');
    }
  }

  /**
   * Remove duplicatas e mensagens com números inválidos do histórico
   * @returns {Object} Estatísticas da limpeza
   */
  async function cleanDuplicates() {
    console.log('[RecoverAdvanced] 🧹 Limpando duplicatas...');
    
    const before = state.messages.length;
    state.messages = deduplicateMessages(state.messages);
    const after = state.messages.length;
    
    await saveToStorage();
    
    const result = {
      before,
      after,
      removed: before - after
    };
    
    console.log('[RecoverAdvanced] ✅ Limpeza concluída:', result);
    
    if (window.EventBus) {
      window.EventBus.emit('recover:cleaned', result);
    }
    
    return result;
  }

  // ============================================
  // BUG 5: REFRESH BUTTON - RELOAD WITH REAL DATA
  // ============================================
  async function refreshMessages() {
    console.log('[RecoverAdvanced] 🔄 Refreshing messages...');

    try {
      // Step 1: Clear memory cache
      const processedIds = new Set();

      // Step 2: Reload from storage
      await loadFromStorage();

      // Step 3: Check for new deleted messages via hooks (Store interno do WA).
      // Pode retornar vazio se o Store não está disponível — o que é comum.
      const newMessages = await checkForNewDeletedMessages();

      // Step 3b: Ponte com RecoverDOM — quando os hooks do Store não pegam,
      // o RecoverDOM ainda captura mensagens apagadas/editadas via DOM scan.
      // Sem este merge, a sidebar lateral ficava vazia mesmo com badges
      // injetados nas mensagens dentro do chat.
      const domMessages = mergeFromRecoverDOM();

      // Step 4: Merge without duplicates
      let allMessages = mergeWithoutDuplicates(state.messages, newMessages);
      if (domMessages.length > 0) {
        allMessages = mergeWithoutDuplicates(allMessages, domMessages);
      }
      state.messages = allMessages.slice(0, CONFIG.MAX_MESSAGES);

      // Step 5: Save back to storage
      await saveToStorage();

      console.log('[RecoverAdvanced] ✅ Refresh:', state.messages.length, 'total (', newMessages.length, 'novos via hooks,', domMessages.length, 'via DOM)');

      return {
        success: true,
        total: state.messages.length,
        newCount: newMessages.length + domMessages.length
      };
    } catch (e) {
      console.error('[RecoverAdvanced] Refresh failed:', e);
      return {
        success: false,
        error: e.message
      };
    }
  }

  /**
   * Converte itens de RecoverDOM.getHistory() (formato do scanner DOM)
   * para o shape de state.messages que a sidebar consome via
   * getFilteredMessages/getStats. Sem essa ponte, capturas via DOM
   * (única fonte quando window.Store.Msg é inacessível) ficavam invisíveis
   * fora do chat.
   */
  function mergeFromRecoverDOM() {
    try {
      if (!window.RecoverDOM || typeof window.RecoverDOM.getHistory !== 'function') return [];
      const history = window.RecoverDOM.getHistory();
      if (!Array.isArray(history) || history.length === 0) return [];

      return history
        .filter(h => h && (h.action === 'deleted' || h.action === 'revoked' || h.action === 'edited'))
        .map(h => ({
          id: String(h.id || h.key || `dom_${h.timestamp || Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
          chatId: h.chatId || '',
          from: extractPhoneNumber(h.from || h.chatId || ''),
          to: extractPhoneNumber(h.to || ''),
          action: h.action === 'deleted' ? 'deleted' : (h.action === 'edited' ? 'edited' : 'revoked'),
          type: h.mediaType || 'chat',
          body: h.body || h.originalBody || '',
          previousBody: h.previousBody || null,
          mediaUrl: h.mediaUrl || null,
          isOutgoing: !!h.isOutgoing,
          direction: h.isOutgoing ? 'sent' : 'received',
          timestamp: Number(h.timestamp) || Date.now(),
          recovered: !!h.recovered,
          origin: 'recover_dom_scanner'
        }));
    } catch (e) {
      console.warn('[RecoverAdvanced] mergeFromRecoverDOM falhou:', e?.message);
      return [];
    }
  }
  
  /**
   * BUG 5: Check for new deleted messages from WhatsApp Store
   */
  async function checkForNewDeletedMessages() {
    const newMessages = [];
    
    try {
      if (!window.Store?.Msg?.getModelsArray) {
        return newMessages;
      }
      
      // FIX CRÍTICO: cópia estática do array vivo antes de iterar.
      // getModelsArray() retorna referência ao array interno do WA — mutação
      // durante iteração (mensagem recebida/apagada) causa race condition.
      const allMsgs = Array.from(window.Store.Msg.getModelsArray() || []);
      const revokedMsgs = allMsgs.filter(m => m.isRevoked || m.type === 'revoked');
      
      for (const msg of revokedMsgs) {
        const id = msg.id?.id || msg.id?._serialized;
        
        // Check if we already have this message
        const existing = state.messages.find(m => m.id === id);
        if (!existing) {
          const normalized = normalizeMessage(msg);
          if (normalized) {
            newMessages.push(normalized);
          }
        }
      }
    } catch (e) {
      console.warn('[RecoverAdvanced] checkForNewDeletedMessages failed:', e);
    }
    
    return newMessages;
  }
  
  /**
   * BUG 5: Normalize WhatsApp message to our format
   */
  function normalizeMessage(msg) {
    try {
      return {
        id: msg.id?.id || msg.id?._serialized || Date.now().toString(),
        from: extractPhone(msg.from || msg.author || msg.sender),
        to: extractPhone(msg.to || msg.chatId),
        body: msg.body || msg.caption || '[Mídia]',
        type: msg.type || 'chat',
        action: msg.isRevoked ? 'revoked' : 'deleted',
        timestamp: msg.t || msg.timestamp || Date.now(),
        mediaType: msg.type,
        mediaData: null
      };
    } catch (e) {
      return null;
    }
  }
  
  /**
   * BUG 5: Merge messages without duplicates
   */
  function mergeWithoutDuplicates(existing, newMsgs) {
    const merged = [...existing];
    const existingIds = new Set(existing.map(m => m.id));
    
    for (const msg of newMsgs) {
      if (!existingIds.has(msg.id)) {
        merged.unshift(msg); // Add to beginning (most recent first)
        existingIds.add(msg.id);
      }
    }
    
    return merged;
  }

  // ============================================
  // BUG 6: SYNC - BACKEND CONNECTION CHECK
  // ============================================
  async function checkBackendConnection() {
    console.log('[RecoverAdvanced] 🔍 Checking backend connection...');

    // ⚠️ Verificar se backend está habilitado
    if (window.BackendClient && typeof window.BackendClient.isConnected === 'function') {
      // Se BackendClient.isConnected() retorna false E não há token, backend está desabilitado
      const hasConnection = window.BackendClient.isConnected();
      if (!hasConnection) {
        console.log('[RecoverAdvanced] ⚠️ Backend desabilitado (BackendClient.isConnected = false)');
        return { connected: false, disabled: true, reason: 'backend_disabled' };
      }
    }

    try {
      // Step 1: Check if we have a token in storage
      const stored = await chrome.storage.local.get(['whl_access_token', 'whl_user']);
      const token = stored.whl_access_token;
      const user = stored.whl_user;

      if (!token) {
        console.log('[RecoverAdvanced] No token found');
        return { connected: false, reason: 'no_token' };
      }
      
      // Step 2: Check if socket is connected
      if (window.BackendClient?.socket?.connected) {
        console.log('[RecoverAdvanced] Socket already connected');
        return { connected: true, user };
      }
      
      // Step 3: Try to reconnect socket if we have token
      if (token && window.BackendClient) {
        console.log('[RecoverAdvanced] Attempting to reconnect socket...');
        
        // Try to connect
        if (typeof window.BackendClient.connectSocket === 'function') {
          window.BackendClient.connectSocket();
        }
        
        // Wait a bit for connection
        await sleep(2000);
        
        if (window.BackendClient.socket?.connected) {
          console.log('[RecoverAdvanced] Socket reconnected successfully');
          return { connected: true, user, reconnected: true };
        }
      }
      
      // Step 4: Fallback - try HTTP health check
      try {
        const baseUrl = window.BackendClient?.getBaseUrl?.() || CONFIG.BACKEND_URL;
        
        // Use AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(`${baseUrl}/health`, {
          headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          console.log('[RecoverAdvanced] Backend reachable via HTTP');
          return { connected: true, user, viaHttp: true };
        }
      } catch (e) {
        console.warn('[RecoverAdvanced] HTTP health check failed:', e);
      }
      
      console.log('[RecoverAdvanced] Connection failed');
      return { connected: false, reason: 'connection_failed' };
      
    } catch (e) {
      console.error('[RecoverAdvanced] checkBackendConnection error:', e);
      return { connected: false, reason: 'error', error: e.message };
    }
  }

  // ============================================
  // BUG 7: DEEPSCAN - COMPLETE WITH PROGRESS
  // ============================================
  async function executeDeepScan(onProgress) {
    console.log('[RecoverAdvanced] 🔍 Starting DeepScan...');
    
    const results = {
      success: false,
      found: 0,
      scanned: 0,
      errors: []
    };
    
    try {
      // Phase 1: Get list of chats (0-20%)
      onProgress?.({ phase: 1, progress: 10, status: 'Obtaining chat list...' });
      const chats = await getAllChats();
      onProgress?.({ phase: 1, progress: 20, status: `Found ${chats.length} chats` });
      
      if (chats.length === 0) {
        throw new Error('No chats found');
      }
      
      // Phase 2: Scan messages in each chat (20-60%)
      const foundMessages = [];
      const totalChats = chats.length;
      
      for (let i = 0; i < totalChats; i++) {
        const chat = chats[i];
        const progress = 20 + Math.floor((i / totalChats) * 40);
        
        onProgress?.({ 
          phase: 2, 
          progress, 
          status: `Scanning: ${chat.name || chat.id}`,
          detail: `${i + 1}/${totalChats} chats`
        });
        
        try {
          const deleted = await scanChatForDeletedMessages(chat.id);
          foundMessages.push(...deleted);
          results.scanned++;
          
          // Small delay to not overload
          await sleep(100);
        } catch (e) {
          console.warn('[RecoverAdvanced] Error scanning chat:', chat.id, e);
          results.errors.push({ chat: chat.id, error: e.message });
        }
      }
      
      onProgress?.({ 
        phase: 2, 
        progress: 60, 
        status: `Found ${foundMessages.length} messages`,
        detail: 'Phase 2/4 complete'
      });
      
      // Phase 3: Process and deduplicate (60-80%)
      onProgress?.({ phase: 3, progress: 70, status: 'Processing messages...' });
      const processed = await processAndDeduplicate(foundMessages);
      results.found = processed.length;
      onProgress?.({ 
        phase: 3, 
        progress: 80, 
        status: `${processed.length} unique messages`,
        detail: 'Phase 3/4 complete'
      });
      
      // Phase 4: Save and update (80-100%)
      onProgress?.({ phase: 4, progress: 90, status: 'Saving to history...' });
      
      // Merge with existing messages
      state.messages = mergeWithoutDuplicates(state.messages, processed);
      state.messages = state.messages.slice(0, CONFIG.MAX_MESSAGES);
      
      await saveToStorage();
      
      onProgress?.({ 
        phase: 4, 
        progress: 100, 
        status: '✅ DeepScan complete!',
        detail: `${results.found} new messages recovered`
      });
      
      results.success = true;
      console.log('[RecoverAdvanced] ✅ DeepScan complete:', results);
      
      return results;
      
    } catch (e) {
      console.error('[RecoverAdvanced] DeepScan error:', e);
      results.errors.push({ global: e.message });
      onProgress?.({ 
        phase: 0, 
        progress: 0, 
        status: '❌ Error: ' + e.message
      });
      
      return results;
    }
  }
  
  /**
   * BUG 7: Get all chats from WhatsApp
   */
  async function getAllChats() {
    try {
      if (!window.Store?.Chat?.getModelsArray) {
        throw new Error('WhatsApp Store not available');
      }
      
      // FIX CRÍTICO: cópia estática antes de iterar — evita race condition
      const chats = Array.from(window.Store.Chat.getModelsArray() || []);
      
      return chats.map(chat => ({
        id: chat.id?._serialized || chat.id,
        name: chat.name || chat.formattedTitle || 'Unknown',
        isGroup: chat.isGroup || false
      }));
    } catch (e) {
      console.error('[RecoverAdvanced] getAllChats failed:', e);
      return [];
    }
  }
  
  /**
   * BUG 7: Scan specific chat for deleted messages
   */
  async function scanChatForDeletedMessages(chatId) {
    const deleted = [];
    
    try {
      // Method 1: Via Store.Msg
      if (window.Store?.Msg?.getModelsArray) {
        // FIX CRÍTICO: cópia estática antes de iterar — evita race condition
        const msgs = Array.from(window.Store.Msg.getModelsArray() || []);
        const chatMsgs = msgs.filter(m => {
          const msgChatId = m.id?.remote?._serialized || m.chatId?._serialized;
          return msgChatId === chatId && (m.isRevoked || m.type === 'revoked');
        });
        
        for (const msg of chatMsgs) {
          const normalized = normalizeMessage(msg);
          if (normalized) {
            deleted.push(normalized);
          }
        }
      }
      
      // Method 2: Via DOM (visible messages)
      // FIX PEND-MED-006: Multiple fallback selectors for container
      const containerSelectors = [
        `[data-id="${chatId}"]`,
        `div[data-testid*="${chatId}"]`,
        `div[aria-label*="${chatId}"]`,
        `#pane-side div[data-id]`, // Generic chat container
        `.chat[data-id="${chatId}"]`,
        `div[title*="${chatId}"]`
      ];

      let container = null;
      for (const selector of containerSelectors) {
        container = document.querySelector(selector);
        if (container) break;
      }

      if (container) {
        // FIX PEND-MED-006: Deep tree traversal
        const revokedEls = findElements(SELECTORS.RECALLED_MESSAGE, container);

        for (const el of revokedEls) {
          const msgData = extractMessageFromElement(el, chatId);
          if (msgData) {
            deleted.push(msgData);
          }
        }
      }
      
    } catch (e) {
      console.warn('[RecoverAdvanced] scanChatForDeletedMessages failed:', chatId, e);
    }
    
    return deleted;
  }
  
  /**
   * BUG 7: Extract message data from DOM element
   * FIX PEND-MED-006: Proper data extraction with multiple fallbacks
   */
  function extractMessageFromElement(element, chatId) {
    try {
      const id = element.getAttribute('data-id') ||
                 element.getAttribute('data-testid') ||
                 Date.now().toString();

      // FIX PEND-MED-006: Extract actual message text with fallbacks
      const textSelectors = [
        '.message-in span.selectable-text',
        '.message-out span.selectable-text',
        'span[data-testid="conversation-text"]',
        'div.copyable-text span',
        '.message-text',
        'span.selectable-text'
      ];

      let text = '';
      for (const selector of textSelectors) {
        const textEl = element.querySelector(selector);
        if (textEl) {
          text = textEl.textContent?.trim() || '';
          if (text) break;
        }
      }

      if (!text) {
        text = element.textContent?.trim() || '[Deleted message]';
      }

      // FIX PEND-MED-006: Extract sender info
      const senderSelectors = [
        '[data-testid="sender-name"]',
        '.message-author',
        'span._11JPr', // WhatsApp class for sender
        'div[role="button"] span'
      ];

      let from = chatId || 'Unknown';
      for (const selector of senderSelectors) {
        const senderEl = element.querySelector(selector);
        if (senderEl) {
          from = senderEl.textContent?.trim() || from;
          if (from && from !== 'Unknown') break;
        }
      }

      // FIX PEND-MED-006: Extract timestamp
      const timestampSelectors = [
        '[data-testid="msg-time"]',
        '.message-time',
        'span[data-testid="message-timestamp"]',
        'div[data-pre-plain-text] span'
      ];

      let timestamp = Date.now();
      for (const selector of timestampSelectors) {
        const timeEl = element.querySelector(selector);
        if (timeEl) {
          const timeText = timeEl.textContent?.trim();
          if (timeText) {
            // Try to parse time (format varies by locale)
            timestamp = parseMessageTime(timeText) || timestamp;
            break;
          }
        }
      }

      // FIX PEND-MED-006: Extract media info
      let mediaType = 'chat';
      let mediaData = null;
      const mediaSelectors = {
        image: ['img[src*="blob"]', 'img[data-testid="media-content"]', '.message-media img'],
        video: ['video', '[data-testid="video-player"]'],
        audio: ['audio', '[data-testid="audio-player"]'],
        document: ['[data-testid="document"]', '.document-icon']
      };

      for (const [type, selectors] of Object.entries(mediaSelectors)) {
        for (const selector of selectors) {
          const mediaEl = element.querySelector(selector);
          if (mediaEl) {
            mediaType = type;
            mediaData = mediaEl.src || mediaEl.href || '__HAS_MEDIA__';
            break;
          }
        }
        if (mediaData) break;
      }

      // FIX PEND-MED-006: Detect message direction (incoming vs outgoing)
      const isOutgoing = element.classList.contains('message-out') ||
                          element.querySelector('.message-out') ||
                          element.closest('.message-out');

      const direction = isOutgoing ? 'outgoing' : 'incoming';

      return {
        id,
        body: text || '[Deleted message]',
        type: mediaType,
        action: 'revoked',
        timestamp,
        from: from,
        to: direction === 'outgoing' ? chatId : 'Me',
        mediaData,
        direction,
        // Extra metadata for debugging
        extractedFrom: 'DOM',
        chatId: chatId || 'Unknown'
      };
    } catch (e) {
      console.warn('[RecoverAdvanced] extractMessageFromElement error:', e);
      return null;
    }
  }

  /**
   * Helper: Parse message time from text
   */
  function parseMessageTime(timeText) {
    try {
      // Try common formats: "10:30 AM", "15:45", etc.
      const now = new Date();
      const timeMatch = timeText.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);

      if (timeMatch) {
        let hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const isPM = timeMatch[3]?.toLowerCase() === 'pm';

        if (isPM && hours < 12) hours += 12;
        if (!isPM && hours === 12) hours = 0;

        const parsed = new Date(now);
        parsed.setHours(hours, minutes, 0, 0);

        return parsed.getTime();
      }
    } catch (e) {
      // Parsing failed, return null to use fallback
    }
    return null;
  }
  
  /**
   * BUG 7: Process and deduplicate messages
   * @param {Array} messages - Array of messages to process
   * @returns {Promise<Array>} Deduplicated array of messages
   */
  async function processAndDeduplicate(messages) {
    const unique = new Map();
    
    for (const msg of messages) {
      // Use robust key with fallbacks for undefined values
      const timestamp = msg.timestamp || Date.now();
      const from = msg.from || 'unknown';
      const id = msg.id || `generated_${Date.now()}_${Math.random()}`;
      const key = `${id}_${from}_${timestamp}`;
      
      if (!unique.has(key)) {
        unique.set(key, msg);
      }
    }
    
    return Array.from(unique.values());
  }

  // ============================================
  // API PÚBLICA
  // ============================================
  window.RecoverAdvanced = {
    // Inicialização
    init,
    
    // Mensagens
    getMessages: () => [...state.messages],
    getFilteredMessages,
    addMessage: handleNewMessage,
    
    // PHASE 1: Message Versions API
    registerMessageEvent,
    getMessageHistory,
    getMessageVersions: () => {
      // Retornar cópia do Map como objeto
      const result = {};
      messageVersions.forEach((entry, id) => {
        result[id] = entry;
      });
      return result;
    },
    getCurrentState,
    isInRevokedUniverse,
    getRevokedUniverseMessages,
    messageVersions: messageVersions, // Direct access for advanced use
    MESSAGE_STATES,
    REVOKED_UNIVERSE_STATES,
    
    // PHASE 2: Enhanced extraction and direction
    extractPhoneNumber,
    cleanPhoneNumber,
    isValidPhoneNumber,
    getOwner,
    determineDirection,
    extractChatId,
    
    // Paginação
    getPage,
    nextPage,
    prevPage,
    
    // Filtros
    setFilter,
    getFilters: () => ({ ...state.filters }),
    
    // Favoritos
    toggleFavorite,
    isFavorite,
    getFavorites,
    
    // Agrupamento
    getGroupedByChat,
    
    // Comparação de edições
    compareEdited,
    
    // Mídia
    downloadMediaActive,
    downloadFullMedia, // BUG 1/5: Full-size media download (old method)
    downloadRealMedia, // BUG 1: NEW - Download real media with DOM traversal
    downloadMediaFromStore, // BUG 1: Helper for Store API
    saveMediaFull, // BUG 1/5: Save full media separately
    transcribeAudio,
    extractTextFromImage,
    compressMedia,
    
    // Análise
    analyzeSentiment,
    
    // Exportação
    exportToCSV,
    exportToTXT,
    exportToPDF,
    
    // Sincronização
    syncWithBackend,
    
    // Notificações
    showNotification,
    setContactNotification,
    getContactNotifications,
    
    // Cache
    mediaCache,
    
    // Estatísticas
    getStats,
    
    // Limpeza
    clearHistory,
    cleanDuplicates,
    
    // Validação
    isRealPhoneNumber,
    deduplicateMessages,
    
    // Storage
    loadFromStorage,
    
    // BUG 5: Refresh functionality
    refreshMessages,
    checkForNewDeletedMessages,
    
    // BUG 6: SYNC - Backend connection check
    checkBackendConnection,
    
    // BUG 7: DeepScan with progress
    executeDeepScan,
    getAllChats,
    scanChatForDeletedMessages,
    
    // Utilitários
    extractPhone
  };

  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 100));
  } else {
    setTimeout(init, 100);
  }

  console.log('[RecoverAdvanced] 📦 Módulo carregado');

})();
