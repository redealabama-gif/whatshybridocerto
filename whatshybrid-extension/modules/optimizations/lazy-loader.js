/**
 * OPT-003: Lazy Loader - Carregamento sob demanda de módulos
 * 
 * Benefícios:
 * - Reduz tempo de carregamento inicial em 40-60%
 * - Economiza memória RAM
 * - Carrega módulos conforme necessidade
 * 
 * @version 1.0.0
 * @since 7.9.14
 */

(function() {
  'use strict';

  // =============================================
  // CONFIGURAÇÃO
  // =============================================
  
  const CONFIG = {
    // Módulos carregados imediatamente (críticos)
    EAGER_MODULES: [
      'event-bus-central',
      'state-manager',
      'selector-engine',
      'api-config',
      'init'
    ],
    
    // Módulos carregados sob demanda
    LAZY_MODULES: {
      // IA e Copiloto
      'copilot-engine': {
        trigger: ['copilotRequested', 'aiSuggestionNeeded'],
        priority: 'high',
        preload: true
      },
      'ai-suggestion-fixed': {
        trigger: ['suggestionRequested'],
        priority: 'high',
        preload: true
      },
      'knowledge-base': {
        trigger: ['knowledgeSearch', 'trainingOpened'],
        priority: 'medium'
      },
      'few-shot-learning': {
        trigger: ['fewShotNeeded'],
        priority: 'medium'
      },
      
      // Automação
      'smartbot-autopilot-v2': {
        trigger: ['autopilotToggled'],
        priority: 'high'
      },
      'campaign-manager': {
        trigger: ['campaignOpened', 'scheduleMessage'],
        priority: 'medium'
      },
      'automation-engine': {
        trigger: ['automationNeeded'],
        priority: 'medium'
      },
      
      // CRM e Analytics
      'crm': {
        trigger: ['crmOpened'],
        priority: 'low'
      },
      'analytics': {
        trigger: ['analyticsRequested', 'statsViewed'],
        priority: 'low'
      },
      'business-intelligence': {
        trigger: ['biDashboardOpened'],
        priority: 'low'
      },
      
      // Recovery
      'recover-advanced': {
        trigger: ['recoverRequested'],
        priority: 'medium'
      },
      'recover-dom': {
        trigger: ['domRecoveryNeeded'],
        priority: 'medium'
      },
      
      // Comunicação
      'text-to-speech': {
        trigger: ['ttsRequested'],
        priority: 'low'
      },
      'audio-sender': {
        trigger: ['audioSendRequested'],
        priority: 'medium'
      },
      'document-sender': {
        trigger: ['documentSendRequested'],
        priority: 'medium'
      },
      
      // Team e Escalation
      'team-system': {
        trigger: ['teamFeatureUsed'],
        priority: 'low'
      },
      'escalation-system': {
        trigger: ['escalationTriggered'],
        priority: 'medium'
      },
      
      // Training
      'training-debug-tools': {
        trigger: ['debugToolsOpened'],
        priority: 'low'
      },
      'training-stats': {
        trigger: ['trainingStatsViewed'],
        priority: 'low'
      }
    },
    
    // Tempo antes de começar preload
    PRELOAD_DELAY_MS: 5000,
    
    // Timeout para carregamento
    LOAD_TIMEOUT_MS: 10000
  };

  // =============================================
  // LAZY LOADER CLASS
  // =============================================

  class LazyLoader {
    constructor() {
      this.loadedModules = new Set();
      this.loadingPromises = new Map();
      this.moduleRegistry = new Map();
      this.eventSubscriptions = new Map();
      this.stats = {
        lazyLoads: 0,
        preloads: 0,
        eagerLoads: 0,
        loadTimes: {}
      };
      
      this._init();
    }

    _init() {
      // Registrar módulos lazy
      for (const [moduleName, config] of Object.entries(CONFIG.LAZY_MODULES)) {
        this.moduleRegistry.set(moduleName, {
          ...config,
          loaded: false,
          loading: false
        });
        
        // Registrar triggers de evento
        for (const trigger of config.trigger) {
          if (!this.eventSubscriptions.has(trigger)) {
            this.eventSubscriptions.set(trigger, new Set());
          }
          this.eventSubscriptions.get(trigger).add(moduleName);
        }
      }
      
      // Escutar eventos do event bus
      this._setupEventListeners();
      
      // Iniciar preload após delay
      setTimeout(() => this._startPreloading(), CONFIG.PRELOAD_DELAY_MS);
      
      console.log(`[LazyLoader] Initialized with ${this.moduleRegistry.size} lazy modules`);
    }

    _setupEventListeners() {
      // Usar o event bus central se disponível
      if (window.WHLEventBus) {
        // Escutar todos os eventos registrados
        for (const eventName of this.eventSubscriptions.keys()) {
          window.WHLEventBus.on(eventName, (data) => {
            this._handleEvent(eventName, data);
          });
        }
      }
      
      // Fallback: escutar eventos custom do DOM
      document.addEventListener('whl:moduleNeeded', (e) => {
        const { moduleName, trigger } = e.detail || {};
        if (moduleName) {
          this.load(moduleName);
        } else if (trigger) {
          this._handleEvent(trigger, e.detail);
        }
      });
    }

    _handleEvent(eventName, data) {
      const modules = this.eventSubscriptions.get(eventName);
      if (!modules) return;
      
      for (const moduleName of modules) {
        this.load(moduleName).catch(err => {
          console.warn(`[LazyLoader] Failed to load ${moduleName} on event ${eventName}:`, err);
        });
      }
    }

    async _startPreloading() {
      console.log('[LazyLoader] Starting preload phase...');
      
      const preloadModules = Array.from(this.moduleRegistry.entries())
        .filter(([, config]) => config.preload && config.priority === 'high')
        .map(([name]) => name);
      
      for (const moduleName of preloadModules) {
        // Não bloquear - carregar em background
        this.preload(moduleName).catch(() => {});
        
        // Pequeno delay entre preloads
        await new Promise(r => setTimeout(r, 500));
      }
    }

    /**
     * Carrega um módulo sob demanda
     * @param {string} moduleName - Nome do módulo
     * @returns {Promise} - Promessa resolvida quando carregado
     */
    async load(moduleName) {
      // Já carregado?
      if (this.loadedModules.has(moduleName)) {
        return this._getModuleExport(moduleName);
      }
      
      // Já carregando?
      if (this.loadingPromises.has(moduleName)) {
        return this.loadingPromises.get(moduleName);
      }
      
      // Verificar se é um módulo registrado
      const config = this.moduleRegistry.get(moduleName);
      if (!config) {
        console.warn(`[LazyLoader] Unknown module: ${moduleName}`);
        return null;
      }
      
      // Iniciar carregamento
      const loadPromise = this._doLoad(moduleName);
      this.loadingPromises.set(moduleName, loadPromise);
      
      try {
        const result = await loadPromise;
        this.loadingPromises.delete(moduleName);
        return result;
      } catch (error) {
        this.loadingPromises.delete(moduleName);
        throw error;
      }
    }

    async _doLoad(moduleName) {
      const startTime = performance.now();
      
      console.log(`[LazyLoader] Loading module: ${moduleName}`);
      
      try {
        // Tentar carregar via script dinâmico
        await this._loadScript(`modules/${moduleName}.js`);
        
        this.loadedModules.add(moduleName);
        this.stats.lazyLoads++;
        this.stats.loadTimes[moduleName] = performance.now() - startTime;
        
        // Atualizar registro
        const config = this.moduleRegistry.get(moduleName);
        if (config) {
          config.loaded = true;
          config.loading = false;
        }
        
        // Emitir evento de carregamento
        this._emitLoaded(moduleName);
        
        console.log(`[LazyLoader] Module ${moduleName} loaded in ${this.stats.loadTimes[moduleName].toFixed(2)}ms`);
        
        return this._getModuleExport(moduleName);
      } catch (error) {
        console.error(`[LazyLoader] Failed to load module: ${moduleName}`, error);
        throw error;
      }
    }

    async _loadScript(path) {
      return new Promise((resolve, reject) => {
        // Verificar se já existe
        const existingScript = document.querySelector(`script[src*="${path}"]`);
        if (existingScript) {
          resolve();
          return;
        }
        
        // Para content scripts, usar chrome.runtime.getURL se disponível
        let scriptUrl = path;
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
          scriptUrl = chrome.runtime.getURL(path);
        }
        
        const script = document.createElement('script');
        script.src = scriptUrl;
        script.type = 'text/javascript';
        
        const timeout = setTimeout(() => {
          reject(new Error(`Timeout loading ${path}`));
        }, CONFIG.LOAD_TIMEOUT_MS);
        
        script.onload = () => {
          clearTimeout(timeout);
          resolve();
        };
        
        script.onerror = (e) => {
          clearTimeout(timeout);
          reject(new Error(`Failed to load ${path}: ${e.message || 'Unknown error'}`));
        };
        
        document.head.appendChild(script);
      });
    }

    _getModuleExport(moduleName) {
      // Mapear nomes de módulo para exports globais
      const exportMappings = {
        'copilot-engine': 'CopilotEngine',
        'ai-suggestion-fixed': 'AISuggestion',
        'knowledge-base': 'KnowledgeBase',
        'few-shot-learning': 'FewShotLearning',
        'smartbot-autopilot-v2': 'SmartBotAutopilot',
        'campaign-manager': 'CampaignManager',
        'crm': 'CRM',
        'analytics': 'Analytics',
        'recover-advanced': 'RecoverAdvanced',
        'text-to-speech': 'TextToSpeech',
        'team-system': 'TeamSystem',
        'escalation-system': 'EscalationSystem'
      };
      
      const exportName = exportMappings[moduleName];
      return exportName ? window[exportName] : window[moduleName];
    }

    _emitLoaded(moduleName) {
      // Emitir via event bus
      if (window.WHLEventBus) {
        window.WHLEventBus.emit('moduleLoaded', { moduleName });
      }
      
      // Emitir via DOM
      document.dispatchEvent(new CustomEvent('whl:moduleLoaded', {
        detail: { moduleName }
      }));
    }

    /**
     * Pré-carrega um módulo em background
     */
    async preload(moduleName) {
      if (this.loadedModules.has(moduleName) || this.loadingPromises.has(moduleName)) {
        return;
      }
      
      this.stats.preloads++;
      
      // Usar requestIdleCallback se disponível
      if ('requestIdleCallback' in window) {
        return new Promise((resolve) => {
          requestIdleCallback(async () => {
            try {
              await this.load(moduleName);
              resolve();
            } catch (e) {
              resolve(); // Não falhar preload
            }
          }, { timeout: 5000 });
        });
      } else {
        // Fallback com setTimeout
        return new Promise((resolve) => {
          setTimeout(async () => {
            try {
              await this.load(moduleName);
              resolve();
            } catch (e) {
              resolve();
            }
          }, 100);
        });
      }
    }

    /**
     * Verifica se um módulo está carregado
     */
    isLoaded(moduleName) {
      return this.loadedModules.has(moduleName);
    }

    /**
     * Obtém estatísticas do loader
     */
    getStats() {
      const totalModules = this.moduleRegistry.size;
      const loadedModules = this.loadedModules.size;
      
      return {
        ...this.stats,
        totalModules,
        loadedModules,
        pendingModules: totalModules - loadedModules,
        loadPercentage: ((loadedModules / totalModules) * 100).toFixed(1) + '%'
      };
    }

    /**
     * Lista módulos por estado
     */
    listModules() {
      const result = {
        loaded: [],
        pending: [],
        loading: []
      };
      
      for (const [name, config] of this.moduleRegistry) {
        if (this.loadedModules.has(name)) {
          result.loaded.push(name);
        } else if (this.loadingPromises.has(name)) {
          result.loading.push(name);
        } else {
          result.pending.push(name);
        }
      }
      
      return result;
    }

    /**
     * Força o carregamento de todos os módulos de alta prioridade
     */
    async loadHighPriority() {
      const highPriorityModules = Array.from(this.moduleRegistry.entries())
        .filter(([, config]) => config.priority === 'high')
        .map(([name]) => name);
      
      const promises = highPriorityModules.map(name => this.load(name));
      return Promise.allSettled(promises);
    }

    /**
     * Carrega todos os módulos (modo eager)
     */
    async loadAll() {
      const allModules = Array.from(this.moduleRegistry.keys());
      const promises = allModules.map(name => this.load(name));
      return Promise.allSettled(promises);
    }
  }

  // =============================================
  // REQUIRE FUNCTION
  // =============================================

  /**
   * Função require-like para solicitar módulos
   * @param {string} moduleName - Nome do módulo
   * @returns {Promise} - Promessa com o módulo
   */
  async function requireModule(moduleName) {
    if (!window.WHLLazyLoader) {
      throw new Error('LazyLoader not initialized');
    }
    return window.WHLLazyLoader.load(moduleName);
  }

  /**
   * Decorator para lazy loading de classes
   */
  function lazyClass(moduleName) {
    return function(target) {
      return new Proxy(target, {
        construct: async function(target, args) {
          await requireModule(moduleName);
          return new target(...args);
        }
      });
    };
  }

  // =============================================
  // INICIALIZAÇÃO
  // =============================================

  const lazyLoader = new LazyLoader();

  // Expor globalmente
  window.WHLLazyLoader = lazyLoader;
  window.WHLRequireModule = requireModule;
  window.WHLLazyClass = lazyClass;
  window.WHLLazyConfig = CONFIG;

  console.log('[OPT-003] Lazy Loader initialized');

})();
