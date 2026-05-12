/**
 * Storage Keys Centralizados (Compat)
 * WhatsHybrid v7.9.12
 *
 * IMPORTANTE:
 * - O contrato canônico está em `utils/storage-keys.js`
 * - Este arquivo existe para compatibilidade/organização e NÃO deve divergir.
 */
(function() {
  'use strict';

  // Se o contrato canônico já carregou, não sobrescrever.
  if (window.WHLStorageKeys && (window.WHLStorageKeys.KEYS || window.WHLStorageKeys.SETTINGS)) {
    if (!window.STORAGE_KEYS && window.WHLStorageKeys.KEYS) {
      window.STORAGE_KEYS = window.WHLStorageKeys.KEYS;
    }
    return;
  }

  // Fallback mínimo (deve espelhar `utils/storage-keys.js`)
  const STORAGE_KEYS = {
    SETTINGS: 'whl_settings',
    USER_CONFIG: 'whl_user_config',
    BACKEND_CONFIG: 'whl_backend_config',

    AI_SERVICE: 'whl_ai_service',
    AI_PROVIDERS: 'whl_ai_providers',
    KNOWLEDGE_BASE: 'whl_knowledge_base',
    FEW_SHOT_EXAMPLES: 'whl_few_shot_examples',
    TRAINING_DATA: 'whl_training_data',

    MEMORY_SYSTEM: 'whl_memory_system',
    MEMORY_SYNC_QUEUE: 'whl_memory_sync_queue',

    CONFIDENCE_SYSTEM: 'whl_confidence_system',
    CONFIDENCE_EVENT_LOG: 'whl_confidence_event_log',

    AUTOPILOT_PROCESSED: 'whl_autopilot_processed',
    AUTOPILOT_BLACKLIST: 'whl_autopilot_blacklist',
    AUTOPILOT_RATE_LIMITS: 'whl_autopilot_rate_limits',

    CRM: 'whl_crm_v2',
    CRM_CONTACTS: 'whl_crm_contacts',
    CRM_DEALS: 'whl_crm_deals',
    CRM_PIPELINE: 'whl_crm_pipeline',

    TASKS: 'whl_tasks_v2',
    TASK_REMINDERS: 'whl_task_reminders',

    TEAM_SYSTEM: 'whl_team_system_v1',

    ANALYTICS: 'whl_analytics_v2',
    ANALYTICS_DAILY: 'whl_analytics_daily',

    RECOVER_DATA: 'whl_recover_data',
    RECOVER_MEDIA: 'whl_recover_media',

    CAMPAIGNS: 'whl_campaigns',
    CAMPAIGN_HISTORY: 'whl_campaign_history',

    LABELS: 'whl_labels',
    CHAT_LABELS: 'whl_chat_labels',

    QUICK_REPLIES: 'whl_quick_replies',
    CANNED_RESPONSES: 'whl_canned_responses',

    DATA_SYNC: 'whl_data_sync',
    SYNC_QUEUE: 'whl_sync_queue',
    LAST_SYNC: 'whl_last_sync',

    SUBSCRIPTION: 'whl_subscription',
    DEBUG_LOG: 'whl_debug_log',
    LAST_VERSION: 'whl_last_version',
    MIGRATION_STATUS: 'whl_migration_status'
  };

  const PREFIX = 'whl_';
  function isValidKey(key) { return typeof key === 'string' && key.startsWith(PREFIX); }
  function makeKey(name) { return name && name.startsWith(PREFIX) ? name : `${PREFIX}${name}`; }
  function getAllKeys() { return Object.values(STORAGE_KEYS); }

  const WHLStorageKeys = { KEYS: STORAGE_KEYS, PREFIX, isValidKey, makeKey, getAllKeys };
  Object.assign(WHLStorageKeys, STORAGE_KEYS);

  window.STORAGE_KEYS = STORAGE_KEYS;
  window.WHLStorageKeys = WHLStorageKeys;
  
  // Exportar também como módulo para scripts que usam require/import
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WHLStorageKeys;
  }
})();