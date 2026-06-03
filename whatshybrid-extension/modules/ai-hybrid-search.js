/**
 * 🔍 HybridSearch - BM25 + Semantic Search with RRF Fusion (Extension)
 * 
 * Combines keyword-based BM25 scoring with semantic embedding search
 * using Reciprocal Rank Fusion (RRF) for optimal retrieval quality.
 * 
 * Features:
 * - BM25 algorithm (k1=1.5, b=0.75)
 * - Semantic search with fallback to bag-of-words
 * - Reciprocal Rank Fusion (RRF) with configurable k parameter
 * - Configurable alpha weight (semantic vs keyword balance)
 * - Full-text indexing with TF-IDF statistics
 * - Chrome storage persistence support
 * - Stats tracking and performance monitoring
 * 
 * @version 1.0.0
 * @author WhatsHybrid Team
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'whl_hybrid_search_index';

  class HybridSearch {
    /**
     * Create a new HybridSearch instance
     * @param {Object} options - Configuration options
     * @param {number} [options.alpha=0.7] - Weight for semantic search (0-1, higher = more semantic)
     * @param {number} [options.k=60] - RRF k parameter (rank fusion constant)
     * @param {number} [options.bm25K1=1.5] - BM25 k1 parameter (term saturation)
     * @param {number} [options.bm25B=0.75] - BM25 b parameter (length normalization)
     * @param {boolean} [options.persistToStorage=false] - Enable chrome.storage persistence
     * @param {number} [options.embeddingDimensions=256] - Embedding vector dimensions
     */
    constructor(options = {}) {
      this.options = {
        alpha: options.alpha !== undefined ? options.alpha : 0.7,
        k: options.k || 60,
        bm25K1: options.bm25K1 !== undefined ? options.bm25K1 : 1.5,
        bm25B: options.bm25B !== undefined ? options.bm25B : 0.75,
        persistToStorage: options.persistToStorage || false,
        embeddingDimensions: options.embeddingDimensions || 256,
        ...options
      };

      // Document storage
      this.documents = new Map();
      
      // BM25 index structures
      this.termFrequencies = new Map(); // docId -> { term: freq }
      this.documentFrequencies = new Map(); // term -> count of docs containing term
      this.documentLengths = new Map(); // docId -> length in tokens
      this.averageDocumentLength = 0;
      this.totalDocuments = 0;

      // Semantic index (using bag-of-words fallback)
      this.embeddings = new Map(); // docId -> embedding vector

      // Stats
      this.stats = {
        totalDocuments: 0,
        totalSearches: 0,
        bm25Searches: 0,
        semanticSearches: 0,
        hybridSearches: 0,
        avgBM25Score: 0,
        avgSemanticScore: 0,
        avgFusionScore: 0,
        totalBM25Score: 0,
        totalSemanticScore: 0,
        totalFusionScore: 0,
        storageLoads: 0,
        storageSaves: 0
      };

      // Load from storage if enabled
      if (this.options.persistToStorage) {
        this._loadFromStorage();
      }
    }

    /**
     * Add a document to the index
     * @param {Object} doc - Document to add
     * @param {string} doc.id - Unique document ID
     * @param {string} doc.content - Document text content
     * @param {Object} [doc.metadata] - Optional metadata
     * @returns {Promise<Object>} - Indexed document with stats
     */
    async addDocument(doc) {
      if (!doc || !doc.id || !doc.content) {
        throw new Error('Document must have id and content properties');
      }

      const { id, content, metadata = {} } = doc;

      // Check if document already exists
      if (this.documents.has(id)) {
        await this.removeDocument(id);
      }

      // Store document
      this.documents.set(id, { id, content, metadata, addedAt: Date.now() });

      // Tokenize and index for BM25
      const tokens = this._tokenize(content);
      const termFreq = this._computeTermFrequencies(tokens);
      
      this.termFrequencies.set(id, termFreq);
      this.documentLengths.set(id, tokens.length);

      // Update document frequencies
      for (const term of Object.keys(termFreq)) {
        const currentDF = this.documentFrequencies.get(term) || 0;
        this.documentFrequencies.set(term, currentDF + 1);
      }

      // Update average document length
      this.totalDocuments++;
      this._updateAverageDocumentLength();

      // Generate and store embedding (bag-of-words fallback)
      try {
        const embedding = await this._generateEmbedding(content);
        this.embeddings.set(id, embedding);
      } catch (error) {
        console.error(`[HybridSearch] Failed to generate embedding for doc ${id}:`, error.message);
      }

      this.stats.totalDocuments = this.totalDocuments;

      // Persist to storage
      if (this.options.persistToStorage) {
        await this._saveToStorage();
      }

      return {
        id,
        indexed: true,
        tokens: tokens.length,
        uniqueTerms: Object.keys(termFreq).length,
        hasEmbedding: this.embeddings.has(id)
      };
    }

    /**
     * Remove a document from the index
     * @param {string} docId - Document ID to remove
     * @returns {Promise<boolean>} - True if document was removed
     */
    async removeDocument(docId) {
      if (!this.documents.has(docId)) {
        return false;
      }

      // Remove from documents
      this.documents.delete(docId);

      // Update document frequencies
      const termFreq = this.termFrequencies.get(docId);
      if (termFreq) {
        for (const term of Object.keys(termFreq)) {
          const currentDF = this.documentFrequencies.get(term) || 0;
          const newDF = currentDF - 1;
          if (newDF <= 0) {
            this.documentFrequencies.delete(term);
          } else {
            this.documentFrequencies.set(term, newDF);
          }
        }
        this.termFrequencies.delete(docId);
      }

      // Remove document length
      this.documentLengths.delete(docId);

      // Remove embedding
      this.embeddings.delete(docId);

      // Update stats
      this.totalDocuments--;
      this._updateAverageDocumentLength();
      this.stats.totalDocuments = this.totalDocuments;

      // Persist to storage
      if (this.options.persistToStorage) {
        await this._saveToStorage();
      }

      return true;
    }

    /**
     * Search documents using hybrid BM25 + semantic search with RRF fusion
     * @param {string} query - Search query
     * @param {number} [topK=5] - Number of results to return
     * @param {Object} [options] - Search options
     * @param {number} [options.alpha] - Override default alpha
     * @param {number} [options.k] - Override default RRF k
     * @param {boolean} [options.bm25Only=false] - Use only BM25 scoring
     * @param {boolean} [options.semanticOnly=false] - Use only semantic scoring
     * @returns {Promise<Object>} - Search results with fusion scores
     */
    async search(query, topK = 5, options = {}) {
      if (!query || typeof query !== 'string') {
        throw new Error('Query must be a non-empty string');
      }

      if (this.totalDocuments === 0) {
        return {
          query,
          results: [],
          method: 'none',
          totalDocuments: 0,
          searchTime: 0
        };
      }

      const startTime = Date.now();
      this.stats.totalSearches++;

      const alpha = options.alpha !== undefined ? options.alpha : this.options.alpha;
      const k = options.k !== undefined ? options.k : this.options.k;
      const bm25Only = options.bm25Only || false;
      const semanticOnly = options.semanticOnly || false;

      let results = [];
      let method = 'hybrid';

      // Determine search method
      if (bm25Only) {
        method = 'bm25';
        results = this._searchBM25(query, topK * 2);
        this.stats.bm25Searches++;
      } else if (semanticOnly) {
        method = 'semantic';
        results = await this._searchSemantic(query, topK * 2);
        this.stats.semanticSearches++;
      } else {
        // Hybrid search with RRF fusion
        method = 'hybrid';
        this.stats.hybridSearches++;

        const bm25Results = this._searchBM25(query, topK * 3);
        const semanticResults = await this._searchSemantic(query, topK * 3);

        results = this._fuseResults(bm25Results, semanticResults, alpha, k);
      }

      // Take top K
      const finalResults = results.slice(0, topK).map(result => ({
        ...result,
        document: this.documents.get(result.docId),
        metadata: this.documents.get(result.docId)?.metadata
      }));

      // Update stats
      if (finalResults.length > 0) {
        const avgScore = finalResults.reduce((sum, r) => sum + r.score, 0) / finalResults.length;
        
        if (method === 'bm25') {
          this.stats.totalBM25Score += avgScore;
          this.stats.avgBM25Score = this.stats.totalBM25Score / this.stats.bm25Searches;
        } else if (method === 'semantic') {
          this.stats.totalSemanticScore += avgScore;
          this.stats.avgSemanticScore = this.stats.totalSemanticScore / this.stats.semanticSearches;
        } else {
          this.stats.totalFusionScore += avgScore;
          this.stats.avgFusionScore = this.stats.totalFusionScore / this.stats.hybridSearches;
        }
      }

      const searchTime = Date.now() - startTime;

      return {
        query,
        results: finalResults,
        method,
        alpha: method === 'hybrid' ? alpha : undefined,
        k: method === 'hybrid' ? k : undefined,
        totalDocuments: this.totalDocuments,
        searchTime
      };
    }

    /**
     * BM25 search
     * @private
     */
    _searchBM25(query, limit) {
      const queryTokens = this._tokenize(query);
      const queryTerms = [...new Set(queryTokens)];

      const scores = [];

      for (const [docId, termFreq] of this.termFrequencies.entries()) {
        const score = this._computeBM25Score(queryTerms, termFreq, docId);
        if (score > 0) {
          scores.push({ docId, score, method: 'bm25' });
        }
      }

      scores.sort((a, b) => b.score - a.score);
      return scores.slice(0, limit);
    }

    /**
     * Semantic search
     * @private
     */
    async _searchSemantic(query, limit) {
      if (this.embeddings.size === 0) {
        return [];
      }

      try {
        const queryEmbedding = await this._generateEmbedding(query);
        const scores = [];

        for (const [docId, docEmbedding] of this.embeddings.entries()) {
          const similarity = this._cosineSimilarity(queryEmbedding, docEmbedding);
          scores.push({ docId, score: similarity, method: 'semantic' });
        }

        scores.sort((a, b) => b.score - a.score);
        return scores.slice(0, limit);
      } catch (error) {
        console.error('[HybridSearch] Semantic search failed:', error.message);
        return [];
      }
    }

    /**
     * Fuse BM25 and semantic results using Reciprocal Rank Fusion (RRF)
     * @private
     */
    _fuseResults(bm25Results, semanticResults, alpha, k) {
      const rrfScores = new Map();

      // Create rank maps
      const bm25Ranks = new Map();
      bm25Results.forEach((result, index) => {
        bm25Ranks.set(result.docId, index + 1);
      });

      const semanticRanks = new Map();
      semanticResults.forEach((result, index) => {
        semanticRanks.set(result.docId, index + 1);
      });

      // Get all unique document IDs
      const allDocIds = new Set([
        ...bm25Results.map(r => r.docId),
        ...semanticResults.map(r => r.docId)
      ]);

      // Compute RRF scores
      for (const docId of allDocIds) {
        const bm25Rank = bm25Ranks.get(docId);
        const semanticRank = semanticRanks.get(docId);

        let rrfScore = 0;

        // RRF formula: score = sum(1 / (k + rank))
        if (bm25Rank) {
          rrfScore += (1 - alpha) * (1 / (k + bm25Rank));
        }

        if (semanticRank) {
          rrfScore += alpha * (1 / (k + semanticRank));
        }

        rrfScores.set(docId, rrfScore);
      }

      // Sort by RRF score
      const fusedResults = Array.from(rrfScores.entries()).map(([docId, score]) => ({
        docId,
        score,
        method: 'rrf',
        bm25Rank: bm25Ranks.get(docId) || null,
        semanticRank: semanticRanks.get(docId) || null
      }));

      fusedResults.sort((a, b) => b.score - a.score);
      return fusedResults;
    }

    /**
     * Compute BM25 score for a document
     * @private
     */
    _computeBM25Score(queryTerms, docTermFreq, docId) {
      const { bm25K1, bm25B } = this.options;
      const docLength = this.documentLengths.get(docId);
      const avgDocLength = this.averageDocumentLength;

      let score = 0;

      for (const term of queryTerms) {
        const termFreq = docTermFreq[term] || 0;
        if (termFreq === 0) continue;

        const docFreq = this.documentFrequencies.get(term) || 0;
        if (docFreq === 0) continue;

        // IDF: ln((N - df + 0.5) / (df + 0.5) + 1)
        const idf = Math.log(
          ((this.totalDocuments - docFreq + 0.5) / (docFreq + 0.5)) + 1
        );

        // BM25 formula
        const numerator = termFreq * (bm25K1 + 1);
        const denominator = termFreq + bm25K1 * (1 - bm25B + bm25B * (docLength / avgDocLength));

        score += idf * (numerator / denominator);
      }

      return score;
    }

    /**
     * Generate embedding using bag-of-words fallback
     * Uses EmbeddingProvider if available via window.EmbeddingProvider
     * @private
     */
    async _generateEmbedding(text) {
      // Check if EmbeddingProvider is available
      if (window.EmbeddingProvider) {
        try {
          const provider = new window.EmbeddingProvider();
          return await provider.embed(text);
        } catch (error) {
          console.warn('[HybridSearch] EmbeddingProvider failed, using bag-of-words:', error.message);
        }
      }

      // Fallback: bag-of-words embedding
      return this._generateBagOfWords(text);
    }

    /**
     * Generate bag-of-words embedding
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

      // Convert to dense vector
      const embedding = new Array(this.options.embeddingDimensions).fill(0);
      for (const word in freq) {
        const idx = this._simpleHash(word) % this.options.embeddingDimensions;
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
     * Cosine similarity between two embeddings
     * @private
     */
    _cosineSimilarity(a, b) {
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
     * Tokenize text
     * @private
     */
    _tokenize(text) {
      return text
        .toLowerCase()
        .replace(/[^\w\sáéíóúàèìòùâêîôûãõç]/g, '')
        .split(/\s+/)
        .filter(token => token.length > 1);
    }

    /**
     * Compute term frequencies
     * @private
     */
    _computeTermFrequencies(tokens) {
      const termFreq = {};
      for (const token of tokens) {
        termFreq[token] = (termFreq[token] || 0) + 1;
      }
      return termFreq;
    }

    /**
     * Update average document length
     * @private
     */
    _updateAverageDocumentLength() {
      if (this.totalDocuments === 0) {
        this.averageDocumentLength = 0;
        return;
      }

      let totalLength = 0;
      for (const length of this.documentLengths.values()) {
        totalLength += length;
      }

      this.averageDocumentLength = totalLength / this.totalDocuments;
    }

    /**
     * Clear all documents and reset index
     * @returns {Promise<void>}
     */
    async clear() {
      this.documents.clear();
      this.termFrequencies.clear();
      this.documentFrequencies.clear();
      this.documentLengths.clear();
      this.embeddings.clear();
      this.averageDocumentLength = 0;
      this.totalDocuments = 0;

      this.stats = {
        totalDocuments: 0,
        totalSearches: 0,
        bm25Searches: 0,
        semanticSearches: 0,
        hybridSearches: 0,
        avgBM25Score: 0,
        avgSemanticScore: 0,
        avgFusionScore: 0,
        totalBM25Score: 0,
        totalSemanticScore: 0,
        totalFusionScore: 0,
        storageLoads: this.stats.storageLoads,
        storageSaves: this.stats.storageSaves
      };

      // Clear from storage
      if (this.options.persistToStorage) {
        await this._saveToStorage();
      }
    }

    /**
     * Get current statistics
     * @returns {Object} - Statistics object
     */
    getStats() {
      return {
        ...this.stats,
        indexSize: {
          documents: this.totalDocuments,
          terms: this.documentFrequencies.size,
          embeddings: this.embeddings.size
        },
        averageDocumentLength: this.averageDocumentLength
      };
    }

    /**
     * Get document by ID
     * @param {string} docId - Document ID
     * @returns {Object|null} - Document or null if not found
     */
    getDocument(docId) {
      return this.documents.get(docId) || null;
    }

    /**
     * Get all document IDs
     * @returns {Array<string>} - Array of document IDs
     */
    getDocumentIds() {
      return Array.from(this.documents.keys());
    }

    /**
     * Save index to chrome.storage.local
     * @private
     */
    async _saveToStorage() {
      if (!chrome || !chrome.storage || !chrome.storage.local) {
        return;
      }

      try {
        const data = {
          documents: Array.from(this.documents.entries()),
          termFrequencies: Array.from(this.termFrequencies.entries()),
          documentFrequencies: Array.from(this.documentFrequencies.entries()),
          documentLengths: Array.from(this.documentLengths.entries()),
          embeddings: Array.from(this.embeddings.entries()),
          averageDocumentLength: this.averageDocumentLength,
          totalDocuments: this.totalDocuments,
          stats: this.stats,
          version: '1.0.0',
          savedAt: Date.now()
        };

        await chrome.storage.local.set({ [STORAGE_KEY]: data });
        this.stats.storageSaves++;
      } catch (error) {
        console.error('[HybridSearch] Failed to save to storage:', error);
      }
    }

    /**
     * Load index from chrome.storage.local
     * @private
     */
    async _loadFromStorage() {
      if (!chrome || !chrome.storage || !chrome.storage.local) {
        return;
      }

      try {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        const data = result[STORAGE_KEY];

        if (!data) {
          return;
        }

        this.documents = new Map(data.documents || []);
        this.termFrequencies = new Map(data.termFrequencies || []);
        this.documentFrequencies = new Map(data.documentFrequencies || []);
        this.documentLengths = new Map(data.documentLengths || []);
        this.embeddings = new Map(data.embeddings || []);
        this.averageDocumentLength = data.averageDocumentLength || 0;
        this.totalDocuments = data.totalDocuments || 0;
        
        if (data.stats) {
          this.stats = { ...this.stats, ...data.stats };
        }

        this.stats.storageLoads++;
        
        console.log(`[HybridSearch] Loaded ${this.totalDocuments} documents from storage`);
      } catch (error) {
        console.error('[HybridSearch] Failed to load from storage:', error);
      }
    }
  }

  // Export to window
  window.HybridSearch = HybridSearch;

  console.log('✅ HybridSearch module loaded (IIFE)');
})();
