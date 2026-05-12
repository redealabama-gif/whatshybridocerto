/**
 * 🏗️ DynamicPromptBuilder - Priority-Based Prompt Assembly System
 * WhatsHybrid Pro v7.9.13
 * 
 * Constructs prompts from prioritized sections with token budget management.
 * Ensures critical sections (Identity, Business Rules, Guardrails) are always included,
 * while less important sections are dropped if budget is exceeded.
 * 
 * @version 1.0.0
 * @module DynamicPromptBuilder
 */

/**
 * Section priority constants (higher = more important)
 * P3 FIX: Added FEW_SHOT section (priority 6, between CHAIN_OF_THOUGHT and ANALYSIS)
 */
const SECTION_PRIORITIES = {
  IDENTITY: 10,
  BUSINESS_RULES: 9,
  BEHAVIORAL_DIRECTIVE: 9, // v10: commercial goal directive — same priority as business rules
  CLIENT_BEHAVIOR: 8,      // v10.1: micro-adaptation (stage + style + energy + closing)
  CLIENT_CONTEXT: 8,
  KNOWLEDGE: 7,
  FEW_SHOT: 6,   // P3: graduated patterns from ValidatedLearningPipeline
  ANALYSIS: 5,
  CHAIN_OF_THOUGHT: 4,
  GUARDRAILS: 10
};

/**
 * Default token budgets per section
 */
const DEFAULT_BUDGETS = {
  IDENTITY: 200,
  BUSINESS_RULES: 300,
  BEHAVIORAL_DIRECTIVE: 250, // v10: commercial goal directive
  CLIENT_BEHAVIOR: 300,      // v10.1: micro-adaptation block
  CLIENT_CONTEXT: 200,
  KNOWLEDGE: 500,
  FEW_SHOT: 300,     // P3: budget for graduated examples
  ANALYSIS: 150,
  CHAIN_OF_THOUGHT: 200,
  GUARDRAILS: 200
};

/**
 * Guardrails that must never be violated
 */
const DEFAULT_GUARDRAILS = [
  'NEVER invent information or make up data that was not provided',
  'NEVER share data or information from other clients',
  'NEVER promise prices, deadlines, or deliveries without explicit confirmation',
  'If you don\'t know something, say "I need to verify this information"',
  'Always respect client privacy and data protection laws'
];

/**
 * P9 FIX: Adaptive Chain-of-Thought templates — i18n-aware.
 * Templates are keyed by intent + language code (e.g. 'complaint_pt-BR').
 * Falls back to 'default_<lang>' then English 'default_en'.
 */
const COT_TEMPLATES = {
  // ── Portuguese (pt-BR / pt-PT) ───────────────────────────────────────────
  'complaint_pt-BR': `Ao lidar com reclamações, siga estes passos:
1. Reconheça os sentimentos do cliente e valide a preocupação dele
2. Apresente uma solução clara ou próximos passos
3. Confirme a resolução e ofereça ajuda adicional`,

  'sales_pt-BR': `Ao responder a consultas de venda:
1. Entenda a necessidade ou dor do cliente
2. Apresente benefícios relevantes (não apenas características)
3. Aborde objeções de forma proativa
4. Guie para a próxima ação (compra, demonstração, etc.)`,

  'support_pt-BR': `Ao fornecer suporte técnico:
1. Confirme o entendimento do problema
2. Forneça uma solução passo a passo de forma clara
3. Verifique se a solução funcionou
4. Ofereça dicas de prevenção quando aplicável`,

  'urgency_pt-BR': `Ao lidar com solicitações urgentes:
1. Reconheça a urgência
2. Forneça passos acionáveis imediatos
3. Defina expectativas claras sobre o tempo de resolução`,

  'default_pt-BR': `Ao responder:
1. Entenda o contexto e a intenção
2. Forneça informações claras e relevantes
3. Garanta a satisfação do cliente`,

  // ── Spanish (es) ─────────────────────────────────────────────────────────
  'complaint_es': `Al manejar quejas, sigue estos pasos:
1. Reconoce los sentimientos del cliente y valida su preocupación
2. Presenta una solución clara o los próximos pasos
3. Confirma la resolución y ofrece ayuda adicional`,

  'sales_es': `Al responder a consultas de venta:
1. Comprende la necesidad o el problema del cliente
2. Presenta beneficios relevantes (no solo características)
3. Aborda objeciones de forma proactiva
4. Guía hacia la próxima acción (compra, demo, etc.)`,

  'support_es': `Al brindar soporte técnico:
1. Confirma la comprensión del problema
2. Proporciona la solución paso a paso de forma clara
3. Verifica que la solución funcionó
4. Ofrece consejos de prevención cuando sea aplicable`,

  'urgency_es': `Al manejar solicitudes urgentes:
1. Reconoce la urgencia
2. Proporciona pasos accionables inmediatos
3. Establece expectativas claras sobre el tiempo de resolución`,

  'default_es': `Al responder:
1. Comprende el contexto y la intención
2. Proporciona información clara y relevante
3. Asegura la satisfacción del cliente`,

  // ── English (en) ─────────────────────────────────────────────────────────
  'complaint_en': `When handling complaints, follow these steps:
1. Acknowledge the client's feelings and validate their concern
2. Present a clear solution or next steps
3. Confirm the resolution and offer additional help`,

  'sales_en': `When responding to sales inquiries:
1. Understand the client's need or pain point
2. Present relevant benefits (not just features)
3. Address potential objections proactively
4. Guide toward next action (purchase, demo, etc.)`,

  'support_en': `When providing technical support:
1. Confirm understanding of the problem
2. Provide step-by-step solution clearly
3. Verify the solution worked
4. Offer prevention tips if applicable`,

  'urgency_en': `When handling urgent requests:
1. Acknowledge the urgency
2. Provide immediate actionable steps
3. Set clear expectations on resolution time`,

  'default_en': `When responding:
1. Understand the context and intent
2. Provide clear, relevant information
3. Ensure client satisfaction`,
};

/**
 * Resolve a CoT template key: intent + language → fallback chain.
 * @param {string} intent
 * @param {string} language  – e.g. 'pt-BR', 'es', 'en'
 * @returns {string} template text
 * @private
 */
function _resolveCotTemplate(intent, language = 'pt-BR') {
  // Normalise: 'pt-PT' → 'pt-BR', 'en-US' → 'en', 'es-AR' → 'es'
  const lang = language.startsWith('pt') ? 'pt-BR'
    : language.startsWith('es') ? 'es'
    : 'en';

  return COT_TEMPLATES[`${intent}_${lang}`]
    || COT_TEMPLATES[`default_${lang}`]
    || COT_TEMPLATES['default_en'];
}

/**
 * @class DynamicPromptBuilder
 * @description Builds optimized prompts from prioritized sections with token budget management
 */
class DynamicPromptBuilder {
  constructor() {
    /**
     * Statistics tracking
     * @type {Object}
     */
    this.stats = {
      promptsBuilt: 0,
      totalTokens: 0,
      avgTokens: 0,
      sectionsDropped: {},
      buildTimes: []
    };
  }

  /**
   * Estimates token count for text using GPT-3 approximation
   * Rule: ~4 characters per token for English, ~3-4 for Portuguese
   * 
   * @param {string} text - Text to estimate
   * @returns {number} Estimated token count
   */
  estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Truncates text to fit within token budget
   * 
   * @param {string} text - Text to truncate
   * @param {number} maxTokens - Maximum token count
   * @returns {string} Truncated text
   */
  truncateToTokens(text, maxTokens) {
    if (!text) return '';
    
    const estimatedTokens = this.estimateTokens(text);
    if (estimatedTokens <= maxTokens) return text;
    
    // Calculate approximate character limit (leave room for ellipsis)
    const maxChars = (maxTokens - 1) * 4;
    
    // Truncate and add ellipsis
    let truncated = text.substring(0, maxChars);
    
    // Try to break at sentence boundary
    const lastPeriod = truncated.lastIndexOf('.');
    const lastNewline = truncated.lastIndexOf('\n');
    const breakPoint = Math.max(lastPeriod, lastNewline);
    
    if (breakPoint > maxChars * 0.8) {
      // If we can break at 80% or more, do it
      truncated = truncated.substring(0, breakPoint + 1);
    } else {
      // Otherwise just add ellipsis
      truncated += '...';
    }
    
    return truncated;
  }

  /**
   * v10.1 NEW: Builds the Client Behavior section.
   * Consolidates stage instruction, style adaptation, energy level,
   * closing moment detection and style variation hint into a single
   * high-priority section injected right after BEHAVIORAL_DIRECTIVE.
   *
   * @param {Object} behaviorProfile - Result from ClientBehaviorAdapter.analyze()
   * @returns {string|null}
   */
  buildClientBehaviorSection(behaviorProfile) {
    if (!behaviorProfile) return null;

    const parts = [];

    // ── Stage-Aware Shaping ─────────────────────────────────────────────────
    parts.push(`## 📍 Client Stage: ${behaviorProfile.stageLabel}`);
    parts.push(behaviorProfile.stageInstruction);

    // ── Closing Moment (máxima prioridade quando detectado) ─────────────────
    if (behaviorProfile.isClosingMoment && behaviorProfile.closingInstruction) {
      parts.push('');
      parts.push(behaviorProfile.closingInstruction);
    } else if (behaviorProfile.isPreClosing && behaviorProfile.closingInstruction) {
      parts.push('');
      parts.push(`## ⚡ Pre-Closing Signal Detected`);
      parts.push(behaviorProfile.closingInstruction);
    }

    // ── Response Energy Level ───────────────────────────────────────────────
    parts.push('');
    parts.push(`## 🔋 Response Energy: ${behaviorProfile.energyLabel}`);
    parts.push(behaviorProfile.energyInstruction);

    // ── Client Style Adaptation ─────────────────────────────────────────────
    parts.push('');
    parts.push(`## 🎙️ Communication Style: ${behaviorProfile.styleLabel}`);
    parts.push(behaviorProfile.styleInstruction);

    // ── Style Variation Hint (anti-repetição) ───────────────────────────────
    parts.push('');
    parts.push(`## 🔄 Style Variation`);
    parts.push(behaviorProfile.variationHint);

    return parts.join('\n');
  }

  /**
   * v10 NEW: Builds the Behavioral Directive section.
   * Injects commercial goal + high-performance response instructions
   * into the prompt so the LLM knows not just WHAT to say but HOW to say it.
   *
   * @param {string} behavioralDirective - Pre-built directive from CommercialIntelligenceEngine
   * @param {string} responseGoal        - Classified goal (e.g. 'fechar_venda')
   * @returns {string|null}
   */
  buildBehavioralDirectiveSection(behavioralDirective, responseGoal) {
    if (!behavioralDirective) return null;

    let section = `# Behavioral Directive\n`;
    section += `responseGoal: ${responseGoal || 'responder_duvida'}\n\n`;
    section += behavioralDirective;
    section += `\n\n## Response Performance Standards\n`;
    section += `- Resolva a dúvida E mantenha a conversa fluindo\n`;
    section += `- Tom natural e humano (nunca robótico)\n`;
    section += `- Direto, sem enrolação — nem curto demais, nem longo demais\n`;
    section += `- Adapte o tom ao estilo da mensagem do cliente\n`;
    section += `- Use o conhecimento da empresa como fonte principal\n`;
    section += `- Evite repetir informações já dadas na conversa\n`;
    section += `- Nunca invente dados — se não souber, diga "Preciso verificar"\n`;

    return section;
  }

  /**
   * Builds the Identity section
   * 
   * @param {Object} persona - Persona configuration
   * @param {string} persona.name - Persona name
   * @param {string} persona.description - Persona description
   * @param {string} persona.systemPrompt - System instructions
   * @param {string} [language='pt-BR'] - Response language
   * @returns {string} Identity section text
   */
  buildIdentitySection(persona, language = 'pt-BR') {
    if (!persona) {
      return `You are a professional customer service assistant.\nLanguage: ${language}`;
    }
    
    let section = `# Identity\n`;
    section += `Persona: ${persona.name || 'Professional Assistant'}\n`;
    
    if (persona.description) {
      section += `Description: ${persona.description}\n`;
    }
    
    if (persona.systemPrompt) {
      section += `\n${persona.systemPrompt}\n`;
    }
    
    section += `\nResponse Language: ${language}`;
    
    return section;
  }

  /**
   * Builds the Business Rules section
   * 
   * @param {Array<string>} businessRules - User-configurable business rules
   * @returns {string|null} Business rules section text or null if no rules provided
   */
  buildBusinessRulesSection(businessRules) {
    if (!businessRules || businessRules.length === 0) {
      return null;
    }
    
    let section = `# Business Rules (MUST BE FOLLOWED)\n`;
    businessRules.forEach((rule, index) => {
      section += `${index + 1}. ${rule}\n`;
    });
    
    return section;
  }

  /**
   * Builds the Client Context section from conversation memory
   * 
   * @param {Object} memory - ConversationMemory data
   * @param {Object} memory.client - Client information
   * @param {Array} memory.recentMessages - Recent conversation
   * @param {Object} memory.metadata - Additional metadata
   * @returns {string|null} Client context section text or null if no memory provided
   */
  buildClientContextSection(memory) {
    if (!memory) return null;
    
    let section = `# Client Context\n`;
    
    if (memory.client) {
      section += `Client: ${memory.client.name || 'Unknown'}\n`;
      if (memory.client.stage) {
        section += `Stage: ${memory.client.stage}\n`;
      }
      if (memory.client.tags && memory.client.tags.length > 0) {
        section += `Tags: ${memory.client.tags.join(', ')}\n`;
      }
    }
    
    if (memory.recentMessages && memory.recentMessages.length > 0) {
      section += `\nRecent Conversation:\n`;
      memory.recentMessages.slice(-5).forEach(msg => {
        const speaker = msg.fromMe ? 'Agent' : 'Client';
        section += `${speaker}: ${msg.content}\n`;
      });
    }
    
    if (memory.metadata && Object.keys(memory.metadata).length > 0) {
      section += `\nMetadata: ${JSON.stringify(memory.metadata, null, 2)}\n`;
    }
    
    return section;
  }

  /**
   * Builds the Knowledge section from RAG/HybridSearch results.
   * v10 REFINEMENT: filters to top 3 with minimum relevance score,
   * labels each entry as [INFORMAÇÃO IMPORTANTE DA EMPRESA] for LLM emphasis.
   *
   * @param {Array<Object>} knowledge - Search results
   * @param {number} [minScore=0.3]   - Minimum relevance score to include
   * @returns {string|null} Knowledge section text or null if no knowledge provided
   */
  buildKnowledgeSection(knowledge, minScore = 0.3) {
    if (!knowledge || knowledge.length === 0) {
      return null;
    }

    // v10: filter by minimum score, sort by relevance, take top 3
    const filtered = knowledge
      .filter(item => !item.score || item.score >= minScore) // include items without score
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 3);

    if (filtered.length === 0) return null;
    
    let section = `# Relevant Knowledge\n`;
    
    filtered.forEach((item, index) => {
      // v10: label each knowledge item for LLM emphasis
      section += `\n[INFORMAÇÃO IMPORTANTE DA EMPRESA - Fonte ${index + 1}]`;
      if (item.source) {
        section += ` (${item.source})`;
      }
      if (item.score) {
        section += ` [relevância: ${(item.score * 100).toFixed(0)}%]`;
      }
      section += `\n${item.content}\n`;
    });
    
    return section;
  }

  /**
   * Builds the Analysis section (intent, sentiment, entities, urgency)
   * 
   * @param {Object} analysis - Message analysis results
   * @param {string} analysis.intent - Detected intent
   * @param {string} analysis.sentiment - Sentiment (positive/neutral/negative)
   * @param {number} analysis.sentimentScore - Sentiment score (-1 to 1)
   * @param {string} analysis.urgency - Urgency level (low/medium/high)
   * @param {Object} analysis.entities - Extracted entities
   * @returns {string|null} Analysis section text or null if no analysis provided
   */
  buildAnalysisSection(analysis) {
    if (!analysis) return null;
    
    let section = `# Message Analysis\n`;
    
    if (analysis.intent) {
      section += `Intent: ${analysis.intent}\n`;
    }
    
    if (analysis.sentiment) {
      section += `Sentiment: ${analysis.sentiment}`;
      if (analysis.sentimentScore !== undefined) {
        section += ` (${analysis.sentimentScore.toFixed(2)})`;
      }
      section += `\n`;
    }
    
    if (analysis.urgency) {
      section += `Urgency: ${analysis.urgency}\n`;
    }
    
    if (analysis.entities && Object.keys(analysis.entities).length > 0) {
      section += `\nExtracted Entities:\n`;
      for (const [type, values] of Object.entries(analysis.entities)) {
        if (values && values.length > 0) {
          section += `- ${type}: ${values.join(', ')}\n`;
        }
      }
    }
    
    return section;
  }

  /**
   * Builds the Chain-of-Thought section with adaptive instructions
   * 
   * @param {Object} analysis - Message analysis (to determine appropriate CoT)
   * @param {string} analysis.intent - Intent type
   * @param {string} analysis.urgency - Urgency level
   * @returns {string|null} Chain-of-thought section text or null if no analysis provided
   */
  /**
   * P9 FIX: buildChainOfThoughtSection now uses _resolveCotTemplate for i18n support.
   * The language parameter is passed from build() config so templates are rendered
   * in the tenant's configured language instead of always using English.
   */
  buildChainOfThoughtSection(analysis, language = 'pt-BR') {
    if (!analysis) return null;

    let section = `# Response Strategy\n`;

    // Map intent/sentiment/urgency to a template intent key
    let intentKey = 'default';
    if (analysis.intent === 'complaint' || analysis.sentiment === 'negative') {
      intentKey = 'complaint';
    } else if (analysis.intent === 'purchase' || analysis.intent === 'pricing') {
      intentKey = 'sales';
    } else if (analysis.intent === 'support' || analysis.intent === 'question') {
      intentKey = 'support';
    } else if (analysis.urgency === 'high') {
      intentKey = 'urgency';
    }

    section += _resolveCotTemplate(intentKey, language);

    return section;
  }

  /**
   * Builds the Guardrails section
   * 
   * @param {Array<string>} customGuardrails - Additional custom guardrails
   * @returns {string} Guardrails section text
   */
  buildGuardrailsSection(customGuardrails = []) {
    let section = `# Critical Guardrails (NEVER VIOLATE)\n`;
    
    const allGuardrails = [...DEFAULT_GUARDRAILS, ...customGuardrails];
    
    allGuardrails.forEach((rule, index) => {
      section += `${index + 1}. ${rule}\n`;
    });
    
    return section;
  }

  /**
   * P3 FIX: Builds the Few-Shot Examples section from graduated learning patterns.
   * Graduated patterns are examples of real interactions that received positive feedback
   * and passed the ValidatedLearningPipeline graduation threshold (≥80% positive rate,
   * min 5 samples). Injecting them as few-shot examples teaches the LLM the company's
   * preferred response style without any fine-tuning.
   *
   * @param {Array<{trigger: string, response: string, intent: string}>} examples
   * @returns {string|null} Few-shot section or null if no examples
   */
  buildFewShotSection(examples = []) {
    if (!examples || examples.length === 0) return null;

    let section = `# Proven Response Examples (follow this style)\n`;
    section += `These are real interactions that received positive feedback from your team:\n\n`;

    examples.slice(0, 3).forEach((ex, i) => {
      if (ex.trigger && ex.response) {
        section += `Example ${i + 1}:\n`;
        section += `Customer: "${ex.trigger}"\n`;
        section += `Response: "${ex.response}"\n\n`;
      }
    });

    return section.trim();
  }

  /**
   * Main build method - assembles complete prompt with token budget management.
   *
   * P3 FIX: Added fewShotExamples parameter — graduated patterns from
   *   ValidatedLearningPipeline are injected as a FEW_SHOT section.
   * P9 FIX: language is propagated to buildChainOfThoughtSection so CoT templates
   *   are rendered in the tenant's configured language.
   *
   * @param {Object} config - Build configuration
   * @param {Object} config.persona - Persona configuration
   * @param {Object} config.memory - Conversation memory
   * @param {Array} config.knowledge - RAG/search results
   * @param {Object} config.analysis - Message analysis
   * @param {Array<string>} config.businessRules - Business rules
   * @param {Array<string>} config.customGuardrails - Custom guardrails
   * @param {string} config.language - Response language (e.g. 'pt-BR', 'es', 'en')
   * @param {Array} [config.fewShotExamples=[]] - P3: graduated patterns from ValidatedLearningPipeline
   * @param {string} [config.behavioralDirective] - v10: directive from CommercialIntelligenceEngine
   * @param {string} [config.responseGoal]        - v10: classified commercial goal
   * @param {Object} [config.behaviorProfile]     - v10.1: full profile from ClientBehaviorAdapter
   * @param {number} [config.totalBudget=2000] - Total token budget
   * @param {Object} [config.sectionBudgets] - Custom section budgets
   * @returns {Object} Built prompt and metadata
   */
  build(config = {}) {
    const startTime = Date.now();
    
    const {
      persona,
      memory,
      knowledge,
      analysis,
      businessRules = [],
      customGuardrails = [],
      language = 'pt-BR',
      fewShotExamples = [],   // P3: graduated patterns from ValidatedLearningPipeline
      behavioralDirective = null, // v10: from CommercialIntelligenceEngine
      responseGoal = null,        // v10: classified commercial goal
      behaviorProfile = null,     // v10.1: from ClientBehaviorAdapter
      totalBudget = 2000,
      sectionBudgets = {}
    } = config;
    
    // Merge custom budgets with defaults
    const budgets = { ...DEFAULT_BUDGETS, ...sectionBudgets };
    
    // Build all sections
    const sections = [];
    
    // 1. Identity (Priority 10)
    const identityText = this.buildIdentitySection(persona, language);
    if (identityText) {
      sections.push({
        name: 'IDENTITY',
        priority: SECTION_PRIORITIES.IDENTITY,
        content: this.truncateToTokens(identityText, budgets.IDENTITY),
        tokens: this.estimateTokens(identityText),
        budgetTokens: budgets.IDENTITY
      });
    }

    // 1b. v10: Behavioral Directive (Priority 9 — same as business rules)
    const behavioralDirectiveText = this.buildBehavioralDirectiveSection(behavioralDirective, responseGoal);
    if (behavioralDirectiveText) {
      sections.push({
        name: 'BEHAVIORAL_DIRECTIVE',
        priority: SECTION_PRIORITIES.BEHAVIORAL_DIRECTIVE,
        content: this.truncateToTokens(behavioralDirectiveText, budgets.BEHAVIORAL_DIRECTIVE),
        tokens: this.estimateTokens(behavioralDirectiveText),
        budgetTokens: budgets.BEHAVIORAL_DIRECTIVE
      });
    }

    // 1c. v10.1: Client Behavior Profile (Priority 8 — micro-adaptation)
    const clientBehaviorText = this.buildClientBehaviorSection(behaviorProfile);
    if (clientBehaviorText) {
      sections.push({
        name: 'CLIENT_BEHAVIOR',
        priority: SECTION_PRIORITIES.CLIENT_BEHAVIOR,
        content: this.truncateToTokens(clientBehaviorText, budgets.CLIENT_BEHAVIOR),
        tokens: this.estimateTokens(clientBehaviorText),
        budgetTokens: budgets.CLIENT_BEHAVIOR
      });
    }
    
    // 2. Business Rules (Priority 9)
    const businessRulesText = this.buildBusinessRulesSection(businessRules);
    if (businessRulesText) {
      sections.push({
        name: 'BUSINESS_RULES',
        priority: SECTION_PRIORITIES.BUSINESS_RULES,
        content: this.truncateToTokens(businessRulesText, budgets.BUSINESS_RULES),
        tokens: this.estimateTokens(businessRulesText),
        budgetTokens: budgets.BUSINESS_RULES
      });
    }
    
    // 3. Client Context (Priority 8)
    const clientContextText = this.buildClientContextSection(memory);
    if (clientContextText) {
      sections.push({
        name: 'CLIENT_CONTEXT',
        priority: SECTION_PRIORITIES.CLIENT_CONTEXT,
        content: this.truncateToTokens(clientContextText, budgets.CLIENT_CONTEXT),
        tokens: this.estimateTokens(clientContextText),
        budgetTokens: budgets.CLIENT_CONTEXT
      });
    }
    
    // 4. Knowledge (Priority 7)
    const knowledgeText = this.buildKnowledgeSection(knowledge);
    if (knowledgeText) {
      sections.push({
        name: 'KNOWLEDGE',
        priority: SECTION_PRIORITIES.KNOWLEDGE,
        content: this.truncateToTokens(knowledgeText, budgets.KNOWLEDGE),
        tokens: this.estimateTokens(knowledgeText),
        budgetTokens: budgets.KNOWLEDGE
      });
    }
    
    // 5. P3 FIX: Few-Shot Examples — graduated patterns from ValidatedLearningPipeline (Priority 6)
    const fewShotText = this.buildFewShotSection(fewShotExamples);
    if (fewShotText) {
      sections.push({
        name: 'FEW_SHOT',
        priority: SECTION_PRIORITIES.FEW_SHOT,
        content: this.truncateToTokens(fewShotText, budgets.FEW_SHOT),
        tokens: this.estimateTokens(fewShotText),
        budgetTokens: budgets.FEW_SHOT
      });
    }

    // 6. Analysis (Priority 5)
    const analysisText = this.buildAnalysisSection(analysis);
    if (analysisText) {
      sections.push({
        name: 'ANALYSIS',
        priority: SECTION_PRIORITIES.ANALYSIS,
        content: this.truncateToTokens(analysisText, budgets.ANALYSIS),
        tokens: this.estimateTokens(analysisText),
        budgetTokens: budgets.ANALYSIS
      });
    }
    
    // 7. P9 FIX: Chain-of-Thought now receives language for i18n template resolution
    const cotText = this.buildChainOfThoughtSection(analysis, language);
    if (cotText) {
      sections.push({
        name: 'CHAIN_OF_THOUGHT',
        priority: SECTION_PRIORITIES.CHAIN_OF_THOUGHT,
        content: this.truncateToTokens(cotText, budgets.CHAIN_OF_THOUGHT),
        tokens: this.estimateTokens(cotText),
        budgetTokens: budgets.CHAIN_OF_THOUGHT
      });
    }
    
    // 8. Guardrails (Priority 10)
    const guardrailsText = this.buildGuardrailsSection(customGuardrails);
    if (guardrailsText) {
      sections.push({
        name: 'GUARDRAILS',
        priority: SECTION_PRIORITIES.GUARDRAILS,
        content: this.truncateToTokens(guardrailsText, budgets.GUARDRAILS),
        tokens: this.estimateTokens(guardrailsText),
        budgetTokens: budgets.GUARDRAILS
      });
    }
    
    // Sort by priority (highest first)
    sections.sort((a, b) => b.priority - a.priority);
    
    // Assemble prompt respecting total budget
    let currentTokens = 0;
    const includedSections = [];
    const droppedSections = [];
    
    for (const section of sections) {
      const sectionTokens = this.estimateTokens(section.content);
      
      if (currentTokens + sectionTokens <= totalBudget) {
        includedSections.push(section);
        currentTokens += sectionTokens;
      } else {
        droppedSections.push(section.name);
        
        // Track dropped sections in stats
        if (!this.stats.sectionsDropped[section.name]) {
          this.stats.sectionsDropped[section.name] = 0;
        }
        this.stats.sectionsDropped[section.name]++;
      }
    }
    
    // Build final prompt
    const prompt = includedSections
      .map(section => section.content)
      .join('\n\n---\n\n');
    
    // Update statistics
    const buildTime = Date.now() - startTime;
    this.stats.promptsBuilt++;
    this.stats.totalTokens += currentTokens;
    this.stats.avgTokens = Math.round(this.stats.totalTokens / this.stats.promptsBuilt);
    this.stats.buildTimes.push(buildTime);
    
    // Keep only last 100 build times
    if (this.stats.buildTimes.length > 100) {
      this.stats.buildTimes.shift();
    }
    
    return {
      prompt,
      metadata: {
        totalTokens: currentTokens,
        budgetUsed: ((currentTokens / totalBudget) * 100).toFixed(1) + '%',
        sectionsIncluded: includedSections.length,
        sectionsDropped: droppedSections,
        buildTimeMs: buildTime,
        sections: includedSections.map(s => ({
          name: s.name,
          priority: s.priority,
          tokens: this.estimateTokens(s.content)
        }))
      }
    };
  }

  /**
   * Gets current statistics
   * 
   * @returns {Object} Statistics object
   */
  getStats() {
    const avgBuildTime = this.stats.buildTimes.length > 0
      ? Math.round(this.stats.buildTimes.reduce((a, b) => a + b, 0) / this.stats.buildTimes.length)
      : 0;
    
    return {
      ...this.stats,
      avgBuildTimeMs: avgBuildTime
    };
  }

  /**
   * Resets statistics
   */
  resetStats() {
    this.stats = {
      promptsBuilt: 0,
      totalTokens: 0,
      avgTokens: 0,
      sectionsDropped: {},
      buildTimes: []
    };
  }
}

// Singleton instance
const instance = new DynamicPromptBuilder();

module.exports = instance;
module.exports.DynamicPromptBuilder = DynamicPromptBuilder;
module.exports.SECTION_PRIORITIES = SECTION_PRIORITIES;
module.exports.DEFAULT_BUDGETS = DEFAULT_BUDGETS;
module.exports.COT_TEMPLATES = COT_TEMPLATES;
