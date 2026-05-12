/**
 * 🔄 Recover DOM v2.0 - Sistema de Recuperação de Mensagens Apagadas
 *
 * Sistema HÍBRIDO:
 * - Funciona via DOM quando APIs internas não estão disponíveis
 * - Cacheia TODAS as mensagens visíveis
 * - Detecta mensagens apagadas e restaura conteúdo
 * - Mantém histórico persistente com opção de download
 *
 * @version 2.0.0 - CORRIGIDO
 */

(function() {
  'use strict';

  if (window.__RECOVER_DOM_V2__) return;
  window.__RECOVER_DOM_V2__ = true;

  const DEBUG = localStorage.getItem('whl_debug') === 'true';
  function log(...args) { if (DEBUG) console.log('[RecoverDOM]', ...args); }

  const STORAGE_KEY = 'whl_recover_history_v2';
  const CACHE_KEY = 'whl_message_cache_v2';
  const MAX_HISTORY = 500;
  const MAX_CACHE = 2000;
  const MAX_STORAGE_BYTES = 3 * 1024 * 1024; // 3MB

  let chatChangeInterval = null;

  // ============================================
  // ESTADO
  // ============================================

  const state = {
    initialized: false,
    messageCache: new Map(), // msgKey -> { text, from, timestamp, mediaUrl, mediaType }
    history: [], // Mensagens apagadas recuperadas
    observer: null,
    currentChatId: null,
    scanInterval: null
  };

  // ============================================
  // SELETORES ATUALIZADOS 2024/2025
  // ============================================

  const SELECTORS = {
    // Container principal de mensagens
    MESSAGES_CONTAINER: [
      '[data-testid="conversation-panel-messages"]',
      '#main div[role="application"]',
      '#main .copyable-area',
      '#main'
    ],

    // Mensagem individual
    MESSAGE: [
      '[data-testid="msg-container"]',
      'div.message-in',
      'div.message-out',
      '[data-id]'
    ],

    // Texto da mensagem
    MESSAGE_TEXT: [
      'span.selectable-text[data-testid]',
      '[data-testid="msg-text"]',
      '.copyable-text span.selectable-text',
      'span.selectable-text span',
      '.message-text'
    ],

    // Indicadores de mensagem apagada
    DELETED_INDICATORS: [
      '[data-testid="recalled-msg"]',
      'span[data-icon="recalled"]',
      'span[data-icon="recalled-in"]',
      'span[data-icon="recalled-out"]',
      '.message-recalled'
    ],

    // Texto de mensagem apagada (PT-BR e EN)
    DELETED_TEXT_PATTERNS: [
      'Esta mensagem foi apagada',
      'This message was deleted',
      'Mensagem apagada',
      'Message deleted',
      '🚫 Esta mensagem foi excluída',
      'Você apagou esta mensagem'
    ],

    // Info do remetente (em grupos)
    SENDER_INFO: [
      '[data-testid="author"]',
      '.copyable-text[data-pre-plain-text]',
      '._ahxt', // Classe do WhatsApp para nome do remetente
      'span[dir="auto"][aria-label]'
    ],

    // Timestamp
    TIMESTAMP: [
      '[data-testid="msg-meta"]',
      '.message-time',
      'span[data-testid="msg-time"]'
    ],

    // Mídia
    MEDIA: [
      'img[src*="blob:"]',
      'img[src*="https://web.whatsapp.com/"]',
      'video',
      '[data-testid="media-state"]',
      '[data-testid="image-thumb"]',
      '[data-testid="video-thumb"]'
    ],

    // Outgoing (mensagem enviada)
    OUTGOING: [
      '[data-testid="msg-dblcheck"]',
      '[data-icon="msg-dblcheck"]',
      '[data-icon="msg-check"]',
      '[data-icon="tail-out"]',
      '.message-out'
    ],

    // Header do chat
    CHAT_HEADER: [
      '#main header span[title]',
      '[data-testid="conversation-info-header-chat-title"]',
      'header ._amie span',
      'header span[dir="auto"]'
    ]
  };

  // ============================================
  // UTILITÁRIOS
  // ============================================

  function findElement(parent, selectorList) {
    if (!parent) return null;
    for (const sel of selectorList) {
      try {
        const el = parent.querySelector(sel);
        if (el) return el;
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }
    return null;
  }

  function findElements(parent, selectorList) {
    if (!parent) return [];
    const results = [];
    for (const sel of selectorList) {
      try {
        const els = parent.querySelectorAll(sel);
        for (const el of els) {
          if (!results.includes(el)) results.push(el);
        }
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }
    return results;
  }

  function findContainer() {
    for (const sel of SELECTORS.MESSAGES_CONTAINER) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetHeight) return el;
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }
    return null;
  }

  function generateMsgKey(element) {
    // Tentar extrair ID do data attribute
    const dataId = element.getAttribute('data-id') || 
                   element.closest('[data-id]')?.getAttribute('data-id');
    
    if (dataId) return dataId;

    // Fallback: criar key única baseada em posição e conteúdo
    const parent = element.closest('[data-testid="msg-container"]') || element;
    const allMsgs = document.querySelectorAll('[data-testid="msg-container"]');
    const index = Array.from(allMsgs).indexOf(parent);
    const text = (element.textContent || '').slice(0, 50);
    
    return `msg_${index}_${hashString(text)}`;
  }

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  function getCurrentChatId() {
    const header = findElement(document, SELECTORS.CHAT_HEADER);
    if (header) {
      return header.getAttribute('title') || header.textContent?.trim() || 'unknown';
    }
    return 'unknown';
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ============================================
  // EXTRAÇÃO DE DADOS DA MENSAGEM
  // ============================================

  function extractMessageData(element) {
    const msgContainer = element.closest('[data-testid="msg-container"]') || element;
    
    // Texto
    const textEl = findElement(msgContainer, SELECTORS.MESSAGE_TEXT);
    let text = textEl?.textContent?.trim() || '';

    // Verificar se é mensagem apagada
    const isDeleted = isDeletedMessage(msgContainer, text);

    // Se já é uma mensagem apagada, não cachear o texto de "apagada"
    if (isDeleted) {
      text = '';
    }

    // Remetente
    let from = 'Eu';
    const isOutgoing = !!findElement(msgContainer, SELECTORS.OUTGOING);
    
    if (!isOutgoing) {
      const senderEl = findElement(msgContainer, SELECTORS.SENDER_INFO);
      if (senderEl) {
        const prePlain = senderEl.getAttribute('data-pre-plain-text');
        if (prePlain) {
          const match = prePlain.match(/\] (.+?):/);
          if (match) from = match[1];
        } else {
          from = senderEl.textContent?.trim() || 'Contato';
        }
      } else {
        from = 'Contato';
      }
    }

    // Timestamp
    const timeEl = findElement(msgContainer, SELECTORS.TIMESTAMP);
    const timeText = timeEl?.textContent?.trim() || '';

    // Mídia
    let mediaUrl = null;
    let mediaType = null;
    const mediaEl = findElement(msgContainer, SELECTORS.MEDIA);
    
    if (mediaEl) {
      if (mediaEl.tagName === 'IMG') {
        mediaUrl = mediaEl.src;
        mediaType = 'image';
      } else if (mediaEl.tagName === 'VIDEO') {
        mediaUrl = mediaEl.src;
        mediaType = 'video';
      }
    }

    return {
      text,
      from,
      isOutgoing,
      isDeleted,
      timestamp: Date.now(),
      timeText,
      mediaUrl,
      mediaType,
      chatId: getCurrentChatId()
    };
  }

  function isDeletedMessage(element, text = '') {
    // Verificar por ícone de mensagem apagada
    if (findElement(element, SELECTORS.DELETED_INDICATORS)) {
      return true;
    }

    // Verificar por texto de mensagem apagada
    const msgText = text || element.textContent || '';
    for (const pattern of SELECTORS.DELETED_TEXT_PATTERNS) {
      if (msgText.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  // ============================================
  // CACHE DE MENSAGENS
  // ============================================

  function cacheMessage(element) {
    const msgKey = generateMsgKey(element);
    const data = extractMessageData(element);

    // Não cachear mensagens apagadas ou vazias
    if (data.isDeleted || (!data.text && !data.mediaUrl)) {
      return;
    }

    // Verificar se já temos essa mensagem cacheada com conteúdo melhor
    const existing = state.messageCache.get(msgKey);
    if (existing && existing.text && existing.text.length >= data.text.length) {
      return; // Manter cache existente se tiver mais conteúdo
    }

    state.messageCache.set(msgKey, {
      ...data,
      key: msgKey,
      cachedAt: Date.now()
    });

    log('✅ Mensagem cacheada:', msgKey, data.text?.slice(0, 30));

    // Limitar tamanho do cache
    if (state.messageCache.size > MAX_CACHE) {
      const keys = Array.from(state.messageCache.keys());
      for (let i = 0; i < 100; i++) {
        state.messageCache.delete(keys[i]);
      }
    }
  }

  function getCachedMessage(msgKey) {
    return state.messageCache.get(msgKey);
  }

  // ============================================
  // DETECÇÃO DE MENSAGENS APAGADAS
  // ============================================

  function handleDeletedMessage(element) {
    const msgKey = generateMsgKey(element);
    const cached = getCachedMessage(msgKey);

    if (!cached || !cached.text) {
      log('⚠️ Mensagem apagada sem cache:', msgKey);
      
      // Ainda assim, registrar no histórico como "não recuperável"
      const basicData = extractMessageData(element);
      addToHistory({
        key: msgKey,
        body: '[Conteúdo não recuperável - não estava em cache]',
        originalBody: null,
        from: basicData.from,
        chatId: basicData.chatId,
        action: 'deleted',
        recovered: false,
        timestamp: Date.now()
      });
      
      return;
    }

    log('🗑️ Mensagem apagada RECUPERADA:', cached.text.slice(0, 50));

    // Adicionar ao histórico
    const entry = {
      key: msgKey,
      body: cached.text,
      originalBody: cached.text,
      from: cached.from,
      chatId: cached.chatId,
      isOutgoing: cached.isOutgoing,
      mediaUrl: cached.mediaUrl,
      mediaType: cached.mediaType,
      action: 'deleted',
      recovered: true,
      timestamp: Date.now(),
      originalTimestamp: cached.timestamp
    };

    addToHistory(entry);

    // IMPORTANTE: Injetar conteúdo recuperado no DOM
    injectRecoveredContent(element, cached);

    // Notificar
    notifyRecovery(entry);
  }

  function injectRecoveredContent(element, cached) {
    try {
      const msgContainer = element.closest('[data-testid="msg-container"]') || element;
      
      // Verificar se já foi processado
      if (msgContainer.querySelector('.whl-recovered-marker')) {
        return;
      }

      // Encontrar onde injetar o texto
      const textContainer = findElement(msgContainer, SELECTORS.MESSAGE_TEXT) ||
                           msgContainer.querySelector('.copyable-text') ||
                           msgContainer.querySelector('span[dir="ltr"]');

      if (textContainer) {
        // Criar badge de recuperado
        const wrapper = document.createElement('span');
        wrapper.className = 'whl-recovered-marker';
        wrapper.innerHTML = `
          <span style="color: #ef4444; font-weight: bold;">🚫 Apagada: </span>
          <span style="color: #fbbf24; font-style: italic;">${escapeHtml(cached.text)}</span>
        `;
        wrapper.title = 'Mensagem recuperada pelo WhatsHybrid';
        wrapper.style.cssText = 'display: inline; cursor: help;';

        // Substituir conteúdo
        textContainer.innerHTML = '';
        textContainer.appendChild(wrapper);

        // Adicionar estilo ao container
        msgContainer.style.background = 'rgba(251, 191, 36, 0.1)';
        msgContainer.style.borderLeft = '3px solid #fbbf24';

        log('✅ Conteúdo recuperado injetado no DOM');
      }
    } catch (e) {
      log('Erro ao injetar conteúdo:', e);
    }
  }

  function escapeHtml(text) {
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(text);
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // ============================================
  // HISTÓRICO
  // ============================================

  async function loadHistory() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        state.history = result[STORAGE_KEY];
        log('Histórico carregado:', state.history.length, 'mensagens');
      }
    } catch (e) {
      console.error('[RecoverDOM] Erro ao carregar histórico:', e);
    }
  }

  async function saveHistory() {
    try {
      // Limitar por contagem
      if (state.history.length > MAX_HISTORY) {
        state.history = state.history.slice(-MAX_HISTORY);
      }

      // Limitar por tamanho
      let data = JSON.stringify(state.history);
      while (data.length > MAX_STORAGE_BYTES && state.history.length > 10) {
        state.history.shift();
        data = JSON.stringify(state.history);
      }

      await chrome.storage.local.set({ [STORAGE_KEY]: state.history });
      log('Histórico salvo:', state.history.length, 'mensagens');
    } catch (e) {
      console.error('[RecoverDOM] Erro ao salvar histórico:', e);
    }
  }

  function addToHistory(entry) {
    // Evitar duplicatas
    const exists = state.history.some(h => h.key === entry.key && h.action === entry.action);
    if (exists) return;

    state.history.push(entry);
    saveHistory();

    // Emitir evento
    if (window.EventBus?.emit) {
      window.EventBus.emit('recover:message_recovered', entry);
    }

    // Sincronizar com wpp-hooks se disponível
    try {
      window.postMessage({
        type: 'WHL_RECOVER_NEW_MESSAGE',
        payload: entry
      }, window.location.origin);
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
  }

  function getHistory() {
    return [...state.history];
  }

  function clearHistory() {
    state.history = [];
    saveHistory();
  }

  // ============================================
  // DOWNLOAD DE MÍDIA DO HISTÓRICO
  // ============================================

  async function downloadFromHistory(entry) {
    log('📥 Download do histórico:', entry.key);

    try {
      // Se tem URL de mídia
      if (entry.mediaUrl) {
        if (entry.mediaUrl.startsWith('blob:')) {
          // Blob URL pode não estar mais válida
          throw new Error('URL de blob expirada');
        }
        
        // Abrir em nova aba ou baixar
        const a = document.createElement('a');
        a.href = entry.mediaUrl;
        a.target = '_blank';
        a.download = `recovered_${entry.mediaType || 'media'}_${Date.now()}.${entry.mediaType === 'video' ? 'mp4' : 'jpg'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        return { ok: true, method: 'direct' };
      }

      // Se só tem texto, criar arquivo de texto
      if (entry.body) {
        const content = `Mensagem Recuperada
==================
De: ${entry.from}
Chat: ${entry.chatId}
Data: ${new Date(entry.timestamp).toLocaleString()}
Ação: ${entry.action}

Conteúdo:
${entry.body}
`;
        
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `recovered_message_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);
        
        return { ok: true, method: 'text' };
      }

      throw new Error('Sem conteúdo para download');
    } catch (e) {
      console.error('[RecoverDOM] Erro no download:', e);
      return { ok: false, error: e.message };
    }
  }

  /**
   * Baixa a mídia mais recente do chat atual
   * Método: encontrar a última mensagem com mídia e tentar baixar
   */
  async function downloadRecentMedia() {
    log('📥 Buscando mídia recente...');

    try {
      const container = findContainer();
      if (!container) throw new Error('Container não encontrado');

      // Buscar todas as mensagens com mídia
      const allMsgs = container.querySelectorAll('[data-testid="msg-container"]');
      
      for (let i = allMsgs.length - 1; i >= 0; i--) {
        const msg = allMsgs[i];
        const mediaEl = findElement(msg, SELECTORS.MEDIA);
        
        if (!mediaEl) continue;

        // Tentar clicar para abrir
        const clickTarget = msg.querySelector('[data-testid="image-thumb"], [data-testid="video-thumb"], img');
        if (clickTarget) {
          clickTarget.click();
          await sleep(800);

          // Procurar botão de download
          const downloadBtn = document.querySelector('[data-testid="media-download"]') ||
                              document.querySelector('span[data-icon="download"]') ||
                              document.querySelector('[aria-label*="Download"]');

          if (downloadBtn) {
            downloadBtn.click();
            log('✅ Download iniciado');

            // Fechar preview depois de um tempo
            setTimeout(() => {
              const closeBtn = document.querySelector('[data-testid="x-viewer"]') ||
                               document.querySelector('span[data-icon="x-viewer"]') ||
                               document.querySelector('span[data-icon="x"]');
              closeBtn?.click();
            }, 1500);

            return { ok: true };
          }

          // Fechar se não encontrou download
          const closeBtn = document.querySelector('[data-testid="x-viewer"]');
          closeBtn?.click();
        }

        // Fallback: tentar extrair URL
        if (mediaEl.src && !mediaEl.src.startsWith('blob:')) {
          window.open(mediaEl.src, '_blank');
          return { ok: true, url: mediaEl.src };
        }
      }

      throw new Error('Nenhuma mídia encontrada para download');
    } catch (e) {
      console.error('[RecoverDOM] Erro:', e);
      return { ok: false, error: e.message };
    }
  }

  // ============================================
  // NOTIFICAÇÕES
  // ============================================

  function notifyRecovery(entry) {
    // Toast visual
    if (window.NotificationsModule?.toast) {
      window.NotificationsModule.toast(
        `🗑️ Mensagem de ${entry.from} recuperada!`,
        'warning',
        4000
      );
    }

    // Enviar para sidepanel
    try {
      chrome.runtime?.sendMessage({
        type: 'WHL_RECOVER_NEW_MESSAGE',
        payload: entry
      }).catch(() => {});
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
  }

  // ============================================
  // OBSERVER E SCAN
  // ============================================

  function startObserver() {
    if (state.observer) {
      state.observer.disconnect();
    }

    const container = findContainer();
    if (!container) {
      log('Container não encontrado, tentando novamente...');
      setTimeout(startObserver, 2000);
      return;
    }

    state.currentChatId = getCurrentChatId();
    log('✅ Iniciando observer para:', state.currentChatId);

    // Cachear mensagens existentes
    scanAndCacheMessages(container);

    state.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Processar nodes adicionados
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          const messages = node.matches?.('[data-testid="msg-container"]')
            ? [node]
            : node.querySelectorAll?.('[data-testid="msg-container"]') || [];

          for (const msg of messages) {
            if (isDeletedMessage(msg)) {
              handleDeletedMessage(msg);
            } else {
              cacheMessage(msg);
            }
          }
        }

        // Verificar alterações em nodes existentes
        if (mutation.type === 'characterData' || mutation.type === 'childList') {
          const target = mutation.target;
          const msgContainer = target.closest?.('[data-testid="msg-container"]');
          
          if (msgContainer && isDeletedMessage(msgContainer)) {
            handleDeletedMessage(msgContainer);
          }
        }
      }
    });

    state.observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Scan periódico para pegar mensagens que possam ter sido perdidas
    if (state.scanInterval) clearInterval(state.scanInterval);
    state.scanInterval = setInterval(() => {
      scanAndCacheMessages(container);
      checkForDeletedMessages(container);
    }, 5000);
  }

  function scanAndCacheMessages(container) {
    const messages = container.querySelectorAll('[data-testid="msg-container"]');
    let cached = 0;

    for (const msg of messages) {
      if (!isDeletedMessage(msg)) {
        const msgKey = generateMsgKey(msg);
        if (!state.messageCache.has(msgKey)) {
          cacheMessage(msg);
          cached++;
        }
      }
    }

    if (cached > 0) {
      log(`Scan: ${cached} novas mensagens cacheadas`);
    }
  }

  function checkForDeletedMessages(container) {
    const messages = container.querySelectorAll('[data-testid="msg-container"]');

    for (const msg of messages) {
      if (isDeletedMessage(msg)) {
        const msgKey = generateMsgKey(msg);
        
        // Verificar se já processamos esta mensagem apagada
        const alreadyProcessed = msg.querySelector('.whl-recovered-marker');
        if (alreadyProcessed) continue;

        // Verificar se temos no histórico (persistência após reload)
        const historyEntry = state.history.find(h => h.key === msgKey);
        if (historyEntry) {
          // Re-injetar marcador do Recover para a mesma mensagem apagada
          try {
            const recoveredText = historyEntry.body || historyEntry.originalBody || (historyEntry.mediaType ? `[mídia: ${historyEntry.mediaType}]` : 'Mensagem apagada');
            injectRecoveredContent(msg, { text: recoveredText });
          } catch (e) {
            console.warn('[RecoverDOM] Falha ao re-injetar marcador:', e);
          }
          continue;
        }

        // Processar (novo item)
        handleDeletedMessage(msg);
      }
    }
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  async function init() {
    if (state.initialized) return;

    log('🔄 Inicializando RecoverDOM v2.0...');

    await loadHistory();

    // Aguardar DOM do WhatsApp
    const waitInterval = setInterval(() => {
      const container = findContainer();
      if (container) {
        clearInterval(waitInterval);
        startObserver();
        state.initialized = true;
        log('✅ RecoverDOM v2.0 inicializado');
        
        // Emitir evento de pronto
        if (window.EventBus?.emit) {
          window.EventBus.emit('recover:ready', { historyCount: state.history.length });
        }
      }
    }, 1000);

    // Timeout
    setTimeout(() => {
      clearInterval(waitInterval);
      if (!state.initialized) {
        log('⚠️ Timeout aguardando WhatsApp');
      }
    }, 30000);

    // Reiniciar observer quando chat muda
    if (chatChangeInterval) clearInterval(chatChangeInterval);
    chatChangeInterval = setInterval(() => {
      const currentChat = getCurrentChatId();
      if (currentChat !== state.currentChatId) {
        log('Chat mudou:', currentChat);
        state.currentChatId = currentChat;
        setTimeout(startObserver, 500);
      }
    }, 2000);
  }

  // ============================================
  // INTEGRAÇÃO COM RecoverAdvanced
  // ============================================

  function syncWithRecoverAdvanced(entry) {
    // Se RecoverAdvanced existe, registrar evento nele também
    if (window.RecoverAdvanced?.registerMessageEvent) {
      try {
        const stateMap = {
          'deleted': 'deleted_local',
          'revoked': 'revoked_global',
          'edited': 'edited'
        };
        
        window.RecoverAdvanced.registerMessageEvent(
          entry.key || entry.id,
          stateMap[entry.action] || 'deleted_local',
          {
            body: entry.body,
            from: entry.from,
            chatId: entry.chatId,
            timestamp: entry.timestamp,
            mediaUrl: entry.mediaUrl,
            mediaType: entry.mediaType
          }
        );
        
        log('✅ Sincronizado com RecoverAdvanced');
      } catch (e) {
        log('⚠️ Erro ao sincronizar com RecoverAdvanced:', e);
      }
    }
  }

  // Sobrescrever addToHistory para sincronizar
  const originalAddToHistory = addToHistory;
  function addToHistoryWithSync(entry) {
    // Evitar duplicatas
    const exists = state.history.some(h => h.key === entry.key && h.action === entry.action);
    if (exists) return;

    state.history.push(entry);
    saveHistory();

    // Sincronizar com RecoverAdvanced
    syncWithRecoverAdvanced(entry);

    // Emitir evento
    if (window.EventBus?.emit) {
      window.EventBus.emit('recover:message_recovered', entry);
    }

    // Sincronizar com wpp-hooks se disponível
    try {
      window.postMessage({
        type: 'WHL_RECOVER_NEW_MESSAGE',
        payload: entry
      }, window.location.origin);
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
  }

  // ============================================
  // API PÚBLICA
  // ============================================

  window.RecoverDOM = {
    // Lifecycle
    init,
    
    // Histórico
    getHistory,
    clearHistory,
    addToHistory: addToHistoryWithSync,
    
    // Download
    downloadFromHistory,
    downloadRecentMedia,
    
    // Cache
    getCachedMessage,
    getCacheSize: () => state.messageCache.size,
    
    // Estado
    isInitialized: () => state.initialized,
    getCurrentChat: () => state.currentChatId,
    
    // Para compatibilidade com módulo antigo
    loadFromStorage: loadHistory
  };

  // Se RecoverAdvanced não existir ou falhou ao inicializar, criar fallback
  setTimeout(() => {
    if (!window.RecoverAdvanced || !window.RecoverAdvanced.getPage) {
      console.log('[RecoverDOM] ⚠️ RecoverAdvanced não disponível, criando fallback...');
      
      window.RecoverAdvanced = {
        init,
        loadFromStorage: loadHistory,
        
        // Métodos de histórico
        getPage: (pageNum = 0, pageSize = 20) => {
          const history = getHistory();
          const start = pageNum * pageSize;
          const end = start + pageSize;
          const messages = history.slice(start, end);
          
          return {
            messages,
            page: pageNum,
            pageSize,
            total: history.length,
            totalPages: Math.ceil(history.length / pageSize),
            hasNext: end < history.length,
            hasPrev: pageNum > 0
          };
        },
        
        nextPage: () => {
          state._currentPage = (state._currentPage || 0) + 1;
          return window.RecoverAdvanced.getPage(state._currentPage);
        },
        
        prevPage: () => {
          state._currentPage = Math.max(0, (state._currentPage || 0) - 1);
          return window.RecoverAdvanced.getPage(state._currentPage);
        },
        
        setFilter: (key, value) => {
          state._filters = state._filters || {};
          state._filters[key] = value;
        },
        
        getFilters: () => state._filters || {},
        
        _favorites: new Set(),
        
        isFavorite: (id) => window.RecoverAdvanced._favorites.has(id),
        
        toggleFavorite: (id) => {
          if (window.RecoverAdvanced._favorites.has(id)) {
            window.RecoverAdvanced._favorites.delete(id);
            return false;
          }
          window.RecoverAdvanced._favorites.add(id);
          return true;
        },
        
        compareEdited: (id) => {
          const msg = getHistory().find(m => (m.id || m.key) === id);
          if (!msg) return null;
          return {
            original: msg.originalText || msg.originalBody || '[original não disponível]',
            edited: msg.body || '[editado não disponível]'
          };
        },
        
        getStats: () => {
          const history = getHistory();
          return {
            total: history.length,
            deleted: history.filter(m => m.action === 'deleted').length,
            edited: history.filter(m => m.action === 'edited').length,
            revoked: history.filter(m => m.action === 'revoked').length,
            recovered: history.filter(m => m.recovered).length
          };
        },
        
        exportToCSV: () => {
          const history = getHistory();
          const headers = ['Data', 'De', 'Para', 'Ação', 'Conteúdo'];
          const rows = history.map(m => [
            new Date(m.timestamp || Date.now()).toLocaleString('pt-BR'),
            m.from || '',
            m.to || m.chatId || '',
            m.action || '',
            (m.body || '').replace(/"/g, '""')
          ]);
          
          const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
          
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `recover_export_${Date.now()}.csv`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        },
        
        exportToTXT: () => {
          const history = getHistory();
          const content = history.map(m => 
            `[${new Date(m.timestamp || Date.now()).toLocaleString('pt-BR')}] ${m.action?.toUpperCase() || 'MSG'}\nDe: ${m.from || '?'}\nConteúdo: ${m.body || '[mídia]'}\n`
          ).join('\n---\n');
          
          const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `recover_export_${Date.now()}.txt`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        },
        
        exportToPDF: () => {
          alert('Exportação PDF não disponível. Use CSV ou TXT.');
        },
        
        registerMessageEvent: (msgId, msgState, msgData) => {
          addToHistoryWithSync({
            id: msgId,
            key: msgId,
            action: msgState === 'deleted_local' ? 'deleted' : msgState === 'revoked_global' ? 'revoked' : 'edited',
            ...msgData,
            timestamp: Date.now()
          });
        },
        
        MESSAGE_STATES: {
          DELETED_LOCAL: 'deleted_local',
          REVOKED_GLOBAL: 'revoked_global',
          EDITED: 'edited'
        },
        
        downloadFromHistory
      };
      
      console.log('[RecoverDOM] ✅ Fallback RecoverAdvanced criado');
    } else {
      console.log('[RecoverDOM] ✅ RecoverAdvanced já existe, usando-o');
    }
  }, 3000); // Aguardar 3 segundos para RecoverAdvanced carregar

  // Cleanup ao descarregar
  window.addEventListener('beforeunload', () => {
    if (state.scanInterval) clearInterval(state.scanInterval);
    if (chatChangeInterval) clearInterval(chatChangeInterval);
    if (state.observer) state.observer.disconnect();
  });

  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2000));
  } else {
    setTimeout(init, 2000);
  }

  console.log('[RecoverDOM] 🔄 Módulo v2.0 carregado');
})();
