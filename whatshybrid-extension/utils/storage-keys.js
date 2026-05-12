/**
 * 🔑 Storage Keys - Chaves centralizadas para chrome.storage
 * WhatsHybrid v7.9.12
 * 
 * Este arquivo centraliza todas as chaves de storage usadas pela extensão
 * para evitar colisões e facilitar backup/restore.
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  // Se já existe um contrato compatível, não sobrescrever
  if (window.WHLStorageKeys && (window.WHLStorageKeys.KEYS || window.WHLStorageKeys.SETTINGS)) {
    // Garantir alias legados
    if (!window.STORAGE_KEYS && window.WHLStorageKeys.KEYS) {
      window.STORAGE_KEYS = window.WHLStorageKeys.KEYS;
    }
    return;
  }

  const STORAGE_KEYS = {
    // Sistema Core
    SETTINGS: 'whl_settings',
    USER_CONFIG: 'whl_user_config',
    BACKEND_CONFIG: 'whl_backend_config',
    
    // IA e Treinamento
    AI_SERVICE: 'whl_ai_service',
    AI_PROVIDERS: 'whl_ai_providers',
    KNOWLEDGE_BASE: 'whl_knowledge_base',
    FEW_SHOT_EXAMPLES: 'whl_few_shot_examples',
    TRAINING_DATA: 'whl_training_data',
    
    // Memória
    MEMORY_SYSTEM: 'whl_memory_system',
    MEMORY_SYNC_QUEUE: 'whl_memory_sync_queue',
    
    // Confiança e Copiloto
    CONFIDENCE_SYSTEM: 'whl_confidence_system',
    CONFIDENCE_EVENT_LOG: 'whl_confidence_event_log',
    
    // Autopilot
    AUTOPILOT_PROCESSED: 'whl_autopilot_processed',
    AUTOPILOT_BLACKLIST: 'whl_autopilot_blacklist',
    AUTOPILOT_RATE_LIMITS: 'whl_autopilot_rate_limits',
    
    // CRM
    CRM: 'whl_crm_v2',
    CRM_CONTACTS: 'whl_crm_contacts',
    CRM_DEALS: 'whl_crm_deals',
    CRM_PIPELINE: 'whl_crm_pipeline',
    
    // Tarefas
    TASKS: 'whl_tasks_v2',
    TASK_REMINDERS: 'whl_task_reminders',
    
    // Equipe
    TEAM_SYSTEM: 'whl_team_system_v1',
    
    // Analytics
    ANALYTICS: 'whl_analytics_v2',
    ANALYTICS_DAILY: 'whl_analytics_daily',
    
    // Recover
    RECOVER_DATA: 'whl_recover_data',
    RECOVER_MEDIA: 'whl_recover_media',
    
    // Campanhas
    CAMPAIGNS: 'whl_campaigns',
    CAMPAIGN_HISTORY: 'whl_campaign_history',
    
    // Labels/Etiquetas
    LABELS: 'whl_labels',
    CHAT_LABELS: 'whl_chat_labels',
    
    // Quick Replies
    QUICK_REPLIES: 'whl_quick_replies',
    CANNED_RESPONSES: 'whl_canned_responses',
    
    // Sync
    DATA_SYNC: 'whl_data_sync',
    SYNC_QUEUE: 'whl_sync_queue',
    LAST_SYNC: 'whl_last_sync',
    
    // Subscription
    SUBSCRIPTION: 'whl_subscription',
    
    // Debug
    DEBUG_LOG: 'whl_debug_log',
    
    // Versioning
    LAST_VERSION: 'whl_last_version',
    MIGRATION_STATUS: 'whl_migration_status'
  };

  // Prefixo padrão
  const PREFIX = 'whl_';

  /**
   * Valida se uma chave segue o padrão
   * @param {string} key - Chave a validar
   * @returns {boolean}
   */
  function isValidKey(key) {
    return typeof key === 'string' && key.startsWith(PREFIX);
  }

  /**
   * Gera uma chave com prefixo
   * @param {string} name - Nome da chave
   * @returns {string}
   */
  function makeKey(name) {
    if (name.startsWith(PREFIX)) return name;
    return `${PREFIX}${name}`;
  }

  /**
   * Lista todas as chaves conhecidas
   * @returns {string[]}
   */
  function getAllKeys() {
    return Object.values(STORAGE_KEYS);
  }

  /**
   * Exporta todos os dados do storage
   * @returns {Promise<Object>}
   */
  async function exportAll() {
    const keys = getAllKeys();
    return await chrome.storage.local.get(keys);
  }

  /**
   * Importa dados para o storage
   * @param {Object} data - Dados a importar
   * @param {boolean} merge - Se deve mesclar com dados existentes
   */
  async function importAll(data, merge = true) {
    if (!data || typeof data !== 'object') {
      throw new Error('Dados inválidos para importação');
    }

    // Filtrar apenas chaves válidas
    const validData = {};
    for (const [key, value] of Object.entries(data)) {
      if (isValidKey(key)) {
        validData[key] = value;
      }
    }

    if (merge) {
      const existing = await chrome.storage.local.get(Object.keys(validData));
      for (const key of Object.keys(validData)) {
        if (typeof validData[key] === 'object' && typeof existing[key] === 'object') {
          validData[key] = { ...existing[key], ...validData[key] };
        }
      }
    }

    await chrome.storage.local.set(validData);
    console.log('[StorageKeys] Dados importados:', Object.keys(validData).length, 'chaves');
  }

  /**
   * Limpa todos os dados da extensão
   */
  async function clearAll() {
    const keys = getAllKeys();
    await chrome.storage.local.remove(keys);
    console.log('[StorageKeys] Todos os dados limpos');
  }

  // Exportar globalmente (contrato compatível)
  // - `window.STORAGE_KEYS.KEY`: legado
  // - `window.WHLStorageKeys.KEY`: acesso direto
  // - `window.WHLStorageKeys.KEYS.KEY`: acesso explícito ao mapa
  const WHLStorageKeys = {
    KEYS: STORAGE_KEYS,
    PREFIX,
    isValidKey,
    makeKey,
    getAllKeys,
    exportAll,
    importAll,
    clearAll
  };
  Object.assign(WHLStorageKeys, STORAGE_KEYS);

  window.STORAGE_KEYS = STORAGE_KEYS;
  window.WHLStorageKeys = WHLStorageKeys;

  // Compatibilidade CommonJS (testes/scripts)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WHLStorageKeys;
  }

  console.log('[StorageKeys] ✅ Módulo carregado');
})();
