/**
 * Stripe Webhook Handler — v9.0.0
 *
 * POST /api/v1/webhooks/payment/stripe
 *
 * IMPORTANTE: este endpoint precisa receber rawBody (não JSON parsed).
 * Por isso é montado com `express.raw({ type: 'application/json', limit: '256kb' })`.
 */

const express = require('express');
const router = express.Router();

const db = require('../utils/database');
const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const stripeService = require('../services/StripeService');
const logger = require('../utils/logger');

router.post('/stripe',
  express.raw({ type: 'application/json', limit: '256kb' }),
  async (req, res) => {
    const rawBody = req.body;
    const signature = req.headers['stripe-signature'];

    if (!stripeService.validateWebhookSignature({ headers: req.headers, rawBody })) {
      logger.warn('[StripeWebhook] Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString());
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    // Outbox/inbox pattern (mesmo padrão do MP)
    let inboxId = null;
    try {
      inboxId = uuidv4();
      db.run(
        `INSERT INTO webhook_inbox (id, provider, event_type, provider_event_id, signature, raw_payload, status)
         VALUES (?, 'stripe', ?, ?, ?, ?, 'received')`,
        [inboxId, event.type, event.id, signature, rawBody.toString()]
      );
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) {
        logger.error(`[StripeWebhook] Inbox failed: ${err.message}`);
      }
    }

    res.status(200).json({ received: true });

    // Processa async
    try {
      if (inboxId) {
        db.run(`UPDATE webhook_inbox SET status = 'processing', attempts = attempts + 1 WHERE id = ?`, [inboxId]);
      }

      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object);
          break;
        case 'customer.subscription.created':
          await handleSubscriptionCreated(event.data.object);
          break;
        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object);
          break;
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object);
          break;
        case 'invoice.paid':
          await handleInvoicePaid(event.data.object);
          break;
        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object);
          break;
        // v9.3.9: refunds e chargebacks bloqueiam workspace + revogam tokens
        case 'charge.refunded':
        case 'charge.dispute.created':
          await handleRefundOrDispute(event.data.object, event.type);
          break;
        default:
          logger.debug(`[StripeWebhook] Ignored type: ${event.type}`);
      }

      if (inboxId) {
        db.run(`UPDATE webhook_inbox SET status = 'processed', processed_at = CURRENT_TIMESTAMP WHERE id = ?`, [inboxId]);
      }
    } catch (err) {
      logger.error(`[StripeWebhook] Processing error: ${err.message}`);
      if (inboxId) {
        db.run(`UPDATE webhook_inbox SET status = 'failed', last_error = ? WHERE id = ?`,
          [String(err.message).substring(0, 500), inboxId]);
      }
    }
  }
);

async function handleCheckoutCompleted(session) {
  const meta = session.metadata || {};
  const workspaceId = meta.workspace_id;
  const plan = meta.plan;

  if (!workspaceId) {
    logger.warn('[StripeWebhook] checkout.completed without workspace_id metadata');
    return;
  }

  // Idempotência
  const existing = db.get(
    `SELECT id FROM billing_invoices WHERE provider = 'stripe' AND provider_ref = ?`,
    [session.id]
  );
  if (existing) return;

  const next = new Date();
  next.setDate(next.getDate() + 30);

  db.transaction(() => {
    db.run(
      `UPDATE workspaces SET
         plan = ?, subscription_status = 'active',
         payment_provider = 'stripe',
         stripe_customer_id = ?,
         stripe_subscription_id = ?,
         next_billing_at = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [plan, session.customer, session.subscription, next.toISOString(), workspaceId]
    );

    db.run(
      `INSERT INTO billing_invoices (id, workspace_id, provider, provider_ref, amount, currency, status, paid_at)
       VALUES (?, ?, 'stripe', ?, ?, ?, 'paid', CURRENT_TIMESTAMP)`,
      [uuidv4(), workspaceId, session.id, session.amount_total / 100, session.currency.toUpperCase()]
    );
  });

  // Concede tokens
  try {
    const tokenService = require('../services/TokenService');
    tokenService.resetMonthlyForPlan(workspaceId, plan, { invoice_id: session.id });
  } catch (_) {}

  // Processa referral
  try {
    const userId = meta.user_id;
    if (userId) {
      const { processReferralConversion } = require('./referrals');
      await processReferralConversion(userId);
    }
  } catch (_) {}

  logger.info(`[StripeWebhook] Activated workspace ${workspaceId} on plan ${plan}`);
}

async function handleSubscriptionCreated(sub) {
  // Já tratado em checkout.completed normalmente
}

async function handleSubscriptionUpdated(sub) {
  if (!sub.metadata?.workspace_id) return;
  db.run(
    `UPDATE workspaces SET
       subscription_status = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE stripe_subscription_id = ?`,
    [sub.status, sub.id]
  );
}

async function handleSubscriptionDeleted(sub) {
  db.run(
    `UPDATE workspaces SET
       subscription_status = 'cancelled',
       auto_renew_enabled = 0,
       updated_at = CURRENT_TIMESTAMP
     WHERE stripe_subscription_id = ?`,
    [sub.id]
  );
}

async function handleInvoicePaid(invoice) {
  // Renovação mensal — recreditar tokens
  const sub = db.get(
    `SELECT id, plan FROM workspaces WHERE stripe_subscription_id = ?`,
    [invoice.subscription]
  );
  if (!sub) return;

  try {
    const tokenService = require('../services/TokenService');
    tokenService.resetMonthlyForPlan(sub.id, sub.plan, { invoice_id: invoice.id });
  } catch (_) {}

  db.run(
    `INSERT OR IGNORE INTO billing_invoices (id, workspace_id, provider, provider_ref, amount, currency, status, paid_at)
     VALUES (?, ?, 'stripe', ?, ?, ?, 'paid', CURRENT_TIMESTAMP)`,
    [uuidv4(), sub.id, invoice.id, invoice.amount_paid / 100, invoice.currency.toUpperCase()]
  );
}

async function handlePaymentFailed(invoice) {
  const ws = db.get(
    `SELECT id FROM workspaces WHERE stripe_subscription_id = ?`,
    [invoice.subscription]
  );
  if (!ws) return;
  db.run(
    `UPDATE workspaces SET subscription_status = 'past_due' WHERE id = ?`,
    [ws.id]
  );
  logger.warn(`[StripeWebhook] Payment failed for workspace ${ws.id}`);
}

/**
 * v9.3.9: Refund/Chargeback handler.
 * Cliente pagou e fez refund OU chargeback no cartão → suspende workspace
 * e zera saldo de tokens pra evitar uso de IA grátis.
 */
async function handleRefundOrDispute(charge, eventType) {
  // charge.refunded carrega payment_intent; charge.dispute.created carrega charge id direto
  const paymentRef = charge.payment_intent || charge.charge || charge.id;
  if (!paymentRef) {
    logger.warn(`[StripeWebhook] ${eventType} sem payment_intent/charge`);
    return;
  }

  // Encontra workspace via billing_invoices.provider_ref
  const invoice = db.get(
    `SELECT id, workspace_id FROM billing_invoices
     WHERE provider = 'stripe' AND provider_ref = ?`,
    [paymentRef]
  );

  if (!invoice) {
    // Pode ser refund de checkout.session — buscar por session.id também
    logger.warn(`[StripeWebhook] ${eventType}: invoice não encontrada para ref=${paymentRef}`);
    return;
  }

  const wsId = invoice.workspace_id;

  db.transaction(() => {
    // Marca invoice como refunded
    db.run(
      `UPDATE billing_invoices SET status = 'refunded' WHERE id = ?`,
      [invoice.id]
    );

    // Suspende workspace
    db.run(
      `UPDATE workspaces SET subscription_status = 'cancelled', auto_renew_enabled = 0,
                              updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [wsId]
    );

    // Zera saldo de tokens (cliente perdeu o que comprou)
    db.run(
      `UPDATE workspace_credits
       SET tokens_total = tokens_used,
           updated_at = CURRENT_TIMESTAMP
       WHERE workspace_id = ?`,
      [wsId]
    );

    // Registra na auditoria
    const { v4: uuid } = require('../utils/uuid-wrapper');
    db.run(
      `INSERT INTO token_transactions
        (id, workspace_id, type, amount, balance_after, invoice_id, description, metadata)
       VALUES (?, ?, 'adjustment', 0, 0, ?, ?, ?)`,
      [
        uuid(),
        wsId,
        invoice.id,
        `Saldo zerado: ${eventType}`,
        JSON.stringify({ stripe_event: eventType, payment_ref: paymentRef }),
      ]
    );
  });

  logger.warn(`[StripeWebhook] ${eventType}: workspace=${wsId} suspenso, tokens revogados`);

  // Alerta crítico
  try {
    const alertManager = require('../observability/alertManager');
    alertManager.send('warning', `🚨 ${eventType === 'charge.dispute.created' ? 'Chargeback' : 'Refund'} processado`, {
      workspace_id: wsId,
      invoice_id: invoice.id,
      payment_ref: paymentRef,
      action: 'workspace_suspended_tokens_zeroed',
    });
  } catch (_) {}
}

module.exports = router;
