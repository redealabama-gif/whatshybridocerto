/**
 * MercadoPago Service - v8.3.0
 *
 * Integração com MercadoPago via REST API direta (sem SDK oficial,
 * para reduzir dependências). Suporta:
 * - Criar preference para checkout (PIX, boleto, cartão)
 * - Criar pagamento recorrente via subscription
 * - Consultar status de pagamento
 * - Validar webhook (assinatura HMAC)
 *
 * Documentação: https://www.mercadopago.com.br/developers/pt/reference
 */

const crypto = require('crypto');
const axios = require('axios');
const logger = require('../utils/logger');

const MP_API = 'https://api.mercadopago.com';

const PLAN_PRICES = {
  starter: 97.00,
  pro: 197.00,
  agency: 497.00,
};

class MercadoPagoService {
  constructor() {
    this.accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN || '';
    this.webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET || '';
    this.publicKey = process.env.MERCADOPAGO_PUBLIC_KEY || '';
    this.notificationUrl = process.env.PUBLIC_BASE_URL
      ? `${process.env.PUBLIC_BASE_URL}/api/v1/webhooks/payment/mercadopago-saas`
      : null;
  }

  isConfigured() {
    return !!this.accessToken;
  }

  /**
   * Cria uma preference de pagamento para o cliente.
   * Retorna { id, init_point, sandbox_init_point } - você redireciona para init_point.
   *
   * @param {Object} opts
   * @param {string} opts.workspaceId — ID do workspace que está pagando
   * @param {string} opts.plan — starter | pro | agency
   * @param {string} opts.email — email do pagador
   * @param {string} opts.name — nome do pagador
   * @param {string} [opts.successUrl] — URL para onde voltar após sucesso
   */
  async createPreference({ workspaceId, plan, email, name, successUrl }) {
    if (!this.isConfigured()) {
      throw new Error('MercadoPago não configurado (MERCADOPAGO_ACCESS_TOKEN ausente)');
    }

    const price = PLAN_PRICES[plan];
    if (!price) throw new Error(`Plano inválido: ${plan}`);

    const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

    const payload = {
      items: [{
        id: `whp_${plan}_monthly`,
        title: `WhatsHybrid Pro — Plano ${plan.charAt(0).toUpperCase() + plan.slice(1)}`,
        description: `Assinatura mensal WhatsHybrid Pro - ${plan}`,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: price,
      }],
      payer: { email, name },
      external_reference: `${workspaceId}|${plan}`,
      notification_url: this.notificationUrl,
      back_urls: {
        success: successUrl || `${baseUrl}/dashboard.html?paid=1`,
        failure: `${baseUrl}/dashboard.html?paid=0`,
        pending: `${baseUrl}/dashboard.html?paid=pending`,
      },
      auto_return: 'approved',
      payment_methods: {
        // Permite tudo: pix, cartão, boleto
        excluded_payment_types: [],
        installments: 1, // sem parcelamento na recorrência
      },
      metadata: {
        workspace_id: workspaceId,
        plan,
      },
    };

    try {
      const r = await axios.post(`${MP_API}/checkout/preferences`, payload, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      logger.info(`[MP] Preference created: ${r.data.id} for workspace ${workspaceId} plan ${plan}`);
      return {
        id: r.data.id,
        init_point: r.data.init_point,
        sandbox_init_point: r.data.sandbox_init_point,
      };
    } catch (err) {
      logger.error('[MP] createPreference failed:', err.response?.data || err.message);
      throw new Error('Falha ao criar pagamento no MercadoPago');
    }
  }

  /**
   * Consulta status de um pagamento pelo ID.
   * Retorna o objeto completo do pagamento.
   */
  async getPayment(paymentId) {
    if (!this.isConfigured()) throw new Error('MercadoPago não configurado');

    try {
      const r = await axios.get(`${MP_API}/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        timeout: 10000,
      });
      return r.data;
    } catch (err) {
      logger.error(`[MP] getPayment ${paymentId} failed:`, err.response?.data || err.message);
      throw new Error('Falha ao consultar pagamento');
    }
  }

  /**
   * Valida a assinatura do webhook do MercadoPago.
   * Doc: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
   *
   * O MP envia headers: x-signature e x-request-id.
   * x-signature contém: ts=TIMESTAMP,v1=HASH
   * O hash é HMAC-SHA256 de uma manifest específica.
   */
  validateWebhookSignature({ headers, query }) {
    if (!this.webhookSecret) {
      // Em dev, deixa passar com warning. Em prod, refuse.
      if (process.env.NODE_ENV === 'production') {
        logger.error('[MP] MERCADOPAGO_WEBHOOK_SECRET não configurado em produção');
        return false;
      }
      logger.warn('[MP] Webhook aceito sem validação (dev)');
      return true;
    }

    const xSignature = headers['x-signature'];
    const xRequestId = headers['x-request-id'];

    if (!xSignature || !xRequestId) {
      logger.warn('[MP] Webhook sem headers de assinatura');
      return false;
    }

    // Parse: "ts=1234567890,v1=hashvalue"
    const parts = xSignature.split(',').reduce((acc, p) => {
      const [k, v] = p.split('=');
      if (k && v) acc[k.trim()] = v.trim();
      return acc;
    }, {});

    const ts = parts.ts;
    const expectedHash = parts.v1;
    if (!ts || !expectedHash) return false;

    // Manifest oficial:  id:[id_do_recurso];request-id:[xRequestId];ts:[ts];
    const dataId = query?.['data.id'] || query?.id || '';
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

    const computed = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(manifest)
      .digest('hex');

    try {
      const a = Buffer.from(computed);
      const b = Buffer.from(expectedHash);
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch (_) {
      return false;
    }
  }

  // ════ v8.4.0 — RECORRÊNCIA AUTOMÁTICA (PREAPPROVAL) ════════════════════
  // 
  // O MercadoPago oferece "preapproval" — uma assinatura recorrente onde
  // o cliente autoriza UMA VEZ e o MP cobra automaticamente todo mês.
  //
  // Fluxo:
  //   1. createPreapproval() → cria assinatura, retorna init_point
  //   2. Cliente vai no init_point, autoriza com cartão
  //   3. MP debita automaticamente todo mês na data agendada
  //   4. Webhook 'subscription_authorized_payment' avisa cada cobrança
  //
  // Esse é o modelo IDEAL para o SaaS. Substituir o create-checkout no fluxo
  // padrão por createPreapproval quando o cliente quer autorenovação.
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Cria uma assinatura recorrente (preapproval) no MP.
   * Cliente autoriza uma vez no init_point, e MP cobra automaticamente todo mês.
   *
   * @param {Object} opts
   * @param {string} opts.workspaceId
   * @param {string} opts.plan
   * @param {string} opts.email
   * @param {string} opts.name
   * @returns {Object} { id, init_point, status }
   */
  async createPreapproval({ workspaceId, plan, email }) {
    if (!this.isConfigured()) {
      throw new Error('MercadoPago não configurado (MERCADOPAGO_ACCESS_TOKEN ausente)');
    }

    const price = PLAN_PRICES[plan];
    if (!price) throw new Error(`Plano inválido: ${plan}`);

    const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

    const payload = {
      reason: `WhatsHybrid Pro — Plano ${plan.charAt(0).toUpperCase() + plan.slice(1)}`,
      external_reference: `subscription|${workspaceId}|${plan}`,
      payer_email: email,
      back_url: `${baseUrl}/dashboard.html?subscription=ok`,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: price,
        currency_id: 'BRL',
      },
      // status pendente até cliente autorizar
      status: 'pending',
      notification_url: this.notificationUrl,
    };

    try {
      const r = await axios.post(`${MP_API}/preapproval`, payload, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      logger.info(`[MP] Preapproval created: ${r.data.id} for workspace ${workspaceId} plan ${plan}`);
      return {
        id: r.data.id,
        init_point: r.data.init_point,
        status: r.data.status,
      };
    } catch (err) {
      logger.error('[MP] createPreapproval failed:', err.response?.data || err.message);
      throw new Error('Falha ao criar assinatura recorrente no MercadoPago');
    }
  }

  /**
   * Consulta status de uma preapproval (ativa, paused, cancelled, etc)
   */
  async getPreapproval(preapprovalId) {
    if (!this.isConfigured()) throw new Error('MercadoPago não configurado');
    try {
      const r = await axios.get(`${MP_API}/preapproval/${preapprovalId}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        timeout: 10000,
      });
      return r.data;
    } catch (err) {
      logger.error(`[MP] getPreapproval ${preapprovalId} failed:`, err.response?.data || err.message);
      throw new Error('Falha ao consultar assinatura');
    }
  }

  /**
   * Cancela uma preapproval (cliente quer parar de pagar mensalmente).
   * Status passa para 'cancelled'. MP NÃO emite reembolso de cobranças
   * já feitas — apenas para de cobrar futuras.
   */
  async cancelPreapproval(preapprovalId) {
    if (!this.isConfigured()) throw new Error('MercadoPago não configurado');
    try {
      const r = await axios.put(`${MP_API}/preapproval/${preapprovalId}`, {
        status: 'cancelled',
      }, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });
      logger.info(`[MP] Preapproval cancelled: ${preapprovalId}`);
      return r.data;
    } catch (err) {
      logger.error(`[MP] cancelPreapproval ${preapprovalId} failed:`, err.response?.data || err.message);
      throw new Error('Falha ao cancelar assinatura no MP');
    }
  }

  /**
   * Pausa uma preapproval. Útil em dunning antes de cancelar.
   */
  async pausePreapproval(preapprovalId) {
    if (!this.isConfigured()) throw new Error('MercadoPago não configurado');
    try {
      const r = await axios.put(`${MP_API}/preapproval/${preapprovalId}`, {
        status: 'paused',
      }, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });
      return r.data;
    } catch (err) {
      logger.error(`[MP] pausePreapproval failed:`, err.response?.data || err.message);
      throw new Error('Falha ao pausar assinatura');
    }
  }

  /**
   * Consulta uma cobrança individual de uma preapproval (cada mês gera uma).
   */
  async getAuthorizedPayment(authorizedPaymentId) {
    if (!this.isConfigured()) throw new Error('MercadoPago não configurado');
    try {
      const r = await axios.get(`${MP_API}/authorized_payments/${authorizedPaymentId}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        timeout: 10000,
      });
      return r.data;
    } catch (err) {
      logger.error(`[MP] getAuthorizedPayment failed:`, err.response?.data || err.message);
      throw new Error('Falha ao consultar cobrança');
    }
  }
}

// Singleton
const instance = new MercadoPagoService();
module.exports = instance;
module.exports.MercadoPagoService = MercadoPagoService;
module.exports.PLAN_PRICES = PLAN_PRICES;
