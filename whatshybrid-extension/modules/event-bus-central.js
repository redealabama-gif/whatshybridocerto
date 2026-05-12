/**
 * 🎯 EventBus Central v2.0 - Contrato Único de Eventos
 * Sistema centralizado de comunicação entre módulos
 * 
 * REGRA: Nenhum módulo deve criar sua própria sincronização
 * TODOS devem usar este EventBus para comunicação
 * 
 * @version 2.0.0
 */
(function() {
  'use strict';

  let eventBusHealthInterval = null;

  // ============================================
  // CONFIGURAÇÃO
  // ============================================

  const CONFIG = {
    DEBUG: false,
    MAX_LISTENERS_PER_EVENT: 50,
    WARN_LISTENERS_THRESHOLD: 30,
    MAX_TOTAL_LISTENERS: 500,
    HISTORY_SIZE: 100,
    STORAGE_KEY: 'whl_eventbus_state'
  };

  // ============================================
  // EVENTOS PADRÃO (Contrato)
  // ============================================

  const WHL_EVENTS = {
    // === SISTEMA ===
    SYSTEM_READY: 'system:ready',
    SYSTEM_ERROR: 'system:error',
    SYSTEM_WARNING: 'system:warning',
    MODULE_LOADED: 'system:module_loaded',
    MODULE_ERROR: 'system:module_error',
    
    // === WHATSAPP ===
    WA_READY: 'whatsapp:ready',
    WA_CHAT_OPENED: 'whatsapp:chat_opened',
    WA_CHAT_CLOSED: 'whatsapp:chat_closed',
    WA_MESSAGE_RECEIVED: 'whatsapp:message_received',
    WA_MESSAGE_SENT: 'whatsapp:message_sent',
    WA_MESSAGE_DELETED: 'whatsapp:message_deleted',
    WA_MESSAGE_EDITED: 'whatsapp:message_edited',
    WA_TYPING_STARTED: 'whatsapp:typing_started',
    WA_TYPING_STOPPED: 'whatsapp:typing_stopped',
    WA_SELECTOR_BROKEN: 'whatsapp:selector_broken',
    WA_API_ERROR: 'whatsapp:api_error',
    
    // === IA ===
    AI_REQUEST_START: 'ai:request_start',
    AI_REQUEST_SUCCESS: 'ai:request_success',
    AI_REQUEST_ERROR: 'ai:request_error',
    AI_CREDITS_LOW: 'ai:credits_low',
    AI_CREDITS_DEPLETED: 'ai:credits_depleted',
    AI_SUGGESTION_SHOWN: 'ai:suggestion_shown',
    AI_SUGGESTION_USED: 'ai:suggestion_used',
    AI_COPILOT_RESPONSE: 'ai:copilot_response',
    
    // === ASSINATURA ===
    SUB_ACTIVATED: 'subscription:activated',
    SUB_DEACTIVATED: 'subscription:deactivated',
    SUB_EXPIRED: 'subscription:expired',
    SUB_CREDITS_CONSUMED: 'subscription:credits_consumed',
    SUB_CREDITS_ADDED: 'subscription:credits_added',
    
    // === CRM ===
    CRM_CONTACT_CREATED: 'crm:contact_created',
    CRM_CONTACT_UPDATED: 'crm:contact_updated',
    CRM_DEAL_CREATED: 'crm:deal_created',
    CRM_DEAL_MOVED: 'crm:deal_moved',
    
    // === CAMPANHAS ===
    CAMPAIGN_STARTED: 'campaign:started',
    CAMPAIGN_PROGRESS: 'campaign:progress',
    CAMPAIGN_COMPLETED: 'campaign:completed',
    CAMPAIGN_ERROR: 'campaign:error',
    
    // === MENSAGENS ===
    MESSAGE_QUEUED: 'message:queued',
    MESSAGE_SENDING: 'message:sending',
    MESSAGE_SENT: 'message:sent',
    MESSAGE_FAILED: 'message:failed',
    
    // === RECOVER ===
    RECOVER_MESSAGE_CAPTURED: 'recover:message_captured',
    RECOVER_DOWNLOAD_START: 'recover:download_start',
    RECOVER_DOWNLOAD_COMPLETE: 'recover:download_complete',
    
    // === TAREFAS ===
    TASK_CREATED: 'task:created',
    TASK_COMPLETED: 'task:completed',
    TASK_REMINDER: 'task:reminder',
    
    // === SCHEDULER ===
    SCHEDULER_JOB_QUEUED: 'scheduler:job_queued',
    SCHEDULER_JOB_STARTED: 'scheduler:job_started',
    SCHEDULER_JOB_COMPLETED: 'scheduler:job_completed',
    SCHEDULER_JOB_FAILED: 'scheduler:job_failed',
    
    // === SYNC ===
    SYNC_STARTED: 'sync:started',
    SYNC_COMPLETED: 'sync:completed',
    SYNC_ERROR: 'sync:error',
    
    // === UI ===
    UI_PANEL_OPENED: 'ui:panel_opened',
    UI_PANEL_CLOSED: 'ui:panel_closed',
    UI_VIEW_CHANGED: 'ui:view_changed',
    UI_NOTIFICATION: 'ui:notification',
    
    // === HEALTH ===
    HEALTH_CHECK: 'health:check',
    HEALTH_SELECTOR_BROKEN: 'health:selector_broken',
    HEALTH_API_BROKEN: 'health:api_broken',
    HEALTH_MODULE_BROKEN: 'health:module_broken'
  };

  // ============================================
  // ESTADO
  // ============================================

  const state = {
    initialized: false,
    listeners: new Map(),
    onceListeners: new Map(),
    history: [],
    errors: [],
    moduleStatus: new Map(),
    selectorStatus: new Map(),
    _totalListeners: 0,
    _stats: {
      added: 0,
      removed: 0,
      emitted: 0,
      errors: 0
    }
  };

  // ============================================
  // CORE EVENTBUS
  // ============================================

  /**
   * Registra um listener para um evento
   */
  function on(event, callback, context = null) {
    if (typeof callback !== 'function') {
      console.error('[EventBus] Callback deve ser uma função');
      return () => {};
    }

    // Verificar limite total
    if (state._totalListeners >= CONFIG.MAX_TOTAL_LISTENERS) {
      console.error(`[EventBus] ⚠️ Limite total de listeners (${CONFIG.MAX_TOTAL_LISTENERS}) atingido!`);
      return () => {};
    }

    if (!state.listeners.has(event)) {
      state.listeners.set(event, []);
    }

    const listeners = state.listeners.get(event);
    
    // Verificar limite por evento
    if (listeners.length >= CONFIG.MAX_LISTENERS_PER_EVENT) {
      console.error(`[EventBus] ⛔ Máximo de listeners (${CONFIG.MAX_LISTENERS_PER_EVENT}) atingido para ${event}`);
      return () => {};
    }

    // Warning se próximo do limite
    if (listeners.length >= CONFIG.WARN_LISTENERS_THRESHOLD) {
      console.warn(`[EventBus] ⚠️ ${listeners.length + 1} listeners para ${event} (limite: ${CONFIG.MAX_LISTENERS_PER_EVENT})`);
    }

    const handler = { callback, context };
    listeners.push(handler);
    state._totalListeners++;
    state._stats.added++;

    if (CONFIG.DEBUG) {
      console.log(`[EventBus] Listener registrado: ${event} (total: ${state._totalListeners})`);
    }

    // Retorna função para remover listener
    return () => off(event, callback);
  }

  /**
   * Registra listener que executa apenas uma vez
   */
  function once(event, callback, context = null) {
    if (!state.onceListeners.has(event)) {
      state.onceListeners.set(event, []);
    }
    
    state.onceListeners.get(event).push({ callback, context });
    
    return () => {
      const listeners = state.onceListeners.get(event);
      if (listeners) {
        const index = listeners.findIndex(l => l.callback === callback);
        if (index > -1) listeners.splice(index, 1);
      }
    };
  }

  /**
   * Remove um listener
   */
  function off(event, callback) {
    if (state.listeners.has(event)) {
      const listeners = state.listeners.get(event);
      const index = listeners.findIndex(l => l.callback === callback);
      if (index > -1) {
        listeners.splice(index, 1);
        state._totalListeners--;
        state._stats.removed++;
      }
    }
  }

  /**
   * Emite um evento
   */
  function emit(event, data = {}) {
    const timestamp = Date.now();
    
    // Adicionar ao histórico
    state.history.push({ event, data, timestamp });
    if (state.history.length > CONFIG.HISTORY_SIZE) {
      state.history.shift();
    }

    if (CONFIG.DEBUG) {
      console.log(`[EventBus] Evento: ${event}`, data);
    }

    // Processar listeners normais
    if (state.listeners.has(event)) {
      const listeners = state.listeners.get(event);
      listeners.forEach(({ callback, context }) => {
        try {
          callback.call(context, data, { event, timestamp });
        } catch (error) {
          console.error(`[EventBus] Erro em listener de ${event}:`, error);
          state.errors.push({ event, error: error.message, timestamp });
        }
      });
    }

    // Processar listeners once
    if (state.onceListeners.has(event)) {
      const listeners = state.onceListeners.get(event);
      state.onceListeners.delete(event);
      
      listeners.forEach(({ callback, context }) => {
        try {
          callback.call(context, data, { event, timestamp });
        } catch (error) {
          console.error(`[EventBus] Erro em listener once de ${event}:`, error);
        }
      });
    }

    // Wildcard listeners
    if (state.listeners.has('*')) {
      state.listeners.get('*').forEach(({ callback, context }) => {
        try {
          callback.call(context, { event, data, timestamp });
        } catch (error) {
          console.error('[EventBus] Erro em wildcard listener:', error);
        }
      });
    }

    return true;
  }

  /**
   * Emite evento e aguarda resposta (Promise)
   */
  function request(event, data = {}, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const responseEvent = `${event}:response`;
      const timer = setTimeout(() => {
        off(responseEvent, handler);
        reject(new Error(`Timeout aguardando resposta de ${event}`));
      }, timeout);

      const handler = (response) => {
        clearTimeout(timer);
        off(responseEvent, handler);
        resolve(response);
      };

      on(responseEvent, handler);
      emit(event, data);
    });
  }

  /**
   * Responde a um evento request
   */
  function respond(event, data) {
    emit(`${event}:response`, data);
  }

  // ============================================
  // REGISTRO DE MÓDULOS
  // ============================================

  /**
   * Registra status de um módulo
   */
  function registerModule(moduleName, status = 'loaded') {
    state.moduleStatus.set(moduleName, {
      status,
      loadedAt: Date.now(),
      errors: 0
    });
    
    emit(WHL_EVENTS.MODULE_LOADED, { module: moduleName, status });
  }

  /**
   * Reporta erro de módulo
   */
  function reportModuleError(moduleName, error) {
    const moduleInfo = state.moduleStatus.get(moduleName) || { errors: 0 };
    moduleInfo.errors++;
    moduleInfo.lastError = error;
    moduleInfo.status = moduleInfo.errors >= 3 ? 'broken' : 'degraded';
    
    state.moduleStatus.set(moduleName, moduleInfo);
    
    emit(WHL_EVENTS.MODULE_ERROR, { module: moduleName, error, status: moduleInfo.status });
    emit(WHL_EVENTS.HEALTH_MODULE_BROKEN, { module: moduleName, error });
  }

  /**
   * Registra status de seletor
   */
  function registerSelectorStatus(selectorName, status, element = null) {
    state.selectorStatus.set(selectorName, {
      status, // 'working', 'broken', 'fallback'
      element,
      checkedAt: Date.now()
    });
    
    if (status === 'broken') {
      emit(WHL_EVENTS.HEALTH_SELECTOR_BROKEN, { selector: selectorName });
      emit(WHL_EVENTS.WA_SELECTOR_BROKEN, { selector: selectorName });
    }
  }

  // ============================================
  // DIAGNÓSTICO
  // ============================================

  /**
   * Obtém status de saúde do sistema
   */
  function getHealthStatus() {
    const brokenModules = [];
    const brokenSelectors = [];
    
    state.moduleStatus.forEach((info, name) => {
      if (info.status === 'broken') {
        brokenModules.push({ name, ...info });
      }
    });
    
    state.selectorStatus.forEach((info, name) => {
      if (info.status === 'broken') {
        brokenSelectors.push({ name, ...info });
      }
    });
    
    return {
      healthy: brokenModules.length === 0 && brokenSelectors.length === 0,
      modules: Object.fromEntries(state.moduleStatus),
      selectors: Object.fromEntries(state.selectorStatus),
      brokenModules,
      brokenSelectors,
      recentErrors: state.errors.slice(-10),
      eventHistory: state.history.slice(-20)
    };
  }

  /**
   * Obtém histórico de eventos
   */
  function getHistory(filter = null) {
    if (!filter) return [...state.history];
    return state.history.filter(e => e.event.includes(filter));
  }

  /**
   * Limpa histórico
   */
  function clearHistory() {
    state.history = [];
    state.errors = [];
  }

  /**
   * Obtém estatísticas do EventBus
   */
  function getStats() {
    const eventCounts = {};
    state.listeners.forEach((listeners, event) => {
      eventCounts[event] = listeners.length;
    });

    return {
      totalListeners: state._totalListeners,
      eventCounts,
      eventsWithListeners: state.listeners.size,
      stats: { ...state._stats },
      config: {
        maxPerEvent: CONFIG.MAX_LISTENERS_PER_EVENT,
        warnThreshold: CONFIG.WARN_LISTENERS_THRESHOLD,
        maxTotal: CONFIG.MAX_TOTAL_LISTENERS
      }
    };
  }

  /**
   * Diagnóstico do EventBus
   */
  function diagnose() {
    const issues = [];
    const stats = getStats();

    // Verificar eventos com muitos listeners
    Object.entries(stats.eventCounts).forEach(([event, count]) => {
      if (count >= CONFIG.WARN_LISTENERS_THRESHOLD) {
        issues.push({
          type: 'warning',
          message: `Evento "${event}" tem ${count} listeners (limite: ${CONFIG.MAX_LISTENERS_PER_EVENT})`
        });
      }
    });

    // Verificar total de listeners
    if (state._totalListeners > CONFIG.MAX_TOTAL_LISTENERS * 0.8) {
      issues.push({
        type: 'critical',
        message: `Total de listeners (${state._totalListeners}) próximo do limite (${CONFIG.MAX_TOTAL_LISTENERS})`
      });
    }

    // Verificar possíveis memory leaks
    const leakRatio = state._stats.added > 0 ? state._stats.removed / state._stats.added : 1;
    if (leakRatio < 0.5 && state._stats.added > 100) {
      issues.push({
        type: 'warning',
        message: `Possível memory leak: ${state._stats.added} adicionados, ${state._stats.removed} removidos`
      });
    }

    // Verificar erros recentes
    if (state._stats.errors > 10) {
      issues.push({
        type: 'warning',
        message: `${state._stats.errors} erros em listeners registrados`
      });
    }

    return {
      healthy: issues.filter(i => i.type === 'critical').length === 0,
      issues,
      stats
    };
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  function init() {
    if (state.initialized) return;
    
    state.initialized = true;
    console.log('[EventBus] ✅ Central de eventos inicializada');
    
    // Auto-diagnóstico a cada 30s
    if (eventBusHealthInterval) clearInterval(eventBusHealthInterval);
    eventBusHealthInterval = setInterval(() => {
      emit(WHL_EVENTS.HEALTH_CHECK, getHealthStatus());
    }, 30000);
  }

  // ============================================
  // EXPORT
  // ============================================

  const EventBus = {
    // Core
    on,
    once,
    off,
    emit,
    request,
    respond,
    
    // Módulos
    registerModule,
    setModuleStatus: registerModule, // Alias
    reportModuleError,
    registerSelectorStatus,
    setSelectorStatus: registerSelectorStatus, // Alias
    
    // Diagnóstico
    getHealthStatus,
    getModuleStatus: () => Object.fromEntries(state.moduleStatus),
    getSelectorStatus: () => Object.fromEntries(state.selectorStatus),
    getAllModuleStatus: () => Array.from(state.moduleStatus.entries()).map(([name, data]) => ({ name, ...data })),
    getAllSelectorStatus: () => Array.from(state.selectorStatus.entries()).map(([name, data]) => ({ name, ...data })),
    getHistory,
    getEventHistory: getHistory, // Alias
    clearHistory,
    getStats,
    diagnose,
    
    // Constantes
    EVENTS: WHL_EVENTS,
    
    // Init
    init
  };

  window.addEventListener('beforeunload', () => {
    if (eventBusHealthInterval) {
      clearInterval(eventBusHealthInterval);
      eventBusHealthInterval = null;
    }
  });

  // Expor globalmente
  window.EventBus = EventBus;
  window.WHL_EVENTS = WHL_EVENTS;
  
  /**
   * ✅ Alias de compatibilidade para módulos novos (SMARTBOT IA suggestions)
   * Muitos módulos recém-adicionados usam `window.WHLEventBus` e nomes camelCase
   * (ex.: messageReceived/chatOpened). O core usa `window.EventBus` e nomes com ":".
   * 
   * Este adapter garante que os módulos novos EXECUTEM ações reais sem quebrar o legado.
   */
  if (!window.WHLEventBus) {
    const aliasMap = {
      messageReceived: ['message:received', WHL_EVENTS.WA_MESSAGE_RECEIVED],
      messageEdited: ['message:edited', WHL_EVENTS.WA_MESSAGE_EDITED],
      chatOpened: ['chat:changed', WHL_EVENTS.WA_CHAT_OPENED],
      chatClosed: [WHL_EVENTS.WA_CHAT_CLOSED],
      typingStarted: [WHL_EVENTS.WA_TYPING_STARTED],
      typingStopped: [WHL_EVENTS.WA_TYPING_STOPPED]
    };

    const normalizeList = (event) => {
      if (!event) return [];
      if (aliasMap[event]) return aliasMap[event].filter(Boolean);
      return [event];
    };

    const transformAiResponseFromSuggestion = (data) => {
      const chatId = data?.chatId || data?.contactId || 'unknown';
      const ts = data?.shownAt || Date.now();
      const msg = data?.suggestion || data?.message || '';
      return {
        responseId: `copilot:${chatId}:${ts}`,
        message: msg,
        contactId: chatId,
        timestamp: ts,
        source: 'copilot_suggestion_shown',
        raw: data
      };
    };

    const transformAiResponseFromAutopilot = (data) => {
      const chatId = data?.chatId || data?.contactId || 'unknown';
      const ts = data?.timestamp || Date.now();
      const msg = data?.response || data?.message || '';
      return {
        responseId: `autopilot:${chatId}:${ts}`,
        message: msg,
        contactId: chatId,
        timestamp: ts,
        source: 'autopilot_auto_responded',
        raw: data
      };
    };

    window.WHLEventBus = {
      on(event, callback, context) {
        if (event === 'aiResponseSent') {
          const unsubs = [];
          // Se alguém emitir diretamente aiResponseSent, também ouvimos
          unsubs.push(EventBus.on('aiResponseSent', callback, context));
          // Bridge: CopilotEngine cache hit/suggestion shown
          unsubs.push(EventBus.on('suggestion:shown', (d) => callback.call(context || null, transformAiResponseFromSuggestion(d)), context));
          // Bridge: Autopilot auto responded
          unsubs.push(EventBus.on('autopilot:auto-responded', (d) => callback.call(context || null, transformAiResponseFromAutopilot(d)), context));
          return () => unsubs.forEach(u => { try { u && u(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} } });
        }

        const events = normalizeList(event);
        const unsubs = events.map(e => EventBus.on(e, callback, context));
        return () => unsubs.forEach(u => { try { u && u(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} } });
      },
      once(event, callback, context) {
        const events = normalizeList(event);
        // once em múltiplos eventos: o primeiro que disparar resolve. (best-effort)
        let done = false;
        const unsubs = events.map(e => EventBus.on(e, (d, meta) => {
          if (done) return;
          done = true;
          unsubs.forEach(u => { try { u && u(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} } });
          callback.call(context || null, d, meta);
        }, context));
        return () => unsubs.forEach(u => { try { u && u(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} } });
      },
      off(event, callback) {
        const events = normalizeList(event);
        events.forEach(e => {
          try { EventBus.off(e, callback); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
        });
      },
      emit(event, data) {
        const events = normalizeList(event);
        // Emitir o nome solicitado e seus aliases (se existirem)
        events.forEach(e => EventBus.emit(e, data));
        // Também emitir o nome original (caso não esteja na lista)
        if (!events.includes(event)) EventBus.emit(event, data);
        return true;
      },
      request(event, data, timeout) {
        // Sem alias em request para evitar respostas duplicadas; usa evento original
        return EventBus.request(event, data, timeout);
      },
      respond(event, data) {
        return EventBus.respond(event, data);
      }
    };
  }

  // Auto-init
  EventBus.init();

  console.log('[EventBus] 🎯 Central de eventos carregada');

})();
