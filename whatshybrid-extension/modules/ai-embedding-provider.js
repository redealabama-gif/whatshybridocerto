/**
 * 🧠 EmbeddingProvider - Extension-side Semantic Embeddings
 * Provides semantic embeddings for RAG with fallback to bag-of-words
 * 
 * Features:
 * - OpenAI text-embedding-3-small (default)
 * - Batch embedding support
 * - LRU cache with chrome.storage.local persistence (max 5000 entries)
 * - FNV-1a hash for cache keys
 * - Configurable dimensions (default 256)
 * - Graceful fallback to bag-of-words
 * - Integration with AIGateway proxy
 * 
 * @version 1.0.0
 */
(function() {
  'use strict';

  // ============================================
  // CONFIGURATION
  // ============================================

  const DEFAULT_OPTIONS = {
    provider: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 256,
    maxBatchSize: 100,
    cacheSize: 5000,
    timeout: 30000,
    storageKey: 'whl_embedding_cache'
  };

  // ============================================
  // EMBEDDING PROVIDER CLASS
  // ============================================

  class EmbeddingProvider {
    /**
     * Create an EmbeddingProvider instance
     * @param {Object} options - Configuration options
     * @param {string} [options.provider='openai'] - Provider name
     * @param {string} [options.apiKey] - API key for direct calls
     * @param {string} [options.model='text-embedding-3-small'] - Model to use
     * @param {number} [options.dimensions=256] - Embedding dimensions
     * @param {number} [options.maxBatchSize=100] - Max batch size
     * @param {number} [options.cacheSize=5000] - Max cache entries
     * @param {number} [options.timeout=30000] - Request timeout in ms
     */
    constructor(options = {}) {
      this.options = { ...DEFAULT_OPTIONS, ...options };
      
      // LRU Cache (in-memory)
      this.cache = new Map();
      this.cacheKeys = [];
      this.cacheLoaded = false;
      
      // Stats
      this.stats = {
        apiCalls: 0,
        cacheHits: 0,
        cacheMisses: 0,
        fallbacks: 0,
        totalTokens: 0,
        errors: 0
      };

      // Load cache from storage
      this._loadCacheFromStorage();
    }

    // ============================================
    // PUBLIC API
    // ============================================

    /**
     * Generate embedding for a single text
     * @param {string} text - Text to embed
     * @returns {Promise<Array<number>>} - Embedding vector
     */
    async embed(text) {
      if (!text || typeof text !== 'string') {
        throw new Error('Text must be a non-empty string');
      }

      const cacheKey = this._hashText(text);
      
      // Wait for cache to load
      await this._ensureCacheLoaded();
      
      // Check cache
      if (this.cache.has(cacheKey)) {
        this.stats.cacheHits++;
        return this.cache.get(cacheKey);
      }

      this.stats.cacheMisses++;

      try {
        let embedding;

        // Try API call (via AIGateway or direct)
        if (this._hasApiAccess()) {
          embedding = await this._embedOpenAI([text]);
          embedding = embedding[0];
        } else {
          // Fallback to bag-of-words
          this.stats.fallbacks++;
          embedding = this._generateBagOfWords(text);
        }

        // Add to cache
        this._addToCache(cacheKey, embedding);

        return embedding;
      } catch (error) {
        this.stats.errors++;
        console.error('[EmbeddingProvider] Error generating embedding:', error.message);
        
        // Fallback to bag-of-words
        this.stats.fallbacks++;
        const embedding = this._generateBagOfWords(text);
        this._addToCache(cacheKey, embedding);
        return embedding;
      }
    }

    /**
     * Generate embeddings for multiple texts (batch)
     * @param {Array<string>} texts - Texts to embed
     * @returns {Promise<Array<Array<number>>>} - Array of embedding vectors
     */
    async embedBatch(texts) {
      if (!Array.isArray(texts) || texts.length === 0) {
        throw new Error('Texts must be a non-empty array');
      }

      await this._ensureCacheLoaded();

      const results = [];
      const toEmbed = [];
      const indices = [];

      // Check cache first
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i];
        const cacheKey = this._hashText(text);
        
        if (this.cache.has(cacheKey)) {
          this.stats.cacheHits++;
          results[i] = this.cache.get(cacheKey);
        } else {
          this.stats.cacheMisses++;
          toEmbed.push(text);
          indices.push(i);
        }
      }

      // Embed uncached texts
      if (toEmbed.length > 0) {
        try {
          let embeddings;

          if (this._hasApiAccess()) {
            // Process in batches
            embeddings = [];
            for (let i = 0; i < toEmbed.length; i += this.options.maxBatchSize) {
              const batch = toEmbed.slice(i, i + this.options.maxBatchSize);
              const batchEmbeddings = await this._embedOpenAI(batch);
              embeddings.push(...batchEmbeddings);
            }
          } else {
            // Fallback to bag-of-words
            this.stats.fallbacks++;
            embeddings = toEmbed.map(text => this._generateBagOfWords(text));
          }

          // Add to cache and results
          for (let i = 0; i < toEmbed.length; i++) {
            const text = toEmbed[i];
            const embedding = embeddings[i];
            const cacheKey = this._hashText(text);
            this._addToCache(cacheKey, embedding);
            results[indices[i]] = embedding;
          }
        } catch (error) {
          this.stats.errors++;
          console.error('[EmbeddingProvider] Error in batch embedding:', error.message);
          
          // Fallback to bag-of-words for failed texts
          this.stats.fallbacks++;
          for (let i = 0; i < toEmbed.length; i++) {
            const text = toEmbed[i];
            const embedding = this._generateBagOfWords(text);
            const cacheKey = this._hashText(text);
            this._addToCache(cacheKey, embedding);
            results[indices[i]] = embedding;
          }
        }
      }

      return results;
    }

    /**
     * Calculate cosine similarity between two embeddings
     * @param {Array<number>} a - First embedding
     * @param {Array<number>} b - Second embedding
     * @returns {number} - Similarity score (0-1)
     */
    cosineSimilarity(a, b) {
      if (a.length !== b.length) {
        throw new Error('Embeddings must have the same length');
      }

      let dotProduct = 0;
      let normA = 0;
      let normB = 0;

      for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }

      normA = Math.sqrt(normA);
      normB = Math.sqrt(normB);

      if (normA === 0 || normB === 0) {
        return 0;
      }

      return dotProduct / (normA * normB);
    }

    /**
     * Clear cache (both in-memory and storage)
     * @returns {Promise<void>}
     */
    async clearCache() {
      this.cache.clear();
      this.cacheKeys = [];
      
      // Clear storage
      if (typeof chrome !== 'undefined' && chrome.storage) {
        try {
          await chrome.storage.local.remove(this.options.storageKey);
        } catch (error) {
          console.error('[EmbeddingProvider] Error clearing storage:', error);
        }
      }
    }

    /**
     * Get statistics
     * @returns {Object} - Stats object
     */
    getStats() {
      return {
        ...this.stats,
        cacheSize: this.cache.size,
        cacheHitRate: this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) || 0
      };
    }

    // ============================================
    // PRIVATE METHODS - API CALLS
    // ============================================

    /**
     * Check if we have API access (AIGateway or direct API key)
     * @private
     * @returns {boolean}
     */
    _hasApiAccess() {
      return (window.AIGateway && typeof window.AIGateway.embedText === 'function') ||
             (this.options.apiKey && this.options.provider === 'openai');
    }

    /**
     * Call OpenAI embedding API
     * @private
     * @param {Array<string>} texts - Texts to embed
     * @returns {Promise<Array<Array<number>>>} - Embeddings
     */
    async _embedOpenAI(texts) {
      this.stats.apiCalls++;

      // Try AIGateway first (if available)
      if (window.AIGateway && typeof window.AIGateway.embedText === 'function') {
        try {
          const embeddings = [];
          for (const text of texts) {
            const embedding = await window.AIGateway.embedText(text, {
              model: this.options.model,
              dimensions: this.options.dimensions
            });
            embeddings.push(embedding);
          }
          return embeddings;
        } catch (error) {
          console.warn('[EmbeddingProvider] AIGateway failed, trying direct API:', error.message);
          // Fall through to direct API call
        }
      }

      // Direct API call
      if (!this.options.apiKey) {
        throw new Error('No API key available');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

      try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.options.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            input: texts,
            model: this.options.model,
            dimensions: this.options.dimensions
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();

        if (!data || !data.data) {
          throw new Error('Invalid response from OpenAI API');
        }

        this.stats.totalTokens += data.usage?.total_tokens || 0;

        return data.data.map(item => item.embedding);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // ============================================
    // PRIVATE METHODS - FALLBACK
    // ============================================

    /**
     * Generate bag-of-words embedding (fallback)
     * @private
     * @param {string} text - Text to embed
     * @returns {Array<number>} - Embedding vector
     */
    _generateBagOfWords(text) {
      const words = text
        .toLowerCase()
        .replace(/[^\w\sáéíóúàèìòùâêîôûãõç]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2);

      const freq = {};
      for (const w of words) {
        freq[w] = (freq[w] || 0) + 1;
      }

      // Normalize
      const norm = Math.sqrt(Object.values(freq).reduce((a, b) => a + b * b, 0)) || 1;
      for (const w in freq) {
        freq[w] /= norm;
      }

      // Convert to dense vector for consistency with API embeddings
      // Use simple hash to map words to dimensions
      const embedding = new Array(this.options.dimensions).fill(0);
      for (const word in freq) {
        const idx = this._simpleHash(word) % this.options.dimensions;
        embedding[idx] += freq[word];
      }

      // Normalize again
      const embNorm = Math.sqrt(embedding.reduce((a, b) => a + b * b, 0)) || 1;
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= embNorm;
      }

      return embedding;
    }

    // ============================================
    // PRIVATE METHODS - CACHING
    // ============================================

    /**
     * Load cache from chrome.storage.local
     * @private
     * @returns {Promise<void>}
     */
    async _loadCacheFromStorage() {
      if (this.cacheLoaded) return;

      if (typeof chrome === 'undefined' || !chrome.storage) {
        this.cacheLoaded = true;
        return;
      }

      try {
        const result = await chrome.storage.local.get(this.options.storageKey);
        const cached = result[this.options.storageKey];
        
        if (cached && Array.isArray(cached)) {
          // Restore cache from array of [key, value] pairs
          for (const [key, value] of cached) {
            this.cache.set(key, value);
            this.cacheKeys.push(key);
          }
          console.log(`[EmbeddingProvider] Loaded ${this.cache.size} embeddings from storage`);
        }
      } catch (error) {
        console.error('[EmbeddingProvider] Error loading cache from storage:', error);
      }

      this.cacheLoaded = true;
    }

    /**
     * Ensure cache is loaded before operations
     * @private
     * @returns {Promise<void>}
     */
    async _ensureCacheLoaded() {
      if (!this.cacheLoaded) {
        await this._loadCacheFromStorage();
      }
    }

    /**
     * Add to LRU cache (in-memory and storage)
     * @private
     * @param {string} key - Cache key
     * @param {Array<number>} value - Embedding value
     */
    _addToCache(key, value) {
      // Remove oldest if cache is full
      if (this.cache.size >= this.options.cacheSize) {
        const oldestKey = this.cacheKeys.shift();
        this.cache.delete(oldestKey);
      }

      this.cache.set(key, value);
      this.cacheKeys.push(key);

      // Persist to storage (debounced)
      this._scheduleCacheSave();
    }

    /**
     * Schedule cache save to storage (debounced)
     * @private
     */
    _scheduleCacheSave() {
      if (this._saveCacheTimeout) {
        clearTimeout(this._saveCacheTimeout);
      }

      this._saveCacheTimeout = setTimeout(() => {
        this._saveCacheToStorage();
      }, 2000); // Debounce 2 seconds
    }

    /**
     * Save cache to chrome.storage.local
     * @private
     * @returns {Promise<void>}
     */
    async _saveCacheToStorage() {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        return;
      }

      try {
        // Convert Map to array of [key, value] pairs for storage
        const cacheArray = Array.from(this.cache.entries());
        
        await chrome.storage.local.set({
          [this.options.storageKey]: cacheArray
        });
      } catch (error) {
        console.error('[EmbeddingProvider] Error saving cache to storage:', error);
      }
    }

    // ============================================
    // PRIVATE METHODS - HASHING
    // ============================================

    /**
     * FNV-1a hash for cache keys
     * @private
     * @param {string} text - Text to hash
     * @returns {string} - Hash string
     */
    _hashText(text) {
      let hash = 2166136261;
      for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
      }
      return (hash >>> 0).toString(36);
    }

    /**
     * Simple hash for word-to-dimension mapping
     * @private
     * @param {string} str - String to hash
     * @returns {number} - Hash number
     */
    _simpleHash(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return Math.abs(hash);
    }
  }

  // ============================================
  // EXPORT
  // ============================================

  window.EmbeddingProvider = EmbeddingProvider;

  console.log('[EmbeddingProvider] 🧠 Extension-side embedding provider loaded');

})();
