/**
 * SmartMetricsSystem
 * @file Extraído de SmartBotIAService.js (refactor v9)
 */

const EventEmitter = require('events');
const logger = require('../../../utils/logger');

class SmartMetricsSystem extends EventEmitter {
  constructor(storage = null) {
    super();
    this.storage = storage;
    this.metrics = {
      messages: { total: 0, today: 0, byHour: new Array(24).fill(0) },
      responses: { total: 0, aiGenerated: 0, manual: 0 },
      sentiment: { positive: 0, neutral: 0, negative: 0 },
      responseTime: { total: 0, count: 0, avg: 0 },
      escalations: { total: 0, rate: 0 },
      satisfaction: { total: 0, count: 0, avg: 0 }
    };
    this.history = [];
    this.anomalyThresholds = {
      escalationRate: 0.3,
      negativeRate: 0.4,
      avgResponseTime: 60000
    };
  }

  async loadMetrics() {
    if (this.storage) {
      try {
        const data = await this.storage.get('smartbot_metrics');
        if (data) {
          this.metrics = { ...this.metrics, ...data.metrics };
          this.history = data.history || [];
        }
      } catch (error) {
        logger.warn('[SmartBot Metrics] Error loading:', error);
      }
    }
  }

  async saveMetrics() {
    if (this.storage) {
      try {
        await this.storage.set('smartbot_metrics', {
          metrics: this.metrics,
          history: this.history.slice(-1000)
        });
      } catch (error) {
        logger.warn('[SmartBot Metrics] Error saving:', error);
      }
    }
  }

  recordMessage(message, context = {}) {
    this.metrics.messages.total++;
    this.metrics.messages.today++;
    
    const hour = new Date().getHours();
    this.metrics.messages.byHour[hour]++;
    
    if (context.sentiment !== undefined) {
      if (context.sentiment > 0.6) this.metrics.sentiment.positive++;
      else if (context.sentiment < 0.4) this.metrics.sentiment.negative++;
      else this.metrics.sentiment.neutral++;
    }
    
    this.history.push({
      type: 'message',
      timestamp: new Date().toISOString(),
      context
    });
    
    const anomalies = this.checkAnomalies();
    if (anomalies.length > 0) {
      this.emit('anomalies', anomalies);
    }
    
    this.saveMetrics();
  }

  recordResponse(responseTime, isAI = false) {
    this.metrics.responses.total++;
    
    if (isAI) {
      this.metrics.responses.aiGenerated++;
    } else {
      this.metrics.responses.manual++;
    }
    
    this.metrics.responseTime.total += responseTime;
    this.metrics.responseTime.count++;
    this.metrics.responseTime.avg = 
      this.metrics.responseTime.total / this.metrics.responseTime.count;
    
    this.saveMetrics();
  }

  recordEscalation() {
    this.metrics.escalations.total++;
    this.metrics.escalations.rate = 
      this.metrics.escalations.total / this.metrics.messages.total;
    
    const anomalies = this.checkAnomalies();
    if (anomalies.length > 0) {
      this.emit('anomalies', anomalies);
    }
    
    this.saveMetrics();
  }

  recordSatisfaction(score) {
    this.metrics.satisfaction.total += score;
    this.metrics.satisfaction.count++;
    this.metrics.satisfaction.avg = 
      this.metrics.satisfaction.total / this.metrics.satisfaction.count;
    
    this.saveMetrics();
  }

  checkAnomalies() {
    const anomalies = [];
    
    if (this.metrics.escalations.rate > this.anomalyThresholds.escalationRate) {
      anomalies.push({
        type: 'high_escalation_rate',
        value: this.metrics.escalations.rate,
        threshold: this.anomalyThresholds.escalationRate,
        message: `High escalation rate: ${(this.metrics.escalations.rate * 100).toFixed(1)}%`
      });
    }
    
    const totalSentiment = this.metrics.sentiment.positive + 
                          this.metrics.sentiment.neutral + 
                          this.metrics.sentiment.negative;
    if (totalSentiment > 10) {
      const negativeRate = this.metrics.sentiment.negative / totalSentiment;
      if (negativeRate > this.anomalyThresholds.negativeRate) {
        anomalies.push({
          type: 'high_negative_sentiment',
          value: negativeRate,
          threshold: this.anomalyThresholds.negativeRate,
          message: `High negative sentiment: ${(negativeRate * 100).toFixed(1)}%`
        });
      }
    }
    
    if (this.metrics.responseTime.avg > this.anomalyThresholds.avgResponseTime) {
      anomalies.push({
        type: 'high_response_time',
        value: this.metrics.responseTime.avg,
        threshold: this.anomalyThresholds.avgResponseTime,
        message: `High avg response time: ${(this.metrics.responseTime.avg / 1000).toFixed(1)}s`
      });
    }
    
    return anomalies;
  }

  getMetrics() {
    const totalSentiment = this.metrics.sentiment.positive + 
                          this.metrics.sentiment.neutral + 
                          this.metrics.sentiment.negative;
    
    return {
      ...this.metrics,
      computed: {
        aiResponseRate: this.metrics.responses.total > 0 
          ? this.metrics.responses.aiGenerated / this.metrics.responses.total 
          : 0,
        positiveRate: totalSentiment > 0 
          ? this.metrics.sentiment.positive / totalSentiment 
          : 0,
        negativeRate: totalSentiment > 0 
          ? this.metrics.sentiment.negative / totalSentiment 
          : 0,
        avgResponseTimeSeconds: this.metrics.responseTime.avg / 1000
      },
      anomalies: this.checkAnomalies()
    };
  }

  getMetricsByPeriod(hours = 24) {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.history.filter(h => new Date(h.timestamp) > cutoff);
  }

  resetDaily() {
    this.metrics.messages.today = 0;
    this.metrics.messages.byHour = new Array(24).fill(0);
    this.saveMetrics();
  }

  async reset() {
    this.metrics = {
      messages: { total: 0, today: 0, byHour: new Array(24).fill(0) },
      responses: { total: 0, aiGenerated: 0, manual: 0 },
      sentiment: { positive: 0, neutral: 0, negative: 0 },
      responseTime: { total: 0, count: 0, avg: 0 },
      escalations: { total: 0, rate: 0 },
      satisfaction: { total: 0, count: 0, avg: 0 }
    };
    this.history = [];
    if (this.storage) {
      await this.storage.delete('smartbot_metrics');
    }
  }
}

// ============================================================
// SMARTBOT IA SERVICE - MAIN CLASS
// ============================================================

module.exports = SmartMetricsSystem;
