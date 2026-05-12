/**
 * SmartBotExtendedService
 * @file Extraído de SmartBotExtendedService.js (refactor v9)
 */

const EventEmitter = require('events');
const logger = require('../../../utils/logger');

class SmartBotExtendedService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.dialogManager = new DialogManager(options.storage);
    this.entityManager = new EntityManager();
    this.intentManager = new IntentManager();
    this.humanAssistance = new HumanAssistanceSystem();
    this.cacheManager = new CacheManager({ maxSize: options.cacheSize || 500, defaultTTL: options.cacheTTL || 300000 });
    this.rateLimitManager = new RateLimitManager();
    this.contextManager = new ContextManager({ defaultTTL: options.contextTTL || 1800000 });
    this.sessionManager = new SessionManager({ timeout: options.sessionTimeout || 1800000 });
    this.feedbackAnalyzer = new FeedbackAnalyzer();

    // Forward events
    this.dialogManager.on('dialogStarted', (data) => this.emit('dialog:started', data));
    this.dialogManager.on('dialogEnded', (data) => this.emit('dialog:ended', data));
    this.dialogManager.on('stateChanged', (data) => this.emit('dialog:stateChanged', data));
    this.humanAssistance.on('escalationRequested', (data) => this.emit('escalation:requested', data));
    this.humanAssistance.on('chatAssigned', (data) => this.emit('escalation:assigned', data));
    this.humanAssistance.on('chatEnded', (data) => this.emit('escalation:ended', data));
    this.humanAssistance.on('chatTransferred', (data) => this.emit('escalation:transferred', data));

    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;
    this.emit('initialized');
    logger.info('[SmartBot Extended Service] ✅ Initialized');
  }

  async processMessage(chatId, message, options = {}) {
    const rateCheck = this.rateLimitManager.consume(`chat:${chatId}`);
    if (!rateCheck.allowed) {
      return { blocked: true, reason: 'rate_limited', retryAfter: rateCheck.retryAfter };
    }

    const session = this.sessionManager.getOrCreate(chatId);
    this.sessionManager.touch(chatId);

    const messageText = message.text || message.body || '';
    this.contextManager.push(chatId, 'messages', { text: messageText, timestamp: Date.now(), from: message.from || 'user' }, 50);

    const entities = this.entityManager.extractAll(messageText);
    const intentResult = this.intentManager.classify(messageText, {
      previousIntent: this.contextManager.get(chatId, 'lastIntent'),
      entities
    });

    this.contextManager.set(chatId, 'lastIntent', intentResult.intent);
    this.contextManager.set(chatId, 'lastEntities', entities);

    let dialogResult = null;
    if (this.dialogManager.getActiveSession(chatId)) {
      dialogResult = this.dialogManager.processInput(chatId, messageText, { intent: intentResult.intent, entities, sentiment: options.sentiment });
    }

    let escalationInfo = null;
    if (intentResult.intent === 'urgent' || (options.sentiment !== undefined && options.sentiment < 0.3) || intentResult.intent === 'complaint') {
      escalationInfo = this.humanAssistance.getQueuePosition(chatId);
      if (escalationInfo.status === 'not_found' && options.autoEscalate) {
        escalationInfo = this.humanAssistance.requestEscalation(chatId, {
          reason: intentResult.intent, sentiment: options.sentiment, intent: intentResult.intent,
          urgency: intentResult.intent === 'urgent' ? 1 : 0.5
        });
      }
    }

    return {
      chatId, intent: intentResult, entities, dialog: dialogResult, escalation: escalationInfo,
      session: { id: session.id, isNew: Date.now() - session.createdAt < 5000 },
      context: this.contextManager.getContext(chatId)
    };
  }

  addFeedback(feedback) { return this.feedbackAnalyzer.addFeedback(feedback); }
  getFeedbackReport() { return this.feedbackAnalyzer.generateReport(); }

  getStats() {
    return {
      sessions: this.sessionManager.getStats(),
      cache: this.cacheManager.getStats(),
      rateLimit: this.rateLimitManager.getStats(),
      contexts: this.contextManager.getStats(),
      humanAssistance: this.humanAssistance.getQueueStatus(),
      feedback: this.feedbackAnalyzer.getAnalysis(),
      dialogs: { activeCount: this.dialogManager.getActiveDialogs().length, registeredCount: this.dialogManager.dialogs.size }
    };
  }

  exportData() {
    return { stats: this.getStats(), feedbackReport: this.getFeedbackReport(), exportedAt: new Date().toISOString() };
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = SmartBotExtendedService;
