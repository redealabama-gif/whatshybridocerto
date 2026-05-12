/**
 * PEND-MED-008: Tab Coordinator
 * Coordena múltiplas abas do WhatsApp para evitar duplicação de instâncias
 *
 * Usa BroadcastChannel para comunicação entre tabs e implementa leader election
 */
(function() {
  'use strict';

  const CHANNEL_NAME = 'whl_tabs_coordination';
  const HEARTBEAT_INTERVAL = 5000; // 5 segundos
  const LEADER_TIMEOUT = 10000; // 10 segundos

  const state = {
    tabId: `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    isLeader: false,
    channel: null,
    knownTabs: new Map(), // tabId -> lastSeen timestamp
    heartbeatInterval: null,
    leaderCheckInterval: null
  };

  /**
   * Inicializa coordenador de tabs
   */
  function init() {
    try {
      // FIX CRÍTICO: BroadcastChannel não existe em Service Workers MV3.
      // Se algum módulo chamar TabCoordinator.init() no background, lança ReferenceError.
      // Verificamos o contexto antes de tentar criar o canal.
      if (typeof BroadcastChannel === 'undefined') {
        console.warn('[TabCoordinator] BroadcastChannel não disponível neste contexto (Service Worker MV3). Módulo desativado.');
        state.unavailable = true;
        return;
      }

      // FIX: guard de re-entrada — evita canal duplicado em HMR/reload parcial
      if (state.channel) {
        try { state.channel.close(); } catch (_) {}
        state.channel = null;
      }

      state.channel = new BroadcastChannel(CHANNEL_NAME);
      state.channel.onmessage = handleMessage;

      broadcast({
        type: 'TAB_JOINED',
        tabId: state.tabId,
        timestamp: Date.now()
      });

      startHeartbeat();
      startLeaderElection();

      console.log('[TabCoordinator] ✅ Inicializado. Tab ID:', state.tabId);

      // FIX: usa 'pagehide' além de 'beforeunload' para capturar fechamentos
      // abruptos em mobile e em tabs que o browser mata sem disparar beforeunload.
      window.addEventListener('beforeunload', cleanup);
      window.addEventListener('pagehide', cleanup);

      // Cleanup pelo visibilitychange — garante que leaderCheckInterval é limpo
      // mesmo quando a tab fica oculta antes de fechar abruptamente
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          // Anuncia saída antecipada; a próxima tab assume liderança
          try {
            broadcast({ type: 'TAB_LEAVING', tabId: state.tabId, timestamp: Date.now() });
          } catch (_) {}
        }
      });

    } catch (error) {
      console.error('[TabCoordinator] ❌ Erro ao inicializar:', error);
    }
  }

  /**
   * Processar mensagens de outras tabs
   */
  function handleMessage(event) {
    // v9.4.2: defesa em profundidade. BroadcastChannel é mesma-origem em
    // browsers modernos, mas extensões podem ter outras instâncias rodando
    // no mesmo origin. Valida estrutura antes de processar.
    if (!event?.data || typeof event.data !== 'object') return;
    const { type, tabId, timestamp, data } = event.data;
    if (typeof type !== 'string' || typeof tabId !== 'string' || typeof timestamp !== 'number') return;
    // Cap em comprimento de tabId pra prevenir lixo
    if (tabId.length > 100) return;

    if (tabId === state.tabId) return; // Ignorar próprias mensagens

    // Atualizar conhecimento de tabs ativas
    state.knownTabs.set(tabId, timestamp);

    switch (type) {
      case 'TAB_JOINED':
        console.log('[TabCoordinator] 📥 Nova tab detectada:', tabId);
        // Responder com heartbeat
        broadcast({
          type: 'HEARTBEAT',
          tabId: state.tabId,
          timestamp: Date.now(),
          isLeader: state.isLeader
        });
        break;

      case 'HEARTBEAT':
        // Atualizar última atividade da tab
        state.knownTabs.set(tabId, timestamp);
        break;

      case 'TAB_LEFT':
        console.log('[TabCoordinator] 📤 Tab saiu:', tabId);
        state.knownTabs.delete(tabId);
        checkLeadership();
        break;

      case 'LEADER_CLAIM':
        // Outra tab reivindicou liderança
        if (state.isLeader && timestamp > Date.now() - 1000) {
          // Conflito: tab com menor ID vence
          if (tabId < state.tabId) {
            console.log('[TabCoordinator] 🏳️ Cedendo liderança para:', tabId);
            state.isLeader = false;
            emitLeadershipChange();
          }
        }
        // FIX: cancela candidatura pendente se a tab recebida tem ID menor
        // sem isso, two tabs podiam confirmar liderança em paralelo
        if (state._pendingLeaderClaim && tabId < state.tabId) {
          state._pendingLeaderClaim = false;
          console.log('[TabCoordinator] ⏹️ Candidatura cancelada — tab', tabId, 'tem prioridade');
        }
        break;

      case 'ACTION_REQUEST':
        // Apenas líder processa requisições
        if (state.isLeader && data?.action) {
          handleActionRequest(data);
        }
        break;

      case 'ACTION_RESPONSE':
        // Resposta de ação executada
        if (data?.requestId) {
          emitActionResponse(data);
        }
        break;

      default:
        console.warn('[TabCoordinator] ⚠️ Tipo de mensagem desconhecido:', type);
    }
  }

  /**
   * Broadcast mensagem para todas as tabs
   */
  function broadcast(message) {
    if (!state.channel) return;
    if (state.unavailable) return; // SW context — BroadcastChannel não disponível
    try {
      state.channel.postMessage(message);
    } catch (error) {
      console.error('[TabCoordinator] ❌ Erro ao enviar broadcast:', error);
    }
  }

  /**
   * Heartbeat periódico
   */
  function startHeartbeat() {
    if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);

    state.heartbeatInterval = setInterval(() => {
      broadcast({
        type: 'HEARTBEAT',
        tabId: state.tabId,
        timestamp: Date.now(),
        isLeader: state.isLeader
      });

      // Limpar tabs inativas
      cleanupInactiveTabs();
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Remove tabs que não respondem
   */
  function cleanupInactiveTabs() {
    const now = Date.now();
    const timeout = LEADER_TIMEOUT;

    for (const [tabId, lastSeen] of state.knownTabs.entries()) {
      if (now - lastSeen > timeout) {
        console.log('[TabCoordinator] 🗑️ Removendo tab inativa:', tabId);
        state.knownTabs.delete(tabId);
      }
    }
  }

  /**
   * Leader election
   */
  function startLeaderElection() {
    if (state.leaderCheckInterval) clearInterval(state.leaderCheckInterval);

    // FIX CRÍTICO: verificar liderança imediatamente causava race condition —
    // duas tabs iniciando ao mesmo tempo faziam checkLeadership() simultaneamente,
    // ambas se viam como menores ID (knownTabs ainda vazio) e ambas reclamavam liderança.
    // Agora adiciona jitter de 200-700ms antes da primeira verificação,
    // dando tempo para heartbeats iniciais chegarem via BroadcastChannel.
    const jitter = 200 + Math.random() * 500;
    setTimeout(() => checkLeadership(), jitter);

    state.leaderCheckInterval = setInterval(() => {
      checkLeadership();
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Verifica e reivindica liderança se necessário
   * FIX: two-phase commit — candidato aguarda grace period antes de confirmar liderança,
   * permitindo que outros candidatos concorrentes manifestem sua intenção via LEADER_CLAIM.
   */
  function checkLeadership() {
    // v9.4.2 BUG #106: limpar tabs mortas ANTES da decisão. Antes, tab que
    // crashou sem beforeunload/pagehide ficava ~5s em knownTabs (até próximo
    // heartbeat). Se o tab morto tinha ID menor, nenhum outro tab conseguia
    // virar leader durante esse intervalo. Pior: em chrome force-close, o
    // heartbeat também não roda → tab morto nunca era removido.
    cleanupInactiveTabs();

    const activeTabs = Array.from(state.knownTabs.keys());
    const allTabs = [state.tabId, ...activeTabs].sort();

    // Tab com menor ID lexicográfico é o líder
    const shouldBeLeader = allTabs[0] === state.tabId;

    if (shouldBeLeader && !state.isLeader && !state._pendingLeaderClaim) {
      // Phase 1: anuncia intenção mas não assume ainda
      state._pendingLeaderClaim = true;
      broadcast({
        type: 'LEADER_CLAIM',
        tabId: state.tabId,
        timestamp: Date.now()
      });

      // Phase 2: confirma após grace period — se nenhuma tab contestou, assume
      setTimeout(() => {
        if (state._pendingLeaderClaim) {
          state._pendingLeaderClaim = false;
          // v9.4.2: re-limpa tabs mortas antes da reconfirmação
          cleanupInactiveTabs();
          // Reconfirma que ainda deve ser líder (pode ter chegado tab com ID menor)
          const current = Array.from(state.knownTabs.keys());
          const all = [state.tabId, ...current].sort();
          if (all[0] === state.tabId) {
            claimLeadership();
          }
        }
      }, 300); // grace period de 300ms

    } else if (!shouldBeLeader && state.isLeader) {
      state.isLeader = false;
      state._pendingLeaderClaim = false;
      console.log('[TabCoordinator] 👑 Liderança perdida');
      emitLeadershipChange();
    }
  }

  /**
   * Reivindicar liderança
   */
  function claimLeadership() {
    state.isLeader = true;
    console.log('[TabCoordinator] 👑 Liderança reivindicada');

    broadcast({
      type: 'LEADER_CLAIM',
      tabId: state.tabId,
      timestamp: Date.now()
    });

    emitLeadershipChange();
  }

  /**
   * Emitir evento de mudança de liderança
   */
  function emitLeadershipChange() {
    if (window.EventBus) {
      window.EventBus.emit('tab_coordinator:leadership_changed', {
        isLeader: state.isLeader,
        tabId: state.tabId
      });
    }

    window.dispatchEvent(new CustomEvent('whl_leadership_changed', {
      detail: { isLeader: state.isLeader, tabId: state.tabId }
    }));
  }

  /**
   * Processar requisição de ação (apenas líder)
   */
  function handleActionRequest(data) {
    const { action, requestId, params } = data;

    console.log('[TabCoordinator] 🎯 Processando ação:', action);

    // Emitir evento para módulos locais processarem
    if (window.EventBus) {
      window.EventBus.emit('tab_coordinator:action_request', {
        action,
        requestId,
        params
      });
    }
  }

  /**
   * Emitir resposta de ação
   */
  function emitActionResponse(data) {
    if (window.EventBus) {
      window.EventBus.emit('tab_coordinator:action_response', data);
    }
  }

  /**
   * Solicitar ação ao líder
   */
  function requestAction(action, params = {}) {
    return new Promise((resolve) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Timeout de 5 segundos
      const timeout = setTimeout(() => {
        resolve({ success: false, error: 'timeout' });
      }, 5000);

      // Listener para resposta
      const handleResponse = (event) => {
        const data = event.detail || event.data;
        if (data.requestId === requestId) {
          clearTimeout(timeout);
          window.EventBus?.off?.('tab_coordinator:action_response', handleResponse);
          resolve(data);
        }
      };

      if (window.EventBus) {
        window.EventBus.on('tab_coordinator:action_response', handleResponse);
      }

      // Enviar requisição
      broadcast({
        type: 'ACTION_REQUEST',
        tabId: state.tabId,
        timestamp: Date.now(),
        data: {
          action,
          requestId,
          params
        }
      });
    });
  }

  /**
   * Responder requisição de ação
   */
  function respondAction(requestId, result) {
    broadcast({
      type: 'ACTION_RESPONSE',
      tabId: state.tabId,
      timestamp: Date.now(),
      data: {
        requestId,
        result
      }
    });
  }

  /**
   * Cleanup ao fechar tab
   */
  function cleanup() {
    // FIX: guard idempotente — beforeunload + pagehide podem disparar juntos
    if (state._cleanedUp) return;
    state._cleanedUp = true;

    try {
      broadcast({ type: 'TAB_LEFT', tabId: state.tabId, timestamp: Date.now() });
    } catch (_) {}

    // FIX CRÍTICO: nullifica após clearInterval para evitar acúmulo entre sessões
    if (state.heartbeatInterval) {
      clearInterval(state.heartbeatInterval);
      state.heartbeatInterval = null;
    }
    if (state.leaderCheckInterval) {
      clearInterval(state.leaderCheckInterval);
      state.leaderCheckInterval = null;
    }

    if (state.channel) {
      try { state.channel.close(); } catch (_) {}
      state.channel = null;
    }

    console.log('[TabCoordinator] 👋 Tab coordinator finalizado');
  }

  /**
   * Obter estado do coordenador
   */
  function getState() {
    return {
      tabId: state.tabId,
      isLeader: state.isLeader,
      activeTabs: Array.from(state.knownTabs.keys()),
      totalTabs: state.knownTabs.size + 1
    };
  }

  /**
   * FIX PEND-MED-008: Helper to add storage listener with leadership check
   * Only the leader tab will execute the callback, preventing duplicate processing
   *
   * @param {Function} callback - The storage change handler
   * @param {Object} options - Optional configuration
   * @returns {Function} - The wrapped listener function
   */
  function addStorageListener(callback, options = {}) {
    const {
      leaderOnly = true,  // Only leader processes by default
      broadcastToOthers = false  // Optionally broadcast to other tabs
    } = options;

    const wrappedCallback = (changes, areaName) => {
      // If leaderOnly is true and this tab is not the leader, ignore
      if (leaderOnly && !state.isLeader) {
        return;
      }

      // Execute the callback
      callback(changes, areaName);

      // Optionally broadcast the change to other tabs
      if (broadcastToOthers && state.isLeader) {
        broadcast({
          type: 'STORAGE_CHANGED',
          tabId: state.tabId,
          changes,
          areaName,
          timestamp: Date.now()
        });
      }
    };

    // Register the wrapped listener
    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(wrappedCallback);
    }

    return wrappedCallback;  // Return so caller can remove if needed
  }

  /**
   * FIX PEND-MED-008: Execute callback only if this tab is the leader
   * Useful for wrapping existing storage listener code
   */
  function executeIfLeader(callback) {
    if (state.isLeader) {
      return callback();
    }
    return null;
  }

  // API Pública
  window.TabCoordinator = {
    init,
    getState,
    isLeader: () => state.isLeader,
    getTabId: () => state.tabId,
    requestAction,
    respondAction,
    broadcast,
    // FIX PEND-MED-008: New helpers for storage listener coordination
    addStorageListener,
    executeIfLeader
  };

  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('[TabCoordinator] Módulo carregado');

})();
