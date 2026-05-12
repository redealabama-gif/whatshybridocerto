/**
 * FEAT-005: Behavioral Analysis - Análise comportamental de clientes
 * 
 * Benefícios:
 * - Identifica padrões de comportamento
 * - Previsão de necessidades do cliente
 * - Segmentação automática
 * 
 * @version 1.0.0
 * @since 7.9.14
 */

(function() {
  'use strict';

  const CONFIG = {
    STORAGE_KEY: 'whl_behavioral_analysis',
    
    SEGMENTS: {
      HIGH_VALUE: { minScore: 80, label: 'Alto Valor', icon: '⭐' },
      REGULAR: { minScore: 50, label: 'Regular', icon: '👤' },
      AT_RISK: { minScore: 0, label: 'Em Risco', icon: '⚠️' }
    },
    
    BEHAVIORS: {
      RESPONSIVE: 'responsive',
      DETAIL_ORIENTED: 'detail_oriented',
      PRICE_SENSITIVE: 'price_sensitive',
      IMPATIENT: 'impatient',
      LOYAL: 'loyal',
      NEW: 'new'
    },
    
    ANALYSIS_WINDOW_DAYS: 30
  };

  class BehavioralAnalysis {
    constructor() {
      this.profiles = new Map();
      this.sessionData = new Map();
      this.initialized = false;
    }

    async init() {
      await this._loadData();
      this._setupEventListeners();
      this.initialized = true;
      console.log('[BehavioralAnalysis] Initialized with', this.profiles.size, 'profiles');
    }

    async _loadData() {
      try {
        const data = await this._getStorage(CONFIG.STORAGE_KEY);
        if (data?.profiles) {
          this.profiles = new Map(Object.entries(data.profiles));
        }
      } catch (e) {
        console.warn('[BehavioralAnalysis] Load failed:', e);
      }
    }

    async _saveData() {
      await this._setStorage(CONFIG.STORAGE_KEY, {
        profiles: Object.fromEntries(this.profiles)
      });
    }

    _getStorage(key) {
      return new Promise(r => {
        if (typeof chrome !== 'undefined' && chrome.storage)
          chrome.storage.local.get([key], res => r(res[key]));
        else r(null);
      });
    }

    _setStorage(key, value) {
      return new Promise(r => {
        if (typeof chrome !== 'undefined' && chrome.storage)
          chrome.storage.local.set({ [key]: value }, r);
        else r();
      });
    }

    _setupEventListeners() {
      if (window.WHLEventBus) {
        window.WHLEventBus.on('messageReceived', d => this._trackMessage(d));
        window.WHLEventBus.on('chatOpened', d => this._startSession(d));
        window.WHLEventBus.on('chatClosed', d => this._endSession(d));
      }
    }

    _getOrCreateProfile(contactId) {
      if (!this.profiles.has(contactId)) {
        this.profiles.set(contactId, {
          id: contactId,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          totalMessages: 0,
          totalSessions: 0,
          avgResponseTime: 0,
          avgMessageLength: 0,
          behaviors: [],
          segment: 'NEW',
          score: 50,
          interests: [],
          sentiment: { positive: 0, negative: 0, neutral: 0 },
          preferences: {},
          timeline: []
        });
      }
      return this.profiles.get(contactId);
    }

    _startSession(data) {
      const { contactId } = data;
      if (!contactId) return;

      this.sessionData.set(contactId, {
        startTime: Date.now(),
        messages: [],
        responseTimes: []
      });

      const profile = this._getOrCreateProfile(contactId);
      profile.totalSessions++;
      profile.lastSeen = Date.now();
    }

    _trackMessage(data) {
      const { contactId, message, isFromContact, timestamp } = data;
      if (!contactId || !message) return;

      const profile = this._getOrCreateProfile(contactId);
      const session = this.sessionData.get(contactId);

      // Atualizar métricas
      profile.totalMessages++;
      profile.lastSeen = Date.now();

      // Calcular tempo de resposta
      if (session && session.messages.length > 0 && isFromContact) {
        const lastMsg = session.messages[session.messages.length - 1];
        if (!lastMsg.isFromContact) {
          const responseTime = (timestamp || Date.now()) - lastMsg.timestamp;
          session.responseTimes.push(responseTime);
          this._updateAvgResponseTime(profile, responseTime);
        }
      }

      // Atualizar comprimento médio
      const msgLength = message.length;
      profile.avgMessageLength = (profile.avgMessageLength * (profile.totalMessages - 1) + msgLength) / profile.totalMessages;

      // Análise de sentimento
      this._analyzeSentiment(profile, message);

      // Detectar interesses
      this._detectInterests(profile, message);

      // Registrar na sessão
      if (session) {
        session.messages.push({
          text: message,
          isFromContact,
          timestamp: timestamp || Date.now(),
          length: msgLength
        });
      }

      // Atualizar comportamentos
      this._updateBehaviors(profile);

      // Calcular score e segmento
      this._calculateScore(profile);

      this._saveData();
    }

    _endSession(data) {
      const { contactId } = data;
      if (!contactId) return;

      const session = this.sessionData.get(contactId);
      const profile = this.profiles.get(contactId);

      if (session && profile) {
        const duration = Date.now() - session.startTime;
        
        // Adicionar ao timeline
        profile.timeline.push({
          type: 'session',
          duration,
          messages: session.messages.length,
          timestamp: session.startTime
        });

        // Manter apenas últimos 50 eventos
        if (profile.timeline.length > 50) {
          profile.timeline = profile.timeline.slice(-50);
        }
      }

      this.sessionData.delete(contactId);
      this._saveData();
    }

    _updateAvgResponseTime(profile, responseTime) {
      const count = profile.totalSessions;
      profile.avgResponseTime = (profile.avgResponseTime * (count - 1) + responseTime) / count;
    }

    _analyzeSentiment(profile, message) {
      const positive = /(obrigado|ótimo|excelente|perfeito|adorei|top|maravilhoso|parabéns)/i;
      const negative = /(problema|erro|péssimo|horrível|irritado|raiva|decepcionado|absurdo)/i;

      if (positive.test(message)) profile.sentiment.positive++;
      else if (negative.test(message)) profile.sentiment.negative++;
      else profile.sentiment.neutral++;
    }

    _detectInterests(profile, message) {
      const interestPatterns = {
        'pricing': /(preço|valor|desconto|promoção|barato)/i,
        'quality': /(qualidade|durável|garantia|original)/i,
        'delivery': /(entrega|prazo|envio|frete)/i,
        'support': /(ajuda|suporte|assistência|manutenção)/i,
        'features': /(funciona|faz|recurso|característica)/i
      };

      for (const [interest, pattern] of Object.entries(interestPatterns)) {
        if (pattern.test(message) && !profile.interests.includes(interest)) {
          profile.interests.push(interest);
        }
      }
    }

    _updateBehaviors(profile) {
      const behaviors = new Set(profile.behaviors);

      // Responsivo
      if (profile.avgResponseTime < 60000 && profile.totalMessages > 5) {
        behaviors.add(CONFIG.BEHAVIORS.RESPONSIVE);
      }

      // Detalhista
      if (profile.avgMessageLength > 100) {
        behaviors.add(CONFIG.BEHAVIORS.DETAIL_ORIENTED);
      }

      // Sensível a preço
      if (profile.interests.includes('pricing')) {
        behaviors.add(CONFIG.BEHAVIORS.PRICE_SENSITIVE);
      }

      // Impaciente
      if (profile.avgResponseTime < 10000 && profile.sentiment.negative > profile.sentiment.positive) {
        behaviors.add(CONFIG.BEHAVIORS.IMPATIENT);
      }

      // Leal
      if (profile.totalSessions > 5 && profile.sentiment.positive > profile.sentiment.negative * 2) {
        behaviors.add(CONFIG.BEHAVIORS.LOYAL);
      }

      // Novo
      if (profile.totalSessions <= 2) {
        behaviors.add(CONFIG.BEHAVIORS.NEW);
      } else {
        behaviors.delete(CONFIG.BEHAVIORS.NEW);
      }

      profile.behaviors = Array.from(behaviors);
    }

    _calculateScore(profile) {
      let score = 50; // Base

      // Engajamento
      score += Math.min(20, profile.totalSessions * 2);
      score += Math.min(10, profile.totalMessages * 0.5);

      // Sentimento
      const totalSentiment = profile.sentiment.positive + profile.sentiment.negative + profile.sentiment.neutral;
      if (totalSentiment > 0) {
        const sentimentRatio = (profile.sentiment.positive - profile.sentiment.negative) / totalSentiment;
        score += sentimentRatio * 15;
      }

      // Responsividade
      if (profile.avgResponseTime < 60000) score += 5;
      if (profile.avgResponseTime > 300000) score -= 10;

      // Comportamentos
      if (profile.behaviors.includes(CONFIG.BEHAVIORS.LOYAL)) score += 10;
      if (profile.behaviors.includes(CONFIG.BEHAVIORS.IMPATIENT)) score -= 5;

      profile.score = Math.max(0, Math.min(100, Math.round(score)));

      // Determinar segmento
      for (const [segment, config] of Object.entries(CONFIG.SEGMENTS)) {
        if (profile.score >= config.minScore) {
          profile.segment = segment;
          break;
        }
      }
    }

    /**
     * Obtém perfil de um contato
     */
    getProfile(contactId) {
      return this.profiles.get(contactId) || null;
    }

    /**
     * Obtém resumo do perfil
     */
    getProfileSummary(contactId) {
      const profile = this.getProfile(contactId);
      if (!profile) return null;

      const segmentConfig = CONFIG.SEGMENTS[profile.segment];

      return {
        id: contactId,
        segment: {
          name: segmentConfig.label,
          icon: segmentConfig.icon
        },
        score: profile.score,
        behaviors: profile.behaviors,
        interests: profile.interests,
        stats: {
          totalMessages: profile.totalMessages,
          totalSessions: profile.totalSessions,
          avgResponseTime: Math.round(profile.avgResponseTime / 1000) + 's',
          sentiment: this._getSentimentLabel(profile.sentiment)
        },
        recommendations: this._getRecommendations(profile)
      };
    }

    _getSentimentLabel(sentiment) {
      const total = sentiment.positive + sentiment.negative + sentiment.neutral;
      if (total === 0) return 'Neutro';
      const ratio = sentiment.positive / total;
      if (ratio > 0.6) return 'Positivo';
      if (ratio < 0.3) return 'Negativo';
      return 'Neutro';
    }

    _getRecommendations(profile) {
      const recs = [];

      if (profile.behaviors.includes(CONFIG.BEHAVIORS.PRICE_SENSITIVE)) {
        recs.push('💰 Destaque promoções e descontos');
      }
      if (profile.behaviors.includes(CONFIG.BEHAVIORS.DETAIL_ORIENTED)) {
        recs.push('📝 Forneça informações detalhadas');
      }
      if (profile.behaviors.includes(CONFIG.BEHAVIORS.IMPATIENT)) {
        recs.push('⚡ Responda rapidamente e seja direto');
      }
      if (profile.behaviors.includes(CONFIG.BEHAVIORS.LOYAL)) {
        recs.push('⭐ Ofereça benefícios exclusivos');
      }
      if (profile.segment === 'AT_RISK') {
        recs.push('🚨 Atenção especial - cliente em risco');
      }

      return recs;
    }

    /**
     * Lista contatos por segmento
     */
    getContactsBySegment(segment) {
      return Array.from(this.profiles.values())
        .filter(p => p.segment === segment)
        .sort((a, b) => b.score - a.score);
    }

    /**
     * Obtém estatísticas gerais
     */
    getStats() {
      const profiles = Array.from(this.profiles.values());
      const segments = {};
      
      for (const seg of Object.keys(CONFIG.SEGMENTS)) {
        segments[seg] = profiles.filter(p => p.segment === seg).length;
      }

      return {
        totalProfiles: profiles.length,
        segments,
        avgScore: profiles.length > 0 
          ? Math.round(profiles.reduce((s, p) => s + p.score, 0) / profiles.length) 
          : 0,
        topBehaviors: this._getTopBehaviors(profiles)
      };
    }

    _getTopBehaviors(profiles) {
      const counts = {};
      for (const p of profiles) {
        for (const b of p.behaviors) {
          counts[b] = (counts[b] || 0) + 1;
        }
      }
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([behavior, count]) => ({ behavior, count }));
    }

    /**
     * Exporta dados
     */
    exportData() {
      return {
        profiles: Object.fromEntries(this.profiles),
        stats: this.getStats(),
        exportedAt: new Date().toISOString()
      };
    }
  }

  // Inicialização
  const behavioralAnalysis = new BehavioralAnalysis();
  behavioralAnalysis.init();

  window.WHLBehavioralAnalysis = behavioralAnalysis;
  window.WHLBehavioralConfig = CONFIG;

  console.log('[FEAT-005] Behavioral Analysis initialized');

})();
