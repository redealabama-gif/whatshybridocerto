/**
 * 🎓 Validated Learning Pipeline - Browser Extension Version
 * WhatsHybrid AI System v7.9.13
 * 
 * Implements strict validation criteria for pattern graduation:
 * - Minimum 5 samples required before graduation
 * - Minimum 80% positive feedback rate for graduation
 * - Automatic discard if positive rate < 30% with 5+ feedback
 * - Tracks response effectiveness per pattern
 * - Emits events on graduation/discard via EventBus
 * 
 * @module ValidatedLearningPipeline
 * @version 1.0.0
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'whl_validated_learning';
  
  /**
   * Feedback types allowed for pattern validation
   * @typedef {'positive'|'negative'|'neutral'|'edited'|'converted'} FeedbackType
   */

  /**
   * Interaction data for learning
   * @typedef {Object} InteractionData
   * @property {string} intent - Intent classification
   * @property {string} question - Original user question
   * @property {string} response - AI-generated response
   * @property {FeedbackType} feedback - User feedback type
   * @property {boolean} [wasEdited] - Whether response was edited
   * @property {string} [editedResponse] - The edited version if wasEdited=true
   */

  /**
   * Pattern statistics
   * @typedef {Object} PatternStats
   * @property {string} key - Pattern key
   * @property {string} intent - Intent classification
   * @property {number} sampleCount - Number of samples
   * @property {number} positiveCount - Positive feedback count
   * @property {number} negativeCount - Negative feedback count
   * @property {number} neutralCount - Neutral feedback count
   * @property {number} editedCount - Edited feedback count
   * @property {number} convertedCount - Converted feedback count
   * @property {number} positiveRate - Positive feedback rate (0-1)
   * @property {Object.<string, number>} responses - Response text usage counts
   * @property {string} topResponse - Most commonly used response
   * @property {number} createdAt - Timestamp when pattern was created
   * @property {number} lastInteractionAt - Timestamp of last interaction
   */

  /**
   * Graduated pattern
   * @typedef {Object} GraduatedPattern
   * @property {string} key - Pattern key
   * @property {string} intent - Intent classification
   * @property {string} topResponse - Most validated response
   * @property {number} positiveRate - Final positive rate
   * @property {number} sampleCount - Total samples used
   * @property {number} graduatedAt - Timestamp of graduation
   */

  // ============================================
  // 🛡️ SECURITY: Prototype Pollution Protection
  // ============================================

  /**
   * Sanitize object to prevent prototype pollution
   * @param {*} obj - Object to sanitize
   * @returns {Object} Sanitized object
   */
  function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const sanitized = {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key) && !dangerousKeys.includes(key)) {
        const value = obj[key];
        if (Array.isArray(value)) {
          sanitized[key] = value.map(item =>
            (item && typeof item === 'object') ? sanitizeObject(item) : item
          );
        } else if (value && typeof value === 'object') {
          sanitized[key] = sanitizeObject(value);
        } else {
          sanitized[key] = value;
        }
      }
    }

    return sanitized;
  }

  /**
   * ValidatedLearningPipeline class for browser extension
   */
  class ValidatedLearningPipeline {
    /**
     * Create a new ValidatedLearningPipeline
     * @param {Object} options - Configuration options
     * @param {number} [options.minSamples] - Minimum samples for graduation (default: 5)
     * @param {number} [options.minPositiveRate] - Minimum positive rate for graduation (default: 0.8)
     * @param {number} [options.discardThreshold] - Discard if positive rate below this (default: 0.3)
     */
    constructor(options = {}) {
      this.minSamples = options.minSamples || 5;
      this.minPositiveRate = options.minPositiveRate || 0.8;
      this.discardThreshold = options.discardThreshold || 0.3;
      
      /** @type {Map<string, PatternStats>} */
      this.candidates = new Map();
      
      /** @type {Map<string, GraduatedPattern>} */
      this.graduated = new Map();
      
      /** @type {Set<string>} */
      this.discarded = new Set();
      
      this.totalInteractions = 0;
      this.initialized = false;
    }

    /**
     * Initialize the learning pipeline
     * @returns {Promise<void>}
     */
    async init() {
      if (this.initialized) return;
      
      try {
        await this._loadFromStorage();
        this.initialized = true;
        console.log('[ValidatedLearningPipeline] ✅ Initialized with', this.candidates.size, 'candidates,', this.graduated.size, 'graduated');
      } catch (error) {
        console.error('[ValidatedLearningPipeline] Initialization error:', error);
        throw error;
      }
    }

    /**
     * Record an interaction for learning
     * @param {InteractionData} data - Interaction data
     * @returns {Promise<void>}
     */
    async recordInteraction(data) {
      const { intent, question, response, feedback, wasEdited, editedResponse } = data;
      
      // Validate required fields
      if (!intent || !question || !response || !feedback) {
        throw new Error('Missing required fields: intent, question, response, feedback');
      }
      
      // Validate feedback type
      const validFeedback = ['positive', 'negative', 'neutral', 'edited', 'converted'];
      if (!validFeedback.includes(feedback)) {
        throw new Error(`Invalid feedback type: ${feedback}. Must be one of: ${validFeedback.join(', ')}`);
      }
      
      // Create normalized pattern key
      const patternKey = this._normalizePatternKey(question);
      
      // Check if pattern is already graduated or discarded
      if (this.graduated.has(patternKey)) {
        console.log('[ValidatedLearningPipeline] Pattern already graduated:', patternKey);
        return;
      }
      
      if (this.discarded.has(patternKey)) {
        console.log('[ValidatedLearningPipeline] Pattern was discarded:', patternKey);
        return;
      }
      
      // Get or create candidate pattern
      const candidate = this.candidates.get(patternKey) || {
        key: patternKey,
        intent,
        sampleCount: 0,
        positiveCount: 0,
        negativeCount: 0,
        neutralCount: 0,
        editedCount: 0,
        convertedCount: 0,
        positiveRate: 0,
        responses: {},
        topResponse: '',
        createdAt: Date.now(),
        lastInteractionAt: 0
      };
      
      // Determine which response to track
      const responseToTrack = wasEdited && editedResponse ? editedResponse : response;
      
      // Update response tracking
      candidate.responses[responseToTrack] = (candidate.responses[responseToTrack] || 0) + 1;
      
      // Update feedback counts
      candidate.sampleCount++;
      
      switch (feedback) {
        case 'positive':
          candidate.positiveCount++;
          break;
        case 'negative':
          candidate.negativeCount++;
          break;
        case 'neutral':
          candidate.neutralCount++;
          break;
        case 'edited':
          candidate.editedCount++;
          // Treat edits as negative feedback for the original response
          candidate.negativeCount++;
          break;
        case 'converted':
          candidate.convertedCount++;
          candidate.positiveCount++;
          break;
      }
      
      // Calculate positive rate
      const totalFeedback = candidate.positiveCount + candidate.negativeCount;
      candidate.positiveRate = totalFeedback > 0 ? candidate.positiveCount / totalFeedback : 0;
      
      // Find top response
      candidate.topResponse = this._findTopResponse(candidate.responses);
      
      candidate.lastInteractionAt = Date.now();
      
      // Save updated candidate
      this.candidates.set(patternKey, candidate);
      this.totalInteractions++;
      
      // Check graduation criteria
      await this._evaluatePattern(patternKey, candidate);
      
      // Persist to storage
      await this._saveToStorage();
    }

    /**
     * Get all graduated patterns
     * @returns {GraduatedPattern[]} Array of graduated patterns
     */
    getGraduated() {
      return Array.from(this.graduated.values());
    }

    /**
     * Get all candidate patterns with their stats
     * @returns {PatternStats[]} Array of candidate patterns
     */
    getCandidates() {
      return Array.from(this.candidates.values());
    }

    /**
     * Get learning pipeline statistics
     * @returns {Object} Statistics object
     */
    getStats() {
      return {
        candidates: this.candidates.size,
        graduated: this.graduated.size,
        discarded: this.discarded.size,
        totalInteractions: this.totalInteractions,
        avgPositiveRate: this._calculateAvgPositiveRate()
      };
    }

    /**
     * Reset all learning data
     * @returns {Promise<void>}
     */
    async reset() {
      this.candidates.clear();
      this.graduated.clear();
      this.discarded.clear();
      this.totalInteractions = 0;
      
      await this._saveToStorage();
      
      console.log('[ValidatedLearningPipeline] 🔄 Reset complete');
    }

    // ============================================
    // PRIVATE METHODS
    // ============================================

    /**
     * Normalize pattern key for consistent matching
     * @private
     * @param {string} text - Text to normalize
     * @returns {string} Normalized pattern key
     */
    _normalizePatternKey(text) {
      if (!text || typeof text !== 'string') return '';
      
      // Convert to lowercase
      let normalized = text.toLowerCase();
      
      // Remove punctuation
      normalized = normalized.replace(/[^\w\s]/g, ' ');
      
      // Split into words and sort
      const words = normalized
        .split(/\s+/)
        .filter(w => w.length > 0)
        .sort();
      
      // Join and truncate to 100 chars
      normalized = words.join(' ').substring(0, 100);
      
      return normalized;
    }

    /**
     * Find the most commonly used response
     * @private
     * @param {Object.<string, number>} responses - Response usage counts
     * @returns {string} Most common response
     */
    _findTopResponse(responses) {
      let topResponse = '';
      let maxCount = 0;
      
      for (const [response, count] of Object.entries(responses)) {
        if (count > maxCount) {
          maxCount = count;
          topResponse = response;
        }
      }
      
      return topResponse;
    }

    /**
     * Evaluate pattern for graduation or discard
     * @private
     * @param {string} patternKey - Pattern key
     * @param {PatternStats} candidate - Candidate pattern
     * @returns {Promise<void>}
     */
    async _evaluatePattern(patternKey, candidate) {
      const { sampleCount, positiveRate } = candidate;
      
      // Need at least minSamples before evaluation
      if (sampleCount < this.minSamples) {
        return;
      }
      
      // Check for discard (poor performance)
      if (positiveRate < this.discardThreshold) {
        this.candidates.delete(patternKey);
        this.discarded.add(patternKey);
        
        console.log('[ValidatedLearningPipeline] ❌ Pattern discarded:', patternKey, `(${(positiveRate * 100).toFixed(1)}% positive)`);
        
        // Emit discard event
        this._emitEvent('pattern:discarded', {
          key: patternKey,
          intent: candidate.intent,
          positiveRate,
          sampleCount,
          discardedAt: Date.now()
        });
        
        return;
      }
      
      // Check for graduation (excellent performance)
      if (positiveRate >= this.minPositiveRate) {
        const graduated = {
          key: patternKey,
          intent: candidate.intent,
          topResponse: candidate.topResponse,
          positiveRate,
          sampleCount,
          graduatedAt: Date.now()
        };
        
        this.graduated.set(patternKey, graduated);
        this.candidates.delete(patternKey);
        
        console.log('[ValidatedLearningPipeline] 🎓 Pattern graduated:', patternKey, `(${(positiveRate * 100).toFixed(1)}% positive)`);
        
        // Emit graduation event
        this._emitEvent('pattern:graduated', graduated);
      }
    }

    /**
     * Calculate average positive rate across all candidates
     * @private
     * @returns {number} Average positive rate
     */
    _calculateAvgPositiveRate() {
      if (this.candidates.size === 0) return 0;
      
      let sum = 0;
      for (const candidate of this.candidates.values()) {
        sum += candidate.positiveRate;
      }
      
      return sum / this.candidates.size;
    }

    /**
     * Emit event via EventBus if available
     * @private
     * @param {string} eventName - Event name
     * @param {*} data - Event data
     */
    _emitEvent(eventName, data) {
      if (window.EventBus && typeof window.EventBus.emit === 'function') {
        window.EventBus.emit(eventName, data);
      }
    }

    /**
     * Load data from chrome.storage.local
     * @private
     * @returns {Promise<void>}
     */
    async _loadFromStorage() {
      try {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        
        if (result[STORAGE_KEY]) {
          const parsed = JSON.parse(result[STORAGE_KEY]);
          const data = sanitizeObject(parsed);
          
          // Restore candidates
          if (data.candidates && Array.isArray(data.candidates)) {
            for (const candidate of data.candidates) {
              this.candidates.set(candidate.key, candidate);
            }
          }
          
          // Restore graduated
          if (data.graduated && Array.isArray(data.graduated)) {
            for (const pattern of data.graduated) {
              this.graduated.set(pattern.key, pattern);
            }
          }
          
          // Restore discarded
          if (data.discarded && Array.isArray(data.discarded)) {
            this.discarded = new Set(data.discarded);
          }
          
          // Restore total interactions
          if (typeof data.totalInteractions === 'number') {
            this.totalInteractions = data.totalInteractions;
          }
        }
        
      } catch (error) {
        console.error('[ValidatedLearningPipeline] Error loading storage:', error);
      }
    }

    /**
     * Save data to chrome.storage.local
     * @private
     * @returns {Promise<void>}
     */
    async _saveToStorage() {
      try {
        const data = {
          candidates: Array.from(this.candidates.values()),
          graduated: Array.from(this.graduated.values()),
          discarded: Array.from(this.discarded),
          totalInteractions: this.totalInteractions,
          savedAt: Date.now()
        };
        
        await chrome.storage.local.set({
          [STORAGE_KEY]: JSON.stringify(data)
        });
        
      } catch (error) {
        console.error('[ValidatedLearningPipeline] Error saving storage:', error);
        throw error;
      }
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  
  window.ValidatedLearningPipeline = ValidatedLearningPipeline;
  
  console.log('[ValidatedLearningPipeline] ✅ Module loaded');

})();
