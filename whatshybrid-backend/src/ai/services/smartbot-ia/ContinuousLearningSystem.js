/**
 * ContinuousLearningSystem
 * @file Extraído de SmartBotIAService.js (refactor v9)
 */

const logger = require('../../../utils/logger');

class ContinuousLearningSystem {
  constructor(storage = null) {
    this.storage = storage;
    this.feedbackBuffer = [];
    this.knowledgeBase = new Map();
    this.patternStats = new Map();
    this.batchSize = 10;
    this.minConfidence = 0.3;
  }

  async loadData() {
    if (this.storage) {
      try {
        const data = await this.storage.get('smartbot_learning');
        if (data) {
          if (data.knowledgeBase) {
            Object.entries(data.knowledgeBase).forEach(([key, value]) => {
              this.knowledgeBase.set(key, value);
            });
          }
          if (data.patternStats) {
            Object.entries(data.patternStats).forEach(([key, value]) => {
              this.patternStats.set(key, value);
            });
          }
        }
      } catch (error) {
        logger.warn('[SmartBot Learning] Error loading data:', error);
      }
    }
  }

  async saveData() {
    if (this.storage) {
      try {
        await this.storage.set('smartbot_learning', {
          knowledgeBase: Object.fromEntries(this.knowledgeBase),
          patternStats: Object.fromEntries(this.patternStats)
        });
      } catch (error) {
        logger.warn('[SmartBot Learning] Error saving data:', error);
      }
    }
  }

  recordFeedback(feedback) {
    this.feedbackBuffer.push({
      ...feedback,
      timestamp: new Date().toISOString()
    });

    if (this.feedbackBuffer.length >= this.batchSize) {
      this.processFeedbackBatch();
    }

    return true;
  }

  async processFeedbackBatch() {
    if (this.feedbackBuffer.length === 0) return;

    const batch = [...this.feedbackBuffer];
    this.feedbackBuffer = [];

    for (const feedback of batch) {
      await this.learnFromFeedback(feedback);
    }

    this.optimizeKnowledgeBase();
    await this.saveData();
  }

  async learnFromFeedback(feedback) {
    const { input, response, rating, context } = feedback;
    
    const patterns = this.extractPatterns(input);
    
    patterns.forEach(pattern => {
      const key = pattern.toLowerCase();
      
      if (!this.patternStats.has(key)) {
        this.patternStats.set(key, {
          pattern: key,
          positive: 0,
          negative: 0,
          responses: [],
          avgRating: 0,
          lastUpdated: new Date().toISOString()
        });
      }
      
      const stats = this.patternStats.get(key);
      
      if (rating >= 4) {
        stats.positive++;
        if (!stats.responses.some(r => this.similarity(r, response) > 0.8)) {
          stats.responses.push({
            text: response,
            rating,
            context: context?.intent || 'general'
          });
        }
      } else if (rating <= 2) {
        stats.negative++;
      }
      
      const total = stats.positive + stats.negative;
      stats.avgRating = (stats.avgRating * (total - 1) + rating) / total;
      stats.lastUpdated = new Date().toISOString();
    });
  }

  extractPatterns(text) {
    if (!text) return [];
    
    const words = text.toLowerCase()
      .replace(/[^\w\sáéíóúãõâêôç]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2);
    
    const patterns = [];
    
    patterns.push(...words);
    
    for (let i = 0; i < words.length - 1; i++) {
      patterns.push(`${words[i]} ${words[i + 1]}`);
    }
    
    for (let i = 0; i < words.length - 2; i++) {
      patterns.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
    
    return patterns;
  }

  similarity(text1, text2) {
    if (typeof text1 === 'object') text1 = text1.text || '';
    if (typeof text2 === 'object') text2 = text2.text || '';
    
    const set1 = new Set(text1.toLowerCase().split(/\s+/));
    const set2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  optimizeKnowledgeBase() {
    for (const [key, stats] of this.patternStats.entries()) {
      const total = stats.positive + stats.negative;
      const confidence = total > 0 ? stats.positive / total : 0;
      
      if (confidence < this.minConfidence && total > 5) {
        this.patternStats.delete(key);
        continue;
      }
      
      if (stats.responses.length > 1) {
        const uniqueResponses = [];
        for (const response of stats.responses) {
          if (!uniqueResponses.some(r => this.similarity(r.text, response.text) > 0.7)) {
            uniqueResponses.push(response);
          }
        }
        stats.responses = uniqueResponses;
      }
    }
  }

  getSuggestedResponses(input, context = {}) {
    const patterns = this.extractPatterns(input);
    const suggestions = [];
    
    patterns.forEach(pattern => {
      const stats = this.patternStats.get(pattern.toLowerCase());
      
      if (stats && stats.responses.length > 0) {
        const confidence = stats.positive / (stats.positive + stats.negative + 1);
        
        stats.responses.forEach(response => {
          if (!suggestions.some(s => this.similarity(s.text, response.text) > 0.7)) {
            suggestions.push({
              text: response.text,
              confidence,
              pattern,
              rating: response.rating,
              source: 'learned'
            });
          }
        });
      }
    });
    
    return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
  }

  getStats() {
    const patterns = Array.from(this.patternStats.values());
    
    return {
      totalPatterns: patterns.length,
      totalFeedback: patterns.reduce((sum, p) => sum + p.positive + p.negative, 0),
      avgRating: patterns.length > 0 
        ? patterns.reduce((sum, p) => sum + p.avgRating, 0) / patterns.length 
        : 0,
      topPatterns: patterns
        .sort((a, b) => (b.positive - b.negative) - (a.positive - a.negative))
        .slice(0, 10)
        .map(p => ({ pattern: p.pattern, score: p.positive - p.negative })),
      bufferSize: this.feedbackBuffer.length
    };
  }

  flush() {
    return this.processFeedbackBatch();
  }

  async reset() {
    this.feedbackBuffer = [];
    this.knowledgeBase.clear();
    this.patternStats.clear();
    if (this.storage) {
      await this.storage.delete('smartbot_learning');
    }
  }
}

// ============================================================
// SMART METRICS SYSTEM
// ============================================================

module.exports = ContinuousLearningSystem;
