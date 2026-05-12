/**
 * ⚡ Performance Budget System
 * Controle de recursos e limites de performance
 * 
 * Funcionalidades:
 * - Limite de MutationObservers ativos
 * - Controle de polling/setInterval
 * - Priorização via fila global
 * - Métricas de performance
 * - Throttling automático
 * 
 * @version 1.0.0
 */
(function() {
  'use strict';

  let domQueryResetInterval = null;
  let cleanupInterval = null;
  let memoryCheckInterval = null;

  // ═══════════════════════════════════════════════════════════════════
  // CONFIGURAÇÃO DE BUDGET
  // ═══════════════════════════════════════════════════════════════════

  const BUDGET = {
    // Limites de observers
    MAX_MUTATION_OBSERVERS: 5,
    MAX_INTERSECTION_OBSERVERS: 3,
    MAX_RESIZE_OBSERVERS: 2,
    
    // Limites de polling
    MAX_INTERVALS: 10,
    MIN_INTERVAL_MS: 1000, // Mínimo 1 segundo entre polls
    MAX_POLLING_RATE: 60, // Máximo 60 polls/minuto total
    
    // Limites de event listeners
    MAX_SCROLL_LISTENERS: 3,
    MAX_RESIZE_LISTENERS: 2,
    
    // Performance thresholds
    MAX_DOM_QUERIES_PER_SECOND: 100,
    MAX_MEMORY_MB: 100, // Alerta se usar mais que 100MB
    MAX_CPU_USAGE_PERCENT: 30, // Alerta se usar mais que 30% CPU
    
    // Throttle defaults
    DEFAULT_THROTTLE_MS: 100,
    SCROLL_THROTTLE_MS: 150,
    RESIZE_THROTTLE_MS: 200,
    
    // Auto-cleanup
    CLEANUP_INTERVAL: 60000, // Limpar recursos não usados a cada minuto
    STALE_RESOURCE_TIMEOUT: 300000 // Recurso não usado por 5 min é removido
  };

  // ═══════════════════════════════════════════════════════════════════
  // ESTADO E TRACKING
  // ═══════════════════════════════════════════════════════════════════

  const state = {
    initialized: false,
    
    // Tracking de observers
    mutationObservers: new Map(), // { id: { observer, target, options, createdAt, lastActivity, module } }
    intersectionObservers: new Map(),
    resizeObservers: new Map(),
    
    // Tracking de intervals
    intervals: new Map(), // { id: { intervalId, callback, interval, createdAt, lastRun, module } }
    
    // Tracking de event listeners
    eventListeners: new Map(), // { id: { element, event, handler, options, module } }
    
    // Métricas
    metrics: {
      domQueries: 0,
      domQueriesLastSecond: 0,
      lastQueryReset: Date.now(),
      totalObserverCallbacks: 0,
      totalIntervalCalls: 0,
      warnings: [],
      violations: []
    },
    
    // Estado de throttle
    isThrottled: false,
    throttleLevel: 0 // 0 = normal, 1 = leve, 2 = moderado, 3 = agressivo
  };

  // ═══════════════════════════════════════════════════════════════════
  // GERADORES DE ID
  // ═══════════════════════════════════════════════════════════════════

  let idCounter = 0;
  function generateId(prefix) {
    return `${prefix}_${Date.now()}_${++idCounter}`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // MANAGED MUTATION OBSERVER
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Cria um MutationObserver gerenciado
   * @param {Function} callback - Callback do observer
   * @param {Object} options - { module, priority }
   * @returns {Object} - { id, observe, disconnect }
   */
  function createManagedMutationObserver(callback, options = {}) {
    // Verificar limite
    if (state.mutationObservers.size >= BUDGET.MAX_MUTATION_OBSERVERS) {
      // Tentar liberar observer antigo não usado
      const staleId = findStaleResource(state.mutationObservers);
      if (staleId) {
        disconnectMutationObserver(staleId);
        console.log(`[PerfBudget] ♻️ Observer antigo liberado: ${staleId}`);
      } else {
        console.warn(`[PerfBudget] ⚠️ Limite de MutationObservers atingido (${BUDGET.MAX_MUTATION_OBSERVERS})`);
        addViolation('mutation_observer_limit', options.module);
        return null;
      }
    }

    const id = generateId('mo');
    
    // Wrapper com throttle e métricas
    const wrappedCallback = throttle((mutations, observer) => {
      state.metrics.totalObserverCallbacks++;
      state.mutationObservers.get(id).lastActivity = Date.now();
      
      try {
        callback(mutations, observer);
      } catch (e) {
        console.error(`[PerfBudget] Erro em MutationObserver ${id}:`, e);
      }
    }, BUDGET.DEFAULT_THROTTLE_MS);

    const observer = new MutationObserver(wrappedCallback);
    
    const entry = {
      id,
      observer,
      target: null,
      options: null,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      module: options.module || 'unknown',
      priority: options.priority || 5
    };

    state.mutationObservers.set(id, entry);

    return {
      id,
      observe: (target, observerOptions) => {
        entry.target = target;
        entry.options = observerOptions;
        observer.observe(target, observerOptions);
      },
      disconnect: () => disconnectMutationObserver(id),
      getEntry: () => entry
    };
  }

  /**
   * Desconecta MutationObserver
   */
  function disconnectMutationObserver(id) {
    const entry = state.mutationObservers.get(id);
    if (entry) {
      entry.observer.disconnect();
      state.mutationObservers.delete(id);
      return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════
  // MANAGED INTERVAL
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Cria um interval gerenciado
   * @param {Function} callback - Callback
   * @param {number} interval - Intervalo em ms
   * @param {Object} options - { module, priority }
   * @returns {string|null} - ID do interval ou null se limite atingido
   */
  function createManagedInterval(callback, interval, options = {}) {
    // Verificar limite
    if (state.intervals.size >= BUDGET.MAX_INTERVALS) {
      const staleId = findStaleResource(state.intervals);
      if (staleId) {
        clearManagedInterval(staleId);
        console.log(`[PerfBudget] ♻️ Interval antigo liberado: ${staleId}`);
      } else {
        console.warn(`[PerfBudget] ⚠️ Limite de intervals atingido (${BUDGET.MAX_INTERVALS})`);
        addViolation('interval_limit', options.module);
        return null;
      }
    }

    // Garantir intervalo mínimo
    const safeInterval = Math.max(interval, BUDGET.MIN_INTERVAL_MS);
    if (interval < BUDGET.MIN_INTERVAL_MS) {
      console.warn(`[PerfBudget] ⚠️ Interval ajustado de ${interval}ms para ${safeInterval}ms (mínimo)`);
      addWarning('interval_too_fast', options.module, { requested: interval, actual: safeInterval });
    }

    const id = generateId('int');
    
    // Wrapper com métricas
    const wrappedCallback = () => {
      state.metrics.totalIntervalCalls++;
      state.intervals.get(id).lastRun = Date.now();
      
      // Verificar throttle global
      if (state.throttleLevel >= 2) {
        return; // Skip se throttle agressivo
      }
      
      try {
        callback();
      } catch (e) {
        console.error(`[PerfBudget] Erro em interval ${id}:`, e);
      }
    };

    const intervalId = setInterval(wrappedCallback, safeInterval);

    state.intervals.set(id, {
      id,
      intervalId,
      callback,
      interval: safeInterval,
      createdAt: Date.now(),
      lastRun: Date.now(),
      module: options.module || 'unknown',
      priority: options.priority || 5
    });

    return id;
  }

  /**
   * Limpa interval gerenciado
   */
  function clearManagedInterval(id) {
    const entry = state.intervals.get(id);
    if (entry) {
      clearInterval(entry.intervalId);
      state.intervals.delete(id);
      return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════
  // MANAGED EVENT LISTENER
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Adiciona event listener gerenciado com throttle automático
   * @param {Element} element - Elemento
   * @param {string} event - Tipo de evento
   * @param {Function} handler - Handler
   * @param {Object} options - { module, throttle }
   */
  function addManagedEventListener(element, event, handler, options = {}) {
    const id = generateId('el');
    
    // Throttle baseado no tipo de evento
    let throttleMs = options.throttle || BUDGET.DEFAULT_THROTTLE_MS;
    if (event === 'scroll') throttleMs = BUDGET.SCROLL_THROTTLE_MS;
    if (event === 'resize') throttleMs = BUDGET.RESIZE_THROTTLE_MS;

    const throttledHandler = throttle(handler, throttleMs);
    
    element.addEventListener(event, throttledHandler, options.eventOptions);

    state.eventListeners.set(id, {
      id,
      element,
      event,
      handler: throttledHandler,
      originalHandler: handler,
      options,
      createdAt: Date.now(),
      module: options.module || 'unknown'
    });

    return id;
  }

  /**
   * Remove event listener gerenciado
   */
  function removeManagedEventListener(id) {
    const entry = state.eventListeners.get(id);
    if (entry) {
      entry.element.removeEventListener(entry.event, entry.handler, entry.options?.eventOptions);
      state.eventListeners.delete(id);
      return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════
  // UTILIDADES
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Throttle function
   */
  function throttle(fn, wait) {
    let lastTime = 0;
    let timeout = null;
    
    return function(...args) {
      const now = Date.now();
      const remaining = wait - (now - lastTime);
      
      if (remaining <= 0) {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        lastTime = now;
        fn.apply(this, args);
      } else if (!timeout) {
        timeout = setTimeout(() => {
          lastTime = Date.now();
          timeout = null;
          fn.apply(this, args);
        }, remaining);
      }
    };
  }

  /**
   * Debounce function
   */
  function debounce(fn, wait) {
    let timeout = null;
    
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /**
   * Encontra recurso antigo não usado
   */
  function findStaleResource(map) {
    const now = Date.now();
    let oldestId = null;
    let oldestTime = Infinity;

    for (const [id, entry] of map) {
      const lastActivity = entry.lastActivity || entry.lastRun || entry.createdAt;
      
      // Recurso não usado por muito tempo
      if (now - lastActivity > BUDGET.STALE_RESOURCE_TIMEOUT) {
        if (lastActivity < oldestTime) {
          oldestTime = lastActivity;
          oldestId = id;
        }
      }
    }

    return oldestId;
  }

  /**
   * Adiciona warning
   */
  function addWarning(type, module, details = {}) {
    state.metrics.warnings.push({
      type,
      module,
      details,
      timestamp: Date.now()
    });
    
    // Limitar histórico
    if (state.metrics.warnings.length > 100) {
      state.metrics.warnings.shift();
    }
  }

  /**
   * Adiciona violation
   */
  function addViolation(type, module, details = {}) {
    state.metrics.violations.push({
      type,
      module,
      details,
      timestamp: Date.now()
    });
    
    if (state.metrics.violations.length > 100) {
      state.metrics.violations.shift();
    }

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit('performance:violation', { type, module, details });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // MONITORAMENTO DE PERFORMANCE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Monitora uso de memória
   */
  function checkMemoryUsage() {
    if (!performance.memory) return null;

    const usedMB = performance.memory.usedJSHeapSize / 1024 / 1024;
    
    if (usedMB > BUDGET.MAX_MEMORY_MB) {
      addWarning('high_memory', 'system', { usedMB: usedMB.toFixed(2) });
      console.warn(`[PerfBudget] ⚠️ Alto uso de memória: ${usedMB.toFixed(2)}MB`);
    }

    return {
      usedMB: usedMB.toFixed(2),
      totalMB: (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2),
      limitMB: (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2)
    };
  }

  /**
   * Monitora taxa de DOM queries (wrapper para querySelector/All)
   */
  function setupDOMQueryTracking() {
    const originalQuerySelector = Document.prototype.querySelector;
    const originalQuerySelectorAll = Document.prototype.querySelectorAll;
    const originalElementQuerySelector = Element.prototype.querySelector;
    const originalElementQuerySelectorAll = Element.prototype.querySelectorAll;

    const trackQuery = () => {
      state.metrics.domQueries++;
      state.metrics.domQueriesLastSecond++;
    };

    Document.prototype.querySelector = function(...args) {
      trackQuery();
      return originalQuerySelector.apply(this, args);
    };

    Document.prototype.querySelectorAll = function(...args) {
      trackQuery();
      return originalQuerySelectorAll.apply(this, args);
    };

    Element.prototype.querySelector = function(...args) {
      trackQuery();
      return originalElementQuerySelector.apply(this, args);
    };

    Element.prototype.querySelectorAll = function(...args) {
      trackQuery();
      return originalElementQuerySelectorAll.apply(this, args);
    };

    // Reset contador por segundo
    if (domQueryResetInterval) clearInterval(domQueryResetInterval);
    domQueryResetInterval = setInterval(() => {
      if (state.metrics.domQueriesLastSecond > BUDGET.MAX_DOM_QUERIES_PER_SECOND) {
        addWarning('high_dom_queries', 'system', { 
          count: state.metrics.domQueriesLastSecond,
          limit: BUDGET.MAX_DOM_QUERIES_PER_SECOND
        });
      }
      state.metrics.domQueriesLastSecond = 0;
    }, 1000);
  }

  /**
   * Auto-cleanup de recursos não usados
   */
  function runCleanup() {
    let cleaned = 0;

    // Limpar MutationObservers antigos
    for (const [id, entry] of state.mutationObservers) {
      if (Date.now() - entry.lastActivity > BUDGET.STALE_RESOURCE_TIMEOUT) {
        disconnectMutationObserver(id);
        cleaned++;
      }
    }

    // Limpar intervals antigos (com cuidado)
    for (const [id, entry] of state.intervals) {
      if (Date.now() - entry.lastRun > BUDGET.STALE_RESOURCE_TIMEOUT * 2) {
        clearManagedInterval(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[PerfBudget] 🧹 Cleanup: ${cleaned} recursos liberados`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // THROTTLE GLOBAL (EMERGÊNCIA)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Ativa throttle global
   * @param {number} level - 0=off, 1=leve, 2=moderado, 3=agressivo
   */
  function setThrottleLevel(level) {
    state.throttleLevel = Math.max(0, Math.min(3, level));
    state.isThrottled = level > 0;

    console.log(`[PerfBudget] Throttle nível ${level}: ${['OFF', 'LEVE', 'MODERADO', 'AGRESSIVO'][level]}`);

    // Em nível agressivo, pausar alguns observers
    if (level >= 3) {
      for (const [id, entry] of state.mutationObservers) {
        if (entry.priority > 3) {
          entry.observer.disconnect();
        }
      }
    }

    if (window.EventBus) {
      window.EventBus.emit('performance:throttle_changed', { level });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // MÉTRICAS E RELATÓRIO
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Obtém métricas atuais
   */
  function getMetrics() {
    return {
      observers: {
        mutation: state.mutationObservers.size,
        mutationLimit: BUDGET.MAX_MUTATION_OBSERVERS,
        intersection: state.intersectionObservers.size,
        resize: state.resizeObservers.size
      },
      intervals: {
        count: state.intervals.size,
        limit: BUDGET.MAX_INTERVALS
      },
      eventListeners: state.eventListeners.size,
      domQueries: {
        total: state.metrics.domQueries,
        lastSecond: state.metrics.domQueriesLastSecond
      },
      callbacks: {
        observers: state.metrics.totalObserverCallbacks,
        intervals: state.metrics.totalIntervalCalls
      },
      memory: checkMemoryUsage(),
      throttle: {
        active: state.isThrottled,
        level: state.throttleLevel
      },
      warnings: state.metrics.warnings.length,
      violations: state.metrics.violations.length
    };
  }

  /**
   * Obtém relatório detalhado
   */
  function getDetailedReport() {
    return {
      metrics: getMetrics(),
      mutationObservers: Array.from(state.mutationObservers.values()).map(e => ({
        id: e.id,
        module: e.module,
        createdAt: e.createdAt,
        lastActivity: e.lastActivity,
        ageMinutes: ((Date.now() - e.createdAt) / 60000).toFixed(1)
      })),
      intervals: Array.from(state.intervals.values()).map(e => ({
        id: e.id,
        module: e.module,
        interval: e.interval,
        lastRun: e.lastRun
      })),
      warnings: state.metrics.warnings.slice(-20),
      violations: state.metrics.violations.slice(-20),
      budget: BUDGET
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // INICIALIZAÇÃO
  // ═══════════════════════════════════════════════════════════════════

  function init() {
    if (state.initialized) return;

    console.log('[PerfBudget] ⚡ Inicializando sistema de performance...');

    // Setup tracking de DOM queries (opcional, pode impactar perf)
    // setupDOMQueryTracking(); // Descomentear se quiser tracking detalhado

    // Cleanup periódico
    if (cleanupInterval) clearInterval(cleanupInterval);
    cleanupInterval = setInterval(runCleanup, BUDGET.CLEANUP_INTERVAL);

    // Monitoramento de memória
    if (memoryCheckInterval) clearInterval(memoryCheckInterval);
    memoryCheckInterval = setInterval(() => {
      checkMemoryUsage();
    }, 30000);

    state.initialized = true;
    console.log('[PerfBudget] ✅ Sistema inicializado');
    console.log(`[PerfBudget] Limites: ${BUDGET.MAX_MUTATION_OBSERVERS} observers, ${BUDGET.MAX_INTERVALS} intervals`);

    if (window.EventBus) {
      window.EventBus.emit('module:ready', { module: 'PerformanceBudget' });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // API PÚBLICA
  // ═══════════════════════════════════════════════════════════════════

  const PerformanceBudget = {
    init,
    
    // Observers gerenciados
    createMutationObserver: createManagedMutationObserver,
    disconnectMutationObserver,
    
    // Intervals gerenciados
    createInterval: createManagedInterval,
    clearInterval: clearManagedInterval,
    
    // Event listeners gerenciados
    addEventListener: addManagedEventListener,
    removeEventListener: removeManagedEventListener,
    
    // Utilidades
    throttle,
    debounce,
    
    // Throttle global
    setThrottleLevel,
    getThrottleLevel: () => state.throttleLevel,
    
    // Métricas
    getMetrics,
    getDetailedReport,
    
    // Configuração
    BUDGET,
    
    // Status
    getObserverCount: () => state.mutationObservers.size,
    getIntervalCount: () => state.intervals.size,
    isOverBudget: () => 
      state.mutationObservers.size >= BUDGET.MAX_MUTATION_OBSERVERS ||
      state.intervals.size >= BUDGET.MAX_INTERVALS,
    
    // Cleanup manual
    runCleanup,
    
    // Liberar recursos de um módulo específico
    releaseModuleResources: (moduleName) => {
      let released = 0;
      
      for (const [id, entry] of state.mutationObservers) {
        if (entry.module === moduleName) {
          disconnectMutationObserver(id);
          released++;
        }
      }
      
      for (const [id, entry] of state.intervals) {
        if (entry.module === moduleName) {
          clearManagedInterval(id);
          released++;
        }
      }
      
      for (const [id, entry] of state.eventListeners) {
        if (entry.module === moduleName) {
          removeManagedEventListener(id);
          released++;
        }
      }
      
      console.log(`[PerfBudget] Liberados ${released} recursos do módulo ${moduleName}`);
      return released;
    }
  };

  // Cleanup ao descarregar
  window.addEventListener('beforeunload', () => {
    if (domQueryResetInterval) clearInterval(domQueryResetInterval);
    if (cleanupInterval) clearInterval(cleanupInterval);
    if (memoryCheckInterval) clearInterval(memoryCheckInterval);
    domQueryResetInterval = null;
    cleanupInterval = null;
    memoryCheckInterval = null;
  });

  window.PerformanceBudget = PerformanceBudget;
  window.PerfBudget = PerformanceBudget; // Alias curto

  // Auto-init
  setTimeout(init, 100);

  console.log('[PerfBudget] ⚡ Módulo carregado');

})();
