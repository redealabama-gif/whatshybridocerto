/**
 * Selector Telemetry — v9.2.0
 *
 * Recebe telemetria da extensão quando um seletor do WhatsApp Web falha.
 * Aggrega por (selector_name, wa_version, extension_version) pra gerar
 * dashboard de "qual seletor está quebrando em qual versão do WhatsApp".
 *
 * A extensão chama este endpoint dentro do wrapper safeStoreAccess().
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const { body } = require('express-validator');

const db = require('../utils/database');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger').logger;
const rateLimit = require('express-rate-limit');

// Rate limit pra evitar spam (a extensão pode reportar muito)
const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // 30 reports por minuto por IP
  standardHeaders: true,
});

/**
 * POST /api/v1/telemetry/selector-failure
 * Auth opcional (se logged, registra workspace)
 */
router.post('/selector-failure',
  reportLimiter,
  [
    body('selector_name').isString().isLength({ max: 100 }),
    body('wa_version').optional().isString().isLength({ max: 50 }),
    body('extension_version').optional().isString().isLength({ max: 50 }),
    body('metadata').optional().isObject(),
  ],
  asyncHandler(async (req, res) => {
    const { selector_name, wa_version, extension_version, metadata } = req.body;

    let userId = null, workspaceId = null;
    if (req.headers.authorization) {
      try {
        const jwt = require('jsonwebtoken');
        const config = require('../../config');
        const token = req.headers.authorization.replace('Bearer ', '');
        const decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
        userId = decoded.userId;
        const u = db.get('SELECT workspace_id FROM users WHERE id = ?', [userId]);
        workspaceId = u?.workspace_id;
      } catch (_) {}
    }

    const waVer = String(wa_version || 'unknown').substring(0, 50);
    const extVer = String(extension_version || 'unknown').substring(0, 50);

    try {
      // Upsert: se já existe registro pra (selector, wa_ver, ext_ver), incrementa
      const existing = db.get(
        `SELECT id, failure_count FROM selector_telemetry
         WHERE selector_name = ? AND wa_version = ? AND extension_version = ?`,
        [selector_name, waVer, extVer]
      );

      if (existing) {
        db.run(
          `UPDATE selector_telemetry
           SET failure_count = failure_count + 1, last_seen = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [existing.id]
        );
      } else {
        db.run(
          `INSERT INTO selector_telemetry
            (id, selector_name, wa_version, extension_version, workspace_id, failure_count, metadata)
           VALUES (?, ?, ?, ?, ?, 1, ?)`,
          [
            uuidv4(),
            selector_name,
            waVer,
            extVer,
            workspaceId,
            metadata ? JSON.stringify(metadata).substring(0, 1000) : null,
          ]
        );

        // Primeiro report da combinação — pode ser break novo. Alerta.
        if (waVer !== 'unknown') {
          logger.warn(`[SelectorTelemetry] First failure: ${selector_name} (WA ${waVer}, ext ${extVer})`);
          // Alert se acontecer 5+ failures distintas em 1h
          const recentDistinct = db.get(
            `SELECT COUNT(DISTINCT selector_name) AS c FROM selector_telemetry
             WHERE wa_version = ? AND last_seen >= datetime('now', '-1 hour')`,
            [waVer]
          );
          if (recentDistinct?.c >= 5) {
            try {
              const alertManager = require('../observability/alertManager');
              alertManager?.send?.('warning',
                `⚠️ ${recentDistinct.c} seletores quebrando na WA ${waVer}`,
                { hint: 'Possível update do WhatsApp Web', wa_version: waVer });
            } catch (_) {}
          }
        }
      }
    } catch (err) {
      logger.warn(`[SelectorTelemetry] Error: ${err.message}`);
    }

    res.json({ ok: true });
  })
);

/**
 * GET /api/v1/telemetry/dashboard
 *
 * Painel para o dono da extensão saber quando o WhatsApp Web quebrou
 * alguma coisa, ANTES dos clientes começarem a reclamar. Auth-required
 * (qualquer usuário logado), retorna agregados globais — não vaza dados
 * por workspace.
 *
 * Estrutura:
 *   {
 *     summary: { total_failures, distinct_selectors, distinct_wa_versions, distinct_ext_versions, since },
 *     wa_versions:        [ { wa_version, first_seen, last_seen, distinct_selectors, total_failures } ],
 *     new_failures_24h:   [ { selector_name, wa_version, extension_version, first_seen, failure_count } ],
 *     top_offenders:      [ { selector_name, wa_version, total_failures, last_seen } ],
 *     timeline_by_day:    [ { day, total_failures, distinct_selectors } ],
 *   }
 *
 * Query params:
 *   ?days=7    (window for summary/timeline/top_offenders; default 7, max 90)
 *   ?limit=20  (top_offenders + new_failures_24h cap; default 20, max 100)
 */
router.get('/dashboard',
  authenticate,
  asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();

    try {
      const summary = db.get(
        `SELECT
           COALESCE(SUM(failure_count), 0) AS total_failures,
           COUNT(DISTINCT selector_name) AS distinct_selectors,
           COUNT(DISTINCT wa_version) AS distinct_wa_versions,
           COUNT(DISTINCT extension_version) AS distinct_ext_versions
         FROM selector_telemetry
         WHERE last_seen >= ?`,
        [since]
      ) || {};

      const waVersions = db.all(
        `SELECT wa_version,
                MIN(first_seen) AS first_seen,
                MAX(last_seen)  AS last_seen,
                COUNT(DISTINCT selector_name) AS distinct_selectors,
                SUM(failure_count) AS total_failures
         FROM selector_telemetry
         WHERE wa_version IS NOT NULL AND wa_version <> 'unknown'
         GROUP BY wa_version
         ORDER BY MAX(last_seen) DESC
         LIMIT 30`
      );

      // "Novas falhas" = combinações (selector, wa_version, ext_version) cujo
      // first_seen está nas últimas 24h. Esses são o sinal mais cedo de que
      // algo acabou de quebrar — você quer ser notificado disso.
      const newFailures = db.all(
        `SELECT selector_name, wa_version, extension_version,
                first_seen, last_seen, failure_count
         FROM selector_telemetry
         WHERE first_seen >= ?
         ORDER BY first_seen DESC
         LIMIT ?`,
        [since24h, limit]
      );

      // Top reclamações na janela informada.
      const topOffenders = db.all(
        `SELECT selector_name, wa_version,
                SUM(failure_count) AS total_failures,
                MAX(last_seen) AS last_seen
         FROM selector_telemetry
         WHERE last_seen >= ?
         GROUP BY selector_name, wa_version
         ORDER BY total_failures DESC
         LIMIT ?`,
        [since, limit]
      );

      // Timeline diária — útil pra correlacionar com deploys do WhatsApp.
      // SQLite-friendly: substr(last_seen, 1, 10) = YYYY-MM-DD.
      const timeline = db.all(
        `SELECT substr(last_seen, 1, 10) AS day,
                SUM(failure_count) AS total_failures,
                COUNT(DISTINCT selector_name) AS distinct_selectors
         FROM selector_telemetry
         WHERE last_seen >= ?
         GROUP BY day
         ORDER BY day ASC`,
        [since]
      );

      res.json({
        summary: {
          total_failures: Number(summary.total_failures || 0),
          distinct_selectors: Number(summary.distinct_selectors || 0),
          distinct_wa_versions: Number(summary.distinct_wa_versions || 0),
          distinct_ext_versions: Number(summary.distinct_ext_versions || 0),
          since,
          days,
        },
        wa_versions: waVersions || [],
        new_failures_24h: newFailures || [],
        top_offenders: topOffenders || [],
        timeline_by_day: timeline || [],
      });
    } catch (err) {
      logger.error('[TelemetryDashboard] query failed:', err.message);
      res.status(500).json({ error: 'dashboard query failed' });
    }
  })
);

/**
 * GET /api/v1/telemetry/selector-stats — admin only
 */
router.get('/selector-stats',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const hours = parseInt(req.query.hours, 10) || 24;
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    const top = db.all(
      `SELECT selector_name, wa_version, extension_version,
              SUM(failure_count) AS total_failures,
              MAX(last_seen) AS most_recent
       FROM selector_telemetry
       WHERE last_seen >= ?
       GROUP BY selector_name, wa_version, extension_version
       ORDER BY total_failures DESC
       LIMIT 50`,
      [since]
    );

    const byVersion = db.all(
      `SELECT wa_version, COUNT(DISTINCT selector_name) AS distinct_failures,
              SUM(failure_count) AS total_failures
       FROM selector_telemetry
       WHERE last_seen >= ?
       GROUP BY wa_version
       ORDER BY total_failures DESC`,
      [since]
    );

    res.json({
      since,
      hours,
      top_failures: top,
      by_wa_version: byVersion,
    });
  })
);

module.exports = router;
