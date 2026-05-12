/**
 * WhatsHybrid SelectorEngine v1.0.0
 * Engine de seletores resiliente com múltiplos fallbacks e cache
 * 
 * O WhatsApp Web muda frequentemente seus seletores.
 * Esta engine tenta múltiplos seletores em ordem até encontrar um que funcione.
 */
(function() {
  'use strict';

  // Observers criados via SelectorEngine.observe() (para cleanup automático)
  const activeObservers = new Set();
  let cleanupListenerRegistered = false;

  // ============================================
  // CONFIGURAÇÃO
  // ============================================
  const CONFIG = {
    cacheDuration: 60000,      // 1 minuto de cache
    defaultTimeout: 10000,     // 10 segundos de timeout
    defaultInterval: 100,      // 100ms entre tentativas
    enableLogging: false,
    maxRetries: 3
  };

  // ============================================
  // SELETORES COM MÚLTIPLOS FALLBACKS
  //
  // Ordem dentro de cada array = preferência. Convenção (após refactor
  // v9.5.9 para WA 2.3000.x):
  //   1. ID/âncoras estruturais  (#main, #pane-side, #side, #app)
  //   2. aria-label / role       (semântica, sobrevive ofuscação CSS)
  //   3. span[data-icon=…]       (icones ainda usam essa convenção)
  //   4. data-lexical-editor /   (composer atual)
  //      [contenteditable] +
  //      role=textbox
  //   5. data-id em mensagens    (sobrevive rebuild de classes)
  //   6. data-testid (LEGACY)    (a maioria morreu; mantemos como último
  //                               fallback para builds 2.2000.x)
  // ============================================
  const SELECTORS = {
    // ===== HEADER DO CHAT =====
    chatHeader: [
      '#main header',
      '#main > div > header',
      'header[role="banner"]',
      '.copyable-area header',
      // legacy
      'header[data-testid="conversation-header"]',
      '[data-testid="conversation-info-header"]',
    ],

    // ===== TÍTULO DO CHAT (nome do contato/grupo) =====
    chatTitle: [
      '#main header span[title]',
      '#main header span[dir="auto"][title]',
      'header span[dir="auto"][title]',
      // legacy
      '[data-testid="conversation-info-header-chat-title"]',
      'header[data-testid="conversation-header"] span[title]',
      '.copyable-area header span[title]',
      'header ._amig span'
    ],

    // ===== INPUT DE MENSAGEM (composer) =====
    // WA 2.3000.x usa lexical editor; data-tab era da era 2.2000.x.
    messageInput: [
      'footer div[contenteditable="true"][role="textbox"]',
      'footer div[contenteditable="true"][data-lexical-editor="true"]',
      '[data-lexical-editor="true"][contenteditable="true"]',
      '#main footer [contenteditable="true"]',
      'footer [contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]',
      '.copyable-text.selectable-text[contenteditable="true"]',
      // legacy
      '[data-testid="conversation-compose-box-input"]',
      '[contenteditable="true"][data-tab="10"]',
      '[contenteditable="true"][data-tab="6"]',
      '[contenteditable="true"][data-tab="1"]',
    ],

    // ===== BOTÃO DE ENVIAR =====
    sendButton: [
      'span[data-icon="send"]',
      'span[data-icon="wds-ic-send-filled"]',
      'footer button[aria-label*="Enviar" i]',
      'footer button[aria-label*="Send" i]',
      // legacy
      '[data-testid="send"]',
      'footer button[data-tab="11"]',
      'button[data-testid="compose-btn-send"]',
      '.copyable-area button[aria-label*="Enviar"]'
    ],

    // ===== LISTA DE CHATS =====
    chatList: [
      '#pane-side',
      '[aria-label="Lista de conversas"]',
      '[aria-label="Chat list"]',
      'div[aria-label*="conversa" i]',
      // legacy
      '[data-testid="chat-list"]',
      'div#pane-side > div > div > div',
      '[data-testid="chatlist"]'
    ],

    // ===== ITEM DE CHAT INDIVIDUAL =====
    chatItem: [
      '#pane-side [role="listitem"]',
      'div[role="listitem"]',
      // legacy
      '[data-testid="cell-frame-container"]',
      '[data-testid="list-item-content"]',
      '[data-testid="chat-list"] > div > div'
    ],

    // ===== CONTAINER DE MENSAGENS =====
    messageContainer: [
      '#main [data-id]',
      '#main [role="row"]',
      'div[data-id]',
      'div[data-message-id]',
      'div[data-msg-id]',
      'div[role="row"]',
      '.copyable-text',
      // legacy class-based (offuscado em 2.3000.x mas pode reaparecer)
      'div.message-in',
      'div.message-out',
    ],

    // ===== MENSAGEM RECEBIDA =====
    messageIn: [
      // WA 2.3000.x: ofuscou as classes; usar atributo data-id + ARIA
      '#main [role="row"]:not([data-pre-plain-text=""])',
      '[data-id^="false_"]',
      '.message-in',
      // legacy
      'div[data-testid="msg-container"].message-in',
      '[data-testid="conversation-panel-messages"] .message-in'
    ],

    // ===== MENSAGEM ENVIADA =====
    messageOut: [
      '[data-id^="true_"]',
      '.message-out',
      // legacy
      'div[data-testid="msg-container"].message-out',
      '[data-testid="conversation-panel-messages"] .message-out'
    ],

    // ===== TEXTO DA MENSAGEM =====
    messageText: [
      'span.selectable-text',
      'div.copyable-text',
      'span[dir="ltr"]',
      'span[dir="auto"]',
      '.selectable-text.copyable-text span'
    ],

    // ===== CAMPO DE BUSCA =====
    searchInput: [
      '#side [contenteditable="true"]',
      '#side [role="textbox"]',
      'div[role="textbox"][title*="Pesquis" i]',
      'div[role="textbox"][title*="Search" i]',
      // legacy
      '[data-testid="chat-list-search"]',
      '[data-testid="search-input"]',
      '[contenteditable="true"][data-tab="3"]',
      'div[role="textbox"][data-tab="3"]',
    ],

    // ===== PAINEL PRINCIPAL =====
    mainPanel: [
      '#main',
      // legacy
      '[data-testid="conversation-panel-wrapper"]',
      '.two._aigs',
      '[data-testid="conversation-panel"]'
    ],

    // ===== SIDEBAR =====
    sidebar: [
      '#side',
      'div#pane-side',
      // legacy
      '[data-testid="pane-side"]',
      '.app-wrapper-web .two > div:first-child'
    ],

    // ===== APP WRAPPER (verificar se WhatsApp carregou) =====
    appWrapper: [
      '#app',
      '.app-wrapper .app',
      '#app .app',
      '.app-wrapper-web',
      // legacy
      '[data-testid="wa-web-app"]'
    ],

    // ===== BOTÃO DE ANEXAR =====
    attachButton: [
      'span[data-icon="plus"]',
      'span[data-icon="attach-menu-plus"]',
      'span[data-icon="clip"]',
      'footer button[aria-label*="Anexar" i]',
      'footer button[aria-label*="Attach" i]',
      // legacy
      '[data-testid="attach-menu-plus"]',
      'footer button[data-testid="compose-btn-attach"]'
    ],

    // ===== BOTÃO DE EMOJI =====
    emojiButton: [
      'span[data-icon="smiley"]',
      'span[data-icon="smiley-blank"]',
      'footer button[aria-label*="Emoji" i]',
      'footer button[aria-label*="emoji" i]',
      // legacy
      '[data-testid="compose-btn-emoji"]',
    ],

    // ===== BOTÃO DE ÁUDIO =====
    audioButton: [
      'span[data-icon="ptt"]',
      'span[data-icon="ptt-button"]',
      'footer button[aria-label*="Gravar" i]',
      'footer button[aria-label*="Record" i]',
      // legacy
      '[data-testid="ptt-button"]',
      'footer button[data-testid="ptt"]',
    ],

    // ===== PAINEL DE CONVERSAÇÃO =====
    conversationPanel: [
      '#main [role="application"]',
      '#main .copyable-area',
      '.copyable-area > div[tabindex="-1"]',
      // legacy
      '[data-testid="conversation-panel-messages"]',
    ],

    // ===== HORÁRIO DA MENSAGEM =====
    messageTime: [
      '.copyable-text span[dir="auto"]:last-child',
      '.message-time',
      // legacy
      '[data-testid="msg-time"]',
      'span._amk6',
    ],

    // ===== STATUS DE ENTREGA =====
    messageStatus: [
      'span[data-icon="msg-dblcheck"]',
      'span[data-icon="msg-check"]',
      'span[data-icon="msg-time"]',
      // legacy
      '[data-testid="msg-dblcheck"]',
      '[data-testid="msg-check"]',
    ],

    // ===== MENU DE CONTEXTO =====
    contextMenu: [
      'div[role="application"] > span > div',
      '.context-menu',
      // legacy
      '[data-testid="context-menu"]',
    ],

    // ===== FOTO DE PERFIL =====
    profilePicture: [
      '#main header img[draggable="false"]',
      'header img[draggable="false"]',
      '.avatar-image img',
      // legacy
      'img[data-testid="image-avatar"]',
      'img[data-testid="user-avatar"]',
    ],

    // ===== INDICADOR DE DIGITANDO =====
    typingIndicator: [
      'span[data-icon="typing"]',
      '.typing-indicator',
      // legacy
      '[data-testid="typing"]',
    ],

    // ===== BOTÃO DE MENU (3 pontos) =====
    menuButton: [
      'span[data-icon="menu"]',
      'header button[aria-label*="Menu" i]',
      // legacy
      '[data-testid="menu"]',
    ]
  };

  // ============================================
  // CACHE DE SELETORES
  // ============================================
  const selectorCache = new Map();

  function getCached(key) {
    const cached = selectorCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.ts > CONFIG.cacheDuration) {
      selectorCache.delete(key);
      return null;
    }
    return cached.selector;
  }

  function setCache(key, selector) {
    selectorCache.set(key, { selector, ts: Date.now() });
  }

  function clearCache(key = null) {
    if (key) {
      selectorCache.delete(key);
    } else {
      selectorCache.clear();
    }
  }

  // ============================================
  // LOGGING
  // ============================================
  function log(...args) {
    if (CONFIG.enableLogging) {
      console.log('[SelectorEngine]', ...args);
    }
  }

  function warn(...args) {
    console.warn('[SelectorEngine]', ...args);
  }

  // ============================================
  // CORE: ENCONTRAR ELEMENTO
  // ============================================
  
  /**
   * Encontra um elemento usando múltiplos seletores
   * @param {string} key - Chave do seletor (ex: 'messageInput')
   * @param {Element} context - Contexto para busca (default: document)
   * @returns {Element|null}
   */
  function find(key, context = document) {
    const selectors = SELECTORS[key];
    if (!selectors) {
      warn(`Chave desconhecida: ${key}`);
      return null;
    }

    // Verificar cache primeiro
    const cached = getCached(key);
    if (cached) {
      try {
        const el = context.querySelector(cached);
        if (el) {
          log(`Cache hit para "${key}"`);
          return el;
        }
      } catch (_) {
        // Seletor inválido no cache
      }
      clearCache(key);
    }

    // Tentar cada seletor
    for (const selector of selectors) {
      try {
        const el = context.querySelector(selector);
        if (el) {
          setCache(key, selector);
          log(`Encontrado "${key}" com seletor: ${selector}`);
          return el;
        }
      } catch (_) {
        // Seletor inválido, continuar
      }
    }

    log(`Não encontrado: "${key}"`);
    return null;
  }

  /**
   * Encontra múltiplos elementos usando múltiplos seletores
   * @param {string} key - Chave do seletor
   * @param {Element} context - Contexto para busca
   * @returns {Element[]}
   */
  function findAll(key, context = document) {
    const selectors = SELECTORS[key];
    if (!selectors) {
      warn(`Chave desconhecida: ${key}`);
      return [];
    }

    // Verificar cache
    const cached = getCached(key);
    if (cached) {
      try {
        const els = context.querySelectorAll(cached);
        if (els && els.length) {
          log(`Cache hit para "${key}" (${els.length} elementos)`);
          return Array.from(els);
        }
      } catch (_) {
        // ignore
      }
      clearCache(key);
    }

    // Tentar cada seletor
    for (const selector of selectors) {
      try {
        const els = context.querySelectorAll(selector);
        if (els && els.length) {
          setCache(key, selector);
          log(`Encontrados ${els.length} "${key}" com seletor: ${selector}`);
          return Array.from(els);
        }
      } catch (_) {
        // ignore
      }
    }

    return [];
  }

  /**
   * Aguarda até que um elemento seja encontrado
   * @param {string} key - Chave do seletor
   * @param {Object} options - Opções
   * @returns {Promise<Element|Element[]>}
   */
  function waitFor(key, options = {}) {
    const {
      timeout = CONFIG.defaultTimeout,
      interval = CONFIG.defaultInterval,
      context = document,
      multiple = false
    } = options;

    return new Promise((resolve, reject) => {
      const start = Date.now();

      const tick = () => {
        const result = multiple ? findAll(key, context) : find(key, context);
        const found = Array.isArray(result) ? result.length > 0 : !!result;

        if (found) {
          log(`waitFor "${key}" resolvido em ${Date.now() - start}ms`);
          resolve(result);
          return;
        }

        if (Date.now() - start > timeout) {
          reject(new Error(`Timeout esperando por "${key}" após ${timeout}ms`));
          return;
        }

        setTimeout(tick, interval);
      };

      tick();
    });
  }

  /**
   * Observa mudanças em um elemento
   * @param {string} key - Chave do seletor
   * @param {Function} callback - Função a ser chamada nas mutações
   * @param {Object} options - Opções do MutationObserver
   * @returns {MutationObserver|null}
   */
  function observe(key, callback, options = {}) {
    const el = find(key);
    if (!el) {
      warn(`Elemento não encontrado para observar: ${key}`);
      return null;
    }

    const observer = new MutationObserver((mutations) => {
      try {
        callback(mutations, el);
      } catch (e) {
        console.error('[SelectorEngine] Erro no observe callback:', e);
      }
    });

    // Track + garantir remoção do set ao desconectar
    try {
      const originalDisconnect = observer.disconnect.bind(observer);
      observer.disconnect = () => {
        activeObservers.delete(observer);
        return originalDisconnect();
      };
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    activeObservers.add(observer);

    observer.observe(el, {
      childList: true,
      subtree: true,
      attributes: !!options.attributes,
      characterData: !!options.characterData,
      ...options
    });

    log(`Observer iniciado para "${key}"`);

    if (!cleanupListenerRegistered) {
      window.addEventListener('beforeunload', () => {
        activeObservers.forEach(obs => {
          try { obs.disconnect(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
        });
        activeObservers.clear();
      });
      cleanupListenerRegistered = true;
    }

    return observer;
  }

  // ============================================
  // GERENCIAMENTO DE SELETORES CUSTOMIZADOS
  // ============================================

  /**
   * Adiciona novos seletores para uma chave
   * @param {string} key - Chave do seletor
   * @param {string|string[]} selectors - Seletores a adicionar
   */
  function addSelectors(key, selectors) {
    SELECTORS[key] = Array.isArray(selectors) ? selectors : [selectors];
    clearCache(key);
    log(`Seletores definidos para "${key}"`);
  }

  /**
   * Adiciona seletores no início da lista (maior prioridade)
   * @param {string} key - Chave do seletor
   * @param {string|string[]} selectors - Seletores a adicionar
   */
  function prependSelectors(key, selectors) {
    const current = SELECTORS[key] || [];
    const toAdd = Array.isArray(selectors) ? selectors : [selectors];
    SELECTORS[key] = [...toAdd, ...current];
    clearCache(key);
    log(`Seletores prepended para "${key}"`);
  }

  /**
   * Adiciona seletores no final da lista (menor prioridade)
   * @param {string} key - Chave do seletor
   * @param {string|string[]} selectors - Seletores a adicionar
   */
  function appendSelectors(key, selectors) {
    const current = SELECTORS[key] || [];
    const toAdd = Array.isArray(selectors) ? selectors : [selectors];
    SELECTORS[key] = [...current, ...toAdd];
    // Não limpa cache pois novos seletores são fallback
  }

  // ============================================
  // HELPERS
  // ============================================

  /**
   * Obtém informações do chat ativo
   * @returns {Object|null}
   */
  function getActiveChat() {
    const header = find('chatHeader');
    if (!header) return null;

    const titleEl = find('chatTitle', header) || find('chatTitle');
    const title = titleEl?.textContent?.trim() || null;
    const phone = titleEl?.getAttribute('title') || null;

    return {
      element: header,
      title,
      phone: phone || title,
      isGroup: !!(phone && (phone.includes('@g.us') || phone.includes('participantes')))
    };
  }

  /**
   * Verifica se o WhatsApp Web está pronto
   * @returns {boolean}
   */
  function isWhatsAppReady() {
    return !!(find('sidebar') && find('chatList'));
  }

  /**
   * Aguarda o WhatsApp Web carregar completamente
   * @param {number} timeout - Timeout em ms
   * @returns {Promise<boolean>}
   */
  async function waitForWhatsApp(timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (isWhatsAppReady()) {
        log('WhatsApp Web pronto!');
        return true;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Timeout esperando WhatsApp carregar');
  }

  /**
   * Testa todos os seletores e retorna relatório
   * @returns {Object}
   */
  function testSelectors() {
    const results = {};
    for (const [key, selectors] of Object.entries(SELECTORS)) {
      results[key] = {
        found: false,
        workingSelector: null,
        testedCount: selectors.length,
        failedSelectors: []
      };

      for (const selector of selectors) {
        try {
          const el = document.querySelector(selector);
          if (el) {
            results[key].found = true;
            results[key].workingSelector = selector;
            break;
          } else {
            results[key].failedSelectors.push(selector);
          }
        } catch (_) {
          results[key].failedSelectors.push(`${selector} (INVÁLIDO)`);
        }
      }
    }
    return results;
  }

  /**
   * Retorna todos os seletores configurados
   * @returns {Object}
   */
  function getSelectors() {
    return { ...SELECTORS };
  }

  /**
   * Diagnóstico completo do SelectorEngine
   * @returns {Object}
   */
  function diagnose() {
    const test = testSelectors();
    const found = Object.values(test).filter(r => r.found).length;
    const total = Object.keys(test).length;

    return {
      summary: `${found}/${total} seletores funcionando`,
      percentage: Math.round((found / total) * 100),
      cacheSize: selectorCache.size,
      isWhatsAppReady: isWhatsAppReady(),
      details: test
    };
  }

  // ============================================
  // AÇÕES COMUNS
  // ============================================

  /**
   * Insere texto no campo de mensagem
   * @param {string} text - Texto a inserir
   * @returns {boolean}
   */
  function insertText(text) {
    const input = find('messageInput');
    if (!input) {
      warn('Input de mensagem não encontrado');
      return false;
    }

    input.focus();
    
    // Limpar texto existente
    input.textContent = '';
    
    // Usar execCommand para compatibilidade com React
    document.execCommand('insertText', false, text);
    
    // Disparar eventos para React processar
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    
    return true;
  }

  /**
   * Clica no botão de enviar
   * @returns {boolean}
   */
  function clickSend() {
    const sendBtn = find('sendButton');
    if (sendBtn) {
      sendBtn.click();
      return true;
    }

    // Fallback: Enter no input
    const input = find('messageInput');
    if (input) {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true
      }));
      return true;
    }

    return false;
  }

  /**
   * Envia uma mensagem completa
   * @param {string} text - Texto a enviar
   * @returns {Promise<boolean>}
   */
  async function sendMessage(text) {
    if (!insertText(text)) return false;
    
    // Aguardar React processar
    await new Promise(r => setTimeout(r, 100));
    
    return clickSend();
  }

  // ============================================
  // SECURITY HELPERS
  // ============================================

  /**
   * SECURITY FIX P0-026: Sanitize objects to prevent Prototype Pollution
   */
  function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj;
    }

    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const sanitized = {};

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (dangerousKeys.includes(key)) {
          console.warn('[SelectorEngine Security] Blocked prototype pollution attempt:', key);
          continue;
        }

        if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
          sanitized[key] = sanitizeObject(obj[key]);
        } else {
          sanitized[key] = obj[key];
        }
      }
    }

    return sanitized;
  }

  // ============================================
  // CONFIGURAÇÃO
  // ============================================

  /**
   * Atualiza configurações
   * @param {Object} newConfig - Novas configurações
   */
  function setConfig(newConfig) {
    // SECURITY FIX P0-026: Sanitize config to prevent Prototype Pollution
    const sanitized = sanitizeObject(newConfig);
    Object.assign(CONFIG, sanitized);

    if (sanitized.cacheDuration !== undefined) {
      clearCache(); // Limpar cache se duração mudou
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  const api = {
    // Core
    find,
    findAll,
    waitFor,
    observe,

    // Gerenciamento de seletores
    addSelectors,
    prependSelectors,
    appendSelectors,
    getSelectors,

    // Cache
    clearCache,

    // Helpers
    getActiveChat,
    isWhatsAppReady,
    waitForWhatsApp,

    // Ações
    insertText,
    clickSend,
    sendMessage,

    // Debug
    testSelectors,
    diagnose,

    // Configuração
    setConfig,

    // Constantes
    SELECTORS
  };

  // Expor globalmente
  window.SelectorEngine = api;

  // Log de inicialização
  console.log('[SelectorEngine] ✅ Inicializado com', Object.keys(SELECTORS).length, 'grupos de seletores');

})();
