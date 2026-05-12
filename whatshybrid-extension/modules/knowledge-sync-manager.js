/**
 * 📚 Knowledge Sync Manager - Sincronização de Knowledge Base
 * WhatsHybrid v7.9.12
 * 
 * Gerencia a sincronização bidirecional de dados de Knowledge Base
 * e Few-Shot Learning com o backend.
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const CONFIG = {
    SYNC_INTERVAL: 300000, // 5 minutos
    SYNC_DEBOUNCE: 10000,  // 10 segundos após última mudança
    MAX_RETRY: 3,
    RETRY_DELAY: 5000,
    STORAGE_KEYS: {
      KB: 'whl_knowledge_base',
      FSL: 'whl_few_shot_examples',
      SYNC_STATE: 'whl_kb_sync_state',
      SYNC_QUEUE: 'whl_kb_sync_queue'
    }
  };

  const state = {
    initialized: false,
    syncing: false,
    lastSync: null,
    pendingChanges: new Set(),
    syncTimer: null,
    debounceTimer: null
  };

  /**
   * Inicializa o gerenciador de sync
   */
  async function init() {
    if (state.initialized) return;

    console.log('[KBSync] 🔄 Inicializando...');

    // Carregar estado anterior
    await loadSyncState();

    // Configurar listeners para mudanças locais
    setupStorageListener();

    // Tentar sincronização inicial
    await syncFromBackend();

    // Configurar sync periódico
    startPeriodicSync();

    state.initialized = true;
    console.log('[KBSync] ✅ Inicializado');

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit('kbSync:ready');
    }
  }

  /**
   * Carrega estado de sincronização salvo
   */
  async function loadSyncState() {
    try {
      const data = await chrome.storage.local.get(CONFIG.STORAGE_KEYS.SYNC_STATE);
      if (data[CONFIG.STORAGE_KEYS.SYNC_STATE]) {
        const saved = data[CONFIG.STORAGE_KEYS.SYNC_STATE];
        state.lastSync = saved.lastSync || null;
      }
    } catch (e) {
      console.warn('[KBSync] Erro ao carregar estado:', e);
    }
  }

  /**
   * Salva estado de sincronização
   */
  async function saveSyncState() {
    try {
      await chrome.storage.local.set({
        [CONFIG.STORAGE_KEYS.SYNC_STATE]: {
          lastSync: state.lastSync,
          timestamp: Date.now()
        }
      });
    } catch (e) {
      console.warn('[KBSync] Erro ao salvar estado:', e);
    }
  }

  /**
   * Configura listener para mudanças no storage
   */
  function setupStorageListener() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      const relevantKeys = [CONFIG.STORAGE_KEYS.KB, CONFIG.STORAGE_KEYS.FSL];
      
      for (const key of relevantKeys) {
        if (changes[key]) {
          console.log(`[KBSync] 📝 Mudança detectada: ${key}`);
          state.pendingChanges.add(key);
          scheduleSyncToBackend();
        }
      }
    });
  }

  /**
   * Agenda sync para o backend com debounce
   */
  function scheduleSyncToBackend() {
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
    }

    state.debounceTimer = setTimeout(async () => {
      await syncToBackend();
    }, CONFIG.SYNC_DEBOUNCE);
  }

  /**
   * Inicia sincronização periódica
   */
  function startPeriodicSync() {
    if (state.syncTimer) {
      clearInterval(state.syncTimer);
    }

    state.syncTimer = setInterval(async () => {
      await syncFromBackend();
    }, CONFIG.SYNC_INTERVAL);

    // Cleanup
    window.addEventListener('beforeunload', () => {
      if (state.syncTimer) clearInterval(state.syncTimer);
      if (state.debounceTimer) clearTimeout(state.debounceTimer);
    });
  }

  /**
   * Sincroniza dados locais para o backend
   */
  async function syncToBackend() {
    if (state.syncing) {
      console.log('[KBSync] ⏳ Sync já em andamento');
      return;
    }

    if (state.pendingChanges.size === 0) {
      return;
    }

    // Verificar se backend está disponível
    if (!window.BackendClient?.isConnected?.()) {
      console.log('[KBSync] ⚠️ Backend não conectado');
      return;
    }

    state.syncing = true;
    console.log('[KBSync] 📤 Sincronizando para backend...');

    try {
      const keysToSync = [...state.pendingChanges];
      const data = await chrome.storage.local.get(keysToSync);

      for (const key of keysToSync) {
        if (!data[key]) continue;

        const isKB = key === CONFIG.STORAGE_KEYS.KB;

        const endpoint = isKB
          ? '/api/v1/knowledge/sync'
          : '/api/v1/ai/few-shot/sync';

        const body = isKB
          ? { action: 'sync', knowledge: data[key] }
          : { examples: data[key] };

        const response = await window.BackendClient.request(endpoint, {
          method: 'POST',
          body
        });

        // Atualizar cache local com a versão do servidor (evita drift)
        if (response.success) {
          if (isKB && response.knowledge) {
            await chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.KB]: response.knowledge });
          } else if (!isKB && Array.isArray(response.examples)) {
            await chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.FSL]: response.examples });
          }
        }

        if (response.success) {
          state.pendingChanges.delete(key);
          console.log(`[KBSync] ✅ ${key} sincronizado`);
        } else {
          throw new Error(response.error || 'Sync failed');
        }
      }

      state.lastSync = Date.now();
      await saveSyncState();

      // Emitir evento
      if (window.EventBus) {
        window.EventBus.emit('kbSync:toBackend:complete', {
          keys: keysToSync,
          timestamp: state.lastSync
        });
      }

    } catch (error) {
      console.error('[KBSync] ❌ Erro ao sincronizar:', error);
      
      if (window.EventBus) {
        window.EventBus.emit('kbSync:error', { error: error.message, direction: 'toBackend' });
      }
    } finally {
      state.syncing = false;
    }
  }

  /**
   * Sincroniza dados do backend para local
   */
  async function syncFromBackend() {
    if (state.syncing) return;

    // Verificar se backend está disponível
    if (!window.BackendClient?.isConnected?.()) {
      return;
    }

    state.syncing = true;
    console.log('[KBSync] 📥 Sincronizando do backend...');

    try {
      // Buscar Knowledge Base
      const kbResponse = await window.BackendClient.request('/api/v1/knowledge/sync', {
        method: 'GET',
        params: { since: state.lastSync || 0 }
      });

      if (kbResponse.success && kbResponse.data) {
        await mergeKBData(CONFIG.STORAGE_KEYS.KB, kbResponse.data);
      }

      // Buscar Few-Shot Examples
      const fslResponse = await window.BackendClient.request('/api/v1/examples/list', {
        method: 'GET',
        params: { since: state.lastSync || 0 }
      });

      if (fslResponse.success && Array.isArray(fslResponse.examples)) {
        await mergeKBData(CONFIG.STORAGE_KEYS.FSL, fslResponse.examples);
      }

      state.lastSync = Date.now();
      await saveSyncState();

      console.log('[KBSync] ✅ Sincronização do backend concluída');

      // Emitir evento
      if (window.EventBus) {
        window.EventBus.emit('kbSync:fromBackend:complete', { timestamp: state.lastSync });
      }

    } catch (error) {
      console.error('[KBSync] ❌ Erro ao sincronizar do backend:', error);
    } finally {
      state.syncing = false;
    }
  }

  /**
   * Mescla dados do backend com dados locais
   * @param {string} key - Chave do storage
   * @param {Object|Array} backendData - Dados do backend
   */
  async function mergeKBData(key, backendData) {
    try {
      const localData = await chrome.storage.local.get(key);
      let merged;

      if (Array.isArray(backendData)) {
        // Para arrays (exemplos, FAQs, etc.), mesclar por ID
        const local = Array.isArray(localData[key]) ? localData[key] : [];
        const localMap = new Map(local.map(item => [item.id || item.key, item]));

        for (const item of backendData) {
          const id = item.id || item.key;
          const existing = localMap.get(id);

          if (!existing || (item.updatedAt || 0) > (existing.updatedAt || 0)) {
            localMap.set(id, item);
          }
        }

        merged = Array.from(localMap.values());

      } else if (typeof backendData === 'object') {
        // Para objetos, mesclar campos
        merged = {
          ...(localData[key] || {}),
          ...backendData
        };
      } else {
        merged = backendData;
      }

      await chrome.storage.local.set({ [key]: merged });
      console.log(`[KBSync] ✅ ${key} mesclado com dados do backend`);

    } catch (error) {
      console.error(`[KBSync] Erro ao mesclar ${key}:`, error);
    }
  }

  /**
   * Força sincronização imediata
   * @param {string} direction - 'toBackend', 'fromBackend', ou 'both'
   */
  async function forceSyncNow(direction = 'both') {
    if (direction === 'toBackend' || direction === 'both') {
      // Marcar todas as chaves como pendentes
      state.pendingChanges.add(CONFIG.STORAGE_KEYS.KB);
      state.pendingChanges.add(CONFIG.STORAGE_KEYS.FSL);
      await syncToBackend();
    }

    if (direction === 'fromBackend' || direction === 'both') {
      await syncFromBackend();
    }
  }

  /**
   * Marca dados para sincronização
   * @param {string} type - 'kb' ou 'fsl'
   */
  function markForSync(type) {
    const key = type === 'kb' ? CONFIG.STORAGE_KEYS.KB : CONFIG.STORAGE_KEYS.FSL;
    state.pendingChanges.add(key);
    scheduleSyncToBackend();
  }

  /**
   * Obtém estatísticas de sync
   */
  function getStats() {
    return {
      initialized: state.initialized,
      syncing: state.syncing,
      lastSync: state.lastSync,
      pendingChanges: state.pendingChanges.size,
      pendingKeys: [...state.pendingChanges]
    };
  }

  // API Pública
  window.KnowledgeSyncManager = {
    init,
    syncToBackend,
    syncFromBackend,
    forceSyncNow,
    markForSync,
    getStats
  };

  // Auto-inicializar quando BackendClient estiver pronto
  function tryInit() {
    if (window.BackendClient) {
      init();
    } else {
      setTimeout(tryInit, 1000);
    }
  }

  // Aguardar DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    setTimeout(tryInit, 2000);
  }

  console.log('[KBSync] 📦 Módulo carregado');
})();
