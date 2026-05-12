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

/**
 * GET /api/v1/admin/kill-switch/status
 * Returns current kill switch status for the authenticated user
 */
router.get('/status', authenticate, async (req, res) => {
  try {
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

    // Verify admin key (in production, use proper admin authentication)
    const ADMIN_KEY = process.env.ADMIN_KILL_SWITCH_KEY || 'CHANGE_ME_IN_PRODUCTION';

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

    const ADMIN_KEY = process.env.ADMIN_KILL_SWITCH_KEY || 'CHANGE_ME_IN_PRODUCTION';

    if (adminKey !== ADMIN_KEY) {
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

    const ADMIN_KEY = process.env.ADMIN_KILL_SWITCH_KEY || 'CHANGE_ME_IN_PRODUCTION';

    if (adminKey !== ADMIN_KEY) {
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
