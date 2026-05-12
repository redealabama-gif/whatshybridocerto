/**
 * Autopilot Maturity Routes — v9.3.0
 *
 * Endpoints pra ver o estado de maturação do autopilot e
 * promover/pausar/resetar.
 *
 * Fluxo do cliente:
 *   GET  /api/v1/autopilot/maturity        → status atual + porcentagem
 *   POST /api/v1/autopilot/maturity/record → registra interação (chamado pela extensão)
 *   POST /api/v1/autopilot/maturity/promote → libera modo LIVE (READY → LIVE)
 *   POST /api/v1/autopilot/maturity/resume  → resume após pausa
 *   POST /api/v1/autopilot/maturity/reset   → volta pra training (zera estatísticas)
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');

const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const maturity = require('../ai/services/AutopilotMaturityService');
const logger = require('../utils/logger');

router.use(authenticate);

/**
 * GET /api/v1/autopilot/maturity
 *
 * Retorna o estado completo do autopilot pro workspace do usuário,
 * incluindo % de progresso até a graduação.
 */
router.get('/', asyncHandler(async (req, res) => {
  const workspaceId = req.workspaceId || req.user?.workspace_id;
  if (!workspaceId) throw new AppError("workspace_id não disponível na sessão", 401);
  const state = maturity.getState(workspaceId);

  // Calcula progresso até graduação (% que falta atingir threshold + min)
  const progressByCount = Math.min(state.lastInteractions.length / state.minInteractions, 1);
  const progressByRate = Math.min(state.successRate / state.maturityThreshold, 1);
  // Só pode graduar se AMBOS os requisitos forem atendidos
  const overallProgress = Math.min(progressByCount, progressByRate);

  res.json({
    stage: state.stage,
    success_rate: state.successRate,
    success_rate_percent: +(state.successRate * 100).toFixed(1),
    threshold_percent: +(state.maturityThreshold * 100).toFixed(1),
    progress_percent: +(overallProgress * 100).toFixed(1),
    interactions: {
      total: state.totalInteractions,
      approved: state.approvedCount,
      edited: state.editedCount,
      rejected: state.rejectedCount,
      in_window: state.lastInteractions.length,
      window_size: state.config.ROLLING_WINDOW,
      min_required: state.minInteractions,
    },
    can_promote: state.stage === maturity.STAGES.READY,
    graduated_at: state.graduatedAt,
    paused_at: state.pausedAt,
    paused_reason: state.pausedReason,
    config: {
      min_interactions: state.minInteractions,
      maturity_threshold: state.maturityThreshold,
      demotion_threshold: state.demotionThreshold,
      rolling_window: state.config.ROLLING_WINDOW,
    },
  });
}));

/**
 * POST /api/v1/autopilot/maturity/record
 * Body: { outcome: 'approved'|'edited'|'rejected', interactionId?, intent? }
 *
 * Chamado pela extensão quando humano interage com sugestão:
 *   approved: clicou "Usar" sem editar
 *   edited:   editou texto antes de enviar
 *   rejected: descartou e digitou do zero
 */
router.post('/record',
  [
    body('outcome').isIn(['approved', 'edited', 'rejected']),
    body('interactionId').optional().isString(),
    body('intent').optional().isString(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('outcome inválido (use approved | edited | rejected)', 400);
    }

    const { outcome, interactionId, intent } = req.body;
    const workspaceId = req.workspaceId || req.user?.workspace_id;
  if (!workspaceId) throw new AppError("workspace_id não disponível na sessão", 401);

    const state = maturity.recordInteraction(workspaceId, outcome, {
      interactionId, intent,
    });

    res.json({
      stage: state.stage,
      success_rate: state.successRate,
      can_promote: state.stage === maturity.STAGES.READY,
      total_interactions: state.totalInteractions,
    });
  })
);

/**
 * POST /api/v1/autopilot/maturity/promote
 * Promove READY → LIVE. Decisão exclusiva do humano (não automática).
 */
router.post('/promote', asyncHandler(async (req, res) => {
  const workspaceId = req.workspaceId || req.user?.workspace_id;
  if (!workspaceId) throw new AppError("workspace_id não disponível na sessão", 401);
  const result = maturity.promoteToLive(workspaceId);
  if (!result.ok) {
    throw new AppError(`Não pode promover: ${result.reason}`, 400);
  }
  logger.info(`[AutopilotMaturity] User ${req.user.id} promoted workspace ${workspaceId} to LIVE`);

  // Audit log (se serviço disponível)
  try {
    const audit = require('../services/AuditLogService');
    audit.log({
      userId: req.user.id,
      workspaceId,
      action: 'autopilot.promoted_to_live',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  } catch (_) {}

  res.json({ ok: true, stage: result.stage });
}));

/**
 * POST /api/v1/autopilot/maturity/resume
 * Resume PAUSED → LIVE. Após queda de qualidade que pausou automaticamente.
 */
router.post('/resume', asyncHandler(async (req, res) => {
  const workspaceId = req.workspaceId || req.user?.workspace_id;
  if (!workspaceId) throw new AppError("workspace_id não disponível na sessão", 401);
  const result = maturity.resumeLive(workspaceId);
  if (!result.ok) {
    throw new AppError(`Não pode retomar: ${result.reason}`, 400);
  }

  try {
    const audit = require('../services/AuditLogService');
    audit.log({
      userId: req.user.id, workspaceId,
      action: 'autopilot.resumed',
      ip: req.ip, userAgent: req.headers['user-agent'],
    });
  } catch (_) {}

  res.json({ ok: true, stage: result.stage });
}));

/**
 * POST /api/v1/autopilot/maturity/reset
 * Volta pra TRAINING e zera estatísticas. Cuidado: perde histórico.
 */
router.post('/reset', asyncHandler(async (req, res) => {
  const workspaceId = req.workspaceId || req.user?.workspace_id;
  if (!workspaceId) throw new AppError("workspace_id não disponível na sessão", 401);
  maturity.reset(workspaceId);

  try {
    const audit = require('../services/AuditLogService');
    audit.log({
      userId: req.user.id, workspaceId,
      action: 'autopilot.reset',
      ip: req.ip, userAgent: req.headers['user-agent'],
    });
  } catch (_) {}

  res.json({ ok: true, stage: maturity.STAGES.TRAINING });
}));

module.exports = router;
