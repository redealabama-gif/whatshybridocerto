/**
 * 📝 PromptManager - Gerenciador de Prompts
 * WhatsHybrid Pro v7.1.0
 * 
 * Templates de prompts para diferentes casos de uso
 */

// Prompt templates
const PROMPT_TEMPLATES = {
  // Smart Replies
  SMART_REPLY: {
    id: 'smart_reply',
    name: 'Smart Reply',
    description: 'Gera sugestões de resposta baseadas no contexto',
    template: `Você é um assistente de atendimento ao cliente via WhatsApp.

{{#if context.companyName}}Empresa: {{context.companyName}}{{/if}}
{{#if context.contactName}}Cliente: {{context.contactName}}{{/if}}
{{#if context.contactStage}}Estágio no funil: {{context.contactStage}}{{/if}}

{{#if persona}}
Persona: {{persona.name}}
Instruções: {{persona.instructions}}
{{/if}}

Histórico recente:
{{#each history}}
{{#if this.fromMe}}Atendente{{else}}Cliente{{/if}}: {{this.content}}
{{/each}}

Última mensagem do cliente: "{{message}}"

Gere {{replyCount}} sugestões de resposta diferentes, variando o tom.
Responda em JSON:
{
  "replies": [
    {"text": "resposta", "tone": "formal/informal/empático"}
  ]
}

Regras:
- Respostas curtas (máx 2 linhas)
- Português brasileiro natural
- Sem markdown ou formatação especial
- Prontas para enviar`,
    variables: ['message', 'history', 'context', 'persona', 'replyCount'],
    defaultValues: { replyCount: 3 }
  },

  // Intent Analysis
  INTENT_ANALYSIS: {
    id: 'intent_analysis',
    name: 'Intent Analysis',
    description: 'Analisa intenção, sentimento e entidades da mensagem',
    template: `Analise a mensagem do cliente e retorne um JSON com:

{
  "intent": "greeting|question|purchase|support|complaint|schedule|pricing|feedback|goodbye|unknown",
  "sentiment": "positive|neutral|negative",
  "sentimentScore": -1 a 1,
  "confidence": 0 a 1,
  "entities": {
    "phones": [],
    "emails": [],
    "dates": [],
    "money": [],
    "products": [],
    "names": []
  },
  "urgency": "low|medium|high",
  "summary": "resumo breve"
}

Mensagem: "{{message}}"

{{#if context}}
Contexto adicional:
{{context}}
{{/if}}

Retorne APENAS o JSON, sem explicações.`,
    variables: ['message', 'context'],
    defaultValues: {}
  },

  // Lead Scoring
  LEAD_SCORING: {
    id: 'lead_scoring',
    name: 'Lead Scoring',
    description: 'Calcula score de lead baseado na conversa',
    template: `Analise a conversa e dados do contato para calcular um lead score de 0 a 100.

Dados do contato:
{{contactData}}

Últimas mensagens:
{{#each messages}}
{{#if this.fromMe}}Atendente{{else}}Cliente{{/if}}: {{this.content}}
{{/each}}

Critérios de scoring:
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
}`,
    variables: ['messages', 'contactData'],
    defaultValues: {}
  },

  // Conversation Summary
  CONVERSATION_SUMMARY: {
    id: 'conversation_summary',
    name: 'Conversation Summary',
    description: 'Resume uma conversa',
    template: `Resuma a seguinte conversa de WhatsApp de forma concisa:

{{#each messages}}
{{#if this.fromMe}}Atendente{{else}}Cliente{{/if}}: {{this.content}}
{{/each}}

Retorne JSON:
{
  "summary": "resumo em 2-3 linhas",
  "mainTopic": "assunto principal",
  "status": "resolvido|pendente|em_andamento",
  "actionItems": ["itens de ação se houver"],
  "sentiment": "positive|neutral|negative"
}`,
    variables: ['messages'],
    defaultValues: {}
  },

  // Translation
  TRANSLATION: {
    id: 'translation',
    name: 'Translation',
    description: 'Traduz texto mantendo o tom',
    template: `Traduza o seguinte texto para {{targetLanguage}}.
Mantenha o tom e significado original.
Se já estiver no idioma alvo, retorne o texto original.

Texto: "{{text}}"

Retorne apenas a tradução, sem explicações.`,
    variables: ['text', 'targetLanguage'],
    defaultValues: { targetLanguage: 'pt-BR' }
  },

  // Grammar Correction
  GRAMMAR_CORRECTION: {
    id: 'grammar_correction',
    name: 'Grammar Correction',
    description: 'Corrige gramática e ortografia',
    template: `Corrija erros de gramática e ortografia no texto abaixo.
Mantenha o sentido original e o tom informal se houver.
Se não houver erros, retorne o texto original.

Texto: "{{text}}"

Retorne apenas o texto corrigido.`,
    variables: ['text'],
    defaultValues: {}
  },

  // FAQ Answer
  FAQ_ANSWER: {
    id: 'faq_answer',
    name: 'FAQ Answer',
    description: 'Responde baseado em FAQ/knowledge base',
    template: `Você é um assistente de atendimento. Use a base de conhecimento para responder.

Base de conhecimento:
{{#each knowledge}}
Q: {{this.question}}
A: {{this.answer}}
---
{{/each}}

Pergunta do cliente: "{{question}}"

Instruções:
- Se encontrar resposta na base, use-a como referência
- Adapte a linguagem para ser natural
- Se não encontrar, informe educadamente que vai verificar
- Resposta curta e direta

Resposta:`,
    variables: ['question', 'knowledge'],
    defaultValues: {}
  },

  // Sales Pitch
  SALES_PITCH: {
    id: 'sales_pitch',
    name: 'Sales Pitch',
    description: 'Gera pitch de vendas personalizado',
    template: `Crie um pitch de vendas personalizado para o cliente.

Produto/Serviço: {{product}}
{{#if productDetails}}
Detalhes: {{productDetails}}
{{/if}}

Informações do cliente:
- Nome: {{clientName}}
- Interesse: {{interest}}
{{#if objections}}
- Objeções mencionadas: {{objections}}
{{/if}}

Tom: {{tone}}

Crie uma mensagem de vendas persuasiva mas não agressiva.
Máximo 3 linhas.
Destaque benefícios relevantes para o cliente.`,
    variables: ['product', 'productDetails', 'clientName', 'interest', 'objections', 'tone'],
    defaultValues: { tone: 'profissional mas amigável' }
  },

  // Follow Up
  FOLLOW_UP: {
    id: 'follow_up',
    name: 'Follow Up',
    description: 'Gera mensagem de follow-up',
    template: `Crie uma mensagem de follow-up para retomar contato.

Cliente: {{clientName}}
Último contato: {{lastContactDate}}
Assunto anterior: {{previousTopic}}
{{#if previousInteraction}}
Interação anterior: {{previousInteraction}}
{{/if}}

Objetivo: {{objective}}
Tom: {{tone}}

Gere uma mensagem natural para retomar o contato.
Não seja invasivo ou insistente.
Máximo 2-3 linhas.`,
    variables: ['clientName', 'lastContactDate', 'previousTopic', 'previousInteraction', 'objective', 'tone'],
    defaultValues: { tone: 'amigável e casual' }
  },

  // Objection Handling
  OBJECTION_HANDLING: {
    id: 'objection_handling',
    name: 'Objection Handling',
    description: 'Responde a objeções de vendas',
    template: `O cliente apresentou uma objeção. Ajude a contorná-la.

Objeção: "{{objection}}"
Produto: {{product}}
{{#if productBenefits}}
Benefícios: {{productBenefits}}
{{/if}}

Tipo de objeção: {{objectionType}}

Crie uma resposta que:
1. Reconheça a preocupação do cliente
2. Apresente uma perspectiva diferente ou solução
3. Retome o valor do produto/serviço
4. Convide para próximo passo

Resposta curta e natural (máx 3 linhas).`,
    variables: ['objection', 'product', 'productBenefits', 'objectionType'],
    defaultValues: { objectionType: 'preço' }
  }
};

// Personas predefinidas
const PERSONAS = {
  professional: {
    id: 'professional',
    name: 'Profissional',
    description: 'Formal e objetivo',
    instructions: 'Seja formal, objetivo e direto. Use linguagem corporativa. Evite gírias e emojis.'
  },
  friendly: {
    id: 'friendly',
    name: 'Amigável',
    description: 'Descontraído e simpático',
    instructions: 'Seja amigável e simpático. Use linguagem informal, emojis ocasionalmente. Seja caloroso.'
  },
  sales: {
    id: 'sales',
    name: 'Vendas',
    description: 'Persuasivo e orientado a resultados',
    instructions: 'Destaque benefícios, crie urgência quando apropriado. Busque fechar ou avançar para próximo passo.'
  },
  support: {
    id: 'support',
    name: 'Suporte',
    description: 'Técnico e solucionador',
    instructions: 'Seja paciente, faça perguntas de diagnóstico. Forneça soluções claras passo a passo.'
  },
  concierge: {
    id: 'concierge',
    name: 'Concierge',
    description: 'Premium e exclusivo',
    instructions: 'Trate cada cliente como VIP. Antecipe necessidades. Atendimento impecável e personalizado.'
  },
  coach: {
    id: 'coach',
    name: 'Coach',
    description: 'Motivador e inspirador',
    instructions: 'Incentive o cliente, celebre conquistas. Ajude a superar objeções com entusiasmo.'
  }
};

class PromptManager {
  constructor() {
    this.templates = { ...PROMPT_TEMPLATES };
    this.personas = { ...PERSONAS };
    this.customTemplates = new Map();
  }

  /**
   * Get template by ID
   */
  getTemplate(templateId) {
    return this.templates[templateId] || this.customTemplates.get(templateId);
  }

  /**
   * Get all templates
   */
  getTemplates() {
    return {
      ...this.templates,
      ...Object.fromEntries(this.customTemplates)
    };
  }

  /**
   * Add custom template
   */
  addTemplate(template) {
    if (!template.id || !template.template) {
      throw new Error('Template must have id and template fields');
    }
    this.customTemplates.set(template.id, template);
    return template;
  }

  /**
   * Get persona by ID
   */
  getPersona(personaId) {
    return this.personas[personaId];
  }

  /**
   * Get all personas
   */
  getPersonas() {
    return this.personas;
  }

  /**
   * Render template with variables
   */
  render(templateId, variables = {}) {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Merge with default values
    const vars = { ...template.defaultValues, ...variables };

    // Simple template rendering (replace {{variable}})
    let rendered = template.template;

    // Handle simple variables
    for (const [key, value] of Object.entries(vars)) {
      if (typeof value === 'string' || typeof value === 'number') {
        rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }
    }

    // Handle conditionals {{#if variable}}...{{/if}}
    rendered = rendered.replace(/{{#if (\w+)}}([\s\S]*?){{\/if}}/g, (match, varName, content) => {
      const parts = varName.split('.');
      let value = vars;
      for (const part of parts) {
        value = value?.[part];
      }
      return value ? content : '';
    });

    // Handle each loops {{#each array}}...{{/each}}
    rendered = rendered.replace(/{{#each (\w+)}}([\s\S]*?){{\/each}}/g, (match, varName, content) => {
      const array = vars[varName];
      if (!Array.isArray(array)) return '';
      
      return array.map(item => {
        let itemContent = content;
        // Replace this.property with item values
        itemContent = itemContent.replace(/{{this\.(\w+)}}/g, (m, prop) => {
          return item[prop] ?? '';
        });
        // Replace {{this}} with item itself if it's a string
        itemContent = itemContent.replace(/{{this}}/g, typeof item === 'string' ? item : JSON.stringify(item));
        return itemContent;
      }).join('\n');
    });

    // Handle nested properties {{context.property}}
    rendered = rendered.replace(/{{(\w+)\.(\w+)}}/g, (match, obj, prop) => {
      return vars[obj]?.[prop] ?? '';
    });

    // Clean up any remaining unmatched variables
    rendered = rendered.replace(/{{[^}]+}}/g, '');

    // Clean up multiple newlines
    rendered = rendered.replace(/\n{3,}/g, '\n\n').trim();

    return rendered;
  }

  /**
   * Build smart reply prompt
   */
  buildSmartReplyPrompt(message, options = {}) {
    return this.render('SMART_REPLY', {
      message,
      history: options.history || [],
      context: options.context || {},
      persona: options.persona ? this.getPersona(options.persona) : null,
      replyCount: options.replyCount || 3
    });
  }

  /**
   * Build intent analysis prompt
   */
  buildIntentAnalysisPrompt(message, context = null) {
    return this.render('INTENT_ANALYSIS', {
      message,
      context: context ? JSON.stringify(context, null, 2) : null
    });
  }

  /**
   * Build lead scoring prompt
   */
  buildLeadScoringPrompt(messages, contactData = {}) {
    return this.render('LEAD_SCORING', {
      messages,
      contactData: JSON.stringify(contactData, null, 2)
    });
  }

  /**
   * Build summary prompt
   */
  buildSummaryPrompt(messages) {
    return this.render('CONVERSATION_SUMMARY', { messages });
  }

  /**
   * Estimate token count (rough approximation)
   */
  estimateTokens(text) {
    // Rough estimation: ~4 characters per token for English, ~3 for Portuguese
    return Math.ceil(text.length / 3);
  }
}

// Singleton
const instance = new PromptManager();

module.exports = instance;
module.exports.PromptManager = PromptManager;
module.exports.PROMPT_TEMPLATES = PROMPT_TEMPLATES;
module.exports.PERSONAS = PERSONAS;
