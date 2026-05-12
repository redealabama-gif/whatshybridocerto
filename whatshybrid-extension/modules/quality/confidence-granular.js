/**
 * QUAL-003: Confidence Granular - Sistema de confiança multi-dimensional
 * 
 * Benefícios:
 * - Respostas mais calibradas por tipo de pergunta
 * - Melhor identificação de gaps de conhecimento
 * - Decisões mais inteligentes sobre quando pedir ajuda
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
    STORAGE_KEY: 'whl_confidence_granular',
    
    // Dimensões de confiança
    DIMENSIONS: {
      KNOWLEDGE: {
        name: 'Conhecimento',
        description: 'Base de conhecimento disponível',
        weight: 0.30
      },
      CONTEXT: {
        name: 'Contexto',
        description: 'Compreensão do contexto da conversa',
        weight: 0.25
      },
      INTENT: {
        name: 'Intenção',
        description: 'Clareza da intenção do usuário',
        weight: 0.20
      },
      HISTORICAL: {
        name: 'Histórico',
        description: 'Interações anteriores similares',
        weight: 0.15
      },
      SENTIMENT: {
        name: 'Sentimento',
        description: 'Adequação emocional da resposta',
        weight: 0.10
      }
    },
    
    // Categorias de pergunta
    QUESTION_CATEGORIES: {
      FACTUAL: 'Pergunta factual',
      PROCEDURAL: 'Como fazer',
      OPINION: 'Opinião/Recomendação',
      TROUBLESHOOTING: 'Resolução de problemas',
      PRICING: 'Preços/Valores',
      AVAILABILITY: 'Disponibilidade',
      SUPPORT: 'Suporte técnico',
      GREETING: 'Saudação',
      COMPLAINT: 'Reclamação',
      UNKNOWN: 'Não classificado'
    },
    
    // Thresholds por categoria
    CATEGORY_THRESHOLDS: {
      FACTUAL: 0.85,
      PROCEDURAL: 0.80,
      OPINION: 0.70,
      TROUBLESHOOTING: 0.75,
      PRICING: 0.90,
      AVAILABILITY: 0.85,
      SUPPORT: 0.75,
      GREETING: 0.60,
      COMPLAINT: 0.80,
      UNKNOWN: 0.75
    },
    
    // Ações baseadas em confiança
    CONFIDENCE_ACTIONS: {
      HIGH: { min: 0.85, action: 'auto_respond' },
      MEDIUM: { min: 0.65, action: 'suggest_with_review' },
      LOW: { min: 0.40, action: 'request_human' },
      VERY_LOW: { min: 0, action: 'escalate' }
    },
    
    // Histórico de calibração
    CALIBRATION_WINDOW: 100  // Últimas N respostas para calibração
  };

  // =============================================
  // GRANULAR CONFIDENCE SYSTEM
  // =============================================

  class GranularConfidenceSystem {
    constructor() {
      this.dimensionScores = {};
      this.categoryHistory = {};
      this.calibrationData = [];
      this.initialized = false;
      
      this._init();
    }

    async _init() {
      await this._loadData();
      this.initialized = true;
      console.log('[GranularConfidence] Initialized');
    }

    async _loadData() {
      try {
        const data = await this._getStorage(CONFIG.STORAGE_KEY);
        if (data) {
          this.categoryHistory = data.categoryHistory || {};
          this.calibrationData = data.calibrationData || [];
        }
      } catch (e) {
        console.warn('[GranularConfidence] Failed to load data:', e);
      }
    }

    async _saveData() {
      try {
        await this._setStorage(CONFIG.STORAGE_KEY, {
          categoryHistory: this.categoryHistory,
          calibrationData: this.calibrationData.slice(-CONFIG.CALIBRATION_WINDOW)
        });
      } catch (e) {
        console.warn('[GranularConfidence] Failed to save data:', e);
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
     * Classifica a categoria de uma pergunta
     * @param {string} question - Texto da pergunta
     * @returns {Object} - Categoria e indicadores
     */
    classifyQuestion(question) {
      const lowerQuestion = question.toLowerCase().trim();
      const indicators = {};
      
      // Indicadores de categoria
      const patterns = {
        GREETING: /^(oi|olá|ola|bom dia|boa tarde|boa noite|hey|hi|hello|e aí|eai)/i,
        PRICING: /(preço|valor|quanto custa|custo|orçamento|price|pricing|tabela|promocao|promoção|desconto)/i,
        AVAILABILITY: /(disponível|disponivel|estoque|tem|possui|existe|entrega|prazo|quando chega)/i,
        PROCEDURAL: /(como|como faço|como faz|tutorial|passo a passo|ensina|explica|modo de usar)/i,
        TROUBLESHOOTING: /(problema|erro|não funciona|nao funciona|bug|travou|parou|deu erro|não consigo)/i,
        COMPLAINT: /(reclamação|reclamar|insatisfeito|péssimo|horrível|decepcionado|absurdo|inaceitável)/i,
        SUPPORT: /(ajuda|suporte|assistência|assistencia|atendimento|falar com|chamar)/i,
        OPINION: /(melhor|pior|recomenda|sugere|opinião|acha que|vale a pena|compensa)/i,
        FACTUAL: /(o que é|o que e|qual|quais|quando|onde|por que|porque|quem|define)/i
      };
      
      let matchedCategory = 'UNKNOWN';
      let maxScore = 0;
      
      for (const [category, pattern] of Object.entries(patterns)) {
        const matches = lowerQuestion.match(pattern);
        if (matches) {
          indicators[category] = true;
          const score = matches.length;
          if (score > maxScore) {
            maxScore = score;
            matchedCategory = category;
          }
        }
      }
      
      // Análise adicional de contexto
      const questionMarks = (question.match(/\?/g) || []).length;
      const exclamationMarks = (question.match(/!/g) || []).length;
      const wordCount = question.split(/\s+/).length;
      
      return {
        category: matchedCategory,
        categoryName: CONFIG.QUESTION_CATEGORIES[matchedCategory],
        threshold: CONFIG.CATEGORY_THRESHOLDS[matchedCategory],
        indicators,
        metadata: {
          questionMarks,
          exclamationMarks,
          wordCount,
          isShort: wordCount < 5,
          isLong: wordCount > 20
        }
      };
    }

    /**
     * Calcula confiança multi-dimensional
     * @param {Object} context - Contexto da análise
     * @returns {Object} - Score por dimensão e total
     */
    calculateGranularConfidence(context) {
      const {
        question,
        response,
        knowledgeMatches = [],
        conversationHistory = [],
        contactMemory = null,
        fewShotExamples = []
      } = context;

      const classification = this.classifyQuestion(question);
      const scores = {};
      
      // 1. Dimensão: KNOWLEDGE
      scores.KNOWLEDGE = this._calculateKnowledgeScore({
        knowledgeMatches,
        fewShotExamples,
        category: classification.category
      });
      
      // 2. Dimensão: CONTEXT
      scores.CONTEXT = this._calculateContextScore({
        conversationHistory,
        contactMemory,
        question
      });
      
      // 3. Dimensão: INTENT
      scores.INTENT = this._calculateIntentScore({
        classification,
        question
      });
      
      // 4. Dimensão: HISTORICAL
      scores.HISTORICAL = this._calculateHistoricalScore({
        category: classification.category,
        question
      });
      
      // 5. Dimensão: SENTIMENT
      scores.SENTIMENT = this._calculateSentimentScore({
        question,
        response,
        classification
      });
      
      // Calcular score ponderado
      let weightedScore = 0;
      for (const [dimension, config] of Object.entries(CONFIG.DIMENSIONS)) {
        weightedScore += scores[dimension] * config.weight;
      }
      
      // Aplicar modificador de categoria
      const categoryModifier = this._getCategoryModifier(classification.category);
      const finalScore = Math.min(1, weightedScore * categoryModifier);
      
      // Determinar ação
      const action = this._determineAction(finalScore, classification.threshold);
      
      return {
        score: finalScore,
        scores,
        classification,
        action,
        breakdown: this._getBreakdown(scores),
        recommendations: this._getRecommendations(scores, classification)
      };
    }

    _calculateKnowledgeScore({ knowledgeMatches, fewShotExamples, category }) {
      let score = 0.5; // Base score
      
      // Matches da base de conhecimento
      if (knowledgeMatches.length > 0) {
        const topMatch = knowledgeMatches[0];
        const similarity = topMatch.similarity || topMatch.score || 0;
        score = Math.max(score, similarity);
        
        // Bonus por múltiplos matches relevantes
        const relevantMatches = knowledgeMatches.filter(m => 
          (m.similarity || m.score || 0) > 0.7
        ).length;
        score = Math.min(1, score + (relevantMatches * 0.05));
      }
      
      // Bonus por few-shot examples
      if (fewShotExamples.length > 0) {
        score = Math.min(1, score + (fewShotExamples.length * 0.1));
      }
      
      // Penalidade para categorias sensíveis sem dados
      if (['PRICING', 'AVAILABILITY'].includes(category) && knowledgeMatches.length === 0) {
        score *= 0.5;
      }
      
      return score;
    }

    _calculateContextScore({ conversationHistory, contactMemory, question }) {
      let score = 0.6; // Base score
      
      // Histórico de conversa
      if (conversationHistory.length > 0) {
        // Mais contexto = mais confiança
        const contextBonus = Math.min(0.2, conversationHistory.length * 0.02);
        score += contextBonus;
        
        // Verificar coerência com histórico
        const lastMessages = conversationHistory.slice(-3);
        const hasRelatedContext = lastMessages.some(msg => 
          this._areTopicsRelated(msg.content || msg, question)
        );
        if (hasRelatedContext) score += 0.1;
      }
      
      // Memória do contato
      if (contactMemory) {
        score += 0.1;
        
        // Interações anteriores
        if (contactMemory.interactionCount > 5) score += 0.05;
        if (contactMemory.preferences) score += 0.05;
      }
      
      return Math.min(1, score);
    }

    _calculateIntentScore({ classification, question }) {
      let score = 0.7; // Base score
      
      // Clareza da classificação
      const indicatorCount = Object.keys(classification.indicators).length;
      if (indicatorCount === 1) {
        score += 0.2; // Classificação clara
      } else if (indicatorCount > 2) {
        score -= 0.1; // Classificação ambígua
      }
      
      // Perguntas muito curtas ou vagas
      if (classification.metadata.isShort) {
        score -= 0.15;
      }
      
      // Perguntas muito longas podem ser confusas
      if (classification.metadata.isLong) {
        score -= 0.05;
      }
      
      // Múltiplas perguntas no mesmo texto
      if (classification.metadata.questionMarks > 1) {
        score -= 0.1;
      }
      
      return Math.max(0.3, Math.min(1, score));
    }

    _calculateHistoricalScore({ category, question }) {
      let score = 0.5; // Base score sem histórico
      
      const history = this.categoryHistory[category];
      if (!history || history.total === 0) {
        return score;
      }
      
      // Taxa de sucesso histórico
      const successRate = history.successful / history.total;
      score = successRate;
      
      // Peso do histórico baseado em volume
      const volumeWeight = Math.min(1, history.total / 50);
      score = (score * volumeWeight) + (0.5 * (1 - volumeWeight));
      
      return score;
    }

    _calculateSentimentScore({ question, response, classification }) {
      let score = 0.7; // Base score
      
      // Detectar sentimento negativo na pergunta
      const negativePatterns = /(raiva|frustrado|irritado|bravo|decepcionado|triste|chateado|péssimo|horrível)/i;
      if (negativePatterns.test(question)) {
        score -= 0.15;
        
        // Verificar se resposta é empática
        const empatheticPatterns = /(lamento|sinto muito|entendo|compreendo|desculpe)/i;
        if (response && empatheticPatterns.test(response)) {
          score += 0.1;
        }
      }
      
      // Reclamações precisam de cuidado extra
      if (classification.category === 'COMPLAINT') {
        score -= 0.1;
      }
      
      // Saudações são geralmente seguras
      if (classification.category === 'GREETING') {
        score = 0.9;
      }
      
      return Math.max(0.3, Math.min(1, score));
    }

    _areTopicsRelated(text1, text2) {
      // Extração simples de keywords
      const getKeywords = (text) => {
        return text.toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter(w => w.length > 3);
      };
      
      const keywords1 = new Set(getKeywords(text1));
      const keywords2 = new Set(getKeywords(text2));
      
      const intersection = [...keywords1].filter(k => keywords2.has(k));
      return intersection.length >= 2;
    }

    _getCategoryModifier(category) {
      const modifiers = {
        GREETING: 1.1,      // Boost para saudações
        FACTUAL: 1.0,
        PROCEDURAL: 1.0,
        OPINION: 0.95,
        TROUBLESHOOTING: 0.9,
        PRICING: 0.85,      // Mais conservador com preços
        AVAILABILITY: 0.85,
        SUPPORT: 0.95,
        COMPLAINT: 0.8,     // Muito cuidado com reclamações
        UNKNOWN: 0.9
      };
      
      return modifiers[category] || 1.0;
    }

    _determineAction(score, threshold) {
      // Usar threshold específico da categoria
      const adjustedThresholds = {
        HIGH: { min: threshold, action: 'auto_respond' },
        MEDIUM: { min: threshold - 0.20, action: 'suggest_with_review' },
        LOW: { min: threshold - 0.40, action: 'request_human' },
        VERY_LOW: { min: 0, action: 'escalate' }
      };
      
      for (const [level, config] of Object.entries(adjustedThresholds)) {
        if (score >= config.min) {
          return {
            level,
            action: config.action,
            threshold: config.min,
            score
          };
        }
      }
      
      return {
        level: 'VERY_LOW',
        action: 'escalate',
        threshold: 0,
        score
      };
    }

    _getBreakdown(scores) {
      return Object.entries(CONFIG.DIMENSIONS).map(([key, config]) => ({
        dimension: key,
        name: config.name,
        description: config.description,
        score: scores[key],
        weight: config.weight,
        contribution: scores[key] * config.weight
      }));
    }

    _getRecommendations(scores, classification) {
      const recommendations = [];
      
      // Score de conhecimento baixo
      if (scores.KNOWLEDGE < 0.6) {
        recommendations.push({
          type: 'knowledge_gap',
          priority: 'high',
          message: `Adicione mais informações sobre "${classification.categoryName}" à base de conhecimento`,
          dimension: 'KNOWLEDGE'
        });
      }
      
      // Score de contexto baixo
      if (scores.CONTEXT < 0.5) {
        recommendations.push({
          type: 'context_needed',
          priority: 'medium',
          message: 'Mais contexto da conversa ajudaria a responder melhor',
          dimension: 'CONTEXT'
        });
      }
      
      // Score de intenção baixo
      if (scores.INTENT < 0.5) {
        recommendations.push({
          type: 'clarification_needed',
          priority: 'high',
          message: 'A pergunta é ambígua - considere pedir esclarecimento',
          dimension: 'INTENT'
        });
      }
      
      // Score histórico baixo
      if (scores.HISTORICAL < 0.5) {
        recommendations.push({
          type: 'training_needed',
          priority: 'medium',
          message: `Treine a IA com mais exemplos de "${classification.categoryName}"`,
          dimension: 'HISTORICAL'
        });
      }
      
      return recommendations;
    }

    /**
     * Registra feedback para calibração
     * @param {Object} result - Resultado da análise
     * @param {boolean} wasSuccessful - Se a resposta foi bem sucedida
     */
    async recordFeedback(result, wasSuccessful) {
      const { classification, score, scores } = result;
      const category = classification.category;
      
      // Atualizar histórico da categoria
      if (!this.categoryHistory[category]) {
        this.categoryHistory[category] = { total: 0, successful: 0 };
      }
      this.categoryHistory[category].total++;
      if (wasSuccessful) {
        this.categoryHistory[category].successful++;
      }
      
      // Adicionar à calibração
      this.calibrationData.push({
        timestamp: Date.now(),
        category,
        predictedScore: score,
        scores,
        wasSuccessful
      });
      
      await this._saveData();
      
      // Emitir evento
      if (window.WHLEventBus) {
        window.WHLEventBus.emit('confidenceFeedback', {
          category,
          score,
          wasSuccessful
        });
      }
    }

    /**
     * Obtém estatísticas do sistema
     */
    getStats() {
      const categoryStats = {};
      
      for (const [category, history] of Object.entries(this.categoryHistory)) {
        categoryStats[category] = {
          ...history,
          successRate: history.total > 0 
            ? (history.successful / history.total * 100).toFixed(1) + '%' 
            : 'N/A'
        };
      }
      
      // Calibração
      const recentCalibration = this.calibrationData.slice(-50);
      const avgPredictedScore = recentCalibration.reduce((sum, d) => sum + d.predictedScore, 0) / (recentCalibration.length || 1);
      const actualSuccessRate = recentCalibration.filter(d => d.wasSuccessful).length / (recentCalibration.length || 1);
      
      return {
        categoryStats,
        calibration: {
          samples: recentCalibration.length,
          avgPredictedScore: avgPredictedScore.toFixed(2),
          actualSuccessRate: (actualSuccessRate * 100).toFixed(1) + '%',
          calibrationError: Math.abs(avgPredictedScore - actualSuccessRate).toFixed(2)
        }
      };
    }

    /**
     * Exporta dados para análise
     */
    exportData() {
      return {
        categoryHistory: this.categoryHistory,
        calibrationData: this.calibrationData,
        config: CONFIG,
        exportedAt: new Date().toISOString()
      };
    }
  }

  // =============================================
  // INICIALIZAÇÃO
  // =============================================

  const confidenceSystem = new GranularConfidenceSystem();

  // Expor globalmente
  window.WHLGranularConfidence = confidenceSystem;
  window.WHLConfidenceConfig = CONFIG;

  // Integrar com sistema existente (Backward Compatibility) SEM alterar o comportamento legado.
  // IMPORTANTE: o Autopilot depende de respostas do ConfidenceSystem (ex.: FAQ match -> answer).
  // Portanto, aqui apenas anexamos diagnósticos granulares ao retorno do método legado.
  const legacySystem = window.confidenceSystem || window.ConfidenceSystem;

  if (legacySystem) {
    // Injetar método de análise granular para consumo por UI/outros módulos
    legacySystem.analyzeGranular = (context) => {
      return confidenceSystem.calculateGranularConfidence(context);
    };

    if (!legacySystem.__whlGranularWrapped && typeof legacySystem.canAutoSendSmart === 'function') {
      const originalCanAutoSendSmart = legacySystem.canAutoSendSmart.bind(legacySystem);

      legacySystem.canAutoSendSmart = async function(message, knowledge = null) {
        const decision = await originalCanAutoSendSmart(message, knowledge);

        // Anexar apenas telemetria granular (não muda canSend/answer/confidence do legado)
        try {
          const granular = confidenceSystem.calculateGranularConfidence({
            question: String(message || ''),
            response: String(decision?.answer || ''),
            knowledgeMatches: [],
            conversationHistory: [],
            contactMemory: null,
            fewShotExamples: []
          });
          return {
            ...decision,
            granular,
            granularScore: granular.score,
            granularCategory: granular.classification?.category
          };
        } catch (_) {
          return decision;
        }
      };

      legacySystem.__whlGranularWrapped = true;
      console.log('[QUAL-003] Granular Confidence attached to ConfidenceSystem.canAutoSendSmart (no behavior change)');
    }
  }

  console.log('[QUAL-003] Granular Confidence System initialized');

})();
