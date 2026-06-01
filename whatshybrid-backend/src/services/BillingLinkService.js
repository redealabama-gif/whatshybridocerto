/**
 * BillingLinkService — Fase 3 da cobrança real
 *
 * Centraliza a geração de link de pagamento (init_point do MercadoPago)
 * pra um workspace. Antes desta extração, a lógica vivia no billingCron
 * privada — agora reusada por:
 *   1. billingCron.processExpiredTrials     (trial → past_due)
 *   2. billingCron.processExpiredSubscriptions (renovação não-automática)
 *   3. POST /api/v1/billing/recover-link    (usuário pede manualmente)
 *
 * Comportamento:
 *   - Aplica cupom pendente do workspace se houver (CouponService)
 *   - Persiste billing_intent (audit + idempotência)
 *   - Emite evento subscription.first_invoice_pending (email via listener)
 *   - Retorna { ok, payment_url, coupon_label, intent_id, reason? }
 *     NUNCA throw — caller passa pra loop ou pra resposta HTTP.
 *
 * Idempotência:
 *   - hasRecentPendingIntent(): se há billing_intent pending < 24h,
 *     gera() retorna { ok:false, reason:'recent_intent_exists' }
 *     UNLESS opts.force === true (usuário clicou "gerar novo link")
 */

const db = require('../utils/database');
const logger = require('../utils/logger');

const PENDING_INTENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Retorna a row pending mais recente ou null.
 */
function getRecentPendingIntent(workspaceId) {
  try {
    return db.get(
      `SELECT id, provider_ref, created_at FROM billing_intents
       WHERE workspace_id = ? AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [workspaceId]
    ) || null;
  } catch (_) {
    return null;
  }
}

function isRecentEnough(row) {
  if (!row) return false;
  const age = Date.now() - new Date(row.created_at).getTime();
  return age < PENDING_INTENT_WINDOW_MS;
}

/**
 * Gera (ou reusa) link de pagamento pra um workspace pago.
 *
 * @param {object} ws       - { id, plan, owner_id, name? }
 * @param {object} owner    - { email, name }  (pode ser null → vai buscar)
 * @param {object} [opts]
 * @param {boolean} [opts.force=false]
 *   Se true, ignora idempotência (24h) e SEMPRE chama MP. Use no endpoint
 *   manual (/recover-link) — usuário insistindo "gera de novo".
 * @param {string} [opts.source='manual']
 *   String pra metadata.source da billing_intent. Útil pra reporting:
 *     'billing_cron_first_invoice', 'billing_cron_renewal', 'manual_recover'
 * @returns {Promise<{ok, payment_url?, coupon_label?, intent_id?, reason?}>}
 */
async function generatePaymentLink(ws, owner, opts = {}) {
  const { force = false, source = 'manual' } = opts;
  if (!ws || !ws.id) return { ok: false, reason: 'missing_workspace' };

  const mpService = require('./MercadoPagoService');
  if (!mpService.isConfigured()) {
    return { ok: false, reason: 'mp_not_configured' };
  }
  if (!['starter', 'pro'].includes(ws.plan)) {
    return { ok: false, reason: 'plan_not_billable' };
  }

  // Idempotência — só pula se não for force
  if (!force) {
    const recent = getRecentPendingIntent(ws.id);
    if (isRecentEnough(recent)) {
      return {
        ok: false,
        reason: 'recent_intent_exists',
        intent_id: recent.id,
        // O caller (rota HTTP) pode oferecer "use o link anterior" via
        // billing_intent histórico. Por aqui só sinaliza.
      };
    }
  }

  // Owner (email/name) — buscar se não veio resolvido
  let resolvedOwner = owner;
  if (!resolvedOwner || !resolvedOwner.email) {
    try {
      resolvedOwner = db.get(
        'SELECT email, name FROM users WHERE id = ?',
        [ws.owner_id]
      );
    } catch (_) {}
  }
  if (!resolvedOwner || !resolvedOwner.email) {
    return { ok: false, reason: 'no_owner_email' };
  }

  // Cupom pendente (EXIT50 atribuído no signup, ainda não consumido)
  let couponCode, couponLabel;
  try {
    const couponService = require('./CouponService');
    const pending = couponService.getPendingCouponForWorkspace(ws.id, ws.plan);
    if (pending) {
      couponCode = pending.code;
      couponLabel = pending.description || pending.code;
    }
  } catch (_) {}

  let pref;
  try {
    pref = await mpService.createPreference({
      workspaceId: ws.id,
      plan: ws.plan,
      email: resolvedOwner.email,
      name: resolvedOwner.name || resolvedOwner.email,
      couponCode,
    });
  } catch (err) {
    logger.error(`[BillingLink] createPreference falhou ws=${ws.id}:`, err.message);
    return { ok: false, reason: 'mp_call_failed', error: err.message };
  }

  const intentId = require('crypto').randomUUID();
  try {
    db.run(
      `INSERT INTO billing_intents (id, workspace_id, plan, provider, provider_ref, status, metadata)
       VALUES (?, ?, ?, 'mercadopago', ?, 'pending', ?)`,
      [
        intentId,
        ws.id,
        ws.plan,
        pref.id,
        JSON.stringify({ source, coupon: couponCode || null }),
      ]
    );
  } catch (e) {
    logger.warn('[BillingLink] insert billing_intent falhou:', e.message);
    // Não bloqueia — link ainda é válido pro user pagar
  }

  const paymentUrl = process.env.MERCADOPAGO_USE_SANDBOX === 'true'
    ? (pref.sandbox_init_point || pref.init_point)
    : pref.init_point;

  // Email via listener (subscription.first_invoice_pending)
  try {
    const events = require('../utils/events');
    events.emit('subscription.first_invoice_pending', {
      workspace_id: ws.id,
      plan: ws.plan,
      payment_url: paymentUrl,
      coupon_label: couponLabel,
      source,
    });
  } catch (e) {
    logger.warn('[BillingLink] emit first_invoice_pending falhou:', e.message);
  }

  return {
    ok: true,
    payment_url: paymentUrl,
    coupon_label: couponLabel,
    intent_id: intentId,
    provider_ref: pref.id,
  };
}

module.exports = {
  generatePaymentLink,
  getRecentPendingIntent,
  isRecentEnough,
  PENDING_INTENT_WINDOW_MS,
};
