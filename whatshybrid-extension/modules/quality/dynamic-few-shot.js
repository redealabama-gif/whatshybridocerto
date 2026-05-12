/**
 * QUAL-002: Dynamic Few-Shot Selection - Seleção inteligente de exemplos
 * 
 * Benefícios:
 * - Exemplos mais relevantes para cada situação
 * - Melhor uso do contexto limitado
 * - Adaptação automática ao tipo de pergunta
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
    STORAGE_KEY: 'whl_dynamic_fewshot',
    
    // Limites
    MAX_EXAMPLES: 5,
    MIN_EXAMPLES: 1,
    MAX_TOKENS_PER_EXAMPLE: 200,
    
    // Pesos para seleção
    SELECTION_WEIGHTS: {
      semanticSimilarity: 0.35,
      categoryMatch: 0.25,
      recency: 0.15,
      successRate: 0.15,
      diversity: 0.10
    },
    
    // Categorias de exemplo
    EXAMPLE_CATEGORIES: [
      'greeting',
      'pricing',
      'availability',
      'support',
      'complaint',
      'procedural',
      'general'
    ],
    
    // Decay de sucesso (para exemplos antigos)
    SUCCESS_DECAY_DAYS: 30,
    
    // Diversidade
    MIN_DIVERSITY_SCORE: 0.3
  };

  // =============================================
  // DYNAMIC FEW-SHOT SELECTOR
  // =============================================

  class DynamicFewShotSelector {
    constructor() {
      this.examples = [];
      this.exampleIndex = new Map(); // Por categoria
      this.stats = {
        totalExamples: 0,
        selectionsCount: 0,
        avgExamplesSelected: 0,
        categoryDistribution: {}
      };
      this.initialized = false;
      
      this._init();
    }

    async _init() {
      await this._loadExamples();
      this._buildIndex();
      this.initialized = true;
      console.log('[DynamicFewShot] Initialized with', this.examples.length, 'examples');
    }

    async _loadExamples() {
      try {
        // Carregar do storage
        const data = await this._getStorage(CONFIG.STORAGE_KEY);
        if (data && data.examples) {
          this.examples = data.examples;
          this.stats = data.stats || this.stats;
        }
        
        // Carregar do FewShotLearning existente se disponível
        if (window.FewShotLearning && typeof window.FewShotLearning.getExamples === 'function') {
          const existingExamples = await window.FewShotLearning.getExamples();
          if (Array.isArray(existingExamples)) {
            this._mergeExamples(existingExamples);
          }
        }
      } catch (e) {
        console.warn('[DynamicFewShot] Failed to load examples:', e);
      }
    }

    _mergeExamples(newExamples) {
      const existingIds = new Set(this.examples.map(e => e.id));
      
      for (const example of newExamples) {
        if (!existingIds.has(example.id)) {
          this.examples.push(this._normalizeExample(example));
        }
      }
    }

    _normalizeExample(example) {
      return {
        id: example.id || `ex_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        question: example.question || example.input || '',
        answer: example.answer || example.output || '',
        category: example.category || this._detectCategory(example.question || ''),
        embedding: example.embedding || null,
        metadata: {
          source: example.source || 'imported',
          createdAt: example.createdAt || Date.now(),
          usageCount: example.usageCount || 0,
          successCount: example.successCount || 0,
          lastUsed: example.lastUsed || null
        }
      };
    }

    _buildIndex() {
      this.exampleIndex.clear();
      
      for (const example of this.examples) {
        const category = example.category;
        if (!this.exampleIndex.has(category)) {
          this.exampleIndex.set(category, []);
        }
        this.exampleIndex.get(category).push(example);
        
        // Atualizar stats
        this.stats.categoryDistribution[category] = 
          (this.stats.categoryDistribution[category] || 0) + 1;
      }
      
      this.stats.totalExamples = this.examples.length;
    }

    _detectCategory(text) {
      const lowerText = text.toLowerCase();
      
      const patterns = {
        greeting: /^(oi|olá|ola|bom dia|boa tarde|boa noite|hey|hi)/i,
        pricing: /(preço|valor|quanto custa|custo|orçamento)/i,
        availability: /(disponível|disponivel|estoque|tem|entrega)/i,
        support: /(ajuda|suporte|problema|erro|não funciona)/i,
        complaint: /(reclamação|reclamar|insatisfeito|péssimo)/i,
        procedural: /(como|como faço|tutorial|passo a passo)/i
      };
      
      for (const [category, pattern] of Object.entries(patterns)) {
        if (pattern.test(lowerText)) return category;
      }
      
      return 'general';
    }

    async _getStorage(key) {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.get([key], (result) => resolve(result[key]));
        } else {
          resolve(null);
        }
      });
    }

    async _setStorage(key, value) {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.set({ [key]: value }, resolve);
        } else {
          resolve();
        }
      });
    }

    /**
     * Seleciona os melhores exemplos para uma query
     * @param {string} query - Query do usuário
     * @param {Object} context - Contexto adicional
     * @returns {Array} - Exemplos selecionados
     */
    async selectExamples(query, context = {}) {
      const {
        maxExamples = CONFIG.MAX_EXAMPLES,
        category = null,
        excludeIds = [],
        requireDiversity = true
      } = context;
      
      if (this.examples.length === 0) {
        return [];
      }
      
      // Detectar categoria se não fornecida
      const targetCategory = category || this._detectCategory(query);
      
      // Calcular scores para todos os exemplos
      const scoredExamples = await this._scoreExamples(query, targetCategory, excludeIds);
      
      // Selecionar com diversidade
      let selected;
      if (requireDiversity) {
        selected = this._selectWithDiversity(scoredExamples, maxExamples);
      } else {
        selected = scoredExamples.slice(0, maxExamples);
      }
      
      // Atualizar estatísticas
      this._updateUsageStats(selected);
      
      // Formatar resultado
      const result = selected.map(s => ({
        question: s.example.question,
        answer: s.example.answer,
        score: s.totalScore,
        category: s.example.category
      }));
      
      console.log(`[DynamicFewShot] Selected ${result.length} examples for "${query.substring(0, 30)}..."`);
      
      return result;
    }

    async _scoreExamples(query, targetCategory, excludeIds) {
      const scores = [];
      const queryLower = query.toLowerCase();
      const queryWords = new Set(queryLower.split(/\s+/).filter(w => w.length > 2));
      
      for (const example of this.examples) {
        if (excludeIds.includes(example.id)) continue;
        
        // 1. Similaridade semântica (simplificada)
        const semanticScore = this._calculateSemanticSimilarity(queryLower, queryWords, example);
        
        // 2. Match de categoria
        const categoryScore = example.category === targetCategory ? 1.0 : 0.3;
        
        // 3. Recência
        const recencyScore = this._calculateRecencyScore(example);
        
        // 4. Taxa de sucesso
        const successScore = this._calculateSuccessScore(example);
        
        // Score ponderado
        const totalScore = 
          (semanticScore * CONFIG.SELECTION_WEIGHTS.semanticSimilarity) +
          (categoryScore * CONFIG.SELECTION_WEIGHTS.categoryMatch) +
          (recencyScore * CONFIG.SELECTION_WEIGHTS.recency) +
          (successScore * CONFIG.SELECTION_WEIGHTS.successRate);
        
        scores.push({
          example,
          semanticScore,
          categoryScore,
          recencyScore,
          successScore,
          totalScore
        });
      }
      
      // Ordenar por score total
      return scores.sort((a, b) => b.totalScore - a.totalScore);
    }

    _calculateSemanticSimilarity(queryLower, queryWords, example) {
      const exampleLower = example.question.toLowerCase();
      const exampleWords = new Set(exampleLower.split(/\s+/).filter(w => w.length > 2));
      
      // Jaccard similarity com boost para palavras importantes
      const intersection = [...queryWords].filter(w => exampleWords.has(w));
      const union = new Set([...queryWords, ...exampleWords]);
      
      const jaccard = intersection.length / union.size;
      
      // Bonus por substring match
      const substringBonus = exampleLower.includes(queryLower.substring(0, 20)) ? 0.2 : 0;
      
      // Bonus por tamanho similar
      const lengthRatio = Math.min(queryLower.length, exampleLower.length) / 
                         Math.max(queryLower.length, exampleLower.length);
      const lengthBonus = lengthRatio > 0.5 ? 0.1 : 0;
      
      return Math.min(1, jaccard + substringBonus + lengthBonus);
    }

    _calculateRecencyScore(example) {
      const now = Date.now();
      const daysSinceCreation = (now - example.metadata.createdAt) / (1000 * 60 * 60 * 24);
      
      // Decay exponencial
      return Math.exp(-daysSinceCreation / CONFIG.SUCCESS_DECAY_DAYS);
    }

    _calculateSuccessScore(example) {
      const { usageCount, successCount } = example.metadata;
      
      if (usageCount === 0) return 0.5; // Neutro para novos exemplos
      
      // Wilson score interval (lower bound)
      const n = usageCount;
      const p = successCount / n;
      const z = 1.96; // 95% confidence
      
      const lower = (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n);
      
      return Math.max(0, Math.min(1, lower));
    }

    _selectWithDiversity(scoredExamples, maxExamples) {
      const selected = [];
      const selectedCategories = new Set();
      
      for (const scored of scoredExamples) {
        if (selected.length >= maxExamples) break;
        
        // Verificar diversidade
        if (selected.length > 0) {
          const diversityScore = this._calculateDiversityScore(scored, selected);
          if (diversityScore < CONFIG.MIN_DIVERSITY_SCORE) {
            continue; // Muito similar aos já selecionados
          }
        }
        
        // Preferir categorias diferentes
        if (selectedCategories.has(scored.example.category) && selected.length < maxExamples - 1) {
          // Tentar encontrar outro com categoria diferente
          const hasAlternative = scoredExamples.some(s => 
            !selectedCategories.has(s.example.category) && 
            s.totalScore > scored.totalScore * 0.8
          );
          if (hasAlternative) continue;
        }
        
        selected.push(scored);
        selectedCategories.add(scored.example.category);
      }
      
      return selected;
    }

    _calculateDiversityScore(candidate, selected) {
      let minDiversity = 1;
      
      for (const existing of selected) {
        const candidateWords = new Set(candidate.example.question.toLowerCase().split(/\s+/));
        const existingWords = new Set(existing.example.question.toLowerCase().split(/\s+/));
        
        const intersection = [...candidateWords].filter(w => existingWords.has(w)).length;
        const similarity = intersection / Math.max(candidateWords.size, existingWords.size);
        
        const diversity = 1 - similarity;
        minDiversity = Math.min(minDiversity, diversity);
      }
      
      return minDiversity;
    }

    _updateUsageStats(selected) {
      for (const scored of selected) {
        scored.example.metadata.usageCount++;
        scored.example.metadata.lastUsed = Date.now();
      }
      
      this.stats.selectionsCount++;
      this.stats.avgExamplesSelected = (
        (this.stats.avgExamplesSelected * (this.stats.selectionsCount - 1)) + selected.length
      ) / this.stats.selectionsCount;
      
      // Salvar periodicamente
      this._scheduleSave();
    }

    _scheduleSave = (() => {
      let timeout = null;
      return () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          this._saveData();
          timeout = null;
        }, 5000);
      };
    })();

    async _saveData() {
      await this._setStorage(CONFIG.STORAGE_KEY, {
        examples: this.examples,
        stats: this.stats
      });
    }

    /**
     * Adiciona um novo exemplo
     * @param {Object} example - Exemplo a adicionar
     * @returns {string} - ID do exemplo
     */
    async addExample(example) {
      const normalized = this._normalizeExample(example);
      this.examples.push(normalized);
      this._buildIndex();
      await this._saveData();
      
      console.log(`[DynamicFewShot] Added example: ${normalized.id}`);
      return normalized.id;
    }

    /**
     * Registra feedback para um exemplo
     * @param {string} exampleId - ID do exemplo
     * @param {boolean} wasSuccessful - Se foi bem sucedido
     */
    async recordFeedback(exampleId, wasSuccessful) {
      const example = this.examples.find(e => e.id === exampleId);
      if (!example) return;
      
      if (wasSuccessful) {
        example.metadata.successCount++;
      }
      
      await this._saveData();
    }

    /**
     * Remove um exemplo
     * @param {string} exampleId - ID do exemplo
     */
    async removeExample(exampleId) {
      this.examples = this.examples.filter(e => e.id !== exampleId);
      this._buildIndex();
      await this._saveData();
    }

    /**
     * Formata exemplos para prompt
     * @param {Array} examples - Exemplos selecionados
     * @returns {string} - Texto formatado
     */
    formatForPrompt(examples) {
      if (!examples || examples.length === 0) return '';
      
      const formatted = examples.map((ex, i) => 
        `Exemplo ${i + 1}:\nPergunta: ${ex.question}\nResposta: ${ex.answer}`
      ).join('\n\n');
      
      return `EXEMPLOS DE REFERÊNCIA:\n\n${formatted}\n\n---\n\n`;
    }

    /**
     * Obtém estatísticas
     */
    getStats() {
      return {
        ...this.stats,
        examplesByCategory: Object.fromEntries(
          Array.from(this.exampleIndex.entries()).map(([k, v]) => [k, v.length])
        ),
        avgExamplesSelected: this.stats.avgExamplesSelected.toFixed(1)
      };
    }

    /**
     * Exporta exemplos
     */
    exportExamples() {
      return {
        examples: this.examples,
        stats: this.getStats(),
        exportedAt: new Date().toISOString()
      };
    }
  }

  // =============================================
  // INICIALIZAÇÃO
  // =============================================

  const dynamicFewShot = new DynamicFewShotSelector();

  // Expor globalmente
  window.WHLDynamicFewShot = dynamicFewShot;
  window.WHLFewShotConfig = CONFIG;

  // Integrar com sistema existente
  if (window.FewShotLearning) {
    const originalGetExamples = window.FewShotLearning.getExamplesForPrompt;
    
    window.FewShotLearning.getExamplesForPrompt = async function(query, context) {
      const dynamicExamples = await dynamicFewShot.selectExamples(query, context);
      
      if (dynamicExamples.length > 0) {
        return dynamicFewShot.formatForPrompt(dynamicExamples);
      }
      
      // Fallback para método original
      return originalGetExamples ? originalGetExamples.call(this, query, context) : '';
    };
  }

  console.log('[QUAL-002] Dynamic Few-Shot initialized');

})();
