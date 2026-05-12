/**
 * SmartBotIAService
 * @file Extraído de SmartBotIAService.js (refactor v9)
 */

const EventEmitter = require('events');
const logger = require('../../../utils/logger');

class SmartBotIAService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.storage = options.storage || null;
    this.contextAnalyzer = new AdvancedContextAnalyzer(this.storage);
    this.priorityQueue = new IntelligentPriorityQueue(options.queue);
    this.learningSystem = new ContinuousLearningSystem(this.storage);
    this.metricsSystem = new SmartMetricsSystem(this.storage);
    
    this.initialized = false;
    
    // v10.1: lazy-load AIOrchestrator (não bloqueia inicialização)
    this._orchestrator = null;
    this._orchestratorTenantId = options.tenantId || 'default';

    // Setup event forwarding
    this.priorityQueue.on('enqueue', (item) => this.emit('queue:enqueue', item));
    this.priorityQueue.on('process', (item) => this.emit('queue:process', item));
    this.priorityQueue.on('processed', (item) => this.emit('queue:processed', item));
    this.priorityQueue.on('failed', (data) => this.emit('queue:failed', data));
    this.metricsSystem.on('anomalies', (anomalies) => this.emit('anomalies', anomalies));
  }

  async init() {
    if (this.initialized) return;
    
    await this.contextAnalyzer.loadProfiles();
    await this.learningSystem.loadData();
    await this.metricsSystem.loadMetrics();
    
    this.initialized = true;
    this.emit('initialized');
    
    logger.info('[SmartBot IA Service] Initialized');
  }

  /**
   * v10.1: Retorna instância lazy do AIOrchestrator.
   * @private
   */
  _getOrchestrator() {
    if (!this._orchestrator) {
      try {
        const AIOrchestrator = require('../../AIOrchestrator');
        this._orchestrator = new AIOrchestrator({
          tenantId: this._orchestratorTenantId,
          enableCommercialIntelligence: true,
          enableQualityChecker: true,
          enableBehaviorAdapter: true,
          maxQualityRetries: 2,
        });
      } catch (e) {
        logger.warn('[SmartBot IA Service] AIOrchestrator not available:', e.message);
      }
    }
    return this._orchestrator;
  }

  /**
   * v10.1: Enriquece a análise de contexto com a inteligência comercial.
   * Retorna intent comercial, estágio do cliente e goal para uso no autopilot.
   * @private
   */
  async _enrichWithCommercialIntelligence(chatId, message, contextAnalysis) {
    const orchestrator = this._getOrchestrator();
    if (!orchestrator) return null;

    try {
      const ctx = orchestrator.conversationMemory.getContext(chatId);
      const intentResult = { intent: contextAnalysis.flowAnalysis?.currentStage || 'question', confidence: 0.7 };
      const commercialResult = orchestrator.commercialEngine.classify(message, intentResult, ctx);
      const behaviorProfile  = orchestrator.behaviorAdapter.analyze(message, intentResult, commercialResult, ctx);

      return {
        responseGoal:    commercialResult.goal,
        clientStage:     ctx.clientStage,
        energyLevel:     behaviorProfile.energyLevel,
        isClosingMoment: behaviorProfile.isClosingMoment,
        closingCTA:      behaviorProfile.closingCTA,
        clientStyle:     behaviorProfile.clientStyle,
      };
    } catch (e) {
      logger.warn('[SmartBot IA Service] Commercial intelligence error:', e.message);
      return null;
    }
  }

  async analyzeMessage(chatId, message, history = []) {
    const contextAnalysis = this.contextAnalyzer.analyzeContext(chatId, history, message);
    
    const learnedSuggestions = this.learningSystem.getSuggestedResponses(
      message.body || message.text || message.content, 
      { intent: contextAnalysis.flowAnalysis.currentStage }
    );
    
    this.metricsSystem.recordMessage(message, {
      sentiment: contextAnalysis.sentimentTrend.average,
      intent: contextAnalysis.flowAnalysis.currentStage
    });
    
    if (contextAnalysis.urgencyLevel > 0.5) {
      this.priorityQueue.enqueue(message, {
        chatId,
        sentiment: contextAnalysis.sentimentTrend.average,
        urgency: contextAnalysis.urgencyLevel,
        intent: contextAnalysis.flowAnalysis.currentStage
      });
    }

    const result = {
      context: contextAnalysis,
      suggestions: learnedSuggestions,
      metrics: this.metricsSystem.getMetrics(),
      queueStatus: this.priorityQueue.getStatus()
    };

    // v10.1: enriquecer com inteligência comercial de forma assíncrona (não bloqueia)
    try {
      const msgText = message.body || message.text || message.content || '';
      if (msgText) {
        const intelligence = await this._enrichWithCommercialIntelligence(chatId, msgText, contextAnalysis);
        if (intelligence) result.intelligence = intelligence;
      }
    } catch (e) {
      // intelligence enrichment é best-effort: nunca quebra o fluxo principal
    }

    this.emit('analysis', result);

    return result;
  }

  recordResponseFeedback(input, response, rating, context = {}) {
    this.learningSystem.recordFeedback({
      input,
      response,
      rating,
      context
    });
    
    this.metricsSystem.recordSatisfaction(rating);
    
    return true;
  }

  recordResponseTime(responseTime, isAI = false) {
    this.metricsSystem.recordResponse(responseTime, isAI);
  }

  setQueueHandler(handler) {
    this.priorityQueue.setHandler(handler);
  }

  getCustomerProfile(chatId) {
    return this.contextAnalyzer.getCustomerProfile(chatId);
  }

  getAllProfiles() {
    return this.contextAnalyzer.getAllProfiles();
  }

  getLearningStats() {
    return this.learningSystem.getStats();
  }

  getMetrics() {
    return this.metricsSystem.getMetrics();
  }

  getQueueStatus() {
    return this.priorityQueue.getStatus();
  }

  async flushLearning() {
    await this.learningSystem.flush();
  }

  async resetAll() {
    await this.learningSystem.reset();
    await this.metricsSystem.reset();
    this.priorityQueue.clear();
    this.emit('reset');
  }

  async exportData() {
    return {
      profiles: this.contextAnalyzer.getAllProfiles(),
      learning: this.learningSystem.getStats(),
      metrics: this.metricsSystem.getMetrics(),
      exportedAt: new Date().toISOString()
    };
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = SmartBotIAService;
