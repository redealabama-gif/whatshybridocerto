// ===== STRICT MODE =====
'use strict';

// =============================================================================
// Campaign/Worker + Recover sync handlers (extracted from background.js)
// =============================================================================

const SEND_MESSAGE_TIMEOUT_MS = 45000; // 45 seconds timeout for message sending

// ===== WORKER TAB MANAGEMENT =====

let workerTabId = null;
let campaignQueue = [];
let campaignState = {
  isRunning: false,
  isPaused: false,
  currentIndex: 0
};

// v9.4.0 BUG #85 FIX: Service workers em manifest v3 dormem/morrem após ~30s idle.
// Quando acordam, variáveis module-level voltam ao default.
// chrome.runtime.onInstalled SÓ roda em install/update — NÃO em wake-up.
// Sem este restore, campanhas em andamento ficavam órfãs no storage e o cliente
// perdia progresso (ou pior, reiniciava do zero ao tentar retomar).
// Solução: restaurar state TODA vez que o módulo carrega (incluindo wake-ups).
let _restorePromise = null;
function restoreCampaignStateFromStorage() {
  if (_restorePromise) return _restorePromise;
  _restorePromise = new Promise((resolve) => {
    try {
      chrome.storage.local.get(['workerTabId', 'campaignQueue', 'campaignState'], (data) => {
        if (data.workerTabId) workerTabId = data.workerTabId;
        if (Array.isArray(data.campaignQueue)) campaignQueue = data.campaignQueue;
        if (data.campaignState && typeof data.campaignState === 'object') {
          campaignState = {
            isRunning: !!data.campaignState.isRunning,
            isPaused: !!data.campaignState.isPaused,
            currentIndex: Number(data.campaignState.currentIndex) || 0,
            config: data.campaignState.config || null,
            scheduleId: data.campaignState.scheduleId || null,
          };
        }
        if (campaignState.isRunning && !campaignState.isPaused) {
          console.log('[WHL Background] 🔄 Restored running campaign:', campaignState.currentIndex, '/', campaignQueue.length);
        }
        resolve();
      });
    } catch (e) {
      console.warn('[WHL Background] restoreCampaignState failed:', e);
      resolve();
    }
  });
  return _restorePromise;
}
// Dispara o restore IMEDIATAMENTE quando o módulo carrega.
restoreCampaignStateFromStorage();

// Também no startup do navegador (extensão liga junto)
if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    _restorePromise = null; // força re-leitura
    restoreCampaignStateFromStorage();
  });
}

// Initialize worker state on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['workerTabId', 'campaignQueue', 'campaignState'], (data) => {
    if (data.workerTabId) {
      // Check if the tab still exists
      chrome.tabs.get(data.workerTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          workerTabId = null;
          chrome.storage.local.remove('workerTabId');
        } else {
          workerTabId = data.workerTabId;
        }
      });
    }
    if (data.campaignQueue) campaignQueue = data.campaignQueue;
    if (data.campaignState) campaignState = data.campaignState;
  });
});

function handleCheckIfWorker(_message, sender, sendResponse) {
  sendResponse({ isWorker: sender.tab?.id === workerTabId });
}

function handleWorkerReady(_message, _sender, sendResponse) {
  console.log('[WHL Background] Worker tab ready');
  // v9.4.0: aguarda restore antes de checar isRunning — se service worker
  // tinha morrido, sem await aqui isRunning sempre seria false (default)
  // e campanha pendente não retomava.
  restoreCampaignStateFromStorage().then(() => {
    if (campaignState.isRunning && !campaignState.isPaused) {
      processNextInQueue();
    }
  });
  sendResponse({ success: true });
}

function handleWorkerStatus(message, _sender, sendResponse) {
  console.log('[WHL Background] Worker status:', message.status);
  notifyPopup({ action: 'WORKER_STATUS_UPDATE', status: message.status });
  sendResponse({ success: true });
}

function handleWorkerError(message, _sender, sendResponse) {
  console.error('[WHL Background] Worker error:', message.error);
  notifyPopup({ action: 'WORKER_ERROR', error: message.error });
  sendResponse({ success: true });
}

async function handleStartCampaign(message, _sender, sendResponse) {
  const { queue, config } = message;
  const result = await startCampaign(queue, config);
  sendResponse(result);
}

async function handleStartScheduledCampaign(message, _sender, sendResponse) {
  try {
    const { scheduleId, queue, config } = message;
    
    // Validate required parameters
    if (!scheduleId) {
      throw new Error('scheduleId is required');
    }
    if (!queue || !Array.isArray(queue) || queue.length === 0) {
      throw new Error('queue must be a non-empty array');
    }
    if (!config || typeof config !== 'object') {
      throw new Error('config must be an object');
    }
    
    console.log('[WHL Background] Starting scheduled campaign:', scheduleId);
    
    const result = await startCampaign(queue, config, scheduleId);
    sendResponse(result);
  } catch (error) {
    console.error('[WHL Background] Error starting scheduled campaign:', error);
    sendResponse({ success: false, error: error.message });
  }
}

function handlePauseCampaign(_message, _sender, sendResponse) {
  campaignState.isPaused = true;
  saveCampaignState();
  sendResponse({ success: true });
}

function handleResumeCampaign(_message, _sender, sendResponse) {
  campaignState.isPaused = false;
  saveCampaignState();
  processNextInQueue();
  sendResponse({ success: true });
}

function handleStopCampaign(_message, _sender, sendResponse) {
  campaignState.isRunning = false;
  campaignState.isPaused = false;
  saveCampaignState();
  sendResponse({ success: true });
}

function handleGetCampaignStatus(_message, _sender, sendResponse) {
  sendResponse({
    ...campaignState,
    queue: campaignQueue,
    workerActive: workerTabId !== null
  });
}

async function startCampaign(queue, config, scheduleId = null) {
  console.log('[WHL Background] Starting campaign with', queue?.length, 'contacts');

  // v9.4.0 BUG #90: validar inputs antes de gravar em chrome.storage.local
  // (cota default ~5MB — payload muito grande quebra extensão).
  if (!Array.isArray(queue)) {
    return { success: false, error: 'queue deve ser um array' };
  }
  if (queue.length === 0) {
    return { success: false, error: 'queue vazia' };
  }
  if (queue.length > 50000) {
    return { success: false, error: 'queue acima de 50.000 contatos. Divida em campanhas menores.' };
  }
  if (!config || typeof config !== 'object') {
    return { success: false, error: 'config inválida' };
  }
  // WhatsApp permite ~4096 chars/msg. 10k é muito acima da realidade.
  if (typeof config.message === 'string' && config.message.length > 10000) {
    return { success: false, error: 'message muito longa (max 10.000 chars)' };
  }
  // imageData é base64, ~30% inflate. 8MB base64 ≈ 6MB binary — limite WhatsApp.
  if (typeof config.imageData === 'string' && config.imageData.length > 8_000_000) {
    return { success: false, error: 'imageData muito grande (max 8MB em base64)' };
  }

  campaignQueue = queue;
  campaignState = {
    isRunning: true,
    isPaused: false,
    currentIndex: 0,
    config: config,
    scheduleId: scheduleId // Store scheduleId to update status later
  };

  saveCampaignState();

  // Start processing directly
  processNextInQueue();
  
  return { success: true };
}

// Helper function to update schedule status
async function updateScheduleStatus(scheduleId, status, completedAt = null) {
  if (!scheduleId) return;
  
  try {
    const data = await chrome.storage.local.get('whl_schedules');
    const schedules = data.whl_schedules || [];
    const schedule = schedules.find(s => s.id === scheduleId);
    
    if (schedule) {
      schedule.status = status;
      if (completedAt) {
        schedule.completedAt = completedAt;
      }
      await chrome.storage.local.set({ whl_schedules: schedules });
      console.log('[WHL Background] ✅ Schedule status updated:', scheduleId, '->', status);
      
      // Notificar sidepanel sobre mudança de status
      chrome.runtime.sendMessage({
        action: 'SCHEDULE_STATUS_CHANGED',
        scheduleId: scheduleId,
        status: status,
        schedule: schedule
      }).catch(() => {
        // Sidepanel pode estar fechado
      });
    } else {
      console.warn('[WHL Background] Schedule not found for status update:', scheduleId);
    }
  } catch (e) {
    console.error('[WHL Background] Error updating schedule status:', e);
  }
}

// ===== SCHEDULER: Handle Alarms =====
chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    // Check if it's a scheduler alarm
    if (alarm.name.startsWith('whl_schedule_')) {
      const scheduleId = alarm.name.replace('whl_schedule_', '');
      console.log('[WHL Background] ⏰ Alarm fired for schedule:', scheduleId);
      
      // Fetch schedule data from storage
      const data = await chrome.storage.local.get('whl_schedules');
      const schedules = data.whl_schedules || [];
      const schedule = schedules.find(s => s.id === scheduleId);
      
      if (!schedule) {
        console.error('[WHL Background] Schedule not found with ID:', scheduleId);
        return;
      }
      
      if (schedule.status !== 'pending') {
        console.log('[WHL Background] Schedule already executed with status:', schedule.status);
        return;
      }
      
      // Validate schedule data
      if (!schedule.queue || !Array.isArray(schedule.queue) || schedule.queue.length === 0) {
        console.error('[WHL Background] Schedule has invalid or empty queue:', scheduleId);
        await updateScheduleStatus(scheduleId, 'failed');
        return;
      }
      
      if (!schedule.config || typeof schedule.config !== 'object') {
        console.error('[WHL Background] Schedule has invalid config:', scheduleId);
        await updateScheduleStatus(scheduleId, 'failed');
        return;
      }
      
      console.log('[WHL Background] 🚀 Starting scheduled campaign:', schedule.name);
      
      // Update status to 'running'
      await updateScheduleStatus(scheduleId, 'running');
      
      // Start campaign directly in background
      try {
        const result = await startCampaign(schedule.queue, schedule.config, scheduleId);
        
        if (result.success) {
          console.log('[WHL Background] ✅ Scheduled campaign started:', schedule.name);
          
          // Send notification (optional - if active listeners are available)
          chrome.runtime.sendMessage({
            action: 'SCHEDULE_STARTED',
            scheduleName: schedule.name
          }).catch(() => {
            // No active listeners available, that's okay
          });
        } else {
          console.error('[WHL Background] ❌ Failed to start scheduled campaign:', result.error);
          await updateScheduleStatus(scheduleId, 'failed');
        }
      } catch (error) {
        console.error('[WHL Background] ❌ Exception starting scheduled campaign:', error);
        await updateScheduleStatus(scheduleId, 'failed');
      }
    }

    // PEND-MED-007: Handle task reminder alarm
    if (alarm.name === 'whl_task_reminder_check') {
      console.log('[WHL Background] ⏰ Task reminder check alarm fired');

      try {
        // Verificar lembretes de tarefas
        // FIX PEND-MED-007: Use correct storage key (whl_tasks_v2, not whl_tasks)
        const result = await chrome.storage.local.get('whl_tasks_v2');
        const tasks = result.whl_tasks_v2 || [];
        const now = Date.now();

        tasks.forEach(task => {
          // Verificar se o lembrete está pronto para ser exibido
          if (task.status === 'pending' || task.status === 'in_progress') {
            if (task.reminderDate && !task.reminderShown) {
              const reminderTime = new Date(task.reminderDate).getTime();

              // 2 minutos de tolerância
              if (reminderTime <= now && reminderTime > now - 120000) {
                // Mostrar notificação
                chrome.notifications.create(`whl_task_${task.id}`, {
                  type: 'basic',
                  iconUrl: chrome.runtime.getURL('icons/icon128.png'),
                  title: `⏰ Lembrete: ${task.title}`,
                  message: task.description || 'Tarefa agendada',
                  priority: task.priority === 'urgent' || task.priority === 'high' ? 2 : 1,
                  requireInteraction: true
                });

                // Marcar como exibido
                task.reminderShown = true;
                console.log('[WHL Background] ✅ Reminder shown for task:', task.title);
              }
            }
          }
        });

        // Salvar estado atualizado
        // FIX PEND-MED-007: Use correct storage key
        await chrome.storage.local.set({ whl_tasks_v2: tasks });
      } catch (error) {
        console.error('[WHL Background] ❌ Error checking task reminders:', error);
      }
    }

    // FIX: Handler para alarms de campanhas agendadas (criados por CampaignManager.scheduleExecution)
    if (alarm.name.startsWith('whl_campaign_')) {
      try {
        const result = await chrome.storage.local.get('whl_campaign_alarms');
        const alarmMap = result.whl_campaign_alarms || {};
        const campaignId = alarmMap[alarm.name];
        if (campaignId) {
          console.log('[WHL Background] ⏰ Alarm de campanha disparado:', campaignId);
          // Notifica todos os content scripts para executar a campanha
          const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
          for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'WHL_EXECUTE_CAMPAIGN',
              campaignId
            }).catch(() => {});
          }
          // Remove o mapeamento após disparar
          delete alarmMap[alarm.name];
          await chrome.storage.local.set({ whl_campaign_alarms: alarmMap });
        }
      } catch (error) {
        console.error('[WHL Background] ❌ Erro ao processar alarm de campanha:', error);
      }
    }
  } catch (error) {
    console.error('[WHL Background] Error handling alarm:', error);
  }
});

// Handler: Broadcast recover messages
function handleRecoverNewMessage(message, _sender, _sendResponse) {
  // Broadcast para todos os contextos (incluindo sidepanel)
  chrome.runtime.sendMessage(message).catch(() => {
    // Ignorar erros se sidepanel não estiver aberto
  });
}

// Handler: Sync recover history to chrome.storage
async function syncRecoverHistory(history) {
  try {
    const safeHistory = Array.isArray(history) ? history : [];
    await chrome.storage.local.set({ whl_recover_history: safeHistory });
    return { success: true };
  } catch (error) {
    console.error('[WHL Background] Erro em syncRecoverHistory:', error);
    return { success: false, error: error.message };
  }
}

function handleSyncRecoverHistory(message, _sender, sendResponse) {
  try {
    console.log('[WHL Background] 📥 Syncing recover history:', message.history?.length, 'messages');
    syncRecoverHistory(message.history).then((result) => {
      console.log('[WHL Background] ✅ Recover history saved to chrome.storage');
      sendResponse(result);
    }).catch((error) => {
      console.error('[WHL Background] Erro em syncRecoverHistory:', error);
      sendResponse({ success: false, error: error.message });
    });
  } catch (error) {
    console.error('[WHL Background] Erro em handleSyncRecoverHistory:', error);
    sendResponse({ success: false, error: error.message });
  }
  return true;
}

// ===== ENVIO SIMPLIFICADO =====
// Usar a aba principal do WhatsApp Web ao invés de worker incógnito

async function sendMessageToWhatsApp(phone, text, imageData = null, audioData = null, fileData = null) {
  // Encontrar aba do WhatsApp Web
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  
  if (tabs.length === 0) {
    return { success: false, error: 'WhatsApp Web não está aberto' };
  }
  
  // Prefer the "normal" WhatsApp Web tab (not the hidden worker tab)
  // Worker tabs usually include ?whl_worker=true and don't load the full sender bridge.
  const nonWorkerTabs = tabs.filter(t => {
    if (!t || typeof t.id !== 'number') return false;
    if (workerTabId && t.id === workerTabId) return false;
    const url = String(t.url || '');
    return !url.includes('whl_worker');
  });

  const whatsappTab = nonWorkerTabs[0] || tabs[0];
  
  try {
    // Enviar mensagem para o content script
    const result = await chrome.tabs.sendMessage(whatsappTab.id, {
      action: 'SEND_MESSAGE_URL',
      phone: phone,
      text: text,
      imageData: imageData,
      audioData: audioData,
      fileData: fileData
    });
    
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Helper: timeout para evitar travas
function withTimeout(promise, ms = 45000) {
  let t;
  const timeout = new Promise((_, rej) => 
    t = setTimeout(() => rej(new Error('TIMEOUT')), ms)
  );
  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

async function processNextInQueue() {
  if (!campaignState.isRunning || campaignState.isPaused) {
    return;
  }
  
  if (campaignState.currentIndex >= campaignQueue.length) {
    console.log('[WHL Background] 🎉 Campanha finalizada!');
    campaignState.isRunning = false;
    saveCampaignState();
    notifyPopup({ action: 'CAMPAIGN_COMPLETED' });
    
    // Update schedule status if this was a scheduled campaign
    if (campaignState.scheduleId) {
      await updateScheduleStatus(campaignState.scheduleId, 'completed', new Date().toISOString());
    }
    
    return;
  }
  
  // VERIFICAÇÃO ANTI-BAN: Checar limite antes de enviar
  try {
    const antiBanData = await chrome.storage.local.get('whl_anti_ban_data');
    const antiBan = antiBanData.whl_anti_ban_data || { sentToday: 0, dailyLimit: 200, businessHoursOnly: false };
    
    // Verificar reset diário
    const today = new Date().toISOString().split('T')[0];
    if (antiBan.lastResetDate !== today) {
      antiBan.sentToday = 0;
      antiBan.lastResetDate = today;
      await chrome.storage.local.set({ whl_anti_ban_data: antiBan });
    }
    
    // Verificar limite diário
    if (antiBan.sentToday >= (antiBan.dailyLimit || 200)) {
      console.warn(`[WHL Background] ⛔ ANTI-BAN: Limite diário atingido (${antiBan.sentToday}/${antiBan.dailyLimit})`);
      campaignState.isRunning = false;
      campaignState.isPaused = true;
      saveCampaignState();
      notifyPopup({ 
        action: 'ANTIBAN_LIMIT_REACHED', 
        message: `Limite diário atingido (${antiBan.sentToday}/${antiBan.dailyLimit || 200}). Campanha pausada.`
      });
      
      // Update schedule status
      if (campaignState.scheduleId) {
        await updateScheduleStatus(campaignState.scheduleId, 'paused_limit');
      }
      return;
    }
    
    // Verificar horário comercial (se ativado)
    if (antiBan.businessHoursOnly) {
      const hour = new Date().getHours();
      if (hour < 8 || hour > 20) {
        console.warn(`[WHL Background] ⛔ ANTI-BAN: Fora do horário comercial (${hour}h)`);
        campaignState.isRunning = false;
        campaignState.isPaused = true;
        saveCampaignState();
        notifyPopup({ 
          action: 'ANTIBAN_BUSINESS_HOURS', 
          message: `Fora do horário comercial (8h-20h). Atual: ${hour}h. Campanha pausada.`
        });
        return;
      }
    }
  } catch (e) {
    console.warn('[WHL Background] Erro ao verificar anti-ban:', e);
  }
  
  const current = campaignQueue[campaignState.currentIndex];
  
  if (!current || current.status === 'sent') {
    campaignState.currentIndex++;
    saveCampaignState();
    processNextInQueue();
    return;
  }

  // Skip invalid/empty numbers (keeps scheduled campaigns consistent with the in-page engine)
  if (!current.phone || current.valid === false) {
    current.status = 'failed';
    current.error = current.error || (current.valid === false ? 'Número inválido' : 'Número vazio');
    campaignState.currentIndex++;
    saveCampaignState();
    notifyPopup({ 
      action: 'SEND_RESULT',
      phone: current.phone || '',
      status: current.status,
      error: current.error
    });
    processNextInQueue();
    return;
  }
  
  console.log(`[WHL Background] Processando ${current.phone} (${campaignState.currentIndex + 1}/${campaignQueue.length})`);
  
  // Update status to "sending"
  current.status = 'sending';
  saveCampaignState();
  notifyPopup({ action: 'CAMPAIGN_PROGRESS', current: campaignState.currentIndex, total: campaignQueue.length });

  // Aplicar substituição de variáveis na mensagem
  const messageToSend = substituirVariaveis(campaignState.config?.message || '', current);

  let result;
  try {
    // Use withTimeout helper to prevent blocking
    result = await withTimeout(
      sendMessageToWhatsApp(
        current.phone,
        messageToSend,
        campaignState.config?.imageData || null
      ),
      SEND_MESSAGE_TIMEOUT_MS
    );
  } catch (err) {
    result = { success: false, error: err.message };
  }

  // v9.4.0 BUG #91: retry em caso de TIMEOUT/erro de rede.
  // Antes: timeout (rede lenta, WhatsApp Web travando) marcava destinatário como
  // failed permanentemente — campanha de 200 perdia 50 contatos legítimos.
  // Agora: até 2 tentativas com erro recuperável antes de marcar failed.
  // INVALID_NUMBER e similares NÃO retentam (não adianta).
  const isRecoverableError = (err) => {
    if (!err) return false;
    const msg = String(err).toLowerCase();
    return msg.includes('timeout') ||
           msg.includes('network') ||
           msg.includes('whatsapp web não') ||
           msg.includes('disconnected');
  };
  if (!result?.success && isRecoverableError(result?.error)) {
    const retries = (current._retries || 0);
    if (retries < 2) {
      current._retries = retries + 1;
      console.warn(`[WHL Background] 🔄 Retry ${current._retries}/2 para ${current.phone}: ${result.error}`);
      saveCampaignState();
      // Aguarda 5s antes de retry e re-processa MESMO índice
      setTimeout(() => processNextInQueue(), 5000);
      return;
    }
  }

  // Atualizar status SEMPRE
  if (result && result.success) {
    current.status = 'sent';
    console.log(`[WHL Background] ✅ Enviado para ${current.phone}`);

    // v9.4.3 BUG #109: reset contador de falhas consecutivas após sucesso
    campaignState.consecutiveFailures = 0;
    
    // IMPORTANTE: Incrementar contador do anti-ban e notificar UI
    try {
      const antiBanData = await chrome.storage.local.get('whl_anti_ban_data');
      const antiBan = antiBanData.whl_anti_ban_data || { sentToday: 0, dailyLimit: 200 };
      antiBan.sentToday = (antiBan.sentToday || 0) + 1;
      await chrome.storage.local.set({ 
        whl_anti_ban_data: antiBan,
        // Notificar UI via storage change
        whl_antiban_ui_update: {
          sentToday: antiBan.sentToday,
          dailyLimit: antiBan.dailyLimit || 200,
          percentage: Math.round((antiBan.sentToday / (antiBan.dailyLimit || 200)) * 100),
          timestamp: Date.now()
        }
      });
      console.log(`[WHL Background] 📊 Anti-Ban: ${antiBan.sentToday}/${antiBan.dailyLimit || 200}`);
    } catch (e) {
      console.error('[WHL Background] Erro ao atualizar anti-ban:', e);
    }
  } else {
    current.status = 'failed';
    current.error = result?.error || 'Unknown error';
    console.log(`[WHL Background] ❌ Falha: ${current.phone} - ${current.error}`);

    // v9.4.3 BUG #109: auto-pause após 5 falhas consecutivas.
    // Cenário: WhatsApp Web desconecta no meio de campanha → próximos 400
    // destinatários todos falham. Sem auto-pause, cliente perde 400 contatos
    // sem chance de retomar. Com auto-pause em 5 erros seguidos, perde só 5
    // e pode resolver (reconectar WA) e retomar.
    // INVALID_NUMBER não conta (é falha legítima, não infraestrutura).
    const errMsg = String(current.error || '').toLowerCase();
    const isInfraFailure = !errMsg.includes('invalid') && !errMsg.includes('inválido');
    if (isInfraFailure) {
      campaignState.consecutiveFailures = (campaignState.consecutiveFailures || 0) + 1;
      if (campaignState.consecutiveFailures >= 5) {
        console.error(`[WHL Background] ⛔ AUTO-PAUSE: 5 falhas consecutivas. Pausando campanha.`);
        campaignState.isRunning = false;
        campaignState.isPaused = true;
        campaignState.pauseReason = 'consecutive_failures';
        saveCampaignState();
        notifyPopup({
          action: 'CAMPAIGN_AUTO_PAUSED',
          reason: 'consecutive_failures',
          message: `Campanha pausada automaticamente: 5 falhas consecutivas. Verifique sua conexão WhatsApp Web e retome.`,
          consecutiveFailures: campaignState.consecutiveFailures,
          lastError: current.error
        });
        if (campaignState.scheduleId) {
          await updateScheduleStatus(campaignState.scheduleId, 'paused_errors');
        }
        // Atualiza status do current pra refletir que campanha foi pausada
        campaignState.currentIndex++;
        saveCampaignState();
        return;
      }
    }
  }
  
  // Move to next
  campaignState.currentIndex++;
  saveCampaignState();
  
  // Notify popup
  notifyPopup({ 
    action: 'SEND_RESULT', 
    phone: current.phone, 
    status: current.status,
    error: current.error 
  });
  
  // Delay humanizado
  // IMPORTANT:
  // - The Side Panel/UI stores delayMin/delayMax in **seconds** (ex: 2-6).
  // - Some older/legacy paths may have stored these values in **milliseconds**.
  // To keep backwards compatibility, we normalize here.
  const normalizeDelayToMs = (value, fallbackSeconds) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return Math.round(fallbackSeconds * 1000);
    // Heuristic: if it's bigger than 1000, assume it's already milliseconds.
    if (n > 1000) return Math.round(n);
    return Math.round(n * 1000);
  };

  const minDelay = normalizeDelayToMs(campaignState.config?.delayMin, 2);
  const maxDelay = Math.max(
    minDelay,
    normalizeDelayToMs(campaignState.config?.delayMax, 6)
  );
  const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
  
  console.log(`[WHL Background] Waiting ${delay}ms before next...`);
  
  setTimeout(() => {
    processNextInQueue();
  }, delay);
}

function saveCampaignState() {
  // Salvar com TODAS as chaves para compatibilidade completa
  chrome.storage.local.get('whl_campaign_state_v1', (data) => {
    const existingState = data.whl_campaign_state_v1 || {};
    
    // Atualizar o state com a fila atual
    const updatedState = {
      ...existingState,
      queue: campaignQueue,
      isRunning: campaignState.isRunning,
      isPaused: campaignState.isPaused,
      index: campaignState.currentIndex
    };
    
    chrome.storage.local.set({
      campaignQueue,
      campaignState,
      // Para o sidepanel escutar via storage.onChanged
      whl_queue: campaignQueue,
      // Para o content.js (que usa GET_STATE)
      whl_campaign_state_v1: updatedState
    });
    
    console.log('[WHL Background] Estado salvo - Fila:', campaignQueue.length, 'items');
  });
}

function notifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup may be closed, ignore error
  });
}

// Cleanup when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === workerTabId) {
    console.log('[WHL Background] Worker tab was closed');
    workerTabId = null;
    chrome.storage.local.remove('workerTabId');
    
    // If campaign was running, pause it
    if (campaignState.isRunning) {
      campaignState.isPaused = true;
      saveCampaignState();
      notifyPopup({ action: 'WORKER_CLOSED' });
    }
  }
});

// Expor no escopo global (usado por background.js -> handler map)
self.handleCheckIfWorker = handleCheckIfWorker;
self.handleWorkerReady = handleWorkerReady;
self.handleWorkerStatus = handleWorkerStatus;
self.handleWorkerError = handleWorkerError;
self.handleStartCampaign = handleStartCampaign;
self.handleStartScheduledCampaign = handleStartScheduledCampaign;
self.handlePauseCampaign = handlePauseCampaign;
self.handleResumeCampaign = handleResumeCampaign;
self.handleStopCampaign = handleStopCampaign;
self.handleGetCampaignStatus = handleGetCampaignStatus;
self.handleRecoverNewMessage = handleRecoverNewMessage;
self.handleSyncRecoverHistory = handleSyncRecoverHistory;

