/**
 * 🤖 Auto-Pilot Sidepanel Handlers
 * 
 * Handlers para a aba Auto-Pilot no sidepanel
 * Conecta a UI à lógica do smartbot-autopilot.js
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  let initialized = false;
  let updateInterval = null;
  let fetching = false;
  let lastFetchAt = 0;
  let remoteState = {
    stats: null,
    config: null,
    blacklist: []
  };
  let lastError = null;

  // ============================================================
  // INICIALIZAÇÃO
  // ============================================================

  function init() {
    if (initialized) return;

    console.log('[AP-Handlers] 🤖 Inicializando handlers do Auto-Pilot...');

    setupControlButtons();
    setupConfigToggles();
    setupEventListeners();
    startStatsUpdate();
    updateUI();
    initialized = true;
    console.log('[AP-Handlers] ✅ Handlers inicializados');
  }

  // ============================================================
  // COMUNICAÇÃO COM O AUTOPILOT (content script em web.whatsapp.com)
  // ============================================================

  async function getWhatsAppTabId() {
    try {
      const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
      if (tabs && tabs[0] && typeof tabs[0].id === 'number') return tabs[0].id;
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url?.includes('web.whatsapp.com') && typeof tab.id === 'number') return tab.id;
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

    return null;
  }

  function sendMessageToTab(tabId, message) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { success: false, error: 'Sem resposta do content script' });
        });
      } catch (e) {
        resolve({ success: false, error: e?.message || String(e) });
      }
    });
  }

  async function autopilotCmd(command, payload = {}) {
    const tabId = await getWhatsAppTabId();
    if (!tabId) return { success: false, error: 'WhatsApp Web não encontrado' };
    return await sendMessageToTab(tabId, { action: 'WHL_AUTOPILOT_CMD', command, payload });
  }

  async function refreshRemoteState(force = false) {
    const now = Date.now();
    if (!force && fetching) return;
    if (!force && now - lastFetchAt < 900) return;

    fetching = true;
    lastFetchAt = now;

    try {
      const res = await autopilotCmd('getState');
      if (res?.success) {
        remoteState.stats = res.stats || null;
        remoteState.config = res.config || null;
        remoteState.blacklist = Array.isArray(res.blacklist) ? res.blacklist : [];
        lastError = null;
      } else {
        // Mensagens mais úteis que "Desconectado" cru. O erro nativo do Chrome
        // costuma ser "The message port closed before a response was received"
        // ou "Could not establish connection" — ambos indicam que a aba do WA
        // ainda não carregou o content script ou está numa URL diferente.
        const raw = String(res?.error || '');
        if (!res || raw.includes('port closed') || raw.includes('Could not establish')) {
          lastError = 'Aguardando WhatsApp Web carregar (abra a aba e tente novamente)';
        } else if (raw.includes('não encontrado') || raw.includes('not found')) {
          lastError = 'Abra https://web.whatsapp.com numa aba';
        } else {
          lastError = raw || 'Sem resposta do WhatsApp Web';
        }
        remoteState.stats = null;
      }
    } catch (e) {
      lastError = e?.message || String(e);
      remoteState.stats = null;
    } finally {
      fetching = false;
    }
  }

  // ============================================================
  // BOTÕES DE CONTROLE
  // ============================================================

  function setupControlButtons() {
    const startBtn = document.getElementById('ap_btn_start');
    const pauseBtn = document.getElementById('ap_btn_pause');
    const resumeBtn = document.getElementById('ap_btn_resume');
    const stopBtn = document.getElementById('ap_btn_stop');
    const clearLogBtn = document.getElementById('ap_clear_log');
    const addBlacklistBtn = document.getElementById('ap_add_current_to_blacklist');

    if (startBtn) {
      startBtn.addEventListener('click', async () => {
        const res = await autopilotCmd('start');
        if (res?.success) {
          addLogEntry('info', 'Auto-Pilot iniciado');
          await refreshRemoteState(true);
          updateUI();
        } else {
          addLogEntry('error', res?.error || 'Falha ao iniciar Auto-Pilot');
        }
      });
    }

    if (pauseBtn) {
      pauseBtn.addEventListener('click', async () => {
        const res = await autopilotCmd('pause');
        if (res?.success) {
          addLogEntry('info', 'Auto-Pilot pausado');
          await refreshRemoteState(true);
          updateUI();
        } else {
          addLogEntry('error', res?.error || 'Falha ao pausar Auto-Pilot');
        }
      });
    }

    if (resumeBtn) {
      resumeBtn.addEventListener('click', async () => {
        const res = await autopilotCmd('resume');
        if (res?.success) {
          addLogEntry('info', 'Auto-Pilot retomado');
          await refreshRemoteState(true);
          updateUI();
        } else {
          addLogEntry('error', res?.error || 'Falha ao retomar Auto-Pilot');
        }
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', async () => {
        const res = await autopilotCmd('stop');
        if (res?.success) {
          addLogEntry('info', 'Auto-Pilot parado');
          await refreshRemoteState(true);
          updateUI();
        } else {
          addLogEntry('error', res?.error || 'Falha ao parar Auto-Pilot');
        }
      });
    }

    if (clearLogBtn) {
      clearLogBtn.addEventListener('click', () => {
        const logContainer = document.getElementById('ap_activity_log');
        if (logContainer) {
          logContainer.innerHTML = '<div style="padding: 8px; color: var(--mod-text-muted); text-align: center;">Log limpo</div>';
        }
      });
    }

    if (addBlacklistBtn) {
      addBlacklistBtn.addEventListener('click', async () => {
        const activeRes = await autopilotCmd('getActiveChat');

        if (!activeRes?.success) {
          // Mensagem de erro contextual — antes mostrava o erro cru do Chrome
          // ("port closed...") que confunde o usuário.
          const raw = String(activeRes?.error || '');
          if (raw.includes('port closed') || raw.includes('Could not establish')) {
            addLogEntry('error', 'Aguarde o WhatsApp Web terminar de carregar e tente novamente');
          } else if (raw.includes('WhatsApp Web não encontrado')) {
            addLogEntry('error', 'Abra https://web.whatsapp.com numa aba para usar esta função');
          } else {
            addLogEntry('error', raw || 'Falha ao obter chat ativo');
          }
          return;
        }

        const active = activeRes.activeChat || null;
        const chatId = active?.chatId;
        const label = active?.name || active?.phone || chatId || 'Chat atual';

        if (!chatId) {
          addLogEntry('error', 'Abra uma conversa no WhatsApp antes de adicionar à blacklist');
          return;
        }

        const res = await autopilotCmd('addToBlacklist', { chatId });
        if (res?.success) {
          remoteState.blacklist = Array.isArray(res.blacklist) ? res.blacklist : remoteState.blacklist;
          addLogEntry('info', `${label} adicionado à blacklist`);
          updateBlacklistUI();
        } else {
          addLogEntry('error', res?.error || 'Falha ao adicionar à blacklist');
        }
      });
    }
  }

  // ============================================================
  // CONFIGURAÇÕES
  // ============================================================

  function setupConfigToggles() {
    const skipGroupsToggle = document.getElementById('ap_config_skip_groups');
    const limitSelect = document.getElementById('ap_config_limit');
    const delaySelect = document.getElementById('ap_config_delay');
    const workingHoursToggle = document.getElementById('ap_config_working_hours');
    const startTimeInput = document.getElementById('ap_config_start_time');
    const endTimeInput = document.getElementById('ap_config_end_time');
    const workingHoursConfig = document.getElementById('ap_working_hours_config');

    if (skipGroupsToggle) {
      skipGroupsToggle.addEventListener('change', async (e) => {
        const checked = !!e.target.checked;
        const res = await autopilotCmd('setConfig', { config: { SKIP_GROUPS: checked } });
        if (res?.success) {
          addLogEntry('info', `Pular grupos: ${checked ? 'Ativado' : 'Desativado'}`);
          await refreshRemoteState(true);
        } else {
          addLogEntry('error', res?.error || 'Falha ao aplicar configuração (SKIP_GROUPS)');
        }
      });
    }

    if (limitSelect) {
      limitSelect.addEventListener('change', async (e) => {
        const value = parseInt(e.target.value, 10);
        const res = await autopilotCmd('setConfig', { config: { MAX_RESPONSES_PER_HOUR: value } });
        if (res?.success) {
          addLogEntry('info', `Limite: ${value} respostas/hora`);
          await refreshRemoteState(true);
        } else {
          addLogEntry('error', res?.error || 'Falha ao aplicar configuração (MAX_RESPONSES_PER_HOUR)');
        }
      });
    }

    if (delaySelect) {
      delaySelect.addEventListener('change', async (e) => {
        const value = parseInt(e.target.value, 10);
        const res = await autopilotCmd('setConfig', { config: { DELAY_BETWEEN_CHATS: value } });
        if (res?.success) {
          addLogEntry('info', `Delay: ${Math.round(value / 1000)}s entre chats`);
          await refreshRemoteState(true);
        } else {
          addLogEntry('error', res?.error || 'Falha ao aplicar configuração (DELAY_BETWEEN_CHATS)');
        }
      });
    }

    if (workingHoursToggle && workingHoursConfig) {
      workingHoursToggle.addEventListener('change', (e) => {
        workingHoursConfig.style.display = e.target.checked ? 'block' : 'none';
        updateWorkingHours();
      });
    }

    if (startTimeInput) {
      startTimeInput.addEventListener('change', updateWorkingHours);
    }

    if (endTimeInput) {
      endTimeInput.addEventListener('change', updateWorkingHours);
    }
  }

  function updateWorkingHours() {
    const toggle = document.getElementById('ap_config_working_hours');
    const startTime = document.getElementById('ap_config_start_time');
    const endTime = document.getElementById('ap_config_end_time');

    if (toggle && startTime && endTime) {
      const enabled = toggle.checked;
      const start = parseInt(startTime.value.split(':')[0]) || 8;
      const end = parseInt(endTime.value.split(':')[0]) || 22;

      autopilotCmd('setConfig', {
        config: {
          WORKING_HOURS: { enabled, start, end }
        }
      }).then(res => {
        if (!res?.success) {
          addLogEntry('error', res?.error || 'Falha ao aplicar configuração (WORKING_HOURS)');
        }
      });

      if (enabled) {
        addLogEntry('info', `Horário: ${startTime.value} - ${endTime.value}`);
      }
    }
  }

  // ============================================================
  // EVENT LISTENERS
  // ============================================================

  function setupEventListeners() {
    if (!chrome?.runtime?.onMessage?.addListener) return;

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type !== 'WHL_AUTOPILOT_EVENT') return;

      const event = msg.event;
      const detail = msg.detail || {};

      switch (event) {
        case 'started':
          addLogEntry('success', '✅ Auto-Pilot iniciado');
          break;
        case 'paused':
          if (detail.reason === 'working_hours') {
            const mins = detail.retryIn ? Math.max(1, Math.round(detail.retryIn / 60000)) : null;
            addLogEntry('info', mins ? `⏰ Fora do horário (retoma em ~${mins} min)` : '⏰ Fora do horário configurado');
          } else {
            addLogEntry('info', '⏸️ Auto-Pilot pausado');
          }
          break;
        case 'resumed':
          addLogEntry('success', '▶️ Auto-Pilot retomado');
          break;
        case 'stopped':
          addLogEntry('info', '⏹️ Auto-Pilot parado');
          break;
        case 'messageSent':
          addLogEntry('success', `📤 Mensagem enviada para ${detail.chatId || detail.phone || 'contato'}`);
          break;
        case 'suggestion-only':
          addLogEntry('info', `💡 Sugestão sem envio (${detail.reason || 'regra'})`);
          break;
        case 'limitReached':
          addLogEntry('info', '⚠️ Rate limit/intervalo mínimo atingido');
          break;
        case 'backend-error':
          addLogEntry('error', `⚠️ Backend indisponível: ${detail.error || 'erro'}`);
          break;
        case 'error':
          addLogEntry('error', `❌ Erro: ${detail.error || 'Desconhecido'}`);
          break;
        default:
          // Ignorar eventos desconhecidos
          break;
      }

      // Atualizar UI após eventos
      refreshRemoteState(true)
        .then(() => updateUI())
        .catch((e) => console.warn('[AutoPilotHandlers] Falha ao atualizar UI após evento:', e?.message || e));
    });
  }

  // ============================================================
  // ATUALIZAÇÃO DE UI
  // ============================================================

  function startStatsUpdate() {
    // Atualiza a cada 2 segundos
    updateInterval = setInterval(() => {
      if (document.getElementById('whlViewAutoPilot') && 
          !document.getElementById('whlViewAutoPilot').classList.contains('hidden')) {
        updateUI();
      }
    }, 2000);
  }

  async function updateUI() {
    await refreshRemoteState(false);

    const stats = remoteState.stats || {
      _disconnected: true,
      isRunning: false,
      isPaused: false,
      pendingChats: 0,
      totalSent: 0,
      totalSkipped: 0,
      totalErrors: 0,
      responsesThisHour: 0
    };

    const config = remoteState.config || {};

    updateStatus(stats);
    updateStats(stats);
    updateButtons(stats);
    updateProgress(stats, config);
    updateBlacklistUI();
  }

  function updateStatus(stats) {
    const statusCard = document.getElementById('autopilot_status_card');
    const statusIndicator = document.getElementById('autopilot_status_indicator');
    const statusText = document.getElementById('autopilot_status_text');
    const statusDetail = document.getElementById('autopilot_status_detail');
    const statusBadge = document.getElementById('autopilot_status_badge');

    if (!statusCard) return;

    // Remove classes anteriores
    statusCard.classList.remove('ap-status-running', 'ap-status-paused');

    // Desconectado do WhatsApp/content script
    if (stats?._disconnected) {
      if (statusIndicator) statusIndicator.innerHTML = '⚠️';
      if (statusText) statusText.textContent = 'Desconectado';
      if (statusDetail) statusDetail.textContent = lastError || 'Abra o WhatsApp Web para usar o Auto-Pilot';
      if (statusBadge) {
        statusBadge.textContent = 'OFFLINE';
        statusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
        statusBadge.style.color = '#ef4444';
      }
      return;
    }

    if (!stats.isRunning) {
      // PARADO
      if (statusIndicator) statusIndicator.innerHTML = '⏹️';
      if (statusText) statusText.textContent = 'Parado';
      if (statusDetail) statusDetail.textContent = 'Clique em Iniciar para começar';
      if (statusBadge) {
        statusBadge.textContent = 'PARADO';
        statusBadge.style.background = 'rgba(107, 114, 128, 0.2)';
        statusBadge.style.color = '#9ca3af';
      }
    } else if (stats.isPaused) {
      // PAUSADO
      statusCard.classList.add('ap-status-paused');
      if (statusIndicator) statusIndicator.innerHTML = '⏸️';
      if (statusText) statusText.textContent = 'Pausado';
      if (statusDetail) statusDetail.textContent = 'Clique em Continuar para retomar';
      if (statusBadge) {
        statusBadge.textContent = 'PAUSADO';
        statusBadge.style.background = 'rgba(245, 158, 11, 0.2)';
        statusBadge.style.color = '#f59e0b';
      }
    } else {
      // ATIVO
      statusCard.classList.add('ap-status-running');
      if (statusIndicator) statusIndicator.innerHTML = '🤖';
      if (statusText) statusText.textContent = 'Ativo';
      const pending = stats.pendingChats || 0;
      if (statusDetail) {
        statusDetail.textContent = pending > 0 
          ? `Processando... ${pending} chat(s) na fila`
          : 'Aguardando novas mensagens';
      }
      if (statusBadge) {
        statusBadge.textContent = 'ATIVO';
        statusBadge.style.background = 'rgba(16, 185, 129, 0.2)';
        statusBadge.style.color = '#10b981';
      }
    }
  }

  function updateStats(stats) {
    if (!stats) return;

    const sentEl = document.getElementById('ap_stat_sent');
    const pendingEl = document.getElementById('ap_stat_pending');
    const skippedEl = document.getElementById('ap_stat_skipped');
    const errorsEl = document.getElementById('ap_stat_errors');

    if (sentEl) sentEl.textContent = stats.totalSent || 0;
    if (pendingEl) pendingEl.textContent = stats.pendingChats || 0;
    if (skippedEl) skippedEl.textContent = stats.totalSkipped || 0;
    if (errorsEl) errorsEl.textContent = stats.totalErrors || 0;
  }

  function updateButtons(stats) {
    const startBtn = document.getElementById('ap_btn_start');
    const pauseBtn = document.getElementById('ap_btn_pause');
    const resumeBtn = document.getElementById('ap_btn_resume');
    const stopBtn = document.getElementById('ap_btn_stop');

    if (!stats.isRunning) {
      // PARADO
      if (startBtn) startBtn.style.display = 'flex';
      if (pauseBtn) pauseBtn.style.display = 'none';
      if (resumeBtn) resumeBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'none';
    } else if (stats.isPaused) {
      // PAUSADO
      if (startBtn) startBtn.style.display = 'none';
      if (pauseBtn) pauseBtn.style.display = 'none';
      if (resumeBtn) resumeBtn.style.display = 'flex';
      if (stopBtn) stopBtn.style.display = 'flex';
    } else {
      // ATIVO
      if (startBtn) startBtn.style.display = 'none';
      if (pauseBtn) pauseBtn.style.display = 'flex';
      if (resumeBtn) resumeBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'flex';
    }
  }

  function updateProgress(stats, config) {
    const progressBar = document.getElementById('ap_progress_bar');
    const progressText = document.getElementById('ap_progress_text');

    const limit = config.MAX_RESPONSES_PER_HOUR || 30;
    const current = stats.responsesThisHour || 0;
    const percent = Math.min((current / limit) * 100, 100);

    if (progressBar) {
      progressBar.style.width = `${percent}%`;
      
      // Cor baseada no progresso
      if (percent >= 90) {
        progressBar.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
      } else if (percent >= 70) {
        progressBar.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
      } else {
        progressBar.style.background = 'linear-gradient(90deg, var(--mod-primary), var(--mod-accent))';
      }
    }

    if (progressText) {
      progressText.textContent = `${current} / ${limit}`;
    }
  }

  function updateBlacklistUI() {
    const container = document.getElementById('ap_blacklist');
    if (!container) return;

    const blacklist = Array.isArray(remoteState.blacklist) ? remoteState.blacklist : [];

    if (blacklist.length === 0) {
      container.innerHTML = '<div style="color: var(--mod-text-muted); font-size: 11px; text-align: center;">Nenhum contato na lista</div>';
      return;
    }

    container.innerHTML = blacklist.map(item => `
      <div class="ap-blacklist-item">
        <span class="name">${escapeHtml(item)}</span>
        <button class="remove" data-id="${escapeHtml(item)}" title="Remover">×</button>
      </div>
    `).join('');

    // Event listeners para remover
    container.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        autopilotCmd('removeFromBlacklist', { id }).then(async (res) => {
          if (res?.success) {
            remoteState.blacklist = Array.isArray(res.blacklist) ? res.blacklist : remoteState.blacklist;
            addLogEntry('info', `${id} removido da blacklist`);
            updateBlacklistUI();
          } else {
            addLogEntry('error', res?.error || 'Falha ao remover da blacklist');
          }
        });
      });
    });
  }

  // ============================================================
  // LOG DE ATIVIDADES
  // ============================================================

  function addLogEntry(type, message) {
    const container = document.getElementById('ap_activity_log');
    if (!container) return;

    // Remove mensagem de "nenhuma atividade"
    const emptyMsg = container.querySelector('div[style*="text-align: center"]');
    if (emptyMsg && container.children.length === 1) {
      emptyMsg.remove();
    }

    const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const entry = document.createElement('div');
    entry.className = `ap-log-entry ${type}`;
    entry.innerHTML = `
      <span class="time">${time}</span>
      <span class="message">${escapeHtml(message)}</span>
    `;

    container.insertBefore(entry, container.firstChild);

    // Limita a 50 entradas
    while (container.children.length > 50) {
      container.removeChild(container.lastChild);
    }
  }

  // ============================================================
  // UTILIDADES
  // ============================================================

  function escapeHtml(text) {
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(text);
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================================
  // INICIALIZAÇÃO
  // ============================================================

  // Aguarda DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Cleanup ao descarregar (evita leaks no sidepanel)
  window.addEventListener('beforeunload', () => {
    if (updateInterval) clearInterval(updateInterval);
    updateInterval = null;
  });

  // Expõe para debug
  window.APHandlers = {
    updateUI,
    addLogEntry
  };

})();