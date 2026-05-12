/**
 * Funnel Tracking — v9.0.0
 *
 * Captura eventos do funil de conversão pra análise.
 *
 * Steps:
 *   landing_view, pricing_view, signup_started, account_created,
 *   trial_activated, extension_installed, first_message_processed,
 *   payment_initiated, payment_completed, churn
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const { body } = require('express-validator');

const db = require('../utils/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const rateLimit = require('express-rate-limit');

const VALID_STEPS = [
  'landing_view',
  'pricing_view',
  'cta_clicked',
  'signup_started',
  'account_created',
  'trial_activated',
  'extension_installed',
  'first_message_processed',
  'ai_settings_configured',
  'payment_initiated',
  'payment_completed',
  'subscription_cancelled',
  'tokens_purchased',
  'first_login',
  'onboarding_completed',
  'referral_shared',
  'feedback_submitted',
];

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
});

/**
 * POST /api/v1/funnel/track
 * Não requer auth (eventos de landing antes do signup)
 */
router.post('/track',
  limiter,
  [
    body('step').isIn(VALID_STEPS),
    body('metadata').optional().isObject(),
  ],
  asyncHandler(async (req, res) => {
    const { step, metadata = {} } = req.body;

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

    try {
      db.run(
        `INSERT INTO funnel_events (id, user_id, workspace_id, step, metadata, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          userId,
          workspaceId,
          step,
          JSON.stringify(metadata).substring(0, 2000),
          req.ip,
          (req.headers['user-agent'] || '').substring(0, 300),
        ]
      );
    } catch (err) {
      logger.warn(`[Funnel] Track failed: ${err.message}`);
    }

    res.json({ ok: true });
  })
);

/**
 * GET /api/v1/funnel/stats — auth required
 * Retorna conversão entre steps nas últimas N horas
 */
const { authenticate, authorize } = require('../middleware/auth');

router.get('/stats', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const hours = parseInt(req.query.hours, 10) || 24;
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  const counts = {};
  for (const step of VALID_STEPS) {
    const r = db.get(
      'SELECT COUNT(DISTINCT user_id) AS u, COUNT(*) AS total FROM funnel_events WHERE step = ? AND created_at >= ?',
      [step, since]
    );
    counts[step] = { unique_users: r?.u || 0, total: r?.total || 0 };
  }

  // Conversion rates
  const rates = {};
  if (counts.landing_view?.unique_users > 0) {
    rates.landing_to_signup = ((counts.signup_started?.unique_users || 0) /
      counts.landing_view.unique_users * 100).toFixed(2);
    rates.signup_to_account = ((counts.account_created?.unique_users || 0) /
      Math.max(counts.signup_started?.unique_users, 1) * 100).toFixed(2);
    rates.trial_to_paid = ((counts.payment_completed?.unique_users || 0) /
      Math.max(counts.trial_activated?.unique_users, 1) * 100).toFixed(2);
  }

  res.json({ since, hours, counts, rates });
}));

module.exports = router;
