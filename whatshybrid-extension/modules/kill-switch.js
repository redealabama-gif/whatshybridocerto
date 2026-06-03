/**
 * FIX PEND-MED-009: Remote Kill Switch System
 *
 * Provides emergency shutdown capability via remote configuration.
 * Admins can disable extension features remotely for all users or specific users.
 *
 * @version 1.0.0
 */
(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    CHECK_INTERVAL: 5 * 60 * 1000,  // Check every 5 minutes
    CACHE_KEY: 'whl_kill_switch_status',
    ENDPOINT: '/api/v1/admin/kill-switch/status',
    FEATURES: ['autopilot', 'ai', 'campaigns', 'bulk_messages', 'extension']
  };

  // State
  const state = {
    killSwitchStatus: {},  // feature -> boolean (true = killed/disabled)
    lastCheck: 0,
    checkInterval: null,
    isChecking: false
  };

  /**
   * Initialize kill switch monitoring
   */
  async function init() {
    // Load cached status
    await loadCachedStatus();

    // Perform initial check
    await checkKillSwitchStatus();

    // Setup periodic checks
    state.checkInterval = setInterval(checkKillSwitchStatus, CONFIG.CHECK_INTERVAL);

    // Listen for manual trigger
    if (window.WHLEventBus) {
      window.WHLEventBus.on('killswitch:check', checkKillSwitchStatus);
    }

    console.log('[KillSwitch] ✅ Initialized. Check interval:', CONFIG.CHECK_INTERVAL / 1000, 'seconds');
  }

  /**
   * Load cached kill switch status from storage
   */
  async function loadCachedStatus() {
    try {
      const result = await chrome.storage.local.get(CONFIG.CACHE_KEY);
      if (result[CONFIG.CACHE_KEY]) {
        state.killSwitchStatus = result[CONFIG.CACHE_KEY].status || {};
        state.lastCheck = result[CONFIG.CACHE_KEY].timestamp || 0;
        console.log('[KillSwitch] Loaded cached status:', state.killSwitchStatus);
      }
    } catch (e) {
      console.warn('[KillSwitch] Failed to load cached status:', e);
    }
  }

  /**
   * Save kill switch status to cache
   */
  async function saveCachedStatus() {
    try {
      await chrome.storage.local.set({
        [CONFIG.CACHE_KEY]: {
          status: state.killSwitchStatus,
          timestamp: Date.now()
        }
      });
    } catch (e) {
      console.warn('[KillSwitch] Failed to save cached status:', e);
    }
  }

  /**
   * Check kill switch status from backend
   */
  async function checkKillSwitchStatus() {
    if (state.isChecking) return;

    state.isChecking = true;

    try {
      // Use BackendClient if available
      if (!window.BackendClient) {
        console.warn('[KillSwitch] BackendClient not available, using cached status');
        state.isChecking = false;
        return;
      }

      const response = await window.BackendClient.get(CONFIG.ENDPOINT);

      if (response?.success && response?.killSwitch) {
        const newStatus = response.killSwitch;

        // Check for changes
        const changed = JSON.stringify(state.killSwitchStatus) !== JSON.stringify(newStatus);

        if (changed) {
          console.warn('[KillSwitch] ⚠️ Status changed:', newStatus);

          // Check if extension is killed
          if (newStatus.extension === true) {
            console.error('[KillSwitch] 🚨 EXTENSION KILLED BY ADMIN - Disabling all features');
            disableAllFeatures();
          }
          // Check if autopilot is killed
          if (newStatus.autopilot === true) {
            console.warn('[KillSwitch] ⚠️ Autopilot killed - Stopping immediately');
            // Compat: versões diferentes expõem Autopilot em globals distintos
            const autopilot = window.AutopilotV2 || window.SmartBotAutopilot;
            if (autopilot?.stopAutopilot) {
              autopilot.stopAutopilot();
            } else if (autopilot?.stop) {
              autopilot.stop();
            }
          }

          // Emit events for feature-specific kills
          for (const [feature, killed] of Object.entries(newStatus)) {
            if (killed && window.WHLEventBus) {
              window.WHLEventBus.emit(`killswitch:${feature}:disabled`, { reason: 'admin' });
            }
          }
        }

        // Update state
        state.killSwitchStatus = newStatus;
        state.lastCheck = Date.now();

        // Save to cache
        await saveCachedStatus();

        console.log('[KillSwitch] Status updated:', state.killSwitchStatus);
      }
    } catch (error) {
      // Network error or backend unavailable
      console.warn('[KillSwitch] Check failed (will retry):', error.message);

      // Continue using cached status
    } finally {
      state.isChecking = false;
    }
  }

  /**
   * Disable all extension features (emergency shutdown)
   */
  function disableAllFeatures() {
    // Stop autopilot
    try {
      const autopilot = window.AutopilotV2 || window.SmartBotAutopilot;
      if (autopilot?.stopAutopilot) {
        autopilot.stopAutopilot();
      } else if (autopilot?.stop) {
        autopilot.stop();
      }
    } catch (e) {
      console.warn('[KillSwitch] Failed to stop autopilot:', e?.message || e);
    }

    // Disable campaigns
    if (window.CampaignManager?.stopAll) {
      window.CampaignManager.stopAll();
    }

    // Disable AI features
    if (window.AIGateway) {
      window.AIGateway._forceDisable = true;
    }

    // Show warning notification
    if (chrome?.notifications) {
      chrome.notifications.create('whl_kill_switch_activated', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/128.png'),
        title: '🚨 WhatsHybrid - Emergency Shutdown',
        message: 'The extension has been disabled remotely by an administrator. Please contact support.',
        priority: 2,
        requireInteraction: true
      });
    }

    // Emit global event
    if (window.WHLEventBus) {
      window.WHLEventBus.emit('killswitch:extension:disabled', {
        reason: 'admin',
        timestamp: Date.now()
      });
    }

    console.error('[KillSwitch] 🚨 ALL FEATURES DISABLED');
  }

  /**
   * Check if a feature is disabled by kill switch
   * @param {string} feature - Feature name (autopilot, ai, campaigns, etc.)
   * @returns {boolean} - true if feature is killed/disabled
   */
  function isFeatureDisabled(feature) {
    // Check if extension is globally killed
    if (state.killSwitchStatus.extension === true) {
      return true;
    }

    // Check specific feature
    return state.killSwitchStatus[feature] === true;
  }

  /**
   * Check if feature is enabled (opposite of isFeatureDisabled)
   * @param {string} feature - Feature name
   * @returns {boolean} - true if feature is enabled
   */
  function isFeatureEnabled(feature) {
    return !isFeatureDisabled(feature);
  }

  /**
   * Manually trigger kill switch check (for testing or urgent updates)
   */
  async function forceCheck() {
    console.log('[KillSwitch] Force check triggered...');
    await checkKillSwitchStatus();
  }

  // v9.3.4: cleanup do interval pra logout/suspend
  function stop() {
    if (state.checkInterval) {
      clearInterval(state.checkInterval);
      state.checkInterval = null;
    }
    if (window.WHLEventBus) {
      window.WHLEventBus.off?.('killswitch:check', checkKillSwitchStatus);
    }
  }

  // Public API
  window.KillSwitch = {
    init,
    stop,
    isFeatureDisabled,
    isFeatureEnabled,
    forceCheck,
    getStatus: () => ({ ...state.killSwitchStatus }),
    getLastCheck: () => state.lastCheck
  };

  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('[KillSwitch] Module loaded');

})();
