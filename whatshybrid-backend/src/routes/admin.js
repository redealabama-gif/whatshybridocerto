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
