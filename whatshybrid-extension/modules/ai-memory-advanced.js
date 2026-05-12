/**
 * 🧠 AI Memory Advanced - Sistema de Memória Contextual Avançada
 * WhatsHybrid v7.7.0
 * 
 * Features:
 * - Perfil dinâmico do cliente
 * - Contexto temporal
 * - Open loops (pendências)
 * - Histórico de decisões da IA
 * - Embedding semântico local
 * - Sincronização com backend
 * 
 * @version 2.0.0
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'whl_ai_memory_advanced';
  const MAX_PROFILES = 500;
  const PROFILE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 dias
  const WHL_DEBUG = (typeof localStorage !== 'undefined' && localStorage.getItem('whl_debug') === 'true');

  // ============================================
  // ESTRUTURA DO PERFIL DE CLIENTE
  // ============================================
  const DEFAULT_CLIENT_PROFILE = {
    // Identificação
    chatId: '',
    name: '',
    phone: '',
    
    // Estilo de comunicação (detectado automaticamente)
    communicationStyle: 'neutral', // formal, informal, tecnico, neutral
    preferredLanguage: 'pt-BR',
    responseLength: 'media', // curta, media, longa
    useEmojis: true,
    
    // Interesses e comportamento
    topicsOfInterest: [],
    frequentKeywords: [],
    buyingIntention: 0, // 0-1
    satisfactionTrend: [], // últimas 10 interações
    
    // Dados comerciais
    lastPurchase: null, // { date, product, value }
    lifetimeValue: 0,
    purchaseHistory: [],
    
    // Contexto temporal
    firstContact: null,
    lastContact: null,
    conversationCount: 0,
    averageResponseTime: 0, // minutos que cliente demora para responder
    bestContactTime: null, // horário preferido
    daysSinceLastContact: 0,
    
    // Pendências (open loops)
    openLoops: [], // { issue, priority, dueDate, status, createdAt }
    
    // Histórico de decisões da IA
    aiDecisionHistory: [], // { action, confidence, feedback, timestamp }
    
    // Métricas de IA para este cliente
    aiMetrics: {
      suggestionsShown: 0,
      suggestionsUsed: 0,
      suggestionsEdited: 0,
      autoResponses: 0,
      escalations: 0,
      positiveOutcomes: 0,
      negativeOutcomes: 0
    },
    
    // Tags e categorias
    tags: [],
    segment: 'new', // new, lead, customer, vip, churned
    
    // Timestamps
    createdAt: null,
    updatedAt: null
  };

  // ============================================
  // CLASSE PRINCIPAL
  // ============================================
  class AIMemoryAdvanced {
    constructor() {
      this.profiles = new Map();
      this.initialized = false;
      this.pendingSync = [];
      this.cleanupInterval = null;
      this.syncTimeout = null;
    }

    // ============================================
    // INICIALIZAÇÃO
    // ============================================
    async init() {
      if (this.initialized) return;

      try {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        if (data[STORAGE_KEY]) {
          const stored = JSON.parse(data[STORAGE_KEY]);
          Object.entries(stored).forEach(([key, value]) => {
            this.profiles.set(key, value);
          });
          if (WHL_DEBUG) console.log('[AIMemoryAdvanced] Perfis carregados:', this.profiles.size);
        }
        
        this.initialized = true;
        this.startAutoCleanup();
        
      } catch (error) {
        console.error('[AIMemoryAdvanced] Erro ao inicializar:', error);
      }
    }

    // ============================================
    // GESTÃO DE PERFIS
    // ============================================
    
    /**
     * Obtém ou cria perfil de cliente
     */
    getProfile(chatId) {
      if (!chatId) return null;
      
      const key = this.normalizeKey(chatId);
      
      if (!this.profiles.has(key)) {
        this.profiles.set(key, {
          ...DEFAULT_CLIENT_PROFILE,
          chatId: key,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }
      
      return this.profiles.get(key);
    }

    /**
     * Atualiza perfil de cliente
     */
    async updateProfile(chatId, updates) {
      const profile = this.getProfile(chatId);
      if (!profile) return null;
      
      Object.assign(profile, updates, { updatedAt: Date.now() });
      
      await this.save();
      this.queueForSync(chatId, profile);
      
      return profile;
    }

    // ============================================
    // ANÁLISE DE COMUNICAÇÃO
    // ============================================
    
    /**
     * Analisa mensagem e atualiza perfil do cliente
     */
    async analyzeAndUpdateFromMessage(chatId, message, isFromClient = true) {
      const profile = this.getProfile(chatId);
      if (!profile || !message) return profile;
      
      if (isFromClient) {
        // Detectar estilo de comunicação
        const style = this.detectCommunicationStyle(message);
        profile.communicationStyle = this.blendStyle(profile.communicationStyle, style);
        
        // Detectar preferência de tamanho de resposta
        profile.responseLength = this.detectPreferredLength(message, profile.responseLength);
        
        // Detectar uso de emojis
        profile.useEmojis = this.detectEmojiPreference(message, profile.useEmojis);
        
        // Extrair tópicos de interesse
        const topics = this.extractTopics(message);
        profile.topicsOfInterest = this.mergeTopics(profile.topicsOfInterest, topics);
        
        // Extrair keywords frequentes
        const keywords = this.extractKeywords(message);
        profile.frequentKeywords = this.mergeKeywords(profile.frequentKeywords, keywords);
        
        // Detectar intenção de compra
        const buyingSignals = this.detectBuyingIntention(message);
        profile.buyingIntention = this.smoothValue(profile.buyingIntention, buyingSignals, 0.3);
        
        // Atualizar contexto temporal
        const now = Date.now();
        if (!profile.firstContact) profile.firstContact = now;
        
        if (profile.lastContact) {
          const timeSinceLast = now - profile.lastContact;
          profile.daysSinceLastContact = Math.floor(timeSinceLast / (24 * 60 * 60 * 1000));
        }
        profile.lastContact = now;
        profile.conversationCount++;
        
        // Detectar horário preferido
        const hour = new Date().getHours();
        profile.bestContactTime = this.updateBestContactTime(profile.bestContactTime, hour);
      }
      
      profile.updatedAt = Date.now();
      await this.save();
      
      return profile;
    }

    /**
     * Detecta estilo de comunicação
     */
    detectCommunicationStyle(text) {
      const lowerText = text.toLowerCase();
      
      const formalIndicators = [
        'prezado', 'senhor', 'senhora', 'atenciosamente', 'cordialmente',
        'solicito', 'informo', 'segue', 'conforme', 'referente'
      ];
      
      const informalIndicators = [
        'oi', 'eai', 'blz', 'vlw', 'tmj', 'kkkk', 'rsrs', 'haha',
        'vc', 'pq', 'tb', 'msg', 'q', 'n', 'cmg'
      ];
      
      const technicalIndicators = [
        'api', 'endpoint', 'json', 'servidor', 'banco de dados', 'integração',
        'sistema', 'configuração', 'parâmetro', 'debug', 'log'
      ];
      
      let formalScore = formalIndicators.filter(i => lowerText.includes(i)).length;
      let informalScore = informalIndicators.filter(i => lowerText.includes(i)).length;
      let technicalScore = technicalIndicators.filter(i => lowerText.includes(i)).length;
      
      if (technicalScore >= 2) return 'tecnico';
      if (formalScore > informalScore) return 'formal';
      if (informalScore > formalScore) return 'informal';
      return 'neutral';
    }

    /**
     * Combina estilos com peso para o novo
     */
    blendStyle(current, detected) {
      if (current === detected) return current;
      if (current === 'neutral') return detected;
      
      // Manter estilo atual se for consistente
      return detected;
    }

    /**
     * Detecta preferência de tamanho de resposta
     */
    detectPreferredLength(message, current) {
      const words = message.split(/\s+/).length;
      
      if (words <= 10) return this.blendLength(current, 'curta');
      if (words <= 50) return this.blendLength(current, 'media');
      return this.blendLength(current, 'longa');
    }

    blendLength(current, detected) {
      const weights = { curta: 0, media: 1, longa: 2 };
      const currentWeight = weights[current] || 1;
      const detectedWeight = weights[detected] || 1;
      const avg = (currentWeight * 0.7 + detectedWeight * 0.3);
      
      if (avg < 0.5) return 'curta';
      if (avg < 1.5) return 'media';
      return 'longa';
    }

    /**
     * Detecta preferência de emojis
     */
    detectEmojiPreference(message, current) {
      const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
      const hasEmojis = emojiRegex.test(message);
      
      // Se cliente usa emojis, manter true
      if (hasEmojis) return true;
      
      // Se não usa, tender para false gradualmente
      return current;
    }

    /**
     * Extrai tópicos de interesse
     */
    extractTopics(text) {
      const topics = [];
      const lowerText = text.toLowerCase();
      
      const topicPatterns = {
        'preco': ['preço', 'valor', 'quanto custa', 'orçamento', 'custo'],
        'entrega': ['entrega', 'prazo', 'envio', 'frete', 'chegada'],
        'produto': ['produto', 'item', 'artigo', 'modelo', 'versão'],
        'suporte': ['problema', 'erro', 'não funciona', 'ajuda', 'suporte'],
        'pagamento': ['pagamento', 'pagar', 'parcela', 'boleto', 'pix', 'cartão'],
        'garantia': ['garantia', 'troca', 'devolução', 'defeito'],
        'desconto': ['desconto', 'promoção', 'cupom', 'oferta']
      };
      
      for (const [topic, patterns] of Object.entries(topicPatterns)) {
        if (patterns.some(p => lowerText.includes(p))) {
          topics.push(topic);
        }
      }
      
      return topics;
    }

    /**
     * Merge tópicos mantendo os mais recentes
     */
    mergeTopics(existing, newTopics) {
      const merged = [...new Set([...newTopics, ...existing])];
      return merged.slice(0, 20); // Manter no máximo 20 tópicos
    }

    /**
     * Extrai keywords frequentes
     */
    extractKeywords(text) {
      const stopwords = new Set([
        'de', 'a', 'o', 'que', 'e', 'do', 'da', 'em', 'um', 'para',
        'é', 'com', 'não', 'uma', 'os', 'no', 'se', 'na', 'por', 'mais',
        'as', 'dos', 'como', 'mas', 'foi', 'ao', 'ele', 'das', 'tem', 'seu',
        'sua', 'ou', 'ser', 'quando', 'muito', 'há', 'nos', 'já', 'está'
      ]);
      
      const words = text.toLowerCase()
        .replace(/[^\w\sáéíóúâêîôûãõç]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopwords.has(w));
      
      return [...new Set(words)];
    }

    /**
     * Merge keywords com contagem
     */
    mergeKeywords(existing, newKeywords) {
      const map = new Map();
      
      existing.forEach(k => {
        if (typeof k === 'object') {
          map.set(k.word, (map.get(k.word) || 0) + k.count);
        } else {
          map.set(k, (map.get(k) || 0) + 1);
        }
      });
      
      newKeywords.forEach(k => {
        map.set(k, (map.get(k) || 0) + 1);
      });
      
      return Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([word, count]) => ({ word, count }));
    }

    /**
     * Detecta sinais de intenção de compra (0-1)
     */
    detectBuyingIntention(text) {
      const lowerText = text.toLowerCase();
      let score = 0;
      
      const strongSignals = [
        'quero comprar', 'vou levar', 'pode mandar', 'fecha negócio',
        'confirmo', 'aceito', 'envie o link', 'como pago'
      ];
      
      const mediumSignals = [
        'quanto custa', 'tem disponível', 'qual o preço', 'me interessa',
        'gostei', 'quero saber mais', 'como funciona'
      ];
      
      const weakSignals = [
        'vocês vendem', 'trabalham com', 'fazem', 'tem', 'existe'
      ];
      
      if (strongSignals.some(s => lowerText.includes(s))) score = 0.9;
      else if (mediumSignals.some(s => lowerText.includes(s))) score = 0.6;
      else if (weakSignals.some(s => lowerText.includes(s))) score = 0.3;
      
      return score;
    }

    /**
     * Suaviza valor com média ponderada
     */
    smoothValue(current, newValue, weight) {
      return current * (1 - weight) + newValue * weight;
    }

    /**
     * Atualiza melhor horário de contato
     */
    updateBestContactTime(current, hour) {
      if (!current) return `${hour}:00-${hour + 2}:00`;
      
      // Simplificado: manter o horário mais frequente
      const currentHour = parseInt(current.split(':')[0]);
      const avgHour = Math.round((currentHour + hour) / 2);
      return `${avgHour}:00-${avgHour + 2}:00`;
    }

    // ============================================
    // OPEN LOOPS (PENDÊNCIAS)
    // ============================================
    
    /**
     * Adiciona pendência
     */
    async addOpenLoop(chatId, issue, priority = 'medium', dueDate = null) {
      const profile = this.getProfile(chatId);
      if (!profile) return null;
      
      const openLoop = {
        id: Date.now(),
        issue,
        priority, // low, medium, high, critical
        dueDate,
        status: 'open',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      profile.openLoops.push(openLoop);
      await this.save();
      
      return openLoop;
    }

    /**
     * Resolve pendência
     */
    async resolveOpenLoop(chatId, loopId, resolution = 'resolved') {
      const profile = this.getProfile(chatId);
      if (!profile) return false;
      
      const loop = profile.openLoops.find(l => l.id === loopId);
      if (loop) {
        loop.status = resolution;
        loop.updatedAt = Date.now();
        loop.resolvedAt = Date.now();
        await this.save();
        return true;
      }
      
      return false;
    }

    /**
     * Obtém pendências abertas
     */
    getOpenLoops(chatId) {
      const profile = this.getProfile(chatId);
      if (!profile) return [];
      
      return profile.openLoops.filter(l => l.status === 'open');
    }

    // ============================================
    // HISTÓRICO DE DECISÕES DA IA
    // ============================================
    
    /**
     * Registra decisão da IA
     */
    async recordAIDecision(chatId, action, confidence, context = {}) {
      const profile = this.getProfile(chatId);
      if (!profile) return;
      
      const decision = {
        action, // auto_response, suggest, escalate, skip
        confidence,
        context,
        timestamp: Date.now(),
        feedback: null // será preenchido depois
      };
      
      profile.aiDecisionHistory.push(decision);
      
      // Manter apenas últimas 100 decisões
      if (profile.aiDecisionHistory.length > 100) {
        profile.aiDecisionHistory = profile.aiDecisionHistory.slice(-100);
      }
      
      await this.save();
      
      return decision;
    }

    /**
     * Registra feedback para última decisão
     */
    async recordDecisionFeedback(chatId, feedback) {
      const profile = this.getProfile(chatId);
      if (!profile || profile.aiDecisionHistory.length === 0) return;
      
      const lastDecision = profile.aiDecisionHistory[profile.aiDecisionHistory.length - 1];
      lastDecision.feedback = feedback; // positive, negative, neutral
      
      // Atualizar métricas
      if (feedback === 'positive') {
        profile.aiMetrics.positiveOutcomes++;
      } else if (feedback === 'negative') {
        profile.aiMetrics.negativeOutcomes++;
      }
      
      // Atualizar tendência de satisfação
      const satisfaction = feedback === 'positive' ? 1 : feedback === 'negative' ? 0 : 0.5;
      profile.satisfactionTrend.push(satisfaction);
      if (profile.satisfactionTrend.length > 10) {
        profile.satisfactionTrend = profile.satisfactionTrend.slice(-10);
      }
      
      await this.save();
    }

    // ============================================
    // MÉTRICAS E ANALYTICS
    // ============================================
    
    /**
     * Atualiza métricas de IA para o cliente
     */
    async updateAIMetrics(chatId, metric, increment = 1) {
      const profile = this.getProfile(chatId);
      if (!profile) return;
      
      if (profile.aiMetrics.hasOwnProperty(metric)) {
        profile.aiMetrics[metric] += increment;
        await this.save();
      }
    }

    /**
     * Calcula taxa de sucesso da IA para o cliente
     */
    getAISuccessRate(chatId) {
      const profile = this.getProfile(chatId);
      if (!profile) return 0;
      
      const metrics = profile.aiMetrics;
      const total = metrics.positiveOutcomes + metrics.negativeOutcomes;
      
      if (total === 0) return 0.5; // Sem dados, assume neutro
      
      return metrics.positiveOutcomes / total;
    }

    /**
     * Calcula taxa de uso de sugestões
     */
    getSuggestionUsageRate(chatId) {
      const profile = this.getProfile(chatId);
      if (!profile) return 0;
      
      const metrics = profile.aiMetrics;
      if (metrics.suggestionsShown === 0) return 0;
      
      return (metrics.suggestionsUsed + metrics.suggestionsEdited * 0.5) / metrics.suggestionsShown;
    }

    // ============================================
    // SEGMENTAÇÃO
    // ============================================
    
    /**
     * Atualiza segmento do cliente
     */
    async updateSegment(chatId) {
      const profile = this.getProfile(chatId);
      if (!profile) return;
      
      // Lógica de segmentação
      if (profile.lifetimeValue >= 5000) {
        profile.segment = 'vip';
      } else if (profile.purchaseHistory?.length > 0) {
        profile.segment = 'customer';
      } else if (profile.buyingIntention > 0.5) {
        profile.segment = 'lead';
      } else if (profile.daysSinceLastContact > 90) {
        profile.segment = 'churned';
      } else {
        profile.segment = 'new';
      }
      
      await this.save();
      return profile.segment;
    }

    // ============================================
    // PERSISTÊNCIA
    // ============================================
    
    async save() {
      try {
        const data = Object.fromEntries(this.profiles);
        await chrome.storage.local.set({
          [STORAGE_KEY]: JSON.stringify(data)
        });
        return true;
      } catch (error) {
        console.error('[AIMemoryAdvanced] Erro ao salvar:', error);
        return false;
      }
    }

    normalizeKey(chatId) {
      return String(chatId).replace(/@[cs]\.us$/i, '').replace(/\D/g, '');
    }

    // ============================================
    // LIMPEZA E MANUTENÇÃO
    // ============================================
    
    startAutoCleanup() {
      // Limpar perfis antigos a cada hora
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
      }
      this.cleanupInterval = setInterval(() => {
        Promise.resolve(this.cleanup()).catch(() => {});
      }, 60 * 60 * 1000);
    }

    stopAutoCleanup() {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }
      if (this.syncTimeout) {
        clearTimeout(this.syncTimeout);
        this.syncTimeout = null;
      }
    }

    async cleanup() {
      const now = Date.now();
      let removed = 0;
      
      for (const [key, profile] of this.profiles.entries()) {
        // Remover perfis não atualizados há mais de 30 dias e sem valor
        if (now - profile.updatedAt > PROFILE_TTL && 
            profile.lifetimeValue === 0 && 
            profile.conversationCount < 5) {
          this.profiles.delete(key);
          removed++;
        }
      }
      
      // Limitar tamanho total
      if (this.profiles.size > MAX_PROFILES) {
        const sorted = Array.from(this.profiles.entries())
          .sort((a, b) => b[1].updatedAt - a[1].updatedAt);
        
        while (this.profiles.size > MAX_PROFILES) {
          const oldest = sorted.pop();
          if (oldest) this.profiles.delete(oldest[0]);
          removed++;
        }
      }
      
      if (removed > 0) {
        if (WHL_DEBUG) console.log('[AIMemoryAdvanced] Limpeza: removidos', removed, 'perfis');
        await this.save();
      }
    }

    // ============================================
    // SINCRONIZAÇÃO COM BACKEND
    // ============================================
    
    queueForSync(chatId, profile) {
      this.pendingSync.push({ chatId, profile, timestamp: Date.now() });
      
      // Debounce sync
      if (this.syncTimeout) clearTimeout(this.syncTimeout);
      this.syncTimeout = setTimeout(() => this.syncWithBackend(), 5000);
    }

    async syncWithBackend() {
      if (this.pendingSync.length === 0) return;

      const batch = this.pendingSync.splice(0, 10);

      try {
        // v9.5.6: BackendClient.syncClientProfiles never existed (silent no-op since v9.4.x).
        // Replaced with: rely on data-sync-manager pushing whl_ai_memory_advanced via the generic
        // /api/v1/sync/ai_memory_advanced endpoint (registered in SYNC_MODULES). The pendingSync
        // queue still serves as a "dirty flag" that data-sync-manager picks up on its next debounce.
        if (window.DataSyncManager?.syncModule) {
          await window.DataSyncManager.syncModule('ai_memory_advanced').catch(() => {});
          if (WHL_DEBUG) console.log('[AIMemoryAdvanced] Marcado para sync via DataSyncManager:', batch.length, 'perfis');
        } else if (window.BackendClient?.syncClientProfiles) {
          // Legacy fallback (kept for the day someone implements the dedicated endpoint).
          await window.BackendClient.syncClientProfiles(batch);
        }
      } catch (e) {
        console.error('[AIMemoryAdvanced] Erro na sincronização:', e);
        // Re-adicionar à fila
        this.pendingSync.unshift(...batch);
      }
    }

    // ============================================
    // CONTEXTO PARA PROMPT
    // ============================================
    
    /**
     * Gera contexto formatado para incluir no prompt da IA
     */
    getContextForPrompt(chatId) {
      const profile = this.getProfile(chatId);
      if (!profile) return '';
      
      let context = [];
      
      // Perfil básico
      if (profile.name) context.push(`Nome do cliente: ${profile.name}`);
      context.push(`Estilo de comunicação: ${profile.communicationStyle}`);
      context.push(`Preferência de resposta: ${profile.responseLength}`);
      
      // Contexto temporal
      if (profile.conversationCount > 1) {
        context.push(`Esta é a conversa #${profile.conversationCount} com este cliente`);
      }
      if (profile.daysSinceLastContact > 0) {
        context.push(`Último contato há ${profile.daysSinceLastContact} dias`);
      }
      
      // Interesses
      if (profile.topicsOfInterest.length > 0) {
        context.push(`Tópicos de interesse: ${profile.topicsOfInterest.slice(0, 5).join(', ')}`);
      }
      
      // Intenção de compra
      if (profile.buyingIntention > 0.5) {
        context.push(`Intenção de compra detectada: ${Math.round(profile.buyingIntention * 100)}%`);
      }
      
      // Segmento
      context.push(`Segmento: ${profile.segment}`);
      if (profile.lifetimeValue > 0) {
        context.push(`Valor do cliente: R$ ${profile.lifetimeValue.toFixed(2)}`);
      }
      
      // Pendências
      const openLoops = this.getOpenLoops(chatId);
      if (openLoops.length > 0) {
        context.push(`Pendências em aberto: ${openLoops.map(l => l.issue).join('; ')}`);
      }
      
      // Satisfação
      if (profile.satisfactionTrend.length >= 3) {
        const avgSatisfaction = profile.satisfactionTrend.reduce((a, b) => a + b, 0) / profile.satisfactionTrend.length;
        if (avgSatisfaction < 0.4) {
          context.push('⚠️ ATENÇÃO: Cliente com tendência de insatisfação');
        } else if (avgSatisfaction > 0.8) {
          context.push('Cliente satisfeito - histórico positivo');
        }
      }
      
      return context.join('\n');
    }
  }

  // ============================================
  // EXPORTAR
  // ============================================
  
  window.AIMemoryAdvanced = AIMemoryAdvanced;
  
  if (!window.aiMemoryAdvanced) {
    window.aiMemoryAdvanced = new AIMemoryAdvanced();
    window.aiMemoryAdvanced.init().then(() => {
      if (WHL_DEBUG) console.log('[AIMemoryAdvanced] ✅ Sistema de memória avançada inicializado');
    });
  }

  // Evitar vazamento de intervalos em recarregamentos
  window.addEventListener('beforeunload', () => {
    if (window.aiMemoryAdvanced?.syncTimeout) {
      clearTimeout(window.aiMemoryAdvanced.syncTimeout);
      window.aiMemoryAdvanced.syncTimeout = null;
    }
    window.aiMemoryAdvanced?.stopAutoCleanup();
  });

})();
