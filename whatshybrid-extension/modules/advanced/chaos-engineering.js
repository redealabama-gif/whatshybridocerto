/**
 * ADV-014: Chaos Engineering - Testes de resiliência e stress
 * 
 * @version 1.0.0
 * @since 7.9.14
 */

(function() {
  'use strict';

  const CONFIG = {
    STORAGE_KEY: 'whl_chaos_engineering',
    SAFE_MODE: true, // Previne danos reais

    // FIX CRÍTICO: chaos-engineering estava ativo por padrão em produção.
    // O nome do módulo já é um risco — se carregado inadvertidamente, injetava
    // falhas aleatórias silenciosamente. Agora requer opt-in explícito via flag
    // no storage (whl_chaos_enabled=true) para ser inicializado.
    // Em produção (NODE_ENV=production ou ausência de flag), permanece inativo.
    ENABLED_STORAGE_FLAG: 'whl_chaos_enabled'
  };

  const CHAOS_TYPES = {
    LATENCY: 'latency',           // Adiciona delay
    ERROR_RATE: 'error_rate',     // Taxa de erro
    TIMEOUT: 'timeout',           // Simula timeouts
    MEMORY_PRESSURE: 'memory',    // Pressão de memória
    CPU_LOAD: 'cpu'               // Carga de CPU
  };

  class ChaosEngineering {
    constructor() {
      this.experiments = [];
      this.activeExperiments = new Map();
      this.results = [];
      this.originalFunctions = new Map();
      this.initialized = false;
    }

    async init() {
      await this._loadData();
      this.initialized = true;
      console.log('[ChaosEngineering] Initialized - Safe Mode:', CONFIG.SAFE_MODE);
    }

    async _loadData() {
      try {
        const data = await this._getStorage(CONFIG.STORAGE_KEY);
        if (data) {
          this.experiments = data.experiments || [];
          this.results = data.results || [];
        }
      } catch (e) {
        console.warn('[ChaosEngineering] Load failed:', e);
      }
    }

    async _saveData() {
      await this._setStorage(CONFIG.STORAGE_KEY, {
        experiments: this.experiments,
        results: this.results.slice(-100)
      });
    }

    _getStorage(key) {
      return new Promise(r => {
        if (typeof chrome !== 'undefined' && chrome.storage)
          chrome.storage.local.get([key], res => r(res[key]));
        else r(null);
      });
    }

    _setStorage(key, value) {
      return new Promise(r => {
        if (typeof chrome !== 'undefined' && chrome.storage)
          chrome.storage.local.set({ [key]: value }, r);
        else r();
      });
    }

    /**
     * Cria experimento de chaos
     */
    createExperiment(config) {
      const experiment = {
        id: `exp_${Date.now()}`,
        name: config.name || 'Novo Experimento',
        type: config.type || CHAOS_TYPES.LATENCY,
        target: config.target || '*',
        intensity: Math.min(1, Math.max(0, config.intensity || 0.5)),
        duration: config.duration || 60000,
        hypothesis: config.hypothesis || '',
        createdAt: Date.now()
      };

      this.experiments.push(experiment);
      this._saveData();
      return experiment;
    }

    /**
     * Inicia experimento
     */
    start(experimentId) {
      if (!CONFIG.SAFE_MODE) {
        console.error('[ChaosEngineering] Cannot run in production without safe mode!');
        return null;
      }

      const experiment = this.experiments.find(e => e.id === experimentId);
      if (!experiment) throw new Error('Experiment not found');

      if (this.activeExperiments.has(experimentId)) {
        throw new Error('Experiment already running');
      }

      const execution = {
        experimentId,
        startedAt: Date.now(),
        metrics: { before: this._collectMetrics() },
        events: []
      };

      // Aplicar chaos baseado no tipo
      switch (experiment.type) {
        case CHAOS_TYPES.LATENCY:
          this._applyLatencyChaos(experiment, execution);
          break;
        case CHAOS_TYPES.ERROR_RATE:
          this._applyErrorRateChaos(experiment, execution);
          break;
        case CHAOS_TYPES.TIMEOUT:
          this._applyTimeoutChaos(experiment, execution);
          break;
      }

      // Auto-stop após duração
      const timeoutId = setTimeout(() => {
        this.stop(experimentId);
      }, experiment.duration);

      this.activeExperiments.set(experimentId, {
        execution,
        timeoutId,
        experiment
      });

      console.log(`[ChaosEngineering] Started: ${experiment.name}`);
      return execution;
    }

    _applyLatencyChaos(experiment, execution) {
      // SECURITY FIX (PARTIAL-003): Proteção contra falha na restauração
      try {
        // Previne múltiplos overrides simultâneos
        if (this.originalFunctions.has('fetch')) {
          console.warn('[ChaosEngineering] fetch já sobrescrito, pulando');
          return;
        }

        const originalFetch = window.fetch;
        this.originalFunctions.set('fetch', originalFetch);

        window.fetch = async (...args) => {
          try {
            if (Math.random() < experiment.intensity) {
              const delay = Math.min(Math.floor(Math.random() * 3000 + 1000), 5000);
              execution.events.push({
                type: 'latency_injected',
                delay,
                timestamp: Date.now()
              });
              await new Promise(r => setTimeout(r, delay));
            }
            return originalFetch.apply(window, args);
          } catch (err) {
            // Mesmo em erro, chama fetch original
            return originalFetch.apply(window, args);
          }
        };
      } catch (error) {
        console.error('[ChaosEngineering] Erro ao aplicar latency chaos:', error);
        this._restoreOriginalFunctions();
      }
    }

    _applyErrorRateChaos(experiment, execution) {
      // SECURITY FIX (PARTIAL-003): Proteção contra falha na restauração
      try {
        // Previne múltiplos overrides simultâneos
        if (this.originalFunctions.has('fetch')) {
          console.warn('[ChaosEngineering] fetch já sobrescrito, pulando');
          return;
        }

        const originalFetch = window.fetch;
        this.originalFunctions.set('fetch', originalFetch);

        window.fetch = async (...args) => {
          try {
            if (Math.random() < experiment.intensity * 0.3) {
              execution.events.push({
                type: 'error_injected',
                timestamp: Date.now()
              });
              throw new Error('[ChaosEngineering] Simulated network error');
            }
            return originalFetch.apply(window, args);
          } catch (err) {
            // Se foi erro injetado proposital, relança
            if (err.message.includes('[ChaosEngineering]')) {
              throw err;
            }
            // Outros erros: chama fetch original
            return originalFetch.apply(window, args);
          }
        };
      } catch (error) {
        console.error('[ChaosEngineering] Erro ao aplicar error chaos:', error);
        this._restoreOriginalFunctions();
      }
    }

    _applyTimeoutChaos(experiment, execution) {
      // SECURITY FIX (PARTIAL-003): Proteção contra falha na restauração
      try {
        // Previne múltiplos overrides simultâneos
        if (this.originalFunctions.has('fetch')) {
          console.warn('[ChaosEngineering] fetch já sobrescrito, pulando');
          return;
        }

        const originalFetch = window.fetch;
        this.originalFunctions.set('fetch', originalFetch);

        window.fetch = async (...args) => {
          try {
            if (Math.random() < experiment.intensity * 0.2) {
              execution.events.push({
                type: 'timeout_injected',
                timestamp: Date.now()
              });
              // Simular timeout cancelando a requisição
              const controller = new AbortController();
              setTimeout(() => controller.abort(), 100);
              const options = args[1] || {};
              return originalFetch(args[0], { ...options, signal: controller.signal });
            }
            return originalFetch.apply(window, args);
          } catch (err) {
            // Em caso de erro (incluindo timeout), relança
            throw err;
          }
        };
      } catch (error) {
        console.error('[ChaosEngineering] Erro ao aplicar timeout chaos:', error);
        this._restoreOriginalFunctions();
      }
    }

    _collectMetrics() {
      return {
        timestamp: Date.now(),
        memory: performance.memory?.usedJSHeapSize || 0,
        timing: performance.now()
      };
    }

    /**
     * Para experimento
     */
    stop(experimentId) {
      const active = this.activeExperiments.get(experimentId);
      if (!active) return null;

      const { execution, timeoutId, experiment } = active;

      try {
        // Limpar timeout
        clearTimeout(timeoutId);

        // SECURITY FIX (PARTIAL-003): Garantir restauração mesmo em erro
        this._restoreOriginalFunctions();

        // Coletar métricas finais
        execution.metrics.after = this._collectMetrics();
        execution.endedAt = Date.now();
        execution.duration = execution.endedAt - execution.startedAt;

        // Analisar resultado
        const result = this._analyzeResult(experiment, execution);
        this.results.push(result);

        this.activeExperiments.delete(experimentId);
        this._saveData();

        console.log(`[ChaosEngineering] Stopped: ${experiment.name}`);
        return result;
      } catch (error) {
        console.error('[ChaosEngineering] Erro ao parar experimento:', error);
        // Garantir restauração e limpeza mesmo em erro
        this._restoreOriginalFunctions();
        this.activeExperiments.delete(experimentId);
        throw error;
      }
    }

    _restoreOriginalFunctions() {
      // SECURITY FIX (PARTIAL-003): Restauração robusta com try-catch
      try {
        for (const [name, fn] of this.originalFunctions) {
          if (name === 'fetch' && typeof fn === 'function') {
            window.fetch = fn;
          }
        }
        this.originalFunctions.clear();
      } catch (error) {
        console.error('[ChaosEngineering] Erro ao restaurar funções:', error);
        // Tentar limpar mesmo em erro
        this.originalFunctions.clear();
      }
    }

    _analyzeResult(experiment, execution) {
      const { before, after } = execution.metrics;
      
      return {
        id: `result_${Date.now()}`,
        experimentId: experiment.id,
        experimentName: experiment.name,
        type: experiment.type,
        duration: execution.duration,
        eventsCount: execution.events.length,
        hypothesis: experiment.hypothesis,
        metrics: {
          memoryDelta: after.memory - before.memory,
          timingDelta: after.timing - before.timing
        },
        summary: this._generateSummary(execution),
        timestamp: Date.now()
      };
    }

    _generateSummary(execution) {
      const { events } = execution;
      const eventTypes = {};
      
      for (const e of events) {
        eventTypes[e.type] = (eventTypes[e.type] || 0) + 1;
      }

      return {
        totalEvents: events.length,
        eventTypes,
        systemStable: events.length < 10
      };
    }

    /**
     * Para todos os experimentos
     */
    stopAll() {
      for (const expId of this.activeExperiments.keys()) {
        this.stop(expId);
      }
    }

    /**
     * Lista experimentos
     */
    listExperiments() {
      return this.experiments.map(e => ({
        ...e,
        isActive: this.activeExperiments.has(e.id)
      }));
    }

    /**
     * Obtém resultados
     */
    getResults(limit = 20) {
      return this.results.slice(-limit).reverse();
    }

    getStats() {
      return {
        totalExperiments: this.experiments.length,
        activeExperiments: this.activeExperiments.size,
        totalResults: this.results.length,
        safeMode: CONFIG.SAFE_MODE
      };
    }

    destroy() {
      // SECURITY FIX (PARTIAL-003): Cleanup completo e seguro
      try {
        this.stopAll();
        this._restoreOriginalFunctions();
        this.activeExperiments.clear();
        console.log('[ChaosEngineering] Destroyed successfully');
      } catch (error) {
        console.error('[ChaosEngineering] Erro ao destruir:', error);
        // Forçar limpeza mesmo em erro
        this._restoreOriginalFunctions();
        this.activeExperiments.clear();
      }
    }
  }

  const chaos = new ChaosEngineering();

  // FIX CRÍTICO: não inicializa automaticamente.
  // Requer flag explícita no chrome.storage para ativar — nunca roda em produção
  // sem ação deliberada do desenvolvedor.
  async function _initIfEnabled() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        console.warn('[ADV-014] ChaosEngineering: chrome.storage indisponível — módulo desativado');
        return;
      }
      const result = await new Promise(resolve =>
        chrome.storage.local.get([CONFIG.ENABLED_STORAGE_FLAG], resolve)
      );
      if (result[CONFIG.ENABLED_STORAGE_FLAG] === true) {
        await chaos.init();
        console.warn('[ADV-014] ⚠️ ChaosEngineering ATIVADO (opt-in explícito) — apenas para testes');
      } else {
        console.log('[ADV-014] ChaosEngineering desativado (padrão). Para ativar: chrome.storage.local.set({whl_chaos_enabled: true})');
      }
    } catch (e) {
      console.warn('[ADV-014] ChaosEngineering: erro ao verificar flag de ativação:', e);
    }
  }

  _initIfEnabled();

  window.WHLChaosEngineering = chaos;
  window.WHLChaosTypes = CHAOS_TYPES;
  // Não loga "initialized" pois o módulo fica inativo por padrão

})();
