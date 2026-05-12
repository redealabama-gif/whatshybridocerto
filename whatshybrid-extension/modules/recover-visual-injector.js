/**
 * Recover Visual Injector - Injetor Visual de Indicadores de Mensagens Recover
 *
 * Injeta visualmente badges/indicadores nas mensagens do WhatsApp para mostrar:
 * - 🗑️ Mensagem DELETADA (deleted locally)
 * - 🔴 Mensagem REVOGADA (revoked by sender)
 * - ✏️ Mensagem EDITADA (edited)
 *
 * NOVO: Persiste indicadores após reload da página usando:
 * - messageVersions do RecoverAdvanced (Map em memória)
 * - chrome.storage.local para persistência entre reloads
 * - Injeção de "quote-like" visual mostrando o conteúdo original
 *
 * @version 2.0.0
 */

(function() {
  'use strict';

  console.log('[RecoverVisualInjector] 🎨 Inicializando v2.0...');

  // Configurações
  const CONFIG = {
    CHECK_INTERVAL: 2000, // Verificar a cada 2 segundos
    BADGE_CLASS: 'whl-recover-badge',
    QUOTE_CLASS: 'whl-recover-quote',
    INJECTED_ATTR: 'data-whl-recover-injected',
    STORAGE_KEY: 'whl_recover_visual_markers',
    MAX_MARKERS: 500
  };

  // Storage para marcadores persistentes
  let persistentMarkers = new Map();

  // Tipos de estados e seus estilos
  const MESSAGE_STATES = {
    DELETED_LOCAL: {
      id: 'deleted_local',
      emoji: '🗑️',
      text: 'Essa mensagem foi apagada',
      color: '#ef4444',
      bgColor: '#fee2e2'
    },
    REVOKED_GLOBAL: {
      id: 'revoked_global',
      emoji: '🔴',
      text: 'Essa mensagem foi apagada',
      color: '#dc2626',
      bgColor: '#fef2f2'
    },
    EDITED: {
      id: 'edited',
      emoji: '✏️',
      text: 'Essa mensagem foi editada',
      color: '#3b82f6',
      bgColor: '#dbeafe'
    }
  };

  // Estado
  let observer = null;
  let initialized = false;
  let checkInterval = null;
  let chatChangeInterval = null;

  // ============================================
  // PERSISTÊNCIA DE MARCADORES
  // ============================================

  /**
   * Carrega marcadores persistentes do storage
   */
  async function loadPersistentMarkers() {
    try {
      const result = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
      if (result[CONFIG.STORAGE_KEY]) {
        const data = result[CONFIG.STORAGE_KEY];
        if (typeof data === 'object') {
          Object.entries(data).forEach(([id, marker]) => {
            persistentMarkers.set(id, marker);
          });
          console.log('[RecoverVisualInjector] ✅ Carregados', persistentMarkers.size, 'marcadores persistentes');
        }
      }
    } catch (e) {
      console.warn('[RecoverVisualInjector] Erro ao carregar marcadores:', e);
    }
  }

  /**
   * Salva marcadores no storage
   */
  async function savePersistentMarkers() {
    try {
      // Converter Map para objeto
      const data = {};
      persistentMarkers.forEach((marker, id) => {
        data[id] = marker;
      });
      
      // Limitar tamanho
      const keys = Object.keys(data);
      if (keys.length > CONFIG.MAX_MARKERS) {
        const toRemove = keys.slice(0, keys.length - CONFIG.MAX_MARKERS);
        toRemove.forEach(k => delete data[k]);
      }
      
      await chrome.storage.local.set({ [CONFIG.STORAGE_KEY]: data });
    } catch (e) {
      console.warn('[RecoverVisualInjector] Erro ao salvar marcadores:', e);
    }
  }

  /**
   * Adiciona um marcador persistente
   */
  function addPersistentMarker(msgId, markerData) {
    persistentMarkers.set(msgId, {
      ...markerData,
      createdAt: Date.now()
    });
    savePersistentMarkers();
  }

  /**
   * Verifica se há um marcador persistente para esta mensagem
   */
  function getPersistentMarker(msgId) {
    return persistentMarkers.get(msgId);
  }

  /**
   * Inicializa o injetor visual
   */
  async function init() {
    if (initialized) return;

    console.log('[RecoverVisualInjector] 🎨 Registrando...');

    // Carregar marcadores persistentes primeiro
    await loadPersistentMarkers();

    // Injetar CSS
    injectCSS();

    // Iniciar observador
    startObserver();

    // Processar mensagens existentes (com atraso para garantir que DOM está pronto)
    setTimeout(processExistingMessages, 500);

    // Verificar periodicamente
    if (checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(processExistingMessages, CONFIG.CHECK_INTERVAL);

    // Também verificar quando a conversa muda
    setupChatChangeListener();

    initialized = true;
    console.log('[RecoverVisualInjector] ✅ Inicializado com', persistentMarkers.size, 'marcadores');

    // Cleanup
    window.addEventListener('beforeunload', () => {
      if (checkInterval) clearInterval(checkInterval);
      if (chatChangeInterval) clearInterval(chatChangeInterval);
      if (observer) observer.disconnect();
    });
  }

  /**
   * Detecta mudanças de chat e reprocessa mensagens
   */
  function setupChatChangeListener() {
    let lastChatId = null;
    
    if (chatChangeInterval) clearInterval(chatChangeInterval);
    chatChangeInterval = setInterval(() => {
      const header = document.querySelector('#main header span[title], [data-testid="conversation-info-header-chat-title"]');
      const currentChatId = header?.getAttribute('title') || header?.textContent;
      
      if (currentChatId && currentChatId !== lastChatId) {
        lastChatId = currentChatId;
        console.log('[RecoverVisualInjector] 🔄 Chat mudou, reprocessando...');
        setTimeout(processExistingMessages, 1000);
      }
    }, 1000);
  }

  /**
   * Injeta CSS para os badges e quote-like visual
   */
  function injectCSS() {
    const style = document.createElement('style');
    style.id = 'whl-recover-visual-styles';
    style.textContent = `
      /* Badge simples */
      .${CONFIG.BADGE_CLASS} {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        margin-top: 6px;
        margin-bottom: 2px;
        border: 1px solid currentColor;
        opacity: 0.9;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      .${CONFIG.BADGE_CLASS}-deleted,
      .${CONFIG.BADGE_CLASS}-deleted-local {
        color: #ef4444;
        background-color: #fee2e2;
        border-color: #fca5a5;
      }

      .${CONFIG.BADGE_CLASS}-revoked,
      .${CONFIG.BADGE_CLASS}-revoked-global {
        color: #dc2626;
        background-color: #fef2f2;
        border-color: #fca5a5;
      }

      .${CONFIG.BADGE_CLASS}-edited {
        color: #3b82f6;
        background-color: #dbeafe;
        border-color: #93c5fd;
      }

      .${CONFIG.BADGE_CLASS}:hover {
        opacity: 1;
      }

      /* Quote-like visual (como resposta do WhatsApp) */
      .${CONFIG.QUOTE_CLASS} {
        display: flex;
        flex-direction: column;
        background: linear-gradient(135deg, rgba(255, 87, 87, 0.1), rgba(255, 87, 87, 0.05));
        border-left: 4px solid #ff5757;
        border-radius: 8px;
        padding: 8px 12px;
        margin: 8px 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        max-width: 100%;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .${CONFIG.QUOTE_CLASS}:hover {
        background: linear-gradient(135deg, rgba(255, 87, 87, 0.15), rgba(255, 87, 87, 0.08));
        transform: translateY(-1px);
        box-shadow: 0 2px 6px rgba(0,0,0,0.15);
      }

      .${CONFIG.QUOTE_CLASS}-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 600;
        color: #ff5757;
        margin-bottom: 4px;
      }

      .${CONFIG.QUOTE_CLASS}-icon {
        font-size: 14px;
      }

      .${CONFIG.QUOTE_CLASS}-content {
        font-size: 13px;
        color: rgba(255, 255, 255, 0.85);
        line-height: 1.4;
        word-break: break-word;
        max-height: 60px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .${CONFIG.QUOTE_CLASS}-footer {
        font-size: 10px;
        color: rgba(255, 255, 255, 0.5);
        margin-top: 4px;
        font-style: italic;
      }

      /* Variação para editadas */
      .${CONFIG.QUOTE_CLASS}-edited {
        border-left-color: #3b82f6;
        background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(59, 130, 246, 0.05));
      }

      .${CONFIG.QUOTE_CLASS}-edited:hover {
        background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(59, 130, 246, 0.08));
      }

      .${CONFIG.QUOTE_CLASS}-edited .${CONFIG.QUOTE_CLASS}-header {
        color: #3b82f6;
      }

      /* Container da mensagem com indicador */
      [data-whl-recover-injected="true"] {
        position: relative;
      }

      /* Tema claro */
      @media (prefers-color-scheme: light) {
        .${CONFIG.QUOTE_CLASS}-content {
          color: rgba(0, 0, 0, 0.75);
        }
        .${CONFIG.QUOTE_CLASS}-footer {
          color: rgba(0, 0, 0, 0.5);
        }
      }
    `;

    if (!document.getElementById('whl-recover-visual-styles')) {
      document.head.appendChild(style);
      console.log('[RecoverVisualInjector] 🎨 CSS injetado');
    }
  }

  /**
   * Inicia MutationObserver para detectar novas mensagens
   */
  function startObserver() {
    // Observar mudanças no container de mensagens
    const chatContainer = document.querySelector('#main') || document.body;

    if (observer) {
      observer.disconnect();
    }

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          // Processar novas mensagens
          setTimeout(processExistingMessages, 100);
          break;
        }
      }
    });

    observer.observe(chatContainer, {
      childList: true,
      subtree: true
    });

    console.log('[RecoverVisualInjector] 👁️ MutationObserver ativo');
  }

  /**
   * Processa todas as mensagens existentes no chat
   */
  function processExistingMessages() {
    // Seletores para mensagens do WhatsApp
    const messageSelectors = [
      '[data-testid="msg-container"]',
      '[data-id]',
      '.message-in, .message-out'
    ];

    for (const selector of messageSelectors) {
      const messages = document.querySelectorAll(selector);

      if (messages.length > 0) {
        // DEBUG: console.log(`[RecoverVisualInjector] 🔍 Processando ${messages.length} mensagens (${selector})`);

        for (const msgEl of messages) {
          processMessage(msgEl);
        }

        break; // Usar apenas o primeiro seletor que encontrar mensagens
      }
    }
  }

  /**
   * Processa uma mensagem individual
   * @param {HTMLElement} msgEl - Elemento da mensagem
   */
  function processMessage(msgEl) {
    // Verificar se já foi processado
    if (msgEl.getAttribute(CONFIG.INJECTED_ATTR)) {
      return;
    }

    // Tentar extrair ID da mensagem
    const msgId = extractMessageId(msgEl);
    if (!msgId) {
      return;
    }

    let lastEvent = null;
    let state = null;
    let originalContent = null;

    // Fonte 1: Verificar marcadores persistentes (prioridade - funciona após reload)
    const persistentMarker = getPersistentMarker(msgId);
    if (persistentMarker) {
      state = persistentMarker.state;
      lastEvent = persistentMarker;
      originalContent = persistentMarker.originalContent;
      console.log('[RecoverVisualInjector] 📍 Marcador persistente encontrado:', msgId, state);
    }

    // Fonte 2: Verificar no RecoverAdvanced se há histórico dessa mensagem
    if (!state && window.RecoverAdvanced?.messageVersions) {
      const messageHistory = window.RecoverAdvanced.messageVersions.get(msgId);
      if (messageHistory && messageHistory.history && messageHistory.history.length > 0) {
        lastEvent = messageHistory.history[messageHistory.history.length - 1];
        state = lastEvent.state;
        originalContent = lastEvent.body || lastEvent.previousBody;
        
        // Salvar como marcador persistente para próximos reloads
        addPersistentMarker(msgId, {
          state: state,
          originalContent: originalContent,
          timestamp: lastEvent.timestamp,
          chatId: messageHistory.chatId,
          from: messageHistory.from
        });
      }
    }

    // Fonte 3: Verificar se o elemento contém texto de mensagem apagada
    if (!state) {
      const msgText = msgEl.textContent || '';
      if (msgText.includes('Esta mensagem foi apagada') || 
          msgText.includes('This message was deleted') ||
          msgEl.querySelector('[data-testid="recalled-msg"]') ||
          msgEl.querySelector('span[data-icon="recalled"]')) {
        state = 'revoked_global';
        
        // Tentar encontrar conteúdo original no RecoverDOM
        if (window.RecoverDOM?.getHistory) {
          const history = window.RecoverDOM.getHistory();
          const match = history.find(h => h.key === msgId || h.id === msgId);
          if (match) {
            originalContent = match.body || match.originalBody;
          }
        }
        
        // Salvar marcador persistente
        if (!persistentMarker) {
          addPersistentMarker(msgId, {
            state: state,
            originalContent: originalContent || null,
            timestamp: Date.now()
          });
        }
      }
    }

    if (!state) {
      return;
    }

    // Determinar qual badge mostrar
    let badgeConfig = null;
    if (state === 'deleted_local') {
      badgeConfig = MESSAGE_STATES.DELETED_LOCAL;
    } else if (state === 'revoked_global') {
      badgeConfig = MESSAGE_STATES.REVOKED_GLOBAL;
    } else if (state === 'edited') {
      badgeConfig = MESSAGE_STATES.EDITED;
    }

    if (!badgeConfig) {
      return;
    }

    // Injetar quote visual
    injectQuoteVisual(msgEl, badgeConfig, lastEvent || { originalContent, state });

    // Marcar como processado
    msgEl.setAttribute(CONFIG.INJECTED_ATTR, 'true');
  }

  /**
   * Extrai o ID da mensagem do elemento DOM
   * @param {HTMLElement} msgEl - Elemento da mensagem
   * @returns {string|null} ID da mensagem
   */
  function extractMessageId(msgEl) {
    // Método 1: data-id
    const dataId = msgEl.getAttribute('data-id');
    if (dataId) {
      // Extrair apenas o ID sem prefixos
      const match = dataId.match(/[A-F0-9]{16,}/);
      return match ? match[0] : dataId;
    }

    // Método 2: data-testid contém ID
    const testId = msgEl.getAttribute('data-testid');
    if (testId && testId.includes('msg-')) {
      return testId.replace('msg-', '');
    }

    // Método 3: Procurar em atributos do elemento pai
    const parent = msgEl.closest('[data-id]');
    if (parent) {
      const parentId = parent.getAttribute('data-id');
      const match = parentId.match(/[A-F0-9]{16,}/);
      return match ? match[0] : null;
    }

    return null;
  }

  /**
   * Injeta quote visual (como resposta do WhatsApp) na mensagem
   * @param {HTMLElement} msgEl - Elemento da mensagem
   * @param {Object} config - Configuração do badge
   * @param {Object} event - Evento do histórico
   */
  function injectQuoteVisual(msgEl, config, event) {
    // Procurar container apropriado para inserir o quote
    const msgContainer = msgEl.closest('[data-testid="msg-container"]') || msgEl;
    
    // Verificar se já existe um quote injetado
    if (msgContainer.querySelector(`.${CONFIG.QUOTE_CLASS}`)) {
      return;
    }

    // Obter conteúdo original
    const originalContent = event.originalContent || event.body || event.previousBody || null;
    const timestamp = event.timestamp ? new Date(event.timestamp).toLocaleString('pt-BR') : '';

    // Criar quote visual
    const quote = document.createElement('div');
    const isEdited = config.id === 'edited';
    quote.className = `${CONFIG.QUOTE_CLASS}${isEdited ? ` ${CONFIG.QUOTE_CLASS}-edited` : ''}`;
    
    // Conteúdo do quote
    let contentHtml = '';
    if (originalContent) {
      // Escapar HTML e truncar
      const escaped = escapeHtml(originalContent);
      const truncated = escaped.length > 150 ? escaped.substring(0, 150) + '...' : escaped;
      contentHtml = `<div class="${CONFIG.QUOTE_CLASS}-content">${truncated}</div>`;
    }
    
    quote.innerHTML = `
      <div class="${CONFIG.QUOTE_CLASS}-header">
        <span class="${CONFIG.QUOTE_CLASS}-icon">${config.emoji}</span>
        <span>${config.text}</span>
      </div>
      ${contentHtml}
      ${timestamp ? `<div class="${CONFIG.QUOTE_CLASS}-footer">Capturado em ${timestamp}</div>` : ''}
    `;

    // Adicionar tooltip com conteúdo completo
    if (originalContent && originalContent.length > 150) {
      quote.title = `Conteúdo completo: ${originalContent}`;
    }

    // Encontrar onde inserir o quote (antes do texto da mensagem)
    const textContainer = msgContainer.querySelector('[data-testid="msg-text"]') ||
                          msgContainer.querySelector('.copyable-text') ||
                          msgContainer.querySelector('.selectable-text');
    
    if (textContainer && textContainer.parentElement) {
      textContainer.parentElement.insertBefore(quote, textContainer);
    } else {
      // Fallback: inserir no início do container
      msgContainer.insertBefore(quote, msgContainer.firstChild);
    }

    // Adicionar visual de destaque ao container
    msgContainer.style.background = isEdited 
      ? 'rgba(59, 130, 246, 0.05)' 
      : 'rgba(255, 87, 87, 0.05)';
    msgContainer.style.borderRadius = '8px';

    console.log(`[RecoverVisualInjector] ✅ Quote injetado: ${config.emoji} ${config.text}`);
  }

  /**
   * Escapa HTML para evitar XSS
   */
  function escapeHtml(text) {
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(text);
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  /**
   * Mantém função injectBadge para compatibilidade
   * @deprecated Use injectQuoteVisual instead
   */
  function injectBadge(msgEl, config, event) {
    injectQuoteVisual(msgEl, config, event);
  }

  /**
   * API pública
   */
  window.RecoverVisualInjector = {
    init,
    processExistingMessages,
    MESSAGE_STATES,
    
    // Persistência
    loadPersistentMarkers,
    savePersistentMarkers,
    addPersistentMarker,
    getPersistentMarker,
    getMarkersCount: () => persistentMarkers.size,
    
    // Limpeza
    clearMarkers: async () => {
      persistentMarkers.clear();
      await chrome.storage.local.remove(CONFIG.STORAGE_KEY);
      console.log('[RecoverVisualInjector] 🧹 Marcadores limpos');
    },
    
    // Forçar reprocessamento
    reprocess: () => {
      // Remover atributos de processamento
      document.querySelectorAll(`[${CONFIG.INJECTED_ATTR}]`).forEach(el => {
        el.removeAttribute(CONFIG.INJECTED_ATTR);
        // Remover quotes existentes
        el.querySelectorAll(`.${CONFIG.QUOTE_CLASS}`).forEach(q => q.remove());
      });
      // Reprocessar
      processExistingMessages();
    }
  };

  // Auto-inicializar quando RecoverAdvanced estiver pronto
  function tryInit() {
    if (window.RecoverAdvanced?.messageVersions) {
      init();
    } else {
      console.log('[RecoverVisualInjector] ⏳ Aguardando RecoverAdvanced...');
      setTimeout(tryInit, 1000);
    }
  }

  // Aguardar DOM estar pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    setTimeout(tryInit, 1000);
  }

})();

console.log('[RecoverVisualInjector] 📦 Módulo carregado');
