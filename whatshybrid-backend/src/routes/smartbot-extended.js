/**
 * 🧠 SmartBot Extended Routes
 * 
 * API endpoints for SmartBot Extended (9 additional systems)
 * 
 * @version 1.0.1
 * @security Todas as rotas requerem autenticação
 */

const express = require('express');
const router = express.Router();
const { SmartBotExtendedService } = require('../ai/services/SmartBotExtendedService');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

// SEGURANÇA: Aplicar autenticação em TODAS as rotas deste router
router.use(authenticate);

let smartBotExtendedService = null;

const getService = () => {
  if (!smartBotExtendedService) {
    smartBotExtendedService = new SmartBotExtendedService();
    smartBotExtendedService.init();
  }
  return smartBotExtendedService;
};

// ============================================================
// MESSAGE PROCESSING
// ============================================================

/**
 * POST /api/v1/smartbot-extended/process
 * Process message with all extended systems
 */
router.post('/process', async (req, res) => {
  try {
    const { chatId, message, options } = req.body;
    if (!chatId || !message) {
      return res.status(400).json({ success: false, error: 'chatId and message are required' });
    }
    const service = getService();
    const result = await service.processMessage(chatId, message, options || {});
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('[SmartBot Extended] Process error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// DIALOG MANAGER
// ============================================================

/**
 * POST /api/v1/smartbot-extended/dialog/register
 * Register new dialog flow
 */
router.post('/dialog/register', async (req, res) => {
  try {
    const { dialogId, config } = req.body;
    if (!dialogId || !config) {
      return res.status(400).json({ success: false, error: 'dialogId and config are required' });
    }
    const service = getService();
    const dialog = service.dialogManager.registerDialog(dialogId, config);
    res.json({ success: true, data: dialog });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/smartbot-extended/dialog/start
 * Start dialog for a chat
 */
router.post('/dialog/start', async (req, res) => {
  try {
    const { chatId, dialogId, initialData } = req.body;
    if (!chatId || !dialogId) {
      return res.status(400).json({ success: false, error: 'chatId and dialogId are required' });
    }
    const service = getService();
    const session = service.dialogManager.startDialog(chatId, dialogId, initialData || {});
    res.json({ success: true, data: session });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/smartbot-extended/dialog/process
 * Process input in active dialog
 */
router.post('/dialog/process', async (req, res) => {
  try {
    const { chatId, input, context } = req.body;
    if (!chatId || !input) {
      return res.status(400).json({ success: false, error: 'chatId and input are required' });
    }
    const service = getService();
    const result = service.dialogManager.processInput(chatId, input, context || {});
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/smartbot-extended/dialog/end
 * End active dialog
 */
router.post('/dialog/end', async (req, res) => {
  try {
    const { chatId, reason } = req.body;
    if (!chatId) {
      return res.status(400).json({ success: false, error: 'chatId is required' });
    }
    const service = getService();
    const session = service.dialogManager.endDialog(chatId, reason || 'manual');
    res.json({ success: true, data: session });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/smartbot-extended/dialog/active
 * Get all active dialogs
 */
router.get('/dialog/active', async (req, res) => {
  try {
    const service = getService();
    const dialogs = service.dialogManager.getActiveDialogs();
    res.json({ success: true, data: dialogs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/smartbot-extended/dialog/session/:chatId
 * Get active dialog session for chat
 */
router.get('/dialog/session/:chatId', async (req, res) => {
  try {
    const service = getService();
    const session = service.dialogManager.getActiveSession(req.params.chatId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'No active dialog' });
    }
    res.json({ success: true, data: session });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// ENTITY MANAGER
// ============================================================

/**
 * POST /api/v1/smartbot-extended/entity/extract
 * Extract entities from text
 */
router.post('/entity/extract', async (req, res) => {
  try {
    const { text, types } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, error: 'text is required' });
    }
    const service = getService();
    const entities = service.entityManager.extractAll(text, { types });
    res.json({ success: true, data: entities });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/smartbot-extended/entity/register
 * Register custom entity list
 */
router.post('/entity/register', async (req, res) => {
  try {
    const { entityType, values, options } = req.body;
    if (!entityType || !values) {
      return res.status(400).json({ success: false, error: 'entityType and values are required' });
    }
    const service = getService();
    service.entityManager.registerEntityList(entityType, values, options || {});
    res.json({ success: true, message: `Entity ${entityType} registered` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/smartbot-extended/entity/synonyms
 * Add synonyms for entity
 */
router.post('/entity/synonyms', async (req, res) => {
  try {
    const { entityType, canonical, synonyms } = req.body;
    if (!entityType || !canonical || !synonyms) {
      return res.status(400).json({ success: false, error: 'entityType, canonical and synonyms are required' });
    }
    const service = getService();
    service.entityManager.addSynonyms(entityType, canonical, synonyms);
    res.json({ success: true, message: 'Synonyms added' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// INTENT MANAGER
// ============================================================

/**
 * POST /api/v1/smartbot-extended/intent/classify
 * Classify intent from text
 */
router.post('/intent/classify', async (req, res) => {
  try {
    const { text, context } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, error: 'text is required' });
    }
    const service = getService();
    const result = service.intentManager.classify(text, context || {});
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/smartbot-extended/intent/register
 * Register custom intent
 */
router.post('/intent/register', async (req, res) => {
  try {
    const { intentId, config } = req.body;
    if (!intentId || !config) {
      return res.status(400).json({ success: false, error: 'intentId and config are required' });
    }
    const service = getService();
    service.intentManager.registerIntent(intentId, config);
    res.json({ success: true, message: `Intent ${intentId} registered` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/smartbot-extended/intent/train
 * Add training example
 */
router.post('/intent/train', async (req, res) => {
  try {
    const { text, intent, positive } = req.body;
    if (!text || !intent) {
      return res.status(400).json({ success: false, error: 'text and intent are required' });
    }
    const service = getService();
    service.intentManager.addTrainingExample(text, intent, positive !== false);
    res.json({ success: true, message: 'Training example added' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/smartbot-extended/intent/list
 * List all registered intents
 */
router.get('/intent/list', async (req, res) => {
  try {
    const service = getService();
    const intents = service.intentManager.listIntents();
    res.json({ success: true, data: intents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// HUMAN ASSISTANCE (ESCALATION)
// ============================================================

/**
 * POST /api/v1/smartbot-extended/escalation/request
 * Request escalation to human
 */
router.post('/escalation/request', async (req, res) => {
  try {
    const { chatId, context } = req.body;
    if (!chatId) {
      return res.status(400).json({ success: false, error: 'chatId is required' });
    }
    const service = getService();
    const result = service.humanAssistance.requestEscalation(chatId, context || {});
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/smartbot-extended/escalation/cancel
 * Cancel escalation request
 */
router.post('/escalation/cancel', async (req, res) => {
  try {
    const { chatId } = req.body;
    if (!chatId) {
      return res.status(400).json({ success: false, error: 'chatId is required' });
    }
    const service = getService();
    const result = service.humanAssistance.cancelEscalation(chatId);
    res.json({ success: true, cancelled: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/smartbot-extended/escalation/position/:chatId
 * Get queue position
 */
router.get('/escalation/position/:chatId', async (req, res) => {
  try {
    const service = getService();
    const position = service.humanAssistance.getQueuePosition(req.params.chatId);
    res.json({ success: true, data: position });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/smartbot-extended/escalation/queue
 * Get queue status
 */
router.get('/escalation/queue', async (req, res) => {
  try {
    const service = getService();
    const status = service.humanAssistance.getQueueStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/smartbot-extended/agent/register
 * Register agent
 */
router.post('/agent/register', async (req, res) => {
  try {
    const { agentId, info } = req.body;
    if (!agentId) {
      return res.status(400).json({ success: false, error: 'agentId is required' });
    }
    const service = getService();
    const agent = service.humanAssistance.registerAgent(agentId, info || {});
    res.json({ success: true, data: agent });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/smartbot-extended/agent/status
 * Set agent status
 */
router.post('/agent/status', async (req, res) => {
  try {
    const { agentId, status } = req.body;
    if (!agentId || !status) {
      return res.status(400).json({ success: false, error: 'agentId and status are required' });
    }
    const service = getService();
    const result = service.humanAssistance.setAgentStatus(agentId, status);
    res.json({ success: true, updated: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/smartbot-extended/agents
 * Get all agents
 */
router.get('/agents', async (req, res) => {
  try {
    const service = getService();
    const agents = service.humanAssistance.getAgents();
    res.json({ success: true, data: agents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/smartbot-extended/chat/end
 * End agent chat
 */
router.post('/chat/end', async (req, res) => {
  try {
    const { chatId, resolution } = req.body;
    if (!chatId) {
      return res.status(400).json({ success: false, error: 'chatId is required' });
    }
    const service = getService();
    const result = service.humanAssistance.endChat(chatId, resolution || {});
    res.json({ success: true, ended: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/smartbot-extended/chat/transfer
 * Transfer chat to another agent
 */
router.post('/chat/transfer', async (req, res) => {
  try {
    const { chatId, newAgentId } = req.body;
    if (!chatId || !newAgentId) {
      return res.status(400).json({ success: false, error: 'chatId and newAgentId are required' });
    }
    const service = getService();
    const result = service.humanAssistance.transferChat(chatId, newAgentId);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// SESSION & CONTEXT
// ============================================================

/**
 * GET /api/v1/smartbot-extended/session/:sessionId
 * Get session
 */
router.get('/session/:sessionId', async (req, res) => {
  try {
    const service = getService();
    const session = service.sessionManager.get(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    res.json({ success: true, data: session });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/smartbot-extended/sessions
 * List all sessions
 */
router.get('/sessions', async (req, res) => {
  try {
    const service = getService();
    const sessions = service.sessionManager.listSessions();
    res.json({ success: true, data: sessions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/smartbot-extended/context/:contextId
 * Get context
 */
router.get('/context/:contextId', async (req, res) => {
  try {
    const service = getService();
    const context = service.contextManager.getContext(req.params.contextId);
    if (!context) {
      return res.status(404).json({ success: false, error: 'Context not found' });
    }
    res.json({ success: true, data: context });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/smartbot-extended/context/set
 * Set context value
 */
router.post('/context/set', async (req, res) => {
  try {
    const { contextId, key, value, ttl } = req.body;
    if (!contextId || !key) {
      return res.status(400).json({ success: false, error: 'contextId and key are required' });
    }
    const service = getService();
    service.contextManager.set(contextId, key, value, ttl);
    res.json({ success: true, message: 'Context updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// FEEDBACK
// ============================================================

/**
 * POST /api/v1/smartbot-extended/feedback
 * Add feedback
 */
router.post('/feedback', async (req, res) => {
  try {
    const { rating, text, source, context } = req.body;
    if (rating === undefined) {
      return res.status(400).json({ success: false, error: 'rating is required' });
    }
    const service = getService();
    const feedback = service.addFeedback({ rating, text, source, context });
    res.json({ success: true, data: feedback });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/smartbot-extended/feedback/report
 * Get feedback report
 */
router.get('/feedback/report', async (req, res) => {
  try {
    const service = getService();
    const report = service.getFeedbackReport();
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/smartbot-extended/feedback/trends
 * Get feedback trends
 */
router.get('/feedback/trends', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const service = getService();
    const trends = service.feedbackAnalyzer.getTrends(days);
    res.json({ success: true, data: trends });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/smartbot-extended/feedback/search
 * Search feedbacks
 */
router.post('/feedback/search', async (req, res) => {
  try {
    const service = getService();
    const results = service.feedbackAnalyzer.search(req.body);
    res.json({ success: true, data: results, count: results.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// RATE LIMIT
// ============================================================

/**
 * POST /api/v1/smartbot-extended/ratelimit/configure
 * Configure rate limit
 */
router.post('/ratelimit/configure', async (req, res) => {
  try {
    const { key, config } = req.body;
    if (!key || !config) {
      return res.status(400).json({ success: false, error: 'key and config are required' });
    }
    const service = getService();
    service.rateLimitManager.configure(key, config);
    res.json({ success: true, message: 'Rate limit configured' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/smartbot-extended/ratelimit/status/:key
 * Get rate limit status
 */
router.get('/ratelimit/status/:key', async (req, res) => {
  try {
    const service = getService();
    const status = service.rateLimitManager.getStatus(req.params.key);
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// STATS & EXPORT
// ============================================================

/**
 * GET /api/v1/smartbot-extended/stats
 * Get all stats
 */
router.get('/stats', async (req, res) => {
  try {
    const service = getService();
    const stats = service.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/smartbot-extended/export
 * Export all data
 */
router.get('/export', async (req, res) => {
  try {
    const service = getService();
    const data = service.exportData();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
