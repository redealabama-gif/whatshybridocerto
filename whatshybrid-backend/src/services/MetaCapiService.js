/**
 * MetaCapiService — Meta Conversions API (server-side events).
 *
 * Posta eventos para Graph API (`graph.facebook.com/<v>/<PIXEL_ID>/events`)
 * complementando o Pixel do browser. Server-side escapa de adblock e das
 * limitações de tracking iOS 14+ — costuma recuperar 20-40% dos eventos
 * que o browser perde.
 *
 * Configuração via env vars (sem env = no-op silencioso, zero overhead):
 *
 *   META_PIXEL_ID         Pixel ID (mesmo do browser).
 *   META_CAPI_TOKEN       Access token CAPI (criar em Events Manager →
 *                         Settings → "Generate access token").
 *   META_TEST_EVENT_CODE  Opcional. Quando setado, eventos aparecem na aba
 *                         "Test Events" do Events Manager (útil pra debug,
 *                         remover em produção).
 *   META_API_VERSION      Opcional. Default 'v18.0'.
 *
 * Dedup com browser pixel: para cada evento server-side, gere um event_id
 * único e ECOE o MESMO event_id no browser via `fbq('track', evt, data,
 * { eventID: ID })`. Meta deduplica pelo par (event_name, event_id) numa
 * janela de 7 dias. Sem dedup, eventos disparados nos dois lados são
 * contabilizados em dobro.
 */

'use strict';

const crypto = require('crypto');
const axios = require('axios');
const logger = require('../utils/logger');

const PIXEL_ID = process.env.META_PIXEL_ID || '';
const ACCESS_TOKEN = process.env.META_CAPI_TOKEN || '';
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || '';
const API_VERSION = process.env.META_API_VERSION || 'v18.0';

const TIMEOUT_MS = 5000;

function isConfigured() {
  return Boolean(PIXEL_ID && ACCESS_TOKEN);
}

function sha256(value) {
  if (value == null || value === '') return undefined;
  return crypto
    .createHash('sha256')
    .update(String(value).toLowerCase().trim())
    .digest('hex');
}

function normalizePhone(phone) {
  if (!phone) return undefined;
  const digits = String(phone).replace(/\D/g, '');
  return digits || undefined;
}

/**
 * Constrói o objeto `user_data` no formato esperado pela Meta CAPI.
 * Campos PII são SHA-256 hashed; IP/UA/fbc/fbp vão em plain text.
 *
 * Match rate melhora muito quando você passa mais campos — Meta cruza
 * vários sinais. Mínimo recomendado: em + (fbc OU client_ip_address).
 */
function buildUserData({
  email, phone, firstName, lastName, externalId,
  ip, userAgent, fbc, fbp,
} = {}) {
  const ud = {};
  if (email) ud.em = sha256(email);
  const ph = normalizePhone(phone);
  if (ph) ud.ph = sha256(ph);
  if (firstName) ud.fn = sha256(firstName);
  if (lastName) ud.ln = sha256(lastName);
  if (externalId) ud.external_id = sha256(externalId);
  if (ip) ud.client_ip_address = ip;
  if (userAgent) ud.client_user_agent = userAgent;
  if (fbc) ud.fbc = fbc;
  if (fbp) ud.fbp = fbp;
  return ud;
}

/**
 * fbclid → fbc cookie format esperado pela Meta:
 *   "fb.<subdomainIndex>.<creationTimestamp_ms>.<fbclid>"
 *
 * - subdomainIndex: 1 (single-domain). 0 = root, 2 = com.example etc.
 * - creationTimestamp: ms desde epoch (quando o click aconteceu — usamos
 *   captured_at da atribuição se disponível, fallback now).
 */
function fbclidToFbc(fbclid, capturedAtIso) {
  if (!fbclid) return undefined;
  let ts = Date.now();
  if (capturedAtIso) {
    const parsed = Date.parse(capturedAtIso);
    if (!Number.isNaN(parsed)) ts = parsed;
  }
  return `fb.1.${ts}.${fbclid}`;
}

/**
 * Helper: dado o JSON de atribuição salvo em users.signup_attribution,
 * extrai os campos relevantes pro user_data CAPI.
 */
function userDataFromAttribution(attribution) {
  if (!attribution) return {};
  const fbc = fbclidToFbc(attribution.fbclid, attribution.captured_at);
  return { fbc };
}

/**
 * Envia um evento à Meta CAPI. Não-blocking: erros são logados mas não
 * propagados (eventos de marketing não devem derrubar fluxo principal).
 *
 * @param {Object} opts
 * @param {string} opts.eventName       Ex.: 'CompleteRegistration', 'Subscribe'
 * @param {string} [opts.eventId]       UUID p/ dedup com browser pixel
 * @param {number} [opts.eventTime]     Unix seconds; default = now
 * @param {string} [opts.eventSourceUrl] URL onde o evento "aconteceu"
 * @param {Object} [opts.userData]      Output de buildUserData (ou raw)
 * @param {Object} [opts.customData]    { value, currency, content_name, ... }
 * @returns {Promise<{success:boolean, skipped?:boolean, error?:string}>}
 */
async function sendEvent({
  eventName,
  eventId,
  eventTime,
  eventSourceUrl,
  userData = {},
  customData = {},
} = {}) {
  if (!isConfigured()) {
    return { success: false, skipped: true, reason: 'CAPI not configured' };
  }
  if (!eventName) {
    return { success: false, error: 'eventName required' };
  }

  const event = {
    event_name: eventName,
    event_time: eventTime || Math.floor(Date.now() / 1000),
    action_source: 'website',
    user_data: userData,
    custom_data: customData,
  };
  if (eventId) event.event_id = eventId;
  if (eventSourceUrl) event.event_source_url = eventSourceUrl;

  const payload = { data: [event] };
  if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;

  const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events`;

  try {
    const res = await axios.post(url, payload, {
      params: { access_token: ACCESS_TOKEN },
      timeout: TIMEOUT_MS,
    });
    logger.info(
      `[MetaCapi] ${eventName} sent (event_id=${eventId || '-'}, ` +
      `received=${res.data?.events_received}, fbtrace=${res.data?.fbtrace_id})`
    );
    return { success: true, data: res.data };
  } catch (err) {
    const meta = err.response?.data?.error;
    logger.warn(
      `[MetaCapi] ${eventName} FAILED: ${err.message}` +
      (meta ? ` | Meta: ${meta.message} (code=${meta.code}, sub=${meta.error_subcode})` : '')
    );
    return { success: false, error: err.message };
  }
}

/**
 * Helper de alto nível: dispara `Subscribe` puxando dados do owner do
 * workspace direto do DB (email, name, signup_attribution).
 *
 * Compartilhado entre webhooks de pagamento (Stripe, MercadoPago) — toda
 * vez que um workspace muda pra subscription_status='active' depois de
 * payment confirm, este helper é o único ponto de entrada.
 *
 * Idempotência: cabe ao chamador passar um eventId determinístico (ex.:
 * `stripe_${session.id}` ou `mp_${paymentId}`). Meta deduplica por
 * (event_name, event_id) numa janela de 7 dias.
 *
 * @param {Object} opts
 * @param {string} opts.workspaceId
 * @param {string} opts.plan          'starter' | 'pro'
 * @param {number} opts.amount        valor pago (na unidade da moeda — R$,
 *                                    NÃO centavos)
 * @param {string} opts.currency      ISO 4217 (BRL, USD, etc.)
 * @param {string} opts.eventId       UUID/string determinística para dedup
 * @param {string} opts.provider      'stripe' | 'mercadopago' | etc.
 * @param {Object} opts.db            handle do utils/database (passar
 *                                    explicitamente p/ evitar circular req)
 */
async function sendSubscribeForWorkspace({
  workspaceId, plan, amount, currency, eventId, provider, db,
}) {
  if (!isConfigured()) return { success: false, skipped: true };
  if (!db) {
    logger.warn('[MetaCapi] sendSubscribeForWorkspace called without db handle');
    return { success: false, error: 'db handle required' };
  }

  const row = db.get(
    `SELECT u.email, u.name, u.id AS user_id, u.signup_attribution
     FROM users u
     JOIN workspaces w ON w.owner_id = u.id
     WHERE w.id = ?`,
    [workspaceId]
  );
  if (!row) {
    logger.warn(`[MetaCapi] Subscribe: owner not found for workspace ${workspaceId}`);
    return { success: false, error: 'owner not found' };
  }

  let attribution = null;
  if (row.signup_attribution) {
    try { attribution = JSON.parse(row.signup_attribution); } catch (_) {}
  }

  const parts = String(row.name || '').trim().split(/\s+/);
  const userData = buildUserData({
    email: row.email,
    firstName: parts[0] || undefined,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
    externalId: row.user_id,
    ...userDataFromAttribution(attribution),
  });

  return sendEvent({
    eventName: 'Subscribe',
    eventId,
    eventSourceUrl: attribution?.landing_url || 'https://whatshybrid.com.br/signup.html',
    userData,
    customData: {
      content_name: 'Plano ' + plan,
      content_category: 'subscription',
      currency: currency || 'BRL',
      value: amount,
      predicted_ltv: amount * 12,
      provider,
    },
  });
}

module.exports = {
  sendEvent,
  sendSubscribeForWorkspace,
  buildUserData,
  userDataFromAttribution,
  fbclidToFbc,
  sha256,
  isConfigured,
};
