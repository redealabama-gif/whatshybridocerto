/**
 * 🛡️ Anti-Break System v1.0
 * Arquitetura anti-quebra para estabilidade máxima
 * 
 * Funcionalidades:
 * - Atualização automática de seletores
 * - Detecção de mudanças na API interna do WhatsApp
 * - Self-healing de módulos
 * - Fallbacks inteligentes
 * - Relatório de problemas para admin
 * 
 * @version 1.0.0
 */
(function() {
  'use strict';

  let healthCheckInterval = null;
  let autoHealInterval = null;
  const activeObservers = new Set();

  // ============================================
  // SELETORES COM MÚLTIPLOS FALLBACKS
  // ============================================

  const SELECTORS = {
    // Container principal do chat
    MAIN_CHAT: {
      primary: 'div[data-tab="1"]',
      fallbacks: [
        '#main',
        'div[role="main"]',
        'div._1hI5g',
        'div.two._1jJ70'
      ],
      description: 'Container principal do chat'
    },

    // Campo de entrada de texto
    MESSAGE_INPUT: {
      primary: 'div[contenteditable="true"][data-tab="10"]',
      fallbacks: [
        'div[contenteditable="true"][data-tab="6"]',
        'footer div[contenteditable="true"]',
        'div[role="textbox"]',
        '.copyable-text.selectable-text',
        'div._1awRl'
      ],
      description: 'Campo de digitação de mensagem'
    },

    // Botão de enviar
    SEND_BUTTON: {
      primary: 'button[data-tab="11"]',
      fallbacks: [
        'span[data-icon="send"]',
        'button[aria-label*="Enviar"]',
        'button[aria-label*="Send"]',
        'button._1U1xa'
      ],
      description: 'Botão de enviar mensagem'
    },

    // Lista de contatos/chats
    CHAT_LIST: {
      primary: 'div[aria-label="Lista de conversas"]',
      fallbacks: [
        '#pane-side',
        'div[role="listitem"]',
        'div._1IlAS',
        'div.infinite-list-viewport'
      ],
      description: 'Lista de conversas'
    },

    // Item de chat individual
    CHAT_ITEM: {
      primary: 'div[data-id]',
      fallbacks: [
        'div[data-testid="cell-frame-container"]',
        'div._199zF',
        'div[role="row"]'
      ],
      description: 'Item de conversa na lista'
    },

    // Container de mensagens
    MESSAGE_LIST: {
      primary: 'div[data-tab="8"]',
      fallbacks: [
        'div.message-list',
        'div._1_keJ',
        'div[role="application"] > div > div'
      ],
      description: 'Lista de mensagens do chat'
    },

    // Mensagem individual
    MESSAGE_ITEM: {
      primary: 'div[data-id^="true_"] , div[data-id^="false_"]',
      fallbacks: [
        'div.message-in, div.message-out',
        'div[class*="message"]',
        'div._1gux_'
      ],
      description: 'Mensagem individual'
    },

    // Header do chat
    CHAT_HEADER: {
      primary: 'header',
      fallbacks: [
        'div[data-testid="conversation-header"]',
        'div._2au8k',
        '#main header'
      ],
      description: 'Header da conversa atual'
    },

    // Nome do contato
    CONTACT_NAME: {
      primary: 'header span[dir="auto"]',
      fallbacks: [
        'span[data-testid="conversation-info-header-chat-title"]',
        'header ._1hI5g span',
        'header span.ggj6brxn'
      ],
      description: 'Nome do contato no header'
    },

    // Status de conexão
    CONNECTION_STATUS: {
      primary: 'span[data-testid="status"]',
      fallbacks: [
        'span[title*="clique aqui"]',
        'span[title*="click here"]',
        'div._2dDmN'
      ],
      description: 'Status de conexão WhatsApp'
    }
  };

  // ============================================
  // ESTADO
  // ============================================

  const state = {
    initialized: false,
    selectorCache: new Map(),
    selectorStatus: new Map(),
    waApiStatus: {
      Store: { available: false, version: null },
      conn: { available: false },
      chat: { available: false },
      msg: { available: false }
    },
    moduleHealth: new Map(),
    issues: [],
    lastHealthCheck: null
  };

  // ============================================
  // SELETOR ENGINE COM AUTO-HEAL
  // ============================================

  /**
   * Encontra elemento com fallbacks automáticos
   */
  function findElement(selectorKey, root = document) {
    const selector = SELECTORS[selectorKey];
    if (!selector) {
      console.warn(`[AntiBreak] Seletor desconhecido: ${selectorKey}`);
      return null;
    }

    // Verificar cache (válido por 5s)
    const cached = state.selectorCache.get(selectorKey);
    if (cached && Date.now() - cached.timestamp < 5000) {
      const element = document.querySelector(cached.selector);
      if (element) return element;
    }

    // Tentar seletor primário
    let element = root.querySelector(selector.primary);
    if (element) {
      updateSelectorStatus(selectorKey, 'working', selector.primary);
      return element;
    }

    // Tentar fallbacks
    for (const fallback of selector.fallbacks) {
      try {
        element = root.querySelector(fallback);
        if (element) {
          updateSelectorStatus(selectorKey, 'fallback', fallback);
          console.warn(`[AntiBreak] ${selectorKey}: usando fallback "${fallback}"`);
          return element;
        }
      } catch (e) {
        // Seletor inválido, continuar
      }
    }

    // Nenhum funcionou
    updateSelectorStatus(selectorKey, 'broken', null);
    reportIssue({
      type: 'selector_broken',
      key: selectorKey,
      description: selector.description,
      tried: [selector.primary, ...selector.fallbacks]
    });

    return null;
  }

  /**
   * Espera elemento aparecer
   */
  function waitForElement(selectorKey, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const check = () => {
        const element = findElement(selectorKey);
        if (element) {
          resolve(element);
          return;
        }

        if (Date.now() - startTime >= timeout) {
          reject(new Error(`Timeout esperando ${selectorKey}`));
          return;
        }

        requestAnimationFrame(check);
      };

      check();
    });
  }

  /**
   * Observa mudanças em elemento
   */
  function observeElement(selectorKey, callback, options = {}) {
    const element = findElement(selectorKey);
    if (!element) {
      console.warn(`[AntiBreak] Não foi possível observar ${selectorKey}`);
      return null;
    }

    const observer = new MutationObserver((mutations) => {
      callback(mutations, element);
    });

    // Track observers para cleanup automático
    try {
      const originalDisconnect = observer.disconnect.bind(observer);
      observer.disconnect = () => {
        activeObservers.delete(observer);
        return originalDisconnect();
      };
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    activeObservers.add(observer);

    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: false,
      ...options
    });

    return observer;
  }

  function updateSelectorStatus(key, status, usedSelector) {
    state.selectorStatus.set(key, {
      status,
      usedSelector,
      checkedAt: Date.now()
    });

    if (usedSelector) {
      state.selectorCache.set(key, {
        selector: usedSelector,
        timestamp: Date.now()
      });
    }

    // Emitir para EventBus
    if (window.EventBus) {
      window.EventBus.registerSelectorStatus(key, status);
    }
  }

  // ============================================
  // DETECÇÃO DE API INTERNA WHATSAPP
  // ============================================

  /**
   * Verifica disponibilidade da API interna.
   *
   * Em WhatsApp Web 2.3000.x+ `window.Store` não existe mais (CSP impede
   * o legado `webpackChunk` shim, e o WA não expõe a Store global). A
   * autoridade agora é o page-world bridge em `injected/wa-page-bridge.js`,
   * que resolve `WAWebChatCollection`/`WAWebContactCollection`/etc via
   * `window.require` e publica o estado para o isolated world via
   * `WHL_WaBridge.healthCheck()`. Esta função lê DALI; o velho objeto
   * `window.Store` é mantido apenas como último fallback porque alguns
   * módulos legados (não-críticos) ainda o consultam diretamente.
   */
  function checkWhatsAppAPI() {
    const results = {
      Store: false,
      conn: false,
      chat: false,
      msg: false,
      contact: false,
      sendMessage: false,
      version: null,
      via: null,
    };

    try {
      const health = window.WHL_WaBridge?.healthCheck?.();
      if (health && health.ok) {
        const loaded = health.modulesLoaded || [];
        results.Store = true;             // bridge counts as "Store equivalente"
        results.via = 'WHL_WaBridge';
        results.version = health.version || 'unknown';
        results.chat = loaded.includes('Chat');
        results.msg = loaded.includes('Msg');
        results.contact = loaded.includes('Contact');
        // Either explicit SendTextMsg module OR the legacy SendMessage alias.
        results.sendMessage = loaded.includes('SendTextMsg') || loaded.includes('SendMessage');
        // Conn isn't exposed by the bridge — derive from overall ok.
        results.conn = true;
      } else if (window.Store) {
        // Fallback para builds antigas do WhatsApp Web (pré-2.3000.x).
        results.Store = true;
        results.via = 'window.Store(legacy)';
        results.version = window.Store.AppState?.state?.version || 'unknown';
        results.conn = !!window.Store.Conn;
        results.chat = !!window.Store.Chat;
        results.msg = !!window.Store.Msg;
        results.contact = !!window.Store.Contact;
        results.sendMessage = typeof window.Store.SendMessage?.sendTextMsgToChat === 'function';
      }

      // Verificar require do WhatsApp (apenas informativo — só funciona no page world,
      // que isolated não acessa; aqui serve só pra log)
      if (window.require && typeof window.require === 'function') {
        results.requireAvailable = true;
      }
    } catch (e) {
      console.error('[AntiBreak] Erro verificando API WA:', e);
    }

    // Atualizar estado
    state.waApiStatus = results;

    // Reportar problemas — somente quando NEM o bridge NEM o Store legado responderam.
    if (!results.Store) {
      reportIssue({
        type: 'api_unavailable',
        module: 'Store',
        description: 'API interna do WhatsApp não disponível (bridge ainda não pronto)'
      });
    }

    if (results.Store && !results.sendMessage) {
      reportIssue({
        type: 'api_method_missing',
        module: 'SendMessage',
        description: 'Módulo de envio não localizado'
      });
    }

    return results;
  }

  /**
   * Tenta recuperar a API interna.
   *
   * Não tenta mais escanear `window.*` ou substituir `window.Store` —
   * a única fonte legítima é o page bridge. Damos um tempo para ele
   * sinalizar `STORE_READY` (até ~10s) e re-checamos.
   */
  async function tryRecoverAPI() {
    console.log('[AntiBreak] Aguardando page bridge (WHL_WaBridge)...');

    // Re-ping o bridge no caso de a página ter recarregado parcialmente.
    try {
      window.postMessage({ source: 'WHL_ISOLATED', type: 'ping' }, '*');
    } catch (_) {}

    const POLL_MS = 500;
    const MAX_WAIT_MS = 10000;
    const start = Date.now();
    while (Date.now() - start < MAX_WAIT_MS) {
      const api = checkWhatsAppAPI();
      if (api.Store) return api;
      await new Promise(r => setTimeout(r, POLL_MS));
    }

    console.warn('[AntiBreak] Page bridge não respondeu em 10s — modo manual ativo.');
    try { window.WHL_WaBridge?.showFallbackBanner?.('AntiBreak: bridge indisponível'); } catch (_) {}
    return checkWhatsAppAPI();
  }

  // ============================================
  // SAÚDE DOS MÓDULOS
  // ============================================

  /**
   * Registra módulo para monitoramento
   */
  function registerModule(moduleName, testFunction) {
    state.moduleHealth.set(moduleName, {
      name: moduleName,
      testFn: testFunction,
      status: 'unknown',
      lastCheck: null,
      errors: [],
      errorCount: 0
    });
  }

  /**
   * Verifica saúde de todos os módulos
   */
  async function checkModuleHealth() {
    const results = {};

    for (const [name, module] of state.moduleHealth) {
      try {
        const result = await module.testFn();
        module.status = result ? 'healthy' : 'degraded';
        module.lastCheck = Date.now();
        
        if (!result) {
          module.errorCount++;
        } else {
          module.errorCount = 0;
        }

      } catch (error) {
        module.status = 'broken';
        module.errors.push({ error: error.message, time: Date.now() });
        module.errorCount++;
        
        if (module.errors.length > 10) module.errors.shift();

        reportIssue({
          type: 'module_error',
          module: name,
          error: error.message
        });
      }

      results[name] = module.status;
    }

    return results;
  }

  // ============================================
  // RELATÓRIO DE PROBLEMAS
  // ============================================

  function reportIssue(issue) {
    issue.timestamp = Date.now();
    issue.id = `issue_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    // Evitar duplicatas recentes
    const isDuplicate = state.issues.some(i => 
      i.type === issue.type && 
      i.module === issue.module &&
      Date.now() - i.timestamp < 60000
    );

    if (!isDuplicate) {
      state.issues.push(issue);
      
      // Limitar histórico
      if (state.issues.length > 100) {
        state.issues = state.issues.slice(-50);
      }

      console.warn('[AntiBreak] 🚨 Problema detectado:', issue);

      // Emitir evento
      if (window.EventBus) {
        window.EventBus.emit('health:issue_detected', issue);
      }
    }
  }

  function getIssues() {
    return [...state.issues];
  }

  function clearIssues() {
    state.issues = [];
  }

  // ============================================
  // HEALTH CHECK COMPLETO
  // ============================================

  async function runFullHealthCheck() {
    console.log('[AntiBreak] 🔍 Executando health check completo...');

    const report = {
      timestamp: Date.now(),
      selectors: {},
      waApi: null,
      modules: {},
      issues: [],
      overall: 'healthy'
    };

    // 1. Verificar seletores
    for (const key of Object.keys(SELECTORS)) {
      const element = findElement(key);
      const status = state.selectorStatus.get(key) || { status: 'unchecked' };
      report.selectors[key] = {
        found: !!element,
        status: status.status,
        usedSelector: status.usedSelector
      };
    }

    // 2. Verificar API do WhatsApp
    report.waApi = checkWhatsAppAPI();

    // 3. Verificar módulos
    report.modules = await checkModuleHealth();

    // 4. Coletar issues
    report.issues = getIssues().slice(-20);

    // 5. Determinar status geral
    const brokenSelectors = Object.values(report.selectors).filter(s => !s.found).length;
    const brokenModules = Object.values(report.modules).filter(s => s === 'broken').length;

    if (!report.waApi.Store) {
      report.overall = 'critical';
    } else if (brokenSelectors > 3 || brokenModules > 0) {
      report.overall = 'degraded';
    } else if (brokenSelectors > 0) {
      report.overall = 'warning';
    }

    state.lastHealthCheck = report;

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit(window.WHL_EVENTS.HEALTH_CHECK, report);
    }

    return report;
  }

  // ============================================
  // AUTO-HEALING
  // ============================================

  /**
   * Tenta reparar problemas automaticamente
   */
  async function tryAutoHeal() {
    console.log('[AntiBreak] 🔧 Tentando auto-reparo...');

    const fixed = [];
    const failed = [];

    // 1. Recuperar API
    if (!state.waApiStatus.Store) {
      const api = await tryRecoverAPI();
      if (api.Store) {
        fixed.push('WhatsApp Store API');
      } else {
        failed.push('WhatsApp Store API');
      }
    }

    // 2. Limpar cache de seletores quebrados
    for (const [key, status] of state.selectorStatus) {
      if (status.status === 'broken') {
        state.selectorCache.delete(key);
        const element = findElement(key);
        if (element) {
          fixed.push(`Seletor: ${key}`);
        }
      }
    }

    // 3. Tentar reiniciar módulos quebrados
    for (const [name, module] of state.moduleHealth) {
      if (module.status === 'broken' && window[name]?.init) {
        try {
          await window[name].init();
          module.status = 'healthy';
          fixed.push(`Módulo: ${name}`);
        } catch (e) {
          failed.push(`Módulo: ${name}`);
        }
      }
    }

    return { fixed, failed };
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  async function init() {
    if (state.initialized) return;
    
    state.initialized = true;

    // Verificar API inicial
    await new Promise(resolve => setTimeout(resolve, 3000));
    checkWhatsAppAPI();

    // Registrar módulos conhecidos
    const knownModules = [
      'CopilotEngine',
      'SubscriptionManager',
      'FeatureGate',
      'AIGateway',
      'DataSyncManager',
      'EventBus',
      'Scheduler'
    ];

    for (const mod of knownModules) {
      registerModule(mod, () => {
        return window[mod] && typeof window[mod].init === 'function' || window[mod];
      });
    }

    // Health check inicial
    await runFullHealthCheck();

    // Health check periódico
    if (healthCheckInterval) clearInterval(healthCheckInterval);
    healthCheckInterval = setInterval(runFullHealthCheck, 60000); // A cada 1 minuto

    // Auto-heal periódico
    if (autoHealInterval) clearInterval(autoHealInterval);
    autoHealInterval = setInterval(tryAutoHeal, 300000); // A cada 5 minutos

    console.log('[AntiBreak] ✅ Sistema anti-quebra inicializado');
  }

  // ============================================
  // EXPORT
  // ============================================

  const AntiBreakSystem = {
    // Seletores
    findElement,
    waitForElement,
    observeElement,
    SELECTORS,
    
    // API WhatsApp
    checkWhatsAppAPI,
    tryRecoverAPI,
    getWAApiStatus: () => ({ ...state.waApiStatus }),
    
    // Módulos
    registerModule,
    checkModuleHealth,
    
    // Issues
    reportIssue,
    getIssues,
    clearIssues,
    
    // Health
    runFullHealthCheck,
    checkHealth: runFullHealthCheck, // Alias
    getLastHealthCheck: () => state.lastHealthCheck,
    getHealthReport: () => state.lastHealthCheck, // Alias
    
    // Auto-heal
    tryAutoHeal,
    autoHeal: tryAutoHeal, // Alias
    fix: tryAutoHeal, // Alias
    
    // Status
    getSelectorStatus: () => Object.fromEntries(state.selectorStatus),
    getModuleStatus: () => Object.fromEntries(state.moduleHealth),
    
    // Init
    init
  };

  window.addEventListener('beforeunload', () => {
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
      healthCheckInterval = null;
    }
    if (autoHealInterval) {
      clearInterval(autoHealInterval);
      autoHealInterval = null;
    }
    activeObservers.forEach(obs => {
      try { obs.disconnect(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    });
    activeObservers.clear();
  });

  window.AntiBreakSystem = AntiBreakSystem;
  window.ABS = AntiBreakSystem; // Alias curto

  // Auto-init quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2000));
  } else {
    setTimeout(init, 2000);
  }

  console.log('[AntiBreak] 🛡️ Sistema anti-quebra carregado');

})();
