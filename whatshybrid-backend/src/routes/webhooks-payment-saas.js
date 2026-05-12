/**
 * SaaS Payment Webhook - v8.3.0
 *
 * Webhook que recebe confirmação de pagamento do MercadoPago para
 * o modelo SaaS B2B (workspace + plano + recorrência mensal).
 *
 * Diferente de webhooks-payment.js (modelo antigo de "código de ativação"),
 * este handler ativa workspaces direto, atualiza next_billing_at, cria
 * billing_invoice e mantém histórico.
 *
 * Caminho: POST /api/v1/webhooks/payment/mercadopago-saas
 */

const express = require('express');
const router = express.Router();

const db = require('../utils/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const mpService = require('../services/MercadoPagoService');

// v9.3.9: tabela de preços oficiais por plano (em BRL).
// Backend valida que amount recebido do gateway bate com o esperado.
// Sem isso, atacante (ou bug do gateway) podia ativar plano agency por R$ 0.01.
const PLAN_PRICES_BRL = {
  starter: { min: 19, max: 99 },     // R$ 19-99 (descontos promocionais OK)
  pro: { min: 49, max: 199 },         // R$ 49-199
  agency: { min: 199, max: 999 },     // R$ 199-999
};

function validatePaymentAmount(plan, amount, currency = 'BRL') {
  if (currency !== 'BRL') {
    // Aceita outras moedas mas com warning (não validamos conversão)
    logger.warn(`[Billing] Plan=${plan} pago em ${currency}, validação amount pulada`);
    return { valid: true };
  }
  const range = PLAN_PRICES_BRL[plan];
  if (!range) {
    logger.warn(`[Billing] Plano não mapeado pra validação: ${plan}`);
    return { valid: true }; // não bloqueia plano novo, mas alerta
  }
  if (amount < range.min || amount > range.max) {
    return {
      valid: false,
      reason: `Amount R$ ${amount} fora da faixa esperada R$ ${range.min}-${range.max} pra plano ${plan}`,
    };
  }
  return { valid: true };
}

/**
 * Atualiza workspace e cria invoice quando pagamento é aprovado.
 */
async function activateWorkspaceSubscription({ workspaceId, plan, paymentId, amount, currency = 'BRL' }) {
  // v9.3.9 BILLING FIX: valida amount contra preço esperado do plano.
  // Antes: backend confiava cegamente no amount do webhook → ativar agency
  // por R$ 0.01 era possível se gateway retornasse valor errado.
  const validation = validatePaymentAmount(plan, amount, currency);
  if (!validation.valid) {
    logger.error(`[WebhookSaaS] Amount inválido pra ${plan}: ${validation.reason}`);
    // Persiste o evento mas NÃO ativa workspace
    try {
      const alertManager = require('../observability/alertManager');
      alertManager.send('warning', '🚨 Pagamento com valor suspeito', {
        workspace_id: workspaceId, plan, amount, currency, payment_id: paymentId,
        reason: validation.reason,
      });
    } catch (_) {}
    return { rejected: true, reason: validation.reason };
  }

  // Verifica se essa cobrança já foi processada (idempotência)
  const existing = db.get(
    `SELECT id FROM billing_invoices WHERE provider = 'mercadopago' AND provider_ref = ?`,
    [paymentId]
  );
  if (existing) {
    logger.info(`[WebhookSaaS] Pagamento ${paymentId} já processado, ignorando`);
    return { duplicate: true };
  }

  const now = new Date();
  const nextBilling = new Date(now);
  nextBilling.setDate(nextBilling.getDate() + 30); // +30 dias

  db.transaction(() => {
    // Atualiza workspace
    db.run(
      `UPDATE workspaces SET
         plan = ?,
         subscription_status = 'active',
         payment_provider = 'mercadopago',
         next_billing_at = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [plan, nextBilling.toISOString(), workspaceId]
    );

    // Atualiza intent (se existir)
    db.run(
      `UPDATE billing_intents SET status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE provider = 'mercadopago' AND provider_ref = ?`,
      [paymentId]
    );

    // Cria invoice
    db.run(
      `INSERT INTO billing_invoices (
        id, workspace_id, plan, provider, provider_ref, status,
        amount, currency, period_start, period_end, paid_at
      ) VALUES (?, ?, ?, 'mercadopago', ?, 'paid', ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        workspaceId,
        plan,
        paymentId,
        amount,
        currency,
        now.toISOString(),
        nextBilling.toISOString(),
        now.toISOString(),
      ]
    );
  });

  logger.info(`[WebhookSaaS] Workspace ${workspaceId} ativado: plano ${plan}, próxima cobrança ${nextBilling.toISOString()}`);

  // Alerta ao owner do SaaS
  try {
    const alertManager = require('../observability/alertManager');
    alertManager.send('info', '💰 Pagamento aprovado', {
      workspace_id: workspaceId,
      plan,
      amount,
      currency,
      payment_id: paymentId,
    });
  } catch (_) {}

  // v8.4.0 — emite evento para email transacional
  try {
    const events = require('../utils/events');
    events.emit('subscription.activated', {
      workspace_id: workspaceId,
      plan,
      amount,
      currency,
      payment_id: paymentId,
    });
  } catch (_) {}

  return { activated: true };
}

/**
 * POST /api/v1/webhooks/payment/mercadopago-saas
 * Webhook principal - recebe notification do MP, consulta pagamento, ativa assinatura.
 */
router.post('/mercadopago-saas', asyncHandler(async (req, res) => {
  // 1. Validar assinatura
  const valid = mpService.validateWebhookSignature({
    headers: req.headers,
    query: req.query,
  });

  if (!valid) {
    logger.warn('[WebhookSaaS] Assinatura inválida');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { type, data } = req.body || {};
  const paymentId = data?.id || req.query?.['data.id'] || req.query?.id;

  // ── v8.5.0: OUTBOX/INBOX PATTERN ──
  // Persiste o webhook bruto ANTES de processar. Garante:
  // 1. Replay seguro se backend cair durante processamento
  // 2. Auditoria completa de todos os eventos recebidos
  // 3. Idempotência por (provider + provider_event_id)
  let inboxId = null;
  try {
    inboxId = uuidv4();
    db.run(
      `INSERT INTO webhook_inbox (id, provider, event_type, provider_event_id, signature, raw_payload, status)
       VALUES (?, 'mercadopago', ?, ?, ?, ?, 'received')`,
      [
        inboxId,
        type || 'unknown',
        paymentId || null,
        req.headers['x-signature'] || null,
        JSON.stringify({ body: req.body, query: req.query }),
      ]
    );
  } catch (inboxErr) {
    // Erro de UNIQUE indica replay → tudo bem, ignora
    if (!String(inboxErr.message).includes('UNIQUE')) {
      logger.error(`[WebhookSaaS] Inbox insert failed: ${inboxErr.message}`);
    }
  }

  // O MP responde com 200 rapidamente; processamento detalhado após
  res.status(200).json({ received: true });

  // Só nos importam events de tipo 'payment', 'preapproval' ou 'subscription_authorized_payment'
  const acceptedTypes = ['payment', 'preapproval', 'subscription_authorized_payment', 'subscription_preapproval'];
  if (!acceptedTypes.includes(type) || !paymentId) {
    logger.debug(`[WebhookSaaS] Ignored event type=${type} id=${paymentId}`);
    if (inboxId) {
      db.run(`UPDATE webhook_inbox SET status = 'ignored', processed_at = CURRENT_TIMESTAMP WHERE id = ?`, [inboxId]);
    }
    return;
  }

  // Marcar como processing — útil para replay
  if (inboxId) {
    db.run(`UPDATE webhook_inbox SET status = 'processing', attempts = attempts + 1 WHERE id = ?`, [inboxId]);
  }

  // ── Eventos de preapproval (assinatura recorrente foi criada/autorizada/cancelada) ──
  if (type === 'preapproval' || type === 'subscription_preapproval') {
    try {
      const pre = await mpService.getPreapproval(paymentId);
      const ref = pre.external_reference || '';
      const parts = ref.split('|');

      // Formato: subscription|workspaceId|plan
      if (parts[0] === 'subscription' && parts.length >= 3) {
        const [, workspaceId, plan] = parts;

        if (pre.status === 'authorized') {
          // Cliente autorizou! Marca workspace como ativo + auto_renew habilitado
          db.run(
            `UPDATE workspaces SET
               auto_renew_enabled = 1,
               subscription_status = 'active',
               plan = ?,
               payment_provider = 'mercadopago',
               mp_preapproval_id = ?,
               updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [plan, paymentId, workspaceId]
          );

          // Concede tokens iniciais
          try {
            const tokenService = require('../services/TokenService');
            tokenService.resetMonthlyForPlan(workspaceId, plan, { invoice_id: `preapproval:${paymentId}` });
          } catch (_) {}

          logger.info(`[WebhookSaaS] Preapproval AUTHORIZED: ws=${workspaceId} plan=${plan} preapproval=${paymentId}`);

          try {
            const alertManager = require('../observability/alertManager');
            alertManager.send('info', '✅ Assinatura recorrente ativada', {
              workspace_id: workspaceId,
              plan,
              preapproval_id: paymentId,
            });
          } catch (_) {}

        } else if (pre.status === 'cancelled') {
          db.run(
            `UPDATE workspaces SET auto_renew_enabled = 0, subscription_status = 'canceling',
                                    updated_at = CURRENT_TIMESTAMP
             WHERE mp_preapproval_id = ?`,
            [paymentId]
          );
          logger.info(`[WebhookSaaS] Preapproval CANCELLED: ${paymentId}`);
        }
      }
    } catch (err) {
      logger.error(`[WebhookSaaS] Erro processando preapproval ${paymentId}:`, err.message);
    }
    return;
  }

  // ── Eventos de cobrança recorrente individual (MP cobrou um mês) ──
  if (type === 'subscription_authorized_payment') {
    try {
      const auth = await mpService.getAuthorizedPayment(paymentId);

      // auth.preapproval_id liga ao workspace
      const ws = db.get(
        `SELECT id, plan FROM workspaces WHERE mp_preapproval_id = ?`,
        [auth.preapproval_id]
      );
      if (!ws) {
        logger.warn(`[WebhookSaaS] authorized_payment ${paymentId}: workspace não encontrado para preapproval ${auth.preapproval_id}`);
        return;
      }

      if (auth.status === 'approved' || auth.status === 'authorized') {
        // Cobrança recorrente bem-sucedida! Estende next_billing_at + concede tokens
        await activateWorkspaceSubscription({
          workspaceId: ws.id,
          plan: ws.plan,
          paymentId: String(paymentId),
          amount: auth.transaction_amount || 0,
          currency: auth.currency_id || 'BRL',
        });

        try {
          const tokenService = require('../services/TokenService');
          tokenService.resetMonthlyForPlan(ws.id, ws.plan, { invoice_id: `auth_payment:${paymentId}` });
        } catch (_) {}

        logger.info(`[WebhookSaaS] Recurring charge OK: ws=${ws.id} plan=${ws.plan}`);

      } else if (['rejected', 'cancelled'].includes(auth.status)) {
        // Cobrança recusada — entra em dunning
        db.run(
          `UPDATE workspaces SET subscription_status = 'past_due', updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [ws.id]
        );

        try {
          const events = require('../utils/events');
          events.emit('subscription.charge_failed', {
            workspace_id: ws.id,
            payment_id: paymentId,
            next_retry_at: new Date(Date.now() + 3 * 86400000).toISOString(),
          });
        } catch (_) {}

        logger.warn(`[WebhookSaaS] Recurring charge FAILED: ws=${ws.id} payment=${paymentId}`);
      }
    } catch (err) {
      logger.error(`[WebhookSaaS] Erro processando authorized_payment ${paymentId}:`, err.message);
    }
    return;
  }

  // ── Eventos de pagamento avulso (checkout único) — fluxo original ──
  // 2. Consulta detalhes do pagamento
  let payment;
  try {
    payment = await mpService.getPayment(paymentId);
  } catch (err) {
    logger.error(`[WebhookSaaS] Falha ao consultar pagamento ${paymentId}:`, err.message);
    return;
  }

  // 3. Só processamos pagamentos aprovados
  if (payment.status !== 'approved') {
    logger.info(`[WebhookSaaS] Pagamento ${paymentId} status=${payment.status}, não ativando`);

    // Se foi rejected/cancelled, marca intent como failed
    if (['rejected', 'cancelled', 'refunded'].includes(payment.status)) {
      try {
        db.run(
          `UPDATE billing_intents SET status = ? WHERE provider = 'mercadopago' AND provider_ref = ?`,
          [payment.status, paymentId]
        );
      } catch (_) {}
    }
    return;
  }

  // 4. Extrai workspace_id e tipo do external_reference
  // Formatos:
  //   - "workspaceId|plan"           (assinatura mensal)
  //   - "tokenpkg|workspaceId|packageId"   (pacote avulso de tokens)
  const ref = payment.external_reference || '';
  const parts = ref.split('|');

  if (parts[0] === 'tokenpkg' && parts.length >= 3) {
    // ── Compra de pacote avulso de tokens ──
    const [, workspaceId, packageId] = parts;
    try {
      const tokenService = require('../services/TokenService');
      const { TOKEN_PACKAGES } = tokenService;
      const pkg = TOKEN_PACKAGES[packageId];
      if (!pkg) {
        logger.error(`[WebhookSaaS] package_id inválido: ${packageId}`);
        return;
      }

      // Idempotência: já creditou?
      const existing = db.get(
        `SELECT id FROM token_transactions
         WHERE workspace_id = ? AND metadata LIKE ?`,
        [workspaceId, `%"payment_id":"${paymentId}"%`]
      );
      if (existing) {
        logger.info(`[WebhookSaaS] Token topup ${paymentId} já processado, ignorando`);
        return;
      }

      tokenService.credit(workspaceId, pkg.tokens, 'topup', {
        description: `Pacote ${packageId}: +${pkg.tokens.toLocaleString('pt-BR')} tokens`,
        metadata: { payment_id: paymentId, package_id: packageId },
      });

      // Marca intent como completa
      db.run(
        `UPDATE billing_intents SET status = 'completed', completed_at = CURRENT_TIMESTAMP
         WHERE provider = 'mercadopago' AND provider_ref = ?`,
        [paymentId]
      );

      // Cria invoice
      db.run(
        `INSERT INTO billing_invoices (
          id, workspace_id, plan, provider, provider_ref, status,
          amount, currency, paid_at
        ) VALUES (?, ?, ?, 'mercadopago', ?, 'paid', ?, ?, CURRENT_TIMESTAMP)`,
        [
          require('../utils/uuid-wrapper').v4(),
          workspaceId,
          `tokenpkg:${packageId}`,
          paymentId,
          payment.transaction_amount,
          payment.currency_id || 'BRL',
        ]
      );

      logger.info(`[WebhookSaaS] Token topup confirmed: ws=${workspaceId} pkg=${packageId} +${pkg.tokens}`);

      try {
        const events = require('../utils/events');
        events.emit('tokens.topup_confirmed', {
          workspace_id: workspaceId,
          tokens_added: pkg.tokens,
          payment_id: paymentId,
        });
      } catch (_) {}

      try {
        const alertManager = require('../observability/alertManager');
        alertManager.send('info', '🪙 Pacote de tokens vendido', {
          workspace_id: workspaceId,
          package: packageId,
          tokens: pkg.tokens,
          amount: payment.transaction_amount,
        });
      } catch (_) {}
    } catch (err) {
      logger.error('[WebhookSaaS] Erro ao creditar tokens:', err);
    }
    return;
  }

  // ── Compra de plano (assinatura mensal) ──
  const [workspaceId, plan] = parts;

  if (!workspaceId || !plan) {
    logger.error(`[WebhookSaaS] external_reference inválido: ${ref}`);
    return;
  }

  // 5. Ativa
  try {
    await activateWorkspaceSubscription({
      workspaceId,
      plan,
      paymentId: String(paymentId),
      amount: payment.transaction_amount,
      currency: payment.currency_id || 'BRL',
    });

    // v8.4.0 — concede tokens iniciais do plano
    try {
      const tokenService = require('../services/TokenService');
      tokenService.resetMonthlyForPlan(workspaceId, plan);
    } catch (e) {
      logger.error(`[WebhookSaaS] Falha ao conceder tokens do plano:`, e.message);
    }
  } catch (err) {
    logger.error(`[WebhookSaaS] Erro ao ativar workspace:`, err);
    // Marcar erro no inbox para replay/debug
    if (inboxId) {
      try {
        db.run(`UPDATE webhook_inbox SET status = 'failed', last_error = ? WHERE id = ?`,
          [String(err.message).substring(0, 500), inboxId]);
      } catch (_) {}
    }
    return;
  }

  // Sucesso — marcar como processado
  if (inboxId) {
    try {
      db.run(`UPDATE webhook_inbox SET status = 'processed', processed_at = CURRENT_TIMESTAMP WHERE id = ?`, [inboxId]);
    } catch (_) {}
  }
}));

/**
 * POST /api/v1/webhooks/payment/manual-confirm (admin only)
 * Atalho administrativo para confirmar manualmente um pagamento
 * (útil em testes ou se o webhook automático falhar).
 */
const { authenticate, authorize } = require('../middleware/auth');
router.post('/manual-confirm',
  authenticate,
  authorize('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const { workspace_id, plan, payment_id, amount } = req.body;
    if (!workspace_id || !plan || !payment_id) {
      return res.status(400).json({ error: 'workspace_id, plan, payment_id obrigatórios' });
    }

    // v9.3.8 SECURITY FIX: owner só pode ativar SEU PRÓPRIO workspace.
    // Antes: owner de workspace A podia ativar workspace B passando workspace_id no body.
    // Apenas role 'admin' (admin do SaaS, não admin de workspace) pode ativar qualquer.
    const isSaasAdmin = req.user.role === 'admin' && (!req.user.workspace_id || req.user.workspace_id === 'system');
    if (!isSaasAdmin && workspace_id !== req.user.workspace_id) {
      return res.status(403).json({ error: 'Não autorizado a ativar workspace de terceiros' });
    }

    const result = await activateWorkspaceSubscription({
      workspaceId: workspace_id,
      plan,
      paymentId: String(payment_id),
      amount: Number(amount) || 0,
    });

    res.json(result);
  })
);

module.exports = router;
module.exports.activateWorkspaceSubscription = activateWorkspaceSubscription;
