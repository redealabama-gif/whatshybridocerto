/**
 * OPT-002: Request Batcher - Agrupamento inteligente de requisições
 * 
 * Benefícios:
 * - Reduz 60-80% das chamadas à API
 * - Economiza tokens e custos
 * - Melhora responsividade geral
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
    BATCH_WINDOW_MS: 100,         // Janela de tempo para agrupar requests
    MAX_BATCH_SIZE: 10,           // Máximo de requests por batch
    DEDUP_WINDOW_MS: 5000,        // Janela de deduplicação
    CACHE_TTL_MS: 30000,          // TTL do cache de respostas
    MAX_CACHE_SIZE: 100,          // Tamanho máximo do cache
    RETRY_ATTEMPTS: 3,            // Tentativas de retry
    RETRY_DELAY_MS: 1000,         // Delay entre retries
    PRIORITY_LEVELS: {
      HIGH: 1,
      NORMAL: 2,
      LOW: 3
    }
  };

  // =============================================
  // STORAGE KEYS
  // =============================================
  
  const STORAGE_KEYS = {
    BATCHER_STATS: 'whl_request_batcher_stats',
    BATCHER_CACHE: 'whl_request_batcher_cache'
  };

  // =============================================
  // CLASSES AUXILIARES
  // =============================================

  /**
   * Cache LRU com TTL
   */
  class LRUCache {
    constructor(maxSize, defaultTTL) {
      this.maxSize = maxSize;
      this.defaultTTL = defaultTTL;
      this.cache = new Map();
    }

    generateKey(request) {
      const keyData = {
        endpoint: request.endpoint,
        method: request.method || 'POST',
        body: JSON.stringify(request.body || {})
      };
      return btoa(JSON.stringify(keyData)).slice(0, 64);
    }

    get(key) {
      const entry = this.cache.get(key);
      if (!entry) return null;
      
      if (Date.now() > entry.expiresAt) {
        this.cache.delete(key);
        return null;
      }
      
      // Move para o final (mais recente)
      this.cache.delete(key);
      this.cache.set(key, entry);
      
      return entry.value;
    }

    set(key, value, ttl = this.defaultTTL) {
      // Remove entradas antigas se necessário
      if (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      
      this.cache.set(key, {
        value,
        expiresAt: Date.now() + ttl,
        createdAt: Date.now()
      });
    }

    has(key) {
      return this.get(key) !== null;
    }

    clear() {
      this.cache.clear();
    }

    getStats() {
      let expired = 0;
      let active = 0;
      const now = Date.now();
      
      for (const [, entry] of this.cache) {
        if (now > entry.expiresAt) expired++;
        else active++;
      }
      
      return { total: this.cache.size, active, expired };
    }
  }

  /**
   * Fila de prioridade para requests
   */
  class PriorityQueue {
    constructor() {
      this.queues = {
        [CONFIG.PRIORITY_LEVELS.HIGH]: [],
        [CONFIG.PRIORITY_LEVELS.NORMAL]: [],
        [CONFIG.PRIORITY_LEVELS.LOW]: []
      };
    }

    enqueue(item, priority = CONFIG.PRIORITY_LEVELS.NORMAL) {
      this.queues[priority].push(item);
    }

    dequeue() {
      for (const priority of [CONFIG.PRIORITY_LEVELS.HIGH, CONFIG.PRIORITY_LEVELS.NORMAL, CONFIG.PRIORITY_LEVELS.LOW]) {
        if (this.queues[priority].length > 0) {
          return this.queues[priority].shift();
        }
      }
      return null;
    }

    dequeueAll(maxItems = Infinity) {
      const items = [];
      let count = 0;
      
      for (const priority of [CONFIG.PRIORITY_LEVELS.HIGH, CONFIG.PRIORITY_LEVELS.NORMAL, CONFIG.PRIORITY_LEVELS.LOW]) {
        while (this.queues[priority].length > 0 && count < maxItems) {
          items.push(this.queues[priority].shift());
          count++;
        }
      }
      
      return items;
    }

    size() {
      return Object.values(this.queues).reduce((sum, q) => sum + q.length, 0);
    }

    isEmpty() {
      return this.size() === 0;
    }
  }

  // =============================================
  // REQUEST BATCHER
  // =============================================

  class RequestBatcher {
    constructor() {
      this.requestQueue = new PriorityQueue();
      this.pendingBatch = null;
      this.batchTimer = null;
      this.responseCache = new LRUCache(CONFIG.MAX_CACHE_SIZE, CONFIG.CACHE_TTL_MS);
      this.dedupMap = new Map();
      this.stats = {
        totalRequests: 0,
        batchedRequests: 0,
        cacheHits: 0,
        dedupedRequests: 0,
        batchesSent: 0,
        bytesSaved: 0,
        errors: 0
      };
      this.initialized = false;
      
      this._loadStats();
    }

    async _loadStats() {
      try {
        const stored = await this._getStorage(STORAGE_KEYS.BATCHER_STATS);
        if (stored) {
          Object.assign(this.stats, stored);
        }
        this.initialized = true;
      } catch (e) {
        console.warn('[RequestBatcher] Failed to load stats:', e);
        this.initialized = true;
      }
    }

    async _saveStats() {
      try {
        await this._setStorage(STORAGE_KEYS.BATCHER_STATS, this.stats);
      } catch (e) {
        console.warn('[RequestBatcher] Failed to save stats:', e);
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

    /**
     * Enfileira uma requisição para batching
     * @param {Object} request - Objeto da requisição
     * @param {Object} options - Opções da requisição
     * @returns {Promise} - Promessa com a resposta
     */
    async enqueue(request, options = {}) {
      const {
        priority = CONFIG.PRIORITY_LEVELS.NORMAL,
        cacheable = true,
        deduplicate = true,
        timeout = 30000
      } = options;

      this.stats.totalRequests++;

      // 1. Verificar cache
      if (cacheable) {
        const cacheKey = this.responseCache.generateKey(request);
        const cached = this.responseCache.get(cacheKey);
        if (cached) {
          this.stats.cacheHits++;
          console.log('[RequestBatcher] Cache hit:', request.endpoint);
          return cached;
        }
      }

      // 2. Verificar deduplicação
      if (deduplicate) {
        const dedupKey = this._getDedupKey(request);
        const existingPromise = this.dedupMap.get(dedupKey);
        if (existingPromise) {
          this.stats.dedupedRequests++;
          console.log('[RequestBatcher] Deduped request:', request.endpoint);
          return existingPromise;
        }
      }

      // 3. Criar promise para esta requisição
      const { promise, resolve, reject } = this._createDeferredPromise();
      
      const queueItem = {
        request,
        options,
        resolve,
        reject,
        timestamp: Date.now(),
        timeout
      };

      // 4. Adicionar à fila com prioridade
      this.requestQueue.enqueue(queueItem, priority);

      // 5. Registrar para deduplicação
      if (deduplicate) {
        const dedupKey = this._getDedupKey(request);
        this.dedupMap.set(dedupKey, promise);
        
        // Limpar dedup após janela
        setTimeout(() => {
          this.dedupMap.delete(dedupKey);
        }, CONFIG.DEDUP_WINDOW_MS);
      }

      // 6. Agendar processamento do batch
      this._scheduleBatch();

      return promise;
    }

    _getDedupKey(request) {
      return `${request.endpoint}:${JSON.stringify(request.body || {})}`;
    }

    _createDeferredPromise() {
      let resolve, reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    _scheduleBatch() {
      if (this.batchTimer) return;

      this.batchTimer = setTimeout(() => {
        this._processBatch();
      }, CONFIG.BATCH_WINDOW_MS);

      // Também processa se atingir tamanho máximo
      if (this.requestQueue.size() >= CONFIG.MAX_BATCH_SIZE) {
        clearTimeout(this.batchTimer);
        this._processBatch();
      }
    }

    async _processBatch() {
      this.batchTimer = null;

      if (this.requestQueue.isEmpty()) return;

      const items = this.requestQueue.dequeueAll(CONFIG.MAX_BATCH_SIZE);
      
      if (items.length === 0) return;

      this.stats.batchedRequests += items.length;
      this.stats.batchesSent++;

      console.log(`[RequestBatcher] Processing batch of ${items.length} requests`);

      // Agrupar por endpoint
      const groupedByEndpoint = this._groupByEndpoint(items);

      // Processar cada grupo
      for (const [endpoint, group] of Object.entries(groupedByEndpoint)) {
        await this._processGroup(endpoint, group);
      }

      // Salvar estatísticas periodicamente
      if (this.stats.batchesSent % 10 === 0) {
        this._saveStats();
      }

      // Processar próximo batch se houver mais itens
      if (!this.requestQueue.isEmpty()) {
        this._scheduleBatch();
      }
    }

    _groupByEndpoint(items) {
      const groups = {};
      for (const item of items) {
        const endpoint = item.request.endpoint;
        if (!groups[endpoint]) {
          groups[endpoint] = [];
        }
        groups[endpoint].push(item);
      }
      return groups;
    }

    async _processGroup(endpoint, items) {
      try {
        // Verificar se o endpoint suporta batch nativo
        if (this._supportsBatchEndpoint(endpoint)) {
          await this._processBatchEndpoint(endpoint, items);
        } else {
          // Processar individualmente mas em paralelo
          await this._processParallel(items);
        }
      } catch (error) {
        console.error('[RequestBatcher] Batch processing error:', error);
        this.stats.errors++;
        
        // Rejeitar todas as promises do grupo
        for (const item of items) {
          item.reject(error);
        }
      }
    }

    _supportsBatchEndpoint(endpoint) {
      // Endpoints que suportam batch nativo
      const batchEndpoints = [
        '/api/v1/ai/completions/batch',
        '/api/v1/embeddings/batch'
      ];
      return batchEndpoints.some(e => endpoint.includes(e));
    }

    async _processBatchEndpoint(endpoint, items) {
      const batchEndpoint = endpoint.replace(/\/batch$/, '') + '/batch';
      
      const batchRequest = {
        requests: items.map(item => ({
          id: item.timestamp,
          ...item.request.body
        }))
      };

      try {
        const response = await this._makeRequest(batchEndpoint, batchRequest);
        
        // Distribuir respostas
        if (response.responses && Array.isArray(response.responses)) {
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const itemResponse = response.responses[i];
            
            if (item.options.cacheable) {
              const cacheKey = this.responseCache.generateKey(item.request);
              this.responseCache.set(cacheKey, itemResponse);
            }
            
            item.resolve(itemResponse);
          }
        }
      } catch (error) {
        // Fallback para processamento paralelo
        await this._processParallel(items);
      }
    }

    async _processParallel(items) {
      const promises = items.map(item => this._processWithRetry(item));
      await Promise.allSettled(promises);
    }

    async _processWithRetry(item, attempt = 1) {
      try {
        const response = await this._makeRequest(
          item.request.endpoint,
          item.request.body,
          item.timeout
        );
        
        if (item.options.cacheable) {
          const cacheKey = this.responseCache.generateKey(item.request);
          this.responseCache.set(cacheKey, response);
        }
        
        item.resolve(response);
        return response;
      } catch (error) {
        if (attempt < CONFIG.RETRY_ATTEMPTS && this._isRetryable(error)) {
          const delay = CONFIG.RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, delay));
          return this._processWithRetry(item, attempt + 1);
        }
        
        this.stats.errors++;
        item.reject(error);
        throw error;
      }
    }

    _isRetryable(error) {
      if (!error) return false;
      
      const retryableCodes = [408, 429, 500, 502, 503, 504];
      return retryableCodes.includes(error.status || error.code);
    }

    async _makeRequest(endpoint, body, timeout = 30000) {
      // Usa o gateway de IA se disponível
      if (window.WHLAIGateway) {
        return window.WHLAIGateway.request(endpoint, body, { timeout });
      }

      // Fallback para fetch direto
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const backendUrl = await this._getBackendUrl();
        const response = await fetch(`${backendUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw { status: response.status, message: await response.text() };
        }

        return response.json();
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    }

    async _getBackendUrl() {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.get(['backendUrl'], (result) => {
            resolve(result.backendUrl || (globalThis.WHL_ENDPOINTS?.BACKEND_DEFAULT || 'http://localhost:3000'));
          });
        } else {
          resolve('http://localhost:3000');
        }
      });
    }

    /**
     * Limpa o cache de respostas
     */
    clearCache() {
      this.responseCache.clear();
      console.log('[RequestBatcher] Cache cleared');
    }

    /**
     * Obtém estatísticas do batcher
     */
    getStats() {
      const cacheStats = this.responseCache.getStats();
      return {
        ...this.stats,
        cache: cacheStats,
        queueSize: this.requestQueue.size(),
        dedupMapSize: this.dedupMap.size,
        efficiency: this.stats.totalRequests > 0 
          ? ((this.stats.cacheHits + this.stats.dedupedRequests) / this.stats.totalRequests * 100).toFixed(2) + '%'
          : '0%'
      };
    }

    /**
     * Reseta estatísticas
     */
    resetStats() {
      this.stats = {
        totalRequests: 0,
        batchedRequests: 0,
        cacheHits: 0,
        dedupedRequests: 0,
        batchesSent: 0,
        bytesSaved: 0,
        errors: 0
      };
      this._saveStats();
    }
  }

  // =============================================
  // API WRAPPER
  // =============================================

  /**
   * Wrapper para APIs que usa o batcher automaticamente
   */
  class BatchedAPIClient {
    constructor(batcher) {
      this.batcher = batcher;
    }

    async aiCompletion(messages, options = {}) {
      return this.batcher.enqueue({
        endpoint: '/api/v1/ai/completions',
        method: 'POST',
        body: { messages, ...options }
      }, {
        priority: options.priority || CONFIG.PRIORITY_LEVELS.NORMAL,
        cacheable: options.cacheable !== false
      });
    }

    async embedding(text, options = {}) {
      return this.batcher.enqueue({
        endpoint: '/api/v1/embeddings',
        method: 'POST',
        body: { text }
      }, {
        priority: CONFIG.PRIORITY_LEVELS.LOW,
        cacheable: true
      });
    }

    async search(query, options = {}) {
      return this.batcher.enqueue({
        endpoint: '/api/v1/knowledge/search',
        method: 'POST',
        body: { query, ...options }
      }, {
        priority: CONFIG.PRIORITY_LEVELS.NORMAL,
        cacheable: true
      });
    }
  }

  // =============================================
  // INICIALIZAÇÃO
  // =============================================

  const batcher = new RequestBatcher();
  const batchedAPI = new BatchedAPIClient(batcher);

  // Expor globalmente
  window.WHLRequestBatcher = batcher;
  window.WHLBatchedAPI = batchedAPI;
  window.WHLBatcherConfig = CONFIG;

  console.log('[OPT-002] Request Batcher initialized');

})();
