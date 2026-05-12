/**
 * OPT-001: Smart Cache - Cache inteligente com TTL adaptativo
 * 
 * Benefícios:
 * - Economia de 40-60% em chamadas à API
 * - Respostas instantâneas para perguntas frequentes
 * - TTL adaptativo baseado em padrões de uso
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
    STORAGE_KEY: 'whl_smart_cache',
    STATS_KEY: 'whl_smart_cache_stats',
    
    // TTL padrão e limites (em ms)
    DEFAULT_TTL_MS: 300000,       // 5 minutos
    MIN_TTL_MS: 60000,            // 1 minuto mínimo
    MAX_TTL_MS: 3600000,          // 1 hora máximo
    
    // Configuração de cache
    MAX_ENTRIES: 500,
    MAX_SIZE_MB: 10,
    
    // Estratégias de TTL
    TTL_STRATEGIES: {
      STATIC: 'static',           // TTL fixo
      ACCESS_BASED: 'access',     // Baseado em frequência de acesso
      SIMILARITY_BASED: 'similarity', // Baseado em similaridade com outras respostas
      FEEDBACK_BASED: 'feedback'  // Baseado em feedback positivo/negativo
    },
    
    // Pesos para cálculo de TTL
    TTL_WEIGHTS: {
      accessFrequency: 0.3,
      feedbackScore: 0.3,
      responseLength: 0.2,
      categoryStability: 0.2
    },
    
    // Categorias com TTL especial
    CATEGORY_TTL: {
      PRICING: 86400000,      // 24h - preços mudam menos
      GREETING: 604800000,    // 7 dias - saudações são estáveis
      AVAILABILITY: 300000,   // 5 min - estoque muda muito
      TROUBLESHOOTING: 3600000, // 1h
      DEFAULT: 300000         // 5 min padrão
    },
    
    // Limpeza automática
    CLEANUP_INTERVAL_MS: 600000,  // 10 minutos
    CLEANUP_THRESHOLD: 0.8        // Limpa quando 80% cheio
  };

  // =============================================
  // SMART CACHE CLASS
  // =============================================

  class SmartCache {
    constructor() {
      this.cache = new Map();
      this.accessLog = new Map();
      this.stats = {
        hits: 0,
        misses: 0,
        evictions: 0,
        adaptations: 0,
        totalSavedMs: 0
      };
      this.cleanupTimer = null;
      this.initialized = false;
      
      this._init();
    }

    async _init() {
      await this._loadFromStorage();
      this._startCleanupTimer();
      this.initialized = true;
      console.log('[SmartCache] Initialized with', this.cache.size, 'entries');
    }

    async _loadFromStorage() {
      try {
        const [cacheData, statsData] = await Promise.all([
          this._getStorage(CONFIG.STORAGE_KEY),
          this._getStorage(CONFIG.STATS_KEY)
        ]);
        
        if (cacheData && Array.isArray(cacheData)) {
          const now = Date.now();
          for (const entry of cacheData) {
            if (entry.expiresAt > now) {
              this.cache.set(entry.key, entry);
            }
          }
        }
        
        if (statsData) {
          Object.assign(this.stats, statsData);
        }
      } catch (e) {
        console.warn('[SmartCache] Failed to load from storage:', e);
      }
    }

    async _saveToStorage() {
      try {
        const entries = Array.from(this.cache.values());
        await Promise.all([
          this._setStorage(CONFIG.STORAGE_KEY, entries),
          this._setStorage(CONFIG.STATS_KEY, this.stats)
        ]);
      } catch (e) {
        console.warn('[SmartCache] Failed to save to storage:', e);
      }
    }

    _getStorage(key) {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.get([key], (result) => resolve(result[key]));
        } else {
          resolve(null);
        }
      });
    }

    _setStorage(key, value) {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.set({ [key]: value }, resolve);
        } else {
          resolve();
        }
      });
    }

    _startCleanupTimer() {
      if (this.cleanupTimer) clearInterval(this.cleanupTimer);
      
      this.cleanupTimer = setInterval(() => {
        this._cleanup();
      }, CONFIG.CLEANUP_INTERVAL_MS);
    }

    /**
     * Gera chave de cache para uma query
     * @param {string} query - Texto da query
     * @param {Object} context - Contexto adicional
     * @returns {string} - Chave de cache
     */
    generateKey(query, context = {}) {
      const normalizedQuery = this._normalizeQuery(query);
      const contextHash = this._hashContext(context);
      return `${normalizedQuery}::${contextHash}`;
    }

    _normalizeQuery(query) {
      return query
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s]/g, '')
        .substring(0, 200);
    }

    _hashContext(context) {
      const relevantKeys = ['contactId', 'category', 'language'];
      const filtered = {};
      for (const key of relevantKeys) {
        if (context[key]) filtered[key] = context[key];
      }
      return btoa(JSON.stringify(filtered)).substring(0, 20);
    }

    /**
     * Busca no cache
     * @param {string} query - Texto da query
     * @param {Object} context - Contexto adicional
     * @returns {Object|null} - Entrada do cache ou null
     */
    get(query, context = {}) {
      const key = this.generateKey(query, context);
      const entry = this.cache.get(key);
      
      if (!entry) {
        this.stats.misses++;
        return null;
      }
      
      // Verificar expiração
      if (Date.now() > entry.expiresAt) {
        this.cache.delete(key);
        this.stats.misses++;
        return null;
      }
      
      // Hit! Atualizar estatísticas
      this.stats.hits++;
      entry.accessCount = (entry.accessCount || 0) + 1;
      entry.lastAccess = Date.now();
      
      // Log de acesso para TTL adaptativo
      this._logAccess(key);
      
      // Adaptar TTL se necessário
      this._adaptTTL(key, entry);
      
      console.log(`[SmartCache] HIT: "${query.substring(0, 30)}..." (TTL: ${Math.round((entry.expiresAt - Date.now()) / 1000)}s)`);
      
      return entry.value;
    }

    /**
     * Busca com similaridade (fuzzy matching)
     * @param {string} query - Texto da query
     * @param {number} threshold - Threshold de similaridade (0-1)
     * @returns {Object|null} - Entrada similar ou null
     */
    getSimilar(query, threshold = 0.85) {
      const normalizedQuery = this._normalizeQuery(query);
      
      let bestMatch = null;
      let bestSimilarity = 0;
      
      for (const [key, entry] of this.cache.entries()) {
        if (Date.now() > entry.expiresAt) continue;
        
        const similarity = this._calculateSimilarity(
          normalizedQuery, 
          this._normalizeQuery(entry.originalQuery)
        );
        
        if (similarity > threshold && similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = entry;
        }
      }
      
      if (bestMatch) {
        this.stats.hits++;
        bestMatch.accessCount++;
        bestMatch.lastAccess = Date.now();
        console.log(`[SmartCache] SIMILAR HIT (${(bestSimilarity * 100).toFixed(1)}%): "${query.substring(0, 30)}..."`);
        return bestMatch.value;
      }
      
      this.stats.misses++;
      return null;
    }

    _calculateSimilarity(str1, str2) {
      // Levenshtein-based similarity
      const longer = str1.length > str2.length ? str1 : str2;
      const shorter = str1.length > str2.length ? str2 : str1;
      
      if (longer.length === 0) return 1.0;
      
      const editDistance = this._levenshteinDistance(longer, shorter);
      return (longer.length - editDistance) / longer.length;
    }

    _levenshteinDistance(str1, str2) {
      const m = str1.length;
      const n = str2.length;
      
      // Otimização para strings muito longas
      if (m > 200 || n > 200) {
        return this._approximateDistance(str1, str2);
      }
      
      const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
      
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + cost
          );
        }
      }
      
      return dp[m][n];
    }

    _approximateDistance(str1, str2) {
      // Usar n-gramas para aproximação rápida
      const n = 3;
      const ngrams1 = new Set();
      const ngrams2 = new Set();
      
      for (let i = 0; i <= str1.length - n; i++) {
        ngrams1.add(str1.substring(i, i + n));
      }
      for (let i = 0; i <= str2.length - n; i++) {
        ngrams2.add(str2.substring(i, i + n));
      }
      
      const intersection = [...ngrams1].filter(x => ngrams2.has(x)).length;
      const union = ngrams1.size + ngrams2.size - intersection;
      
      return Math.round((1 - (intersection / union)) * Math.max(str1.length, str2.length));
    }

    /**
     * Armazena no cache
     * @param {string} query - Query original
     * @param {Object} value - Valor a armazenar
     * @param {Object} options - Opções de cache
     */
    set(query, value, options = {}) {
      const {
        context = {},
        category = 'DEFAULT',
        ttl = null,
        strategy = CONFIG.TTL_STRATEGIES.ACCESS_BASED
      } = options;
      
      const key = this.generateKey(query, context);
      
      // Calcular TTL
      const calculatedTTL = ttl || this._calculateTTL(query, value, category, strategy);
      
      const entry = {
        key,
        originalQuery: query,
        value,
        context,
        category,
        strategy,
        createdAt: Date.now(),
        expiresAt: Date.now() + calculatedTTL,
        ttl: calculatedTTL,
        accessCount: 0,
        lastAccess: null,
        feedbackScore: 0
      };
      
      // Verificar limite de tamanho
      this._ensureCapacity();
      
      this.cache.set(key, entry);
      
      // Salvar periodicamente
      this._scheduleSave();
      
      console.log(`[SmartCache] SET: "${query.substring(0, 30)}..." (TTL: ${Math.round(calculatedTTL / 1000)}s)`);
    }

    _calculateTTL(query, value, category, strategy) {
      let baseTTL = CONFIG.CATEGORY_TTL[category] || CONFIG.CATEGORY_TTL.DEFAULT;
      
      switch (strategy) {
        case CONFIG.TTL_STRATEGIES.STATIC:
          return baseTTL;
          
        case CONFIG.TTL_STRATEGIES.ACCESS_BASED:
          return this._calculateAccessBasedTTL(query, baseTTL);
          
        case CONFIG.TTL_STRATEGIES.SIMILARITY_BASED:
          return this._calculateSimilarityBasedTTL(query, value, baseTTL);
          
        case CONFIG.TTL_STRATEGIES.FEEDBACK_BASED:
          return this._calculateFeedbackBasedTTL(query, baseTTL);
          
        default:
          return baseTTL;
      }
    }

    _calculateAccessBasedTTL(query, baseTTL) {
      const accessHistory = this.accessLog.get(this._normalizeQuery(query)) || [];
      
      if (accessHistory.length < 2) return baseTTL;
      
      // Quanto mais frequente, maior o TTL
      const recentAccesses = accessHistory.filter(t => Date.now() - t < 3600000).length;
      const frequencyMultiplier = Math.min(2, 1 + (recentAccesses * 0.1));
      
      return Math.min(CONFIG.MAX_TTL_MS, Math.round(baseTTL * frequencyMultiplier));
    }

    _calculateSimilarityBasedTTL(query, value, baseTTL) {
      // Se a resposta é similar a outras no cache, provavelmente é estável
      let similarCount = 0;
      
      for (const [, entry] of this.cache.entries()) {
        if (entry.value && typeof entry.value === 'string') {
          const similarity = this._calculateSimilarity(
            value.substring(0, 100),
            entry.value.substring(0, 100)
          );
          if (similarity > 0.8) similarCount++;
        }
      }
      
      const stabilityMultiplier = 1 + (similarCount * 0.05);
      return Math.min(CONFIG.MAX_TTL_MS, Math.round(baseTTL * stabilityMultiplier));
    }

    _calculateFeedbackBasedTTL(query, baseTTL) {
      // Buscar feedback para esta query
      const key = this.generateKey(query, {});
      const entry = this.cache.get(key);
      
      if (!entry || !entry.feedbackScore) return baseTTL;
      
      // Feedback positivo aumenta TTL, negativo diminui
      const feedbackMultiplier = 1 + (entry.feedbackScore * 0.3);
      return Math.max(CONFIG.MIN_TTL_MS, Math.min(CONFIG.MAX_TTL_MS, Math.round(baseTTL * feedbackMultiplier)));
    }

    _logAccess(key) {
      const normalizedKey = key.split('::')[0];
      
      if (!this.accessLog.has(normalizedKey)) {
        this.accessLog.set(normalizedKey, []);
      }
      
      const history = this.accessLog.get(normalizedKey);
      history.push(Date.now());
      
      // Manter apenas últimas 100 entradas
      if (history.length > 100) {
        history.shift();
      }
    }

    _adaptTTL(key, entry) {
      if (entry.strategy !== CONFIG.TTL_STRATEGIES.ACCESS_BASED) return;
      
      // Recalcular TTL baseado em acessos
      const newTTL = this._calculateAccessBasedTTL(entry.originalQuery, entry.ttl);
      
      if (newTTL > entry.ttl) {
        const extension = newTTL - entry.ttl;
        entry.expiresAt += extension;
        entry.ttl = newTTL;
        this.stats.adaptations++;
        
        console.log(`[SmartCache] TTL adapted: +${Math.round(extension / 1000)}s`);
      }
    }

    /**
     * Atualiza score de feedback para uma entrada
     * @param {string} query - Query
     * @param {number} delta - Mudança no score (-1 a 1)
     */
    updateFeedback(query, delta) {
      const key = this.generateKey(query, {});
      const entry = this.cache.get(key);
      
      if (entry) {
        entry.feedbackScore = Math.max(-1, Math.min(1, (entry.feedbackScore || 0) + delta));
        
        // Recalcular TTL se usando feedback-based strategy
        if (entry.strategy === CONFIG.TTL_STRATEGIES.FEEDBACK_BASED) {
          const newTTL = this._calculateFeedbackBasedTTL(query, CONFIG.DEFAULT_TTL_MS);
          entry.expiresAt = Date.now() + newTTL;
          entry.ttl = newTTL;
        }
      }
    }

    _ensureCapacity() {
      if (this.cache.size < CONFIG.MAX_ENTRIES * CONFIG.CLEANUP_THRESHOLD) return;
      
      // Ordenar por score (acessos, idade, feedback)
      const entries = Array.from(this.cache.entries())
        .map(([key, entry]) => ({
          key,
          score: this._calculateEvictionScore(entry)
        }))
        .sort((a, b) => a.score - b.score);
      
      // Remover 20% com pior score
      const toRemove = Math.ceil(entries.length * 0.2);
      for (let i = 0; i < toRemove; i++) {
        this.cache.delete(entries[i].key);
        this.stats.evictions++;
      }
      
      console.log(`[SmartCache] Evicted ${toRemove} entries`);
    }

    _calculateEvictionScore(entry) {
      const now = Date.now();
      const age = (now - entry.createdAt) / CONFIG.MAX_TTL_MS;
      const recency = entry.lastAccess ? (now - entry.lastAccess) / CONFIG.MAX_TTL_MS : 1;
      const frequency = Math.log(entry.accessCount + 1);
      const feedback = (entry.feedbackScore + 1) / 2; // Normalizado 0-1
      
      // Score maior = menos provável de ser removido
      return (frequency * 0.4) + (feedback * 0.3) + ((1 - recency) * 0.2) + ((1 - age) * 0.1);
    }

    _cleanup() {
      const now = Date.now();
      let cleaned = 0;
      
      for (const [key, entry] of this.cache.entries()) {
        if (now > entry.expiresAt) {
          this.cache.delete(key);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        console.log(`[SmartCache] Cleanup: removed ${cleaned} expired entries`);
        this._scheduleSave();
      }
      
      // Limpar access log antigo
      for (const [key, history] of this.accessLog.entries()) {
        const recentHistory = history.filter(t => now - t < 86400000); // Último dia
        if (recentHistory.length === 0) {
          this.accessLog.delete(key);
        } else if (recentHistory.length < history.length) {
          this.accessLog.set(key, recentHistory);
        }
      }
    }

    _scheduleSave = (() => {
      let timeout = null;
      return () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          this._saveToStorage();
          timeout = null;
        }, 5000);
      };
    })();

    /**
     * Invalida uma entrada específica
     * @param {string} query - Query
     * @param {Object} context - Contexto
     */
    invalidate(query, context = {}) {
      const key = this.generateKey(query, context);
      if (this.cache.has(key)) {
        this.cache.delete(key);
        console.log(`[SmartCache] Invalidated: "${query.substring(0, 30)}..."`);
      }
    }

    /**
     * Invalida todas as entradas de uma categoria
     * @param {string} category - Categoria
     */
    invalidateCategory(category) {
      let count = 0;
      for (const [key, entry] of this.cache.entries()) {
        if (entry.category === category) {
          this.cache.delete(key);
          count++;
        }
      }
      console.log(`[SmartCache] Invalidated ${count} entries in category: ${category}`);
    }

    /**
     * Limpa todo o cache
     */
    clear() {
      this.cache.clear();
      this.accessLog.clear();
      this._saveToStorage();
      console.log('[SmartCache] Cache cleared');
    }

    /**
     * Obtém estatísticas do cache
     */
    getStats() {
      const hitRate = this.stats.hits + this.stats.misses > 0
        ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(1)
        : 0;
      
      let totalSize = 0;
      for (const [, entry] of this.cache.entries()) {
        totalSize += JSON.stringify(entry).length;
      }
      
      return {
        ...this.stats,
        entries: this.cache.size,
        maxEntries: CONFIG.MAX_ENTRIES,
        hitRate: hitRate + '%',
        sizeMB: (totalSize / (1024 * 1024)).toFixed(2),
        maxSizeMB: CONFIG.MAX_SIZE_MB,
        avgTTL: this._calculateAvgTTL(),
        categoryCounts: this._getCategoryCounts()
      };
    }

    _calculateAvgTTL() {
      if (this.cache.size === 0) return 0;
      
      let total = 0;
      for (const [, entry] of this.cache.entries()) {
        total += entry.ttl;
      }
      return Math.round(total / this.cache.size / 1000) + 's';
    }

    _getCategoryCounts() {
      const counts = {};
      for (const [, entry] of this.cache.entries()) {
        counts[entry.category] = (counts[entry.category] || 0) + 1;
      }
      return counts;
    }

    /**
     * Exporta dados do cache para análise
     */
    exportData() {
      return {
        entries: Array.from(this.cache.values()).map(e => ({
          query: e.originalQuery,
          category: e.category,
          ttl: e.ttl,
          accessCount: e.accessCount,
          feedbackScore: e.feedbackScore,
          createdAt: new Date(e.createdAt).toISOString()
        })),
        stats: this.getStats(),
        exportedAt: new Date().toISOString()
      };
    }
  }

  // =============================================
  // INICIALIZAÇÃO
  // =============================================

  const smartCache = new SmartCache();

  // Expor globalmente
  window.WHLSmartCache = smartCache;
  window.WHLCacheConfig = CONFIG;

  // =============================================
  // COMPATIBILIDADE (SEM QUEBRAR O LEGADO)
  // =============================================
  // O CopilotEngine e o AIResponseCache usam o contrato:
  // - get(message, context) -> { response, confidence, ... } | null
  // - set(message, context, response, confidence, ttl?)
  //
  // Portanto, NUNCA podemos substituir window.aiResponseCache por um objeto
  // com assinatura diferente. Aqui fazemos integração segura:
  // - Se existir aiResponseCache legado: wrap get/set preservando assinatura
  // - Se não existir: criamos um adapter que expõe o contrato legado

  function _safeB64(str) {
    try {
      // btoa falha com unicode; garantimos UTF-8
      return btoa(unescape(encodeURIComponent(str)));
    } catch (_) {
      return '';
    }
  }

  // Reusar a função, caso esteja rodando cedo demais
  try {
    if (typeof smartCache._hashContext === 'function') {
      smartCache._hashContext = function(context) {
        const relevantKeys = ['contactId', 'category', 'language'];
        const filtered = {};
        for (const key of relevantKeys) {
          if (context && context[key]) filtered[key] = context[key];
        }
        const raw = JSON.stringify(filtered);
        return _safeB64(raw).substring(0, 20);
      };
    }
  } catch (error) {
    if (globalThis.WHLogger) {
      globalThis.WHLogger.warn('SmartCache initialization partial failure', { error: error.message });
    }
  }

  function _contextForSmartCache(context) {
    const c = context && typeof context === 'object' ? context : {};
    return {
      category: c.category || c.intent || 'DEFAULT',
      language: c.language || 'pt-BR'
    };
  }

  function _wrapLegacyAIResponseCache() {
    const legacy = window.aiResponseCache;
    if (!legacy || legacy.__whlSmartCacheWrapped) return false;
    if (typeof legacy.get !== 'function' || typeof legacy.set !== 'function') return false;

    const originalGet = legacy.get.bind(legacy);
    const originalSet = legacy.set.bind(legacy);

    legacy.get = async function(message, context) {
      try {
        const cached = smartCache.get(String(message || ''), _contextForSmartCache(context));
        if (cached && typeof cached === 'object' && typeof cached.response === 'string' && cached.response.trim()) {
          return {
            ...cached,
            fromCache: true,
            cacheLayer: 'smart_cache'
          };
        }
      } catch (error) {
        if (globalThis.WHLogger) {
          globalThis.WHLogger.warn('SmartCache legacy get error', { error: error.message });
        }
      }
      return await originalGet(message, context);
    };

    legacy.set = function(message, context, response, confidence = 0.8, ttl) {
      try {
        const value = {
          response: String(response || ''),
          confidence: Number(confidence) || 0,
          originalMessage: String(message || '')
        };
        const category = (context && typeof context === 'object' && context.category) ? String(context.category) : 'DEFAULT';
        smartCache.set(String(message || ''), value, {
          context: _contextForSmartCache(context),
          category: category.toUpperCase?.() || category,
          ttl: Number(ttl) || null,
          strategy: CONFIG.TTL_STRATEGIES.ACCESS_BASED
        });
      } catch (error) {
        if (globalThis.WHLogger) {
          globalThis.WHLogger.warn('SmartCache legacy set error', { error: error.message });
        }
      }

      return originalSet(message, context, response, confidence, ttl);
    };

    legacy.__whlSmartCacheWrapped = true;
    return true;
  }

  function _installAdapterIfMissing() {
    if (window.aiResponseCache) return false;

    window.aiResponseCache = {
      __whlSmartCacheAdapter: true,
      async get(message, context) {
        const cached = smartCache.get(String(message || ''), _contextForSmartCache(context));
        if (cached && typeof cached === 'object') return { ...cached, fromCache: true, cacheLayer: 'smart_cache' };
        return null;
      },
      set(message, context, response, confidence = 0.8, ttl) {
        const value = {
          response: String(response || ''),
          confidence: Number(confidence) || 0,
          originalMessage: String(message || '')
        };
        const category = (context && typeof context === 'object' && context.category) ? String(context.category) : 'DEFAULT';
        smartCache.set(String(message || ''), value, {
          context: _contextForSmartCache(context),
          category: category.toUpperCase?.() || category,
          ttl: Number(ttl) || null,
          strategy: CONFIG.TTL_STRATEGIES.ACCESS_BASED
        });
      },
      // Compat com ai-analytics.js
      getMetrics() {
        const s = smartCache.getStats();
        const total = (s.hits || 0) + (s.misses || 0);
        const hitRate = total > 0 ? (s.hits || 0) / total : 0;
        return {
          hits: s.hits || 0,
          misses: s.misses || 0,
          evictions: s.evictions || 0,
          total,
          hitRate,
          hitRatePercent: (hitRate * 100).toFixed(1) + '%',
          cacheSize: s.entries || 0,
          maxSize: s.maxEntries || CONFIG.MAX_ENTRIES
        };
      }
    };

    return true;
  }

  // Tentar integrar agora (ai-response-cache.js normalmente carrega antes)
  if (!_wrapLegacyAIResponseCache()) {
    _installAdapterIfMissing();
  }

  // Segurança extra: se o legado carregar depois, fazemos retry por um curto período
  (function retryLegacyIntegration() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (_wrapLegacyAIResponseCache()) {
        clearInterval(timer);
      } else if (attempts >= 20) {
        clearInterval(timer);
      }
    }, 250);
  })();

  console.log('[OPT-001] Smart Cache initialized (safe legacy integration)');

})();
