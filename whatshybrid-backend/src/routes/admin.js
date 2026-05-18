/**
 * 🔐 Admin Routes - Painel Administrativo
 * Rotas para gerenciamento do sistema
 * 
 * TUDO AUTOMATIZADO - Admin apenas visualiza e monitora
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../utils/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { makeLikeTerm } = require('../utils/sql-helpers');
// v9.5.0 BUG #140: ../middleware/asyncHandler não existe — vive em errorHandler.
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// ============================================
// MIDDLEWARE DE ADMIN
// ============================================

// Todas as rotas de admin requerem autenticação + role admin
router.use(authenticate);
router.use(requireAdmin);

// ============================================
// DASHBOARD - MÉTRICAS GERAIS
// ============================================

router.get('/dashboard', asyncHandler(async (req, res) => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const thisMonth = now.toISOString().slice(0, 7);

  // Métricas de usuários
  const usersTotal = await db.get('SELECT COUNT(*) as count FROM subscriptions');
  const usersActive = await db.get(`
    SELECT COUNT(*) as count FROM subscriptions 
    WHERE status = 'active' OR status = 'trial'
  `);
  const usersToday = await db.get(`
    SELECT COUNT(*) as count FROM subscriptions 
    WHERE DATE(activated_at) = ?
  `, [today]);

  // Métricas de uso
  const aiRequestsToday = await db.get(`
    SELECT COUNT(*) as count FROM ai_usage_logs 
    WHERE DATE(created_at) = ?
  `, [today]);
  const aiRequestsMonth = await db.get(`
    SELECT COUNT(*) as count FROM ai_usage_logs 
    WHERE strftime('%Y-%m', created_at) = ?
  `, [thisMonth]);

  // Métricas de créditos
  const creditsConsumed = await db.get(`
    SELECT COALESCE(SUM(credits_used), 0) as total FROM ai_usage_logs 
    WHERE strftime('%Y-%m', created_at) = ?
  `, [thisMonth]);

  // Revenue (baseado em planos ativos)
  const revenue = await db.get(`
    SELECT 
      COALESCE(SUM(CASE plan_id 
        WHEN 'starter' THEN 49.90 
        WHEN 'pro' THEN 99.90 
        WHEN 'enterprise' THEN 249.90 
        ELSE 0 
      END), 0) as mrr
    FROM subscriptions 
    WHERE status = 'active'
  `);

  // Distribuição por plano
  const planDistribution = await db.all(`
    SELECT plan_id, COUNT(*) as count 
    FROM subscriptions 
    WHERE status IN ('active', 'trial')
    GROUP BY plan_id
  `);

  // Últimas ativações
  const recentActivations = await db.all(`
    SELECT code, plan_id, status, activated_at, expires_at 
    FROM subscriptions 
    ORDER BY activated_at DESC 
    LIMIT 10
  `);

  res.json({
    success: true,
    data: {
      users: {
        total: usersTotal?.count || 0,
        active: usersActive?.count || 0,
        today: usersToday?.count || 0
      },
      usage: {
        aiRequestsToday: aiRequestsToday?.count || 0,
        aiRequestsMonth: aiRequestsMonth?.count || 0,
        creditsConsumedMonth: creditsConsumed?.total || 0
      },
      revenue: {
        mrr: revenue?.mrr || 0,
        currency: 'BRL'
      },
      planDistribution: planDistribution || [],
      recentActivations: recentActivations || []
    }
  });
}));

// ============================================
// USUÁRIOS / ASSINATURAS
// ============================================

router.get('/subscriptions', asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, status, plan_id, search } = req.query;
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM subscriptions WHERE 1=1';
  const params = [];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  if (plan_id) {
    query += ' AND plan_id = ?';
    params.push(plan_id);
  }

  if (search) {
    // v9.3.7: makeLikeTerm
    const term = makeLikeTerm(search);
    if (term) {
      query += ` AND (code LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')`;
      params.push(term, term);
    }
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const subscriptions = await db.all(query, params);
  const total = await db.get('SELECT COUNT(*) as count FROM subscriptions');

  res.json({
    success: true,
    data: subscriptions,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: total?.count || 0,
      pages: Math.ceil((total?.count || 0) / limit)
    }
  });
}));

router.get('/subscriptions/:code', asyncHandler(async (req, res) => {
  const { code } = req.params;

  const subscription = await db.get('SELECT * FROM subscriptions WHERE code = ?', [code]);
  if (!subscription) {
    return res.status(404).json({ success: false, error: 'Assinatura não encontrada' });
  }

  // Histórico de uso
  const usageHistory = await db.all(`
    SELECT DATE(created_at) as date, 
           SUM(credits_used) as credits,
           COUNT(*) as requests
    FROM ai_usage_logs 
    WHERE subscription_code = ?
    GROUP BY DATE(created_at)
    ORDER BY date DESC
    LIMIT 30
  `, [code]);

  res.json({
    success: true,
    data: {
      subscription,
      usageHistory
    }
  });
}));

// Reenviar código por email (suporte)
router.post('/subscriptions/:code/resend-email', asyncHandler(async (req, res) => {
  const { code } = req.params;

  const subscription = await db.get('SELECT * FROM subscriptions WHERE code = ?', [code]);
  if (!subscription) {
    return res.status(404).json({ success: false, error: 'Assinatura não encontrada' });
  }

  // Aqui você integraria com seu serviço de email
  // Por enquanto, apenas loga
  logger.info(`[Admin] Reenvio de código solicitado: ${code} para ${subscription.email}`);

  // TODO: Integrar com SendGrid/SES/etc
  // await emailService.send({
  //   to: subscription.email,
  //   subject: 'Seu código WhatsHybrid',
  //   template: 'subscription-code',
  //   data: { code, plan: subscription.plan_id }
  // });

  res.json({ success: true, message: 'Email de reenvio agendado' });
}));

// ============================================
// API KEYS - GESTÃO DO POOL
// ============================================

router.get('/api-keys', asyncHandler(async (req, res) => {
  const keys = await db.all(`
    SELECT 
      id,
      provider,
      SUBSTR(api_key, 1, 8) || '...' || SUBSTR(api_key, -4) as masked_key,
      usage_count,
      error_count,
      last_used,
      status,
      created_at
    FROM api_keys
    ORDER BY provider, created_at
  `);

  // Agrupar por provider
  const grouped = {};
  for (const key of keys) {
    if (!grouped[key.provider]) {
      grouped[key.provider] = [];
    }
    grouped[key.provider].push(key);
  }

  res.json({ success: true, data: grouped });
}));

router.post('/api-keys', asyncHandler(async (req, res) => {
  const { provider, api_key } = req.body;

  if (!provider || !api_key) {
    return res.status(400).json({ success: false, error: 'Provider e API key são obrigatórios' });
  }

  const id = `key_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  await db.run(`
    INSERT INTO api_keys (id, provider, api_key, usage_count, error_count, status, created_at)
    VALUES (?, ?, ?, 0, 0, 'active', datetime('now'))
  `, [id, provider, api_key]);

  logger.info(`[Admin] Nova API key adicionada: ${provider}`);

  res.json({ success: true, id });
}));

router.delete('/api-keys/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  await db.run('DELETE FROM api_keys WHERE id = ?', [id]);

  logger.info(`[Admin] API key removida: ${id}`);

  res.json({ success: true });
}));

router.patch('/api-keys/:id/status', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['active', 'paused', 'disabled'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Status inválido' });
  }

  await db.run('UPDATE api_keys SET status = ? WHERE id = ?', [status, id]);

  res.json({ success: true });
}));

// ============================================
// CONFIGURAÇÕES
// ============================================

router.get('/settings', asyncHandler(async (req, res) => {
  const settings = await db.all('SELECT key, value FROM admin_settings');
  
  const settingsObj = {};
  for (const s of settings) {
    try {
      settingsObj[s.key] = JSON.parse(s.value);
    } catch {
      settingsObj[s.key] = s.value;
    }
  }

  res.json({ success: true, data: settingsObj });
}));

router.put('/settings', asyncHandler(async (req, res) => {
  const settings = req.body;

  for (const [key, value] of Object.entries(settings)) {
    const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
    
    await db.run(`
      INSERT INTO admin_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
    `, [key, valueStr, valueStr]);
  }

  logger.info('[Admin] Configurações atualizadas');

  res.json({ success: true });
}));

// ============================================
// LOGS E MÉTRICAS
// ============================================

router.get('/logs/ai', asyncHandler(async (req, res) => {
  const { page = 1, limit = 100, provider, date } = req.query;
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM ai_usage_logs WHERE 1=1';
  const params = [];

  if (provider) {
    query += ' AND provider = ?';
    params.push(provider);
  }

  if (date) {
    query += ' AND DATE(created_at) = ?';
    params.push(date);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const logs = await db.all(query, params);

  res.json({ success: true, data: logs });
}));

router.get('/logs/errors', asyncHandler(async (req, res) => {
  const errors = await db.all(`
    SELECT * FROM error_logs 
    ORDER BY created_at DESC 
    LIMIT 100
  `);

  res.json({ success: true, data: errors });
}));

router.get('/metrics/hourly', asyncHandler(async (req, res) => {
  const metrics = await db.all(`
    SELECT 
      strftime('%Y-%m-%d %H:00', created_at) as hour,
      COUNT(*) as requests,
      SUM(credits_used) as credits,
      AVG(latency_ms) as avg_latency
    FROM ai_usage_logs
    WHERE created_at >= datetime('now', '-24 hours')
    GROUP BY hour
    ORDER BY hour
  `);

  res.json({ success: true, data: metrics });
}));

router.get('/metrics/providers', asyncHandler(async (req, res) => {
  const metrics = await db.all(`
    SELECT 
      provider,
      COUNT(*) as total_requests,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
      AVG(latency_ms) as avg_latency,
      SUM(credits_used) as total_credits
    FROM ai_usage_logs
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY provider
  `);

  res.json({ success: true, data: metrics });
}));

// ============================================
// BILLING / COST INTELLIGENCE
// ============================================

/**
 * GET /admin/billing/high-spenders
 *
 * Top workspaces por gasto USD em janela configurável. Serve pra detectar:
 *   - cliente abusivo (gasto 100× a média do plano)
 *   - bug do cliente (loop chamando IA em background)
 *   - upsell opportunity (cliente Pro consumindo como Agency)
 *
 * Query params:
 *   ?window=24h|7d|30d   (default 7d)
 *   ?limit=N             (default 20, max 100)
 *
 * Lê de llm_cost_log (populado pelo CostLoggerService a cada AI call).
 * Junta com workspaces pra dar nome + plano. Custo USD é REAL (calculado
 * no momento da request com a pricing table da OpenAI/Groq).
 */
router.get('/billing/high-spenders', asyncHandler(async (req, res) => {
  const windowMap = { '24h': 1, '7d': 7, '30d': 30 };
  const windowKey = String(req.query.window || '7d');
  const days = windowMap[windowKey];
  if (!days) {
    return res.status(400).json({ error: 'window inválido. Use 24h, 7d ou 30d.' });
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  let rows = [];
  try {
    rows = db.all(
      `SELECT
          w.id              AS workspace_id,
          w.name            AS workspace_name,
          w.plan,
          w.subscription_status,
          COUNT(c.id)       AS request_count,
          SUM(c.total_tokens)  AS tokens_total,
          SUM(c.cost_usd)      AS cost_usd_total,
          AVG(c.latency_ms)    AS latency_ms_avg,
          MAX(c.created_at)    AS last_request_at
        FROM llm_cost_log c
        JOIN workspaces w ON w.id = c.workspace_id
       WHERE c.created_at >= ?
       GROUP BY w.id, w.name, w.plan, w.subscription_status
       ORDER BY cost_usd_total DESC
       LIMIT ?`,
      [since, limit]
    ) || [];
  } catch (err) {
    logger.error('[Admin] high-spenders query falhou:', err.message);
    throw err;
  }

  // Quota expected per plan (matched from TokenService.PLAN_TOKENS).
  // Não é binding — só pra calcular % consumido vs cota teórica e flagear
  // outliers ("Pro gastando como Agency" indica upsell ou abuso).
  const planQuota = {
    free: 0, starter: 50000, pro: 500000, agency: 5000000, enterprise: 999000000
  };

  const enriched = rows.map(r => {
    const quota = planQuota[r.plan] || 0;
    const pctOfQuota = quota > 0 ? (Number(r.tokens_total) / quota) * 100 : null;
    return {
      ...r,
      cost_usd_total: Number(r.cost_usd_total || 0),
      tokens_total: Number(r.tokens_total || 0),
      latency_ms_avg: r.latency_ms_avg ? Math.round(r.latency_ms_avg) : null,
      pct_of_quota: pctOfQuota !== null ? Number(pctOfQuota.toFixed(1)) : null,
      flag: pctOfQuota === null ? null
            : pctOfQuota > 80 ? 'near_quota'
            : pctOfQuota > 150 ? 'over_quota'
            : null,
    };
  });

  res.json({
    window: windowKey,
    since,
    total_workspaces: enriched.length,
    high_spenders: enriched,
  });
}));

/**
 * GET /admin/billing/dunning-queue
 *
 * Workspaces em dunning ativo (past_due) com idade e qual tentativa
 * já foi enviada. Dá visibilidade do funil pre-suspensão pro operador.
 */
router.get('/billing/dunning-queue', asyncHandler(async (req, res) => {
  let rows = [];
  try {
    rows = db.all(
      `SELECT id              AS workspace_id,
              name            AS workspace_name,
              plan,
              past_due_since,
              dunning_attempts,
              last_dunning_at
         FROM workspaces
        WHERE subscription_status = 'past_due'
        ORDER BY past_due_since ASC`
    ) || [];
  } catch (err) {
    logger.error('[Admin] dunning-queue query falhou:', err.message);
    throw err;
  }

  const now = Date.now();
  const enriched = rows.map(r => {
    const since = r.past_due_since ? new Date(r.past_due_since).getTime() : null;
    const ageDays = since ? Math.floor((now - since) / 86400000) : null;
    return {
      ...r,
      age_days: ageDays,
      next_action: ageDays === null ? 'unknown'
                   : ageDays >= 7 ? 'suspend (próximo cron)'
                   : ageDays >= 3 ? `tentativa ${Math.min((r.dunning_attempts || 0) + 1, 3)}/3`
                   : ageDays >= 1 ? 'tentativa 1/3'
                   : 'aguardando dia 1',
    };
  });

  res.json({
    total: enriched.length,
    queue: enriched,
  });
}));

/**
 * POST /admin/billing/stripe/backfill-retry-settings
 *
 * Aplica payment_settings={save_default_payment_method:'on_subscription'}
 * em todas as subscriptions Stripe ativas que foram criadas ANTES da
 * v9.6.x. Sem isso, retries automáticos do Stripe não funcionam (faltam
 * default payment method salvo).
 *
 * Idempotente — Stripe aceita PUT múltiplo. Roda 1× depois de deploy
 * pra cobrir base existente. Novas subscriptions criadas via
 * createCheckoutSession (v9.6.x+) já saem com os settings corretos.
 *
 * Body opcional: { workspaceId: "uuid" } pra rodar em um workspace só
 * (debug). Sem body = roda em todos os workspaces ativos com Stripe.
 *
 * Response: { total, updated, skipped, errors: [...] }
 */
router.post('/billing/stripe/backfill-retry-settings', asyncHandler(async (req, res) => {
  const stripeService = require('../services/StripeService');
  if (!stripeService.isConfigured?.()) {
    return res.status(503).json({ error: 'Stripe não configurado (STRIPE_SECRET_KEY ausente)' });
  }

  const filterWs = req.body?.workspaceId;
  let rows = [];
  try {
    rows = filterWs
      ? db.all(
          `SELECT id, name, stripe_subscription_id FROM workspaces
            WHERE id = ? AND stripe_subscription_id IS NOT NULL`,
          [filterWs]
        ) || []
      : db.all(
          `SELECT id, name, stripe_subscription_id FROM workspaces
            WHERE stripe_subscription_id IS NOT NULL
              AND subscription_status IN ('active', 'past_due')`
        ) || [];
  } catch (err) {
    logger.error('[Admin] backfill-retry-settings query falhou:', err.message);
    throw err;
  }

  const result = { total: rows.length, updated: 0, skipped: 0, errors: [] };

  for (const ws of rows) {
    try {
      const r = await stripeService.ensureRetrySettings(ws.stripe_subscription_id);
      if (r.ok) {
        result.updated++;
      } else {
        result.skipped++;
        result.errors.push({
          workspace_id: ws.id,
          subscription_id: ws.stripe_subscription_id,
          status: r.status,
          error: r.error,
        });
      }
    } catch (e) {
      result.skipped++;
      result.errors.push({
        workspace_id: ws.id,
        subscription_id: ws.stripe_subscription_id,
        error: e.message,
      });
    }
  }

  logger.info(`[Admin] Stripe backfill: ${result.updated}/${result.total} updated, ${result.skipped} skipped`);
  res.json(result);
}));

/**
 * GET /admin/billing/dunning/charges
 *
 * Histórico paginado de tentativas de cobrança feitas pelo dunning.
 *
 * Query params:
 *   ?workspaceId=uuid      → filtra por workspace (default: todos)
 *   ?status=declined|paid|... → filtra por charge_status
 *   ?okOnly=true|false     → só sucessos ou só falhas
 *   ?limit=N (max 200, default 50)
 *   ?offset=N (default 0)
 *
 * Útil pra responder "por que esse workspace foi suspenso?" sem precisar
 * vasculhar logs. JOIN com workspaces pra trazer nome/plano.
 */
router.get('/billing/dunning/charges', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const filters = [];
  const params = [];
  if (req.query.workspaceId) {
    filters.push('d.workspace_id = ?');
    params.push(String(req.query.workspaceId));
  }
  if (req.query.status) {
    filters.push('d.charge_status = ?');
    params.push(String(req.query.status));
  }
  if (req.query.okOnly === 'true') filters.push('d.ok = 1');
  else if (req.query.okOnly === 'false') filters.push('d.ok = 0');

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  let rows = [];
  try {
    rows = db.all(
      `SELECT d.id,
              d.workspace_id,
              w.name              AS workspace_name,
              w.plan,
              w.subscription_status,
              d.provider,
              d.provider_subscription_id,
              d.attempt_number,
              d.past_due_age_days,
              d.charge_method,
              d.charge_status,
              d.ok,
              d.error_message,
              d.created_at
         FROM dunning_charge_attempts d
         LEFT JOIN workspaces w ON w.id = d.workspace_id
         ${where}
        ORDER BY d.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ) || [];
  } catch (err) {
    logger.error('[Admin] dunning/charges query falhou:', err.message);
    throw err;
  }

  // Total pra paginação
  let total = 0;
  try {
    const totalRow = db.get(
      `SELECT COUNT(*) AS c FROM dunning_charge_attempts d ${where}`,
      params
    );
    total = Number(totalRow?.c || 0);
  } catch (_) { /* não bloqueia */ }

  res.json({
    total,
    limit,
    offset,
    charges: rows.map(r => ({ ...r, ok: !!r.ok })),
  });
}));

/**
 * GET /admin/billing/dunning/charges/:id
 *
 * Detalhe completo de uma tentativa específica, incluindo raw_response do
 * gateway (que pode ter 4KB de JSON). Separado do list pra não pesar
 * payload da listagem.
 */
router.get('/billing/dunning/charges/:id', asyncHandler(async (req, res) => {
  let row = null;
  try {
    row = db.get(
      `SELECT d.*, w.name AS workspace_name, w.plan, w.subscription_status
         FROM dunning_charge_attempts d
         LEFT JOIN workspaces w ON w.id = d.workspace_id
        WHERE d.id = ?`,
      [String(req.params.id)]
    );
  } catch (err) {
    logger.error('[Admin] dunning/charges/:id query falhou:', err.message);
    throw err;
  }
  if (!row) return res.status(404).json({ error: 'Charge attempt não encontrado' });

  // Parse raw_response (string JSON) pra objeto se possível
  let raw = null;
  if (row.raw_response) {
    try { raw = JSON.parse(row.raw_response); } catch (_) { raw = row.raw_response; }
  }

  res.json({ ...row, ok: !!row.ok, raw_response: raw });
}));

/**
 * GET /admin/billing/dunning/charges/summary
 *
 * Funil agregado: total de tentativas por status nos últimos N dias.
 * Resposta no formato {paid: N, declined: N, gone: N, ...} pra alimentar
 * dashboard de cobrança.
 *
 * ?days=N (default 30, max 365)
 */
router.get('/billing/dunning/summary', asyncHandler(async (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 365);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  let rows = [];
  try {
    rows = db.all(
      `SELECT charge_status,
              provider,
              COUNT(*) AS count,
              SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok_count
         FROM dunning_charge_attempts
        WHERE created_at >= ?
        GROUP BY charge_status, provider
        ORDER BY count DESC`,
      [since]
    ) || [];
  } catch (err) {
    logger.error('[Admin] dunning/summary query falhou:', err.message);
    throw err;
  }

  // Conta workspaces únicos no período (cobrados ao menos uma vez)
  let uniqueWorkspaces = 0;
  try {
    const r = db.get(
      `SELECT COUNT(DISTINCT workspace_id) AS c
         FROM dunning_charge_attempts
        WHERE created_at >= ?`,
      [since]
    );
    uniqueWorkspaces = Number(r?.c || 0);
  } catch (_) {}

  res.json({
    days,
    since,
    unique_workspaces: uniqueWorkspaces,
    by_status_provider: rows,
  });
}));

// ============================================
// HEALTH CHECK
// ============================================

router.get('/health', asyncHandler(async (req, res) => {
  const checks = {
    database: false,
    apiKeys: false,
    storage: false
  };

  try {
    await db.get('SELECT 1');
    checks.database = true;
  } catch (e) {
    logger.error('[Admin] Database health check failed:', e);
  }

  try {
    const keys = await db.get('SELECT COUNT(*) as count FROM api_keys WHERE status = "active"');
    checks.apiKeys = keys?.count > 0;
  } catch (e) {
    logger.error('[Admin] API keys health check failed:', e);
  }

  checks.storage = true; // SQLite é local

  const healthy = Object.values(checks).every(v => v);

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    status: healthy ? 'healthy' : 'unhealthy',
    checks,
    timestamp: new Date().toISOString()
  });
}));

module.exports = router;
