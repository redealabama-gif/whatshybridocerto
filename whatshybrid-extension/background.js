// ===== STRICT MODE AND ERROR HANDLING =====
'use strict';

// Load centralized endpoints
try { importScripts('constants/endpoints.js'); } catch (e) { /* optional */ }

// ===== LOAD: Modular background handlers =====
// CORREÇÃO MÉDIO: Carregar cada script individualmente para detectar qual falhou
// e notificar o usuário em vez de silenciar o erro
const _modulesToLoad = [
  'background/message-handler.js',
  'background/campaign-handler.js',
  'background/ai-handlers.js',
];
const _failedModules = [];

for (const _mod of _modulesToLoad) {
  try {
    importScripts(_mod);
    console.log(`[WHL Background] ✅ Loaded: ${_mod}`);
  } catch (e) {
    console.error(`[WHL Background] ❌ FAILED to load: ${_mod}`, e);
    _failedModules.push(_mod);
  }
}

if (_failedModules.length > 0) {
  // Notificar o usuário via badge + armazenar erro para diagnóstico
  console.error('[WHL Background] CRITICAL: Módulos com falha:', _failedModules);
  try {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
    chrome.storage.local.set({
      _moduleLoadErrors: {
        failed: _failedModules,
        timestamp: Date.now(),
        message: `Falha ao carregar: ${_failedModules.join(', ')}. Reinstale a extensão.`
      }
    });
  } catch (_) { /* chrome.action pode não estar disponível */ }
} else {
  console.log('[WHL Background] ✅ Todos os módulos carregados com sucesso');
  // Limpar badge de erro anterior se houver
  try { chrome.action.setBadgeText({ text: '' }); } catch (_) {}
}


// Verify Chrome APIs are available
if (typeof chrome === 'undefined' || !chrome.runtime) {
    console.error('[WHL Background] Chrome APIs not available');
}

// Global error handler
self.addEventListener('error', (event) => {
    console.error('[WHL Background] Global error:', event.error);
});

// Unhandled promise rejection handler
self.addEventListener('unhandledrejection', (event) => {
    console.error('[WHL Background] Unhandled promise rejection:', event.reason);
});

// ===== BUG FIX 2: Side Panel Behavior =====
// Set panel behavior to open on action click (clicking extension icon)
// This must be done BEFORE any tabs are opened to ensure it works consistently
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .then(() => console.log('[WHL Background] ✅ Side panel set to open on action click'))
  .catch(e => console.warn('[WHL Background] setPanelBehavior failed:', e));

// ===== CORREÇÃO 5.3: BROADCAST DE MENSAGENS RECOVER =====
// Message handlers consolidated into single listener below (see line ~194)

// NOTE:
// - `substituirVariaveis` e `NetSniffer` foram extraídos para `background/message-handler.js`
// - Worker/Campaign/Recover handlers foram extraídos para `background/campaign-handler.js`

// ===== CONSOLIDATED MESSAGE LISTENER =====
// Single message listener to handle all actions and avoid race conditions
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    // Handler map for better organization and maintainability
    const handlers = {
      // Data export/clear actions
      exportData: handleExportData,
      clearData: handleClearData,
      
      // Worker management actions
      CHECK_IF_WORKER: handleCheckIfWorker,
      WORKER_READY: handleWorkerReady,
      WORKER_STATUS: handleWorkerStatus,
      WORKER_ERROR: handleWorkerError,
      
      // Campaign management actions
      START_CAMPAIGN_WORKER: handleStartCampaign,
      START_SCHEDULED_CAMPAIGN: handleStartScheduledCampaign,
      PAUSE_CAMPAIGN: handlePauseCampaign,
      RESUME_CAMPAIGN: handleResumeCampaign,
      STOP_CAMPAIGN: handleStopCampaign,
      GET_CAMPAIGN_STATUS: handleGetCampaignStatus,

      // UI routing (Top Panel -> Side Panel)
      WHL_OPEN_SIDE_PANEL_VIEW: handleOpenSidePanelView,
      WHL_SET_SIDE_PANEL_ENABLED: handleSetSidePanelEnabled,
      
      // Open side panel (from popup)
      openSidePanel: handleOpenSidePanel,

      // ChatBackup: download blobs/ZIPs generated in the content script
      download: handleDownload,

      // CRM: Abrir chat na mesma aba
      WHL_OPEN_CHAT: handleOpenChat,
      
      // Onboarding: Highlight de botões no Top Panel
      WHL_ONBOARDING_HIGHLIGHT: handleOnboardingHighlight,
      
      // Recover module: broadcast and sync
      WHL_RECOVER_NEW_MESSAGE: handleRecoverNewMessage,
      WHL_SYNC_RECOVER_HISTORY: handleSyncRecoverHistory,
      
      // AI System: Memory and Confidence handlers
      MEMORY_PUSH: handleMemoryPush,
      MEMORY_QUERY: handleMemoryQuery,
      GET_CONFIDENCE: handleGetConfidence,
      UPDATE_CONFIDENCE: handleUpdateConfidence,
      TOGGLE_COPILOT: handleToggleCopilot,
      FEW_SHOT_PUSH: handleFewShotPush,
      FEW_SHOT_SYNC: handleFewShotSync,
      
      // Team System: Enviar mensagem para telefone
      WHL_SEND_TEXT_TO_PHONE: handleSendTextToPhone,
      
      // Abrir popup/aba (Training, etc)
      WHL_OPEN_POPUP_TAB: handleOpenPopupTab,
      
      // Sync training data
      SYNC_TRAINING_DATA: handleSyncTrainingData,
      
      // ═══════════════════════════════════════════════════════════════════
      // 🔥 FETCH_PROXY: Permite que content scripts façam chamadas de API
      // contornando restrições de CORS/mixed-content
      // ═══════════════════════════════════════════════════════════════════
      FETCH_PROXY: handleFetchProxy,
      
      // Aliases para compatibilidade
      fetchProxy: handleFetchProxy,
      API_REQUEST: handleFetchProxy,
    };
    
    // Verificar também por message.type (além de message.action)
    const handler = handlers[message.action] || handlers[message.type];
    
    if (handler) {
      // All handlers return true for async operations
      handler(message, sender, sendResponse);
      return true;
    }
    
    // Unknown action - don't block
    return false;
  } catch (error) {
    console.error('[WHL Background] Erro no listener:', error);
    try {
      sendResponse?.({ success: false, error: error.message });
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    return false;
  }
});

// ===== MESSAGE HANDLERS =====

async function handleExportData(message, sender, sendResponse) {
  chrome.tabs.query({active:true,currentWindow:true},async tabs=>{
    if(!tabs[0]){
      sendResponse({success:false, error:'No active tab found'});
      return;
    }
    try{
      const res = await chrome.scripting.executeScript({
        target:{tabId:tabs[0].id},
        function:()=>({
          numbers: Array.from(window.HarvesterStore?._phones?.keys()||[]),
          valid: Array.from(window.HarvesterStore?._valid||[]),
          meta: window.HarvesterStore?._meta||{}
        })
      });
      sendResponse({success:true, data: res[0].result});
    }catch(e){
      sendResponse({success:false, error:e.message});
    }
  });
}

async function handleClearData(message, sender, sendResponse) {
  chrome.tabs.query({active:true,currentWindow:true},async tabs=>{
    if(!tabs[0]){
      sendResponse({success:false, error:'No active tab found'});
      return;
    }
    try{
      await chrome.scripting.executeScript({
        target:{tabId:tabs[0].id},
        function:()=>{
          if(window.HarvesterStore){
            window.HarvesterStore._phones.clear();
            window.HarvesterStore._valid.clear();
            window.HarvesterStore._meta = {};
            localStorage.removeItem('wa_extracted_numbers');
          }
        }
      });
      sendResponse({success:true});
    }catch(e){
      sendResponse({success:false, error:e.message});
    }
  });
}

// ===== ABRIR CHAT NA MESMA ABA =====
async function handleOpenChat(message, sender, sendResponse) {
  const phone = String(message.phone || '').replace(/\D/g, '');
  if (!phone) {
    sendResponse({ success: false, error: 'Telefone não informado' });
    return;
  }

  try {
    // Encontrar aba do WhatsApp Web
    const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
    
    if (tabs.length === 0) {
      // Não há aba do WhatsApp aberta, abrir nova
      await chrome.tabs.create({ url: `https://web.whatsapp.com/send?phone=${phone}` });
      sendResponse({ success: true, method: 'new_tab' });
      return;
    }

    const waTab = tabs[0];

    // Focar na aba do WhatsApp
    await chrome.tabs.update(waTab.id, { active: true });
    await chrome.windows.update(waTab.windowId, { focused: true });

    // Enviar mensagem para o content script abrir o chat
    chrome.tabs.sendMessage(waTab.id, {
      type: 'WHL_OPEN_CHAT',
      phone: phone
    }, response => {
      if (chrome.runtime.lastError) {
        console.warn('[WHL Background] Erro ao enviar msg para content:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, method: 'content_script', response });
      }
    });

  } catch (err) {
    console.error('[WHL Background] Erro ao abrir chat:', err);
    sendResponse({ success: false, error: err.message });
  }
}

// ===== UI ROUTING: OPEN SIDE PANEL + SET ACTIVE VIEW =====
// v9.5.9: chrome.sidePanel.open() requires a user gesture and the gesture is
// only valid for ONE async hop. The previous version did `await chrome.storage.local.set(...)`
// before calling `chrome.sidePanel.open(...)`, which consumed the gesture and
// caused every open to fail with "must be called in response to a user gesture".
// Fix: call sidePanel.open() FIRST (kicked off synchronously after we have a
// tabId), and persist storage after.
function handleOpenSidePanelView(message, sender, sendResponse) {
  const view = String(message.view || 'principal');
  const tabId = sender?.tab?.id ?? message.tabId;
  const windowId = sender?.tab?.windowId;

  // 1. Kick off sidePanel.open synchronously so we don't lose the user gesture.
  let openPromise = null;
  try {
    if (chrome.sidePanel?.open) {
      if (typeof tabId === 'number') {
        openPromise = chrome.sidePanel.open({ tabId });
      } else if (typeof windowId === 'number') {
        openPromise = chrome.sidePanel.open({ windowId });
      }
    }
  } catch (e) {
    console.warn('[WHL Background] sidePanel.open sync throw:', e?.message);
  }

  // 2. Persist + broadcast in parallel.
  const persistPromise = chrome.storage.local.set({
    whl_active_view: view,
    whl_active_tabId: (typeof tabId === 'number') ? tabId : null,
    whl_active_windowId: (typeof windowId === 'number') ? windowId : null,
  }).catch((e) => console.warn('[WHL Background] storage.set failed:', e?.message));

  try {
    chrome.runtime.sendMessage({ action: 'WHL_CHANGE_VIEW', view }).catch(() => {});
  } catch (_) {}

  Promise.all([openPromise, persistPromise]).then(() => {
    sendResponse({ success: true, view });
  }, (err) => {
    console.error('[WHL Background] Side panel open failed:', err?.message || err);
    sendResponse({ success: false, view, error: err?.message || String(err) });
  });
  // Return true since sendResponse will be called asynchronously.
  return true;
}

// Enable/disable Side Panel for the current tab (used to keep Top Panel + Side Panel in sync)
async function handleSetSidePanelEnabled(message, sender, sendResponse) {
  try {
    const enabled = !!message.enabled;
    const tabId = sender?.tab?.id ?? message.tabId;

    if (chrome.sidePanel && chrome.sidePanel.setOptions && typeof tabId === 'number') {
      const opts = { tabId, enabled };
      if (enabled) opts.path = 'sidepanel.html';
      await chrome.sidePanel.setOptions(opts);
    }

    sendResponse({ success: true, enabled });
  } catch (e) {
    sendResponse({ success: false, error: e?.message || String(e) });
  }
}

// ===== ONBOARDING HIGHLIGHT HANDLER =====
// Retransmite mensagem do sidepanel para o content script no WhatsApp Web
async function handleOnboardingHighlight(message, sender, sendResponse) {
  try {
    // Encontrar a aba do WhatsApp Web
    const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
    
    if (tabs.length === 0) {
      console.log('[WHL Background] Nenhuma aba do WhatsApp encontrada para highlight');
      sendResponse({ success: false, error: 'No WhatsApp tab found' });
      return;
    }
    
    // Enviar para a primeira aba do WhatsApp encontrada
    const whatsappTab = tabs[0];
    
    await chrome.tabs.sendMessage(whatsappTab.id, {
      action: 'WHL_ONBOARDING_HIGHLIGHT',
      buttonIndex: message.buttonIndex,
      show: message.show
    });
    
    console.log('[WHL Background] Onboarding highlight enviado para tab:', whatsappTab.id);
    sendResponse({ success: true });
  } catch (e) {
    console.log('[WHL Background] Erro ao enviar highlight:', e);
    sendResponse({ success: false, error: e?.message || String(e) });
  }
}


// ===== OPEN SIDE PANEL HANDLER (from popup) =====
// ─── handleSendTextToPhone ─────────────────────────────────────────────────
// Chamado por team-system-simple.js para enviar mensagem a um número via WA Web
async function handleSendTextToPhone(message, sender, sendResponse) {
  const phone   = String(message.phone   || '').replace(/\D/g, '');
  const text    = String(message.message || '').trim();
  const tabId   = sender?.tab?.id;

  if (!phone || !text) {
    sendResponse({ success: false, error: 'phone e message são obrigatórios' });
    return;
  }

  // Localizar aba ativa do WhatsApp Web
  const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
  const waTabs = tabId ? tabs.filter(t => t.id === tabId) : tabs;
  const target = waTabs[0] || tabs[0];

  if (!target) {
    sendResponse({ success: false, error: 'WhatsApp Web não está aberto' });
    return;
  }

  try {
    const result = await chrome.tabs.sendMessage(target.id, {
      type: 'WHL_SEND_TEXT_DIRECT',
      phone,
      message: text
    });
    sendResponse(result || { success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

// ─── handleOpenPopupTab ────────────────────────────────────────────────────
// Chamado por top-panel-injector.js para abrir training.html em nova aba
async function handleOpenPopupTab(message, sender, sendResponse) {
  const url = message.url || 'training/training.html';
  try {
    const fullUrl = chrome.runtime.getURL(url);
    // Verificar se já existe aba com essa URL
    const existing = await chrome.tabs.query({ url: fullUrl });
    if (existing.length > 0) {
      await chrome.tabs.update(existing[0].id, { active: true });
      await chrome.windows.update(existing[0].windowId, { focused: true });
      sendResponse({ success: true, tabId: existing[0].id, reused: true });
    } else {
      const tab = await chrome.tabs.create({ url: fullUrl, active: true });
      sendResponse({ success: true, tabId: tab.id, reused: false });
    }
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

// ─── handleSyncTrainingData ────────────────────────────────────────────────
// Chamado por training.js para sincronizar dados de treinamento com o backend
async function handleSyncTrainingData(message, sender, sendResponse) {
  const data = message.data;
  if (!data) {
    sendResponse({ success: false, error: 'Nenhum dado para sincronizar' });
    return;
  }

  // Salvar localmente primeiro (fallback se backend indisponível)
  try {
    await chrome.storage.local.set({ whl_training_data: { ...data, syncedAt: Date.now() } });
  } catch (e) {
    console.warn('[WHL Background] Falha ao salvar training data localmente:', e);
  }

  // Tentar sincronizar com backend via FETCH_PROXY
  const backendUrl = await chrome.storage.local.get('whl_backend_url')
    .then(r => r.whl_backend_url)
    .catch(() => null);

  const token = await chrome.storage.local.get('whl_backend_token')
    .then(r => r.whl_backend_token)
    .catch(() => null);

  if (backendUrl && token) {
    try {
      const response = await fetch(`${backendUrl}/api/v1/training/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(data)
      });

      if (response.ok) {
        sendResponse({ success: true, synced: 'backend' });
      } else {
        sendResponse({ success: true, synced: 'local', warning: `Backend retornou ${response.status}` });
      }
    } catch (e) {
      sendResponse({ success: true, synced: 'local', warning: 'Backend inacessível: ' + e.message });
    }
  } else {
    sendResponse({ success: true, synced: 'local', warning: 'Backend não configurado' });
  }
}

async function handleOpenSidePanel(message, sender, sendResponse) {
  try {
    const tabId = message.tabId || sender?.tab?.id;
    if (chrome.sidePanel && chrome.sidePanel.open && tabId) {
      await chrome.sidePanel.open({ tabId });
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'sidePanel.open indisponível' });
    }
  } catch (e) {
    sendResponse({ success: false, error: e?.message || String(e) });
  }
}


// ===== ChatBackup: Downloads =====
// The ChatBackup content script generates Blob URLs (including ZIPs) and asks the
// service worker to download them via chrome.downloads.
function sanitizeDownloadFilename(name) {
  const safe = String(name || 'download')
    // Windows forbidden characters + control chars
    .replace(/[\u0000-\u001F\u007F<>:"/\\|?*]+/g, '_')
    // Avoid trailing dots/spaces (Windows)
    .replace(/[\.\s]+$/g, '')
    // Keep it reasonable
    .slice(0, 180);
  return safe || 'download';
}

async function handleDownload(message, _sender, sendResponse) {
  try {
    const url = message?.url;
    const fileName = sanitizeDownloadFilename(message?.fileName);

    if (!url || typeof url !== 'string') {
      sendResponse({ success: false, error: 'URL inválida para download' });
      return;
    }

    chrome.downloads.download(
      {
        url,
        filename: fileName,
        saveAs: false
      },
      (downloadId) => {
        const err = chrome.runtime.lastError;
        if (err || !downloadId) {
          sendResponse({ success: false, error: err?.message || 'Falha ao iniciar download' });
        } else {
          sendResponse({ success: true, downloadId });
        }
      }
    );
  } catch (e) {
    sendResponse({ success: false, error: e?.message || String(e) });
  }
}


// ===== BUG FIX 3: Side Panel Tab Management =====
// Disable side panel when user navigates away from WhatsApp Web
// Enable it when user returns to WhatsApp Web

// Helper function to check if URL is WhatsApp Web
// Note: WhatsApp Web only uses web.whatsapp.com (no regional subdomains)
// If WhatsApp introduces regional domains in the future, update this function
function isWhatsAppWebURL(url) {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    // Check for exact match - WhatsApp Web doesn't use subdomains
    return urlObj.hostname === 'web.whatsapp.com' && urlObj.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// Listen for tab activation (user switches to different tab)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    
    // BUG FIX 2: Set popup dynamically based on tab URL
    if (isWhatsAppWebURL(tab.url)) {
      // On WhatsApp: no popup, clicking icon opens side panel
      await chrome.action.setPopup({ popup: '' });
    } else {
      // On other tabs: show popup
      await chrome.action.setPopup({ popup: 'popup/popup.html' });
    }
    
    if (chrome.sidePanel && chrome.sidePanel.setOptions) {
      if (isWhatsAppWebURL(tab.url)) {
        // Enable side panel for WhatsApp Web tabs
        await chrome.sidePanel.setOptions({
          tabId: activeInfo.tabId,
          enabled: true,
          path: 'sidepanel.html'
        });
        console.log('[WHL Background] Side panel enabled for WhatsApp tab:', activeInfo.tabId);
      } else {
        // Disable side panel for non-WhatsApp tabs
        await chrome.sidePanel.setOptions({
          tabId: activeInfo.tabId,
          enabled: false
        });
        console.log('[WHL Background] Side panel disabled for non-WhatsApp tab:', activeInfo.tabId);
      }
    }
  } catch (e) {
    console.warn('[WHL Background] Error in onActivated listener:', e);
  }
});

// Listen for tab URL updates (user navigates within the same tab)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act when URL changes
  if (changeInfo.url) {
    try {
      // BUG FIX 2: Set popup dynamically based on URL change
      if (isWhatsAppWebURL(changeInfo.url)) {
        // On WhatsApp: no popup, clicking icon opens side panel
        await chrome.action.setPopup({ popup: '' });
      } else {
        // On other tabs: show popup
        await chrome.action.setPopup({ popup: 'popup/popup.html' });
      }
      
      if (chrome.sidePanel && chrome.sidePanel.setOptions) {
        if (isWhatsAppWebURL(changeInfo.url)) {
          // Enable side panel for WhatsApp Web
          await chrome.sidePanel.setOptions({
            tabId: tabId,
            enabled: true,
            path: 'sidepanel.html'
          });
          console.log('[WHL Background] Side panel enabled after navigation to WhatsApp:', tabId);
        } else {
          // Disable side panel when leaving WhatsApp Web
          await chrome.sidePanel.setOptions({
            tabId: tabId,
            enabled: false
          });
          console.log('[WHL Background] Side panel disabled after navigation away from WhatsApp:', tabId);
        }
      }
    } catch (e) {
      console.warn('[WHL Background] Error in onUpdated listener:', e);
    }
  }
});

// NOTE:
// - Alarm handler (chrome.alarms.onAlarm) foi movido para `background/campaign-handler.js`

// NOTE:
// - Alarm handler (chrome.alarms.onAlarm) foi movido para `background/campaign-handler.js`
// - AI handlers foram movidos para `background/ai-handlers.js`


// ============================================
// FIX CRÍTICO: SERVICE WORKER MV3 KEEPALIVE
// O SW MV3 dorme após ~30s de inatividade. Ao acordar, todo estado em
// memória (pendingRequests, rateLimits, filas de campanha) é zerado.
// Solução: (1) alarm periódico para keepAlive; (2) persistir estado crítico
// no chrome.storage antes de qualquer sleep; (3) restaurar ao acordar.
// ============================================

const SW_KEEPALIVE_ALARM  = 'whl_sw_keepalive';
const SW_KEEPALIVE_PERIOD = 0.4; // minutos (~24s) — abaixo do limiar de 30s
const SW_STATE_KEY        = 'whl_sw_runtime_state';

/**
 * Cria/recria o alarm de keepAlive.
 * Idempotente — pode ser chamado várias vezes sem duplicar alarms.
 */
async function ensureKeepAliveAlarm() {
  try {
    const existing = await chrome.alarms.get(SW_KEEPALIVE_ALARM);
    if (!existing) {
      await chrome.alarms.create(SW_KEEPALIVE_ALARM, {
        delayInMinutes: SW_KEEPALIVE_PERIOD,
        periodInMinutes: SW_KEEPALIVE_PERIOD
      });
      console.log('[WHL SW] ✅ KeepAlive alarm criado');
    }
  } catch (e) {
    console.warn('[WHL SW] Falha ao criar keepAlive alarm:', e);
  }
}

/**
 * Persiste estado crítico de runtime no storage para sobreviver ao sleep.
 * Chamado pelos módulos (ai-gateway, campaign-manager) antes de operações longas.
 */
async function persistRuntimeState(partial = {}) {
  try {
    const existing = await chrome.storage.local.get(SW_STATE_KEY);
    const prev = existing[SW_STATE_KEY] || {};
    await chrome.storage.local.set({
      [SW_STATE_KEY]: {
        ...prev,
        ...partial,
        lastActive: Date.now()
      }
    });
  } catch (e) {
    console.warn('[WHL SW] Falha ao persistir runtime state:', e);
  }
}

/**
 * Restaura estado persistido após wake do SW.
 * Retorna o state salvo ou {} se não houver.
 */
async function restoreRuntimeState() {
  try {
    const result = await chrome.storage.local.get(SW_STATE_KEY);
    const state = result[SW_STATE_KEY] || {};
    if (state.lastActive) {
      const sleepMs = Date.now() - state.lastActive;
      console.log(`[WHL SW] 🔄 SW acordou após ${Math.round(sleepMs / 1000)}s de inatividade`);
    }
    return state;
  } catch (e) {
    console.warn('[WHL SW] Falha ao restaurar runtime state:', e);
    return {};
  }
}

// Handler do alarm de keepAlive — apenas previne sleep; não faz trabalho real
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SW_KEEPALIVE_ALARM) {
    // Ping leve para manter SW ativo
    console.debug('[WHL SW] KeepAlive ping');
    return;
  }
  // demais alarms são tratados por campaign-handler.js
});

// Ao instalar/atualizar — configura keepAlive + defaults de configuração.
// v9.6.0: antes a extensão exigia que o usuário rodasse comando no console pra
// setar `whl_backend_url`. Agora a URL padrão é gravada automaticamente; o
// usuário só precisa trocar se rodar o backend em outra porta.
async function initDefaultConfig() {
  const DEFAULT_CONFIG = {
    whl_backend_url: 'http://localhost:3000',
    whl_auto_sync_enabled: true
  };
  try {
    const got = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
    const toSet = {};
    for (const [k, v] of Object.entries(DEFAULT_CONFIG)) {
      if (got[k] === undefined || got[k] === null || got[k] === '') toSet[k] = v;
    }
    if (Object.keys(toSet).length) {
      await chrome.storage.local.set(toSet);
      console.log('[WHL SW] ✅ Defaults aplicados:', Object.keys(toSet).join(', '));
    }
  } catch (e) {
    console.warn('[WHL SW] ⚠️ Falha ao aplicar defaults:', e?.message || e);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await initDefaultConfig();
  await ensureKeepAliveAlarm();
  console.log('[WHL SW] ✅ onInstalled: keepAlive + defaults configurados');
});

// Também aplica defaults no startup pra cobrir o caso de o usuário já ter
// instalado antes desta versão e nunca ter um `whl_backend_url` setado.
initDefaultConfig();

// Ao iniciar o SW (wakeup ou primeira vez) — restaura estado e garante alarm
chrome.runtime.onStartup.addListener(async () => {
  await ensureKeepAliveAlarm();
  await restoreRuntimeState();
  console.log('[WHL SW] ✅ onStartup: estado restaurado');
});

// Garante keepAlive imediatamente ao carregar o SW
ensureKeepAliveAlarm();

// Expõe helpers para módulos que precisam persistir estado
self.WHL_SW = { persistRuntimeState, restoreRuntimeState };

// ── v9.0.0: Lazy load do advanced-bundle ──
// Quando sidepanel abre, injeta advanced-bundle.js no content script
// para liberar features avançadas (smartbot extended, copilot, autopilot, crm).
// Isso permite que o content_scripts no manifest carregue só o essencial,
// reduzindo tempo de boot do WhatsApp Web.
let _advancedInjected = new Set();
async function ensureAdvancedBundle(tabId) {
  if (_advancedInjected.has(tabId)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ['dist/advanced-bundle.js'],
    });
    _advancedInjected.add(tabId);
    console.log('[WHL SW] advanced-bundle injetado em tab', tabId);
  } catch (e) {
    console.error('[WHL SW] Falha ao injetar advanced-bundle:', e?.message || e);
  }
}

// Cleanup quando tab fecha
chrome.tabs.onRemoved.addListener((tabId) => {
  _advancedInjected.delete(tabId);
});

// Side panel abriu? Injeta advanced features na tab do WhatsApp
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'WHL_LOAD_ADVANCED' || msg?.type === 'sidepanel_opened') {
    (async () => {
      const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
      for (const t of tabs) {
        await ensureAdvancedBundle(t.id);
      }
      sendResponse({ ok: true, injected: tabs.length });
    })();
    return true;
  }
});
