/**
 * Billing Cron - v8.3.0
 *
 * Job diário que roda às 03:00 (configurável via BILLING_CRON_SCHEDULE):
 * 1. Verifica trials que expiraram nas últimas 24h:
 *    - Se workspace tem cartão configurado → tenta cobrar via MP
 *    - Se não tem → marca como past_due e envia email
 * 2. Verifica cobranças failed que precisam retry (dunning 3 tentativas em 7 dias):
 *    - dia 1, 3, 7 após falha
 *    - após 3 falhas, marca subscription_status='past_due' e suspende acesso
 * 3. Notifica owner do SaaS (você) por alertManager
 *
 * NOTA: Para cobrança recorrente automática, é preciso ter o cliente com método
 * de pagamento salvo (token de cartão). MercadoPago suporta isso via "preapprovals"
 * (recurring) ou "card tokens". Implementação completa requer integração mais
 * profunda com o flow de tokenização. Por enquanto, este cron:
 *   - Detecta trials expirando e marca past_due
 *   - Envia notificações
 *   - Marca workspaces para revisão manual ou re-engajamento
 *
 * A "cobrança recorrente automática real" é Onda 4.5 (futuro).
 */

const cron = require('node-cron');
const crypto = require('crypto');
const db = require('../utils/database');
const logger = require('../utils/logger');

/**
 * Persiste uma row em dunning_charge_attempts. Fire-and-forget,
 * NUNCA throw — perder log de auditoria não pode quebrar dunning.
 *
 * raw é o resultado do gateway (objeto). Truncamos pra 4KB pra não
 * explodir disco se Stripe retornar payload gigante.
 */
function recordDunningChargeAttempt({
  workspaceId, provider, providerSubscriptionId, attemptNumber,
  pastDueAgeDays, chargeMethod, chargeStatus, ok, errorMessage, raw,
}) {
  try {
    let rawJson = null;
    if (raw) {
      try {
        const s = JSON.stringify(raw);
        rawJson = s.length > 4096 ? s.substring(0, 4093) + '...' : s;
      } catch (_) { rawJson = null; }
    }
    db.run(
      `INSERT INTO dunning_charge_attempts
        (id, workspace_id, provider, provider_subscription_id, attempt_number,
         past_due_age_days, charge_method, charge_status, ok, error_message, raw_response)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        workspaceId,
        provider || 'none',
        providerSubscriptionId || null,
        attemptNumber,
        pastDueAgeDays,
        chargeMethod || 'skipped',
        chargeStatus || 'unknown',
        ok ? 1 : 0,
        errorMessage ? String(errorMessage).substring(0, 500) : null,
        rawJson,
      ]
    );
  } catch (e) {
    logger.warn('[BillingCron] recordDunningChargeAttempt falhou:', e.message);
  }
}

let alertManager;
try { alertManager = require('../observability/alertManager'); } catch (_) {}

const SCHEDULE = process.env.BILLING_CRON_SCHEDULE || '0 3 * * *'; // 03:00 todos os dias

/**
 * Encontra workspaces cujo trial acabou e ainda está em status 'trialing'.
 * Marca como 'past_due' (precisa pagar) ou 'active' se já tem invoice paga.
 */
// Fase 2 cobrança real: idempotência da geração de 1ª invoice no cron.
// Se já criamos um link de pagamento (billing_intent pending) nas últimas
// PENDING_INTENT_WINDOW_MS, NÃO criamos outro. Evita spam de invoices se
// o cron rodar mais de uma vez ou se o usuário ignorar o email por dias.
const PENDING_INTENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function hasRecentPendingIntent(workspaceId) {
  try {
    const row = db.get(
      `SELECT id, created_at FROM billing_intents
       WHERE workspace_id = ? AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [workspaceId]
    );
    if (!row) return false;
    const age = Date.now() - new Date(row.created_at).getTime();
    return age < PENDING_INTENT_WINDOW_MS;
  } catch (_) {
    return false; // erro = não bloqueia criação (melhor double-link que zero)
  }
}

/**
 * Fase 2 cobrança real: gera preference de pagamento no MP pra um trial
 * expirado, com cupom pendente se houver. Persiste billing_intent +
 * emite evento `subscription.first_invoice_pending` (listener envia email).
 *
 * Retorna { ok, payment_url, coupon_label } em sucesso, ou { ok:false }
 * em qualquer falha. NUNCA throw — chamada dentro do loop do cron.
 */
async function generateFirstInvoicePaymentLink(ws, ownerInfo) {
  try {
    const mpService = require('../services/MercadoPagoService');
    if (!mpService.isConfigured()) {
      logger.warn('[BillingCron] MP não configurado; trial expirado sem link de pagamento');
      return { ok: false, reason: 'mp_not_configured' };
    }

    if (!['starter', 'pro', 'agency'].includes(ws.plan)) {
      // Plano 'free' não cobra; trial 'free' não faz sentido — só pula.
      return { ok: false, reason: 'plan_not_billable' };
    }

    // Pega cupom pendente (se EXIT50 atribuído no signup)
    let couponCode, couponLabel;
    try {
      const couponService = require('../services/CouponService');
      const pending = couponService.getPendingCouponForWorkspace(ws.id, ws.plan);
      if (pending) {
        couponCode = pending.code;
        couponLabel = pending.description || pending.code;
      }
    } catch (_) {}

    const email = ownerInfo?.email;
    const name = ownerInfo?.name;
    if (!email) {
      logger.warn(`[BillingCron] Owner sem email pra ws=${ws.id}; pulando preference`);
      return { ok: false, reason: 'no_owner_email' };
    }

    const pref = await mpService.createPreference({
      workspaceId: ws.id,
      plan: ws.plan,
      email,
      name: name || email,
      couponCode,
    });

    // Persiste a intent pra UI/billing endpoint enxergar
    try {
      db.run(
        `INSERT INTO billing_intents (id, workspace_id, plan, provider, provider_ref, status, metadata)
         VALUES (?, ?, ?, 'mercadopago', ?, 'pending', ?)`,
        [
          crypto.randomUUID(),
          ws.id,
          ws.plan,
          pref.id,
          JSON.stringify({
            source: 'billing_cron_first_invoice',
            coupon: couponCode || null,
          }),
        ]
      );
    } catch (e) {
      logger.warn('[BillingCron] insert billing_intent falhou:', e.message);
      // Não bloqueia o restante — o link de pagamento ainda é válido.
    }

    const paymentUrl = process.env.MERCADOPAGO_USE_SANDBOX === 'true'
      ? (pref.sandbox_init_point || pref.init_point)
      : pref.init_point;

    // Dispara email via listener (ver utils/emailListeners.js)
    try {
      const events = require('../utils/events');
      events.emit('subscription.first_invoice_pending', {
        workspace_id: ws.id,
        plan: ws.plan,
        payment_url: paymentUrl,
        coupon_label: couponLabel,
        // expires_at é opcional; MP preference dura ~30d por padrão
      });
    } catch (e) {
      logger.warn('[BillingCron] emit first_invoice_pending falhou:', e.message);
    }

    return { ok: true, payment_url: paymentUrl, coupon_label: couponLabel };
  } catch (err) {
    logger.error(`[BillingCron] generateFirstInvoicePaymentLink falhou ws=${ws.id}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

async function processExpiredTrials() {
  const now = new Date();

  let expiredTrials = [];
  try {
    // v9.3.9 BILLING FIX: removida janela de 24h (yesterday filter).
    // Antes: se cron não rodasse por >24h (crash/deploy/network),
    // trials que expiraram fora da janela ficavam 'trialing' pra sempre.
    // Cliente usava IA grátis indefinidamente.
    // Agora: pega TODOS os trials cujo trial_end_at já passou, sem janela.
    // Idempotente porque depois de processar muda status pra 'active' ou 'past_due'.
    expiredTrials = db.all(
      `SELECT id, name, plan, owner_id, trial_end_at
       FROM workspaces
       WHERE subscription_status = 'trialing'
         AND trial_end_at IS NOT NULL
         AND trial_end_at <= ?`,
      [now.toISOString()]
    ) || [];
  } catch (err) {
    logger.error('[BillingCron] Erro ao buscar trials expirados:', err.message);
    return [];
  }

  if (expiredTrials.length === 0) {
    logger.debug('[BillingCron] Nenhum trial expirado pendente');
    return [];
  }

  logger.info(`[BillingCron] ${expiredTrials.length} trials expirados pendentes`);

  const results = [];
  for (const ws of expiredTrials) {
    // Já existe invoice paga para este workspace?
    let paidInvoice = null;
    try {
      paidInvoice = db.get(
        `SELECT id FROM billing_invoices
         WHERE workspace_id = ? AND status = 'paid'
         ORDER BY paid_at DESC LIMIT 1`,
        [ws.id]
      );
    } catch (_) {}

    if (paidInvoice) {
      // Pagou — está tudo certo, vira active
      try {
        db.run(
          `UPDATE workspaces SET subscription_status = 'active' WHERE id = ?`,
          [ws.id]
        );
        results.push({ workspace_id: ws.id, action: 'activated' });
      } catch (e) {
        logger.error(`[BillingCron] Erro ao ativar ${ws.id}:`, e.message);
      }
    } else {
      // Não pagou — past_due. past_due_since (COALESCE) marca o início do
      // ciclo de dunning sem resetar se já está marcado. processDunning()
      // dispara retries em 1/3/7 dias contra esse campo.
      try {
        db.run(
          `UPDATE workspaces
              SET subscription_status = 'past_due',
                  past_due_since = COALESCE(past_due_since, CURRENT_TIMESTAMP)
            WHERE id = ?`,
          [ws.id]
        );

        // Fase 2: gera link de pagamento via MP + envia email (uma vez por
        // ciclo de 24h por workspace). Só pra planos pagos, e só se MP
        // está configurado. Sem link, dunning ainda alerta o owner do SaaS.
        let linkResult = { ok: false, skipped: true };
        if (!hasRecentPendingIntent(ws.id)) {
          let ownerInfo = null;
          try {
            ownerInfo = db.get('SELECT email, name FROM users WHERE id = ?', [ws.owner_id]);
          } catch (_) {}
          linkResult = await generateFirstInvoicePaymentLink(ws, ownerInfo);
        } else {
          logger.debug(`[BillingCron] ws=${ws.id} já tem pending intent < 24h; pulando MP`);
        }

        results.push({
          workspace_id: ws.id,
          action: 'past_due',
          plan: ws.plan,
          payment_link_generated: !!linkResult.ok,
        });

        if (alertManager) {
          alertManager.send('warning', '⏰ Trial expirado sem pagamento', {
            workspace_id: ws.id,
            workspace_name: ws.name,
            plan: ws.plan,
            trial_end: ws.trial_end_at,
            payment_link_generated: !!linkResult.ok,
            payment_url: linkResult.payment_url || null,
          });
        }
      } catch (e) {
        logger.error(`[BillingCron] Erro ao marcar past_due ${ws.id}:`, e.message);
      }
    }
  }

  return results;
}

/**
 * Encontra subscriptions next_billing_at vencidas e tenta gerar nova cobrança.
 * (Stub: marca como pending_renewal, envia email — cobrança real requer token de cartão.)
 */
function processExpiredSubscriptions() {
  const now = new Date();

  let toRenew = [];
  try {
    toRenew = db.all(
      `SELECT id, name, plan, owner_id, next_billing_at
       FROM workspaces
       WHERE subscription_status = 'active'
         AND next_billing_at IS NOT NULL
         AND next_billing_at <= ?`,
      [now.toISOString()]
    ) || [];
  } catch (err) {
    logger.error('[BillingCron] Erro ao buscar renovações:', err.message);
    return [];
  }

  if (toRenew.length === 0) return [];

  logger.info(`[BillingCron] ${toRenew.length} workspaces precisam de renovação`);

  const results = [];
  for (const ws of toRenew) {
    // Marca como past_due — o owner do SaaS toma providência
    // (ou trigger automático via card token, que é Onda 4.5).
    // past_due_since marca início do ciclo de dunning.
    try {
      db.run(
        `UPDATE workspaces
            SET subscription_status = 'past_due',
                past_due_since = COALESCE(past_due_since, CURRENT_TIMESTAMP)
          WHERE id = ?`,
        [ws.id]
      );
      results.push({ workspace_id: ws.id, action: 'renewal_due', plan: ws.plan });

      if (alertManager) {
        alertManager.send('warning', '🔁 Renovação pendente', {
          workspace_id: ws.id,
          workspace_name: ws.name,
          plan: ws.plan,
          due_at: ws.next_billing_at,
        });
      }
    } catch (e) {
      logger.error(`[BillingCron] Erro renewal ${ws.id}:`, e.message);
    }
  }

  return results;
}

/**
 * v9.6.x — Dunning automático: retries escalonados em 1, 3 e 7 dias após
 * a subscription virar past_due. Cada workspace tem `dunning_attempts`
 * (0..3) e `last_dunning_at`. O cron roda 1×/dia (03:00 default), então
 * cada disparo só acontece uma vez por dia mesmo que o cron seja chamado
 * múltiplas vezes manualmente.
 *
 * Schedule:
 *   - Dia 1 após past_due → tentativa 1 (lembrete amigável)
 *   - Dia 3              → tentativa 2 (aviso firme, ameaça de suspensão)
 *   - Dia 7              → tentativa 3 (último aviso, prepare-se pra perder
 *                                       acesso amanhã); na próxima run o
 *                                       suspendDelinquent suspende.
 *
 * Como o "real automatic charge" (Onda 4.5 — preapproval MP, Stripe
 * subscription) ainda não está auto-disparando cobrança, este dunning é
 * focado em ALERTAR o cliente (e o operador via alertManager). Quando o
 * card-token retry for implementado, basta plugar aqui a chamada efetiva
 * de cobrança em cada tentativa.
 */
async function processDunning() {
  const now = Date.now();
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  // Stage por idade (em dias) e tentativa esperada nesse estágio.
  const STAGES = [
    { dayMin: 1, dayMax: 2, attempt: 1, severity: 'info',     label: 'Lembrete amigável' },
    { dayMin: 3, dayMax: 4, attempt: 2, severity: 'warning',  label: 'Aviso firme — risco de suspensão' },
    { dayMin: 7, dayMax: 7, attempt: 3, severity: 'critical', label: 'Último aviso — suspensão amanhã' },
  ];

  let pastDueList = [];
  try {
    // JOIN com users pra pegar email/name do owner — usado pra email
    // transacional de dunning (sendDunningEscalation). Sem JOIN, precisaríamos
    // de query extra por workspace dentro do loop.
    pastDueList = db.all(
      `SELECT w.id, w.name, w.plan, w.owner_id, w.dunning_attempts,
              w.last_dunning_at, w.past_due_since, w.payment_provider,
              w.mp_preapproval_id, w.stripe_subscription_id,
              u.email AS owner_email, u.name AS owner_name
         FROM workspaces w
         LEFT JOIN users u ON u.id = w.owner_id
        WHERE w.subscription_status = 'past_due'
          AND w.past_due_since IS NOT NULL`
    ) || [];
  } catch (err) {
    logger.error('[BillingCron] processDunning query falhou:', err.message);
    return [];
  }

  // Lazy-load dos services (evita require circular e custo no boot se
  // dunning não tiver nada pra processar).
  let mpService = null;
  let stripeService = null;
  let emailService = null;
  try { mpService = require('../services/MercadoPagoService'); } catch (_) {}
  try { stripeService = require('../services/StripeService'); } catch (_) {}
  try { emailService = require('../services/EmailService'); } catch (_) {}

  const results = [];
  for (const ws of pastDueList) {
    const pastDueAt = new Date(ws.past_due_since).getTime();
    if (!Number.isFinite(pastDueAt)) continue;
    const ageDays = Math.floor((now - pastDueAt) / 86400000);

    // Encontra o estágio que cobre essa idade.
    const stage = STAGES.find(s => ageDays >= s.dayMin && ageDays <= s.dayMax);
    if (!stage) continue;

    // Idempotência: só dispara se o attempt esperado é > attempts já feitos
    // E se o last_dunning_at é de outro dia (anti-double-fire no mesmo dia).
    const currentAttempts = Number(ws.dunning_attempts) || 0;
    if (currentAttempts >= stage.attempt) continue;
    if (ws.last_dunning_at) {
      const lastAt = new Date(ws.last_dunning_at);
      if (Number.isFinite(lastAt.getTime()) && lastAt >= todayMidnight) continue;
    }

    // v9.6.x — Real automatic charge (Onda 4.5).
    //
    // Tenta cobrança real ANTES do alerta. Resultado vai no log + alerta
    // contextual. Idempotência: o gate `last_dunning_at >= todayMidnight`
    // acima garante que cada workspace recebe NO MÁXIMO um retry/dia.
    //
    // Stripe: força pagamento de invoice aberta via POST /invoices/{id}/pay.
    //         Resultados:
    //           - ok=true, status='paid'         → cliente regularizou; webhook
    //                                              renova next_billing_at e tokens
    //           - ok=true, status='already_paid' → webhook anterior já marcou OK
    //                                              (race); só não suspende
    //           - ok=false, status='declined'    → cartão recusado de novo; alert
    //           - ok=false, status='gone'        → subscription cancelada; alert
    //                                              especial (reconfig)
    //
    // MP preapproval: MP NÃO oferece endpoint pra forçar charge imediato
    //         (retries são automáticos no ciclo do MP). O que dá pra
    //         fazer é HEALTH CHECK — se preapproval foi cancelada pelo
    //         cliente no painel MP, detectamos aqui e mudamos o alerta
    //         pra "cliente precisa reconfigurar pagamento".
    let chargeResult = null;
    let chargeMethod = null;
    let chargeMethodKind = 'skipped';
    let providerSubId = null;
    try {
      if (ws.stripe_subscription_id && stripeService?.isConfigured?.()) {
        chargeMethod = 'stripe';
        chargeMethodKind = 'retry_invoice';
        providerSubId = ws.stripe_subscription_id;
        chargeResult = await stripeService.retryFailedInvoice(ws.stripe_subscription_id);
        if (chargeResult.ok && (chargeResult.status === 'paid' || chargeResult.status === 'already_paid')) {
          // Cobrança passou — webhook do Stripe vai marcar active+renovar
          // tokens. Registra no histórico, atualiza dunning_attempts pra
          // evitar reentrância no mesmo dia, e PULA o alerta (cliente OK).
          logger.info(`[BillingCron] Dunning ${stage.attempt}/3 → CHARGE OK (stripe) pra ${ws.id} (${ws.name})`);
          recordDunningChargeAttempt({
            workspaceId: ws.id,
            provider: 'stripe',
            providerSubscriptionId: providerSubId,
            attemptNumber: stage.attempt,
            pastDueAgeDays: ageDays,
            chargeMethod: chargeMethodKind,
            chargeStatus: chargeResult.status,
            ok: true,
            raw: chargeResult.raw,
          });
          db.run(
            `UPDATE workspaces
                SET dunning_attempts = ?,
                    last_dunning_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
            [stage.attempt, ws.id]
          );
          results.push({
            workspace_id: ws.id, attempt: stage.attempt, age_days: ageDays,
            plan: ws.plan, charge: 'stripe:paid'
          });
          continue;
        }
      } else if (ws.mp_preapproval_id && mpService?.isConfigured?.()) {
        chargeMethod = 'mp';
        chargeMethodKind = 'health_check';
        providerSubId = ws.mp_preapproval_id;
        chargeResult = await mpService.getPreapprovalHealth(ws.mp_preapproval_id);
      } else {
        chargeMethod = 'none';
        chargeMethodKind = 'skipped';
      }
    } catch (err) {
      logger.warn(`[BillingCron] Charge attempt falhou pra ${ws.id}:`, err.message);
      chargeResult = { ok: false, status: 'exception', error: err.message };
    }

    // Decide severity/label do alerta baseado no resultado do charge.
    let severity = stage.severity;
    let label = stage.label;
    let extraNote = '';
    if (chargeResult) {
      if (chargeMethod === 'stripe') {
        if (chargeResult.status === 'declined') {
          extraNote = ' (cartão recusado novamente)';
        } else if (chargeResult.status === 'gone' || chargeResult.status === 'invoice_void') {
          severity = 'critical';
          label = 'Assinatura inválida — cliente precisa reconfigurar';
          extraNote = ` (${chargeResult.status})`;
        }
      } else if (chargeMethod === 'mp') {
        if (chargeResult.requiresReconfig) {
          severity = 'critical';
          label = 'Preapproval MP inválida — cliente precisa reconfigurar';
          extraNote = ` (status=${chargeResult.status})`;
        }
      }
    } else if (!ws.stripe_subscription_id && !ws.mp_preapproval_id) {
      // Workspace sem método de pagamento salvo (provavelmente trial
      // expirado que nunca configurou). Dunning vira só notificação.
      extraNote = ' (sem método de pagamento — só alerta)';
    }

    try {
      // Persiste histórico do attempt — tanto pra cobrança falha (declined/
      // gone) quanto pra skipped (sem método de pagamento). O caminho de
      // "stripe:paid" já tem o record acima e continua antes daqui.
      recordDunningChargeAttempt({
        workspaceId: ws.id,
        provider: chargeMethod || 'none',
        providerSubscriptionId: providerSubId,
        attemptNumber: stage.attempt,
        pastDueAgeDays: ageDays,
        chargeMethod: chargeMethodKind,
        chargeStatus: chargeResult?.status || (chargeMethod === 'none' ? 'no_method' : 'unknown'),
        ok: !!chargeResult?.ok,
        errorMessage: chargeResult?.error || null,
        raw: chargeResult?.raw || chargeResult,
      });

      db.run(
        `UPDATE workspaces
            SET dunning_attempts = ?,
                last_dunning_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [stage.attempt, ws.id]
      );

      if (alertManager) {
        alertManager.send(severity, `💸 Dunning ${stage.attempt}/3 — ${label}`, {
          workspace_id: ws.id,
          workspace_name: ws.name,
          plan: ws.plan,
          age_days: ageDays,
          attempt: stage.attempt,
          past_due_since: ws.past_due_since,
          charge_method: chargeMethod,
          charge_result: chargeResult,
        });
      }

      // v9.6.x — Email transacional pro CLIENTE (não pro operador).
      // alertManager.send vai pro operador (você); aqui mandamos pro
      // owner do workspace via SendGrid. Sem isso, o cliente não sabe
      // que o cartão falhou — só descobre quando perde acesso.
      //
      // Idempotência: o gate `last_dunning_at >= todayMidnight` lá no
      // topo do loop garante que cada workspace recebe NO MÁXIMO 1
      // email por estágio (3 emails ao longo do ciclo de 7 dias).
      //
      // Fire-and-forget: erro de SendGrid não pode quebrar dunning.
      // EmailService.send já tem retry interno + outbox.
      if (emailService?.isConfigured?.() && ws.owner_email) {
        let scenario = 'declined';
        if (chargeMethod === 'none') {
          scenario = 'no_method';
        } else if (chargeMethod === 'stripe') {
          if (['gone', 'invoice_void'].includes(chargeResult?.status)) scenario = 'reconfig';
        } else if (chargeMethod === 'mp') {
          if (chargeResult?.requiresReconfig) scenario = 'reconfig';
          else if (chargeResult?.valid) scenario = 'pending'; // MP cuida do retry
        }

        const STAGE_DAYS_REMAINING = { 1: 6, 2: 4, 3: 1 };
        emailService.sendDunningEscalation({
          to: ws.owner_email,
          name: ws.owner_name || 'Cliente',
          plan: ws.plan,
          attempt: stage.attempt,
          daysOverdue: ageDays,
          daysUntilSuspension: STAGE_DAYS_REMAINING[stage.attempt] || 1,
          scenario,
        }).catch(e => {
          logger.warn(`[BillingCron] Falha ao enviar email dunning pra ${ws.owner_email}:`, e?.message || e);
        });
      } else if (!ws.owner_email) {
        logger.warn(`[BillingCron] Workspace ${ws.id} sem owner_email — pulando email de dunning`);
      }

      logger.info(`[BillingCron] Dunning ${stage.attempt}/3 disparado pra ${ws.id} (${ws.name}) — ${ageDays}d past_due${extraNote}`);
      results.push({
        workspace_id: ws.id,
        attempt: stage.attempt,
        age_days: ageDays,
        plan: ws.plan,
        charge: chargeMethod ? `${chargeMethod}:${chargeResult?.status || 'none'}` : 'none',
      });
    } catch (e) {
      logger.error(`[BillingCron] Erro dunning ${ws.id}:`, e.message);
    }
  }

  return results;
}

/**
 * Suspende workspaces que estão past_due há mais de 7 dias.
 *
 * v9.6.x: usa `past_due_since` (não `updated_at`). O field antigo mudava
 * com qualquer write na linha (incluindo o próprio bump de
 * dunning_attempts), o que fazia o filtro `updated_at <= sevenDaysAgo`
 * nunca matchar — workspace nunca era suspenso na prática.
 */
function suspendDelinquent() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  let toSuspend = [];
  try {
    toSuspend = db.all(
      `SELECT id, name, plan, past_due_since FROM workspaces
       WHERE subscription_status = 'past_due'
         AND past_due_since IS NOT NULL
         AND past_due_since <= ?`,
      [sevenDaysAgo]
    ) || [];
  } catch (err) {
    logger.error('[BillingCron] suspendDelinquent query falhou:', err.message);
    return [];
  }

  for (const ws of toSuspend) {
    try {
      db.run(
        `UPDATE workspaces SET subscription_status = 'suspended' WHERE id = ?`,
        [ws.id]
      );
      logger.warn(`[BillingCron] Workspace ${ws.id} (${ws.name}) suspendido por inadimplência (past_due desde ${ws.past_due_since})`);

      if (alertManager) {
        alertManager.send('critical', '🚫 Workspace suspenso', {
          workspace_id: ws.id,
          workspace_name: ws.name,
          plan: ws.plan,
          reason: '7 dias past_due (após dunning 1/3/7)',
          past_due_since: ws.past_due_since,
        });
      }
    } catch (e) {
      logger.error(`[BillingCron] Erro suspend ${ws.id}:`, e.message);
    }
  }
  return toSuspend;
}

/**
 * v8.4.0 — Notifica trials que terminam em 3 dias (envia email).
 * Roda diariamente, dispara apenas no dia exato (3 dias antes do trial_end_at).
 */
function notifyTrialsEnding() {
  const threeDaysFromNow = new Date(Date.now() + 3 * 86400000);
  const fourDaysFromNow = new Date(Date.now() + 4 * 86400000);

  let endingSoon = [];
  try {
    endingSoon = db.all(
      `SELECT id, plan, trial_end_at
       FROM workspaces
       WHERE subscription_status = 'trialing'
         AND trial_end_at IS NOT NULL
         AND trial_end_at >= ?
         AND trial_end_at < ?`,
      [threeDaysFromNow.toISOString(), fourDaysFromNow.toISOString()]
    ) || [];
  } catch (err) {
    return [];
  }

  let events;
  try { events = require('../utils/events'); } catch (_) {}

  for (const ws of endingSoon) {
    try {
      if (events) {
        events.emit('subscription.trial_ending', {
          workspace_id: ws.id,
          plan: ws.plan,
          days_left: 3,
        });
      }
      logger.info(`[BillingCron] Trial ending notification queued for ${ws.id}`);
    } catch (e) {
      logger.error(`[BillingCron] Erro ao notificar trial ending ${ws.id}:`, e.message);
    }
  }

  return endingSoon;
}

/**
 * Run all jobs in sequence
 */
async function runAll() {
  const start = Date.now();
  logger.info('[BillingCron] Iniciando ciclo diário');
  try {
    // Fase 2: processExpiredTrials agora é async porque gera link de
    // pagamento via MP (HTTP call). Sem o await, o cron retorna antes
    // dos intents serem persistidos e o relatório fica subcontado.
    const trials = await processExpiredTrials();
    const renewals = processExpiredSubscriptions();
    // v9.6.x: dunning ANTES de suspendDelinquent — assim a tentativa 3
    // (dia 7) é registrada no mesmo dia em que o workspace cruza o limite
    // de suspensão. Sem essa ordem, o suspend rodaria primeiro e o cliente
    // perderia acesso sem receber o "último aviso".
    //
    // processDunning é async agora (faz HTTP calls pra Stripe/MP). Mantemos
    // await pra suspendDelinquent não rodar antes do retry de cobrança
    // resolver — se Stripe pagou no dia 7, NÃO queremos suspender.
    const dunning = await processDunning();
    const suspended = suspendDelinquent();
    const endingSoon = notifyTrialsEnding();

    // v9.0.0: drip campaigns + health score
    let dripResult = { processed: 0, sent: 0 };
    let healthResult = { updated: 0 };
    try {
      const drip = require('../services/DripCampaignService');
      drip.processDripCampaigns().then(r => {
        dripResult = r;
        logger.info(`[BillingCron] Drip: ${r.sent}/${r.processed} sent`);
      }).catch(e => logger.error('[BillingCron] Drip failed:', e.message));
    } catch (e) { logger.warn('[BillingCron] Drip skipped:', e.message); }

    try {
      const health = require('../services/HealthScoreService');
      healthResult = health.updateAllHealthScores();
    } catch (e) { logger.warn('[BillingCron] HealthScore skipped:', e.message); }

    const summary = {
      trials_processed: trials.length,
      renewals_due: renewals.length,
      dunning_dispatched: dunning.length,
      workspaces_suspended: suspended.length,
      trial_ending_notifications: endingSoon.length,
      health_scores_updated: healthResult.updated,
      duration_ms: Date.now() - start,
    };
    logger.info('[BillingCron] Ciclo concluído', summary);
    return summary;
  } catch (err) {
    logger.error('[BillingCron] Erro no ciclo:', err);
    if (alertManager) {
      alertManager.send('critical', '💥 Billing cron falhou', { error: err.message });
    }
    throw err;
  }
}

let scheduledTask = null;
let emailOutboxTask = null;
let webhookStuckTask = null;
let loginAttemptsCleanupTask = null;

function start() {
  if (scheduledTask) {
    logger.warn('[BillingCron] Já está agendado');
    return scheduledTask;
  }

  if (process.env.BILLING_CRON_DISABLED === 'true') {
    logger.info('[BillingCron] Desabilitado via BILLING_CRON_DISABLED=true');
    return null;
  }

  logger.info(`[BillingCron] Agendado: ${SCHEDULE}`);
  scheduledTask = cron.schedule(SCHEDULE, runAll, {
    scheduled: true,
    timezone: process.env.TZ || 'America/Sao_Paulo',
  });

  // ── v8.5.0: Email Outbox processor — a cada 5 minutos ──
  if (process.env.EMAIL_OUTBOX_DISABLED !== 'true') {
    emailOutboxTask = cron.schedule('*/5 * * * *', async () => {
      try {
        const emailService = require('../services/EmailService');
        await emailService.processOutbox(20);
      } catch (err) {
        logger.error(`[EmailOutbox cron] Error: ${err.message}`);
      }
    });
    logger.info('[BillingCron] Email outbox processor agendado: */5 * * * *');
  }

  // ── v9.2.0: Webhook stuck cleanup — a cada 5 minutos ──
  // Webhooks que ficaram em 'processing' > 2min sem terminar viram 'failed'
  // pra serem reprocessados pelo retry cron. Sem isso, cliente paga e
  // não é ativado se o handler crashou no meio.
  webhookStuckTask = cron.schedule('*/5 * * * *', () => {
    try {
      const db = require('../utils/database');
      const r = db.run(
        `UPDATE webhook_inbox
         SET status = 'failed',
             last_error = COALESCE(last_error || ' | ', '') || 'auto-failed: stuck in processing > 2min'
         WHERE status = 'processing'
           AND (
             received_at < datetime('now', '-2 minutes')
             OR processed_at IS NULL AND received_at < datetime('now', '-2 minutes')
           )`
      );
      if (r.changes > 0) {
        logger.warn(`[WebhookStuck cron] Marked ${r.changes} stuck webhooks as 'failed' for retry`);
        // Alerta se houver muitos
        if (r.changes >= 5) {
          try {
            const alertManager = require('../observability/alertManager');
            alertManager?.send?.('warning', `🚨 ${r.changes} webhooks travados em 'processing'`, {
              hint: 'Investigue se há crash no handler de webhook',
            });
          } catch (_) {}
        }
      }
    } catch (err) {
      logger.error(`[WebhookStuck cron] Error: ${err.message}`);
    }
  });
  logger.info('[BillingCron] Webhook stuck cleanup agendado: */5 * * * *');

  // ── v9.2.0: Login attempts cleanup — diário às 3h ──
  loginAttemptsCleanupTask = cron.schedule('0 3 * * *', () => {
    try {
      const loginAttempts = require('../services/LoginAttemptsService');
      loginAttempts.cleanup();
    } catch (err) {
      logger.error(`[LoginAttemptsCleanup] Error: ${err.message}`);
    }
  });
  logger.info('[BillingCron] Login attempts cleanup agendado: 0 3 * * *');

  return scheduledTask;
}

function stop() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info('[BillingCron] Parado');
  }
  if (emailOutboxTask) {
    emailOutboxTask.stop();
    emailOutboxTask = null;
    logger.info('[EmailOutbox cron] Parado');
  }
  if (webhookStuckTask) {
    webhookStuckTask.stop();
    webhookStuckTask = null;
    logger.info('[WebhookStuck cron] Parado');
  }
  if (loginAttemptsCleanupTask) {
    loginAttemptsCleanupTask.stop();
    loginAttemptsCleanupTask = null;
  }
}

module.exports = { start, stop, runAll, processExpiredTrials, processExpiredSubscriptions, processDunning, suspendDelinquent };
