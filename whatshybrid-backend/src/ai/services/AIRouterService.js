/**
 * 🧠 AI Router Service - Roteamento inteligente entre providers
 * WhatsHybrid Pro v7.1.0
 * 
 * Features:
 * - Multiple providers (OpenAI, Anthropic, Groq, Google, etc.)
 * - Automatic fallback on failures
 * - Cost optimization
 * - Load balancing
 * - Circuit breaker per provider
 * - Caching
 */

const OpenAIProvider = require('../providers/OpenAIProvider');
const AnthropicProvider = require('../providers/AnthropicProvider');
const GroqProvider = require('../providers/GroqProvider');
const logger = require('../../utils/logger');

// Routing strategies
const STRATEGIES = {
  COST_OPTIMIZED: 'cost_optimized',
  SPEED_OPTIMIZED: 'speed_optimized',
  QUALITY_OPTIMIZED: 'quality_optimized',
  BALANCED: 'balanced',
  FAILOVER: 'failover',
  ROUND_ROBIN: 'round_robin'
};

// Provider priority for each strategy
const STRATEGY_PRIORITY = {
  [STRATEGIES.COST_OPTIMIZED]: ['groq', 'openai', 'anthropic'],
  [STRATEGIES.SPEED_OPTIMIZED]: ['groq', 'openai', 'anthropic'],
  [STRATEGIES.QUALITY_OPTIMIZED]: ['anthropic', 'openai', 'groq'],
  [STRATEGIES.BALANCED]: ['openai', 'anthropic', 'groq'],
  [STRATEGIES.FAILOVER]: ['openai', 'anthropic', 'groq'],
  [STRATEGIES.ROUND_ROBIN]: ['openai', 'anthropic', 'groq']
};

class AIRouterService {
  constructor(config = {}) {
    this.config = config;
    this.providers = new Map();
    this.strategy = config.strategy || STRATEGIES.BALANCED;
    this.roundRobinIndex = 0;

    // Cooldown por provider (quando detectamos auth/rate-limit/timeout)
    // name -> timestamp(ms) até quando deve ser evitado
    this.providerCooldownUntil = new Map();

    // v9.2.0: Circuit breaker — pula provider após N falhas consecutivas
    // (independente do tipo de erro)
    this.consecutiveFailures = new Map();   // name -> count
    this.lastSuccess = new Map();           // name -> timestamp
    this.CIRCUIT_BREAKER_THRESHOLD = parseInt(process.env.AI_CIRCUIT_BREAKER_THRESHOLD, 10) || 5;
    this.CIRCUIT_BREAKER_COOLDOWN_MS = parseInt(process.env.AI_CIRCUIT_BREAKER_COOLDOWN_MS, 10) || 60_000;
    
    // Cache for responses
    this.cache = new Map();
    this.cacheEnabled = config.cacheEnabled ?? true;
    this.cacheTTL = config.cacheTTL || 3600000; // 1 hour
    
    // Initialize providers
    this.initializeProviders(config);
    
    // Metrics
    this.metrics = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      fallbacks: 0,
      errors: 0
    };
    
    // FIX: cleanup periódico para liberar memória de entradas expiradas
    // Antes, só FIFO removia entradas — TTLs vencidos ocupavam slots desnecessariamente.
    this._cacheCleanupTimer = setInterval(() => this._cleanupExpiredCache(), 10 * 60 * 1000);
    if (this._cacheCleanupTimer.unref) this._cacheCleanupTimer.unref();
    
    logger.info('[AIRouter] ✅ Initialized with strategy:', this.strategy);
  }

  // ============================================================
  // Classificação de erros (MED-006)
  // ============================================================

  /**
   * Retorna status HTTP se existir no erro (providers setam err.status)
   */
  _getErrorStatus(error) {
    return error?.status || error?.response?.status || error?.code || null;
  }

  /**
   * Classifica erros para ação inteligente (auth/rate_limit/server/timeout/unknown)
   */
  classifyError(error, providerName) {
    const status = this._getErrorStatus(error);
    const msg = String(error?.message || '').toLowerCase();

    if (status === 401 || status === 403 || msg.includes('api key') || msg.includes('unauthorized')) {
      return { type: 'auth', action: 'cooldown', durationMs: 24 * 60 * 60 * 1000, provider: providerName };
    }
    if (status === 429 || msg.includes('rate limit') || msg.includes('quota')) {
      return { type: 'rate_limit', action: 'cooldown', durationMs: 60 * 60 * 1000, provider: providerName };
    }
    if (status && Number(status) >= 500) {
      return { type: 'server', action: 'cooldown', durationMs: 30 * 1000, provider: providerName };
    }
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) {
      return { type: 'timeout', action: 'cooldown', durationMs: 2 * 60 * 1000, provider: providerName };
    }
    return { type: 'unknown', action: 'none', durationMs: 0, provider: providerName };
  }

  _applyErrorPolicy(classification) {
    if (!classification || classification.action !== 'cooldown') return;
    const until = Date.now() + (classification.durationMs || 0);
    this.providerCooldownUntil.set(classification.provider, until);
  }

  _isCoolingDown(providerName) {
    // Tipo-específico (auth/rate_limit/server/timeout)
    const until = this.providerCooldownUntil.get(providerName);
    if (until) {
      if (Date.now() > until) {
        this.providerCooldownUntil.delete(providerName);
      } else {
        return true;
      }
    }

    // v9.2.0: Circuit breaker por falhas consecutivas
    const failures = this.consecutiveFailures.get(providerName) || 0;
    if (failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      const lastFailure = this.lastSuccess.get(providerName + ':last_failure_at');
      if (lastFailure && (Date.now() - lastFailure) < this.CIRCUIT_BREAKER_COOLDOWN_MS) {
        return true;
      }
      // Cooldown expirou — dá uma chance ao provider (half-open)
      logger.info(`[AIRouter] Circuit breaker half-open for ${providerName} (${failures} failures)`);
    }

    return false;
  }

  /**
   * v9.2.0: registra sucesso e reseta contador de falhas
   */
  _recordProviderSuccess(providerName) {
    this.consecutiveFailures.set(providerName, 0);
    this.lastSuccess.set(providerName, Date.now());
  }

  /**
   * v9.2.0: registra falha e abre circuito se threshold for atingido
   */
  _recordProviderFailure(providerName) {
    const current = (this.consecutiveFailures.get(providerName) || 0) + 1;
    this.consecutiveFailures.set(providerName, current);
    this.lastSuccess.set(providerName + ':last_failure_at', Date.now());

    if (current === this.CIRCUIT_BREAKER_THRESHOLD) {
      logger.warn(`[AIRouter] 🔌 Circuit breaker OPEN for ${providerName} after ${current} consecutive failures`);
      // Alert
      try {
        const alertManager = require('../../observability/alertManager');
        alertManager?.send?.('warning', `🔌 AI provider down: ${providerName}`, {
          consecutive_failures: current,
          cooldown_seconds: Math.round(this.CIRCUIT_BREAKER_COOLDOWN_MS / 1000),
        });
      } catch (_) {}
    }
  }

  /**
   * Initialize all available providers
   */
  initializeProviders(config) {
    // OpenAI
    if (config.openai?.apiKey || process.env.OPENAI_API_KEY) {
      this.providers.set('openai', new OpenAIProvider(config.openai || {}));
      logger.info('[AIRouter] ✅ OpenAI provider configured');
    }

    // Anthropic
    if (config.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY) {
      this.providers.set('anthropic', new AnthropicProvider(config.anthropic || {}));
      logger.info('[AIRouter] ✅ Anthropic provider configured');
    }

    // Groq
    if (config.groq?.apiKey || process.env.GROQ_API_KEY) {
      this.providers.set('groq', new GroqProvider(config.groq || {}));
      logger.info('[AIRouter] ✅ Groq provider configured');
    }

    logger.info(`[AIRouter] Total providers: ${this.providers.size}`);
  }

  /**
   * Add or update a provider
   */
  setProvider(name, config) {
    let provider;
    switch (name) {
      case 'openai':
        provider = new OpenAIProvider(config);
        break;
      case 'anthropic':
        provider = new AnthropicProvider(config);
        break;
      case 'groq':
        provider = new GroqProvider(config);
        break;
      default:
        throw new Error(`Unknown provider: ${name}`);
    }
    this.providers.set(name, provider);
    return provider;
  }

  /**
   * Get a specific provider
   */
  getProvider(name) {
    return this.providers.get(name);
  }

  /**
   * Get all configured providers
   */
  getConfiguredProviders() {
    const result = [];
    for (const [name, provider] of this.providers) {
      if (provider.isConfigured()) {
        result.push({
          name,
          displayName: provider.displayName,
          models: provider.getModels(),
          defaultModel: provider.getDefaultModel(),
          isAvailable: provider.isAvailable(),
          metrics: provider.getMetrics()
        });
      }
    }
    return result;
  }

  /**
   * P8 FIX: Returns the canonical active-provider list in the format consumed by
   * the extension's ai-gateway.js syncProvidersWithBackend().
   * This is the single source of truth — the extension syncs against this.
   *
   * @returns {{ activeProviders: Array<{id, priority, enabled, defaultModel}> }}
   */
  getActiveProvidersForExtension() {
    const providerPriorityMap = { openai: 1, anthropic: 2, groq: 3, google: 4 };
    const activeProviders = [];

    for (const [name, provider] of this.providers) {
      activeProviders.push({
        id: name,
        priority: providerPriorityMap[name] ?? 99,
        enabled: provider.isConfigured() && provider.isAvailable(),
        defaultModel: provider.getDefaultModel ? provider.getDefaultModel() : null,
      });
    }

    // Sort by priority so the extension can directly apply this order
    activeProviders.sort((a, b) => a.priority - b.priority);
    return { activeProviders };
  }

  /**
   * Set routing strategy
   */
  setStrategy(strategy) {
    if (!STRATEGIES[strategy] && !Object.values(STRATEGIES).includes(strategy)) {
      throw new Error(`Unknown strategy: ${strategy}`);
    }
    this.strategy = strategy;
  }

  /**
   * Get next provider based on strategy
   */
  getNextProvider(preferredProvider = null) {
    // If preferred provider is specified and available, use it
    if (preferredProvider) {
      const provider = this.providers.get(preferredProvider);
      if (provider?.isConfigured() && provider?.isAvailable() && !this._isCoolingDown(provider.name)) {
        return provider;
      }
    }

    // Get priority list based on strategy
    const priority = STRATEGY_PRIORITY[this.strategy] || STRATEGY_PRIORITY[STRATEGIES.BALANCED];
    
    // Round robin special handling
    if (this.strategy === STRATEGIES.ROUND_ROBIN) {
      const available = priority.filter(name => {
        const p = this.providers.get(name);
        return p?.isConfigured() && p?.isAvailable();
      });
      
      if (available.length === 0) return null;
      
      const providerName = available[this.roundRobinIndex % available.length];
      this.roundRobinIndex++;
      return this.providers.get(providerName);
    }

    // Find first available provider in priority order
    for (const name of priority) {
      const provider = this.providers.get(name);
      if (provider?.isConfigured() && provider?.isAvailable() && !this._isCoolingDown(provider.name)) {
        return provider;
      }
    }

    return null;
  }

  /**
   * Get fallback providers (excluding the one that failed)
   */
  getFallbackProviders(excludeProvider) {
    const priority = STRATEGY_PRIORITY[this.strategy] || STRATEGY_PRIORITY[STRATEGIES.BALANCED];
    
    return priority
      .filter(name => name !== excludeProvider)
      .map(name => this.providers.get(name))
      .filter(p => p?.isConfigured() && p?.isAvailable() && !this._isCoolingDown(p.name));
  }

  /**
   * Generate cache key
   * FIX: tenantId incluído na chave para impedir cross-tenant cache poisoning
   */
  getCacheKey(messages, options) {
    const messagesStr = JSON.stringify(messages);
    const optionsStr = JSON.stringify({
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens
    });
    const tenant = options.tenantId || options.tenant || 'default';
    return `${tenant}:${messagesStr}:${optionsStr}`;
  }

  /**
   * Check cache
   * FIX: agora também limpa entradas expiradas oportunisticamente em cada lookup
   */
  checkCache(key) {
    if (!this.cacheEnabled) return null;
    
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    // Check if expired
    if (Date.now() > cached.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.response;
  }

  /**
   * Limpa entradas expiradas (executado periodicamente para liberar memória)
   */
  _cleanupExpiredCache() {
    if (!this.cacheEnabled || this.cache.size === 0) return;
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }
    if (removed > 0) logger.debug(`[AIRouter] Cache cleanup: ${removed} entries expired`);
  }

  /**
   * Store in cache
   */
  setCache(key, response) {
    if (!this.cacheEnabled) return;
    
    this.cache.set(key, {
      response,
      expiresAt: Date.now() + this.cacheTTL
    });
    
    // Limit cache size
    if (this.cache.size > 1000) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  /**
   * Main completion method with automatic routing and fallback.
   *
   * v8.1.0 OBSERVABILITY: registra cada chamada na tabela ai_requests
   * com tokens, latência, e custo. Tudo automático — não precisa instrumentar
   * cada caller. Habilita /metrics/cost e /metrics/errors.
   */
  async complete(messages, options = {}) {
    this.metrics.totalRequests++;
    
    const startTime = Date.now();
    const tenantId = options.tenantId || 'default';
    const requestId = options.requestId || null;
    let trackingResult = { provider: null, model: null, status: 'success', error_message: null,
                            prompt_tokens: 0, completion_tokens: 0, fromCache: false };
    
    // Check cache first
    const cacheKey = this.getCacheKey(messages, options);
    const cached = this.checkCache(cacheKey);
    if (cached) {
      this.metrics.cacheHits++;
      trackingResult.fromCache = true;
      this._trackRequest(tenantId, requestId, cached, Date.now() - startTime, trackingResult);
      return { ...cached, cached: true };
    }
    this.metrics.cacheMisses++;

    // Get provider
    let provider = this.getNextProvider(options.provider);
    
    if (!provider) {
      this.metrics.errors++;
      trackingResult.status = 'error';
      trackingResult.error_message = 'No AI provider available';
      this._trackRequest(tenantId, requestId, null, Date.now() - startTime, trackingResult);
      throw new Error('No AI provider available');
    }

    // Try primary provider
    try {
      const result = await provider.complete(messages, options);
      this._recordProviderSuccess(provider.name); // v9.2.0
      trackingResult.provider = provider.name;
      trackingResult.model = result.model || options.model || provider.name;
      trackingResult.prompt_tokens = result.usage?.promptTokens || result.usage?.prompt_tokens || 0;
      trackingResult.completion_tokens = result.usage?.completionTokens || result.usage?.completion_tokens || 0;
      this.setCache(cacheKey, result);
      this._trackRequest(tenantId, requestId, result, Date.now() - startTime, trackingResult);
      return result;
    } catch (error) {
      logger.warn(`[AIRouter] ${provider.name} failed: ${error.message}`);
      this._applyErrorPolicy(this.classifyError(error, provider.name));
      this._recordProviderFailure(provider.name); // v9.2.0
      
      // Try fallback providers
      const fallbacks = this.getFallbackProviders(provider.name);
      
      for (const fallback of fallbacks) {
        try {
          logger.info(`[AIRouter] Trying fallback: ${fallback.name}`);
          this.metrics.fallbacks++;
          
          const result = await fallback.complete(messages, {
            ...options,
            model: undefined // Use fallback's default model
          });
          this._recordProviderSuccess(fallback.name); // v9.2.0

          result.fallbackFrom = provider.name;
          trackingResult.provider = fallback.name;
          trackingResult.model = result.model || fallback.name;
          trackingResult.prompt_tokens = result.usage?.promptTokens || result.usage?.prompt_tokens || 0;
          trackingResult.completion_tokens = result.usage?.completionTokens || result.usage?.completion_tokens || 0;
          this.setCache(cacheKey, result);
          this._trackRequest(tenantId, requestId, result, Date.now() - startTime, trackingResult);
          return result;
        } catch (fallbackError) {
          logger.warn(`[AIRouter] Fallback ${fallback.name} failed: ${fallbackError.message}`);
          this._applyErrorPolicy(this.classifyError(fallbackError, fallback.name));
          this._recordProviderFailure(fallback.name); // v9.2.0
        }
      }
      
      // All providers failed
      this.metrics.errors++;
      trackingResult.status = 'error';
      trackingResult.error_message = error.message;
      trackingResult.provider = provider.name;
      this._trackRequest(tenantId, requestId, null, Date.now() - startTime, trackingResult);
      
      // v8.1.0: Alerta crítico — todos os providers falharam.
      // O alertManager faz rate limit interno (max 5/h) para não spammar.
      try {
        const alertManager = require('../../observability/alertManager');
        alertManager.send('critical', 'AIRouter: todos os providers falharam', {
          tenant: tenantId,
          last_error: error.message,
          attempted_providers: [provider.name, ...fallbacks.map(f => f.name)],
        });
      } catch (_) {}
      
      throw new Error(`All AI providers failed. Last error: ${error.message}`);
    }
  }

  /**
   * Registra request no banco para o /metrics/cost e /metrics/errors funcionarem.
   * Falha silenciosa: se o banco estiver indisponível, não bloqueia a resposta.
   *
   * v8.4.0 — também debita tokens do saldo do workspace via TokenService.
   */
  _trackRequest(tenantId, requestId, result, latencyMs, info) {
    try {
      const db = require('../../utils/database');
      db.run(
        `INSERT INTO ai_requests
         (workspace_id, model, prompt_tokens, completion_tokens, latency_ms, status, error_message, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          tenantId,
          info.model || 'unknown',
          info.prompt_tokens || 0,
          info.completion_tokens || 0,
          latencyMs,
          info.status || 'success',
          info.error_message || null,
          requestId,
        ]
      );
    } catch (err) {
      // Falha silenciosa: tracking não deve bloquear resposta ao cliente
      logger.debug(`[AIRouter] _trackRequest skipped: ${err.message}`);
    }

    // v8.4.0 — Débito de tokens do saldo do workspace.
    // Falha silenciosa: tracking de saldo não deve quebrar AI quando ainda em testes.
    // Nota: esta lógica só debita se for sucesso (status 'success').
    if ((info.status || 'success') === 'success' && tenantId) {
      try {
        const tokenService = require('../../services/TokenService');
        const totalTokens = (info.prompt_tokens || 0) + (info.completion_tokens || 0);
        if (totalTokens > 0) {
          tokenService.consume(tenantId, totalTokens, {
            ai_request_id: requestId,
            model: info.model,
            prompt_tokens: info.prompt_tokens,
            completion_tokens: info.completion_tokens,
            description: `AI request: ${info.model || 'unknown'}`,
          });
        }
      } catch (err) {
        // Em primeira execução, workspace_credits pode não existir.
        // Não bloqueia a resposta — apenas loga.
        logger.debug(`[AIRouter] token debit skipped: ${err.message}`);
      }
    }
  }

  /**
   * Streaming completion
   */
  async *stream(messages, options = {}) {
    const provider = this.getNextProvider(options.provider);
    
    if (!provider) {
      throw new Error('No AI provider available');
    }

    try {
      for await (const chunk of provider.stream(messages, options)) {
        yield chunk;
      }
    } catch (error) {
      // Try fallback for streaming
      const fallbacks = this.getFallbackProviders(provider.name);
      
      for (const fallback of fallbacks) {
        try {
          for await (const chunk of fallback.stream(messages, {
            ...options,
            model: undefined
          })) {
            yield chunk;
          }
          return;
        } catch (fallbackError) {
          logger.warn(`[AIRouter] Streaming fallback ${fallback.name} failed`);
        }
      }
      
      throw error;
    }
  }

  /**
   * Get embeddings (from provider that supports it)
   */
  async embed(text, options = {}) {
    // OpenAI has the best embeddings
    const openai = this.providers.get('openai');
    if (openai?.isConfigured()) {
      return openai.embed(text, options);
    }
    
    throw new Error('No embedding provider available');
  }

  /**
   * Health check all providers
   */
  async healthCheck() {
    const results = {};
    
    for (const [name, provider] of this.providers) {
      if (provider.isConfigured()) {
        results[name] = await provider.healthCheck();
      } else {
        results[name] = { healthy: false, error: 'Not configured' };
      }
    }
    
    return results;
  }

  /**
   * Get router metrics
   */
  getMetrics() {
    const providerMetrics = {};
    for (const [name, provider] of this.providers) {
      providerMetrics[name] = provider.getMetrics();
    }
    
    return {
      router: this.metrics,
      providers: providerMetrics,
      strategy: this.strategy,
      cacheSize: this.cache.size
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get available models across all providers
   */
  getAllModels() {
    const models = [];
    
    for (const [providerName, provider] of this.providers) {
      if (provider.isConfigured()) {
        for (const model of provider.getModels()) {
          models.push({
            ...model,
            provider: providerName,
            providerDisplayName: provider.displayName
          });
        }
      }
    }
    
    return models;
  }
}

// FIX FATAL: O singleton anterior era criado na IMPORTAÇÃO do módulo, antes do dotenv
// rodar em alguns paths de require. Resultado: providers vazios mesmo com env vars setadas.
// Solução: lazy initialization via Proxy — a instância é criada na primeira chamada.
//
// Compatibilidade: consumidores antigos (`AIRouter.complete()`, `AIRouter.healthCheck()`)
// continuam funcionando via Proxy. Novos consumidores podem usar `AIRouterService.getInstance()`.
//
// IMPORTANTE: as propriedades especiais (AIRouterService, STRATEGIES, getInstance) são
// servidas pelo handler `get` ANTES de tocar na instância — não fazer atribuições via
// `module.exports.X = ...` aqui, pois o set handler dispararia getInstance() na carga
// do módulo, anulando a lazy initialization.

let _instance = null;
function getInstance() {
  if (!_instance) {
    _instance = new AIRouterService();
  }
  return _instance;
}

const proxyHandler = {
  get(_target, prop) {
    if (prop === 'AIRouterService') return AIRouterService;
    if (prop === 'STRATEGIES') return STRATEGIES;
    if (prop === 'getInstance') return getInstance;
    // Symbols and node-internal props (util.inspect, etc.) — return undefined sem instanciar
    if (typeof prop === 'symbol') return undefined;
    const inst = getInstance();
    const value = inst[prop];
    return typeof value === 'function' ? value.bind(inst) : value;
  },
  set(_target, prop, value) {
    const inst = getInstance();
    inst[prop] = value;
    return true;
  },
  has(_target, prop) {
    if (prop === 'AIRouterService' || prop === 'STRATEGIES' || prop === 'getInstance') return true;
    return prop in getInstance();
  },
  ownKeys() {
    return ['AIRouterService', 'STRATEGIES', 'getInstance'];
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (prop === 'AIRouterService' || prop === 'STRATEGIES' || prop === 'getInstance') {
      return { enumerable: true, configurable: true, writable: false };
    }
    return undefined;
  }
};

module.exports = new Proxy({}, proxyHandler);
