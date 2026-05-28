/**
 * GoogleAnalyticsMpService — Google Analytics 4 Measurement Protocol v2.
 *
 * Espelha do server-side os eventos do GA4 que o gtag.js dispara no browser.
 * Mesmo motivo do Meta CAPI: browser perde eventos pra adblock e tracking
 * limits do iOS — MP server-side recupera essa parte.
 *
 * Endpoint:
 *   POST https://www.google-analytics.com/mp/collect
 *        ?measurement_id=<GA4_MEASUREMENT_ID>&api_secret=<GA4_API_SECRET>
 *
 * Configuração via env vars (vazias = no-op silencioso):
 *
 *   GA4_MEASUREMENT_ID   "G-XXXXXXXXXX" (mesmo do browser).
 *   GA4_API_SECRET       Criar em GA4 → Admin → Data Streams → Web stream →
 *                        Measurement Protocol API secrets → Create.
 *   GA4_DEBUG            Opcional. "1" envia para /debug/mp/collect (validação
 *                        sem persistir; útil para testar sem poluir o GA4).
 *
 * client_id: GA4 exige um client_id único por usuário/dispositivo. Pode vir
 * do cookie `_ga` (capturado em marketing-attribution.js → signup_attribution).
 * Fallback é UUID aleatório, que faz o GA4 tratar como sessão server-only —
 * funciona mas o user não é stitched ao browser do mesmo cliente.
 */

'use strict';

const crypto = require('crypto');
const axios = require('axios');
const logger = require('../utils/logger');

const MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID || '';
const API_SECRET = process.env.GA4_API_SECRET || '';
const DEBUG_MODE = process.env.GA4_DEBUG === '1';

const TIMEOUT_MS = 5000;

function isConfigured() {
  return Boolean(MEASUREMENT_ID && API_SECRET);
}

/**
 * Envia evento GA4 via Measurement Protocol.
 *
 * @param {Object} opts
 * @param {string} opts.eventName     Ex.: 'purchase', 'sign_up'
 * @param {Object} opts.params        Custom event params (currency, value, ...)
 * @param {string} opts.clientId      Obrigatório. Use signup_attribution.ga_client_id
 *                                    ou UUID aleatório como fallback.
 * @param {string} [opts.userId]      Opcional. ID interno do usuário (não PII).
 * @param {number} [opts.timestampMicros]
 * @returns {Promise<{success:boolean, skipped?:boolean, error?:string}>}
 */
async function sendEvent({ eventName, params = {}, clientId, userId, timestampMicros } = {}) {
  if (!isConfigured()) {
    return { success: false, skipped: true, reason: 'GA4 MP not configured' };
  }
  if (!eventName) return { success: false, error: 'eventName required' };
  if (!clientId)  return { success: false, error: 'clientId required' };

  const body = {
    client_id: clientId,
    events: [{ name: eventName, params }],
    ...(userId && { user_id: String(userId) }),
    ...(timestampMicros && { timestamp_micros: timestampMicros }),
  };

  const endpoint = DEBUG_MODE
    ? 'https://www.google-analytics.com/debug/mp/collect'
    : 'https://www.google-analytics.com/mp/collect';

  try {
    const res = await axios.post(endpoint, body, {
      params: { measurement_id: MEASUREMENT_ID, api_secret: API_SECRET },
      timeout: TIMEOUT_MS,
    });
    if (DEBUG_MODE) {
      const valid = res.data?.validationMessages?.length === 0;
      logger.info(`[GA4 MP/debug] ${eventName}: ${valid ? 'VALID' : 'INVALID'}` +
        (valid ? '' : ' — ' + JSON.stringify(res.data.validationMessages)));
    } else {
      logger.info(`[GA4 MP] ${eventName} sent (client_id=${clientId.substring(0, 12)}...)`);
    }
    return { success: true, data: res.data };
  } catch (err) {
    logger.warn(`[GA4 MP] ${eventName} FAILED: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Helper de alto nível: dispara 'purchase' (equivalente GA4 do Meta
 * 'Subscribe') puxando dados do owner do workspace direto do DB.
 *
 * Compartilhado entre webhooks de pagamento (Stripe, MercadoPago) — toda
 * vez que um workspace muda pra subscription_status='active' depois de
 * payment confirm, este helper é o único ponto de entrada GA4.
 *
 * Idempotência: o `transaction_id` deve ser determinístico (ex.:
 * stripe_session.id ou mp_payment_id). GA4 não tem dedup automático por
 * transaction_id em MP, mas event_id permite filtrar duplicados em queries
 * BigQuery e o GA4 UI nativo agrupa por transaction_id.
 */
async function sendPurchaseForWorkspace({
  workspaceId, plan, amount, currency, transactionId, provider, db,
}) {
  if (!isConfigured()) return { success: false, skipped: true };
  if (!db) return { success: false, error: 'db handle required' };

  const row = db.get(
    `SELECT u.email, u.id AS user_id, u.signup_attribution
     FROM users u
     JOIN workspaces w ON w.owner_id = u.id
     WHERE w.id = ?`,
    [workspaceId]
  );
  if (!row) {
    logger.warn(`[GA4 MP] Purchase: owner not found for workspace ${workspaceId}`);
    return { success: false, error: 'owner not found' };
  }

  let attribution = null;
  if (row.signup_attribution) {
    try { attribution = JSON.parse(row.signup_attribution); } catch (_) {}
  }

  // client_id vem do cookie _ga capturado no signup. Sem ele, GA4 trata
  // como sessão server-only e não consegue stitchar ao browser do user —
  // mas o user_id (hash do email) ainda funciona pra agregar conversões
  // por usuário no GA4.
  const clientId = attribution?.ga_client_id ||
    `${Math.floor(Math.random() * 1e10)}.${Math.floor(Date.now() / 1000)}`;

  const userIdHash = crypto.createHash('sha256')
    .update(String(row.email || row.user_id).toLowerCase().trim())
    .digest('hex');

  return sendEvent({
    eventName: 'purchase',
    clientId,
    userId: userIdHash,
    params: {
      transaction_id: transactionId,
      value: amount,
      currency: currency || 'BRL',
      affiliation: provider,
      items: [{
        item_id: 'plan_' + plan,
        item_name: 'Plano ' + plan,
        item_category: 'subscription',
        price: amount,
        quantity: 1,
      }],
    },
  });
}

module.exports = {
  sendEvent,
  sendPurchaseForWorkspace,
  isConfigured,
};
