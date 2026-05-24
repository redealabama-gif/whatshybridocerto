/**
 * Billing Routes - v8.3.0
 *
 * Endpoints chamados pelo frontend para iniciar pagamento:
 * - POST /create-checkout — cria preference no MP, retorna URL pra redirecionar
 * - GET  /invoices        — histórico de pagamentos
 * - GET  /providers       — quais gateways estão configurados
 */

const express = require('express');
const router = express.Router();

const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

const mpService = require('../services/MercadoPagoService');
const stripeService = require('../services/StripeService');

router.use(authenticate);

/**
 * GET /api/v1/billing/providers
 * Informa quais provedores estão configurados (para o frontend mostrar opções)
 */
router.get('/providers', (req, res) => {
  res.json({
    providers: {
      mercadopago: { available: mpService.isConfigured(), name: 'MercadoPago', currency: 'BRL', region: 'BR' },
      stripe: { available: stripeService.isConfigured(), name: 'Stripe', currency: 'USD', region: 'INTL' },
    },
  });
});

/**
 * POST /api/v1/billing/create-checkout
 * Cria uma preference de pagamento no MP e retorna URL pra redirecionar.
 * Body: { plan?: 'starter'|'pro'|'agency' }   — default: usa o plano atual do workspace
 */
router.post('/create-checkout',
  authorize('owner'),
  asyncHandler(async (req, res) => {
    const ws = db.get(
      `SELECT w.id, w.plan, u.email, u.name
       FROM workspaces w
       JOIN users u ON u.id = w.owner_id
       WHERE w.id = ?`,
      [req.workspaceId]
    );
    if (!ws) throw new AppError('Workspace not found', 404);

    const plan = (req.body?.plan || ws.plan || 'pro').toLowerCase();
    if (!['starter', 'pro', 'agency'].includes(plan)) {
      throw new AppError('Plano inválido', 400);
    }

    if (!mpService.isConfigured()) {
      return res.status(503).json({
        error: 'Pagamento indisponível no momento',
        message: 'O administrador precisa configurar MERCADOPAGO_ACCESS_TOKEN no servidor',
      });
    }

    try {
      // Resgata cupom pendente do workspace (se houver). createPreference
      // já é defensivo — passar undefined é seguro, e cupom expirado/usado
      // é tratado lá dentro.
      let couponCode;
      try {
        const couponService = require('../services/CouponService');
        const pending = couponService.getPendingCouponForWorkspace(ws.id, plan);
        if (pending) couponCode = pending.code;
      } catch (e) {
        logger.warn('[Billing] coupon lookup failed:', e.message);
      }

      const pref = await mpService.createPreference({
        workspaceId: ws.id,
        plan,
        email: ws.email,
        name: ws.name,
        couponCode,
      });

      // Salva intent de pagamento (auditoria). Inclui o cupom no metadata
      // pra rastrear, se aplicado.
      db.run(
        `INSERT INTO billing_intents (id, workspace_id, plan, provider, provider_ref, status, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          require('../utils/uuid-wrapper').v4(),
          ws.id,
          plan,
          'mercadopago',
          pref.id,
          'pending',
          couponCode ? JSON.stringify({ coupon: couponCode }) : null,
        ]
      );

      res.json({
        provider: 'mercadopago',
        preference_id: pref.id,
        checkout_url: process.env.MERCADOPAGO_USE_SANDBOX === 'true'
          ? pref.sandbox_init_point
          : pref.init_point,
        coupon_applied: couponCode || null,
      });
    } catch (err) {
      logger.error('[Billing] create-checkout failed:', err);
      throw new AppError(err.message || 'Erro ao criar checkout', 500);
    }
  })
);

/**
 * GET /api/v1/billing/invoices
 * Lista histórico de pagamentos do workspace
 */
router.get('/invoices', asyncHandler(async (req, res) => {
  let invoices = [];
  try {
    invoices = db.all(
      `SELECT id, plan, provider, status, amount, currency,
              paid_at, created_at, provider_ref
       FROM billing_invoices
       WHERE workspace_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.workspaceId]
    ) || [];
  } catch (_) {
    // Tabela ainda não criada (sem migrations rodadas) — devolve vazio
  }

  res.json({ invoices });
}));

/**
 * POST /api/v1/billing/recover-link — Fase 3 da cobrança real
 *
 * Endpoint chamado pelo dashboard quando o usuário está past_due ou
 * trialing-prestes-a-expirar e quer um link de pagamento agora (perdeu
 * email, link expirado, etc).
 *
 * Body:
 *   { force?: boolean }
 *     - false (default): respeita idempotência de 24h (BillingLinkService)
 *     - true: força nova preference no MP mesmo se já existe pending
 *       recente. Use quando o usuário insiste "gera de novo".
 *
 * Resposta sucesso:
 *   200 { payment_url, intent_id, coupon_applied?, plan, expires_at? }
 *
 * Resposta erro:
 *   - 400 plan_not_billable: workspace em plano free
 *   - 400 already_active: workspace já está active (sem renovação pendente)
 *   - 503 mp_not_configured: MP não configurado no servidor
 *   - 409 recent_intent_exists: link recente existe; cliente deve usar
 *     ou enviar force=true. Inclui intent_id pra cliente buscar histórico.
 */
router.post('/recover-link',
  authorize('owner'),
  asyncHandler(async (req, res) => {
    const ws = db.get(
      `SELECT id, plan, owner_id, subscription_status
       FROM workspaces WHERE id = ?`,
      [req.workspaceId]
    );
    if (!ws) throw new AppError('Workspace not found', 404);

    // Estados elegíveis pra gerar link:
    //   - past_due:        cobrança vencida (trial expirou ou renovação falhou)
    //   - trialing:        ainda tá no trial (pode pagar adiantado)
    //   - canceling:       pediu cancelar mas ainda tá no ciclo pago
    // Estados rejeitados:
    //   - active:          já paga em dia, nada a fazer
    //   - suspended:       suspensão precisa contato com suporte
    const eligible = ['past_due', 'trialing', 'canceling'];
    if (!eligible.includes(ws.subscription_status)) {
      throw new AppError(
        `Workspace está com status ${ws.subscription_status}; não há cobrança pendente`,
        400,
        'NOT_ELIGIBLE'
      );
    }

    const force = !!req.body?.force;
    const billingLinkService = require('../services/BillingLinkService');
    const result = await billingLinkService.generatePaymentLink(ws, null, {
      source: 'manual_recover',
      force,
    });

    if (!result.ok) {
      const reason = result.reason || 'unknown';
      const map = {
        mp_not_configured: { code: 503, msg: 'Pagamento indisponível no momento' },
        plan_not_billable: { code: 400, msg: 'Plano não-cobrável (free)' },
        no_owner_email:    { code: 500, msg: 'Workspace sem email do owner' },
        recent_intent_exists: {
          code: 409,
          msg: 'Já existe um link de pagamento ativo. Envie force=true pra gerar um novo.',
        },
      };
      const m = map[reason] || { code: 500, msg: 'Falha ao gerar link de pagamento' };
      return res.status(m.code).json({
        error: m.msg,
        reason,
        intent_id: result.intent_id || null,
      });
    }

    logger.info(`[Billing] recover-link ws=${ws.id} force=${force} ok`);
    res.json({
      payment_url: result.payment_url,
      intent_id: result.intent_id,
      provider_ref: result.provider_ref,
      coupon_applied: result.coupon_label ? result.coupon_label : null,
      plan: ws.plan,
    });
  })
);

/**
 * POST /api/v1/billing/create-token-checkout — v8.4.0
 * Cria preference no MP para comprar pacote AVULSO de tokens.
 * Body: { package_id: 'pack_10k' | 'pack_50k' | 'pack_200k' | 'pack_1M' }
 */
router.post('/create-token-checkout',
  authorize('owner'),
  asyncHandler(async (req, res) => {
    const { TOKEN_PACKAGES } = require('../services/TokenService');
    const { package_id } = req.body || {};

    const pkg = TOKEN_PACKAGES[package_id];
    if (!pkg) {
      throw new AppError(`Pacote inválido. Use: ${Object.keys(TOKEN_PACKAGES).join(', ')}`, 400);
    }

    if (!mpService.isConfigured()) {
      return res.status(503).json({
        error: 'Pagamento indisponível no momento',
        message: 'Administrador precisa configurar MERCADOPAGO_ACCESS_TOKEN',
      });
    }

    const ws = db.get(
      `SELECT u.email, u.name FROM workspaces w
       JOIN users u ON u.id = w.owner_id
       WHERE w.id = ?`,
      [req.workspaceId]
    );

    try {
      // Reaproveita createPreference, mas com label customizado
      // Nota: createPreference assume "plan", aqui passamos package_id
      const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
      const axios = require('axios');

      const payload = {
        items: [{
          id: package_id,
          title: `WhatsHybrid Pro — ${pkg.label}`,
          description: `Pacote avulso de ${pkg.tokens.toLocaleString('pt-BR')} tokens de IA`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: pkg.price_brl_cents / 100,
        }],
        payer: { email: ws.email, name: ws.name },
        // formato: tokenpkg|workspaceId|package_id  (distinto de assinatura "workspaceId|plan")
        external_reference: `tokenpkg|${req.workspaceId}|${package_id}`,
        notification_url: process.env.PUBLIC_BASE_URL
          ? `${process.env.PUBLIC_BASE_URL}/api/v1/webhooks/payment/mercadopago-saas`
          : undefined,
        back_urls: {
          success: `${baseUrl}/dashboard.html?tokens=ok`,
          failure: `${baseUrl}/dashboard.html?tokens=fail`,
          pending: `${baseUrl}/dashboard.html?tokens=pending`,
        },
        auto_return: 'approved',
        metadata: {
          workspace_id: req.workspaceId,
          package_id,
          tokens: pkg.tokens,
        },
      };

      const r = await axios.post('https://api.mercadopago.com/checkout/preferences', payload, {
        headers: {
          Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      // Auditoria
      db.run(
        `INSERT INTO billing_intents (id, workspace_id, plan, provider, provider_ref, status, amount, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          require('../utils/uuid-wrapper').v4(),
          req.workspaceId,
          `tokenpkg:${package_id}`,
          'mercadopago',
          r.data.id,
          'pending',
          pkg.price_brl_cents / 100,
          JSON.stringify({ package_id, tokens: pkg.tokens }),
        ]
      );

      logger.info(`[Billing] Token checkout: workspace=${req.workspaceId} package=${package_id}`);

      res.json({
        provider: 'mercadopago',
        preference_id: r.data.id,
        package: { id: package_id, ...pkg },
        checkout_url: process.env.MERCADOPAGO_USE_SANDBOX === 'true'
          ? r.data.sandbox_init_point
          : r.data.init_point,
      });
    } catch (err) {
      logger.error('[Billing] create-token-checkout failed:', err.response?.data || err.message);
      throw new AppError('Erro ao criar checkout do pacote', 500);
    }
  })
);

/**
 * POST /api/v1/billing/subscribe-recurring — v8.4.0
 * Cria uma preapproval no MP (assinatura recorrente automática).
 * Cliente autoriza UMA VEZ no init_point retornado, e MP cobra todo mês.
 *
 * Body: { plan?: 'starter'|'pro'|'agency' } — default: usa plano atual
 */
router.post('/subscribe-recurring',
  authorize('owner'),
  asyncHandler(async (req, res) => {
    const ws = db.get(
      `SELECT w.id, w.plan, w.mp_preapproval_id, u.email, u.name
       FROM workspaces w JOIN users u ON u.id = w.owner_id
       WHERE w.id = ?`,
      [req.workspaceId]
    );
    if (!ws) throw new AppError('Workspace not found', 404);

    const plan = (req.body?.plan || ws.plan || 'pro').toLowerCase();
    if (!['starter', 'pro', 'agency'].includes(plan)) {
      throw new AppError('Plano inválido', 400);
    }

    if (!mpService.isConfigured()) {
      return res.status(503).json({
        error: 'Pagamento indisponível',
        message: 'Administrador precisa configurar MERCADOPAGO_ACCESS_TOKEN',
      });
    }

    // Já tem preapproval ativa?
    if (ws.mp_preapproval_id) {
      try {
        const existing = await mpService.getPreapproval(ws.mp_preapproval_id);
        if (existing.status === 'authorized') {
          return res.status(400).json({
            error: 'Você já tem uma assinatura recorrente ativa',
            preapproval: { id: existing.id, status: existing.status },
            hint: 'Para mudar de plano, cancele a atual e crie nova.',
          });
        }
      } catch (_) {
        // se a consulta falhar, segue criando nova
      }
    }

    try {
      // Fase 3: passa cupom pendente (só será aplicado se for permanente —
      // EXIT50 é first_invoice_only, será ignorado aqui mas continua
      // pendente pra uma cobrança one-shot via createPreference).
      let couponCode;
      try {
        const couponService = require('../services/CouponService');
        const pending = couponService.getPendingCouponForWorkspace(ws.id, plan);
        if (pending) couponCode = pending.code;
      } catch (_) {}

      const pre = await mpService.createPreapproval({
        workspaceId: ws.id,
        plan,
        email: ws.email,
        name: ws.name,
        couponCode,
      });

      // Salva o preapproval_id para referência futura
      db.run(
        `UPDATE workspaces SET mp_preapproval_id = ?, payment_provider = 'mercadopago' WHERE id = ?`,
        [pre.id, ws.id]
      );

      logger.info(
        `[Billing] Preapproval created: ${pre.id} for ws=${ws.id} plan=${plan}` +
        (pre.coupon_applied ? ` coupon=${pre.coupon_applied.code}` : '')
      );

      res.json({
        provider: 'mercadopago',
        preapproval_id: pre.id,
        status: pre.status,
        authorize_url: pre.init_point,
        coupon_applied: pre.coupon_applied,
        message: pre.coupon_applied
          ? `Acesse o link para autorizar a assinatura recorrente com ${pre.coupon_applied.label} aplicado em todas as cobranças.`
          : 'Acesse o link para autorizar a assinatura recorrente. Após autorizar, o MP cobrará automaticamente todo mês.',
      });
    } catch (err) {
      logger.error('[Billing] subscribe-recurring failed:', err.message);
      throw new AppError(err.message || 'Erro ao criar assinatura recorrente', 500);
    }
  })
);

/**
 * POST /api/v1/billing/cancel-recurring — v8.4.0
 * Cancela a assinatura recorrente (preapproval) no MP.
 * Acesso é mantido até o fim do período já pago.
 */
router.post('/cancel-recurring',
  authorize('owner'),
  asyncHandler(async (req, res) => {
    const ws = db.get(
      `SELECT mp_preapproval_id FROM workspaces WHERE id = ?`,
      [req.workspaceId]
    );
    if (!ws) throw new AppError('Workspace not found', 404);

    if (!ws.mp_preapproval_id) {
      throw new AppError('Você não tem assinatura recorrente ativa', 400);
    }

    try {
      await mpService.cancelPreapproval(ws.mp_preapproval_id);
      db.run(
        `UPDATE workspaces SET auto_renew_enabled = 0, subscription_status = 'canceling',
                                updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [req.workspaceId]
      );

      try {
        const alertManager = require('../observability/alertManager');
        alertManager.send('warning', '⚠️ Recorrência cancelada', {
          workspace_id: req.workspaceId,
          preapproval_id: ws.mp_preapproval_id,
        });
      } catch (_) {}

      res.json({
        success: true,
        message: 'Assinatura recorrente cancelada. Você mantém acesso até o fim do período já pago.',
      });
    } catch (err) {
      logger.error('[Billing] cancel-recurring failed:', err.message);
      throw new AppError(err.message || 'Erro ao cancelar assinatura', 500);
    }
  })
);

module.exports = router;

/**
 * POST /api/v1/billing/create-checkout-stripe — v9.0.0
 * Cria checkout session no Stripe para clientes internacionais.
 * Aceita: { plan?, currency? }  default plan = workspace.plan
 */
router.post('/create-checkout-stripe', asyncHandler(async (req, res) => {
  if (!stripeService.isConfigured()) {
    throw new AppError('Stripe não configurado nesta instância', 503);
  }

  const ws = db.get(`SELECT id, plan, name FROM workspaces WHERE id = ?`, [req.workspaceId]);
  if (!ws) throw new AppError('Workspace não encontrado', 404);

  const user = db.get(`SELECT email FROM users WHERE id = ?`, [req.userId]);
  if (!user) throw new AppError('Usuário não encontrado', 404);

  const plan = req.body.plan || ws.plan || 'starter';
  // Mapeamento de planos para Stripe Price IDs
  // ⚠️ IMPORTANTE: substitua pelos seus Price IDs reais do Stripe Dashboard
  const PRICE_MAP = {
    starter: process.env.STRIPE_PRICE_STARTER || 'price_REPLACE_starter',
    pro: process.env.STRIPE_PRICE_PRO || 'price_REPLACE_pro',
    business: process.env.STRIPE_PRICE_BUSINESS || 'price_REPLACE_business',
  };

  const priceId = PRICE_MAP[plan];
  if (!priceId || priceId.includes('REPLACE')) {
    throw new AppError(`Plan ${plan} não tem Stripe Price ID configurado`, 503);
  }

  const baseUrl = process.env.PUBLIC_BASE_URL || 'https://whatshybrid.com.br';

  try {
    const session = await stripeService.createCheckoutSession({
      priceId,
      customerEmail: user.email,
      successUrl: `${baseUrl}/dashboard.html?checkout=success&provider=stripe`,
      cancelUrl: `${baseUrl}/dashboard.html?checkout=cancelled`,
      metadata: { workspace_id: ws.id, user_id: req.userId, plan },
    });

    res.json({
      provider: 'stripe',
      checkout_url: session.url,
      session_id: session.id,
    });
  } catch (err) {
    logger.error('[Billing] create-checkout-stripe failed:', err.message);
    throw new AppError('Falha ao criar checkout Stripe', 500);
  }
}));
