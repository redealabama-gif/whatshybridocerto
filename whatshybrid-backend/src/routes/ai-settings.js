/**
 * AI Settings Routes — v8.5.0
 *
 * Permite ao cliente configurar:
 *  - System prompt customizado da IA
 *  - Tom de voz (formal/casual/amigável)
 *  - Limites de tokens por resposta
 *  - Setor/nicho do negócio (para context)
 *  - FAQ que será usado como knowledge base
 *
 * Tudo persiste em workspace_settings (key/value JSON por workspace).
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');

const db = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// Helpers
function getSettings(workspaceId) {
  const rows = db.all(
    `SELECT key, value FROM workspace_settings WHERE workspace_id = ?`,
    [workspaceId]
  ) || [];
  const settings = {};
  for (const r of rows) {
    try { settings[r.key] = JSON.parse(r.value); }
    catch { settings[r.key] = r.value; }
  }
  return settings;
}

function setSetting(workspaceId, key, value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  db.run(
    `INSERT INTO workspace_settings (workspace_id, key, value, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [workspaceId, key, json]
  );
}

/**
 * GET /api/v1/ai-settings — recupera configurações de IA do workspace
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const settings = getSettings(req.workspaceId);
  const aiSettings = {
    systemPrompt: settings.ai_system_prompt || '',
    tone: settings.ai_tone || 'friendly',
    sector: settings.ai_sector || '',
    maxResponseTokens: settings.ai_max_response_tokens || 500,
    autoReplyEnabled: settings.ai_auto_reply_enabled !== false,
    qualityThreshold: settings.ai_quality_threshold || 0.7,
    knowledgeBase: settings.ai_knowledge_base || '',
  };
  res.json({ settings: aiSettings });
}));

/**
 * PUT /api/v1/ai-settings — atualiza configurações de IA
 */
router.put('/',
  authenticate,
  [
    body('systemPrompt').optional().isString().isLength({ max: 5000 }),
    body('tone').optional().isIn(['formal', 'casual', 'friendly', 'professional', 'enthusiastic']),
    body('sector').optional().isString().isLength({ max: 200 }),
    body('maxResponseTokens').optional().isInt({ min: 50, max: 2000 }),
    body('autoReplyEnabled').optional().isBoolean(),
    body('qualityThreshold').optional().isFloat({ min: 0, max: 1 }),
    body('knowledgeBase').optional().isString().isLength({ max: 50000 }),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Dados inválidos: ' + JSON.stringify(errors.array()), 400);
    }

    const allowed = ['systemPrompt', 'tone', 'sector', 'maxResponseTokens',
                     'autoReplyEnabled', 'qualityThreshold', 'knowledgeBase'];

    db.transaction(() => {
      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          // Mapeia camelCase → snake_case para DB
          const dbKey = 'ai_' + key.replace(/([A-Z])/g, '_$1').toLowerCase();
          setSetting(req.workspaceId, dbKey, req.body[key]);
        }
      }
    });

    logger.info(`[AISettings] Updated for workspace ${req.workspaceId}`);

    // Retorna config atualizada
    const settings = getSettings(req.workspaceId);
    res.json({
      ok: true,
      settings: {
        systemPrompt: settings.ai_system_prompt || '',
        tone: settings.ai_tone || 'friendly',
        sector: settings.ai_sector || '',
        maxResponseTokens: settings.ai_max_response_tokens || 500,
        autoReplyEnabled: settings.ai_auto_reply_enabled !== false,
        qualityThreshold: settings.ai_quality_threshold || 0.7,
        knowledgeBase: settings.ai_knowledge_base || '',
      },
    });
  })
);

/**
 * POST /api/v1/ai-settings/test — testa o prompt customizado com mensagem de exemplo
 */
router.post('/test',
  authenticate,
  [body('message').isString().isLength({ min: 1, max: 1000 })],
  asyncHandler(async (req, res) => {
    const { message } = req.body;
    const settings = getSettings(req.workspaceId);

    try {
      const router = require('../ai/services/AIRouterService');
      const systemPrompt = settings.ai_system_prompt ||
        'Você é um assistente de atendimento profissional.';

      const result = await router.complete(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        { maxTokens: settings.ai_max_response_tokens || 500, temperature: 0.7 }
      );

      res.json({
        ok: true,
        response: result.content || result.text || '',
        model: result.model,
        tokensUsed: result.usage?.total_tokens,
      });
    } catch (err) {
      logger.error(`[AISettings:test] ${err.message}`);
      res.status(500).json({ error: 'Falha ao testar IA: ' + err.message });
    }
  })
);

module.exports = router;
