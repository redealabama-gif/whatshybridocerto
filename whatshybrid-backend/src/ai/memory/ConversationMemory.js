/**
 * 🧠 ConversationMemory - Three-Layer Memory Architecture
 * WhatsHybrid Pro v7.10.0
 * 
 * Implements a sophisticated conversation memory system with:
 * 1. Recent messages (literal storage, last 20)
 * 2. Summaries (LLM-generated, max 10 summaries)
 * 3. Client profile (persistent metadata)
 * 
 * Features:
 * - Automatic summarization when messages exceed 30
 * - Intelligent context formatting with token budget
 * - Client profile tracking (preferences, history, issues)
 * - Stats tracking and analytics
 * - File-based persistence with in-memory cache
 * 
 * @version 1.0.0
 */

const fs = require('fs').promises;
const logger = require('../../utils/logger');
const path = require('path');
// FIX HIGH: era hardcoded em OpenAIProvider — bypassa fallback do AIRouter inteiro.
// Agora usa o singleton do AIRouter com fallback automático para Anthropic/Groq.
const AIRouter = require('../services/AIRouterService');

class ConversationMemory {
  /**
   * @param {Object} config - Configuration options
   * @param {string} [config.tenantId='default']  – P4: namespace for key isolation
   * @param {string} config.storageDir - Directory for file persistence (optional)
   * @param {Object} config.openaiConfig - OpenAI configuration
   * @param {boolean} config.enablePersistence - Enable file persistence (default: true)
   */
  constructor(config = {}) {
    // P4: tenant namespace — each tenant's conversations are stored under a unique prefix
    // FIX HIGH SECURITY: sanitiza tenantId — vai virar parte do path.
    // Sem isto, tenantId="../../etc" escapa do diretório de memória.
    const rawTenant = config.tenantId || 'default';
    this.tenantId = String(rawTenant).replace(/[^A-Za-z0-9_\-]/g, '_').substring(0, 100) || 'default';

    this.storageDir = config.storageDir
      ? path.join(config.storageDir, this.tenantId)          // P4: tenant subfolder
      : path.join(process.cwd(), 'data', 'memory', this.tenantId);
    this.enablePersistence = config.enablePersistence !== false;
    // FIX: removido `this.openaiProvider = new OpenAIProvider(...)`.
    // Sumarização agora usa AIRouter (singleton compartilhado, com fallback automático).
    this.aiRouter = AIRouter;

    // P5: optional Prisma adapter — when provided, replaces JSON-file persistence
    this.prismaAdapter = config.prismaAdapter || null;
    
    // In-memory storage
    this.conversations = new Map();
    
    // Configuration
    this.MAX_RECENT_MESSAGES = 20;
    this.MAX_SUMMARIES = 10;
    this.SUMMARIZATION_THRESHOLD = 30;
    this.SUMMARIZATION_BATCH_SIZE = 10;
    
    // Stats
    this.stats = {
      totalChats: 0,
      totalMessages: 0,
      summariesGenerated: 0,
      lastUpdated: null
    };
    
    this.initialized = false;
  }

  /**
   * Initialize the memory system.
   * P5 FIX: If a prismaAdapter was injected (config.prismaAdapter), loads from
   * PostgreSQL instead of the legacy JSON-file backend.
   */
  async init() {
    if (this.initialized) return;
    
    try {
      if (this.prismaAdapter) {
        // P5: DB-backed persistence — load all tenant conversations at startup
        const dbMap = await this.prismaAdapter.loadAll();
        dbMap.forEach((conv, key) => this.conversations.set(key, conv));
        logger.info(`[ConversationMemory] Loaded ${dbMap.size} conversations from DB (tenant: ${this.tenantId})`);
      } else if (this.enablePersistence) {
        await fs.mkdir(this.storageDir, { recursive: true });
        await this.loadFromDisk();
      }
      
      this.initialized = true;
      logger.info('[ConversationMemory] Initialized successfully');
    } catch (error) {
      logger.error('[ConversationMemory] Initialization error:', error);
      throw error;
    }
  }

  /**
   * Get or create conversation memory structure
   * @param {string} chatId - Chat identifier
   * @returns {Object} Conversation memory object
   */
  getOrCreateConversation(chatId) {
    // P4: namespace by tenant so different tenants never share memory entries
    const key = `${this.tenantId}:${chatId}`;
    if (!this.conversations.has(key)) {
      this.conversations.set(key, {
        chatId,           // keep original chatId for display/serialisation
        tenantId: this.tenantId,
        recentMessages: [],
        summaries: [],
        profile: {
          name: '',
          preferredTone: 'professional',
          segment: 'new',
          // v10: commercial intelligence fields
          stage: 'cold',              // cold | interested | warm | customer | inactive
          lastDominantIntent: null,   // último intent detectado com alta confiança
          intentHistory: [],          // histórico dos últimos 10 intents
          lastInteractionAt: null,    // para detectar inatividade
          responseGoalHistory: [],    // histórico de goals classificados
          purchaseHistory: [],
          satisfactionTrend: [],
          topicsDiscussed: [],
          unresolvedIssues: [],
          metadata: {}
        },
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      this.stats.totalChats++;
    }
    return this.conversations.get(key);
  }

  /**
   * Add a message to conversation memory
   * @param {string} chatId - Chat identifier
   * @param {Object} message - Message object
   * @param {string} message.role - 'user' or 'assistant'
   * @param {string} message.content - Message content
   * @param {number} message.timestamp - Optional timestamp
   * @returns {Promise<Object>} Updated conversation
   */
  async addMessage(chatId, message) {
    const conversation = this.getOrCreateConversation(chatId);
    
    // Add to recent messages
    const msg = {
      role: message.role,
      content: message.content,
      timestamp: message.timestamp || Date.now()
    };
    
    conversation.recentMessages.push(msg);
    conversation.updatedAt = Date.now();
    this.stats.totalMessages++;
    this.stats.lastUpdated = Date.now();
    
    // Check if summarization is needed
    if (conversation.recentMessages.length >= this.SUMMARIZATION_THRESHOLD) {
      await this.summarizeOldMessages(chatId);
    }
    
    // Keep only last MAX_RECENT_MESSAGES
    if (conversation.recentMessages.length > this.MAX_RECENT_MESSAGES) {
      conversation.recentMessages = conversation.recentMessages.slice(-this.MAX_RECENT_MESSAGES);
    }
    
    // Auto-save
    if (this.enablePersistence) {
      await this.saveToDisk(chatId);
    }
    
    return conversation;
  }

  /**
   * Summarize oldest batch of messages using LLM
   * @param {string} chatId - Chat identifier
   * @returns {Promise<Object>} Generated summary
   */
  async summarizeOldMessages(chatId) {
    const conversation = this.getOrCreateConversation(chatId);
    
    if (conversation.recentMessages.length < this.SUMMARIZATION_BATCH_SIZE) {
      return null;
    }
    
    // Extract oldest batch
    const batchToSummarize = conversation.recentMessages.slice(0, this.SUMMARIZATION_BATCH_SIZE);
    
    // Build prompt for summarization
    const messagesText = batchToSummarize.map(m => 
      `${m.role === 'user' ? 'Cliente' : 'Atendente'}: ${m.content}`
    ).join('\n');
    
    const prompt = `Analise a seguinte conversa e crie um resumo estruturado:

${messagesText}

Retorne um JSON com:
{
  "summary": "Resumo conciso da conversa (2-3 frases)",
  "topics": ["tópico1", "tópico2"],
  "sentiment": "positive|neutral|negative",
  "unresolvedItems": ["item1", "item2"] ou []
}`;

    try {
      // FIX: usa AIRouter (com fallback) em vez de OpenAIProvider direto
      const response = await this.aiRouter.complete([
        { role: 'system', content: 'Você é um assistente que resume conversas de forma estruturada.' },
        { role: 'user', content: prompt }
      ], {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        maxTokens: 500,
        tenantId: this.tenantId, // isolamento de cache
      });
      
      const summaryData = JSON.parse(response.content);
      
      const summary = {
        summary: summaryData.summary,
        topics: summaryData.topics || [],
        sentiment: summaryData.sentiment || 'neutral',
        unresolvedItems: summaryData.unresolvedItems || [],
        messageCount: batchToSummarize.length,
        timestamp: Date.now()
      };
      
      // Add to summaries
      conversation.summaries.push(summary);
      
      // Keep only last MAX_SUMMARIES
      if (conversation.summaries.length > this.MAX_SUMMARIES) {
        conversation.summaries = conversation.summaries.slice(-this.MAX_SUMMARIES);
      }
      
      // Update profile with extracted data
      this.updateProfileFromSummary(conversation.profile, summary);
      
      // Remove summarized messages
      conversation.recentMessages = conversation.recentMessages.slice(this.SUMMARIZATION_BATCH_SIZE);
      
      this.stats.summariesGenerated++;
      
      return summary;
      
    } catch (error) {
      logger.error('[ConversationMemory] Summarization error:', error);
      return null;
    }
  }

  /**
   * Update client profile from summary data
   * @param {Object} profile - Client profile
   * @param {Object} summary - Summary object
   */
  updateProfileFromSummary(profile, summary) {
    // Merge topics
    if (summary.topics && summary.topics.length > 0) {
      const newTopics = summary.topics.filter(t => !profile.topicsDiscussed.includes(t));
      profile.topicsDiscussed.push(...newTopics);
      profile.topicsDiscussed = profile.topicsDiscussed.slice(-30); // Keep last 30
    }
    
    // Track satisfaction trend
    const sentimentScore = summary.sentiment === 'positive' ? 1 : 
                           summary.sentiment === 'negative' ? -1 : 0;
    profile.satisfactionTrend.push(sentimentScore);
    profile.satisfactionTrend = profile.satisfactionTrend.slice(-10); // Keep last 10
    
    // Merge unresolved items
    if (summary.unresolvedItems && summary.unresolvedItems.length > 0) {
      const newItems = summary.unresolvedItems.filter(
        item => !profile.unresolvedIssues.includes(item)
      );
      profile.unresolvedIssues.push(...newItems);
    }
  }

  /**
   * v10 NEW: Update client commercial intelligence signals.
   * Called by AIOrchestrator after every interaction to keep stage
   * and lastDominantIntent always up-to-date.
   *
   * Stage progression rules:
   *   cold        → interested  (quando intent = greeting/browse/product_info)
   *   interested  → warm        (quando intent = pricing/sales ou goal = fechar_venda)
   *   warm        → customer    (quando intent = purchase/checkout/payment)
   *   any         → inactive    (quando lastInteractionAt > 72h sem nova msg)
   *   inactive    → cold        (reativado ao voltar a interagir)
   *
   * @param {string} chatId
   * @param {Object} signals
   * @param {string} signals.intent        - Intent classificado pelo HybridIntentClassifier
   * @param {number} signals.confidence    - Confiança do intent
   * @param {string} signals.responseGoal  - Goal classificado pelo CommercialIntelligenceEngine
   */
  updateClientIntelligence(chatId, signals = {}) {
    const conversation = this.getOrCreateConversation(chatId);
    const profile = conversation.profile;
    const { intent, confidence = 0, responseGoal } = signals;

    // ── 1. Última interação ─────────────────────────────────────────────────
    const now = Date.now();
    const lastInteraction = profile.lastInteractionAt;
    const hoursSinceLast = lastInteraction
      ? (now - lastInteraction) / 1000 / 3600
      : null;

    profile.lastInteractionAt = now;

    // ── 2. Reativar cliente inativo ─────────────────────────────────────────
    if (profile.stage === 'inactive') {
      profile.stage = 'cold';
    }

    // ── 3. Detectar inatividade retroativa (> 72h) ──────────────────────────
    if (hoursSinceLast !== null && hoursSinceLast > 72 && profile.stage !== 'customer') {
      profile.stage = 'inactive';
    }

    // ── 4. Progressão de estágio baseada em intent/goal ────────────────────
    if (confidence >= 0.65) {
      // Purchase intents → customer
      if (['purchase', 'checkout', 'payment'].includes(intent)) {
        profile.stage = 'customer';
      }
      // High-interest / closing intents → warm
      else if (
        ['pricing', 'sales'].includes(intent) ||
        responseGoal === 'fechar_venda'
      ) {
        if (['cold', 'interested'].includes(profile.stage)) {
          profile.stage = 'warm';
        }
      }
      // Discovery intents → interested
      else if (
        ['greeting', 'browse', 'product_info', 'question'].includes(intent) &&
        profile.stage === 'cold'
      ) {
        profile.stage = 'interested';
      }
    }

    // ── 5. Atualizar lastDominantIntent e intentHistory ────────────────────
    if (intent && confidence >= 0.6) {
      profile.lastDominantIntent = intent;
      profile.intentHistory = [...(profile.intentHistory || []), intent].slice(-10);
    }

    // ── 6. Histórico de responseGoal ───────────────────────────────────────
    if (responseGoal) {
      profile.responseGoalHistory = [
        ...(profile.responseGoalHistory || []),
        responseGoal
      ].slice(-10);
    }

    conversation.updatedAt = now;
  }

  /**
   * Get full context for a chat
   * @param {string} chatId - Chat identifier
   * @returns {Object} Context with all three layers
   */
  getContext(chatId) {
    const conversation = this.getOrCreateConversation(chatId);
    
    return {
      recentMessages: conversation.recentMessages,
      summaries: conversation.summaries,
      profile: conversation.profile,
      // v10: expose commercial intelligence fields at top level for easy access
      clientStage: conversation.profile.stage || 'cold',
      lastDominantIntent: conversation.profile.lastDominantIntent || null,
      metadata: {
        chatId,
        messageCount: conversation.recentMessages.length,
        summaryCount: conversation.summaries.length,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt
      }
    };
  }

  /**
   * Format context for AI prompt with token budget
   * @param {Object} context - Context from getContext()
   * @param {number} maxTokens - Maximum tokens to use (default: 2000)
   * @returns {string} Formatted context string
   */
  formatForPrompt(context, maxTokens = 2000) {
    const parts = [];
    let estimatedTokens = 0;
    
    // Helper to estimate tokens (rough: 1 token ≈ 4 chars)
    const estimateTokens = (text) => Math.ceil(text.length / 4);
    
    // 1. Client Profile (highest priority)
    const profileText = this.formatProfile(context.profile);
    const profileTokens = estimateTokens(profileText);
    if (profileTokens < maxTokens * 0.3) {
      parts.push('=== PERFIL DO CLIENTE ===');
      parts.push(profileText);
      estimatedTokens += profileTokens;
    }
    
    // 2. Recent Messages (medium-high priority)
    if (context.recentMessages.length > 0) {
      parts.push('\n=== MENSAGENS RECENTES ===');
      const messagesToInclude = [];
      
      for (let i = context.recentMessages.length - 1; i >= 0; i--) {
        const msg = context.recentMessages[i];
        const msgText = `[${msg.role}]: ${msg.content}`;
        const msgTokens = estimateTokens(msgText);
        
        if (estimatedTokens + msgTokens > maxTokens * 0.9) break;
        
        messagesToInclude.unshift(msgText);
        estimatedTokens += msgTokens;
      }
      
      parts.push(messagesToInclude.join('\n'));
    }
    
    // 3. Summaries (if space remains)
    if (context.summaries.length > 0 && estimatedTokens < maxTokens * 0.7) {
      parts.push('\n=== RESUMOS DE CONVERSAS ANTERIORES ===');
      const summariesToInclude = [];
      
      for (let i = context.summaries.length - 1; i >= 0; i--) {
        const summary = context.summaries[i];
        const summaryText = this.formatSummary(summary);
        const summaryTokens = estimateTokens(summaryText);
        
        if (estimatedTokens + summaryTokens > maxTokens) break;
        
        summariesToInclude.unshift(summaryText);
        estimatedTokens += summaryTokens;
      }
      
      parts.push(summariesToInclude.join('\n'));
    }
    
    return parts.join('\n');
  }

  /**
   * Format client profile for prompt
   * @param {Object} profile - Client profile
   * @returns {string} Formatted profile
   */
  formatProfile(profile) {
    const parts = [];
    
    if (profile.name) parts.push(`Nome: ${profile.name}`);
    if (profile.preferredTone) parts.push(`Tom preferido: ${profile.preferredTone}`);
    if (profile.segment) parts.push(`Segmento: ${profile.segment}`);
    
    if (profile.topicsDiscussed.length > 0) {
      parts.push(`Tópicos discutidos: ${profile.topicsDiscussed.slice(-10).join(', ')}`);
    }
    
    if (profile.purchaseHistory.length > 0) {
      parts.push(`Histórico de compras: ${profile.purchaseHistory.length} compra(s)`);
    }
    
    if (profile.satisfactionTrend.length > 0) {
      const avgSatisfaction = profile.satisfactionTrend.reduce((a, b) => a + b, 0) / 
                              profile.satisfactionTrend.length;
      const trend = avgSatisfaction > 0.3 ? 'positiva' : 
                    avgSatisfaction < -0.3 ? 'negativa' : 'neutra';
      parts.push(`Tendência de satisfação: ${trend}`);
    }
    
    if (profile.unresolvedIssues.length > 0) {
      parts.push(`Pendências: ${profile.unresolvedIssues.join('; ')}`);
    }
    
    return parts.join('\n');
  }

  /**
   * Format summary for prompt
   * @param {Object} summary - Summary object
   * @returns {string} Formatted summary
   */
  formatSummary(summary) {
    const parts = [
      `Resumo: ${summary.summary}`,
      `Sentimento: ${summary.sentiment}`,
    ];
    
    if (summary.topics.length > 0) {
      parts.push(`Tópicos: ${summary.topics.join(', ')}`);
    }
    
    if (summary.unresolvedItems.length > 0) {
      parts.push(`Pendências: ${summary.unresolvedItems.join('; ')}`);
    }
    
    return parts.join(' | ');
  }

  /**
   * Update client profile
   * @param {string} chatId - Chat identifier
   * @param {Object} updates - Profile updates
   * @returns {Promise<Object>} Updated profile
   */
  async updateProfile(chatId, updates) {
    const conversation = this.getOrCreateConversation(chatId);
    
    Object.assign(conversation.profile, updates);
    conversation.updatedAt = Date.now();
    
    if (this.enablePersistence) {
      await this.saveToDisk(chatId);
    }
    
    return conversation.profile;
  }

  /**
   * Clear all memory for a chat
   * @param {string} chatId - Chat identifier
   * @returns {Promise<boolean>} Success
   */
  /**
   * FIX HIGH SECURITY: sanitiza chatId antes de usar como nome de arquivo.
   * chatId vem de input externo (extensão / API) — sem sanitização, um chatId como
   * `../../../etc/passwd` resulta em path.join escapando do storageDir.
   * Permitimos apenas: letras, dígitos, @, ., _, -, : (formatos comuns: 5511...@c.us)
   */
  _safeChatIdForFilename(chatId) {
    if (!chatId || typeof chatId !== 'string') return null;
    // Strip path separators e null bytes
    const cleaned = String(chatId)
      .replace(/[\x00\x01-\x1f]/g, '')
      .replace(/[\\/]/g, '_')
      .replace(/\.\./g, '_');
    // Allowlist: chars seguros em filenames
    if (!/^[A-Za-z0-9@._:\-]+$/.test(cleaned)) {
      // Hash fallback: aceita qualquer chatId mas converte para hash determinístico
      const crypto = require('crypto');
      return 'h_' + crypto.createHash('sha256').update(String(chatId)).digest('hex').substring(0, 32);
    }
    return cleaned;
  }

  async clearChat(chatId) {
    const deleted = this.conversations.delete(chatId);
    
    if (deleted && this.enablePersistence) {
      const safeId = this._safeChatIdForFilename(chatId);
      if (!safeId) return deleted;
      const filePath = path.join(this.storageDir, `${safeId}.json`);
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.error('[ConversationMemory] Error deleting file:', error);
        }
      }
    }
    
    return deleted;
  }

  /**
   * Get stats
   * @returns {Object} Stats object
   */
  getStats() {
    return {
      ...this.stats,
      activeChats: this.conversations.size
    };
  }

  /**
   * Save conversation to disk (P4: uses tenant-namespaced key)
   * P5 FIX: When a prismaAdapter is configured, persists to PostgreSQL.
   *         Falls back to JSON-file persistence if no adapter is present.
   * @param {string} chatId - Chat identifier
   */
  async saveToDisk(chatId) {
    if (!this.enablePersistence) return;

    // P4: use namespaced key consistently
    const key = `${this.tenantId}:${chatId}`;
    const conversation = this.conversations.get(key);
    if (!conversation) return;

    // P5: prefer DB persistence when adapter is available
    if (this.prismaAdapter) {
      try {
        await this.prismaAdapter.save(chatId, conversation);
        return;
      } catch (err) {
        logger.error('[ConversationMemory] DB save failed, falling back to file:', err.message);
      }
    }

    // Legacy JSON-file fallback
    // FIX HIGH SECURITY: sanitiza chatId antes de usar como filename (path traversal)
    const safeId = this._safeChatIdForFilename(chatId);
    if (!safeId) {
      logger.warn(`[ConversationMemory] chatId inválido descartado: ${String(chatId).substring(0, 50)}`);
      return;
    }
    const filePath = path.join(this.storageDir, `${safeId}.json`);
    try {
      await fs.writeFile(filePath, JSON.stringify(conversation, null, 2), 'utf8');
    } catch (error) {
      logger.error('[ConversationMemory] Error saving to disk:', error);
    }
  }

  /**
   * Load all conversations from disk (P4: restores under tenant-namespaced keys)
   */
  async loadFromDisk() {
    if (!this.enablePersistence) return;
    
    try {
      const files = await fs.readdir(this.storageDir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const filePath = path.join(this.storageDir, file);
        const data = await fs.readFile(filePath, 'utf8');
        const conversation = JSON.parse(data);

        // P4: restore under namespaced key; handle legacy files that have no tenantId
        const restoredTenant = conversation.tenantId || this.tenantId;
        const key = `${restoredTenant}:${conversation.chatId}`;
        this.conversations.set(key, conversation);
      }
      
      this.stats.totalChats = this.conversations.size;
      logger.info(`[ConversationMemory] Loaded ${this.conversations.size} conversations from disk (tenant: ${this.tenantId})`);

      
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error('[ConversationMemory] Error loading from disk:', error);
      }
    }
  }

  /**
   * Save all stats to disk
   */
  async saveStats() {
    if (!this.enablePersistence) return;
    
    const statsPath = path.join(this.storageDir, '_stats.json');
    
    try {
      await fs.writeFile(statsPath, JSON.stringify(this.stats, null, 2), 'utf8');
    } catch (error) {
      logger.error('[ConversationMemory] Error saving stats:', error);
    }
  }
}

module.exports = ConversationMemory;
