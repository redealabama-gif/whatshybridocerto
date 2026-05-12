/**
 * AdvancedContextAnalyzer
 * @file Extraído de SmartBotIAService.js (refactor v9)
 */

const logger = require('../../../utils/logger');

class AdvancedContextAnalyzer {
  constructor(storage = null) {
    this.storage = storage;
    this.customerProfiles = new Map();
    this.conversationFlows = new Map();
    this.commonFlowPatterns = [
      { pattern: ['greeting', 'question'], name: 'inquiry' },
      { pattern: ['greeting', 'complaint'], name: 'support_issue' },
      { pattern: ['complaint', 'apology', 'solution'], name: 'resolution' },
      { pattern: ['question', 'answer', 'thanks'], name: 'successful_help' },
      { pattern: ['greeting', 'product_inquiry', 'price_inquiry'], name: 'sales_lead' }
    ];
  }

  async loadProfiles() {
    if (this.storage) {
      try {
        const profiles = await this.storage.get('smartbot_profiles');
        if (profiles) {
          Object.entries(profiles).forEach(([key, value]) => {
            this.customerProfiles.set(key, value);
          });
        }
      } catch (error) {
        logger.warn('[SmartBot] Error loading profiles:', error);
      }
    }
  }

  async saveProfiles() {
    if (this.storage) {
      try {
        const profiles = Object.fromEntries(this.customerProfiles);
        await this.storage.set('smartbot_profiles', profiles);
      } catch (error) {
        logger.warn('[SmartBot] Error saving profiles:', error);
      }
    }
  }

  analyzeContext(chatId, messages, currentMessage) {
    const customerProfile = this.getOrCreateProfile(chatId);
    const flowAnalysis = this.analyzeConversationFlow(chatId, messages);
    const sentimentTrend = this.analyzeSentimentTrend(messages);
    const urgencyLevel = this.detectUrgency(currentMessage, messages);
    const topicClusters = this.identifyTopicClusters(messages);

    this.updateCustomerProfile(chatId, currentMessage, sentimentTrend);

    return {
      customerProfile,
      flowAnalysis,
      sentimentTrend,
      urgencyLevel,
      topicClusters,
      recommendedTone: this.recommendTone(customerProfile, sentimentTrend),
      suggestedApproach: this.suggestApproach(flowAnalysis, urgencyLevel),
      contextSummary: this.generateContextSummary(customerProfile, flowAnalysis, sentimentTrend)
    };
  }

  getOrCreateProfile(chatId) {
    if (!this.customerProfiles.has(chatId)) {
      this.customerProfiles.set(chatId, {
        chatId,
        firstContact: new Date().toISOString(),
        lastContact: new Date().toISOString(),
        messageCount: 0,
        avgResponseTime: 0,
        preferredTone: 'neutral',
        commonTopics: [],
        satisfactionScore: 0.5,
        escalationHistory: [],
        tags: []
      });
    }
    return this.customerProfiles.get(chatId);
  }

  updateCustomerProfile(chatId, message, sentimentTrend) {
    const profile = this.getOrCreateProfile(chatId);
    
    profile.lastContact = new Date().toISOString();
    profile.messageCount++;
    
    if (sentimentTrend.average > 0.6) {
      profile.preferredTone = 'friendly';
    } else if (sentimentTrend.average < 0.4) {
      profile.preferredTone = 'formal';
    }
    
    profile.satisfactionScore = profile.satisfactionScore * 0.8 + sentimentTrend.average * 0.2;
    
    this.saveProfiles();
    return profile;
  }

  analyzeConversationFlow(chatId, messages) {
    const stages = messages.map(msg => this.classifyMessageStage(msg));
    const currentStage = stages[stages.length - 1] || 'unknown';
    const flowPattern = this.detectFlowPattern(stages);
    
    return {
      stages,
      currentStage,
      flowPattern,
      predictedNextStage: this.predictNextStage(stages, flowPattern),
      flowHealth: this.assessFlowHealth(stages)
    };
  }

  classifyMessageStage(message) {
    const text = (message.body || message.text || message.content || '').toLowerCase();
    
    if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|hey|hello)/i.test(text)) {
      return 'greeting';
    }
    if (/(\?|como|qual|quando|onde|por que|quanto)/i.test(text)) {
      return 'question';
    }
    if (/(problema|erro|não funciona|reclamação|insatisfeito|péssimo)/i.test(text)) {
      return 'complaint';
    }
    if (/(obrigado|obrigada|valeu|agradeço|thanks)/i.test(text)) {
      return 'thanks';
    }
    if (/(desculpa|desculpe|perdão|sentimos)/i.test(text)) {
      return 'apology';
    }
    if (/(preço|valor|quanto custa|promoção|desconto)/i.test(text)) {
      return 'price_inquiry';
    }
    if (/(produto|serviço|funcionalidade|recurso)/i.test(text)) {
      return 'product_inquiry';
    }
    if (/(resolvido|funcionou|consegui|deu certo)/i.test(text)) {
      return 'resolution';
    }
    
    return 'general';
  }

  detectFlowPattern(stages) {
    const recentStages = stages.slice(-5);
    
    for (const flow of this.commonFlowPatterns) {
      let matchIndex = 0;
      for (const stage of recentStages) {
        if (stage === flow.pattern[matchIndex]) {
          matchIndex++;
          if (matchIndex === flow.pattern.length) {
            return flow.name;
          }
        }
      }
    }
    
    return 'custom';
  }

  predictNextStage(stages, flowPattern) {
    const flow = this.commonFlowPatterns.find(f => f.name === flowPattern);
    if (!flow) return 'unknown';
    
    const currentIndex = stages.length % flow.pattern.length;
    return flow.pattern[currentIndex] || 'resolution';
  }

  assessFlowHealth(stages) {
    const hasGreeting = stages.includes('greeting');
    const hasComplaint = stages.includes('complaint');
    const hasResolution = stages.includes('resolution');
    const hasThanks = stages.includes('thanks');
    
    let health = 0.5;
    if (hasGreeting) health += 0.1;
    if (hasComplaint && !hasResolution) health -= 0.2;
    if (hasResolution) health += 0.2;
    if (hasThanks) health += 0.2;
    
    return Math.max(0, Math.min(1, health));
  }

  analyzeSentimentTrend(messages) {
    if (messages.length === 0) {
      return { values: [], average: 0.5, trend: 'neutral', volatility: 0, hasHostile: false };
    }

    const sentiments = messages.map(msg => 
      this.analyzeSentiment(msg.body || msg.text || msg.content || '')
    );
    
    // Extrair scores e verificar hostilidade
    const values = sentiments.map(s => typeof s === 'object' ? s.score : s);
    const hasHostile = sentiments.some(s => s && s.isHostile);
    
    const average = values.reduce((a, b) => a + b, 0) / values.length;
    
    let trend = 'stable';
    if (values.length >= 3) {
      const recent = values.slice(-3);
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg = values.slice(0, -3).reduce((a, b) => a + b, 0) / Math.max(1, values.length - 3);
      
      if (recentAvg > olderAvg + 0.1) trend = 'improving';
      else if (recentAvg < olderAvg - 0.1) trend = 'declining';
    }

    const volatility = this.calculateVolatility(values);

    return { values, average, trend, volatility, hasHostile };
  }

  /**
   * CORREÇÃO P2: Análise de sentimento via LLM quando disponível.
   * Fallback para léxico expandido com pontuação ponderada (sem CAPS LOCK como heurística).
   * O LLM lida com ironia, gírias regionais e compostos — o léxico não consegue.
   *
   * FIX: era hardcoded em OpenAI mesmo quando o tenant só tinha Anthropic ou Groq.
   * Agora usa AIRouter (singleton compartilhado) com fallback automático.
   */
  async analyzeSentimentAsync(text, options = {}) {
    if (!text) return { score: 0.5, isHostile: false, label: 'neutral', source: 'default' };

    // FIX: detecta qualquer provider configurado (não só OpenAI)
    const hasProvider = !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY);
    if (hasProvider && !options.skipLLM) {
      try {
        const result = await this._analyzeSentimentLLM(text, options);
        if (result) return { ...result, source: 'llm' };
      } catch (e) {
        // fallback para léxico
      }
    }

    return { ...this.analyzeSentiment(text), source: 'lexicon' };
  }

  async _analyzeSentimentLLM(text, options = {}) {
    const truncated = text.slice(0, 300);
    const prompt = `Analise o sentimento desta mensagem em português brasileiro.
Responda APENAS com JSON: {"score": 0.0-1.0, "isHostile": true/false, "label": "positive|negative|neutral|hostile", "explanation": "1 frase"}
Score: 1.0=muito positivo, 0.5=neutro, 0.0=muito negativo. Detecte ironia e gírias.
Mensagem: "${truncated}"`;

    // FIX HIGH: usa AIRouter com fallback (Anthropic/Groq) em vez de chamar OpenAI direto.
    // Bug anterior: linha 240 aceitava ANTHROPIC_API_KEY como suficiente, mas linha 263 enviava
    // como Bearer Authorization para api.openai.com → 401 garantido em tenants Anthropic-only.
    try {
      const AIRouter = require('../AIRouterService');
      const result = await AIRouter.complete([
        { role: 'user', content: prompt }
      ], {
        maxTokens: 100,
        temperature: 0,
        tenantId: options.tenantId,
      });
      const raw = (result.content || result.text || '').trim();
      if (!raw) return null;
      const clean = raw.replace(/```json|```/g, '').trim();
      return JSON.parse(clean);
    } catch (e) {
      return null;
    }
  }

  /**
   * Versão síncrona com léxico expandido — usada como fallback do LLM.
   * CORREÇÃO P2: Removido CAPS LOCK como intensificador (frágil e enganável).
   */
  analyzeSentiment(text) {
    if (!text) return { score: 0.5, isHostile: false, label: 'neutral' };
    const lowerText = text.toLowerCase();

    // Léxico expandido com pesos (positivo > 0, negativo < 0) — Sem CAPS LOCK heuristic (Correção P2.2)
    const lexicon = {
      // Altamente positivos
      'ótimo': 0.2, 'excelente': 0.25, 'perfeito': 0.25, 'maravilhoso': 0.25,
      'adorei': 0.2, 'amei': 0.2, 'incrível': 0.2, 'parabéns': 0.15,
      'obrigado': 0.1, 'obrigada': 0.1, 'satisfeito': 0.15, 'feliz': 0.15,
      'top': 0.1, 'show': 0.1, 'demais': 0.1, 'massa': 0.1, 'bom': 0.1,
      'legal': 0.1, 'gostei': 0.15, 'recomendo': 0.2, 'voltarei': 0.15,
      // Negativos
      'péssimo': -0.25, 'horrível': -0.25, 'terrível': -0.25, 'problema': -0.1,
      'erro': -0.1, 'falha': -0.1, 'ruim': -0.15, 'insatisfeito': -0.2,
      'decepcionado': -0.2, 'frustrado': -0.2, 'absurdo': -0.15, 'cancelar': -0.1,
      'reclamação': -0.15, 'descaso': -0.2, 'nunca mais': -0.25, 'vergonha': -0.2,
    };

    // Palavras hostis (detectadas separadamente com peso maior)
    const hostileTerms = [
      'merda', 'bosta', 'porra', 'caralho', 'fdp', 'pqp', 'vsf', 'idiota',
      'imbecil', 'estúpido', 'otário', 'babaca', 'vai se foder', 'foda-se',
      'filho da puta', 'lixo humano', 'some daqui', 'cala boca',
    ];

    let score = 0.5;
    let isHostile = false;

    for (const term of hostileTerms) {
      if (lowerText.includes(term)) { score -= 0.3; isHostile = true; break; }
    }

    for (const [word, weight] of Object.entries(lexicon)) {
      if (lowerText.includes(word)) score += weight;
    }

    score = Math.max(0, Math.min(1, score));
    return {
      score,
      isHostile,
      label: isHostile ? 'hostile' : score > 0.6 ? 'positive' : score < 0.4 ? 'negative' : 'neutral',
      advice: isHostile ? 'Responda de forma profissional e calma, sem reagir aos insultos.' : null,
    };
  }

  calculateVolatility(values) {
    if (values.length < 2) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    
    return Math.sqrt(variance);
  }

  detectUrgency(currentMessage, messages) {
    const text = (currentMessage?.body || currentMessage?.text || currentMessage?.content || '').toLowerCase();
    
    const urgentKeywords = [
      'urgente', 'urgência', 'emergência', 'imediato', 'agora', 'já',
      'não pode esperar', 'crítico', 'importante', 'prazo', 'deadline',
      'socorro', 'help', 'asap'
    ];
    
    let urgency = 0;
    
    urgentKeywords.forEach(keyword => {
      if (text.includes(keyword)) urgency += 0.2;
    });
    
    if (text === text.toUpperCase() && text.length > 10) urgency += 0.15;
    
    const exclamations = (text.match(/!/g) || []).length;
    const questions = (text.match(/\?/g) || []).length;
    if (exclamations > 2) urgency += 0.1;
    if (questions > 2) urgency += 0.1;
    
    const complaints = messages.filter(m => 
      this.classifyMessageStage(m) === 'complaint'
    ).length;
    if (complaints > 2) urgency += 0.15;
    
    return Math.min(1, urgency);
  }

  identifyTopicClusters(messages) {
    const topics = new Map();
    
    const topicKeywords = {
      'pagamento': ['pagar', 'pagamento', 'boleto', 'cartão', 'pix', 'fatura'],
      'entrega': ['entrega', 'envio', 'rastreio', 'correios', 'chegou', 'prazo'],
      'produto': ['produto', 'item', 'mercadoria', 'compra', 'pedido'],
      'suporte': ['problema', 'erro', 'bug', 'não funciona', 'ajuda', 'suporte'],
      'vendas': ['preço', 'valor', 'desconto', 'promoção', 'comprar', 'orçamento'],
      'cadastro': ['cadastro', 'senha', 'login', 'conta', 'email', 'acesso']
    };
    
    messages.forEach(msg => {
      const text = (msg.body || msg.text || msg.content || '').toLowerCase();
      
      Object.entries(topicKeywords).forEach(([topic, keywords]) => {
        keywords.forEach(keyword => {
          if (text.includes(keyword)) {
            topics.set(topic, (topics.get(topic) || 0) + 1);
          }
        });
      });
    });
    
    return Array.from(topics.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([topic, count]) => ({ topic, count, percentage: count / Math.max(1, messages.length) }));
  }

  recommendTone(profile, sentimentTrend) {
    // PRIORIDADE: Hostilidade detectada
    if (sentimentTrend.hasHostile) {
      return {
        tone: 'calm_professional',
        advice: 'O cliente está usando linguagem hostil. Responda de forma calma e profissional, sem reagir às provocações.',
        suggestions: [
          'Manter a calma e não levar para o lado pessoal',
          'Focar na solução do problema',
          'Usar frases empáticas como "Entendo sua frustração..."',
          'Evitar respostas passivo-agressivas'
        ]
      };
    }
    
    if (sentimentTrend.average < 0.3 || sentimentTrend.trend === 'declining') {
      return {
        tone: 'empathetic_formal',
        advice: 'Cliente insatisfeito. Use tom empático e formal.',
        suggestions: ['Demonstrar compreensão', 'Oferecer solução concreta']
      };
    }
    if (profile.preferredTone === 'friendly' && sentimentTrend.average > 0.5) {
      return {
        tone: 'friendly_casual',
        advice: 'Cliente satisfeito e receptivo.',
        suggestions: ['Manter tom amigável', 'Pode usar emojis com moderação']
      };
    }
    if (profile.messageCount > 10) {
      return {
        tone: 'familiar_professional',
        advice: 'Cliente recorrente.',
        suggestions: ['Mostrar familiaridade', 'Referenciar interações anteriores']
      };
    }
    return {
      tone: 'professional_neutral',
      advice: 'Manter tom profissional padrão.',
      suggestions: ['Ser claro e objetivo']
    };
  }

  suggestApproach(flowAnalysis, urgencyLevel) {
    if (urgencyLevel > 0.7) {
      return {
        approach: 'immediate_action',
        priority: 'high',
        actions: ['Respond immediately', 'Offer quick solution', 'Consider escalation']
      };
    }
    
    if (flowAnalysis.currentStage === 'complaint') {
      return {
        approach: 'empathetic_resolution',
        priority: 'high',
        actions: ['Show empathy', 'Acknowledge problem', 'Present solution']
      };
    }
    
    if (flowAnalysis.flowPattern === 'sales_lead') {
      return {
        approach: 'consultative_selling',
        priority: 'medium',
        actions: ['Identify needs', 'Present benefits', 'Create opportunity sense']
      };
    }
    
    return {
      approach: 'standard_support',
      priority: 'normal',
      actions: ['Respond objectively', 'Offer additional help']
    };
  }

  generateContextSummary(profile, flowAnalysis, sentimentTrend) {
    const isReturning = profile.messageCount > 1;
    const satisfaction = profile.satisfactionScore > 0.6 ? 'satisfied' : 
                        profile.satisfactionScore < 0.4 ? 'unsatisfied' : 'neutral';
    
    return {
      customerType: isReturning ? 'returning' : 'new',
      interactionCount: profile.messageCount,
      currentMood: sentimentTrend.average > 0.6 ? 'positive' : 
                   sentimentTrend.average < 0.4 ? 'negative' : 'neutral',
      conversationStage: flowAnalysis.currentStage,
      satisfaction,
      recommendation: this.recommendTone(profile, sentimentTrend)
    };
  }

  getCustomerProfile(chatId) {
    return this.customerProfiles.get(chatId) || null;
  }

  getAllProfiles() {
    return Array.from(this.customerProfiles.values());
  }
}

// ============================================================
// INTELLIGENT PRIORITY QUEUE
// ============================================================

module.exports = AdvancedContextAnalyzer;
