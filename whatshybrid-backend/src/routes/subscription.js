/**
 * Subscription Routes - v8.3.0
 * 
 * Gerencia o ciclo de vida da assinatura SaaS do workspace:
 * - Cancelar (mantém acesso até fim do período pago)
 * - Reativar (depois de cancelar)
 * - Trocar plano
 */

const express = require('express');
const router = express.Router();

const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

router.use(authenticate);

/**
 * GET /api/v1/subscription
 * Retorna estado atual da assinatura
 */
router.get('/', asyncHandler(async (req, res) => {
  const ws = db.get(
    `SELECT id, name, plan, trial_end_at, subscription_status,
            next_billing_at, payment_provider, payment_customer_id, credits
     FROM workspaces WHERE id = ?`,
    [req.workspaceId]
  );

  if (!ws) throw new AppError('Workspace not found', 404);

  // Estado calculado
  const now = Date.now();
  const trialEnd = ws.trial_end_at ? new Date(ws.trial_end_at).getTime() : null;
  const isInTrial = trialEnd && trialEnd > now && ws.subscription_status === 'trialing';
  const trialDaysLeft = isInTrial ? Math.ceil((trialEnd - now) / 86400000) : 0;

  res.json({
    subscription: {
      plan: ws.plan,
      status: ws.subscription_status || 'trialing',
      trial_end_at: ws.trial_end_at,
      next_billing_at: ws.next_billing_at,
      payment_method: ws.payment_provider ? {
        provider: ws.payment_provider,
        customer_id: ws.payment_customer_id,
      } : null,
      is_in_trial: isInTrial,
      trial_days_left: trialDaysLeft,
      credits: ws.credits,
    },
  });
}));

/**
 * POST /api/v1/subscription/cancel
 * Cancela a assinatura. Acesso mantido até fim do período pago.
 * Apenas owner pode cancelar.
 */
router.post('/cancel',
  authorize('owner'),
  asyncHandler(async (req, res) => {
    const ws = db.get(
      `SELECT subscription_status, plan, next_billing_at FROM workspaces WHERE id = ?`,
      [req.workspaceId]
    );
    if (!ws) throw new AppError('Workspace not found', 404);

    if (ws.subscription_status === 'canceled') {
      throw new AppError('Assinatura já está cancelada', 400);
    }

    db.run(
      `UPDATE workspaces SET subscription_status = 'canceling',
                              updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [req.workspaceId]
    );

    logger.info(`[Subscription] Cancel requested for workspace ${req.workspaceId} by user ${req.userId}`);

    // Notificação opcional
    try {
      const alertManager = require('../observability/alertManager');
      alertManager.send('warning', '⚠️ Cancelamento solicitado', {
        workspace_id: req.workspaceId,
        plan: ws.plan,
      });
    } catch (_) {}

    res.json({
      success: true,
      message: ws.next_billing_at
        ? `Assinatura cancelada. Acesso mantido até ${new Date(ws.next_billing_at).toLocaleDateString('pt-BR')}.`
        : 'Assinatura cancelada. Acesso mantido até o fim do trial.',
      new_status: 'canceling',
    });
  })
);

/**
 * POST /api/v1/subscription/reactivate
 * Reativa uma assinatura que estava com status 'canceling' ou 'canceled'
 */
router.post('/reactivate',
  authorize('owner'),
  asyncHandler(async (req, res) => {
    const ws = db.get(
      `SELECT subscription_status FROM workspaces WHERE id = ?`,
      [req.workspaceId]
    );
    if (!ws) throw new AppError('Workspace not found', 404);

    if (!['canceling', 'canceled'].includes(ws.subscription_status)) {
      throw new AppError('Assinatura já está ativa', 400);
    }

    db.run(
      `UPDATE workspaces SET subscription_status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [req.workspaceId]
    );

    res.json({ success: true, message: 'Assinatura reativada com sucesso' });
  })
);

/**
 * POST /api/v1/subscription/change-plan
 * Troca o plano. Aplica imediatamente (proration ainda não suportado).
 */
router.post('/change-plan',
  authorize('owner'),
  asyncHandler(async (req, res) => {
    const { plan } = req.body;
    if (!['starter', 'pro', 'agency'].includes(plan)) {
      throw new AppError('Plano inválido', 400);
    }

    const ws = db.get(`SELECT plan FROM workspaces WHERE id = ?`, [req.workspaceId]);
    if (!ws) throw new AppError('Workspace not found', 404);

    if (ws.plan === plan) {
      throw new AppError(`Você já está no plano ${plan}`, 400);
    }

    db.run(
      `UPDATE workspaces SET plan = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [plan, req.workspaceId]
    );

    logger.info(`[Subscription] Plan changed: ${ws.plan} -> ${plan} for ${req.workspaceId}`);

    res.json({
      success: true,
      message: `Plano alterado para ${plan}. Próxima cobrança refletirá o novo valor.`,
      new_plan: plan,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────
// v9.3.3: rotas /validate e /sync — extensão chamava mas elas não existiam.
// Resultado: subscription-manager.js batia 404 silencioso e ficava sem
// validação/sincronização de créditos. Workspace podia gastar tokens sem
// limite porque o backend nunca confirmava saldo.
// ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/subscription/validate
 *
 * Body: { code? (legado, ignorado se workspace já autenticado) }
 * Retorna: { valid, plan, status, credits, expires_at, features }
 *
 * Chamado pela extensão a cada 5min para garantir que workspace ainda
 * tem assinatura ativa e créditos pra uso de IA.
 */
router.post('/validate', asyncHandler(async (req, res) => {
  const ws = db.get(
    `SELECT id, plan, subscription_status, trial_end_at, next_billing_at, credits
     FROM workspaces WHERE id = ?`,
    [req.workspaceId]
  );

  if (!ws) throw new AppError('Workspace not found', 404);

  const now = Date.now();
  const trialEndAt = ws.trial_end_at ? new Date(ws.trial_end_at).getTime() : null;
  const nextBillingAt = ws.next_billing_at ? new Date(ws.next_billing_at).getTime() : null;

  // Validar status
  let valid = false;
  let reason = null;
  if (ws.subscription_status === 'active') {
    valid = true;
  } else if (ws.subscription_status === 'trialing') {
    valid = trialEndAt && trialEndAt > now;
    if (!valid) reason = 'trial_expired';
  } else if (ws.subscription_status === 'cancelled') {
    // Mantém acesso até fim do período pago
    valid = nextBillingAt && nextBillingAt > now;
    if (!valid) reason = 'subscription_cancelled';
  } else {
    reason = `status_${ws.subscription_status}`;
  }

  res.json({
    valid,
    reason,
    plan: ws.plan,
    status: ws.subscription_status,
    credits: ws.credits || 0,
    expires_at: nextBillingAt || trialEndAt || null,
  });
}));

/**
 * POST /api/v1/subscription/sync
 *
 * Body: { code?, usage, credits }
 *   usage:   { tokens_used, ai_requests, ... } — telemetria do cliente
 *   credits: número que cliente acha que tem (servidor é fonte da verdade)
 *
 * Retorna estado consolidado do servidor.
 */
router.post('/sync', asyncHandler(async (req, res) => {
  const { usage = {}, credits: clientCredits } = req.body;

  const ws = db.get(
    `SELECT id, plan, subscription_status, credits, trial_end_at, next_billing_at
     FROM workspaces WHERE id = ?`,
    [req.workspaceId]
  );

  if (!ws) throw new AppError('Workspace not found', 404);

  // Servidor é fonte da verdade pra credits — cliente só recebe atualização
  // (usamos `usage` apenas pra telemetria, não atualizamos credits a partir dele
  // pra evitar manipulação client-side).

  // Telemetria: registra usage no analytics_events se houver
  if (usage && Object.keys(usage).length > 0) {
    try {
      db.run(
        `INSERT INTO analytics_events (id, workspace_id, event_type, event_data, created_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          require('crypto').randomUUID(),
          req.workspaceId,
          'subscription.usage_sync',
          JSON.stringify({ usage, client_credits: clientCredits })
        ]
      );
    } catch (e) {
      // Telemetria não-crítica, não trava sync
      logger.debug('[Subscription] Failed to log usage telemetry:', e.message);
    }
  }

  res.json({
    success: true,
    plan: ws.plan,
    status: ws.subscription_status,
    credits: ws.credits || 0,
    trial_end_at: ws.trial_end_at,
    next_billing_at: ws.next_billing_at,
    server_authoritative: true,
  });
}));

module.exports = router;
