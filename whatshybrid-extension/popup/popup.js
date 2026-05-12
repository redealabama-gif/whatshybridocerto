// PR #79: Enhanced popup functionality
let statsInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  // v9.4.4 BUG #116: versão dinâmica do manifest (antes hardcoded "v7.9.13").
  try {
    const manifest = chrome.runtime?.getManifest?.();
    const versionEl = document.getElementById('version');
    if (versionEl && manifest?.version) {
      versionEl.textContent = `v${manifest.version}`;
    }
  } catch (_) {}

  // CRM Kanban button - opens in new tab
  const openCRMBtn = document.getElementById('openCRM');
  if (openCRMBtn) {
    openCRMBtn.onclick = async () => {
      // Abrir CRM em nova aba
      await chrome.tabs.create({ url: chrome.runtime.getURL('crm/crm.html') });
      window.close(); // Fechar popup
    };
  }

  // Main toggle button - opens panel
  const openPanelBtn = document.getElementById('openPanel');
  if (openPanelBtn) {
    openPanelBtn.onclick = async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id || !tab.url?.startsWith('https://web.whatsapp.com/')) {
        // open WA web if not active
        await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
        return;
      }
      await chrome.tabs.sendMessage(tab.id, { type: 'WHL_TOGGLE_PANEL' }).catch(() => {});
    };
  }

  // Open Side Panel (Group Extractor v6)
  const openSidePanelBtn = document.getElementById('openSidePanel');
  if (openSidePanelBtn) {
    openSidePanelBtn.onclick = async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id || !tab.url?.startsWith('https://web.whatsapp.com/')) {
        await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
        return;
      }
      try {
        if (chrome.sidePanel && chrome.sidePanel.open) {
          await chrome.sidePanel.open({ tabId: tab.id });
        } else {
          // fallback to background handler
          await chrome.runtime.sendMessage({ action: 'openSidePanel', tabId: tab.id }).catch(() => {});
        }
      } catch (e) {
        console.warn('[Fusion Popup] Falha ao abrir Side Panel', e);
      }
    };
  }


  // Extract contacts button
  const extractBtn = document.getElementById('extractContacts');
  if (extractBtn) {
    extractBtn.onclick = async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id || !tab.url?.startsWith('https://web.whatsapp.com/')) {
        await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
        return;
      }
      await chrome.tabs.sendMessage(tab.id, { type: 'WHL_TOGGLE_PANEL' }).catch(() => {});
      // Give it time to open, then switch to extrator tab
      setTimeout(async () => {
        await chrome.tabs.sendMessage(tab.id, { type: 'WHL_SWITCH_TAB', tab: 'extrator' }).catch(() => {});
      }, 300);
    };
  }

  // Recover button
  const recoverBtn = document.getElementById('openRecover');
  if (recoverBtn) {
    recoverBtn.onclick = async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id || !tab.url?.startsWith('https://web.whatsapp.com/')) {
        await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
        return;
      }
      await chrome.tabs.sendMessage(tab.id, { type: 'WHL_TOGGLE_PANEL' }).catch(() => {});
      // Give it time to open, then switch to recover tab
      setTimeout(async () => {
        await chrome.tabs.sendMessage(tab.id, { type: 'WHL_SWITCH_TAB', tab: 'recover' }).catch(() => {});
      }, 300);
    };
  }

  // SAPL button
  const saplBtn = document.getElementById('openSAPL');
  if (saplBtn) {
    saplBtn.onclick = async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id || !tab.url?.startsWith('https://web.whatsapp.com/')) {
        await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
        return;
      }
      await chrome.tabs.sendMessage(tab.id, { type: 'WHL_TOGGLE_PANEL' }).catch(() => {});
      setTimeout(async () => {
        await chrome.tabs.sendMessage(tab.id, { type: 'WHL_SWITCH_TAB', tab: 'sapl' }).catch(() => {});
      }, 300);
    };
  }

  // Settings link
  const settingsLink = document.getElementById('settingsLink');
  if (settingsLink) {
    settingsLink.onclick = async (e) => {
      e.preventDefault();
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id || !tab.url?.startsWith('https://web.whatsapp.com/')) {
        await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
        return;
      }
      await chrome.tabs.sendMessage(tab.id, { type: 'WHL_TOGGLE_PANEL' }).catch(() => {});
      setTimeout(async () => {
        await chrome.tabs.sendMessage(tab.id, { type: 'WHL_SWITCH_TAB', tab: 'config' }).catch(() => {});
      }, 300);
    };
  }

  // Check status and update UI
  checkStatus();
  
  // Update stats periodically
  if (statsInterval) clearInterval(statsInterval);
  statsInterval = setInterval(updateStats, 2000);
});

// Cleanup ao descarregar
window.addEventListener('beforeunload', () => {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
});

// Check WhatsApp Web status
async function checkStatus() {
  const statusCard = document.getElementById('statusCard');
  const statusIndicator = document.getElementById('statusIndicator');
  const statusValue = document.getElementById('statusValue');
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    
    if (!tab?.url?.startsWith('https://web.whatsapp.com/')) {
      if (statusIndicator) {
        statusIndicator.classList.remove('active');
        statusIndicator.classList.add('inactive');
      }
      if (statusValue) {
        statusValue.textContent = 'Abra o WhatsApp Web';
        statusValue.style.color = '#ff4757';
      }
      if (statusCard) {
        statusCard.style.background = 'rgba(255,71,87,0.1)';
        statusCard.style.borderColor = 'rgba(255,71,87,0.2)';
      }
    } else {
      if (statusIndicator) {
        statusIndicator.classList.add('active');
        statusIndicator.classList.remove('inactive');
      }
      if (statusValue) {
        statusValue.textContent = 'Conectado ao WhatsApp Web';
        statusValue.style.color = '#00a884';
      }
      if (statusCard) {
        statusCard.style.background = 'rgba(0,168,132,0.1)';
        statusCard.style.borderColor = 'rgba(0,168,132,0.2)';
      }
    }
  } catch (e) {
    console.log('Status check error:', e);
  }
  
  // Check again in 3 seconds
  setTimeout(checkStatus, 3000);
}

// Update statistics from storage
async function updateStats() {
  try {
    const result = await chrome.storage.local.get(['whl_stats']);
    const stats = result.whl_stats || {
      sent: 0,
      pending: 0,
      success: 0,
      failed: 0
    };
    
    const statSent = document.getElementById('statSent');
    const statPending = document.getElementById('statPending');
    const statSuccess = document.getElementById('statSuccess');
    const statFailed = document.getElementById('statFailed');
    
    if (statSent) statSent.textContent = stats.sent || 0;
    if (statPending) statPending.textContent = stats.pending || 0;
    if (statSuccess) statSuccess.textContent = stats.success || 0;
    if (statFailed) statFailed.textContent = stats.failed || 0;
  } catch (e) {
    console.log('Stats update error:', e);
  }
}
