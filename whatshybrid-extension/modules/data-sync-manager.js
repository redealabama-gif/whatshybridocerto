/**
 * 🔄 Data Sync Manager - Sincronização Bidirecional de Dados
 * 
 * Garante que todos os dados da extensão sejam salvos tanto localmente
 * quanto no backend, evitando perda de dados por limpeza de cookies/cache.
 * 
 * Dados sincronizados:
 * - CRM (Contatos, Deals, Pipelines, Tasks, Labels)
 * - Recover (Mensagens recuperadas)
 * - Treinamento de IA (Exemplos, FAQs, Produtos)
 * - Configurações da extensão
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  console.log('[DataSyncManager] 🔄 Inicializando...');

  // ============================================
  // CONFIGURAÇÃO
  // ============================================
  const CONFIG = {
    STORAGE_PREFIX: 'whl_',
    SYNC_INTERVAL: 60000, // 1 minuto
    SYNC_DEBOUNCE: 5000,  // 5 segundos após última mudança
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
    SYNC_STATE_KEY: 'whl_sync_state',
    
    // Dados a serem sincronizados
    SYNC_MODULES: {
      // FIX PEND-CRIT-002: Corrigido endpoint CRM sync (usar /api/v1/sync/crm ao invés de rotas individuais)
      crm: {
        localKey: 'whl_crm_data',
        endpoint: '/api/v1/sync/crm', // FIXED: Endpoint unificado para CRM (contacts + deals + pipeline)
        priority: 'high'
      },
      // FIX PEND-CRIT-003: Corrigido endpoint Tasks sync
      // FIX PEND-MED-007: Use correct storage key (whl_tasks_v2, not whl_tasks)
      tasks: {
        localKey: 'whl_tasks_v2',
        endpoint: '/api/v1/sync/tasks', // FIXED: Era /api/v1/crm/tasks/sync (incorreto)
        priority: 'medium'
      },
      labels: {
        localKey: 'whl_labels',
        endpoint: '/api/v1/sync/crm_labels', // Labels tem endpoint separado em CRM
        priority: 'low'
      },
      recover_history: {
        localKey: 'whl_recover_history',
        endpoint: '/api/v1/sync/recover_history', // Endpoint recover-sync.js
        priority: 'high'
      },
      // FIX PEND-CRIT-001: Corrigido endpoint few-shot sync
      ai_training_examples: {
        localKey: 'whl_few_shot_examples',
        endpoint: '/api/v1/sync/ai_training_examples', // FIXED: Era /api/v1/ai/learn/examples/sync (não existe)
        priority: 'medium'
      },
      ai_memory: {
        localKey: 'whl_ai_memory',
        endpoint: '/api/v1/sync/ai_memory', // Endpoint memory.js
        priority: 'medium'
      },
      // 'knowledge' NÃO entra aqui de propósito: o KnowledgeSyncManager já
      // sincroniza whl_knowledge_base via POST /api/v1/knowledge/sync com o
      // payload { action:'sync', knowledge }. O DataSyncManager manda payload
      // genérico { module, data }, que esse endpoint rejeita com "Action
      // inválida". Sincronizar aqui era redundante E quebrado.
      quick_replies: {
        localKey: 'whl_quick_replies',
        endpoint: '/api/v1/sync/templates',
        priority: 'low'
      },
      settings: {
        localKey: 'whl_settings',
        endpoint: '/api/v1/sync/settings',
        priority: 'low'
      },
      // v9.5.6: SaaS multi-device parity — these were local-only and got lost when the customer
      // switched machines. All seven now sync via the generic sync_data endpoint, which means
      // restoreFromBackend() pulls them on first login from a fresh device.
      // Premise: "If the customer logged in, their data must be there. Period."
      campaigns: {
        localKey: 'whl_campaigns',
        endpoint: '/api/v1/sync/campaigns',
        priority: 'high'
      },
      campaign_alarms: {
        localKey: 'whl_campaign_alarms',
        endpoint: '/api/v1/sync/campaign_alarms',
        priority: 'high'
      },
      conversation_memory: {
        localKey: 'whl_conversation_memory',
        endpoint: '/api/v1/sync/conversation_memory',
        priority: 'medium'
      },
      conversation_memory_stats: {
        localKey: 'whl_conversation_memory_stats',
        endpoint: '/api/v1/sync/conversation_memory_stats',
        priority: 'low'
      },
      training_stats: {
        localKey: 'whl_training_stats',
        endpoint: '/api/v1/sync/training_stats',
        priority: 'low'
      },
      ai_memory_advanced: {
        localKey: 'whl_ai_memory_advanced',
        endpoint: '/api/v1/sync/ai_memory_advanced',
        priority: 'medium'
      },
      smart_templates: {
        localKey: 'whl_smart_templates',
        endpoint: '/api/v1/sync/smart_templates',
        priority: 'low'
      }
    }
  };

  // ============================================
  // SECURITY HELPERS
  // ============================================

  /**
   * SECURITY FIX P0-021: Sanitize objects to prevent Prototype Pollution
   */
  function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj;
    }

    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const sanitized = {};

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (dangerousKeys.includes(key)) {
          console.warn('[DataSyncManager Security] Blocked prototype pollution attempt:', key);
          continue;
        }

        if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
          sanitized[key] = sanitizeObject(obj[key]);
        } else {
          sanitized[key] = obj[key];
        }
      }
    }

    return sanitized;
  }

  /**
   * SECURITY FIX P0-022: Sanitize arrays of objects
   */
  function sanitizeArray(arr) {
    if (!Array.isArray(arr)) {
      return arr;
    }

    return arr.map(item => {
      if (item && typeof item === 'object') {
        return sanitizeObject(item);
      }
      return item;
    });
  }

  // ============================================
  // ESTADO
  // ============================================
  const state = {
    initialized: false,
    lastSync: {},
    pendingChanges: new Map(),
    syncInProgress: false,
    syncTimer: null,
    debounceTimers: {}
  };

  // ============================================
  // INICIALIZAÇÃO
  // ============================================
  async function init() {
    if (state.initialized) return;

    console.log('[DataSyncManager] 🔄 Configurando...');

    // Carregar estado de sincronização
    await loadSyncState();

    // Configurar listeners para mudanças locais
    setupStorageListener();

    // Configurar sync periódico
    setupPeriodicSync();

    // v9.5.6: Restore from backend BEFORE marking as initialized so any caller awaiting init()
    // is guaranteed the local storage has all server-side data merged in. This is the SaaS
    // multi-device guarantee: if you logged in, your data is here before any UI workflow starts.
    await restoreFromBackend();

    state.initialized = true;
    state.restoredAt = Date.now();
    console.log('[DataSyncManager] ✅ Inicializado e dados restaurados');

    // Emitir evento de pronto + emitir o de restored separadamente para UIs que querem ouvir
    // só a parte de restauração concluída.
    if (window.EventBus) {
      window.EventBus.emit('dataSync:ready', { modules: Object.keys(CONFIG.SYNC_MODULES) });
      window.EventBus.emit('dataSync:restored', { modules: Object.keys(CONFIG.SYNC_MODULES), at: state.restoredAt });
    }
  }

  // v9.5.6: Public helper for UIs/workflows that must NOT operate on partial local data.
  // Resolves immediately if already restored; otherwise waits for the dataSync:restored event
  // (or rejects after timeout). Use before campaign sends, training stats display, etc.
  function waitForRestored(timeoutMs = 15000) {
    if (state.initialized && state.restoredAt) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('dataSync restore timeout')), timeoutMs);
      const handler = () => { clearTimeout(timer); resolve(true); };
      if (window.EventBus?.once) {
        window.EventBus.once('dataSync:restored', handler);
      } else if (window.EventBus?.on) {
        window.EventBus.on('dataSync:restored', handler);
      } else {
        // Polling fallback
        const poll = setInterval(() => {
          if (state.initialized && state.restoredAt) { clearInterval(poll); clearTimeout(timer); resolve(true); }
        }, 200);
      }
    });
  }

  // ============================================
  // ESTADO DE SINCRONIZAÇÃO
  // ============================================
  async function loadSyncState() {
    try {
      const result = await chrome.storage.local.get(CONFIG.SYNC_STATE_KEY);
      if (result[CONFIG.SYNC_STATE_KEY]) {
        // SECURITY FIX P0-021: Sanitize data from storage to prevent Prototype Pollution
        state.lastSync = sanitizeObject(result[CONFIG.SYNC_STATE_KEY]);
      }
    } catch (e) {
      console.warn('[DataSyncManager] Erro ao carregar estado de sync:', e);
    }
  }

  async function saveSyncState() {
    try {
      await chrome.storage.local.set({ [CONFIG.SYNC_STATE_KEY]: state.lastSync });
    } catch (e) {
      console.warn('[DataSyncManager] Erro ao salvar estado de sync:', e);
    }
  }

  // ============================================
  // LISTENER DE MUDANÇAS LOCAIS
  // ============================================
  function setupStorageListener() {
    // FIX PEND-MED-008: Use TabCoordinator for leader-only storage listening
    // This prevents duplicate processing when multiple WhatsApp tabs are open
    const listenerCallback = (changes, areaName) => {
      if (areaName !== 'local') return;

      for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
        // Verificar se é uma chave que devemos sincronizar
        const moduleEntry = Object.entries(CONFIG.SYNC_MODULES).find(
          ([, config]) => config.localKey === key
        );

        if (moduleEntry) {
          const [moduleName] = moduleEntry;
          console.log(`[DataSyncManager] 📝 Mudança detectada: ${moduleName}`);
          
          // Marcar como pendente
          state.pendingChanges.set(moduleName, {
            timestamp: Date.now(),
            data: newValue
          });

          // Debounce para evitar muitas sincronizações
          scheduleSync(moduleName);
        }
      }
    };

    // FIX PEND-MED-008: Register with TabCoordinator if available
    if (window.TabCoordinator?.addStorageListener) {
      // Use leader-only pattern to prevent duplicate syncs across tabs
      window.TabCoordinator.addStorageListener(listenerCallback, {
        leaderOnly: true,  // Only leader tab syncs to backend
        broadcastToOthers: false  // Other tabs don't need notification
      });
      console.log('[DataSyncManager] ✅ Storage listener registered with TabCoordinator (leader-only)');
    } else {
      // Fallback: Direct registration if TabCoordinator not available
      chrome.storage.onChanged.addListener(listenerCallback);
      console.warn('[DataSyncManager] ⚠️ TabCoordinator not available, using direct listener (may duplicate across tabs)');
    }
  }

  function scheduleSync(moduleName) {
    // Limpar timer anterior
    if (state.debounceTimers[moduleName]) {
      clearTimeout(state.debounceTimers[moduleName]);
    }

    // Agendar nova sincronização
    state.debounceTimers[moduleName] = setTimeout(async () => {
      await syncModule(moduleName);
    }, CONFIG.SYNC_DEBOUNCE);
  }

  // ============================================
  // SINCRONIZAÇÃO PERIÓDICA
  // ============================================
  function setupPeriodicSync() {
    state.syncTimer = setInterval(async () => {
      await syncAll();
    }, CONFIG.SYNC_INTERVAL);

    // Cleanup
    window.addEventListener('beforeunload', () => {
      if (state.syncTimer) {
        clearInterval(state.syncTimer);
        state.syncTimer = null;
      }
      Object.values(state.debounceTimers).forEach(timer => clearTimeout(timer));
    });
  }

  // ============================================
  // SINCRONIZAÇÃO DE MÓDULO
  // ============================================
  async function syncModule(moduleName) {
    if (state.syncInProgress) {
      console.log(`[DataSyncManager] ⏳ Sync em andamento, adiando ${moduleName}`);
      return;
    }

    const moduleConfig = CONFIG.SYNC_MODULES[moduleName];
    if (!moduleConfig) {
      console.warn(`[DataSyncManager] Módulo desconhecido: ${moduleName}`);
      return;
    }

    // Verificar se backend está disponível
    if (!window.BackendClient?.isConnected()) {
      console.log(`[DataSyncManager] ⚠️ Backend não conectado, mantendo em pendentes`);
      return;
    }

    state.syncInProgress = true;

    try {
      console.log(`[DataSyncManager] 📤 Sincronizando ${moduleName}...`);

      // Obter dados locais
      const result = await chrome.storage.local.get(moduleConfig.localKey);
      const localData = result[moduleConfig.localKey] || null;

      if (!localData) {
        console.log(`[DataSyncManager] Nenhum dado local para ${moduleName}`);
        state.syncInProgress = false;
        return;
      }

      // Preparar payload
      const payload = {
        module: moduleName,
        data: localData,
        lastSync: state.lastSync[moduleName] || 0,
        timestamp: Date.now()
      };

      // Enviar para backend
      const response = await window.BackendClient.request(moduleConfig.endpoint, {
        method: 'POST',
        body: payload
      });

      if (response.success) {
        // Atualizar timestamp de sincronização
        state.lastSync[moduleName] = Date.now();
        await saveSyncState();

        // Remover das pendentes
        state.pendingChanges.delete(moduleName);

        // Se backend retornou dados mais recentes, mesclar
        if (response.data && response.mergeNeeded) {
          await mergeBackendData(moduleName, moduleConfig.localKey, response.data);
        }

        console.log(`[DataSyncManager] ✅ ${moduleName} sincronizado`);

        // Emitir evento
        if (window.EventBus) {
          window.EventBus.emit('dataSync:synced', { module: moduleName });
        }
      } else {
        throw new Error(response.error || 'Sync failed');
      }

    } catch (e) {
      console.error(`[DataSyncManager] ❌ Erro ao sincronizar ${moduleName}:`, e);
      
      // Emitir evento de erro
      if (window.EventBus) {
        window.EventBus.emit('dataSync:error', { module: moduleName, error: e.message });
      }
    } finally {
      state.syncInProgress = false;
    }
  }

  // ============================================
  // SINCRONIZAR TUDO
  // ============================================
  async function syncAll(force = false) {
    if (state.syncInProgress && !force) {
      console.log('[DataSyncManager] ⏳ Sync já em andamento');
      return;
    }

    // Verificar conexão com backend
    if (!window.BackendClient?.isConnected()) {
      console.log('[DataSyncManager] ⚠️ Backend não conectado');
      return;
    }

    console.log('[DataSyncManager] 📤 Iniciando sincronização completa...');

    // Ordenar módulos por prioridade
    const orderedModules = Object.entries(CONFIG.SYNC_MODULES)
      .sort((a, b) => {
        const priority = { high: 0, medium: 1, low: 2 };
        return priority[a[1].priority] - priority[b[1].priority];
      })
      .map(([name]) => name);

    for (const moduleName of orderedModules) {
      await syncModule(moduleName);
      // Pequeno delay entre módulos
      await new Promise(r => setTimeout(r, 100));
    }

    console.log('[DataSyncManager] ✅ Sincronização completa finalizada');
  }

  // ============================================
  // RESTAURAR DO BACKEND
  // ============================================
  async function restoreFromBackend() {
    // Verificar conexão com backend
    if (!window.BackendClient?.isConnected()) {
      console.log('[DataSyncManager] ⚠️ Backend não conectado, pulando restauração');
      return;
    }

    console.log('[DataSyncManager] 📥 Verificando dados do backend...');

    try {
      const response = await window.BackendClient.request('/api/v1/sync/status', {
        method: 'GET'
      });

      if (response.success && response.modules) {
        for (const [moduleName, backendInfo] of Object.entries(response.modules)) {
          const moduleConfig = CONFIG.SYNC_MODULES[moduleName];
          if (!moduleConfig) continue;

          const localLastSync = state.lastSync[moduleName] || 0;
          const backendLastSync = backendInfo.lastModified || 0;

          // Se backend tem dados mais recentes, baixar
          if (backendLastSync > localLastSync) {
            console.log(`[DataSyncManager] 📥 Restaurando ${moduleName} do backend...`);
            
            const dataResponse = await window.BackendClient.request(
              `${moduleConfig.endpoint}/download`,
              { method: 'GET' }
            );

            if (dataResponse.success && dataResponse.data) {
              await mergeBackendData(moduleName, moduleConfig.localKey, dataResponse.data);
              state.lastSync[moduleName] = Date.now();
            }
          }
        }

        await saveSyncState();
      }
    } catch (e) {
      console.warn('[DataSyncManager] Erro ao restaurar do backend:', e);
    }
  }

  // ============================================
  // ESTRATÉGIAS DE RESOLUÇÃO DE CONFLITOS
  // ============================================
  const CONFLICT_STRATEGIES = {
    LATEST_WINS: 'latest_wins',      // O mais recente vence (padrão)
    LOCAL_WINS: 'local_wins',        // Local sempre vence
    BACKEND_WINS: 'backend_wins',    // Backend sempre vence
    MERGE_FIELDS: 'merge_fields'     // Mescla campos individuais
  };
  
  /**
   * Obtém o timestamp mais confiável de um item
   */
  function getItemTimestamp(item) {
    if (!item) return 0;
    return item.updatedAt || item.updated_at || item.modifiedAt || item.modified_at || 
           item.lastModified || item.last_modified || item.createdAt || item.created_at || 
           item.timestamp || 0;
  }
  
  /**
   * Resolve conflito entre dois itens
   * @param {Object} localItem - Item local
   * @param {Object} backendItem - Item do backend
   * @param {string} strategy - Estratégia de resolução
   * @returns {Object} - Item resolvido
   */
  function resolveItemConflict(localItem, backendItem, strategy = CONFLICT_STRATEGIES.LATEST_WINS) {
    if (!localItem) return backendItem;
    if (!backendItem) return localItem;
    
    switch (strategy) {
      case CONFLICT_STRATEGIES.LOCAL_WINS:
        return localItem;
        
      case CONFLICT_STRATEGIES.BACKEND_WINS:
        return backendItem;
        
      case CONFLICT_STRATEGIES.MERGE_FIELDS:
        // SECURITY FIX P0-022: Sanitize backend data before merging to prevent Prototype Pollution
        const sanitizedBackend = sanitizeObject(backendItem);

        // Mescla campos, preferindo valores não-nulos do backend
        const merged = { ...localItem };
        for (const [key, value] of Object.entries(sanitizedBackend)) {
          if (value !== null && value !== undefined) {
            // Se ambos têm o campo, usa o mais recente
            const localTs = getItemTimestamp(localItem);
            const backendTs = getItemTimestamp(sanitizedBackend);
            if (backendTs >= localTs) {
              merged[key] = value;
            }
          }
        }
        // Atualiza timestamp para o maior
        merged.updatedAt = Math.max(
          getItemTimestamp(localItem),
          getItemTimestamp(sanitizedBackend)
        );
        return merged;
        
      case CONFLICT_STRATEGIES.LATEST_WINS:
      default:
        const localTimestamp = getItemTimestamp(localItem);
        const backendTimestamp = getItemTimestamp(backendItem);
        return backendTimestamp >= localTimestamp ? backendItem : localItem;
    }
  }

  // ============================================
  // MESCLAR DADOS DO BACKEND
  // ============================================
  async function mergeBackendData(moduleName, localKey, backendData, strategy = CONFLICT_STRATEGIES.LATEST_WINS) {
    try {
      // SECURITY FIX P0-021: Sanitize backend data before merging
      const sanitizedBackendData = Array.isArray(backendData)
        ? sanitizeArray(backendData)
        : sanitizeObject(backendData);

      // Obter dados locais
      const result = await chrome.storage.local.get(localKey);
      const localData = result[localKey];

      let mergedData;
      let conflictsResolved = 0;

      if (Array.isArray(sanitizedBackendData)) {
        // Para arrays, mesclar por ID com resolução de conflitos
        const localArray = Array.isArray(localData) ? localData : [];
        const backendArray = Array.isArray(sanitizedBackendData) ? sanitizedBackendData : [];
        
        const merged = new Map();
        const conflicts = [];
        
        // Primeiro, adicionar itens locais
        for (const item of localArray) {
          const id = item.id || item.key || item.chatId || JSON.stringify(item);
          merged.set(id, { source: 'local', item });
        }
        
        // Depois, verificar itens do backend
        for (const item of backendArray) {
          const id = item.id || item.key || item.chatId || JSON.stringify(item);
          const existing = merged.get(id);
          
          if (existing) {
            // Conflito: item existe em ambos
            const resolved = resolveItemConflict(existing.item, item, strategy);
            merged.set(id, { source: 'resolved', item: resolved });
            conflictsResolved++;
            conflicts.push({ id, localTs: getItemTimestamp(existing.item), backendTs: getItemTimestamp(item) });
          } else {
            merged.set(id, { source: 'backend', item });
          }
        }
        
        mergedData = Array.from(merged.values()).map(entry => entry.item);
        
        if (conflicts.length > 0) {
          console.log(`[DataSyncManager] ⚖️ ${moduleName}: ${conflictsResolved} conflitos resolvidos com estratégia '${strategy}'`);
        }
        
      } else if (typeof sanitizedBackendData === 'object' && sanitizedBackendData !== null) {
        // Para objetos, usar resolução de conflitos por campo
        if (localData && typeof localData === 'object') {
          mergedData = resolveItemConflict(localData, sanitizedBackendData, CONFLICT_STRATEGIES.MERGE_FIELDS);
        } else {
          mergedData = sanitizedBackendData;
        }
      } else {
        // Para valores primitivos, usar backend (mais recente)
        mergedData = sanitizedBackendData;
      }

      // Salvar dados mesclados
      await chrome.storage.local.set({ [localKey]: mergedData });
      
      console.log(`[DataSyncManager] ✅ ${moduleName} mesclado com dados do backend (${conflictsResolved} conflitos resolvidos)`);

      // Emitir evento de conflitos resolvidos
      if (conflictsResolved > 0 && window.EventBus) {
        window.EventBus.emit('dataSync:conflictsResolved', { 
          module: moduleName, 
          count: conflictsResolved,
          strategy 
        });
      }

    } catch (e) {
      console.error(`[DataSyncManager] Erro ao mesclar ${moduleName}:`, e);
    }
  }

  // ============================================
  // FORÇAR SINCRONIZAÇÃO
  // ============================================
  async function forceSync(moduleName = null) {
    if (moduleName) {
      await syncModule(moduleName);
    } else {
      await syncAll(true);
    }
  }

  // ============================================
  // DELETAR DADOS (COM PROPAGAÇÃO PARA BACKEND)
  // ============================================
  async function deleteData(moduleName, itemId = null) {
    const moduleConfig = CONFIG.SYNC_MODULES[moduleName];
    if (!moduleConfig) {
      console.warn(`[DataSyncManager] Módulo desconhecido: ${moduleName}`);
      return false;
    }

    try {
      // Se itemId específico, deletar apenas esse item
      if (itemId) {
        // Obter dados locais
        const result = await chrome.storage.local.get(moduleConfig.localKey);
        let localData = result[moduleConfig.localKey];

        if (Array.isArray(localData)) {
          localData = localData.filter(item => (item.id || item.key) !== itemId);
          await chrome.storage.local.set({ [moduleConfig.localKey]: localData });
        }

        // Propagar para backend
        if (window.BackendClient?.isConnected()) {
          await window.BackendClient.request(`${moduleConfig.endpoint}/${itemId}`, {
            method: 'DELETE'
          });
        }
      } else {
        // Deletar todos os dados do módulo
        await chrome.storage.local.remove(moduleConfig.localKey);

        // Propagar para backend
        if (window.BackendClient?.isConnected()) {
          await window.BackendClient.request(`${moduleConfig.endpoint}/all`, {
            method: 'DELETE'
          });
        }
      }

      console.log(`[DataSyncManager] 🗑️ Dados deletados: ${moduleName}${itemId ? '/' + itemId : ' (todos)'}`);
      return true;

    } catch (e) {
      console.error(`[DataSyncManager] Erro ao deletar ${moduleName}:`, e);
      return false;
    }
  }

  // ============================================
  // EXPORTAR TODOS OS DADOS
  // ============================================
  async function exportAllData() {
    const exportData = {
      exportedAt: new Date().toISOString(),
      version: '1.0.0',
      modules: {}
    };

    for (const [moduleName, moduleConfig] of Object.entries(CONFIG.SYNC_MODULES)) {
      try {
        const result = await chrome.storage.local.get(moduleConfig.localKey);
        if (result[moduleConfig.localKey]) {
          exportData.modules[moduleName] = result[moduleConfig.localKey];
        }
      } catch (e) {
        console.warn(`[DataSyncManager] Erro ao exportar ${moduleName}:`, e);
      }
    }

    return exportData;
  }

  // ============================================
  // IMPORTAR DADOS
  // ============================================
  async function importData(importData) {
    if (!importData || !importData.modules) {
      throw new Error('Dados de importação inválidos');
    }

    // SECURITY FIX P0-023: Sanitize imported modules to prevent Prototype Pollution
    const sanitizedModules = sanitizeObject(importData.modules);

    for (const [moduleName, data] of Object.entries(sanitizedModules)) {
      const moduleConfig = CONFIG.SYNC_MODULES[moduleName];
      if (!moduleConfig) continue;

      try {
        // Sanitize data based on type (array or object)
        const sanitizedData = Array.isArray(data) ? sanitizeArray(data) : sanitizeObject(data);

        await chrome.storage.local.set({ [moduleConfig.localKey]: sanitizedData });
        console.log(`[DataSyncManager] ✅ ${moduleName} importado (sanitizado)`);
      } catch (e) {
        console.error(`[DataSyncManager] Erro ao importar ${moduleName}:`, e);
      }
    }

    // Sincronizar com backend após importação
    await syncAll(true);
  }

  // ============================================
  // ESTATÍSTICAS
  // ============================================
  function getStats() {
    return {
      initialized: state.initialized,
      lastSyncTimes: { ...state.lastSync },
      pendingChanges: state.pendingChanges.size,
      syncInProgress: state.syncInProgress,
      modules: Object.keys(CONFIG.SYNC_MODULES)
    };
  }

  // ============================================
  // API PÚBLICA
  // ============================================
  window.DataSyncManager = {
    init,

    // v9.5.6: Multi-device readiness gate — block workflows on partial data
    waitForRestored,

    // Sincronização
    syncModule,
    syncAll,
    forceSync,
    restoreFromBackend,
    
    // Gerenciamento de dados
    deleteData,
    exportAllData,
    importData,
    
    // Estatísticas
    getStats,
    getLastSync: (moduleName) => state.lastSync[moduleName] || null,
    getPendingChanges: () => state.pendingChanges.size,
    
    // Configuração
    MODULES: Object.keys(CONFIG.SYNC_MODULES),
    
    // Eventos (via EventBus)
    // 'dataSync:ready' - Quando o manager está pronto
    // 'dataSync:synced' - Quando um módulo foi sincronizado
    // 'dataSync:error' - Quando ocorre um erro de sincronização
  };

  // Auto-inicializar quando BackendClient estiver pronto
  function tryInit() {
    if (window.BackendClient) {
      init();
    } else {
      setTimeout(tryInit, 500);
    }
  }

  // Aguardar DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    setTimeout(tryInit, 1000);
  }

  console.log('[DataSyncManager] 📦 Módulo carregado');

})();
