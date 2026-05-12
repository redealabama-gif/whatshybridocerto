/**
 * AI Analytics Collector Module - Tracks AI performance metrics
 * @module ai-analytics-collector
 */

(function() {
  'use strict';

  /**
   * Collects and analyzes AI performance metrics
   */
  class AIAnalyticsCollector {
    constructor() {
      this.interactions = [];
      this.knowledgeGaps = [];
      this.metrics = {
        responseAccuracy: [],
        avgConfidence: [],
        intentAccuracy: [],
        avgLatency: [],
        tokenUsage: []
      };
    }

    /**
     * Record an AI interaction
     * @param {Object} interaction - Interaction data
     * @returns {string} Interaction ID
     */
    recordInteraction(interaction) {
      const record = {
        id: `int_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        chatId: interaction.chatId,
        message: interaction.message,
        intent: interaction.intent,
        confidence: interaction.confidence,
        response: interaction.response,
        latency: interaction.latency,
        tokenCount: interaction.tokenCount || 0,
        feedback: null,
        metadata: interaction.metadata || {}
      };

      this.interactions.push(record);
      this._updateMetrics(record);

      console.log(`[Analytics] Recorded interaction: ${record.id}`);
      return record.id;
    }

    /**
     * Record a knowledge gap
     * @param {Object} gap - Knowledge gap data
     */
    recordKnowledgeGap(gap) {
      const record = {
        id: `gap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        chatId: gap.chatId,
        question: gap.question,
        intent: gap.intent,
        confidence: gap.confidence,
        reason: gap.reason || 'low_confidence',
        context: gap.context || {},
        resolved: false
      };

      this.knowledgeGaps.push(record);
      console.log(`[Analytics] Recorded knowledge gap: ${record.question}`);
      
      return record.id;
    }

    /**
     * Generate weekly report
     * @param {Date} startDate - Start date for report
     * @param {Date} endDate - End date for report
     * @returns {Object} Weekly analytics report
     */
    generateWeeklyReport(startDate = null, endDate = null) {
      const end = endDate || new Date();
      const start = startDate || new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

      const weeklyInteractions = this.interactions.filter(i => 
        i.timestamp >= start && i.timestamp <= end
      );

      const weeklyGaps = this.knowledgeGaps.filter(g => 
        g.timestamp >= start && g.timestamp <= end
      );

      const totalInteractions = weeklyInteractions.length;
      const avgConfidence = this._average(weeklyInteractions.map(i => i.confidence));
      const avgLatency = this._average(weeklyInteractions.map(i => i.latency));
      const totalTokens = weeklyInteractions.reduce((sum, i) => sum + i.tokenCount, 0);

      const intentCounts = {};
      weeklyInteractions.forEach(i => {
        intentCounts[i.intent] = (intentCounts[i.intent] || 0) + 1;
      });

      const feedbackReceived = weeklyInteractions.filter(i => i.feedback !== null);
      const positiveFeedback = feedbackReceived.filter(i => i.feedback === 'positive').length;
      const negativeFeedback = feedbackReceived.filter(i => i.feedback === 'negative').length;

      const gapsByQuestion = {};
      weeklyGaps.forEach(g => {
        const key = g.question.toLowerCase();
        gapsByQuestion[key] = (gapsByQuestion[key] || 0) + 1;
      });
      
      const topGaps = Object.entries(gapsByQuestion)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([question, count]) => ({ question, count }));

      return {
        period: { start, end },
        summary: {
          totalInteractions,
          avgConfidence: avgConfidence.toFixed(3),
          avgLatency: avgLatency.toFixed(0),
          totalTokens,
          knowledgeGaps: weeklyGaps.length
        },
        intents: intentCounts,
        feedback: {
          received: feedbackReceived.length,
          positive: positiveFeedback,
          negative: negativeFeedback,
          satisfaction: feedbackReceived.length > 0 
            ? (positiveFeedback / feedbackReceived.length * 100).toFixed(1) + '%'
            : 'N/A'
        },
        topKnowledgeGaps: topGaps,
        generatedAt: new Date()
      };
    }

    /**
     * Get current metrics summary
     * @returns {Object} Current metrics
     */
    getMetricsSummary() {
      const recentInteractions = this.interactions.slice(-100);
      
      return {
        totalInteractions: this.interactions.length,
        totalKnowledgeGaps: this.knowledgeGaps.length,
        last24h: {
          interactions: this._countLast24h(this.interactions),
          knowledgeGaps: this._countLast24h(this.knowledgeGaps)
        },
        recent: {
          avgConfidence: this._average(recentInteractions.map(i => i.confidence)),
          avgLatency: this._average(recentInteractions.map(i => i.latency)),
          avgTokens: this._average(recentInteractions.map(i => i.tokenCount))
        },
        trends: {
          responseAccuracy: this._getTrend(this.metrics.responseAccuracy),
          confidence: this._getTrend(this.metrics.avgConfidence),
          latency: this._getTrend(this.metrics.avgLatency)
        }
      };
    }

    /**
     * Update interaction with feedback
     * @param {string} interactionId - Interaction ID
     * @param {string} feedback - Feedback type
     */
    updateFeedback(interactionId, feedback) {
      const interaction = this.interactions.find(i => i.id === interactionId);
      if (interaction) {
        interaction.feedback = feedback;
        console.log(`[Analytics] Updated feedback for ${interactionId}: ${feedback}`);
      }
    }

    _updateMetrics(record) {
      const timestamp = Date.now();
      
      this.metrics.avgConfidence.push({ timestamp, value: record.confidence });
      this.metrics.avgLatency.push({ timestamp, value: record.latency });
      this.metrics.tokenUsage.push({ timestamp, value: record.tokenCount });

      Object.keys(this.metrics).forEach(key => {
        if (this.metrics[key].length > 1000) {
          this.metrics[key] = this.metrics[key].slice(-1000);
        }
      });
    }

    _average(arr) {
      if (arr.length === 0) return 0;
      return arr.reduce((sum, val) => sum + (val || 0), 0) / arr.length;
    }

    _countLast24h(items) {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return items.filter(item => item.timestamp >= yesterday).length;
    }

    _getTrend(metricData) {
      if (metricData.length < 10) return 'stable';
      
      const recent = metricData.slice(-10);
      const older = metricData.slice(-20, -10);
      
      if (older.length === 0) return 'stable';
      
      const recentAvg = this._average(recent.map(d => d.value));
      const olderAvg = this._average(older.map(d => d.value));
      const change = (recentAvg - olderAvg) / olderAvg;
      
      if (change > 0.05) return 'up';
      if (change < -0.05) return 'down';
      return 'stable';
    }
  }

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AIAnalyticsCollector;
  } else {
    window.AIAnalyticsCollector = AIAnalyticsCollector;
  }
})();
