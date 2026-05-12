/**
 * QUAL-001: RAG Local - Retrieval Augmented Generation com IndexedDB + HNSW
 * 
 * Benefícios:
 * - Busca semântica local sem depender de backend
 * - Resposta mais precisa usando conhecimento relevante
 * - Funciona offline após indexação inicial
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
    DB_NAME: 'whl_rag_vectors',
    DB_VERSION: 1,
    STORE_NAME: 'embeddings',
    
    // Configuração HNSW
    HNSW: {
      M: 16,                    // Número de conexões por nó
      EF_CONSTRUCTION: 200,    // Fator de construção
      EF_SEARCH: 50,           // Fator de busca
      MAX_LEVEL: 8             // Níveis máximos
    },
    
    // Configuração de embedding
    EMBEDDING: {
      DIMENSION: 384,           // Dimensão dos vetores (MiniLM)
      PROVIDER: 'local',        // local, openai, or backend
      MODEL: 'all-MiniLM-L6-v2' // Modelo local
    },
    
    // Chunking
    CHUNK_SIZE: 500,
    CHUNK_OVERLAP: 50,
    
    // Retrieval
    TOP_K: 5,
    MIN_SIMILARITY: 0.65,
    
    // Cache de embeddings
    EMBEDDING_CACHE_SIZE: 1000
  };

  // =============================================
  // INDEXEDDB WRAPPER
  // =============================================

  class VectorStore {
    constructor() {
      this.db = null;
    }

    async open() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          this.db = request.result;
          resolve(this.db);
        };
        
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          
          if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
            const store = db.createObjectStore(CONFIG.STORE_NAME, { keyPath: 'id' });
            store.createIndex('category', 'category', { unique: false });
            store.createIndex('source', 'source', { unique: false });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };
      });
    }

    async add(document) {
      const store = this.db
        .transaction(CONFIG.STORE_NAME, 'readwrite')
        .objectStore(CONFIG.STORE_NAME);
      
      return new Promise((resolve, reject) => {
        const request = store.put(document);
        request.onsuccess = () => resolve(document.id);
        request.onerror = () => reject(request.error);
      });
    }

    async addBatch(documents) {
      const tx = this.db.transaction(CONFIG.STORE_NAME, 'readwrite');
      const store = tx.objectStore(CONFIG.STORE_NAME);
      
      for (const doc of documents) {
        store.put(doc);
      }
      
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(documents.length);
        tx.onerror = () => reject(tx.error);
      });
    }

    async get(id) {
      const store = this.db
        .transaction(CONFIG.STORE_NAME, 'readonly')
        .objectStore(CONFIG.STORE_NAME);
      
      return new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async getAll() {
      const store = this.db
        .transaction(CONFIG.STORE_NAME, 'readonly')
        .objectStore(CONFIG.STORE_NAME);
      
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async getByCategory(category) {
      const store = this.db
        .transaction(CONFIG.STORE_NAME, 'readonly')
        .objectStore(CONFIG.STORE_NAME);
      
      const index = store.index('category');
      
      return new Promise((resolve, reject) => {
        const request = index.getAll(category);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async delete(id) {
      const store = this.db
        .transaction(CONFIG.STORE_NAME, 'readwrite')
        .objectStore(CONFIG.STORE_NAME);
      
      return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    }

    async clear() {
      const store = this.db
        .transaction(CONFIG.STORE_NAME, 'readwrite')
        .objectStore(CONFIG.STORE_NAME);
      
      return new Promise((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    }

    async count() {
      const store = this.db
        .transaction(CONFIG.STORE_NAME, 'readonly')
        .objectStore(CONFIG.STORE_NAME);
      
      return new Promise((resolve, reject) => {
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
  }

  // =============================================
  // HNSW INDEX (Simplified Implementation)
  // =============================================

  class HNSWIndex {
    constructor(dimension, config = {}) {
      this.dimension = dimension;
      this.M = config.M || CONFIG.HNSW.M;
      this.efConstruction = config.efConstruction || CONFIG.HNSW.EF_CONSTRUCTION;
      this.efSearch = config.efSearch || CONFIG.HNSW.EF_SEARCH;
      this.maxLevel = config.maxLevel || CONFIG.HNSW.MAX_LEVEL;
      
      this.nodes = new Map();
      this.entryPoint = null;
      this.levels = new Map();
    }

    _randomLevel() {
      let level = 0;
      while (Math.random() < 0.5 && level < this.maxLevel) {
        level++;
      }
      return level;
    }

    _distance(a, b) {
      // Cosine similarity convertida para distância
      let dotProduct = 0;
      let normA = 0;
      let normB = 0;
      
      for (let i = 0; i < this.dimension; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      
      const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
      return 1 - similarity; // Distância = 1 - similaridade
    }

    _selectNeighbors(candidates, k) {
      // Seleciona k vizinhos mais próximos
      return candidates
        .sort((a, b) => a.distance - b.distance)
        .slice(0, k);
    }

    add(id, vector, metadata = {}) {
      const level = this._randomLevel();
      
      const node = {
        id,
        vector,
        metadata,
        level,
        neighbors: new Array(level + 1).fill(null).map(() => [])
      };
      
      this.nodes.set(id, node);
      
      // Primeiro nó
      if (!this.entryPoint) {
        this.entryPoint = id;
        for (let l = 0; l <= level; l++) {
          if (!this.levels.has(l)) this.levels.set(l, new Set());
          this.levels.get(l).add(id);
        }
        return;
      }
      
      // Buscar ponto de entrada em cada nível
      let currentNode = this.entryPoint;
      
      // Descendo pelos níveis superiores
      for (let l = this.maxLevel; l > level; l--) {
        currentNode = this._greedySearch(currentNode, vector, l, 1)[0]?.id || currentNode;
      }
      
      // Inserir e conectar em cada nível
      for (let l = level; l >= 0; l--) {
        const neighbors = this._greedySearch(currentNode, vector, l, this.efConstruction);
        const selected = this._selectNeighbors(neighbors, this.M);
        
        node.neighbors[l] = selected.map(n => n.id);
        
        // Conectar vizinhos bidirecionalmente
        for (const neighbor of selected) {
          const neighborNode = this.nodes.get(neighbor.id);
          if (neighborNode && neighborNode.neighbors[l]) {
            neighborNode.neighbors[l].push(id);
            
            // Podar se exceder M
            if (neighborNode.neighbors[l].length > this.M) {
              const distances = neighborNode.neighbors[l].map(nId => ({
                id: nId,
                distance: this._distance(neighborNode.vector, this.nodes.get(nId).vector)
              }));
              neighborNode.neighbors[l] = this._selectNeighbors(distances, this.M).map(n => n.id);
            }
          }
        }
        
        if (!this.levels.has(l)) this.levels.set(l, new Set());
        this.levels.get(l).add(id);
        
        currentNode = selected[0]?.id || currentNode;
      }
      
      // Atualizar ponto de entrada se necessário
      if (level > this.nodes.get(this.entryPoint).level) {
        this.entryPoint = id;
      }
    }

    _greedySearch(startId, queryVector, level, ef) {
      if (!startId || !this.nodes.has(startId)) return [];
      
      const visited = new Set();
      const candidates = [];
      const results = [];
      
      const startNode = this.nodes.get(startId);
      const startDist = this._distance(queryVector, startNode.vector);
      
      candidates.push({ id: startId, distance: startDist });
      visited.add(startId);
      
      while (candidates.length > 0) {
        candidates.sort((a, b) => a.distance - b.distance);
        const current = candidates.shift();
        
        if (results.length >= ef && current.distance > results[results.length - 1].distance) {
          break;
        }
        
        results.push(current);
        
        const currentNode = this.nodes.get(current.id);
        if (!currentNode || !currentNode.neighbors[level]) continue;
        
        for (const neighborId of currentNode.neighbors[level]) {
          if (visited.has(neighborId)) continue;
          visited.add(neighborId);
          
          const neighbor = this.nodes.get(neighborId);
          if (!neighbor) continue;
          
          const dist = this._distance(queryVector, neighbor.vector);
          
          if (results.length < ef || dist < results[results.length - 1].distance) {
            candidates.push({ id: neighborId, distance: dist });
          }
        }
      }
      
      return results.slice(0, ef);
    }

    search(queryVector, k = CONFIG.TOP_K) {
      if (!this.entryPoint) return [];
      
      let currentNode = this.entryPoint;
      
      // Descendo pelos níveis
      for (let l = this.maxLevel; l > 0; l--) {
        if (!this.levels.has(l)) continue;
        currentNode = this._greedySearch(currentNode, queryVector, l, 1)[0]?.id || currentNode;
      }
      
      // Busca final no nível 0
      const results = this._greedySearch(currentNode, queryVector, 0, this.efSearch);
      
      return results
        .slice(0, k)
        .map(r => ({
          id: r.id,
          similarity: 1 - r.distance,
          metadata: this.nodes.get(r.id)?.metadata
        }));
    }

    remove(id) {
      if (!this.nodes.has(id)) return false;
      
      const node = this.nodes.get(id);
      
      // Remover das conexões dos vizinhos
      for (let l = 0; l <= node.level; l++) {
        for (const neighborId of node.neighbors[l]) {
          const neighbor = this.nodes.get(neighborId);
          if (neighbor && neighbor.neighbors[l]) {
            neighbor.neighbors[l] = neighbor.neighbors[l].filter(n => n !== id);
          }
        }
        this.levels.get(l)?.delete(id);
      }
      
      this.nodes.delete(id);
      
      // Atualizar entry point se necessário
      if (this.entryPoint === id) {
        this.entryPoint = this.nodes.keys().next().value || null;
      }
      
      return true;
    }

    size() {
      return this.nodes.size;
    }

    serialize() {
      return {
        dimension: this.dimension,
        M: this.M,
        efConstruction: this.efConstruction,
        efSearch: this.efSearch,
        maxLevel: this.maxLevel,
        entryPoint: this.entryPoint,
        nodes: Array.from(this.nodes.entries()),
        levels: Array.from(this.levels.entries()).map(([k, v]) => [k, Array.from(v)])
      };
    }

    static deserialize(data) {
      const index = new HNSWIndex(data.dimension, {
        M: data.M,
        efConstruction: data.efConstruction,
        efSearch: data.efSearch,
        maxLevel: data.maxLevel
      });
      
      index.entryPoint = data.entryPoint;
      index.nodes = new Map(data.nodes);
      index.levels = new Map(data.levels.map(([k, v]) => [k, new Set(v)]));
      
      return index;
    }
  }

  // =============================================
  // EMBEDDING SERVICE
  // =============================================

  class EmbeddingService {
    constructor() {
      this.cache = new Map();
      this.provider = CONFIG.EMBEDDING.PROVIDER;
    }

    async getEmbedding(text) {
      // Verificar cache
      const cacheKey = this._hashText(text);
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }
      
      let embedding;
      
      switch (this.provider) {
        case 'local':
          embedding = await this._getLocalEmbedding(text);
          break;
        case 'backend':
          embedding = await this._getBackendEmbedding(text);
          break;
        // v9.4.6: case 'openai' REMOVIDO — Backend-Only AI exige passar pelo
        // backend. _getOpenAIEmbedding e _getOpenAIKey eram dead code.
        default:
          embedding = this._getFallbackEmbedding(text);
      }
      
      // Cache
      this.cache.set(cacheKey, embedding);
      
      // Limitar tamanho do cache
      if (this.cache.size > CONFIG.EMBEDDING_CACHE_SIZE) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      
      return embedding;
    }

    _hashText(text) {
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return hash.toString(36);
    }

    async _getLocalEmbedding(text) {
      // Fallback: TF-IDF simplificado
      return this._getFallbackEmbedding(text);
    }

    async _getBackendEmbedding(text) {
      try {
        const backendUrl = await this._getBackendUrl();
        
        const response = await fetch(`${backendUrl}/api/v1/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        
        if (!response.ok) throw new Error('Backend API error');
        
        const data = await response.json();
        return data.embedding;
      } catch (e) {
        console.warn('[RAG] Backend embedding failed, using fallback');
        return this._getFallbackEmbedding(text);
      }
    }

    _getFallbackEmbedding(text) {
      // TF-IDF simplificado com hashing trick
      const words = text.toLowerCase()
        .replace(/[^\w\sáéíóúàèìòùâêîôûãõç]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2);
      
      const vector = new Array(CONFIG.EMBEDDING.DIMENSION).fill(0);
      
      for (const word of words) {
        // Hash do word para índice
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
          hash = ((hash << 5) - hash) + word.charCodeAt(i);
        }
        const index = Math.abs(hash) % CONFIG.EMBEDDING.DIMENSION;
        vector[index] += 1;
      }
      
      // Normalizar
      const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
      return vector.map(v => v / norm);
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
  }

  // =============================================
  // RAG SYSTEM
  // =============================================

  class LocalRAG {
    constructor() {
      this.vectorStore = new VectorStore();
      this.hnswIndex = new HNSWIndex(CONFIG.EMBEDDING.DIMENSION);
      this.embeddingService = new EmbeddingService();
      this.initialized = false;
      this.stats = {
        documentsIndexed: 0,
        queriesProcessed: 0,
        avgRetrievalTime: 0
      };
    }

    async init() {
      await this.vectorStore.open();
      await this._loadIndex();
      this.initialized = true;
      console.log('[RAG] Initialized with', this.hnswIndex.size(), 'documents');
    }

    async _loadIndex() {
      try {
        const documents = await this.vectorStore.getAll();
        
        for (const doc of documents) {
          if (doc.embedding) {
            this.hnswIndex.add(doc.id, doc.embedding, {
              text: doc.text,
              category: doc.category,
              source: doc.source
            });
          }
        }
        
        this.stats.documentsIndexed = documents.length;
      } catch (e) {
        console.warn('[RAG] Failed to load index:', e);
      }
    }

    /**
     * Adiciona documento à base de conhecimento
     * @param {Object} document - Documento a adicionar
     * @returns {string} - ID do documento
     */
    async addDocument(document) {
      const { text, category = 'general', source = 'manual', metadata = {} } = document;
      
      if (!text || text.length < 10) {
        throw new Error('Document text too short');
      }
      
      // Chunking se necessário
      const chunks = this._chunkText(text);
      const ids = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = `${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Gerar embedding
        const embedding = await this.embeddingService.getEmbedding(chunks[i]);
        
        const doc = {
          id: chunkId,
          text: chunks[i],
          embedding,
          category,
          source,
          metadata: {
            ...metadata,
            chunkIndex: i,
            totalChunks: chunks.length,
            originalLength: text.length
          },
          timestamp: Date.now()
        };
        
        // Salvar no IndexedDB
        await this.vectorStore.add(doc);
        
        // Adicionar ao índice HNSW
        this.hnswIndex.add(chunkId, embedding, {
          text: chunks[i],
          category,
          source
        });
        
        ids.push(chunkId);
      }
      
      this.stats.documentsIndexed += ids.length;
      
      console.log(`[RAG] Added ${ids.length} chunks from document`);
      return ids;
    }

    _chunkText(text) {
      if (text.length <= CONFIG.CHUNK_SIZE) {
        return [text];
      }
      
      const chunks = [];
      let start = 0;
      
      while (start < text.length) {
        let end = start + CONFIG.CHUNK_SIZE;
        
        // Tentar quebrar em fronteira de sentença
        if (end < text.length) {
          const lastPeriod = text.lastIndexOf('.', end);
          const lastNewline = text.lastIndexOf('\n', end);
          const breakPoint = Math.max(lastPeriod, lastNewline);
          
          if (breakPoint > start + CONFIG.CHUNK_SIZE * 0.5) {
            end = breakPoint + 1;
          }
        }
        
        chunks.push(text.substring(start, Math.min(end, text.length)));
        start = end - CONFIG.CHUNK_OVERLAP;
      }
      
      return chunks;
    }

    /**
     * Busca documentos relevantes
     * @param {string} query - Query de busca
     * @param {Object} options - Opções de busca
     * @returns {Array} - Documentos relevantes
     */
    async retrieve(query, options = {}) {
      const startTime = performance.now();
      
      const {
        topK = CONFIG.TOP_K,
        minSimilarity = CONFIG.MIN_SIMILARITY,
        category = null,
        includeMetadata = true
      } = options;
      
      // Gerar embedding da query
      const queryEmbedding = await this.embeddingService.getEmbedding(query);
      
      // Buscar no índice HNSW
      let results = this.hnswIndex.search(queryEmbedding, topK * 2);
      
      // Filtrar por categoria se especificado
      if (category) {
        results = results.filter(r => r.metadata?.category === category);
      }
      
      // Filtrar por similaridade mínima
      results = results.filter(r => r.similarity >= minSimilarity);
      
      // Limitar resultados
      results = results.slice(0, topK);
      
      // Enriquecer com dados do store se necessário
      if (includeMetadata) {
        for (const result of results) {
          const doc = await this.vectorStore.get(result.id);
          if (doc) {
            result.fullText = doc.text;
            result.source = doc.source;
            result.timestamp = doc.timestamp;
          }
        }
      }
      
      // Atualizar estatísticas
      const retrievalTime = performance.now() - startTime;
      this.stats.queriesProcessed++;
      this.stats.avgRetrievalTime = (
        (this.stats.avgRetrievalTime * (this.stats.queriesProcessed - 1)) + retrievalTime
      ) / this.stats.queriesProcessed;
      
      console.log(`[RAG] Retrieved ${results.length} documents in ${retrievalTime.toFixed(2)}ms`);
      
      return results;
    }

    /**
     * Gera contexto para prompt de IA
     * @param {string} query - Query do usuário
     * @param {Object} options - Opções
     * @returns {string} - Contexto formatado
     */
    async generateContext(query, options = {}) {
      const results = await this.retrieve(query, options);
      
      if (results.length === 0) {
        return null;
      }
      
      // Formatar contexto
      const contextParts = results.map((r, i) => {
        const source = r.source ? ` [Fonte: ${r.source}]` : '';
        const similarity = `[Relevância: ${(r.similarity * 100).toFixed(0)}%]`;
        return `${i + 1}. ${r.fullText || r.metadata?.text}${source} ${similarity}`;
      });
      
      return `CONTEXTO RELEVANTE:\n${contextParts.join('\n\n')}`;
    }

    /**
     * Remove documento do índice
     * @param {string} id - ID do documento
     */
    async removeDocument(id) {
      await this.vectorStore.delete(id);
      this.hnswIndex.remove(id);
      this.stats.documentsIndexed--;
      console.log(`[RAG] Removed document: ${id}`);
    }

    /**
     * Limpa todo o índice
     */
    async clear() {
      await this.vectorStore.clear();
      this.hnswIndex = new HNSWIndex(CONFIG.EMBEDDING.DIMENSION);
      this.stats.documentsIndexed = 0;
      console.log('[RAG] Index cleared');
    }

    /**
     * Obtém estatísticas
     */
    getStats() {
      return {
        ...this.stats,
        avgRetrievalTime: this.stats.avgRetrievalTime.toFixed(2) + 'ms',
        indexSize: this.hnswIndex.size(),
        embeddingCacheSize: this.embeddingService.cache.size
      };
    }

    /**
     * Importa documentos em lote
     * @param {Array} documents - Array de documentos
     */
    async importBatch(documents) {
      console.log(`[RAG] Importing batch of ${documents.length} documents...`);
      
      let imported = 0;
      for (const doc of documents) {
        try {
          await this.addDocument(doc);
          imported++;
        } catch (e) {
          console.warn(`[RAG] Failed to import document:`, e);
        }
      }
      
      console.log(`[RAG] Imported ${imported}/${documents.length} documents`);
      return imported;
    }

    /**
     * Exporta índice para backup
     */
    async export() {
      const documents = await this.vectorStore.getAll();
      return {
        documents,
        stats: this.stats,
        exportedAt: new Date().toISOString()
      };
    }
  }

  // =============================================
  // INICIALIZAÇÃO
  // =============================================

  const localRAG = new LocalRAG();
  
  // Inicializar quando pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => localRAG.init());
  } else {
    localRAG.init();
  }

  // Expor globalmente
  window.WHLLocalRAG = localRAG;
  window.WHLRAGConfig = CONFIG;
  window.WHLHNSWIndex = HNSWIndex;

  console.log('[QUAL-001] RAG Local initialized');

})();
