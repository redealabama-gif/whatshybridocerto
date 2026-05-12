/**
 * 💳 Payment Webhooks - Processamento Automático de Pagamentos
 * 
 * Suporta:
 * - Stripe
 * - PagSeguro
 * - Mercado Pago
 * - PIX (via qualquer gateway)
 * 
 * FLUXO 100% AUTOMATIZADO:
 * 1. Gateway envia webhook
 * 2. Backend valida e processa
 * 3. Assinatura ativada automaticamente
 * 4. Email enviado com código
 * 5. Créditos adicionados
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../utils/database');
// v9.5.0 BUG #140: ../middleware/asyncHandler não existe — asyncHandler vive
// em ../middleware/errorHandler. Importava module-not-found e caía no catch
// global de server.js silenciosamente. Em v9.4.7 esta rota foi refatorada
// (Bug #126) e o import quebrado escapou da auditoria.
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
// v9.3.8: authLimiter pra prevenir brute-force em /validate
const { authLimiter } = require('../middleware/rateLimiter');
// v9.5.0 BUG #143: rota POST /sync (linha ~601) usa `authenticate` mas nunca
// importava — server crashava no boot ao carregar este arquivo.
const { authenticate } = require('../middleware/auth');

// ============================================
// CONFIGURAÇÃO DE PLANOS
// ============================================

const PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 49.90,
    credits: 100,
    durationDays: 30
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 99.90,
    credits: 500,
    durationDays: 30
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 249.90,
    credits: 2000,
    durationDays: 30
  }
};

const CREDIT_PACKAGES = {
  credits_50: { credits: 50, price: 19.90 },
  credits_100: { credits: 100, price: 34.90 },
  credits_250: { credits: 250, price: 79.90 },
  credits_500: { credits: 500, price: 149.90 }
};

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

/**
 * Gera código único de assinatura
 */
function generateSubscriptionCode(planId) {
  const prefix = 'WHL';
  const planCode = planId.toUpperCase().slice(0, 3);
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
  
  return `${prefix}-${planCode}-${random}${timestamp}`;
}

/**
 * Calcula data de expiração
 */
function calculateExpiration(durationDays) {
  const date = new Date();
  date.setDate(date.getDate() + durationDays);
  return date.toISOString();
}

/**
 * Middleware genérico de proteção para webhooks de pagamento que ainda não têm
 * validação oficial implementada (PagSeguro/PIX/Gateway genérico).
 *
 * - Em produção: exige um segredo compartilhado via header.
 * - Em dev: permite sem secret configurado, mas loga aviso.
 */
function requirePaymentWebhookSecret(req, res, next) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  const provided = req.headers['x-payment-webhook-secret'] || req.headers['x-webhook-secret'];

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('[Payments] PAYMENT_WEBHOOK_SECRET não configurado em produção');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }
    logger.warn('[Payments] PAYMENT_WEBHOOK_SECRET não configurado (dev). Webhook aceito sem validação.');
    return next();
  }

  if (!provided) {
    return res.status(401).json({ error: 'Missing webhook secret' });
  }

  try {
    const a = Buffer.from(String(provided));
    const b = Buffer.from(String(secret));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }
}

/**
 * Envia email com código (placeholder - integrar com seu serviço)
 */
async function sendSubscriptionEmail(email, code, planId, expiresAt) {
  // TODO: Integrar com SendGrid, SES, Mailgun, etc.
  logger.info(`[Email] Enviando código ${code} para ${email}`);
  
  // Exemplo de integração com SendGrid:
  /*
  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  
  await sgMail.send({
    to: email,
    from: 'noreply@whatshybrid.com',
    subject: '🎉 Seu WhatsHybrid foi ativado!',
    html: `
      <h1>Bem-vindo ao WhatsHybrid ${PLANS[planId].name}!</h1>
      <p>Seu código de ativação:</p>
      <h2 style="background:#8b5cf6;color:white;padding:20px;text-align:center;border-radius:10px;">
        ${code}
      </h2>
      <p>Cole este código no campo "Assinatura" do WhatsHybrid.</p>
      <p>Válido até: ${new Date(expiresAt).toLocaleDateString('pt-BR')}</p>
    `
  });
  */
  
  return true;
}

/**
 * Processa ativação de assinatura
 */
async function activateSubscription(email, planId, paymentId, gateway) {
  const plan = PLANS[planId];
  if (!plan) {
    throw new Error(`Plano inválido: ${planId}`);
  }

  const code = generateSubscriptionCode(planId);
  const expiresAt = calculateExpiration(plan.durationDays);
  const now = new Date().toISOString();

  // Verificar se já existe assinatura para este email
  const existing = await db.get('SELECT * FROM subscriptions WHERE email = ? AND status = "active"', [email]);
  
  if (existing) {
    // Upgrade ou renovação - estender período
    const newExpiration = new Date(existing.expires_at);
    newExpiration.setDate(newExpiration.getDate() + plan.durationDays);
    
    await db.run(`
      UPDATE subscriptions SET
        plan_id = ?,
        credits_total = credits_total + ?,
        expires_at = ?,
        updated_at = ?
      WHERE email = ?
    `, [planId, plan.credits, newExpiration.toISOString(), now, email]);

    logger.info(`[Subscription] Renovação/Upgrade: ${email} -> ${planId}`);
    
    // Enviar email de renovação
    await sendSubscriptionEmail(email, existing.code, planId, newExpiration.toISOString());
    
    return { code: existing.code, isRenewal: true };
  }

  // Nova assinatura
  await db.run(`
    INSERT INTO subscriptions (
      code, email, plan_id, status,
      credits_total, credits_used,
      payment_id, payment_gateway,
      activated_at, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, 0, ?, ?, ?, ?, ?, ?)
  `, [code, email, planId, plan.credits, paymentId, gateway, now, expiresAt, now, now]);

  logger.info(`[Subscription] Nova assinatura: ${email} -> ${planId} (${code})`);

  // Enviar email
  await sendSubscriptionEmail(email, code, planId, expiresAt);

  return { code, isRenewal: false };
}

/**
 * Adiciona créditos extras
 */
async function addCredits(subscriptionCode, credits, paymentId) {
  const subscription = await db.get('SELECT * FROM subscriptions WHERE code = ?', [subscriptionCode]);
  
  if (!subscription) {
    throw new Error('Assinatura não encontrada');
  }

  await db.run(`
    UPDATE subscriptions SET
      credits_total = credits_total + ?,
      updated_at = datetime('now')
    WHERE code = ?
  `, [credits, subscriptionCode]);

  // Registrar transação
  await db.run(`
    INSERT INTO credit_transactions (
      subscription_code, amount, type, payment_id, created_at
    ) VALUES (?, ?, 'purchase', ?, datetime('now'))
  `, [subscriptionCode, credits, paymentId]);

  logger.info(`[Credits] +${credits} créditos para ${subscriptionCode}`);

  return true;
}

// ============================================
// WEBHOOK STRIPE
// ============================================

router.post('/stripe', express.raw({ type: 'application/json', limit: '256kb' }), asyncHandler(async (req, res) => {
  // v9.4.6 BUG #126: rota redundante. O endpoint canônico é /api/v1/webhooks/payment/stripe
  // (montado em server.js linha 442 via routes/webhooks-stripe.js, que usa StripeService
  // com fetch direto sem dependência npm 'stripe'). Esta rota aqui (em webhooks-payment.js)
  // estava montada em /api/v1/subscription/stripe e /webhooks/stripe e tentava
  // `require('stripe')` que NÃO está em package.json → quebraria webhooks reais com
  // 400 "Cannot find module 'stripe'".
  // Solução: redireciona pra StripeService canônico.
  const stripeService = require('../services/StripeService');
  const sig = req.headers['stripe-signature'];

  if (!stripeService.validateWebhookSignature({ headers: req.headers, rawBody: req.body })) {
    logger.warn('[Stripe Webhook legacy] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(req.body.toString());
  } catch (err) {
    logger.error('[Stripe Webhook legacy] Invalid JSON:', err.message);
    return res.status(400).send('Webhook Error: invalid payload');
  }

  // Processar eventos
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const email = session.customer_email || session.customer_details?.email;
        const planId = session.metadata?.plan_id || 'starter';
        
        await activateSubscription(email, planId, session.id, 'stripe');
        break;
      }

      case 'invoice.paid': {
        // Renovação automática
        const invoice = event.data.object;
        const email = invoice.customer_email;
        const planId = invoice.lines?.data?.[0]?.metadata?.plan_id || 'starter';
        
        await activateSubscription(email, planId, invoice.id, 'stripe');
        break;
      }

      case 'customer.subscription.deleted': {
        // Cancelamento
        const subscription = event.data.object;
        await db.run(`
          UPDATE subscriptions SET status = 'cancelled', updated_at = datetime('now')
          WHERE payment_id LIKE ?
        `, [`%${subscription.id}%`]);
        break;
      }

      default:
        logger.info(`[Stripe] Evento não processado: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('[Stripe Webhook] Erro no processamento:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
}));

// ============================================
// WEBHOOK PAGSEGURO
// ============================================

router.post('/pagseguro', requirePaymentWebhookSecret, asyncHandler(async (req, res) => {
  const { notificationCode, notificationType } = req.body;

  if (notificationType !== 'transaction') {
    return res.status(200).send('OK');
  }

  try {
    // Consultar detalhes da transação no PagSeguro
    // const pagseguro = require('pagseguro');
    // const transaction = await pagseguro.getTransaction(notificationCode);

    // Por enquanto, simulação
    const transaction = {
      status: 3, // Pago
      reference: req.body.reference, // ID do pedido (contém plan_id e email)
      grossAmount: req.body.grossAmount
    };

    if (transaction.status === 3) { // Status 3 = Pago
      const [planId, email] = transaction.reference.split('|');
      await activateSubscription(email, planId, notificationCode, 'pagseguro');
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('[PagSeguro Webhook] Erro:', error);
    res.status(500).send('Erro');
  }
}));

// ============================================
// WEBHOOK MERCADO PAGO
// ============================================

/**
 * Middleware de validação de assinatura MercadoPago
 */
function validateMercadoPagoSignature(req, res, next) {
  const signature = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    // Em desenvolvimento, permitir sem validação mas logar aviso
    logger.warn('[MercadoPago] Webhook recebido sem MERCADOPAGO_WEBHOOK_SECRET configurado');
    return next();
  }
  
  if (!signature) {
    logger.warn('[MercadoPago] Webhook sem header x-signature');
    return res.status(401).json({ error: 'Missing signature' });
  }
  
  try {
    // Validar assinatura HMAC
    const payload = requestId + JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');
    
    // Comparar de forma segura contra timing attacks
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      logger.error('[MercadoPago] Assinatura inválida');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    next();
  } catch (error) {
    logger.error('[MercadoPago] Erro na validação de assinatura:', error);
    return res.status(401).json({ error: 'Signature validation failed' });
  }
}

router.post('/mercadopago', validateMercadoPagoSignature, asyncHandler(async (req, res) => {
  const { type, data } = req.body;

  if (type !== 'payment') {
    return res.json({ received: true });
  }

  try {
    // Consultar pagamento no Mercado Pago
    // const mercadopago = require('mercadopago');
    // const payment = await mercadopago.payment.findById(data.id);

    // Por enquanto, simulação
    const payment = {
      status: 'approved',
      external_reference: req.body.external_reference, // plan_id|email
      transaction_amount: req.body.transaction_amount
    };

    if (payment.status === 'approved') {
      const [planId, email] = payment.external_reference.split('|');
      await activateSubscription(email, planId, data.id, 'mercadopago');
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('[MercadoPago Webhook] Erro:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
}));

// ============================================
// WEBHOOK PIX GENÉRICO
// ============================================

router.post('/pix', requirePaymentWebhookSecret, asyncHandler(async (req, res) => {
  const { txid, status, valor, infoPagador } = req.body;

  try {
    if (status === 'CONCLUIDA' || status === 'paid') {
      // Extrair info do pagamento
      // O txid deve conter: PLAN_EMAIL (ex: PRO_usuario@email.com)
      const [planId, email] = (infoPagador?.identificacao || txid).split('_');
      
      if (planId && email) {
        await activateSubscription(email.toLowerCase(), planId.toLowerCase(), txid, 'pix');
      }
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('[PIX Webhook] Erro:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
}));

// ============================================
// WEBHOOK GENÉRICO (para outros gateways)
// ============================================

router.post('/generic', requirePaymentWebhookSecret, asyncHandler(async (req, res) => {
  const { 
    event_type,
    payment_status,
    customer_email,
    plan_id,
    payment_id,
    gateway_name,
    credits_package
  } = req.body;

  try {
    // Pagamento de plano
    if (event_type === 'payment.success' && payment_status === 'paid') {
      if (credits_package && CREDIT_PACKAGES[credits_package]) {
        // Compra de créditos extras
        const { code } = req.body;
        await addCredits(code, CREDIT_PACKAGES[credits_package].credits, payment_id);
      } else if (plan_id && customer_email) {
        // Nova assinatura ou renovação
        await activateSubscription(customer_email, plan_id, payment_id, gateway_name || 'generic');
      }
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('[Generic Webhook] Erro:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
}));

// ============================================
// VALIDAÇÃO DE CÓDIGO (usado pela extensão)
// ============================================

router.post('/validate', authLimiter, asyncHandler(async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ success: false, error: 'Código obrigatório' });
  }

  const subscription = await db.get(`
    SELECT * FROM subscriptions WHERE code = ?
  `, [code.toUpperCase()]);

  if (!subscription) {
    return res.status(404).json({ success: false, error: 'Código inválido' });
  }

  // Verificar expiração
  if (subscription.expires_at && new Date(subscription.expires_at) < new Date()) {
    await db.run('UPDATE subscriptions SET status = "expired" WHERE code = ?', [code]);
    return res.status(403).json({ success: false, error: 'Assinatura expirada' });
  }

  // Verificar status
  if (subscription.status !== 'active' && subscription.status !== 'trial') {
    return res.status(403).json({ success: false, error: 'Assinatura inativa' });
  }

  res.json({
    success: true,
    planId: subscription.plan_id,
    credits: subscription.credits_total - subscription.credits_used,
    expiresAt: subscription.expires_at,
    status: subscription.status
  });
}));

// ============================================
// RENOVAÇÃO AUTOMÁTICA DE CRÉDITOS (CRON JOB)
// ============================================

async function renewMonthlyCredits() {
  const now = new Date();
  const firstOfMonth = now.getDate() === 1;

  if (!firstOfMonth) return;

  logger.info('[Cron] Iniciando renovação mensal de créditos...');

  const subscriptions = await db.all(`
    SELECT * FROM subscriptions WHERE status = 'active'
  `);

  for (const sub of subscriptions) {
    const plan = PLANS[sub.plan_id];
    if (!plan) continue;

    await db.run(`
      UPDATE subscriptions SET
        credits_total = ?,
        credits_used = 0,
        updated_at = datetime('now')
      WHERE code = ?
    `, [plan.credits, sub.code]);

    logger.info(`[Cron] Créditos renovados: ${sub.code} -> ${plan.credits}`);
  }
}

// ============================================
// EXPIRAÇÃO AUTOMÁTICA (CRON JOB)
// ============================================

async function checkExpirations() {
  const expired = await db.all(`
    SELECT * FROM subscriptions 
    WHERE status = 'active' 
    AND expires_at < datetime('now')
  `);

  for (const sub of expired) {
    await db.run(`
      UPDATE subscriptions SET status = 'expired', updated_at = datetime('now')
      WHERE code = ?
    `, [sub.code]);

    logger.info(`[Cron] Assinatura expirada: ${sub.code}`);

    // TODO: Enviar email de expiração
  }
}

// ============================================
// GESTÃO DE INTERVALOS (para graceful shutdown)
// ============================================

// Armazenar referências dos intervalos para cleanup
const intervals = {
  renewCredits: setInterval(renewMonthlyCredits, 24 * 60 * 60 * 1000),
  checkExpirations: setInterval(checkExpirations, 60 * 60 * 1000)
};

// FIX: .unref() para não bloquear shutdown / não poluir jest
if (intervals.renewCredits.unref) intervals.renewCredits.unref();
if (intervals.checkExpirations.unref) intervals.checkExpirations.unref();


/**
 * POST /api/v1/subscription/sync
 * Compat: alguns clients tentam sincronizar estado/uso local.
 * Retorna status e créditos restantes. Atualiza credits_used de forma segura (monótona) quando possível.
 */
router.post('/sync', authenticate, async (req, res) => {
  try {
    const { code, usage, credits } = req.body || {};

    if (!code) {
      return res.status(400).json({ success: false, error: 'Código de assinatura é obrigatório' });
    }

    const subscription = db.get(`
      SELECT * FROM subscriptions WHERE code = ?
    `, [code]);

    if (!subscription) {
      return res.status(404).json({ success: false, error: 'Assinatura não encontrada' });
    }

    const now = new Date();

    // Verificar se está ativa (mesma lógica do /validate)
    if (subscription.status !== 'active') {
      return res.status(403).json({ success: false, error: 'Assinatura inativa', status: subscription.status });
    }

    if (subscription.expires_at && new Date(subscription.expires_at) < now) {
      return res.status(403).json({ success: false, error: 'Assinatura expirada' });
    }

    const total = subscription.credits_total || 0;
    const usedServer = subscription.credits_used || 0;

    // Atualização segura: só aumenta (nunca diminui) e nunca excede total.
    const usedClient = (credits && typeof credits.used === 'number') ? credits.used
      : (usage && typeof usage.creditsUsed === 'number') ? usage.creditsUsed
      : null;

    let used = usedServer;

    if (typeof usedClient === 'number' && !Number.isNaN(usedClient)) {
      used = Math.max(usedServer, Math.min(total, usedClient));
      if (used !== usedServer) {
        db.run(`
          UPDATE subscriptions
          SET credits_used = ?, updated_at = CURRENT_TIMESTAMP
          WHERE code = ?
        `, [used, code]);
      }
    }

    const remaining = Math.max(0, total - used);

    res.json({
      success: true,
      status: subscription.status,
      plan_id: subscription.plan_id,
      expires_at: subscription.expires_at,
      credits: remaining
    });
  } catch (error) {
    logger.error('[Webhooks-Payment] Erro no sync:', error);
    res.status(500).json({ success: false, error: 'Erro interno', message: error.message });
  }
});


/**
 * Função de cleanup para graceful shutdown
 * Limpa todos os intervalos registrados
 */
function cleanup() {
  logger.info('[Webhooks-Payment] Limpando intervalos...');
  Object.entries(intervals).forEach(([name, interval]) => {
    clearInterval(interval);
    logger.info(`[Webhooks-Payment] Intervalo '${name}' limpo`);
  });
}

module.exports = router;
module.exports.cleanup = cleanup;