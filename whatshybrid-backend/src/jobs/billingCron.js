/**
 * Billing Cron - v8.3.0
 *
 * Job diário que roda às 03:00 (configurável via BILLING_CRON_SCHEDULE):
 * 1. Verifica trials que expiraram nas últimas 24h:
 *    - Se workspace tem cartão configurado → tenta cobrar via MP
 *    - Se não tem → marca como past_due e envia email
 * 2. Verifica cobranças failed que precisam retry (dunning 3 tentativas em 7 dias):
 *    - dia 1, 3, 7 após falha
 *    - após 3 falhas, marca subscription_status='past_due' e suspende acesso
 * 3. Notifica owner do SaaS (você) por alertManager
 *
 * NOTA: Para cobrança recorrente automática, é preciso ter o cliente com método
 * de pagamento salvo (token de cartão). MercadoPago suporta isso via "preapprovals"
 * (recurring) ou "card tokens". Implementação completa requer integração mais
 * profunda com o flow de tokenização. Por enquanto, este cron:
 *   - Detecta trials expirando e marca past_due
 *   - Envia notificações
 *   - Marca workspaces para revisão manual ou re-engajamento
 *
 * A "cobrança recorrente automática real" é Onda 4.5 (futuro).
 */

const cron = require('node-cron');
const db = require('../utils/database');
const logger = require('../utils/logger');

let alertManager;
try { alertManager = require('../observability/alertManager'); } catch (_) {}

const SCHEDULE = process.env.BILLING_CRON_SCHEDULE || '0 3 * * *'; // 03:00 todos os dias

/**
 * Encontra workspaces cujo trial acabou e ainda está em status 'trialing'.
 * Marca como 'past_due' (precisa pagar) ou 'active' se já tem invoice paga.
 */
function processExpiredTrials() {
  const now = new Date();

  let expiredTrials = [];
  try {
    // v9.3.9 BILLING FIX: removida janela de 24h (yesterday filter).
    // Antes: se cron não rodasse por >24h (crash/deploy/network),
    // trials que expiraram fora da janela ficavam 'trialing' pra sempre.
    // Cliente usava IA grátis indefinidamente.
    // Agora: pega TODOS os trials cujo trial_end_at já passou, sem janela.
    // Idempotente porque depois de processar muda status pra 'active' ou 'past_due'.
    expiredTrials = db.all(
      `SELECT id, name, plan, owner_id, trial_end_at
       FROM workspaces
       WHERE subscription_status = 'trialing'
         AND trial_end_at IS NOT NULL
         AND trial_end_at <= ?`,
      [now.toISOString()]
    ) || [];
  } catch (err) {
    logger.error('[BillingCron] Erro ao buscar trials expirados:', err.message);
    return [];
  }

  if (expiredTrials.length === 0) {
    logger.debug('[BillingCron] Nenhum trial expirado pendente');
    return [];
  }

  logger.info(`[BillingCron] ${expiredTrials.length} trials expirados pendentes`);

  const results = [];
  for (const ws of expiredTrials) {
    // Já existe invoice paga para este workspace?
    let paidInvoice = null;
    try {
      paidInvoice = db.get(
        `SELECT id FROM billing_invoices
         WHERE workspace_id = ? AND status = 'paid'
         ORDER BY paid_at DESC LIMIT 1`,
        [ws.id]
      );
    } catch (_) {}

    if (paidInvoice) {
      // Pagou — está tudo certo, vira active
      try {
        db.run(
          `UPDATE workspaces SET subscription_status = 'active' WHERE id = ?`,
          [ws.id]
        );
        results.push({ workspace_id: ws.id, action: 'activated' });
      } catch (e) {
        logger.error(`[BillingCron] Erro ao ativar ${ws.id}:`, e.message);
      }
    } else {
      // Não pagou — past_due
      try {
        db.run(
          `UPDATE workspaces SET subscription_status = 'past_due' WHERE id = ?`,
          [ws.id]
        );
        results.push({ workspace_id: ws.id, action: 'past_due', plan: ws.plan });

        if (alertManager) {
          alertManager.send('warning', '⏰ Trial expirado sem pagamento', {
            workspace_id: ws.id,
            workspace_name: ws.name,
            plan: ws.plan,
            trial_end: ws.trial_end_at,
          });
        }
      } catch (e) {
        logger.error(`[BillingCron] Erro ao marcar past_due ${ws.id}:`, e.message);
      }
    }
  }

  return results;
}

/**
 * Encontra subscriptions next_billing_at vencidas e tenta gerar nova cobrança.
 * (Stub: marca como pending_renewal, envia email — cobrança real requer token de cartão.)
 */
function processExpiredSubscriptions() {
  const now = new Date();

  let toRenew = [];
  try {
    toRenew = db.all(
      `SELECT id, name, plan, owner_id, next_billing_at
       FROM workspaces
       WHERE subscription_status = 'active'
         AND next_billing_at IS NOT NULL
         AND next_billing_at <= ?`,
      [now.toISOString()]
    ) || [];
  } catch (err) {
    logger.error('[BillingCron] Erro ao buscar renovações:', err.message);
    return [];
  }

  if (toRenew.length === 0) return [];

  logger.info(`[BillingCron] ${toRenew.length} workspaces precisam de renovação`);

  const results = [];
  for (const ws of toRenew) {
    // Marca como past_due — o owner do SaaS toma providência
    // (ou trigger automático via card token, que é Onda 4.5)
    try {
      db.run(
        `UPDATE workspaces SET subscription_status = 'past_due' WHERE id = ?`,
        [ws.id]
      );
      results.push({ workspace_id: ws.id, action: 'renewal_due', plan: ws.plan });

      if (alertManager) {
        alertManager.send('warning', '🔁 Renovação pendente', {
          workspace_id: ws.id,
          workspace_name: ws.name,
          plan: ws.plan,
          due_at: ws.next_billing_at,
        });
      }
    } catch (e) {
      logger.error(`[BillingCron] Erro renewal ${ws.id}:`, e.message);
    }
  }

  return results;
}

/**
 * Suspende workspaces que estão past_due há mais de 7 dias.
 */
function suspendDelinquent() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

  let toSuspend = [];
  try {
    toSuspend = db.all(
      `SELECT id, name, plan FROM workspaces
       WHERE subscription_status = 'past_due'
         AND updated_at <= ?`,
      [sevenDaysAgo.toISOString()]
    ) || [];
  } catch (err) {
    return [];
  }

  for (const ws of toSuspend) {
    try {
      db.run(
        `UPDATE workspaces SET subscription_status = 'suspended' WHERE id = ?`,
        [ws.id]
      );
      logger.warn(`[BillingCron] Workspace ${ws.id} (${ws.name}) suspendido por inadimplência`);

      if (alertManager) {
        alertManager.send('critical', '🚫 Workspace suspenso', {
          workspace_id: ws.id,
          workspace_name: ws.name,
          plan: ws.plan,
          reason: '7 dias past_due',
        });
      }
    } catch (e) {
      logger.error(`[BillingCron] Erro suspend ${ws.id}:`, e.message);
    }
  }
  return toSuspend;
}

/**
 * v8.4.0 — Notifica trials que terminam em 3 dias (envia email).
 * Roda diariamente, dispara apenas no dia exato (3 dias antes do trial_end_at).
 */
function notifyTrialsEnding() {
  const threeDaysFromNow = new Date(Date.now() + 3 * 86400000);
  const fourDaysFromNow = new Date(Date.now() + 4 * 86400000);

  let endingSoon = [];
  try {
    endingSoon = db.all(
      `SELECT id, plan, trial_end_at
       FROM workspaces
       WHERE subscription_status = 'trialing'
         AND trial_end_at IS NOT NULL
         AND trial_end_at >= ?
         AND trial_end_at < ?`,
      [threeDaysFromNow.toISOString(), fourDaysFromNow.toISOString()]
    ) || [];
  } catch (err) {
    return [];
  }

  let events;
  try { events = require('../utils/events'); } catch (_) {}

  for (const ws of endingSoon) {
    try {
      if (events) {
        events.emit('subscription.trial_ending', {
          workspace_id: ws.id,
          plan: ws.plan,
          days_left: 3,
        });
      }
      logger.info(`[BillingCron] Trial ending notification queued for ${ws.id}`);
    } catch (e) {
      logger.error(`[BillingCron] Erro ao notificar trial ending ${ws.id}:`, e.message);
    }
  }

  return endingSoon;
}

/**
 * Run all jobs in sequence
 */
function runAll() {
  const start = Date.now();
  logger.info('[BillingCron] Iniciando ciclo diário');
  try {
    const trials = processExpiredTrials();
    const renewals = processExpiredSubscriptions();
    const suspended = suspendDelinquent();
    const endingSoon = notifyTrialsEnding();

    // v9.0.0: drip campaigns + health score
    let dripResult = { processed: 0, sent: 0 };
    let healthResult = { updated: 0 };
    try {
      const drip = require('../services/DripCampaignService');
      drip.processDripCampaigns().then(r => {
        dripResult = r;
        logger.info(`[BillingCron] Drip: ${r.sent}/${r.processed} sent`);
      }).catch(e => logger.error('[BillingCron] Drip failed:', e.message));
    } catch (e) { logger.warn('[BillingCron] Drip skipped:', e.message); }

    try {
      const health = require('../services/HealthScoreService');
      healthResult = health.updateAllHealthScores();
    } catch (e) { logger.warn('[BillingCron] HealthScore skipped:', e.message); }

    const summary = {
      trials_processed: trials.length,
      renewals_due: renewals.length,
      workspaces_suspended: suspended.length,
      trial_ending_notifications: endingSoon.length,
      health_scores_updated: healthResult.updated,
      duration_ms: Date.now() - start,
    };
    logger.info('[BillingCron] Ciclo concluído', summary);
    return summary;
  } catch (err) {
    logger.error('[BillingCron] Erro no ciclo:', err);
    if (alertManager) {
      alertManager.send('critical', '💥 Billing cron falhou', { error: err.message });
    }
    throw err;
  }
}

let scheduledTask = null;
let emailOutboxTask = null;
let webhookStuckTask = null;
let loginAttemptsCleanupTask = null;

function start() {
  if (scheduledTask) {
    logger.warn('[BillingCron] Já está agendado');
    return scheduledTask;
  }

  if (process.env.BILLING_CRON_DISABLED === 'true') {
    logger.info('[BillingCron] Desabilitado via BILLING_CRON_DISABLED=true');
    return null;
  }

  logger.info(`[BillingCron] Agendado: ${SCHEDULE}`);
  scheduledTask = cron.schedule(SCHEDULE, runAll, {
    scheduled: true,
    timezone: process.env.TZ || 'America/Sao_Paulo',
  });

  // ── v8.5.0: Email Outbox processor — a cada 5 minutos ──
  if (process.env.EMAIL_OUTBOX_DISABLED !== 'true') {
    emailOutboxTask = cron.schedule('*/5 * * * *', async () => {
      try {
        const emailService = require('../services/EmailService');
        await emailService.processOutbox(20);
      } catch (err) {
        logger.error(`[EmailOutbox cron] Error: ${err.message}`);
      }
    });
    logger.info('[BillingCron] Email outbox processor agendado: */5 * * * *');
  }

  // ── v9.2.0: Webhook stuck cleanup — a cada 5 minutos ──
  // Webhooks que ficaram em 'processing' > 2min sem terminar viram 'failed'
  // pra serem reprocessados pelo retry cron. Sem isso, cliente paga e
  // não é ativado se o handler crashou no meio.
  webhookStuckTask = cron.schedule('*/5 * * * *', () => {
    try {
      const db = require('../utils/database');
      const r = db.run(
        `UPDATE webhook_inbox
         SET status = 'failed',
             last_error = COALESCE(last_error || ' | ', '') || 'auto-failed: stuck in processing > 2min'
         WHERE status = 'processing'
           AND (
             received_at < datetime('now', '-2 minutes')
             OR processed_at IS NULL AND received_at < datetime('now', '-2 minutes')
           )`
      );
      if (r.changes > 0) {
        logger.warn(`[WebhookStuck cron] Marked ${r.changes} stuck webhooks as 'failed' for retry`);
        // Alerta se houver muitos
        if (r.changes >= 5) {
          try {
            const alertManager = require('../observability/alertManager');
            alertManager?.send?.('warning', `🚨 ${r.changes} webhooks travados em 'processing'`, {
              hint: 'Investigue se há crash no handler de webhook',
            });
          } catch (_) {}
        }
      }
    } catch (err) {
      logger.error(`[WebhookStuck cron] Error: ${err.message}`);
    }
  });
  logger.info('[BillingCron] Webhook stuck cleanup agendado: */5 * * * *');

  // ── v9.2.0: Login attempts cleanup — diário às 3h ──
  loginAttemptsCleanupTask = cron.schedule('0 3 * * *', () => {
    try {
      const loginAttempts = require('../services/LoginAttemptsService');
      loginAttempts.cleanup();
    } catch (err) {
      logger.error(`[LoginAttemptsCleanup] Error: ${err.message}`);
    }
  });
  logger.info('[BillingCron] Login attempts cleanup agendado: 0 3 * * *');

  return scheduledTask;
}

function stop() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info('[BillingCron] Parado');
  }
  if (emailOutboxTask) {
    emailOutboxTask.stop();
    emailOutboxTask = null;
    logger.info('[EmailOutbox cron] Parado');
  }
  if (webhookStuckTask) {
    webhookStuckTask.stop();
    webhookStuckTask = null;
    logger.info('[WebhookStuck cron] Parado');
  }
  if (loginAttemptsCleanupTask) {
    loginAttemptsCleanupTask.stop();
    loginAttemptsCleanupTask = null;
  }
}

module.exports = { start, stop, runAll, processExpiredTrials, processExpiredSubscriptions, suspendDelinquent };
