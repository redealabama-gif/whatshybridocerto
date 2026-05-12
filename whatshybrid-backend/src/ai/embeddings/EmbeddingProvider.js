/**
 * 🧠 EmbeddingProvider - Real Embeddings via API
 * Provides semantic embeddings for RAG with fallback to bag-of-words
 * 
 * Features:
 * - OpenAI text-embedding-3-small (default)
 * - Batch embedding support
 * - LRU cache (max 5000 entries)
 * - FNV-1a hash for cache keys
 * - Configurable dimensions (default 256)
 * - Graceful fallback to bag-of-words
 * 
 * @version 1.0.0
 */

const axios = require('axios');
const logger = require('../../utils/logger');

class EmbeddingProvider {
  constructor(options = {}) {
    this.options = {
      provider: options.provider || 'openai',
      apiKey: options.apiKey || process.env.OPENAI_API_KEY,
      model: options.model || 'text-embedding-3-small',
      dimensions: options.dimensions || 256,
      maxBatchSize: options.maxBatchSize || 100,
      cacheSize: options.cacheSize || 5000,
      timeout: options.timeout || 30000,
      ...options
    };

    // CORREÇÃO P3: LRU cache real usando Map com insertion-order trick
    // Map mantém ordem de inserção — ao fazer get(), reinsere no final para marcar como "recently used"
    // Ao evictar, remove o primeiro item (= menos recentemente usado)
    this.cache = new Map();
    // cacheKeys mantido apenas para compatibilidade — não usado na LRU real
    this.cacheKeys = [];

    // Stats
    this.stats = {
      apiCalls: 0,
      cacheHits: 0,
      cacheMisses: 0,
      fallbacks: 0,
      totalTokens: 0,
      errors: 0
    };
  }

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
    
    // Check cache
    if (this.cache.has(cacheKey)) {
      this.stats.cacheHits++;
      return this._getFromCache(cacheKey);
    }

    this.stats.cacheMisses++;

    try {
      let embedding;

      if (this.options.apiKey && this.options.provider === 'openai') {
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
      logger.error('[EmbeddingProvider] Error generating embedding:', error.message);
      
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

    const results = [];
    const toEmbed = [];
    const indices = [];

    // Check cache first
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const cacheKey = this._hashText(text);
      
      if (this.cache.has(cacheKey)) {
        this.stats.cacheHits++;
        results[i] = this._getFromCache(cacheKey);
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

        if (this.options.apiKey && this.options.provider === 'openai') {
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
        logger.error('[EmbeddingProvider] Error in batch embedding:', error.message);
        
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
   * Call OpenAI embedding API
   * @private
   */
  async _embedOpenAI(texts) {
    this.stats.apiCalls++;

    const response = await axios.post(
      'https://api.openai.com/v1/embeddings',
      {
        input: texts,
        model: this.options.model,
        dimensions: this.options.dimensions
      },
      {
        headers: {
          'Authorization': `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: this.options.timeout
      }
    );

    if (!response.data || !response.data.data) {
      throw new Error('Invalid response from OpenAI API');
    }

    this.stats.totalTokens += response.data.usage?.total_tokens || 0;

    return response.data.data.map(item => item.embedding);
  }

  /**
   * Fallback: Generate bag-of-words embedding
   * @private
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

  /**
   * FNV-1a hash for cache keys
   * @private
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

  /**
   * Add to LRU cache
   * @private
   */
  _addToCache(key, value) {
    // CORREÇÃO P3: LRU real — evictar o MENOS recentemente usado (primeiro do Map)
    if (this.cache.size >= this.options.cacheSize) {
      // O primeiro item do Map é o menos recentemente usado
      const lruKey = this.cache.keys().next().value;
      this.cache.delete(lruKey);
    }
    this.cache.set(key, value);
  }

  _getFromCache(key) {
    if (!this.cache.has(key)) return undefined;
    const value = this._getFromCache(key);
    // CORREÇÃO P3: Mover para o final do Map para marcar como recently used
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Cosine similarity between two embeddings
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
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    this.cacheKeys = [];
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      cacheHitRate: this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) || 0
    };
  }
}

module.exports = EmbeddingProvider;
