/**
 * Prometheus Metrics — v9.0.0
 *
 * Expõe /metrics/prometheus para scrape de Prometheus/Grafana.
 *
 * Métricas custom:
 *   - http_request_duration_seconds (histogram)
 *   - http_requests_total (counter, por status)
 *   - ai_requests_total (counter, por provider/model/status)
 *   - tokens_consumed_total (counter, por workspace)
 *   - workspaces_active (gauge)
 *   - billing_events_total (counter, por event_type)
 *   - email_outbox_pending (gauge)
 *
 * + métricas default do Node (heap, GC, event loop, etc.)
 */

const logger = require('../utils/logger');

let promClient = null;
let registry = null;

const metrics = {
  httpDuration: null,
  httpTotal: null,
  aiRequests: null,
  tokensConsumed: null,
  workspacesActive: null,
  billingEvents: null,
  emailOutboxPending: null,
  webhookInboxPending: null,
};

function init() {
  try {
    promClient = require('prom-client');
  } catch (e) {
    logger.warn('[Prometheus] prom-client não instalado. Métricas desabilitadas.');
    logger.warn('  npm install prom-client');
    return;
  }

  registry = new promClient.Registry();
  registry.setDefaultLabels({ app: 'whatshybrid-pro', version: require('../../package.json').version });

  // Métricas default (heap, gc, event_loop, etc.)
  promClient.collectDefaultMetrics({ register: registry });

  // ── HTTP request duration ───────────────────────────────────
  metrics.httpDuration = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  });
  registry.registerMetric(metrics.httpDuration);

  metrics.httpTotal = new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
  });
  registry.registerMetric(metrics.httpTotal);

  // ── AI usage ────────────────────────────────────────────────
  metrics.aiRequests = new promClient.Counter({
    name: 'ai_requests_total',
    help: 'Total AI requests',
    labelNames: ['provider', 'model', 'status'],
  });
  registry.registerMetric(metrics.aiRequests);

  // ── Tokens ──────────────────────────────────────────────────
  metrics.tokensConsumed = new promClient.Counter({
    name: 'tokens_consumed_total',
    help: 'Total tokens consumed (in thousands of tokens)',
    labelNames: ['model', 'plan'],
  });
  registry.registerMetric(metrics.tokensConsumed);

  // ── Workspaces ──────────────────────────────────────────────
  metrics.workspacesActive = new promClient.Gauge({
    name: 'workspaces_active',
    help: 'Active workspaces (subscription_status=active)',
  });
  registry.registerMetric(metrics.workspacesActive);

  // ── Billing ─────────────────────────────────────────────────
  metrics.billingEvents = new promClient.Counter({
    name: 'billing_events_total',
    help: 'Total billing events',
    labelNames: ['event_type', 'plan'],
  });
  registry.registerMetric(metrics.billingEvents);

  // ── Queue gauges ────────────────────────────────────────────
  metrics.emailOutboxPending = new promClient.Gauge({
    name: 'email_outbox_pending',
    help: 'Pending emails in outbox',
  });
  registry.registerMetric(metrics.emailOutboxPending);

  metrics.webhookInboxPending = new promClient.Gauge({
    name: 'webhook_inbox_pending',
    help: 'Pending webhooks in inbox',
  });
  registry.registerMetric(metrics.webhookInboxPending);

  logger.info('[Prometheus] Metrics initialized');
}

/**
 * Express middleware que captura latência de cada request
 */
function middleware() {
  return (req, res, next) => {
    if (!metrics.httpDuration) return next();

    const startHr = process.hrtime();

    res.on('finish', () => {
      try {
        const route = req.route?.path || req.path.split('/').slice(0, 4).join('/');
        const labels = {
          method: req.method,
          route: route.replace(/\/[a-f0-9]{8,}/g, '/:id'), // normaliza IDs
          status: res.statusCode,
        };

        const duration = process.hrtime(startHr);
        const seconds = duration[0] + duration[1] / 1e9;

        metrics.httpDuration.observe(labels, seconds);
        metrics.httpTotal.inc(labels);
      } catch (_) {}
    });

    next();
  };
}

/**
 * Atualiza gauges periodicamente (chamado por cron)
 */
async function refreshGauges() {
  if (!metrics.workspacesActive) return;
  try {
    const db = require('../utils/database');
    const isAsync = db.driver === 'postgres';

    const wsResult = isAsync
      ? await db.get(`SELECT COUNT(*) as c FROM workspaces WHERE subscription_status = 'active'`)
      : db.get(`SELECT COUNT(*) as c FROM workspaces WHERE subscription_status = 'active'`);
    metrics.workspacesActive.set(wsResult?.c || 0);

    const emailResult = isAsync
      ? await db.get(`SELECT COUNT(*) as c FROM email_outbox WHERE status IN ('pending', 'failed')`)
      : db.get(`SELECT COUNT(*) as c FROM email_outbox WHERE status IN ('pending', 'failed')`);
    metrics.emailOutboxPending.set(emailResult?.c || 0);

    const webhookResult = isAsync
      ? await db.get(`SELECT COUNT(*) as c FROM webhook_inbox WHERE status IN ('received', 'processing', 'failed')`)
      : db.get(`SELECT COUNT(*) as c FROM webhook_inbox WHERE status IN ('received', 'processing', 'failed')`);
    metrics.webhookInboxPending.set(webhookResult?.c || 0);
  } catch (err) {
    logger.warn(`[Prometheus] refreshGauges error: ${err.message}`);
  }
}

/**
 * Endpoint Express handler
 */
async function handleMetricsRequest(req, res) {
  if (!registry) {
    return res.status(503).type('text/plain').send('# Prometheus not initialized\n');
  }
  try {
    await refreshGauges();
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (err) {
    res.status(500).type('text/plain').send(`# Error: ${err.message}\n`);
  }
}

module.exports = {
  init, middleware, handleMetricsRequest, refreshGauges, metrics,
  get registry() { return registry; },
};
