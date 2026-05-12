/**
 * 🧠 SmartBot IA Routes
 * 
 * API endpoints for SmartBot IA functionality
 * 
 * @version 1.0.1
 * @security Todas as rotas requerem autenticação
 */

const express = require('express');
const router = express.Router();
const { SmartBotIAService } = require('../ai/services/SmartBotIAService');
const { authenticate } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');

// SEGURANÇA: Aplicar autenticação em TODAS as rotas deste router
router.use(authenticate);
// FIX HIGH: aiLimiter previne financial DoS — endpoints invocam LLMs/sentiment LLM calls
router.use(aiLimiter);

// Initialize service (in production, use dependency injection)
let smartBotService = null;

const getService = () => {
  if (!smartBotService) {
    smartBotService = new SmartBotIAService();
    smartBotService.init();
  }
  return smartBotService;
};

/**
 * POST /api/smartbot/analyze
 * Analyze a message with context
 */
router.post('/analyze', async (req, res) => {
  try {
    const { chatId, message, history } = req.body;
    
    if (!chatId || !message) {
      return res.status(400).json({
        success: false,
        error: 'chatId and message are required'
      });
    }
    
    const service = getService();
    const analysis = await service.analyzeMessage(chatId, message, history || []);
    
    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    logger.error('[SmartBot Route] Analyze error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/smartbot/feedback
 * Record feedback for learning
 */
router.post('/feedback', async (req, res) => {
  try {
    const { input, response, rating, context } = req.body;

    if (!input || !response || rating === undefined) {
      return res.status(400).json({
        success: false,
        error: 'input, response, and rating are required'
      });
    }

    // v9.4.0 BUG #93: validação rigorosa de tipos pra prevenir lixo na base
    // de aprendizado. Antes: rating='<script>' ou NaN passava → quebrava
    // agregações estatísticas (média virava NaN, recomendações ficavam ruins).
    if (typeof input !== 'string' || input.length > 10000) {
      return res.status(400).json({ success: false, error: 'input deve ser string até 10k chars' });
    }
    if (typeof response !== 'string' || response.length > 10000) {
      return res.status(400).json({ success: false, error: 'response deve ser string até 10k chars' });
    }
    const ratingNum = Number(rating);
    if (!Number.isFinite(ratingNum) || ratingNum < 0 || ratingNum > 5) {
      return res.status(400).json({ success: false, error: 'rating deve ser número entre 0 e 5' });
    }
    if (context !== undefined && context !== null && typeof context !== 'object') {
      return res.status(400).json({ success: false, error: 'context deve ser objeto' });
    }
    // Limita tamanho do context (prevenir DoS via JSON gigante)
    if (context && JSON.stringify(context).length > 50_000) {
      return res.status(400).json({ success: false, error: 'context muito grande (max 50KB)' });
    }

    const service = getService();
    service.recordResponseFeedback(input, response, ratingNum, context || {});

    res.json({
      success: true,
      message: 'Feedback recorded'
    });
  } catch (error) {
    logger.error('[SmartBot Route] Feedback error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/smartbot/response-time
 * Record response time metrics
 */
router.post('/response-time', async (req, res) => {
  try {
    const { responseTime, isAI } = req.body;
    
    if (responseTime === undefined) {
      return res.status(400).json({
        success: false,
        error: 'responseTime is required'
      });
    }
    
    const service = getService();
    service.recordResponseTime(responseTime, isAI || false);
    
    res.json({
      success: true,
      message: 'Response time recorded'
    });
  } catch (error) {
    logger.error('[SmartBot Route] Response time error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/smartbot/profile/:chatId
 * Get customer profile
 */
router.get('/profile/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    
    const service = getService();
    const profile = service.getCustomerProfile(chatId);
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: 'Profile not found'
      });
    }
    
    res.json({
      success: true,
      data: profile
    });
  } catch (error) {
    logger.error('[SmartBot Route] Profile error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/smartbot/profiles
 * Get all customer profiles
 */
router.get('/profiles', async (req, res) => {
  try {
    const service = getService();
    const profiles = service.getAllProfiles();
    
    res.json({
      success: true,
      data: profiles,
      count: profiles.length
    });
  } catch (error) {
    logger.error('[SmartBot Route] Profiles error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/smartbot/metrics
 * Get current metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    const service = getService();
    const metrics = service.getMetrics();
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error('[SmartBot Route] Metrics error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/smartbot/learning/stats
 * Get learning system statistics
 */
router.get('/learning/stats', async (req, res) => {
  try {
    const service = getService();
    const stats = service.getLearningStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('[SmartBot Route] Learning stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/smartbot/learning/flush
 * Force process learning buffer
 */
router.post('/learning/flush', async (req, res) => {
  try {
    const service = getService();
    await service.flushLearning();
    
    res.json({
      success: true,
      message: 'Learning buffer flushed'
    });
  } catch (error) {
    logger.error('[SmartBot Route] Flush error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/smartbot/queue/status
 * Get priority queue status
 */
router.get('/queue/status', async (req, res) => {
  try {
    const service = getService();
    const status = service.getQueueStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('[SmartBot Route] Queue status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/smartbot/export
 * Export all SmartBot data
 */
router.get('/export', async (req, res) => {
  try {
    const service = getService();
    const data = await service.exportData();
    
    res.json({
      success: true,
      data
    });
  } catch (error) {
    logger.error('[SmartBot Route] Export error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/smartbot/reset
 * Reset all SmartBot data (use with caution)
 */
router.post('/reset', async (req, res) => {
  try {
    const { confirm } = req.body;
    
    if (confirm !== 'RESET_ALL_DATA') {
      return res.status(400).json({
        success: false,
        error: 'Confirmation required. Send { confirm: "RESET_ALL_DATA" }'
      });
    }
    
    const service = getService();
    await service.resetAll();
    
    res.json({
      success: true,
      message: 'All SmartBot data has been reset'
    });
  } catch (error) {
    logger.error('[SmartBot Route] Reset error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v2/smartbot/config — v8.3.0
 * Recebe o estado de treinamento do dashboard do cliente
 * { business: {...}, tone: {...}, policies: {...}, faq: [...] }
 * Persiste em settings JSON do workspace.
 */
router.post('/config', async (req, res) => {
  try {
    const db = require('../utils/database');
    const wsId = req.workspaceId;

    // Validação básica
    const { business, tone, policies, faq } = req.body || {};
    const config = {
      business: {
        name: String(business?.name || '').slice(0, 200),
        segment: String(business?.segment || '').slice(0, 100),
        description: String(business?.description || '').slice(0, 2000),
      },
      tone: {
        voice: String(tone?.voice || '').slice(0, 2000),
        greeting: String(tone?.greeting || '').slice(0, 500),
      },
      policies: {
        hours: String(policies?.hours || '').slice(0, 200),
        returns: String(policies?.returns || '').slice(0, 500),
        rules: String(policies?.rules || '').slice(0, 2000),
      },
      faq: (Array.isArray(faq) ? faq : []).slice(0, 50).map(f => ({
        question: String(f?.question || '').slice(0, 500),
        answer: String(f?.answer || '').slice(0, 2000),
      })).filter(f => f.question && f.answer),
      updated_at: new Date().toISOString(),
    };

    // Faz merge com settings existentes do workspace
    const ws = db.get('SELECT settings FROM workspaces WHERE id = ?', [wsId]);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    let currentSettings = {};
    try { currentSettings = JSON.parse(ws.settings || '{}'); } catch (_) {}

    currentSettings.smartbot_training = config;

    db.run(
      `UPDATE workspaces SET settings = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [JSON.stringify(currentSettings), wsId]
    );

    logger.info(`[SmartBot] Config saved for workspace ${wsId}`);
    res.json({ success: true, saved: config });
  } catch (error) {
    logger.error('[SmartBot Route] Config save error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v2/smartbot/config — v8.3.0
 * Retorna a configuração de treinamento atual do workspace
 */
router.get('/config', async (req, res) => {
  try {
    const db = require('../utils/database');
    const ws = db.get('SELECT settings FROM workspaces WHERE id = ?', [req.workspaceId]);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    let settings = {};
    try { settings = JSON.parse(ws.settings || '{}'); } catch (_) {}

    res.json({
      config: settings.smartbot_training || null,
    });
  } catch (error) {
    logger.error('[SmartBot Route] Config get error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
