/**
 * Stripe Service — v9.0.0
 *
 * Para clientes internacionais. API espelha MercadoPagoService.
 *
 * Setup:
 *   1. Cria conta em https://dashboard.stripe.com
 *   2. Pega secret key (sk_live_... ou sk_test_...)
 *   3. STRIPE_SECRET_KEY=sk_test_xxx
 *   4. Configura webhook em /api/v1/webhooks/payment/stripe
 *   5. Pega webhook signing secret e define STRIPE_WEBHOOK_SECRET
 *
 * Sem deps adicionais: usa fetch nativo (Node 20+) contra REST API.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

const STRIPE_API = 'https://api.stripe.com/v1';

class StripeService {
  constructor() {
    this.secretKey = process.env.STRIPE_SECRET_KEY || '';
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    this.publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';
    this.dryRun = !this.secretKey;

    if (this.dryRun) {
      logger.warn('[Stripe] STRIPE_SECRET_KEY ausente — modo dry-run');
    } else {
      logger.info('[Stripe] Initialized');
    }
  }

  isConfigured() { return !!this.secretKey; }

  async _request(method, path, body) {
    if (this.dryRun) {
      return { id: 'dry_' + Date.now(), object: 'dry-run' };
    }

    // Stripe usa application/x-www-form-urlencoded
    const params = body ? this._serialize(body) : null;

    const r = await fetch(STRIPE_API + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2024-12-18.acacia',
      },
      body: params,
    });

    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Stripe ${r.status}: ${text.substring(0, 500)}`);
    }
    return r.json();
  }

  _serialize(obj, prefix = '') {
    const parts = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue;
      const key = prefix ? `${prefix}[${k}]` : k;
      if (typeof v === 'object' && !Array.isArray(v)) {
        parts.push(this._serialize(v, key));
      } else if (Array.isArray(v)) {
        v.forEach((item, i) => {
          if (typeof item === 'object') {
            parts.push(this._serialize(item, `${key}[${i}]`));
          } else {
            parts.push(`${key}[${i}]=${encodeURIComponent(item)}`);
          }
        });
      } else {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
      }
    }
    return parts.join('&');
  }

  /**
   * Cria checkout session pra assinatura
   */
  async createCheckoutSession({ priceId, customerEmail, successUrl, cancelUrl, metadata = {} }) {
    return this._request('POST', '/checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: customerEmail,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
      allow_promotion_codes: true,
    });
  }

  /**
   * Cria checkout one-time (compra de tokens avulsa)
   */
  async createOneTimeCheckout({ priceId, customerEmail, successUrl, cancelUrl, metadata = {} }) {
    return this._request('POST', '/checkout/sessions', {
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: customerEmail,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
    });
  }

  /**
   * Cancela uma assinatura
   */
  async cancelSubscription(subscriptionId, atPeriodEnd = true) {
    if (atPeriodEnd) {
      return this._request('POST', `/subscriptions/${subscriptionId}`, {
        cancel_at_period_end: 'true',
      });
    }
    return this._request('DELETE', `/subscriptions/${subscriptionId}`);
  }

  /**
   * Recupera detalhes de uma payment_intent / subscription
   */
  async getSubscription(id) {
    return this._request('GET', `/subscriptions/${id}`);
  }

  async getPaymentIntent(id) {
    return this._request('GET', `/payment_intents/${id}`);
  }

  /**
   * Valida assinatura do webhook (HMAC SHA256)
   * Stripe envia em header `stripe-signature`
   */
  validateWebhookSignature({ headers, rawBody }) {
    if (!this.webhookSecret) {
      logger.warn('[Stripe] STRIPE_WEBHOOK_SECRET não configurado');
      return false;
    }

    const signatureHeader = headers['stripe-signature'];
    if (!signatureHeader) return false;

    // Formato: "t=timestamp,v1=signature"
    const parts = signatureHeader.split(',').reduce((acc, p) => {
      const [k, v] = p.split('=');
      acc[k] = v;
      return acc;
    }, {});

    if (!parts.t || !parts.v1) return false;

    // Timestamp deve estar dentro de 5min (replay protection)
    const ts = parseInt(parts.t, 10);
    if (Math.abs(Date.now() / 1000 - ts) > 300) {
      logger.warn('[Stripe] Webhook timestamp fora da janela');
      return false;
    }

    const signedPayload = `${parts.t}.${typeof rawBody === 'string' ? rawBody : rawBody.toString()}`;
    const expectedSig = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(signedPayload)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(parts.v1, 'utf8'),
        Buffer.from(expectedSig, 'utf8')
      );
    } catch (_) {
      return false;
    }
  }
}

module.exports = new StripeService();
