/**
 * Subscription Routes - v8.3.0
 * 
 * Gerencia o ciclo de vida da assinatura SaaS do workspace:
 * - Cancelar (mantém acesso até fim do período pago)
 * - Reativar (depois de cancelar)
 * - Trocar plano
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────
// Helpers — assinatura via código + device fingerprint
// ─────────────────────────────────────────────────────────────────────

function generateSubscriptionCode() {
  // Formato: WHL-XXXX-XXXX-XXXX (12 chars A-Z2-9, evita 0/O/1/I para legibilidade)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n) => {
    const bytes = crypto.randomBytes(n);
    let out = '';
    for (let i = 0; i < n; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  };
  return `WHL-${pick(4)}-${pick(4)}-${pick(4)}`;
}

function deviceIdHash(req) {
  // Hash estável da combinação que identifica um "dispositivo" sem coletar PII.
  // Antes não havia binding → mesmo código rodava em N navegadores.
  const ua = String(req.headers['user-agent'] || '').slice(0, 256);
  const lang = String(req.headers['accept-language'] || '').slice(0, 64);
  const headerFp = String(req.headers['x-whl-device'] || '').slice(0, 128);
  return crypto.createHash('sha256')
    .update(`${ua}\n${lang}\n${headerFp}`)
    .digest('hex')
    .slice(0, 32);
}

// Mapeia código → workspace + plano, retorna { code, workspaceId, plan } ou null.
function lookupCode(code) {
  if (!code || typeof code !== 'string') return null;
  return db.get(
    `SELECT code, workspace_id, plan, status, device_id_hash, activated_at, expires_at
     FROM subscription_codes WHERE code = ? LIMIT 1`,
    [code.trim()]
  );
}

// v9.6.0 — chave-mestra do desenvolvedor. Constante-time compare via
// crypto.timingSafeEqual evita timing attacks. Configurável via env
// SUBSCRIPTION_MASTER_KEY; default 'Cristi@no123' pra build local.
const MASTER_KEY = process.env.SUBSCRIPTION_MASTER_KEY || 'Cristi@no123';
function isMasterKey(code) {
  if (!code || typeof code !== 'string') return false;
  const a = Buffer.from(code.trim());
  const b = Buffer.from(MASTER_KEY);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (_) { return false; }
}

// Rotas administrativas (geração de códigos) precisam de JWT + role admin.
// Demais rotas: /validate e /sync passam a aceitar auth-via-código também.
router.use((req, res, next) => {
  // Rotas que aceitam auth-via-código (extensão) — autenticam manualmente abaixo.
  if (req.path === '/validate' || req.path === '/sync') return next();
  return authenticate(req, res, next);
});

/**
 * GET /api/v1/subscription
 * Retorna estado atual da assinatura
 */
router.get('/', asyncHandler(async (req, res) => {
  const ws = db.get(
    `SELECT id, name, plan, trial_end_at, subscription_status,
            next_billing_at, payment_provider, payment_customer_id, credits
     FROM workspaces WHERE id = ?`,
    [req.workspaceId]
  );

  if (!ws) throw new AppError('Workspace not found', 404);

  // Estado calculado
  const now = Date.now();
  const trialEnd = ws.trial_end_at ? new Date(ws.trial_end_at).getTime() : null;
  const isInTrial = trialEnd && trialEnd > now && ws.subscription_status === 'trialing';
  const trialDaysLeft = isInTrial ? Math.ceil((trialEnd - now) / 86400000) : 0;

  res.json({
    subscription: {
      plan: ws.plan,
      status: ws.subscription_status || 'trialing',
      trial_end_at: ws.trial_end_at,
      next_billing_at: ws.next_billing_at,
      payment_method: ws.payment_provider ? {
        provider: ws.payment_provider,
        customer_id: ws.payment_customer_id,
      } : null,
      is_in_trial: isInTrial,
      trial_days_left: trialDaysLeft,
      credits: ws.credits,
    },
  });
}));

/**
 * POST /api/v1/subscription/cancel
 * Cancela a assinatura. Acesso mantido até fim do período pago.
 * Apenas owner pode cancelar.
 */
router.post('/cancel',
  authorize('owner'),
  asyncHandler(async (req, res) => {
    const ws = db.get(
      `SELECT subscription_status, plan, next_billing_at FROM workspaces WHERE id = ?`,
      [req.workspaceId]
    );
    if (!ws) throw new AppError('Workspace not found', 404);

    if (ws.subscription_status === 'canceled') {
      throw new AppError('Assinatura já está cancelada', 400);
    }

    db.run(
      `UPDATE workspaces SET subscription_status = 'canceling',
                              updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [req.workspaceId]
    );

    logger.info(`[Subscription] Cancel requested for workspace ${req.workspaceId} by user ${req.userId}`);

    // Notificação opcional
    try {
      const alertManager = require('../observability/alertManager');
      alertManager.send('warning', '⚠️ Cancelamento solicitado', {
        workspace_id: req.workspaceId,
        plan: ws.plan,
      });
    } catch (_) {}

    res.json({
      success: true,
      message: ws.next_billing_at
        ? `Assinatura cancelada. Acesso mantido até ${new Date(ws.next_billing_at).toLocaleDateString('pt-BR')}.`
        : 'Assinatura cancelada. Acesso mantido até o fim do trial.',
      new_status: 'canceling',
    });
  })
);

/**
 * POST /api/v1/subscription/reactivate
 * Reativa uma assinatura que estava com status 'canceling' ou 'canceled'
 */
router.post('/reactivate',
  authorize('owner'),
  asyncHandler(async (req, res) => {
    const ws = db.get(
      `SELECT subscription_status FROM workspaces WHERE id = ?`,
      [req.workspaceId]
    );
    if (!ws) throw new AppError('Workspace not found', 404);

    if (!['canceling', 'canceled'].includes(ws.subscription_status)) {
      throw new AppError('Assinatura já está ativa', 400);
    }

    db.run(
      `UPDATE workspaces SET subscription_status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [req.workspaceId]
    );

    res.json({ success: true, message: 'Assinatura reativada com sucesso' });
  })
);

/**
 * POST /api/v1/subscription/change-plan
 * Troca o plano. Aplica imediatamente (proration ainda não suportado).
 */
router.post('/change-plan',
  authorize('owner'),
  asyncHandler(async (req, res) => {
    const { plan } = req.body;
    if (!['starter', 'pro', 'agency'].includes(plan)) {
      throw new AppError('Plano inválido', 400);
    }

    const ws = db.get(`SELECT plan FROM workspaces WHERE id = ?`, [req.workspaceId]);
    if (!ws) throw new AppError('Workspace not found', 404);

    if (ws.plan === plan) {
      throw new AppError(`Você já está no plano ${plan}`, 400);
    }

    db.run(
      `UPDATE workspaces SET plan = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [plan, req.workspaceId]
    );

    logger.info(`[Subscription] Plan changed: ${ws.plan} -> ${plan} for ${req.workspaceId}`);

    res.json({
      success: true,
      message: `Plano alterado para ${plan}. Próxima cobrança refletirá o novo valor.`,
      new_plan: plan,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────
// v9.3.3: rotas /validate e /sync — extensão chamava mas elas não existiam.
// Resultado: subscription-manager.js batia 404 silencioso e ficava sem
// validação/sincronização de créditos. Workspace podia gastar tokens sem
// limite porque o backend nunca confirmava saldo.
// ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/subscription/validate
 *
 * Body: { code? }
 *
 * Dois modos de auth:
 *   (a) JWT no header (fluxo SaaS web): usa req.workspaceId.
 *   (b) `code` no body (fluxo extensão sem JWT): resolve workspace_id pelo
 *       código, registra device fingerprint no primeiro uso, e nas próximas
 *       chamadas retorna 423 LOCKED se outro dispositivo tentar usar.
 *
 * Retorna 200 com { valid, reason, plan, status, credits, expires_at,
 *                   trial_days_left, code_status }
 * ou     423 LOCKED com { code: 'CODE_IN_USE_ELSEWHERE' }
 * ou     404 com       { code: 'CODE_NOT_FOUND' }
 */
router.post('/validate', asyncHandler(async (req, res) => {
  const { code: bodyCode } = req.body || {};
  let workspaceId = null;
  let codeRow = null;

  // Caminho A: JWT presente → usa workspace do token
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    await new Promise((resolve) => authenticate(req, res, (err) => {
      if (err) return resolve();
      workspaceId = req.workspaceId;
      resolve();
    }));
  }

  // Caminho B: sem JWT mas com code → resolver e fazer device binding.
  // Antes disso, checa MASTER KEY do dev — bypassa workspace, device binding
  // e qualquer outra validação. Retorna sempre enterprise/active.
  if (!workspaceId && bodyCode && isMasterKey(bodyCode)) {
    return res.json({
      valid: true,
      reason: null,
      plan: 'enterprise',
      status: 'active',
      credits: 999999,
      expires_at: null,
      trial_days_left: 0,
      code_status: 'master',
      isMasterKey: true
    });
  }

  if (!workspaceId && bodyCode) {
    codeRow = lookupCode(bodyCode);
    if (!codeRow) {
      return res.status(404).json({
        valid: false,
        code: 'CODE_NOT_FOUND',
        reason: 'invalid_code',
        message: 'Código de assinatura inválido.'
      });
    }
    if (codeRow.status === 'revoked') {
      return res.status(403).json({
        valid: false,
        code: 'CODE_REVOKED',
        reason: 'code_revoked',
        message: 'Este código foi revogado pelo administrador.'
      });
    }
    const codeExpires = codeRow.expires_at ? new Date(codeRow.expires_at).getTime() : null;
    if (codeExpires && codeExpires < Date.now()) {
      return res.status(403).json({
        valid: false,
        code: 'CODE_EXPIRED',
        reason: 'code_expired',
        message: 'Código de assinatura expirou.'
      });
    }

    // Device binding — primeira ativação grava fingerprint; demais validam.
    const fp = deviceIdHash(req);
    if (!codeRow.device_id_hash) {
      db.run(
        `UPDATE subscription_codes
            SET device_id_hash = ?, activated_at = datetime('now'), status = 'active'
          WHERE code = ?`,
        [fp, codeRow.code]
      );
      logger.info(`[Subscription] Code ${codeRow.code} bound to first device`);
    } else if (codeRow.device_id_hash !== fp) {
      return res.status(423).json({
        valid: false,
        code: 'CODE_IN_USE_ELSEWHERE',
        reason: 'in_use_elsewhere',
        message: 'Este código já está em uso em outro dispositivo. Acesse o painel da assinatura para desvincular antes de usar aqui.'
      });
    }
    workspaceId = codeRow.workspace_id;
  }

  if (!workspaceId) {
    return res.status(401).json({
      valid: false,
      code: 'NO_AUTH',
      reason: 'missing_auth',
      message: 'Forneça um token de login OU um código de assinatura.'
    });
  }

  const ws = db.get(
    `SELECT id, plan, subscription_status, trial_end_at, next_billing_at, credits
     FROM workspaces WHERE id = ?`,
    [workspaceId]
  );

  if (!ws) throw new AppError('Workspace not found', 404);

  const now = Date.now();
  const trialEndAt = ws.trial_end_at ? new Date(ws.trial_end_at).getTime() : null;
  const nextBillingAt = ws.next_billing_at ? new Date(ws.next_billing_at).getTime() : null;

  // Validar status
  let valid = false;
  let reason = null;
  if (ws.subscription_status === 'active') {
    valid = true;
  } else if (ws.subscription_status === 'trialing') {
    valid = !!(trialEndAt && trialEndAt > now);
    if (!valid) reason = 'trial_expired';
  } else if (ws.subscription_status === 'canceling' ||
             ws.subscription_status === 'cancelled' ||
             ws.subscription_status === 'canceled') {
    // Mantém acesso até fim do período pago
    valid = !!(nextBillingAt && nextBillingAt > now);
    if (!valid) reason = 'subscription_cancelled';
  } else {
    reason = `status_${ws.subscription_status}`;
  }

  const trialDaysLeft = (trialEndAt && trialEndAt > now)
    ? Math.ceil((trialEndAt - now) / 86400000)
    : 0;

  res.json({
    valid,
    reason,
    plan: ws.plan,
    status: ws.subscription_status,
    credits: ws.credits || 0,
    expires_at: nextBillingAt || trialEndAt || null,
    trial_days_left: trialDaysLeft,
    code_status: codeRow ? codeRow.status : null,
  });
}));

/**
 * POST /api/v1/subscription/sync
 *
 * Body: { code?, usage, credits }
 *   usage:   { tokens_used, ai_requests, ... } — telemetria do cliente
 *   credits: número que cliente acha que tem (servidor é fonte da verdade)
 *
 * Retorna estado consolidado do servidor.
 */
router.post('/sync', asyncHandler(async (req, res) => {
  const { code: bodyCode, usage = {}, credits: clientCredits } = req.body || {};
  let workspaceId = null;

  // Master key — sync sempre retorna enterprise ativo, sem tocar no banco.
  if (bodyCode && isMasterKey(bodyCode)) {
    return res.json({
      success: true,
      plan: 'enterprise',
      status: 'active',
      credits: 999999,
      trial_end_at: null,
      next_billing_at: null,
      server_authoritative: true,
      isMasterKey: true
    });
  }

  // Auth: JWT OU código (mesmo critério de /validate)
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    await new Promise((resolve) => authenticate(req, res, (err) => {
      if (err) return resolve();
      workspaceId = req.workspaceId;
      resolve();
    }));
  }
  if (!workspaceId && bodyCode) {
    const codeRow = lookupCode(bodyCode);
    if (!codeRow) return res.status(404).json({ success: false, code: 'CODE_NOT_FOUND' });
    if (codeRow.status === 'revoked') {
      return res.status(403).json({ success: false, code: 'CODE_REVOKED' });
    }
    const fp = deviceIdHash(req);
    if (codeRow.device_id_hash && codeRow.device_id_hash !== fp) {
      return res.status(423).json({ success: false, code: 'CODE_IN_USE_ELSEWHERE' });
    }
    workspaceId = codeRow.workspace_id;
  }
  if (!workspaceId) {
    return res.status(401).json({ success: false, code: 'NO_AUTH' });
  }

  const ws = db.get(
    `SELECT id, plan, subscription_status, credits, trial_end_at, next_billing_at
     FROM workspaces WHERE id = ?`,
    [workspaceId]
  );

  if (!ws) throw new AppError('Workspace not found', 404);

  // Servidor é fonte da verdade pra credits — cliente só recebe atualização
  // (usamos `usage` apenas pra telemetria, não atualizamos credits a partir dele
  // pra evitar manipulação client-side).

  // Telemetria: registra usage no analytics_events se houver
  if (usage && Object.keys(usage).length > 0) {
    try {
      db.run(
        `INSERT INTO analytics_events (id, workspace_id, event_type, event_data, created_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          crypto.randomUUID(),
          workspaceId,
          'subscription.usage_sync',
          JSON.stringify({ usage, client_credits: clientCredits })
        ]
      );
    } catch (e) {
      // Telemetria não-crítica, não trava sync
      logger.debug('[Subscription] Failed to log usage telemetry:', e.message);
    }
  }

  res.json({
    success: true,
    plan: ws.plan,
    status: ws.subscription_status,
    credits: ws.credits || 0,
    trial_end_at: ws.trial_end_at,
    next_billing_at: ws.next_billing_at,
    server_authoritative: true,
  });
}));

// ─────────────────────────────────────────────────────────────────────
// Códigos de assinatura — geração, listagem, revogação, desbind
// Todas exigem JWT + role admin (autorizado pelo router.use(authenticate)
// e pelo authorize('admin') em cada rota).
// ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/subscription/codes
 * Body: { workspace_id, plan?, expires_at?, notes? }
 * Cria um novo código de assinatura. Disparado após cobrança bem-sucedida
 * (ex: webhook de pagamento) — depois enviado por email ao cliente.
 */
router.post('/codes', authorize('admin'), asyncHandler(async (req, res) => {
  const { workspace_id, plan = 'starter', expires_at = null, notes = null } = req.body || {};
  if (!workspace_id) throw new AppError('workspace_id obrigatório', 400);
  if (!['starter', 'pro', 'enterprise'].includes(plan)) {
    throw new AppError('Plano inválido', 400);
  }
  const ws = db.get('SELECT id FROM workspaces WHERE id = ?', [workspace_id]);
  if (!ws) throw new AppError('Workspace não encontrado', 404);

  // Tenta até 3x evitar colisão (probabilidade ínfima mas defensivo)
  let code = null;
  for (let i = 0; i < 3; i++) {
    const candidate = generateSubscriptionCode();
    const existing = db.get('SELECT code FROM subscription_codes WHERE code = ?', [candidate]);
    if (!existing) { code = candidate; break; }
  }
  if (!code) throw new AppError('Falha ao gerar código único', 500);

  db.run(
    `INSERT INTO subscription_codes (code, workspace_id, plan, status, expires_at, notes)
     VALUES (?, ?, ?, 'unused', ?, ?)`,
    [code, workspace_id, plan, expires_at, notes]
  );
  logger.info(`[Subscription] Code generated: ${code} → workspace=${workspace_id} plan=${plan}`);

  res.status(201).json({ success: true, code, plan, workspace_id, status: 'unused' });
}));

/**
 * GET /api/v1/subscription/codes?workspace_id=...
 * Lista códigos de um workspace (admin only).
 */
router.get('/codes', authorize('admin'), asyncHandler(async (req, res) => {
  const { workspace_id } = req.query || {};
  let rows;
  if (workspace_id) {
    rows = db.all(
      `SELECT code, workspace_id, plan, status, device_id_hash, activated_at,
              revoked_at, created_at, expires_at, notes
       FROM subscription_codes WHERE workspace_id = ? ORDER BY created_at DESC`,
      [workspace_id]
    );
  } else {
    rows = db.all(
      `SELECT code, workspace_id, plan, status, device_id_hash, activated_at,
              revoked_at, created_at, expires_at, notes
       FROM subscription_codes ORDER BY created_at DESC LIMIT 200`
    );
  }
  res.json({ codes: rows || [] });
}));

/**
 * POST /api/v1/subscription/codes/:code/revoke
 * Marca código como revogado. Próximo /validate retorna 403 CODE_REVOKED.
 */
router.post('/codes/:code/revoke', authorize('admin'), asyncHandler(async (req, res) => {
  const code = String(req.params.code || '').trim();
  const row = db.get('SELECT code FROM subscription_codes WHERE code = ?', [code]);
  if (!row) throw new AppError('Código não encontrado', 404);
  db.run(
    `UPDATE subscription_codes SET status = 'revoked', revoked_at = datetime('now') WHERE code = ?`,
    [code]
  );
  logger.info(`[Subscription] Code revoked: ${code} by user=${req.userId}`);
  res.json({ success: true });
}));

/**
 * POST /api/v1/subscription/codes/:code/unbind
 * Zera o device_id_hash do código pra que ele possa ser usado em um novo
 * dispositivo. Usado quando o usuário troca de máquina — chama do painel web.
 */
router.post('/codes/:code/unbind', asyncHandler(async (req, res) => {
  // Autenticação por JWT do dono OU por role admin.
  await new Promise((resolve) => authenticate(req, res, () => resolve()));
  if (!req.userId) return res.status(401).json({ error: 'NO_AUTH' });

  const code = String(req.params.code || '').trim();
  const row = db.get(
    'SELECT code, workspace_id FROM subscription_codes WHERE code = ?',
    [code]
  );
  if (!row) throw new AppError('Código não encontrado', 404);

  const isAdmin = req.user?.role === 'admin';
  const ownsWorkspace = req.workspaceId === row.workspace_id;
  if (!isAdmin && !ownsWorkspace) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  db.run(
    `UPDATE subscription_codes
        SET device_id_hash = NULL,
            status = CASE WHEN status='revoked' THEN status ELSE 'unused' END
      WHERE code = ?`,
    [code]
  );
  logger.info(`[Subscription] Code unbound: ${code} by user=${req.userId}`);
  res.json({ success: true });
}));

module.exports = router;
