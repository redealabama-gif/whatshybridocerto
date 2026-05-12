/**
 * 🧠 CopilotEngine - Motor principal do assistente de IA
 * WhatsHybrid Pro v7.1.0
 * 
 * Features:
 * - Intent detection
 * - Sentiment analysis
 * - Smart replies generation
 * - Context-aware responses
 * - Lead scoring
 * - Entity extraction
 */

const AIRouter = require('../services/AIRouterService');
const logger = require('../../utils/logger');

// Intent types
const INTENTS = {
  GREETING: 'greeting',
  QUESTION: 'question',
  PURCHASE: 'purchase',
  SUPPORT: 'support',
  COMPLAINT: 'complaint',
  SCHEDULE: 'schedule',
  PRICING: 'pricing',
  FEEDBACK: 'feedback',
  GOODBYE: 'goodbye',
  UNKNOWN: 'unknown'
};

// Sentiment labels
const SENTIMENTS = {
  POSITIVE: 'positive',
  NEUTRAL: 'neutral',
  NEGATIVE: 'negative'
};

// Personas
const PERSONAS = {
  professional: {
    id: 'professional',
    name: 'Profissional',
    description: 'Formal e objetivo',
    systemPrompt: 'Você é um assistente profissional. Seja formal, objetivo e direto nas respostas. Use linguagem corporativa.'
  },
  friendly: {
    id: 'friendly',
    name: 'Amigável',
    description: 'Descontraído e simpático',
    systemPrompt: 'Você é um assistente amigável e simpático. Use linguagem informal, emojis ocasionalmente, e seja caloroso nas interações.'
  },
  sales: {
    id: 'sales',
    name: 'Vendas',
    description: 'Persuasivo e orientado a resultados',
    systemPrompt: 'Você é um vendedor experiente. Destaque benefícios, crie urgência quando apropriado, e sempre busque fechar a venda ou agendar próximos passos.'
  },
  support: {
    id: 'support',
    name: 'Suporte',
    description: 'Técnico e solucionador',
    systemPrompt: 'Você é um especialista em suporte técnico. Seja paciente, faça perguntas de diagnóstico, e forneça soluções claras passo a passo.'
  },
  concierge: {
    id: 'concierge',
    name: 'Concierge',
    description: 'Premium e exclusivo',
    systemPrompt: 'Você é um concierge de luxo. Trate cada cliente como VIP, antecipe necessidades, e ofereça um atendimento impecável e personalizado.'
  },
  coach: {
    id: 'coach',
    name: 'Coach',
    description: 'Motivador e inspirador',
    systemPrompt: 'Você é um coach motivacional. Incentive o cliente, celebre conquistas, e ajude a superar objeções com entusiasmo.'
  }
};

class CopilotEngine {
  constructor(config = {}) {
    this.config = config;
    this.router = config.router || AIRouter;
    this.activePersona = PERSONAS.professional;
    this.knowledgeBase = [];
    
    // Default system prompt
    this.baseSystemPrompt = `Você é um assistente de atendimento ao cliente via WhatsApp para a empresa.
    
    Regras:
    - Seja conciso (mensagens curtas e diretas)
    - Use português brasileiro natural
    - Não use markdown ou formatação especial
    - Adapte o tom conforme a conversa
    - Se não souber algo, admita e ofereça alternativas
    - Sempre busque resolver a dúvida do cliente`;

    logger.info('[CopilotEngine] ✅ Initialized');
  }

  /**
   * Set active persona
   */
  setPersona(personaId) {
    const persona = PERSONAS[personaId];
    if (persona) {
      this.activePersona = persona;
      return true;
    }
    return false;
  }

  /**
   * Get available personas
   */
  getPersonas() {
    return Object.values(PERSONAS);
  }

  /**
   * Add to knowledge base
   */
  addKnowledge(item) {
    this.knowledgeBase.push({
      ...item,
      addedAt: new Date()
    });
  }

  /**
   * Search knowledge base
   */
  searchKnowledge(query) {
    const queryLower = query.toLowerCase();
    return this.knowledgeBase.filter(item => {
      const searchText = `${item.question || ''} ${item.answer || ''} ${item.content || ''}`.toLowerCase();
      return queryLower.split(' ').some(word => searchText.includes(word));
    });
  }

  /**
   * Analyze message - Intent + Sentiment + Entities
   */
  async analyze(message, context = {}) {
    const prompt = `Analise a seguinte mensagem de cliente e retorne um JSON com:
{
  "intent": "greeting|question|purchase|support|complaint|schedule|pricing|feedback|goodbye|unknown",
  "sentiment": "positive|neutral|negative",
  "sentimentScore": -1 to 1,
  "confidence": 0 to 1,
  "entities": {
    "phones": [],
    "emails": [],
    "dates": [],
    "money": [],
    "products": [],
    "names": []
  },
  "urgency": "low|medium|high",
  "summary": "resumo breve da mensagem"
}

Mensagem: "${message}"

Retorne APENAS o JSON, sem explicações.`;

    try {
      const result = await this.router.complete([
        { role: 'user', content: prompt }
      ], {
        model: 'gpt-4o-mini',
        temperature: 0.1,
        maxTokens: 500
      });

      // Parse JSON from response
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);
        return {
          ...analysis,
          provider: result.provider,
          latency: result.latency
        };
      }
      
      // Fallback local analysis
      return this.localAnalyze(message);
    } catch (error) {
      logger.error('[CopilotEngine] Analysis error:', error.message);
      return this.localAnalyze(message);
    }
  }

  /**
   * Local analysis fallback (no AI)
   */
  localAnalyze(message) {
    const lowerMsg = message.toLowerCase();
    
    // Intent detection
    let intent = INTENTS.UNKNOWN;
    if (/^(oi|olá|bom dia|boa tarde|boa noite|e aí|hey|hello)/i.test(message)) {
      intent = INTENTS.GREETING;
    } else if (/\?|como|quando|onde|qual|quanto|por que|quem/i.test(message)) {
      intent = INTENTS.QUESTION;
    } else if (/comprar|adquirir|contratar|assinar|quero|preciso/i.test(message)) {
      intent = INTENTS.PURCHASE;
    } else if (/preço|valor|custo|quanto custa|tabela/i.test(message)) {
      intent = INTENTS.PRICING;
    } else if (/problema|erro|não funciona|bug|defeito|quebr/i.test(message)) {
      intent = INTENTS.SUPPORT;
    } else if (/reclamar|péssimo|horrível|absurdo|inaceitável/i.test(message)) {
      intent = INTENTS.COMPLAINT;
    } else if (/agendar|marcar|reservar|horário|disponibilidade/i.test(message)) {
      intent = INTENTS.SCHEDULE;
    } else if (/tchau|até mais|obrigado|valeu|até logo/i.test(message)) {
      intent = INTENTS.GOODBYE;
    }

    // Sentiment detection
    let sentiment = SENTIMENTS.NEUTRAL;
    let sentimentScore = 0;
    
    const positiveWords = /obrigado|ótimo|excelente|perfeito|adorei|maravilh|top|show|amei|parabéns/i;
    const negativeWords = /problema|ruim|péssimo|horrível|raiva|absurdo|decepcion|insatisf/i;
    
    if (positiveWords.test(message)) {
      sentiment = SENTIMENTS.POSITIVE;
      sentimentScore = 0.7;
    } else if (negativeWords.test(message)) {
      sentiment = SENTIMENTS.NEGATIVE;
      sentimentScore = -0.7;
    }

    // Entity extraction
    const entities = {
      phones: message.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-\s]?\d{4}/g) || [],
      emails: message.match(/[^\s@]+@[^\s@]+\.[^\s@]+/g) || [],
      dates: message.match(/\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?/g) || [],
      money: message.match(/R\$\s?[\d.,]+/g) || [],
      products: [],
      names: []
    };

    // Urgency
    let urgency = 'low';
    if (/urgente|agora|imediato|emergência|socorro/i.test(message)) {
      urgency = 'high';
    } else if (/hoje|amanhã|logo|rápido/i.test(message)) {
      urgency = 'medium';
    }

    return {
      intent,
      sentiment,
      sentimentScore,
      confidence: 0.6,
      entities,
      urgency,
      summary: message.substring(0, 100),
      local: true
    };
  }

  /**
   * Generate smart reply suggestions
   */
  async generateReplies(message, context = {}, count = 3) {
    const analysis = await this.analyze(message, context);
    
    // Build context prompt
    const contextInfo = [];
    if (context.contactName) contextInfo.push(`Nome do cliente: ${context.contactName}`);
    if (context.contactStage) contextInfo.push(`Estágio no funil: ${context.contactStage}`);
    if (context.history?.length) contextInfo.push(`Histórico: ${context.history.slice(-3).map(m => m.content).join(' | ')}`);
    
    // Search knowledge base
    const knowledge = this.searchKnowledge(message);
    if (knowledge.length > 0) {
      contextInfo.push(`Informações relevantes: ${knowledge.slice(0, 2).map(k => k.answer || k.content).join(' ')}`);
    }

    const prompt = `${this.baseSystemPrompt}

${this.activePersona.systemPrompt}

${contextInfo.length > 0 ? `Contexto:\n${contextInfo.join('\n')}` : ''}

Análise da mensagem:
- Intenção: ${analysis.intent}
- Sentimento: ${analysis.sentiment}
- Urgência: ${analysis.urgency}

Mensagem do cliente: "${message}"

Gere ${count} opções de resposta diferentes, variando o tom e abordagem.
Retorne um JSON assim:
{
  "replies": [
    {"text": "resposta 1", "tone": "formal/informal/empático"},
    {"text": "resposta 2", "tone": "..."},
    {"text": "resposta 3", "tone": "..."}
  ]
}

IMPORTANTE: Respostas curtas (máximo 2 linhas), naturais e prontas para enviar.`;

    try {
      const result = await this.router.complete([
        { role: 'user', content: prompt }
      ], {
        temperature: 0.8,
        maxTokens: 1000
      });

      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          replies: parsed.replies || [],
          analysis,
          provider: result.provider,
          latency: result.latency
        };
      }

      return { replies: [], analysis };
    } catch (error) {
      logger.error('[CopilotEngine] Generate replies error:', error.message);
      
      // Fallback to template-based replies
      return {
        replies: this.getTemplateReplies(analysis),
        analysis,
        fallback: true
      };
    }
  }

  /**
   * Template-based replies fallback
   */
  getTemplateReplies(analysis) {
    const templates = {
      [INTENTS.GREETING]: [
        { text: 'Olá! Como posso ajudar você hoje?', tone: 'formal' },
        { text: 'Oi! Tudo bem? Em que posso te ajudar? 😊', tone: 'informal' },
        { text: 'Olá, seja bem-vindo! Estou à disposição.', tone: 'empático' }
      ],
      [INTENTS.QUESTION]: [
        { text: 'Claro, vou te ajudar com essa dúvida!', tone: 'formal' },
        { text: 'Boa pergunta! Deixa eu te explicar...', tone: 'informal' },
        { text: 'Entendi sua dúvida. Veja bem...', tone: 'empático' }
      ],
      [INTENTS.PRICING]: [
        { text: 'Vou te passar todas as informações sobre valores.', tone: 'formal' },
        { text: 'Ótimo interesse! Nossos preços são bem competitivos.', tone: 'informal' },
        { text: 'Com prazer compartilho nossa tabela de preços!', tone: 'empático' }
      ],
      [INTENTS.COMPLAINT]: [
        { text: 'Lamento muito por essa situação. Vamos resolver isso agora.', tone: 'empático' },
        { text: 'Peço desculpas pelo inconveniente. Já estou verificando.', tone: 'formal' },
        { text: 'Entendo sua frustração. Vou priorizar seu caso.', tone: 'empático' }
      ],
      [INTENTS.GOODBYE]: [
        { text: 'Até mais! Qualquer dúvida, estou à disposição.', tone: 'formal' },
        { text: 'Valeu! Foi um prazer ajudar! 👋', tone: 'informal' },
        { text: 'Obrigado pelo contato! Volte sempre.', tone: 'empático' }
      ]
    };

    return templates[analysis.intent] || templates[INTENTS.QUESTION];
  }

  /**
   * Lead scoring based on conversation
   */
  async scoreContact(messages, contactData = {}) {
    const prompt = `Analise a conversa e dados do contato para calcular um lead score de 0 a 100.

Dados do contato:
${JSON.stringify(contactData, null, 2)}

Últimas mensagens:
${messages.slice(-10).map(m => `${m.fromMe ? 'Atendente' : 'Cliente'}: ${m.content}`).join('\n')}

Critérios:
- Interesse demonstrado (perguntas sobre produto/preço)
- Urgência (palavras como "urgente", "agora", "hoje")
- Engajamento (respostas rápidas, perguntas detalhadas)
- Objeções (resistência, pedido de desconto)
- Estágio (primeiro contato, negociação, fechamento)

Retorne JSON:
{
  "score": 0-100,
  "factors": {
    "interest": 0-100,
    "urgency": 0-100,
    "engagement": 0-100,
    "readiness": 0-100
  },
  "recommendation": "ação recomendada",
  "nextStep": "próximo passo sugerido"
}`;

    try {
      const result = await this.router.complete([
        { role: 'user', content: prompt }
      ], {
        temperature: 0.3,
        maxTokens: 500
      });

      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      return { score: 50, factors: {}, recommendation: 'Continuar qualificação' };
    } catch (error) {
      logger.error('[CopilotEngine] Scoring error:', error.message);
      return { score: 50, factors: {}, error: error.message };
    }
  }

  /**
   * Summarize conversation
   */
  async summarize(messages) {
    if (messages.length < 3) {
      return { summary: 'Conversa muito curta para resumir.' };
    }

    const prompt = `Resuma a seguinte conversa de WhatsApp de forma concisa:

${messages.map(m => `${m.fromMe ? 'Atendente' : 'Cliente'}: ${m.content}`).join('\n')}

Retorne JSON:
{
  "summary": "resumo em 2-3 linhas",
  "mainTopic": "assunto principal",
  "status": "resolvido|pendente|em_andamento",
  "actionItems": ["itens de ação se houver"]
}`;

    try {
      const result = await this.router.complete([
        { role: 'user', content: prompt }
      ], {
        temperature: 0.3,
        maxTokens: 300
      });

      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      return { summary: 'Não foi possível gerar resumo.' };
    } catch (error) {
      logger.error('[CopilotEngine] Summary error:', error.message);
      return { summary: 'Erro ao gerar resumo.', error: error.message };
    }
  }

  /**
   * Translate message
   */
  async translate(text, targetLang = 'pt-BR') {
    const prompt = `Traduza o seguinte texto para ${targetLang}. 
Mantenha o tom e significado original.
Se já estiver no idioma alvo, retorne o texto original.

Texto: "${text}"

Retorne apenas a tradução, sem explicações.`;

    try {
      const result = await this.router.complete([
        { role: 'user', content: prompt }
      ], {
        temperature: 0.3,
        maxTokens: 500
      });

      return {
        translation: result.content.trim(),
        provider: result.provider
      };
    } catch (error) {
      return { translation: text, error: error.message };
    }
  }

  /**
   * Correct grammar and spelling
   */
  async correct(text) {
    const prompt = `Corrija erros de gramática e ortografia no texto abaixo.
Mantenha o sentido original e o tom informal se houver.
Se não houver erros, retorne o texto original.

Texto: "${text}"

Retorne apenas o texto corrigido.`;

    try {
      const result = await this.router.complete([
        { role: 'user', content: prompt }
      ], {
        temperature: 0.1,
        maxTokens: 500
      });

      return {
        corrected: result.content.trim(),
        provider: result.provider
      };
    } catch (error) {
      return { corrected: text, error: error.message };
    }
  }
}

// Export singleton factory and class (evita inicialização sem config)
let instance = null;

function getInstance(config = {}) {
  if (!instance) {
    instance = new CopilotEngine(config);
  }
  return instance;
}

module.exports = {
  getInstance,
  CopilotEngine,
  INTENTS,
  SENTIMENTS,
  PERSONAS
};
