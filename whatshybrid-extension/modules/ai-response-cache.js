/**
 * 🚀 AI Response Cache - Cache Semântico Inteligente
 * WhatsHybrid v7.7.0
 * 
 * Features:
 * - Cache semântico (não exato)
 * - TTL configurável
 * - LRU eviction
 * - Personalização de respostas cacheadas
 * - Métricas de hit/miss
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'whl_ai_response_cache';
  const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 horas
  const MAX_CACHE_SIZE = 500;

  // SECURITY FIX P0-039: Prevent Prototype Pollution from storage
  function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const sanitized = {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key) && !dangerousKeys.includes(key)) {
        const value = obj[key];
        if (Array.isArray(value)) {
          sanitized[key] = value.map(item =>
            (item && typeof item === 'object') ? sanitizeObject(item) : item
          );
        } else if (value && typeof value === 'object') {
          sanitized[key] = sanitizeObject(value);
        } else {
          sanitized[key] = value;
        }
      }
    }

    return sanitized;
  }

  class AIResponseCache {
    constructor() {
      this.cache = new Map();
      this.metrics = {
        hits: 0,
        misses: 0,
        evictions: 0
      };
      this.initialized = false;
    }

    // ============================================
    // INICIALIZAÇÃO
    // ============================================
    
    async init() {
      if (this.initialized) return;

      try {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        if (data[STORAGE_KEY]) {
          // SECURITY FIX P0-039: Sanitize to prevent Prototype Pollution
          const parsed = JSON.parse(data[STORAGE_KEY]);
          const stored = sanitizeObject(parsed);
          Object.entries(stored.cache || {}).forEach(([key, value]) => {
            this.cache.set(key, value);
          });
          this.metrics = stored.metrics || this.metrics;
          console.log('[AIResponseCache] Cache carregado:', this.cache.size, 'entradas');
        }

        this.initialized = true;
        this.startCleanupInterval();

        // AI-010 FIX: Listen for KB and persona changes to invalidate cache
        if (window.EventBus) {
          window.EventBus.on('knowledge-base:updated', () => {
            this.clear();
            console.log('[AI-010] ✅ AIResponseCache cleared: KB updated');
          });
          
          window.EventBus.on('copilot:persona:changed', () => {
            this.clear();
            console.log('[AI-010] ✅ AIResponseCache cleared: Persona changed');
          });
          
          console.log('[AI-010] ✅ Cache invalidation listeners registered');
        }

        // v9.5.4: Pre-warm cache with the highest-quality few-shot examples so the first time a
        // similar question arrives we hit cache (<50ms) instead of round-tripping to AI (2-5s).
        this._prewarmFromFewShot();

      } catch (error) {
        console.error('[AIResponseCache] Erro ao inicializar:', error);
      }
    }

    // v9.5.4: Pre-warm helper. Pulls top edited (quality 10) examples from few-shot learning
    // and seeds the cache with them. Runs after init, fire-and-forget.
    _prewarmFromFewShot() {
      try {
        const fsl = window.fewShotLearning;
        if (!fsl || typeof fsl.getAll !== 'function') return;
        // Wait until FSL is initialized (it auto-inits on load).
        const seed = () => {
          const examples = fsl.getAll() || [];
          if (!examples.length) return;
          // Top 10 by quality + usageCount, edited examples first.
          const top = examples
            .slice()
            .sort((a, b) => {
              const qa = (Number(a.quality) || 9) >= 10 ? 1.5 : 1.0;
              const qb = (Number(b.quality) || 9) >= 10 ? 1.5 : 1.0;
              return ((b.usageCount || 0) * qb) - ((a.usageCount || 0) * qa);
            })
            .slice(0, 10);
          let seeded = 0;
          for (const ex of top) {
            const message = ex.input || ex.user;
            const response = ex.output || ex.assistant;
            if (!message || !response) continue;
            // Use long TTL (7 days) so prewarmed entries survive longer than runtime cache.
            try {
              this.set(message, {}, response, ex.quality >= 10 ? 0.95 : 0.85, 7 * 24 * 60 * 60 * 1000);
              seeded++;
            } catch (_) {}
          }
          if (seeded > 0) console.log(`[AIResponseCache] 🔥 Prewarmed ${seeded} entries from few-shot examples`);
        };
        if (fsl.initialized) seed();
        else if (window.EventBus) window.EventBus.on('few-shot:initialized', seed);
        else setTimeout(seed, 1500);
      } catch (e) {
        console.warn('[AIResponseCache] Prewarm falhou (não crítico):', e?.message);
      }
    }

    // ============================================
    // GERAÇÃO DE CHAVE SEMÂNTICA
    // ============================================
    
    /**
     * Gera chave semântica baseada em intent, entities e sentiment
     * Permite cache de respostas similares (não exatas)
     */
    generateKey(intent, entities = [], sentiment = 0, category = '') {
      const sortedEntities = [...entities].sort().slice(0, 5).join(',');
      const sentimentBucket = Math.round(sentiment * 5) / 5; // Buckets: -1, -0.8, -0.6, ..., 0.8, 1
      
      return `${intent}|${sortedEntities}|${sentimentBucket}|${category}`;
    }

    /**
     * Gera chave a partir de contexto de análise
     */
    generateKeyFromContext(context) {
      return this.generateKey(
        context.intent || 'general',
        context.entities || [],
        context.sentiment || 0,
        context.category || ''
      );
    }

    // ============================================
    // OPERAÇÕES DE CACHE
    // ============================================
    
    /**
     * Busca resposta no cache
     * @returns {Object|null} { response, confidence, fromCache: true } ou null
     */
    async get(message, context) {
      const key = this.generateKeyFromContext(context);
      const cached = this.cache.get(key);
      
      if (!cached) {
        this.metrics.misses++;
        return null;
      }
      
      // Verificar TTL
      if (Date.now() - cached.timestamp > (cached.ttl || DEFAULT_TTL)) {
        this.cache.delete(key);
        this.metrics.misses++;
        return null;
      }
      
      // Verificar similaridade com mensagem original
      const similarity = this.calculateSimilarity(message, cached.originalMessage);
      
      if (similarity < 0.7) {
        this.metrics.misses++;
        return null;
      }
      
      // Cache hit!
      cached.hitCount++;
      cached.lastHit = Date.now();
      this.metrics.hits++;
      
      console.log('[AIResponseCache] HIT para:', key, 'similaridade:', similarity.toFixed(2));
      
      // Personalizar resposta se necessário
      const personalizedResponse = this.personalizeResponse(cached.response, context);
      
      return {
        response: personalizedResponse,
        originalResponse: cached.response,
        confidence: cached.confidence * similarity,
        fromCache: true,
        cacheKey: key,
        hitCount: cached.hitCount
      };
    }

    /**
     * Armazena resposta no cache
     */
    set(message, context, response, confidence = 0.8, ttl = DEFAULT_TTL) {
      const key = this.generateKeyFromContext(context);
      
      this.cache.set(key, {
        originalMessage: message,
        response,
        confidence,
        context: {
          intent: context.intent,
          entities: context.entities,
          sentiment: context.sentiment,
          category: context.category
        },
        timestamp: Date.now(),
        ttl,
        hitCount: 0,
        lastHit: null
      });
      
      // Verificar limite de tamanho
      if (this.cache.size > MAX_CACHE_SIZE) {
        this.evictLeastUsed();
      }
      
      this.save();
      
      console.log('[AIResponseCache] SET:', key);
    }

    /**
     * Invalida entrada do cache
     */
    invalidate(key) {
      if (this.cache.has(key)) {
        this.cache.delete(key);
        this.save();
        return true;
      }
      return false;
    }

    /**
     * Invalida entradas por intent
     */
    invalidateByIntent(intent) {
      let count = 0;
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${intent}|`)) {
          this.cache.delete(key);
          count++;
        }
      }
      if (count > 0) this.save();
      return count;
    }

    // ============================================
    // SIMILARIDADE DE TEXTO
    // ============================================
    
    /**
     * Calcula similaridade entre duas strings (Jaccard simplificado)
     */
    calculateSimilarity(text1, text2) {
      if (!text1 || !text2) return 0;
      
      const words1 = new Set(this.tokenize(text1));
      const words2 = new Set(this.tokenize(text2));
      
      if (words1.size === 0 || words2.size === 0) return 0;
      
      let intersection = 0;
      for (const word of words1) {
        if (words2.has(word)) intersection++;
      }
      
      const union = words1.size + words2.size - intersection;
      
      return intersection / union;
    }

    /**
     * Tokeniza texto
     */
    tokenize(text) {
      return text.toLowerCase()
        .replace(/[^\w\sáéíóúâêîôûãõç]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2);
    }

    // ============================================
    // PERSONALIZAÇÃO
    // ============================================
    
    /**
     * Personaliza resposta cacheada com contexto atual
     */
    personalizeResponse(response, context) {
      let personalized = response;
      
      // Substituir placeholders se houver
      if (context.clientName) {
        personalized = personalized.replace(/\{nome\}/gi, context.clientName);
        personalized = personalized.replace(/\{cliente\}/gi, context.clientName);
      }
      
      // #18 FIX: Ajustar saudação baseado no horário
      // Using word boundaries for greeting replacement
      const hour = new Date().getHours();
      if (hour < 12) {
        personalized = personalized.replace(/\b(boa\s+tarde|boa\s+noite)\b/gi, 'bom dia');
        console.log('[#18] Greeting adjusted for morning');
      } else if (hour < 18) {
        personalized = personalized.replace(/\b(bom\s+dia|boa\s+noite)\b/gi, 'boa tarde');
        console.log('[#18] Greeting adjusted for afternoon');
      } else {
        personalized = personalized.replace(/\b(bom\s+dia|boa\s+tarde)\b/gi, 'boa noite');
        console.log('[#18] Greeting adjusted for evening');
      }
      
      return personalized;
    }

    // ============================================
    // EVICTION
    // ============================================
    
    /**
     * Remove entradas menos usadas (LRU)
     */
    evictLeastUsed() {
      const entries = Array.from(this.cache.entries())
        .map(([key, value]) => ({
          key,
          score: this.calculateEvictionScore(value)
        }))
        .sort((a, b) => a.score - b.score);
      
      // Remover 10% das entradas com menor score
      const toRemove = Math.max(1, Math.floor(entries.length * 0.1));
      
      for (let i = 0; i < toRemove; i++) {
        this.cache.delete(entries[i].key);
        this.metrics.evictions++;
      }
      
      console.log('[AIResponseCache] Evicted', toRemove, 'entradas');
    }

    /**
     * Calcula score para eviction (maior = mais valioso, manter)
     */
    calculateEvictionScore(entry) {
      const age = Date.now() - entry.timestamp;
      const ageScore = 1 - Math.min(age / DEFAULT_TTL, 1);
      
      const hitScore = Math.min(entry.hitCount / 10, 1);
      
      const recencyScore = entry.lastHit 
        ? 1 - Math.min((Date.now() - entry.lastHit) / DEFAULT_TTL, 1)
        : 0;
      
      return (ageScore * 0.2) + (hitScore * 0.5) + (recencyScore * 0.3);
    }

    // ============================================
    // PERSISTÊNCIA
    // ============================================
    
    async save() {
      try {
        const data = {
          cache: Object.fromEntries(this.cache),
          metrics: this.metrics,
          savedAt: Date.now()
        };
        
        await chrome.storage.local.set({
          [STORAGE_KEY]: JSON.stringify(data)
        });
        
        return true;
      } catch (error) {
        console.error('[AIResponseCache] Erro ao salvar:', error);
        return false;
      }
    }

    // ============================================
    // MANUTENÇÃO
    // ============================================
    
    startCleanupInterval() {
      // Limpar cache expirado a cada 30 minutos
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
      }
      this.cleanupInterval = setInterval(() => this.cleanupExpired(), 30 * 60 * 1000);
    }

    stopCleanupInterval() {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }
    }

    cleanupExpired() {
      const now = Date.now();
      let removed = 0;
      
      for (const [key, entry] of this.cache.entries()) {
        if (now - entry.timestamp > (entry.ttl || DEFAULT_TTL)) {
          this.cache.delete(key);
          removed++;
        }
      }
      
      if (removed > 0) {
        console.log('[AIResponseCache] Limpeza: removidas', removed, 'entradas expiradas');
        this.save();
      }
    }

    // ============================================
    // MÉTRICAS
    // ============================================
    
    getMetrics() {
      const total = this.metrics.hits + this.metrics.misses;
      const hitRate = total > 0 ? this.metrics.hits / total : 0;
      
      return {
        ...this.metrics,
        total,
        hitRate,
        hitRatePercent: (hitRate * 100).toFixed(1) + '%',
        cacheSize: this.cache.size,
        maxSize: MAX_CACHE_SIZE
      };
    }

    resetMetrics() {
      this.metrics = { hits: 0, misses: 0, evictions: 0 };
      this.save();
    }

    // ============================================
    // DEBUG
    // ============================================
    
    getEntries() {
      return Array.from(this.cache.entries()).map(([key, value]) => ({
        key,
        hitCount: value.hitCount,
        age: Date.now() - value.timestamp,
        intent: value.context?.intent
      }));
    }

    clear() {
      this.cache.clear();
      this.save();
      console.log('[AIResponseCache] Cache limpo');
    }
  }

  // ============================================
  // EXPORTAR
  // ============================================
  
  window.AIResponseCache = AIResponseCache;
  
  if (!window.aiResponseCache) {
    window.aiResponseCache = new AIResponseCache();
    window.aiResponseCache.init().then(() => {
      console.log('[AIResponseCache] ✅ Cache inteligente inicializado');
    });
  }

  // Evitar intervalos órfãos em recarregamentos
  window.addEventListener('beforeunload', () => {
    window.aiResponseCache?.stopCleanupInterval();
  });

})();
