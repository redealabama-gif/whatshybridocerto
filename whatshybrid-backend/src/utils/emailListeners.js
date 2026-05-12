/**
 * Email Listeners - v8.4.0
 *
 * Conecta o EventBus aos templates de email do EmailService.
 * É chamado uma única vez no startup do server.
 *
 * Eventos escutados:
 *   - tokens.low_balance         → email "tokens acabando"
 *   - tokens.topup_confirmed     → email "topup confirmado"
 *   - subscription.activated     → email "pagamento confirmado"
 *   - subscription.trial_ending  → email "trial expirando"
 *   - subscription.charge_failed → email "pagamento recusado"
 */

const events = require('./events');
const emailService = require('../services/EmailService');
const db = require('./database');
const logger = require('./logger');

let initialized = false;

/**
 * Carrega user owner+email a partir do workspace_id.
 */
function getOwnerInfo(workspaceId) {
  try {
    return db.get(
      `SELECT u.email, u.name, w.plan, w.id AS workspace_id
       FROM workspaces w JOIN users u ON u.id = w.owner_id
       WHERE w.id = ?`,
      [workspaceId]
    );
  } catch (_) {
    return null;
  }
}

function setup() {
  if (initialized) return;
  initialized = true;

  // ── Tokens acabando (10% restante) ──
  events.on('tokens.low_balance', async (payload) => {
    try {
      const owner = getOwnerInfo(payload.workspace_id);
      if (!owner) return;
      await emailService.sendTokensLow({
        to: owner.email,
        name: owner.name,
        balance: payload.balance,
        total: payload.total,
        pct: payload.pct,
      });
    } catch (err) {
      logger.warn('[EmailListener] tokens.low_balance failed:', err.message);
    }
  });

  // ── Tokens esgotados (saldo zero) ──
  events.on('tokens.exhausted', async (payload) => {
    try {
      const owner = getOwnerInfo(payload.workspace_id);
      if (!owner) return;
      await emailService.sendTokensExhausted({ to: owner.email, name: owner.name });
    } catch (err) {
      logger.warn('[EmailListener] tokens.exhausted failed:', err.message);
    }
  });

  // ── Topup confirmado ──
  events.on('tokens.topup_confirmed', async (payload) => {
    try {
      const owner = getOwnerInfo(payload.workspace_id);
      if (!owner) return;
      await emailService.send({
        to: owner.email,
        subject: `🪙 ${payload.tokens_added.toLocaleString('pt-BR')} tokens adicionados`,
        html: emailService._wrap({
          title: 'Tokens adicionados ✓',
          body: `<p>Adicionamos <strong>${payload.tokens_added.toLocaleString('pt-BR')}</strong> tokens à sua conta.</p>`,
          ctaLabel: 'Ver saldo',
          ctaUrl: `${process.env.PUBLIC_BASE_URL || ''}/dashboard.html#tokens`,
        }),
      });
    } catch (err) {
      logger.warn('[EmailListener] topup_confirmed failed:', err.message);
    }
  });

  // ── Assinatura ativada (após pagamento) ──
  events.on('subscription.activated', async (payload) => {
    try {
      const owner = getOwnerInfo(payload.workspace_id);
      if (!owner) return;
      await emailService.sendPaymentConfirmed({
        to: owner.email,
        name: owner.name,
        plan: payload.plan,
        amount: payload.amount,
        paymentId: payload.payment_id,
      });
    } catch (err) {
      logger.warn('[EmailListener] subscription.activated failed:', err.message);
    }
  });

  // ── Welcome email após signup ──
  events.on('user.signup', async (payload) => {
    try {
      await emailService.sendWelcome({
        to: payload.email,
        name: payload.name,
        plan: payload.plan,
        trialDays: payload.trialDays || 7,
      });
    } catch (err) {
      logger.warn('[EmailListener] user.signup failed:', err.message);
    }
  });

  // ── Trial terminando (3 dias antes) ──
  events.on('subscription.trial_ending', async (payload) => {
    try {
      const owner = getOwnerInfo(payload.workspace_id);
      if (!owner) return;
      const planPrices = { starter: 97, pro: 197, agency: 497 };
      await emailService.sendTrialEnding({
        to: owner.email,
        name: owner.name,
        daysLeft: payload.days_left,
        plan: owner.plan,
        planPrice: planPrices[owner.plan] || 197,
      });
    } catch (err) {
      logger.warn('[EmailListener] trial_ending failed:', err.message);
    }
  });

  // ── Cobrança recusada ──
  events.on('subscription.charge_failed', async (payload) => {
    try {
      const owner = getOwnerInfo(payload.workspace_id);
      if (!owner) return;
      await emailService.sendChargeFailed({
        to: owner.email,
        name: owner.name,
        plan: owner.plan,
        retryDate: payload.next_retry_at,
      });
    } catch (err) {
      logger.warn('[EmailListener] charge_failed failed:', err.message);
    }
  });

  logger.info('[EmailListener] Subscriptions ativas para 7 eventos');
}

module.exports = { setup };
