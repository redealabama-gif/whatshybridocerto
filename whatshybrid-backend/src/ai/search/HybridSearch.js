/**
 * 🔍 HybridSearch - BM25 + Semantic Search with RRF Fusion
 *
 * Combines keyword-based BM25 scoring with semantic embedding search
 * using Reciprocal Rank Fusion (RRF) for optimal retrieval quality.
 *
 * Features:
 * - BM25 algorithm (k1=1.5, b=0.75)
 * - Semantic search via EmbeddingProvider
 * - Reciprocal Rank Fusion (RRF) with configurable k parameter
 * - Configurable alpha weight (semantic vs keyword balance)
 * - Full-text indexing with TF-IDF statistics
 * - Stats tracking and performance monitoring
 *
 * FIXES APPLIED:
 *  P2 - Index is now persisted to disk (JSON snapshot) on every write and loaded on startup,
 *       eliminating cold-start re-indexing via the OpenAI embeddings API.
 *  P4 - tenantId is used as a namespace: each tenant's index lives in a separate file
 *       and all document keys are prefixed, preventing cross-tenant contamination.
 *
 * @version 2.0.0
 */

const fs = require('fs').promises;
const logger = require('../../utils/logger');
const path = require('path');
const EmbeddingProvider = require('../embeddings/EmbeddingProvider');

class HybridSearch {
  /**
   * Create a new HybridSearch instance
   * @param {Object} options - Configuration options
   * @param {string} [options.tenantId='default']  – P4: namespace for index isolation
   * @param {string} [options.persistenceDir]      – P2: directory for index snapshots
   * @param {number} [options.alpha=0.7] - Weight for semantic search (0-1, higher = more semantic)
   * @param {number} [options.k=60] - RRF k parameter (rank fusion constant)
   * @param {number} [options.bm25K1=1.5] - BM25 k1 parameter (term saturation)
   * @param {number} [options.bm25B=0.75] - BM25 b parameter (length normalization)
   * @param {Object} [options.embeddingOptions] - Options for EmbeddingProvider
   */
  constructor(options = {}) {
    // P4: tenant namespace — each tenant gets its own index file and key prefix
    // FIX HIGH SECURITY: sanitiza tenantId — usado em snapshotPath.
    // Sem sanitização, tenantId="../../foo" escape do persistenceDir.
    const rawTenant = options.tenantId || 'default';
    this.tenantId = String(rawTenant).replace(/[^A-Za-z0-9_\-]/g, '_').substring(0, 100) || 'default';

    this.options = {
      alpha: options.alpha !== undefined ? options.alpha : 0.7,
      k: options.k || 60,
      bm25K1: options.bm25K1 !== undefined ? options.bm25K1 : 1.5,
      bm25B: options.bm25B !== undefined ? options.bm25B : 0.75,
      embeddingOptions: options.embeddingOptions || {},
      ...options
    };

    // P2: persistence config — tenant-scoped snapshot file
    this.persistenceDir = options.persistenceDir ||
      path.join(process.cwd(), 'data', 'search-index');
    this.snapshotPath = path.join(this.persistenceDir, `index-${this.tenantId}.json`);
    this._persistenceDirty = false;
    this._persistenceTimer = null;

    // Initialize EmbeddingProvider
    this.embeddingProvider = new EmbeddingProvider(this.options.embeddingOptions);

    // Document storage
    this.documents = new Map();

    // BM25 index structures
    this.termFrequencies = new Map(); // docId -> { term: freq }
    this.documentFrequencies = new Map(); // term -> count of docs containing term
    this.documentLengths = new Map(); // docId -> length in tokens
    this.averageDocumentLength = 0;
    this.totalDocuments = 0;

    // Semantic index
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
      totalFusionScore: 0
    };
  }

  // ─────────────────────────────────────────────
  // P2: Persistence helpers
  // ─────────────────────────────────────────────

  /**
   * Load persisted index from disk on startup.
   * If the snapshot exists, restores documents, BM25 structures and embeddings —
   * eliminating the need to re-embed all documents via OpenAI on every process restart.
   */
  async loadFromDisk() {
    try {
      await fs.mkdir(this.persistenceDir, { recursive: true });
      const raw = await fs.readFile(this.snapshotPath, 'utf8');
      const snapshot = JSON.parse(raw);

      // Restore documents
      if (snapshot.documents) {
        this.documents = new Map(snapshot.documents);
      }
      // Restore BM25 index
      if (snapshot.termFrequencies) {
        this.termFrequencies = new Map(
          snapshot.termFrequencies.map(([id, tf]) => [id, new Map(Object.entries(tf))])
        );
      }
      if (snapshot.documentFrequencies) {
        this.documentFrequencies = new Map(Object.entries(snapshot.documentFrequencies));
      }
      if (snapshot.documentLengths) {
        this.documentLengths = new Map(Object.entries(snapshot.documentLengths));
      }
      this.averageDocumentLength = snapshot.averageDocumentLength || 0;
      this.totalDocuments = snapshot.totalDocuments || 0;

      // Restore embeddings (stored as plain arrays, restored to Float32Array-compatible plain arrays)
      if (snapshot.embeddings) {
        this.embeddings = new Map(snapshot.embeddings);
      }

      logger.info(`[HybridSearch] Loaded index from disk (tenant: ${this.tenantId}, docs: ${this.documents.size})`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`[HybridSearch] Could not load index snapshot: ${err.message}`);
      }
      // First run or corrupt snapshot — start with empty index (normal)
    }
  }

  /**
   * Persist current index to disk.
   * Debounced: writes are coalesced into one write per 500ms to avoid hammering disk.
   * @private
   */
  _schedulePersistence() {
    this._persistenceDirty = true;
    if (this._persistenceTimer) clearTimeout(this._persistenceTimer);
    this._persistenceTimer = setTimeout(() => this._flushToDisk(), 500);
  }

  async _flushToDisk() {
    if (!this._persistenceDirty) return;
    try {
      await fs.mkdir(this.persistenceDir, { recursive: true });

      // Serialise Maps to JSON-compatible structures
      const snapshot = {
        tenantId: this.tenantId,
        savedAt: new Date().toISOString(),
        documents: Array.from(this.documents.entries()),
        termFrequencies: Array.from(this.termFrequencies.entries()).map(
          ([id, tf]) => [id, Object.fromEntries(tf)]
        ),
        documentFrequencies: Object.fromEntries(this.documentFrequencies),
        documentLengths: Object.fromEntries(this.documentLengths),
        averageDocumentLength: this.averageDocumentLength,
        totalDocuments: this.totalDocuments,
        embeddings: Array.from(this.embeddings.entries()),
      };

      const tmpPath = this.snapshotPath + '.tmp';
      await fs.writeFile(tmpPath, JSON.stringify(snapshot), 'utf8');
      await fs.rename(tmpPath, this.snapshotPath); // atomic rename
      this._persistenceDirty = false;
    } catch (err) {
      logger.error(`[HybridSearch] Failed to persist index: ${err.message}`);
    }
  }

  /** Force-flush on shutdown */
  async flush() {
    if (this._persistenceTimer) clearTimeout(this._persistenceTimer);
    await this._flushToDisk();
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

    // Generate and store embedding
    try {
      const embedding = await this.embeddingProvider.embed(content);
      this.embeddings.set(id, embedding);
    } catch (error) {
      logger.error(`[HybridSearch] Failed to generate embedding for doc ${id}:`, error.message);
      // Continue without embedding - will only use BM25
    }

    this.stats.totalDocuments = this.totalDocuments;

    // P2: schedule async persistence of the updated index
    this._schedulePersistence();

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
   * @returns {boolean} - True if document was removed
   */
  removeDocument(docId) {
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

    // P2: schedule persistence after removal
    this._schedulePersistence();

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
      const queryEmbedding = await this.embeddingProvider.embed(query);
      const scores = [];

      for (const [docId, docEmbedding] of this.embeddings.entries()) {
        const similarity = this.embeddingProvider.cosineSimilarity(queryEmbedding, docEmbedding);
        scores.push({ docId, score: similarity, method: 'semantic' });
      }

      scores.sort((a, b) => b.score - a.score);
      return scores.slice(0, limit);
    } catch (error) {
      logger.error('[HybridSearch] Semantic search failed:', error.message);
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
   */
  clear() {
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
      totalFusionScore: 0
    };
  }

  /**
   * Get current statistics
   * @returns {Object} - Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      embeddingStats: this.embeddingProvider.getStats(),
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
}

module.exports = HybridSearch;
