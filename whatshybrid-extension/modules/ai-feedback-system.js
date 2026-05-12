/**
 * 📊 AI Feedback System - Sistema de Feedback Multi-dimensional
 * WhatsHybrid v7.7.0
 * 
 * Features:
 * - Feedback explícito (rating, correções)
 * - Feedback implícito (comportamento)
 * - Feedback de longo prazo (conversões)
 * - Cálculo de reward signal
 * - Histórico de feedbacks
 * - Analytics de qualidade
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'whl_ai_feedback_system';
  const MAX_FEEDBACK_HISTORY = 1000;

  // ============================================
  // ESQUEMA DE FEEDBACK
  // ============================================
  
  const FEEDBACK_DIMENSIONS = {
    accuracy: { weight: 0.3, label: 'Precisão' },
    tone: { weight: 0.2, label: 'Tom' },
    helpfulness: { weight: 0.25, label: 'Utilidade' },
    speed: { weight: 0.1, label: 'Velocidade' },
    relevance: { weight: 0.15, label: 'Relevância' }
  };

  class AIFeedbackSystem {
    constructor() {
      this.feedbackHistory = [];
      this.implicitSignals = [];
      this.aggregatedMetrics = {
        totalFeedbacks: 0,
        averageRating: 0,
        suggestionAcceptanceRate: 0,
        editRate: 0,
        conversionRate: 0,
        resolutionRate: 0
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
          // SECURITY FIX (PARTIAL-012): Prevent prototype pollution via JSON.parse reviver
          const stored = JSON.parse(data[STORAGE_KEY], (key, value) => {
            // Filter dangerous keys that can cause prototype pollution
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
              console.warn('[AIFeedbackSystem] Blocked prototype pollution attempt:', key);
              return undefined;
            }
            return value;
          });

          this.feedbackHistory = stored.feedbackHistory || [];
          this.implicitSignals = stored.implicitSignals || [];
          this.aggregatedMetrics = stored.aggregatedMetrics || this.aggregatedMetrics;
        }
        
        this.initialized = true;
        this.setupEventListeners();
        
        console.log('[AIFeedbackSystem] ✅ Inicializado com', this.feedbackHistory.length, 'feedbacks');
        
      } catch (error) {
        console.error('[AIFeedbackSystem] Erro ao inicializar:', error);
      }
    }

    // ============================================
    // EVENT LISTENERS
    // ============================================
    
    setupEventListeners() {
      if (!window.EventBus) return;
      
      // Sugestão mostrada
      window.EventBus.on('suggestion:shown', (data) => {
        this.startImplicitTracking(data);
      });
      
      // Sugestão usada
      window.EventBus.on('suggestion:used', (data) => {
        this.recordImplicitFeedback({
          type: 'suggestion_used',
          wasEdited: false,
          responseTime: Date.now() - (data.shownAt || Date.now()),
          ...data
        });
      });
      
      // Sugestão editada
      window.EventBus.on('suggestion:edited', (data) => {
        this.recordImplicitFeedback({
          type: 'suggestion_edited',
          wasEdited: true,
          editDistance: this.calculateEditDistance(data.original, data.corrected),
          ...data
        });
      });
      
      // Mensagem do cliente após resposta
      window.EventBus.on('client:responded', (data) => {
        this.recordClientResponse(data);
      });
      
      // Conversão/venda
      window.EventBus.on('conversion:completed', (data) => {
        this.recordLongTermFeedback('conversion', data);
      });
      
      // Issue resolvida
      window.EventBus.on('issue:resolved', (data) => {
        this.recordLongTermFeedback('resolution', data);
      });
    }

    // ============================================
    // FEEDBACK EXPLÍCITO
    // ============================================
    
    /**
     * Registra feedback explícito do usuário
     */
    async recordExplicitFeedback(feedback) {
      const record = {
        id: Date.now(),
        type: 'explicit',
        timestamp: Date.now(),
        
        // Rating geral (1-5)
        rating: feedback.rating || null,
        
        // Ratings por dimensão
        dimensions: {
          accuracy: feedback.accuracy || null,
          tone: feedback.tone || null,
          helpfulness: feedback.helpfulness || null,
          speed: feedback.speed || null,
          relevance: feedback.relevance || null
        },
        
        // Correção (se houver)
        correction: feedback.correction || null,
        
        // Contexto
        messageId: feedback.messageId,
        chatId: feedback.chatId,
        originalResponse: feedback.originalResponse,
        intent: feedback.intent,
        
        // Comentário opcional
        comment: feedback.comment || null
      };
      
      this.feedbackHistory.push(record);
      this.trimHistory();
      this.updateAggregatedMetrics();
      
      await this.save();
      
      // Emitir evento para outros sistemas aprenderem
      if (window.EventBus) {
        window.EventBus.emit('feedback:received', {
          type: record.rating >= 4 ? 'positive' : record.rating <= 2 ? 'negative' : 'neutral',
          messagePattern: feedback.messagePattern,
          response: feedback.originalResponse,
          correction: feedback.correction,
          rating: record.rating
        });
        // v9.5.4: Also emit successfulInteraction for autonomous-learning to consume.
        // The autonomous-learning module's listener was previously dormant for two reasons:
        // (1) wrong bus name (fixed in v9.5.3), (2) no emitter (fixed here).
        if (record.rating >= 4) {
          window.EventBus.emit('successfulInteraction', {
            input: feedback.messagePattern || feedback.input || '',
            output: feedback.correction || feedback.originalResponse || '',
            intent: feedback.intent,
            rating: record.rating,
            timestamp: Date.now()
          });
        }
      }
      
      // Calcular reward e retornar
      const reward = this.calculateReward(record);
      
      console.log('[AIFeedbackSystem] 📝 Feedback registrado. Reward:', reward.toFixed(2));
      
      return { ...record, reward };
    }

    // ============================================
    // FEEDBACK IMPLÍCITO
    // ============================================
    
    /**
     * Inicia tracking de feedback implícito
     */
    startImplicitTracking(data) {
      // Armazenar timestamp para calcular tempo de resposta
      this.currentSuggestion = {
        ...data,
        shownAt: Date.now()
      };
    }

    /**
     * Registra feedback implícito baseado em comportamento
     */
    recordImplicitFeedback(signal) {
      const record = {
        id: Date.now(),
        type: 'implicit',
        timestamp: Date.now(),
        
        // Tipo de ação
        action: signal.type, // suggestion_used, suggestion_edited, suggestion_ignored
        
        // Métricas de comportamento
        wasUsed: signal.type === 'suggestion_used' || signal.type === 'suggestion_edited',
        wasEdited: signal.wasEdited || false,
        editDistance: signal.editDistance || 0,
        responseTime: signal.responseTime || 0,
        
        // Contexto
        chatId: signal.chatId,
        intent: signal.intent
      };
      
      this.implicitSignals.push(record);
      
      // Manter apenas últimos 500 sinais
      if (this.implicitSignals.length > 500) {
        this.implicitSignals = this.implicitSignals.slice(-500);
      }
      
      this.updateAggregatedMetrics();
      this.save();
      
      console.log('[AIFeedbackSystem] 👁️ Sinal implícito:', signal.type);
    }

    /**
     * Registra resposta do cliente após nossa mensagem
     */
    recordClientResponse(data) {
      // Analisar sentimento da resposta do cliente
      const sentiment = this.analyzeSentiment(data.message);
      
      const signal = {
        id: Date.now(),
        type: 'client_response',
        timestamp: Date.now(),
        sentiment,
        messageId: data.messageId,
        chatId: data.chatId,
        timeToRespond: data.timeToRespond || 0
      };
      
      this.implicitSignals.push(signal);
      this.save();
      
      // Emitir evento com sentimento detectado
      if (window.EventBus && sentiment) {
        window.EventBus.emit('client:sentiment', {
          chatId: data.chatId,
          sentiment,
          message: data.message
        });
      }
    }

    // ============================================
    // FEEDBACK DE LONGO PRAZO
    // ============================================
    
    /**
     * Registra eventos de longo prazo (conversões, resoluções)
     */
    recordLongTermFeedback(eventType, data) {
      const record = {
        id: Date.now(),
        type: 'long_term',
        eventType, // conversion, resolution, churn, retention
        timestamp: Date.now(),
        chatId: data.chatId,
        value: data.value || 0,
        metadata: data.metadata || {}
      };
      
      this.feedbackHistory.push(record);
      this.updateAggregatedMetrics();
      this.save();
      
      console.log('[AIFeedbackSystem] 🎯 Evento de longo prazo:', eventType);
    }

    // ============================================
    // CÁLCULO DE REWARD
    // ============================================
    
    /**
     * Calcula reward signal para aprendizado
     * @returns {number} 0-1 (0 = muito ruim, 1 = perfeito)
     */
    calculateReward(feedback) {
      let reward = 0.5; // Base neutra
      
      // 1. Rating explícito (peso alto)
      if (feedback.rating) {
        reward = (feedback.rating - 1) / 4; // Converte 1-5 para 0-1
      }
      
      // 2. Ratings por dimensão (se disponíveis)
      const dimensions = feedback.dimensions;
      if (dimensions) {
        let dimensionScore = 0;
        let totalWeight = 0;
        
        for (const [dim, config] of Object.entries(FEEDBACK_DIMENSIONS)) {
          if (dimensions[dim] !== null) {
            dimensionScore += ((dimensions[dim] - 1) / 4) * config.weight;
            totalWeight += config.weight;
          }
        }
        
        if (totalWeight > 0) {
          reward = (reward * 0.5) + ((dimensionScore / totalWeight) * 0.5);
        }
      }
      
      // 3. Penalizar se houve correção
      if (feedback.correction) {
        reward *= 0.7; // 30% de penalidade
      }
      
      // 4. Bonus se foi muito rápido aceitar
      if (feedback.responseTime && feedback.responseTime < 3000) {
        reward = Math.min(1, reward + 0.1);
      }
      
      return Math.max(0, Math.min(1, reward));
    }

    /**
     * Calcula reward de feedback implícito
     */
    calculateImplicitReward(signal) {
      let reward = 0.5;
      
      if (signal.wasUsed) {
        reward = 0.7;
        
        if (!signal.wasEdited) {
          reward = 0.9; // Usado sem edição = ótimo
        } else if (signal.editDistance < 0.2) {
          reward = 0.75; // Pequena edição = bom
        } else if (signal.editDistance > 0.5) {
          reward = 0.4; // Grande edição = não tão bom
        }
      } else {
        reward = 0.2; // Não usado = ruim
      }
      
      // Ajustar por tempo de resposta
      if (signal.responseTime < 2000) {
        reward += 0.05; // Resposta rápida = bom sinal
      } else if (signal.responseTime > 10000) {
        reward -= 0.05; // Demorou muito = incerteza
      }
      
      return Math.max(0, Math.min(1, reward));
    }

    // ============================================
    // ANÁLISE DE SENTIMENTO (SIMPLIFICADA)
    // ============================================
    
    analyzeSentiment(text) {
      if (!text) return 0;
      
      const lowerText = text.toLowerCase();
      
      const positiveWords = [
        'obrigado', 'obrigada', 'perfeito', 'ótimo', 'excelente', 'top',
        'maravilhoso', 'incrível', 'adorei', 'amei', 'legal', 'bom',
        '👍', '❤️', '😊', '🙌', '✨'
      ];
      
      const negativeWords = [
        'problema', 'péssimo', 'horrível', 'ruim', 'insatisfeito',
        'reclamação', 'absurdo', 'vergonha', 'demora', 'nunca mais',
        '😡', '😤', '👎', '😠'
      ];
      
      let positiveCount = 0;
      let negativeCount = 0;
      
      for (const word of positiveWords) {
        if (lowerText.includes(word)) positiveCount++;
      }
      
      for (const word of negativeWords) {
        if (lowerText.includes(word)) negativeCount++;
      }
      
      if (positiveCount === 0 && negativeCount === 0) return 0; // Neutro
      
      return (positiveCount - negativeCount) / Math.max(positiveCount + negativeCount, 1);
    }

    // ============================================
    // DISTÂNCIA DE EDIÇÃO
    // ============================================
    
    /**
     * Calcula distância de edição normalizada (0-1)
     */
    calculateEditDistance(original, edited) {
      if (!original || !edited) return 1;
      if (original === edited) return 0;
      
      const maxLen = Math.max(original.length, edited.length);
      if (maxLen === 0) return 0;
      
      // Levenshtein simplificado
      const distance = this.levenshtein(original, edited);
      
      return Math.min(1, distance / maxLen);
    }

    levenshtein(a, b) {
      if (a.length === 0) return b.length;
      if (b.length === 0) return a.length;

      const matrix = [];

      for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
      }

      for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
      }

      for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
          if (b.charAt(i - 1) === a.charAt(j - 1)) {
            matrix[i][j] = matrix[i - 1][j - 1];
          } else {
            matrix[i][j] = Math.min(
              matrix[i - 1][j - 1] + 1,
              matrix[i][j - 1] + 1,
              matrix[i - 1][j] + 1
            );
          }
        }
      }

      return matrix[b.length][a.length];
    }

    // ============================================
    // MÉTRICAS AGREGADAS
    // ============================================
    
    updateAggregatedMetrics() {
      const explicitFeedbacks = this.feedbackHistory.filter(f => f.type === 'explicit');
      const implicitSignals = this.implicitSignals;
      const longTermFeedbacks = this.feedbackHistory.filter(f => f.type === 'long_term');
      
      // Total de feedbacks
      this.aggregatedMetrics.totalFeedbacks = explicitFeedbacks.length;
      
      // Média de rating
      const ratings = explicitFeedbacks.filter(f => f.rating).map(f => f.rating);
      this.aggregatedMetrics.averageRating = ratings.length > 0 
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length 
        : 0;
      
      // Taxa de aceitação de sugestões
      const used = implicitSignals.filter(s => s.wasUsed).length;
      this.aggregatedMetrics.suggestionAcceptanceRate = implicitSignals.length > 0
        ? used / implicitSignals.length
        : 0;
      
      // Taxa de edição
      const edited = implicitSignals.filter(s => s.wasEdited).length;
      this.aggregatedMetrics.editRate = used > 0 ? edited / used : 0;
      
      // Taxa de conversão
      const conversions = longTermFeedbacks.filter(f => f.eventType === 'conversion').length;
      const totalConversations = new Set(this.feedbackHistory.map(f => f.chatId)).size;
      this.aggregatedMetrics.conversionRate = totalConversations > 0
        ? conversions / totalConversations
        : 0;
      
      // Taxa de resolução
      const resolutions = longTermFeedbacks.filter(f => f.eventType === 'resolution').length;
      this.aggregatedMetrics.resolutionRate = totalConversations > 0
        ? resolutions / totalConversations
        : 0;
    }

    // ============================================
    // PERSISTÊNCIA
    // ============================================
    
    trimHistory() {
      if (this.feedbackHistory.length > MAX_FEEDBACK_HISTORY) {
        this.feedbackHistory = this.feedbackHistory.slice(-MAX_FEEDBACK_HISTORY);
      }
    }

    async save() {
      try {
        const data = {
          feedbackHistory: this.feedbackHistory,
          implicitSignals: this.implicitSignals,
          aggregatedMetrics: this.aggregatedMetrics,
          savedAt: Date.now()
        };
        
        await chrome.storage.local.set({
          [STORAGE_KEY]: JSON.stringify(data)
        });
        
        return true;
      } catch (error) {
        console.error('[AIFeedbackSystem] Erro ao salvar:', error);
        return false;
      }
    }

    // ============================================
    // API PÚBLICA
    // ============================================
    
    getMetrics() {
      return {
        ...this.aggregatedMetrics,
        recentFeedbacks: this.feedbackHistory.slice(-10),
        recentSignals: this.implicitSignals.slice(-10)
      };
    }

    getAverageReward(period = 7) {
      const cutoff = Date.now() - (period * 24 * 60 * 60 * 1000);
      const recent = this.feedbackHistory.filter(f => f.timestamp > cutoff);
      
      if (recent.length === 0) return 0.5;
      
      const rewards = recent.map(f => f.type === 'explicit' 
        ? this.calculateReward(f) 
        : 0.5
      );
      
      return rewards.reduce((a, b) => a + b, 0) / rewards.length;
    }

    /**
     * Obtém score de qualidade geral da IA
     */
    getQualityScore() {
      const weights = {
        rating: 0.3,
        acceptance: 0.25,
        lowEdit: 0.15,
        conversion: 0.15,
        resolution: 0.15
      };
      
      let score = 0;
      
      // Rating médio normalizado
      score += (this.aggregatedMetrics.averageRating / 5) * weights.rating;
      
      // Taxa de aceitação
      score += this.aggregatedMetrics.suggestionAcceptanceRate * weights.acceptance;
      
      // Taxa de baixa edição
      score += (1 - this.aggregatedMetrics.editRate) * weights.lowEdit;
      
      // Taxa de conversão
      score += this.aggregatedMetrics.conversionRate * weights.conversion;
      
      // Taxa de resolução
      score += this.aggregatedMetrics.resolutionRate * weights.resolution;
      
      return score;
    }
  }

  // ============================================
  // EXPORTAR
  // ============================================
  
  window.AIFeedbackSystem = AIFeedbackSystem;
  
  if (!window.aiFeedbackSystem) {
    window.aiFeedbackSystem = new AIFeedbackSystem();
    window.aiFeedbackSystem.init().then(() => {
      console.log('[AIFeedbackSystem] ✅ Sistema de feedback inicializado');
    });
  }

})();
