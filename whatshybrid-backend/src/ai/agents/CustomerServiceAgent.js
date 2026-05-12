/**
 * 🤖 CustomerServiceAgent - Agente de Atendimento Autônomo
 * WhatsHybrid Pro v7.1.0
 * 
 * Agente que pode responder automaticamente a clientes
 * com base em FAQs, contexto e regras de negócio
 */

const AIRouter = require('../services/AIRouterService');
const logger = require('../../utils/logger');
const PromptManager = require('../prompts/PromptManager');

// Agent states
const AGENT_STATE = {
  IDLE: 'idle',
  GREETING: 'greeting',
  QUALIFYING: 'qualifying',
  ANSWERING: 'answering',
  ESCALATING: 'escalating',
  CLOSING: 'closing'
};

// Triggers for agent activation
const TRIGGERS = {
  OUT_OF_HOURS: 'out_of_hours',
  FIRST_MESSAGE: 'first_message',
  KEYWORD_MATCH: 'keyword_match',
  MANUAL: 'manual'
};

class CustomerServiceAgent {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      maxTurns: config.maxTurns || 5, // Max turns before escalation
      responseTimeout: config.responseTimeout || 30000, // 30 seconds
      escalationKeywords: config.escalationKeywords || ['falar com humano', 'atendente', 'gerente', 'reclamação'],
      greetingMessage: config.greetingMessage || 'Olá! Sou o assistente virtual. Como posso ajudar?',
      escalationMessage: config.escalationMessage || 'Vou transferir você para um de nossos atendentes. Aguarde um momento!',
      closingMessage: config.closingMessage || 'Foi um prazer ajudar! Se precisar de mais alguma coisa, é só chamar.',
      businessHours: config.businessHours || { start: 8, end: 18 },
      timezone: config.timezone || 'America/Sao_Paulo',
      ...config
    };

    this.router = config.router || AIRouter;
    this.promptManager = config.promptManager || PromptManager;
    this.knowledgeBase = config.knowledgeBase || [];
    
    // Active conversations
    this.conversations = new Map();
    
    // Stats
    this.stats = {
      totalConversations: 0,
      messagesHandled: 0,
      escalations: 0,
      resolvedAutonomously: 0,
      averageResponseTime: 0
    };

    logger.info('[CustomerServiceAgent] ✅ Initialized');
  }

  /**
   * Check if currently within business hours
   */
  isWithinBusinessHours() {
    const now = new Date();
    const hour = now.getHours();
    return hour >= this.config.businessHours.start && hour < this.config.businessHours.end;
  }

  /**
   * Check if agent should handle this message
   */
  shouldHandle(message, context = {}) {
    if (!this.config.enabled) return false;

    // Check triggers
    if (context.trigger === TRIGGERS.MANUAL) return true;
    if (context.trigger === TRIGGERS.OUT_OF_HOURS && !this.isWithinBusinessHours()) return true;
    if (context.trigger === TRIGGERS.FIRST_MESSAGE && context.isFirstMessage) return true;
    
    // Keyword trigger
    if (this.config.triggerKeywords) {
      const lowerMessage = message.toLowerCase();
      const hasKeyword = this.config.triggerKeywords.some(kw => lowerMessage.includes(kw.toLowerCase()));
      if (hasKeyword) return true;
    }

    return false;
  }

  /**
   * Check if should escalate to human
   */
  shouldEscalate(message, conversation) {
    // Check escalation keywords
    const lowerMessage = message.toLowerCase();
    const hasEscalationKeyword = this.config.escalationKeywords.some(kw => 
      lowerMessage.includes(kw.toLowerCase())
    );
    if (hasEscalationKeyword) return true;

    // Check max turns
    if (conversation.turns >= this.config.maxTurns) return true;

    // Check sentiment - escalate on very negative
    if (conversation.lastSentiment === 'negative' && conversation.negativeCount >= 2) return true;

    return false;
  }

  /**
   * Get or create conversation context
   */
  getConversation(contactId) {
    if (!this.conversations.has(contactId)) {
      this.conversations.set(contactId, {
        contactId,
        state: AGENT_STATE.IDLE,
        turns: 0,
        messages: [],
        startedAt: new Date(),
        lastMessageAt: new Date(),
        lastSentiment: 'neutral',
        negativeCount: 0,
        context: {}
      });
      this.stats.totalConversations++;
    }
    return this.conversations.get(contactId);
  }

  /**
   * Update conversation state
   */
  updateConversation(contactId, updates) {
    const conv = this.getConversation(contactId);
    Object.assign(conv, updates, { lastMessageAt: new Date() });
    return conv;
  }

  /**
   * End conversation
   */
  endConversation(contactId, reason = 'completed') {
    const conv = this.conversations.get(contactId);
    if (conv) {
      if (reason === 'resolved') {
        this.stats.resolvedAutonomously++;
      } else if (reason === 'escalated') {
        this.stats.escalations++;
      }
      this.conversations.delete(contactId);
    }
    return conv;
  }

  /**
   * Process incoming message
   */
  async processMessage(contactId, message, context = {}) {
    const startTime = Date.now();
    const conversation = this.getConversation(contactId);
    
    // Update conversation
    conversation.turns++;
    conversation.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date()
    });
    
    this.stats.messagesHandled++;

    try {
      // Check for escalation
      if (this.shouldEscalate(message, conversation)) {
        conversation.state = AGENT_STATE.ESCALATING;
        this.endConversation(contactId, 'escalated');
        
        return {
          response: this.config.escalationMessage,
          action: 'escalate',
          reason: 'Escalation triggered'
        };
      }

      // Analyze message
      const analysis = await this.analyzeMessage(message);
      
      // Update sentiment tracking
      conversation.lastSentiment = analysis.sentiment;
      if (analysis.sentiment === 'negative') {
        conversation.negativeCount++;
      }

      // Generate response based on state and intent
      let response;
      let action = 'respond';

      switch (analysis.intent) {
        case 'greeting':
          response = await this.handleGreeting(conversation, context);
          break;
        
        case 'question':
        case 'support':
          response = await this.handleQuestion(message, conversation, context);
          break;
        
        case 'pricing':
          response = await this.handlePricing(message, conversation, context);
          break;
        
        case 'complaint':
          response = await this.handleComplaint(message, conversation, context);
          // Auto-escalate complaints
          if (conversation.negativeCount >= 1) {
            action = 'escalate';
            response += '\n\n' + this.config.escalationMessage;
            this.endConversation(contactId, 'escalated');
          }
          break;
        
        case 'goodbye':
          response = this.config.closingMessage;
          action = 'close';
          this.endConversation(contactId, 'resolved');
          break;
        
        default:
          response = await this.generateGenericResponse(message, conversation, context);
      }

      // Add response to conversation
      conversation.messages.push({
        role: 'assistant',
        content: response,
        timestamp: new Date()
      });

      // Update stats
      const responseTime = Date.now() - startTime;
      this.stats.averageResponseTime = 
        (this.stats.averageResponseTime * (this.stats.messagesHandled - 1) + responseTime) / this.stats.messagesHandled;

      return {
        response,
        action,
        analysis,
        conversation: {
          id: contactId,
          turns: conversation.turns,
          state: conversation.state
        },
        responseTime
      };
    } catch (error) {
      logger.error('[CustomerServiceAgent] Error:', error);
      
      return {
        response: 'Desculpe, tive um problema ao processar sua mensagem. Vou transferir para um atendente.',
        action: 'escalate',
        error: error.message
      };
    }
  }

  /**
   * Analyze message using AI
   */
  async analyzeMessage(message) {
    try {
      const prompt = this.promptManager.buildIntentAnalysisPrompt(message);
      
      const result = await this.router.complete([
        { role: 'user', content: prompt }
      ], {
        temperature: 0.1,
        maxTokens: 500
      });

      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      logger.warn('[CustomerServiceAgent] Analysis error:', error.message);
    }

    // Fallback to basic analysis
    return this.basicAnalysis(message);
  }

  /**
   * Basic message analysis (no AI)
   */
  basicAnalysis(message) {
    const lowerMsg = message.toLowerCase();
    
    let intent = 'unknown';
    if (/^(oi|olá|bom dia|boa tarde|boa noite|hey|hello)/i.test(message)) {
      intent = 'greeting';
    } else if (/\?|como|quando|onde|qual|quanto/i.test(message)) {
      intent = 'question';
    } else if (/preço|valor|custo|quanto custa/i.test(message)) {
      intent = 'pricing';
    } else if (/problema|reclamação|insatisf/i.test(message)) {
      intent = 'complaint';
    } else if (/tchau|obrigado|valeu/i.test(message)) {
      intent = 'goodbye';
    }

    let sentiment = 'neutral';
    if (/obrigado|ótimo|perfeito|adorei/i.test(message)) {
      sentiment = 'positive';
    } else if (/problema|ruim|péssimo|raiva/i.test(message)) {
      sentiment = 'negative';
    }

    return { intent, sentiment, confidence: 0.5 };
  }

  /**
   * Handle greeting
   */
  async handleGreeting(conversation, context) {
    conversation.state = AGENT_STATE.GREETING;
    
    const greeting = context.contactName 
      ? `Olá, ${context.contactName}! Sou o assistente virtual. Como posso ajudar você hoje?`
      : this.config.greetingMessage;
    
    return greeting;
  }

  /**
   * Handle question/support
   */
  async handleQuestion(message, conversation, context) {
    conversation.state = AGENT_STATE.ANSWERING;

    // Search knowledge base first
    const knowledge = this.searchKnowledge(message);
    
    if (knowledge.length > 0) {
      // Use FAQ answer
      const prompt = this.promptManager.render('FAQ_ANSWER', {
        question: message,
        knowledge
      });

      const result = await this.router.complete([
        { role: 'user', content: prompt }
      ], { temperature: 0.5, maxTokens: 300 });

      return result.content;
    }

    // Generate response based on context
    return this.generateGenericResponse(message, conversation, context);
  }

  /**
   * Handle pricing inquiries
   */
  async handlePricing(message, conversation, context) {
    conversation.state = AGENT_STATE.ANSWERING;

    // Check if we have pricing info
    const pricingKnowledge = this.searchKnowledge('preço valor plano');
    
    if (pricingKnowledge.length > 0) {
      const info = pricingKnowledge[0];
      return info.answer || 'Para informações detalhadas sobre preços, posso conectar você com nossa equipe de vendas. Gostaria que eu fizesse isso?';
    }

    return 'Para informações sobre preços e planos, posso conectar você com nossa equipe de vendas. Gostaria de falar com um especialista?';
  }

  /**
   * Handle complaints
   */
  async handleComplaint(message, conversation, context) {
    conversation.state = AGENT_STATE.ANSWERING;

    return `Lamento muito que você esteja passando por isso. Sua satisfação é muito importante para nós. 
Vou registrar sua situação e um de nossos especialistas entrará em contato para resolver isso da melhor forma possível.`;
  }

  /**
   * Generate generic response
   */
  async generateGenericResponse(message, conversation, context) {
    const history = conversation.messages.slice(-6); // Last 3 exchanges
    
    const prompt = this.promptManager.buildSmartReplyPrompt(message, {
      history,
      context: {
        contactName: context.contactName,
        contactStage: context.contactStage
      },
      persona: 'support',
      replyCount: 1
    });

    try {
      const result = await this.router.complete([
        { role: 'user', content: prompt }
      ], { temperature: 0.7, maxTokens: 300 });

      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.replies?.[0]?.text || result.content;
      }
      return result.content;
    } catch (error) {
      return 'Entendi sua mensagem. Como posso ajudar mais?';
    }
  }

  /**
   * Search knowledge base
   */
  searchKnowledge(query) {
    const queryLower = query.toLowerCase();
    const words = queryLower.split(/\s+/);

    return this.knowledgeBase.filter(item => {
      const text = `${item.question || ''} ${item.answer || ''} ${item.tags?.join(' ') || ''}`.toLowerCase();
      return words.some(word => text.includes(word));
    }).slice(0, 3);
  }

  /**
   * Add knowledge item
   */
  addKnowledge(item) {
    this.knowledgeBase.push({
      ...item,
      addedAt: new Date()
    });
  }

  /**
   * Set knowledge base
   */
  setKnowledgeBase(knowledge) {
    this.knowledgeBase = knowledge;
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      activeConversations: this.conversations.size,
      knowledgeBaseSize: this.knowledgeBase.length,
      autonomyRate: this.stats.totalConversations > 0 
        ? ((this.stats.resolvedAutonomously / this.stats.totalConversations) * 100).toFixed(1) + '%'
        : '0%'
    };
  }

  /**
   * Enable/disable agent
   */
  setEnabled(enabled) {
    this.config.enabled = enabled;
  }

  /**
   * Update config
   */
  updateConfig(config) {
    Object.assign(this.config, config);
  }
}

module.exports = CustomerServiceAgent;
module.exports.AGENT_STATE = AGENT_STATE;
module.exports.TRIGGERS = TRIGGERS;
