/**
 * 🏗️ DynamicPromptBuilder - Priority-Based Prompt Assembly System (Extension Module)
 * WhatsHybrid Pro v7.9.13
 * 
 * Browser-compatible IIFE module for building optimized prompts with token budget management.
 * Ensures critical sections are always included while less important sections are dropped if needed.
 * 
 * @version 1.0.0
 * @global window.DynamicPromptBuilder
 */

(function(window) {
  'use strict';

  /**
   * Section priority constants (higher = more important)
   * @const {Object}
   */
  const SECTION_PRIORITIES = {
    IDENTITY: 10,
    BUSINESS_RULES: 9,
    CLIENT_CONTEXT: 8,
    KNOWLEDGE: 7,
    ANALYSIS: 6,
    CHAIN_OF_THOUGHT: 5,
    GUARDRAILS: 10
  };

  /**
   * Default token budgets per section
   * @const {Object}
   */
  const DEFAULT_BUDGETS = {
    IDENTITY: 200,
    BUSINESS_RULES: 300,
    CLIENT_CONTEXT: 200,
    KNOWLEDGE: 500,
    ANALYSIS: 150,
    CHAIN_OF_THOUGHT: 200,
    GUARDRAILS: 200
  };

  /**
   * Guardrails that must never be violated
   * @const {Array<string>}
   */
  const DEFAULT_GUARDRAILS = [
    'NEVER invent information or make up data that was not provided',
    'NEVER share data or information from other clients',
    'NEVER promise prices, deadlines, or deliveries without explicit confirmation',
    'If you don\'t know something, say "I need to verify this information"',
    'Always respect client privacy and data protection laws'
  ];

  /**
   * Adaptive Chain-of-Thought templates based on situation
   * @const {Object}
   */
  const COT_TEMPLATES = {
    complaint: `When handling complaints, follow these steps:
1. Acknowledge the client's feelings and validate their concern
2. Present a clear solution or next steps
3. Confirm the resolution and offer additional help`,
    
    sales: `When responding to sales inquiries:
1. Understand the client's need or pain point
2. Present relevant benefits (not just features)
3. Address potential objections proactively
4. Guide toward next action (purchase, demo, etc.)`,
    
    support: `When providing technical support:
1. Confirm understanding of the problem
2. Provide step-by-step solution clearly
3. Verify the solution worked
4. Offer prevention tips if applicable`,
    
    urgency: `When handling urgent requests:
1. Acknowledge the urgency
2. Provide immediate actionable steps
3. Set clear expectations on resolution time`,
    
    default: `When responding:
1. Understand the context and intent
2. Provide clear, relevant information
3. Ensure client satisfaction`
  };

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
     * Builds the Knowledge section from RAG/HybridSearch results
     * 
     * @param {Array<Object>} knowledge - Search results
     * @param {string} knowledge[].content - Knowledge content
     * @param {number} knowledge[].score - Relevance score
     * @param {string} knowledge[].source - Source identifier
     * @returns {string|null} Knowledge section text or null if no knowledge provided
     */
    buildKnowledgeSection(knowledge) {
      if (!knowledge || knowledge.length === 0) {
        return null;
      }
      
      let section = `# Relevant Knowledge\n`;
      
      knowledge.forEach((item, index) => {
        section += `\n## Source ${index + 1}`;
        if (item.source) {
          section += ` (${item.source})`;
        }
        if (item.score) {
          section += ` [relevance: ${(item.score * 100).toFixed(0)}%]`;
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
    buildChainOfThoughtSection(analysis) {
      if (!analysis) return null;
      
      let section = `# Response Strategy\n`;
      
      // Select appropriate CoT template based on analysis
      let template = COT_TEMPLATES.default;
      
      if (analysis.intent === 'complaint' || analysis.sentiment === 'negative') {
        template = COT_TEMPLATES.complaint;
      } else if (analysis.intent === 'purchase' || analysis.intent === 'pricing') {
        template = COT_TEMPLATES.sales;
      } else if (analysis.intent === 'support' || analysis.intent === 'question') {
        template = COT_TEMPLATES.support;
      } else if (analysis.urgency === 'high') {
        template = COT_TEMPLATES.urgency;
      }
      
      section += template;
      
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
     * Main build method - assembles complete prompt with token budget management
     * 
     * @param {Object} config - Build configuration
     * @param {Object} config.persona - Persona configuration
     * @param {Object} config.memory - Conversation memory
     * @param {Array} config.knowledge - RAG/search results
     * @param {Object} config.analysis - Message analysis
     * @param {Array<string>} config.businessRules - Business rules
     * @param {Array<string>} config.customGuardrails - Custom guardrails
     * @param {string} config.language - Response language
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
      
      // 5. Analysis (Priority 6)
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
      
      // 6. Chain-of-Thought (Priority 5)
      const cotText = this.buildChainOfThoughtSection(analysis);
      if (cotText) {
        sections.push({
          name: 'CHAIN_OF_THOUGHT',
          priority: SECTION_PRIORITIES.CHAIN_OF_THOUGHT,
          content: this.truncateToTokens(cotText, budgets.CHAIN_OF_THOUGHT),
          tokens: this.estimateTokens(cotText),
          budgetTokens: budgets.CHAIN_OF_THOUGHT
        });
      }
      
      // 7. Guardrails (Priority 10)
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

  // Export to window
  window.DynamicPromptBuilder = new DynamicPromptBuilder();
  
  // Also export class and constants for advanced usage
  window.DynamicPromptBuilder.Class = DynamicPromptBuilder;
  window.DynamicPromptBuilder.SECTION_PRIORITIES = SECTION_PRIORITIES;
  window.DynamicPromptBuilder.DEFAULT_BUDGETS = DEFAULT_BUDGETS;
  window.DynamicPromptBuilder.COT_TEMPLATES = COT_TEMPLATES;
  
  console.log('[DynamicPromptBuilder] ✅ Module loaded successfully');

})(window);
