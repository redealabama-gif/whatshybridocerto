/**
 * 📊 Operational Metrics Routes
 *
 * Endpoints simples para você ver o que está acontecendo em produção.
 * Não é Prometheus — é JSON legível com curl ou navegador.
 *
 * Endpoints:
 *   GET  /metrics/system          → CPU, RAM, uptime, requests count (público)
 *   GET  /metrics/health-deep     → health check completo: DB + Redis + providers
 *   GET  /metrics/tenants         → resumo por tenant (admin only)
 *   GET  /metrics/tenant/:id      → drill-down em um tenant específico (admin only)
 *   GET  /metrics/cost            → custo estimado de IA por tenant (admin only)
 *   GET  /metrics/errors          → últimos N erros (admin only)
 *
 * @version 1.0.0
 */

'use strict';

const express = require('express');
const router = express.Router();
const os = require('os');
const db = require('../utils/database');
const logger = require('../utils/logger');
const { authenticate } = require('../middleware/auth');

// ── Preço por 1k tokens (USD) — usado para estimativa de custo ────────────
// Atualize quando a OpenAI/Anthropic mudar preços.
const TOKEN_PRICING = {
  // OpenAI
  'gpt-4o':              { input: 0.0025,  output: 0.01    },
  'gpt-4o-mini':         { input: 0.00015, output: 0.0006  },
  'gpt-4-turbo':         { input: 0.01,    output: 0.03    },
  'gpt-3.5-turbo':       { input: 0.0005,  output: 0.0015  },
  // Anthropic
  'claude-3-5-sonnet':   { input: 0.003,   output: 0.015   },
  'claude-3-haiku':      { input: 0.00025, output: 0.00125 },
  'claude-3-opus':       { input: 0.015,   output: 0.075   },
  // Groq
  'llama-3.1-70b':       { input: 0.00059, output: 0.00079 },
  'llama-3.1-8b':        { input: 0.00005, output: 0.00008 },
  // Default fallback
  'default':             { input: 0.001,   output: 0.003   },
};

function calculateCost(model, promptTokens, completionTokens) {
  const key = Object.keys(TOKEN_PRICING).find(k => model && model.includes(k)) || 'default';
  const p = TOKEN_PRICING[key];
  return {
    input_cost_usd: (promptTokens / 1000) * p.input,
    output_cost_usd: (completionTokens / 1000) * p.output,
    total_cost_usd: ((promptTokens / 1000) * p.input) + ((completionTokens / 1000) * p.output),
    pricing_model: key,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Middleware de autenticação admin (só owner/admin acessam métricas detalhadas)
// ────────────────────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ────────────────────────────────────────────────────────────────────────────
// /metrics/system — público, retorna estado do servidor
// ────────────────────────────────────────────────────────────────────────────
router.get('/system', (req, res) => {
  const memUsage = process.memoryUsage();
  const cpuLoad = os.loadavg();

  res.json({
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    node_version: process.version,
    pid: process.pid,
    memory: {
      heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024 * 10) / 10,
      heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024 * 10) / 10,
      rss_mb: Math.round(memUsage.rss / 1024 / 1024 * 10) / 10,
      external_mb: Math.round(memUsage.external / 1024 / 1024 * 10) / 10,
    },
    system: {
      total_mem_gb: Math.round(os.totalmem() / 1024 / 1024 / 1024 * 10) / 10,
      free_mem_gb: Math.round(os.freemem() / 1024 / 1024 / 1024 * 10) / 10,
      used_mem_percent: Math.round((1 - os.freemem() / os.totalmem()) * 100),
      cpu_load_1m: cpuLoad[0],
      cpu_load_5m: cpuLoad[1],
      cpu_load_15m: cpuLoad[2],
      cpu_count: os.cpus().length,
      platform: os.platform(),
    },
  });
});

// ────────────────────────────────────────────────────────────────────────────
// /metrics/health-deep — verifica TUDO: DB, Redis, Orchestrator, providers
// ────────────────────────────────────────────────────────────────────────────
router.get('/health-deep', async (req, res) => {
  const checks = {};
  let allOk = true;

  // ── DB ──
  try {
    const result = db.get('SELECT 1 as ok');
    checks.database = {
      status: result?.ok === 1 ? 'ok' : 'error',
      type: 'sqlite',
    };
    if (result?.ok !== 1) allOk = false;
  } catch (err) {
    checks.database = { status: 'error', error: err.message };
    allOk = false;
  }

  // ── Tabelas críticas ──
  try {
    const tables = db.all(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','workspaces','ai_conversations','interaction_metadata','learning_patterns','ai_requests')"
    );
    checks.database.tables_found = tables.length;
    checks.database.tables_required = 6;
    if (tables.length < 6) {
      checks.database.status = 'degraded';
      allOk = false;
    }
  } catch (_) {}

  // ── Orchestrator Registry ──
  try {
    const orchReg = require('../registry/OrchestratorRegistry');
    const stats = orchReg.getStats();
    checks.orchestrator = {
      status: 'ok',
      active_tenants: stats.activeOrchestrators,
      max_tenants: stats.maxTenants,
      total_created: stats.totalCreated,
      total_evicted: stats.totalEvicted,
    };
  } catch (err) {
    checks.orchestrator = { status: 'error', error: err.message };
    allOk = false;
  }

  // ── AIRouter ──
  try {
    const AIRouter = require('../ai/services/AIRouterService');
    const m = AIRouter.getMetrics();
    checks.ai_router = {
      status: 'ok',
      cache_size: m.router?.cacheSize || 0,
      cache_hits: m.router?.cacheHits || 0,
      cache_misses: m.router?.cacheMisses || 0,
      providers_active: m.router?.providersActive || [],
      total_completions: m.router?.totalCompletions || 0,
      total_errors: m.router?.totalErrors || 0,
    };
  } catch (err) {
    checks.ai_router = { status: 'error', error: err.message };
    allOk = false;
  }

  // ── Redis (opcional) ──
  if (process.env.REDIS_DISABLED !== 'true') {
    try {
      // Tenta conectar ao Redis se disponível
      const Redis = require('ioredis');
      const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null, // não retry
      });
      
      const pong = await Promise.race([
        redis.ping(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))
      ]);
      
      const dbsize = await redis.dbsize();
      
      checks.redis = {
        status: pong === 'PONG' ? 'ok' : 'degraded',
        keys: dbsize,
      };
      
      redis.disconnect();
    } catch (err) {
      checks.redis = { status: 'unavailable', error: err.message };
      // Redis offline NÃO é erro crítico (rate limiter cai pra in-memory)
    }
  } else {
    checks.redis = { status: 'disabled' };
  }

  // ── Providers de IA configurados? ──
  checks.ai_providers = {
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    groq: !!process.env.GROQ_API_KEY,
    google: !!process.env.GOOGLE_API_KEY,
  };
  const providerCount = Object.values(checks.ai_providers).filter(Boolean).length;
  if (providerCount === 0) {
    allOk = false;
    checks.ai_providers.status = 'error';
    checks.ai_providers.message = 'Nenhum provider de IA configurado';
  }

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  });
});

// ────────────────────────────────────────────────────────────────────────────
// /metrics/tenants — visão geral de todos os tenants (admin only)
// ────────────────────────────────────────────────────────────────────────────
router.get('/tenants', authenticate, requireAdmin, (req, res) => {
  try {
    const tenants = db.all(`
      SELECT 
        w.id,
        w.name,
        w.plan,
        w.created_at,
        (SELECT COUNT(*) FROM users WHERE workspace_id = w.id) as users_count,
        (SELECT COUNT(*) FROM contacts WHERE workspace_id = w.id) as contacts_count,
        (SELECT COUNT(*) FROM ai_conversations WHERE workspace_id = w.id) as conversations_count,
        (SELECT COUNT(*) FROM interaction_metadata WHERE workspace_id = w.id) as interactions_count,
        (SELECT COUNT(*) FROM learning_patterns WHERE workspace_id = w.id AND status = 'graduated') as graduated_patterns,
        (SELECT COUNT(*) FROM ai_requests WHERE workspace_id = w.id AND created_at >= datetime('now', '-1 day')) as ai_requests_24h,
        (SELECT COUNT(*) FROM ai_requests WHERE workspace_id = w.id AND created_at >= datetime('now', '-7 days')) as ai_requests_7d
      FROM workspaces w
      ORDER BY ai_requests_24h DESC
    `);

    const summary = {
      total_tenants: tenants.length,
      active_24h: tenants.filter(t => t.ai_requests_24h > 0).length,
      active_7d: tenants.filter(t => t.ai_requests_7d > 0).length,
      total_interactions: tenants.reduce((s, t) => s + (t.interactions_count || 0), 0),
      total_graduated_patterns: tenants.reduce((s, t) => s + (t.graduated_patterns || 0), 0),
      by_plan: {},
    };

    // Agrupa por plano
    for (const t of tenants) {
      const plan = t.plan || 'free';
      summary.by_plan[plan] = (summary.by_plan[plan] || 0) + 1;
    }

    res.json({ summary, tenants });
  } catch (err) {
    logger.error(`[metrics/tenants] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /metrics/tenant/:id — drill-down em um tenant específico (admin only)
// ────────────────────────────────────────────────────────────────────────────
router.get('/tenant/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;

    const workspace = db.get('SELECT * FROM workspaces WHERE id = ?', [id]);
    if (!workspace) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const stats = {
      workspace,
      counts: {
        users: db.get('SELECT COUNT(*) as c FROM users WHERE workspace_id = ?', [id])?.c || 0,
        contacts: db.get('SELECT COUNT(*) as c FROM contacts WHERE workspace_id = ?', [id])?.c || 0,
        conversations: db.get('SELECT COUNT(*) as c FROM ai_conversations WHERE workspace_id = ?', [id])?.c || 0,
        interactions: db.get('SELECT COUNT(*) as c FROM interaction_metadata WHERE workspace_id = ?', [id])?.c || 0,
        learning_candidates: db.get(
          "SELECT COUNT(*) as c FROM learning_patterns WHERE workspace_id = ? AND status = 'candidate'",
          [id]
        )?.c || 0,
        learning_graduated: db.get(
          "SELECT COUNT(*) as c FROM learning_patterns WHERE workspace_id = ? AND status = 'graduated'",
          [id]
        )?.c || 0,
        learning_discarded: db.get(
          "SELECT COUNT(*) as c FROM learning_patterns WHERE workspace_id = ? AND status = 'discarded'",
          [id]
        )?.c || 0,
      },
      activity: {
        ai_requests_24h: db.get(
          "SELECT COUNT(*) as c FROM ai_requests WHERE workspace_id = ? AND created_at >= datetime('now', '-1 day')",
          [id]
        )?.c || 0,
        ai_requests_7d: db.get(
          "SELECT COUNT(*) as c FROM ai_requests WHERE workspace_id = ? AND created_at >= datetime('now', '-7 days')",
          [id]
        )?.c || 0,
        interactions_24h: db.get(
          "SELECT COUNT(*) as c FROM interaction_metadata WHERE workspace_id = ? AND created_at >= datetime('now', '-1 day')",
          [id]
        )?.c || 0,
      },
      top_patterns: db.all(`
        SELECT pattern_key, intent, status, positive_count, negative_count, total_count, response, graduated_at
        FROM learning_patterns
        WHERE workspace_id = ?
        ORDER BY total_count DESC
        LIMIT 10
      `, [id]),
      recent_interactions: db.all(`
        SELECT interaction_id, intent, question, response, created_at
        FROM interaction_metadata
        WHERE workspace_id = ?
        ORDER BY created_at DESC
        LIMIT 10
      `, [id]),
    };

    res.json(stats);
  } catch (err) {
    logger.error(`[metrics/tenant/:id] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /metrics/cost — custo estimado de IA por tenant (admin only)
// ────────────────────────────────────────────────────────────────────────────
router.get('/cost', authenticate, requireAdmin, (req, res) => {
  try {
    const period = req.query.period || '24h';
    const periodSql = period === '7d' ? "datetime('now', '-7 days')"
                    : period === '30d' ? "datetime('now', '-30 days')"
                    : "datetime('now', '-1 day')";

    // Soma tokens por tenant + modelo
    const usage = db.all(`
      SELECT 
        workspace_id,
        model,
        COUNT(*) as request_count,
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens,
        AVG(latency_ms) as avg_latency_ms,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count
      FROM ai_requests
      WHERE created_at >= ${periodSql}
      GROUP BY workspace_id, model
      ORDER BY total_completion_tokens DESC
    `);

    // Calcula custo por linha
    const enriched = usage.map(row => {
      const cost = calculateCost(row.model, row.total_prompt_tokens || 0, row.total_completion_tokens || 0);
      return {
        ...row,
        ...cost,
        error_rate: row.request_count > 0 ? row.error_count / row.request_count : 0,
      };
    });

    // Agrega por tenant
    const byTenant = {};
    let grandTotal = 0;
    for (const row of enriched) {
      if (!byTenant[row.workspace_id]) {
        byTenant[row.workspace_id] = {
          workspace_id: row.workspace_id,
          total_cost_usd: 0,
          total_requests: 0,
          total_tokens: 0,
          models: [],
        };
      }
      byTenant[row.workspace_id].total_cost_usd += row.total_cost_usd;
      byTenant[row.workspace_id].total_requests += row.request_count;
      byTenant[row.workspace_id].total_tokens += (row.total_prompt_tokens || 0) + (row.total_completion_tokens || 0);
      byTenant[row.workspace_id].models.push({
        model: row.model,
        requests: row.request_count,
        tokens_in: row.total_prompt_tokens,
        tokens_out: row.total_completion_tokens,
        cost_usd: row.total_cost_usd,
        error_rate: row.error_rate,
      });
      grandTotal += row.total_cost_usd;
    }

    res.json({
      period,
      summary: {
        total_cost_usd: Math.round(grandTotal * 10000) / 10000,
        total_cost_brl_estimate: Math.round(grandTotal * 5.5 * 10000) / 10000, // ~R$5,50/USD
        total_requests: enriched.reduce((s, r) => s + r.request_count, 0),
        total_tokens: enriched.reduce((s, r) => s + (r.total_prompt_tokens || 0) + (r.total_completion_tokens || 0), 0),
        unique_tenants: Object.keys(byTenant).length,
      },
      by_tenant: Object.values(byTenant).sort((a, b) => b.total_cost_usd - a.total_cost_usd),
      pricing_table: TOKEN_PRICING,
    });
  } catch (err) {
    logger.error(`[metrics/cost] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /metrics/errors — últimos N erros de IA por tenant (admin only)
// ────────────────────────────────────────────────────────────────────────────
router.get('/errors', authenticate, requireAdmin, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    
    const errors = db.all(`
      SELECT workspace_id, model, status, error_message, created_at, latency_ms
      FROM ai_requests
      WHERE status = 'error'
      ORDER BY created_at DESC
      LIMIT ?
    `, [limit]);

    // Agrupa por mensagem para ver padrões
    const byMessage = {};
    for (const e of errors) {
      const key = e.error_message || 'unknown';
      if (!byMessage[key]) byMessage[key] = { count: 0, last_seen: e.created_at, tenants: new Set() };
      byMessage[key].count++;
      byMessage[key].tenants.add(e.workspace_id);
    }

    res.json({
      total: errors.length,
      grouped_by_message: Object.entries(byMessage)
        .map(([msg, info]) => ({
          message: msg,
          count: info.count,
          last_seen: info.last_seen,
          unique_tenants: info.tenants.size,
        }))
        .sort((a, b) => b.count - a.count),
      recent: errors.slice(0, 20),
    });
  } catch (err) {
    logger.error(`[metrics/errors] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// /metrics/learning — saúde do pipeline de aprendizado (admin only)
// ────────────────────────────────────────────────────────────────────────────
router.get('/learning', authenticate, requireAdmin, (req, res) => {
  try {
    const stats = db.all(`
      SELECT 
        workspace_id,
        status,
        COUNT(*) as count,
        AVG(positive_count * 1.0 / NULLIF(positive_count + negative_count, 0)) as avg_positive_rate
      FROM learning_patterns
      GROUP BY workspace_id, status
    `);

    const byTenant = {};
    let totalGraduated = 0;
    let totalCandidates = 0;
    let totalDiscarded = 0;

    for (const row of stats) {
      if (!byTenant[row.workspace_id]) {
        byTenant[row.workspace_id] = { workspace_id: row.workspace_id, candidates: 0, graduated: 0, discarded: 0 };
      }
      byTenant[row.workspace_id][row.status === 'graduated' ? 'graduated' : row.status === 'candidate' ? 'candidates' : 'discarded'] = row.count;

      if (row.status === 'graduated') totalGraduated += row.count;
      else if (row.status === 'candidate') totalCandidates += row.count;
      else if (row.status === 'discarded') totalDiscarded += row.count;
    }

    res.json({
      summary: {
        total_graduated: totalGraduated,
        total_candidates: totalCandidates,
        total_discarded: totalDiscarded,
        graduation_rate: (totalGraduated + totalDiscarded) > 0
          ? totalGraduated / (totalGraduated + totalDiscarded)
          : 0,
        active_tenants: Object.keys(byTenant).length,
      },
      by_tenant: Object.values(byTenant).sort((a, b) => b.graduated - a.graduated),
    });
  } catch (err) {
    logger.error(`[metrics/learning] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
