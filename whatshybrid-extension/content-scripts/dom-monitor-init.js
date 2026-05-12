/**
 * DOM Monitor Initialization
 * Auto-starts WhatsApp DOM monitoring (RISK-001)
 */

(async function initDOMMonitor() {
  // Verificar se estamos no WhatsApp Web
  if (!window.location.href.includes('web.whatsapp.com')) {
    return;
  }

  console.log('[Init] Carregando DOM Monitor...');

  // Aguardar WPP ou DOM estabilizar
  await new Promise(resolve => {
    if (document.readyState === 'complete') {
      resolve();
    } else {
      window.addEventListener('load', resolve);
    }
  });

  // Aguardar mais 3s para WhatsApp carregar
  await new Promise(resolve => setTimeout(resolve, 3000));

  try {
    // Importar monitor
    if (typeof getDOMMonitor === 'undefined') {
      console.error('[Init] DOM Monitor não carregado');
      return;
    }

    const monitor = getDOMMonitor();

    // FIX PEND-MED-010: Check user consent before enabling telemetry
    const consentData = await chrome.storage.local.get('whl_telemetry_consent');
    const telemetryEnabled = consentData.whl_telemetry_consent === true;

    // Configurar e iniciar
    monitor.start({
      telemetry: telemetryEnabled, // Respect user consent
      checkInterval: 30000 // Check a cada 30s
    });

    console.log('[Init] Telemetry:', telemetryEnabled ? 'ENABLED' : 'DISABLED (no consent)');

    console.log('[Init] ✅ DOM Monitor ativo');

    // Expor globalmente para debug
    window.whlDOMMonitor = monitor;

    // Status inicial
    const status = monitor.getHealthStatus();
    console.log('[Init] Status inicial:', status);

    // Listener para mensagens do background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'getDOMHealth') {
        sendResponse(monitor.getHealthStatus());
      } else if (message.action === 'getDOMChangeLog') {
        sendResponse(monitor.getChangeLog(message.limit || 50));
      } else if (message.action === 'attemptDOMRecovery') {
        monitor.attemptRecovery(message.element).then(result => {
          sendResponse({ success: !!result });
        });
        return true; // Async response
      }
    });

  } catch (error) {
    console.error('[Init] Erro ao iniciar DOM Monitor:', error);
  }
})();
