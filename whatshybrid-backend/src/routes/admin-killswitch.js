/**
 * FIX PEND-MED-009: Admin Kill Switch Routes
 *
 * Provides emergency shutdown capability for extension features.
 * Admins can disable features remotely for all users or specific users.
 *
 * @version 1.0.0
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticate, requireAdmin } = require('../middleware/auth');
const db = require('../utils/database');

const DEFAULT_ADMIN_KEY = 'CHANGE_ME_IN_PRODUCTION';
const STATE_KEY = 'kill_switch_state';

// In-memory kill switch state (in production, use Redis or database)
const killSwitchState = {
  global: {
    extension: false,     // Master kill switch - disables entire extension
    autopilot: false,     // Disable autopilot feature
    ai: false,            // Disable all AI features
    campaigns: false,     // Disable campaign manager
    bulk_messages: false  // Disable bulk messaging
  },
  // Per-user overrides: userId -> { feature: boolean }
  users: new Map()
};

// IA-04 — chave de admin: em produção, ausente ou igual ao valor padrão →
// recusada (antes, qualquer um que soubesse "CHANGE_ME_IN_PRODUCTION" mexia).
function resolveAdminKey() {
  const key = process.env.ADMIN_KILL_SWITCH_KEY;
  if (process.env.NODE_ENV === 'production' && (!key || key === DEFAULT_ADMIN_KEY)) return null;
  return key || DEFAULT_ADMIN_KEY;
}

// IA-04 — o estado fica em admin_settings e sobrevive a restart/deploy.
let loadPromise = null;
function ensureLoaded() {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const row = await db.get('SELECT value FROM admin_settings WHERE key = ?', [STATE_KEY]);
        if (row && row.value) {
          const saved = JSON.parse(row.value);
          Object.assign(killSwitchState.global, saved.global || {});
          killSwitchState.users = new Map(Array.isArray(saved.users) ? saved.users : []);
        }
      } catch (e) {
        logger.warn(`[KillSwitch] Estado salvo não carregado: ${e.message}`);
      }
    })();
  }
  return loadPromise;
}

async function persistState() {
  const value = JSON.stringify({ global: killSwitchState.global, users: Array.from(killSwitchState.users.entries()) });
  await db.run(
    `INSERT INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [STATE_KEY, value]
  );
}

function effectiveFor(userId) {
  return { ...killSwitchState.global, ...(killSwitchState.users.get(userId) || {}) };
}

// IA-04 — consulta usada pelas rotas de IA. "extension" desliga tudo.
async function isKilled(feature, userId) {
  await ensureLoaded();
  const eff = effectiveFor(userId);
  return eff[feature] === true || eff.extension === true;
}

// IA-04 — middleware das rotas de geração: com o kill switch ligado responde 503
// ANTES de qualquer chamada ao provedor. Vai depois do authenticate.
function killSwitchGuard(feature) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id || req.user?.userId;
      if (await isKilled(feature, userId)) {
        return res.status(503).json({
          success: false,
          error: 'kill_switch',
          code: 'KILL_SWITCH',
          feature,
          message: 'Recurso desativado temporariamente pelo administrador.',
        });
      }
      return next();
    } catch (e) {
      return next(e);
    }
  };
}

/**
 * GET /api/v1/admin/kill-switch/status
 * Returns current kill switch status for the authenticated user
 */
router.get('/status', authenticate, async (req, res) => {
  try {
    await ensureLoaded();
    const userId = req.user?.id || req.user?.userId;

    // Check for user-specific kill switch
    const userKillSwitch = killSwitchState.users.get(userId) || {};

    // Merge global and user-specific settings (user-specific overrides global)
    const effectiveKillSwitch = {
      ...killSwitchState.global,
      ...userKillSwitch
    };

    res.json({
      success: true,
      killSwitch: effectiveKillSwitch,
      timestamp: Date.now()
    });

    // Log check (with rate limiting to avoid spam)
    if (Math.random() < 0.01) {  // Log 1% of requests
      logger.info('[KillSwitch] Status check', {
        userId,
        hasUserOverride: Object.keys(userKillSwitch).length > 0,
        globalStatus: killSwitchState.global
      });
    }
  } catch (error) {
    logger.error('[KillSwitch] Status check error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/admin/kill-switch/set
 * Set kill switch for a feature (admin only)
 *
 * Body:
 * - feature: string (extension, autopilot, ai, campaigns, bulk_messages)
 * - enabled: boolean (true = kill/disable, false = enable)
 * - userId: string (optional, for user-specific kill switch)
 * - adminKey: string (admin authentication key)
 */
router.post('/set', authenticate, requireAdmin, async (req, res) => {
  try {
    const { feature, enabled, userId, adminKey } = req.body;
    await ensureLoaded();

    // Verify admin key (in production, use proper admin authentication)
    const ADMIN_KEY = resolveAdminKey();
    if (!ADMIN_KEY) {
      return res.status(503).json({ success: false, error: 'ADMIN_KILL_SWITCH_KEY não configurada' });
    }

    if (adminKey !== ADMIN_KEY) {
      logger.warn('[KillSwitch] Unauthorized kill switch attempt', { feature, userId });
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - Invalid admin key'
      });
    }

    // Validate feature
    const validFeatures = ['extension', 'autopilot', 'ai', 'campaigns', 'bulk_messages'];
    if (!validFeatures.includes(feature)) {
      return res.status(400).json({
        success: false,
        error: `Invalid feature. Must be one of: ${validFeatures.join(', ')}`
      });
    }

    // Apply kill switch
    if (userId) {
      // User-specific kill switch
      const userKillSwitch = killSwitchState.users.get(userId) || {};
      userKillSwitch[feature] = enabled === true;
      killSwitchState.users.set(userId, userKillSwitch);

      logger.warn('[KillSwitch] User-specific kill switch set', {
        userId,
        feature,
        enabled,
        adminKey: adminKey.substring(0, 8) + '...'
      });
    } else {
      // Global kill switch
      killSwitchState.global[feature] = enabled === true;

      logger.warn('[KillSwitch] Global kill switch set', {
        feature,
        enabled,
        adminKey: adminKey.substring(0, 8) + '...'
      });
    }

    await persistState();

    res.json({
      success: true,
      feature,
      enabled,
      scope: userId ? 'user' : 'global',
      userId: userId || null,
      currentState: userId
        ? killSwitchState.users.get(userId)
        : killSwitchState.global
    });

  } catch (error) {
    logger.error('[KillSwitch] Set error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/admin/kill-switch/state
 * Get full kill switch state (admin only)
 */
router.get('/state', authenticate, requireAdmin, async (req, res) => {
  try {
    const { adminKey } = req.query;
    await ensureLoaded();

    const ADMIN_KEY = resolveAdminKey();

    if (!ADMIN_KEY || adminKey !== ADMIN_KEY) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    res.json({
      success: true,
      global: killSwitchState.global,
      users: Array.from(killSwitchState.users.entries()).map(([userId, settings]) => ({
        userId,
        settings
      })),
      timestamp: Date.now()
    });

  } catch (error) {
    logger.error('[KillSwitch] State error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/admin/kill-switch/reset
 * Reset all kill switches (admin only)
 */
router.post('/reset', authenticate, requireAdmin, async (req, res) => {
  try {
    const { adminKey } = req.body;
    await ensureLoaded();

    const ADMIN_KEY = resolveAdminKey();

    if (!ADMIN_KEY || adminKey !== ADMIN_KEY) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    // Reset all kill switches
    killSwitchState.global = {
      extension: false,
      autopilot: false,
      ai: false,
      campaigns: false,
      bulk_messages: false
    };
    killSwitchState.users.clear();
    await persistState();

    logger.warn('[KillSwitch] All kill switches reset', {
      adminKey: adminKey.substring(0, 8) + '...'
    });

    res.json({
      success: true,
      message: 'All kill switches reset',
      timestamp: Date.now()
    });

  } catch (error) {
    logger.error('[KillSwitch] Reset error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
module.exports.isKilled = isKilled;
module.exports.killSwitchGuard = killSwitchGuard;
