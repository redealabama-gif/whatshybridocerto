/**
 * 🧠 ConversationMemory - Three-Layer Memory Architecture (Extension)
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
 * - Chrome storage persistence
 * - AIGateway integration for LLM calls
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  // ============================================
  // CONFIGURATION
  // ============================================
  
  const CONFIG = {
    STORAGE_KEY: 'whl_conversation_memory',
    STATS_KEY: 'whl_conversation_memory_stats',
    MAX_RECENT_MESSAGES: 20,
    MAX_SUMMARIES: 10,
    SUMMARIZATION_THRESHOLD: 30,
    SUMMARIZATION_BATCH_SIZE: 10,
    SAVE_DEBOUNCE_MS: 2000,
    DEBUG: false
  };

  // ============================================
  // CONVERSATION MEMORY CLASS
  // ============================================
  
  class ConversationMemory {
    constructor() {
      this.conversations = new Map();
      this.initialized = false;
      this.saveTimeout = null;
      
      // Stats
      this.stats = {
        totalChats: 0,
        totalMessages: 0,
        summariesGenerated: 0,
        lastUpdated: null
      };
    }

    /**
     * Initialize the memory system
     * @returns {Promise<void>}
     */
    async init() {
      if (this.initialized) return;
      
      try {
        await this.loadFromStorage();
        this.initialized = true;
        
        if (CONFIG.DEBUG) {
          console.log('[ConversationMemory] Initialized with', this.conversations.size, 'conversations');
        }
      } catch (error) {
        console.error('[ConversationMemory] Initialization error:', error);
        throw error;
      }
    }

    /**
     * Get or create conversation memory structure
     * @param {string} chatId - Chat identifier
     * @returns {Object} Conversation memory object
     */
    getOrCreateConversation(chatId) {
      const key = this.normalizeKey(chatId);
      
      if (!this.conversations.has(key)) {
        this.conversations.set(key, {
          chatId: key,
          recentMessages: [],
          summaries: [],
          profile: {
            name: '',
            preferredTone: 'professional',
            segment: 'new',
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
     * @param {number} [message.timestamp] - Optional timestamp
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
      if (conversation.recentMessages.length >= CONFIG.SUMMARIZATION_THRESHOLD) {
        await this.summarizeOldMessages(chatId);
      }
      
      // Keep only last MAX_RECENT_MESSAGES
      if (conversation.recentMessages.length > CONFIG.MAX_RECENT_MESSAGES) {
        conversation.recentMessages = conversation.recentMessages.slice(-CONFIG.MAX_RECENT_MESSAGES);
      }
      
      // Auto-save (debounced)
      this.scheduleSave();
      
      return conversation;
    }

    /**
     * Summarize oldest batch of messages using LLM
     * @param {string} chatId - Chat identifier
     * @returns {Promise<Object|null>} Generated summary
     */
    async summarizeOldMessages(chatId) {
      const conversation = this.getOrCreateConversation(chatId);
      
      if (conversation.recentMessages.length < CONFIG.SUMMARIZATION_BATCH_SIZE) {
        return null;
      }
      
      // Extract oldest batch
      const batchToSummarize = conversation.recentMessages.slice(0, CONFIG.SUMMARIZATION_BATCH_SIZE);
      
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
        // Check if AIGateway is available
        if (!window.AIGateway) {
          console.error('[ConversationMemory] AIGateway not available');
          return null;
        }
        
        // Call LLM via AIGateway
        const response = await window.AIGateway.complete({
          messages: [
            { role: 'system', content: 'Você é um assistente que resume conversas de forma estruturada.' },
            { role: 'user', content: prompt }
          ],
          options: {
            model: 'gpt-4o-mini',
            temperature: 0.3,
            maxTokens: 500
          }
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
        if (conversation.summaries.length > CONFIG.MAX_SUMMARIES) {
          conversation.summaries = conversation.summaries.slice(-CONFIG.MAX_SUMMARIES);
        }
        
        // Update profile with extracted data
        this.updateProfileFromSummary(conversation.profile, summary);
        
        // Remove summarized messages
        conversation.recentMessages = conversation.recentMessages.slice(CONFIG.SUMMARIZATION_BATCH_SIZE);
        
        this.stats.summariesGenerated++;
        
        if (CONFIG.DEBUG) {
          console.log('[ConversationMemory] Generated summary:', summary.summary);
        }
        
        return summary;
        
      } catch (error) {
        console.error('[ConversationMemory] Summarization error:', error);
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
     * @param {number} [maxTokens=2000] - Maximum tokens to use
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
      
      this.scheduleSave();
      
      return conversation.profile;
    }

    /**
     * Clear all memory for a chat
     * @param {string} chatId - Chat identifier
     * @returns {Promise<boolean>} Success
     */
    async clearChat(chatId) {
      const key = this.normalizeKey(chatId);
      const deleted = this.conversations.delete(key);
      
      if (deleted) {
        await this.saveToStorage();
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
     * Normalize chat ID
     * @param {string} chatId - Raw chat ID
     * @returns {string} Normalized chat ID
     */
    normalizeKey(chatId) {
      return String(chatId).replace(/@[cs]\.us$/i, '').replace(/\D/g, '');
    }

    /**
     * Schedule a save operation (debounced)
     */
    scheduleSave() {
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
      }
      
      this.saveTimeout = setTimeout(() => {
        this.saveToStorage().catch(err => {
          console.error('[ConversationMemory] Auto-save failed:', err);
        });
      }, CONFIG.SAVE_DEBOUNCE_MS);
    }

    /**
     * Save conversations to Chrome storage
     * @returns {Promise<void>}
     */
    async saveToStorage() {
      try {
        const data = Object.fromEntries(this.conversations);
        
        await chrome.storage.local.set({
          [CONFIG.STORAGE_KEY]: JSON.stringify(data),
          [CONFIG.STATS_KEY]: JSON.stringify(this.stats)
        });
        
        if (CONFIG.DEBUG) {
          console.log('[ConversationMemory] Saved', this.conversations.size, 'conversations');
        }
      } catch (error) {
        console.error('[ConversationMemory] Save error:', error);
        throw error;
      }
    }

    /**
     * Load conversations from Chrome storage
     * @returns {Promise<void>}
     */
    async loadFromStorage() {
      try {
        const data = await chrome.storage.local.get([CONFIG.STORAGE_KEY, CONFIG.STATS_KEY]);
        
        if (data[CONFIG.STORAGE_KEY]) {
          const stored = JSON.parse(data[CONFIG.STORAGE_KEY]);
          Object.entries(stored).forEach(([key, value]) => {
            this.conversations.set(key, value);
          });
        }
        
        if (data[CONFIG.STATS_KEY]) {
          Object.assign(this.stats, JSON.parse(data[CONFIG.STATS_KEY]));
        }
        
        if (CONFIG.DEBUG) {
          console.log('[ConversationMemory] Loaded', this.conversations.size, 'conversations');
        }
      } catch (error) {
        console.error('[ConversationMemory] Load error:', error);
        // Don't throw - just start with empty state
      }
    }

    /**
     * Export all conversations (for backup/debugging)
     * @returns {Object} All conversations data
     */
    export() {
      return {
        conversations: Object.fromEntries(this.conversations),
        stats: this.stats,
        timestamp: Date.now()
      };
    }

    /**
     * Import conversations (from backup)
     * @param {Object} data - Exported data
     * @returns {Promise<void>}
     */
    async import(data) {
      if (data.conversations) {
        this.conversations.clear();
        Object.entries(data.conversations).forEach(([key, value]) => {
          this.conversations.set(key, value);
        });
      }
      
      if (data.stats) {
        Object.assign(this.stats, data.stats);
      }
      
      await this.saveToStorage();
      
      if (CONFIG.DEBUG) {
        console.log('[ConversationMemory] Imported', this.conversations.size, 'conversations');
      }
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  
  window.ConversationMemory = ConversationMemory;
  
  // Auto-initialize if not already done
  if (!window.conversationMemory) {
    window.conversationMemory = new ConversationMemory();
    window.conversationMemory.init().then(() => {
      if (CONFIG.DEBUG) {
        console.log('[ConversationMemory] ✅ System initialized');
      }
    }).catch(error => {
      console.error('[ConversationMemory] ❌ Initialization failed:', error);
    });
  }

  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    if (window.conversationMemory?.saveTimeout) {
      clearTimeout(window.conversationMemory.saveTimeout);
      // Force immediate save
      window.conversationMemory.saveToStorage().catch(() => {});
    }
  });

})();
