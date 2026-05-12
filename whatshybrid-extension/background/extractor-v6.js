// background.js - WhatsApp Group Extractor v6.0.7 - BACKGROUND PERSISTENCE
console.log('[WA Extractor] Background script carregado v6.0.7');

// Flag global de lock para prevenir race conditions
let extractionLock = false;
let extractionLockTimeout = null;
const LOCK_TIMEOUT_MS = 300000; // 5 minutes timeout for safety

// Function to clear lock with timeout
function setExtractionLock(value) {
    extractionLock = value;
    
    // Clear existing timeout
    if (extractionLockTimeout) {
        clearTimeout(extractionLockTimeout);
        extractionLockTimeout = null;
    }
    
    // If setting lock to true, set a safety timeout
    if (value === true) {
        extractionLockTimeout = setTimeout(() => {
            console.warn('[WA Extractor] ⚠️ Lock timeout expired, releasing lock automatically');
            extractionLock = false;
            extractionState.isRunning = false;
            extractionState.status = 'error';
        }, LOCK_TIMEOUT_MS);
    }
}

// Estado persistente em background
let extractionState = {
    isRunning: false,
    isPaused: false,
    currentGroup: null,
    progress: 0,
    membersCount: 0,
    status: 'idle' // 'idle', 'running', 'paused', 'completed', 'error'
};

// Configurar Side Panel para abrir ao clicar no ícone
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// Track side panel state
let sidePanelOpen = false;

// NOTE: chrome.action.onClicked does NOT fire when openPanelOnActionClick: true is set
// Therefore, we cannot rely on it to get the tab ID. Instead, we use chrome.tabs.query
// inside the onConnect handler to find the WhatsApp Web tab.

// Listen for side panel opening/closing
chrome.runtime.onConnect.addListener(async (port) => {
    if (port.name === 'sidepanel') {
        console.log('[WA Extractor] 🔗 Side panel connected');
        sidePanelOpen = true;
        
        // Find the active WhatsApp Web tab
        try {
            const tabs = await chrome.tabs.query({ 
                active: true, 
                currentWindow: true,
                url: 'https://web.whatsapp.com/*'
            });
            
            // If no active tab found, try any WhatsApp tab
            let targetTab = tabs[0];
            if (!targetTab) {
                const allWhatsAppTabs = await chrome.tabs.query({
                    url: 'https://web.whatsapp.com/*'
                });
                targetTab = allWhatsAppTabs[0];
            }
            
            if (targetTab) {
                const targetTabId = targetTab.id;
                
                // Send message to show the top panel
                chrome.tabs.sendMessage(targetTabId, { action: 'showTopPanel' })
                    .then(() => console.log('[WA Extractor] ✅ Show top panel sent to tab', targetTabId))
                    .catch(err => console.log('[WA Extractor] ⚠️ Show top panel failed:', err.message));
                
                // Save targetTabId in the port object for use in disconnect
                port.targetTabId = targetTabId;
            } else {
                console.warn('[WA Extractor] ⚠️ No WhatsApp Web tab found');
            }
        } catch (err) {
            console.error('[WA Extractor] Error finding WhatsApp tab:', err);
        }
        
        port.onDisconnect.addListener(() => {
            console.log('[WA Extractor] 🔌 Side panel disconnected');
            sidePanelOpen = false;
            
            // KEEP Top Panel visible (Top Panel is now the main navigation)
            // If you ever want auto-hide again, restore the hideTopPanel message here.
        });
    }
});

// Keepalive para manter o service worker ativo
let keepaliveInterval = null;

function startKeepalive() {
    if (keepaliveInterval) return;
    
    console.log('[WA Extractor] ⏰ Iniciando keepalive...');
    keepaliveInterval = setInterval(() => {
        // Enviar ping para manter ativo
        chrome.runtime.getPlatformInfo(() => {
            // Apenas para manter o service worker ativo
        });
    }, 20000); // A cada 20 segundos
}

function stopKeepalive() {
    if (keepaliveInterval) {
        console.log('[WA Extractor] ⏹️ Parando keepalive...');
        clearInterval(keepaliveInterval);
        keepaliveInterval = null;
    }
}

// Listener para instalação
chrome.runtime.onInstalled.addListener((details) => {
    console.log('[WA Extractor] Extensão instalada/atualizada:', details.reason);
    
    // Limpar dados antigos se necessário
    if (details.reason === 'update') {
        console.log('[WA Extractor] Atualização detectada, versão anterior:', details.previousVersion);
    }
});

// Listener para mensagens entre componentes
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[WA Extractor] Background recebeu mensagem:', message.type || message.action);
    
    // Repassa mensagens de progresso do content script para o popup
    if (message.type === 'extractionProgress') {
        // Atualizar estado local
        extractionState.progress = message.progress || 0;
        extractionState.membersCount = message.count || 0;
        extractionState.status = 'running';
        
        // Se completou (100%), liberar lock
        if (extractionState.progress >= 100) {
            setExtractionLock(false);
            extractionState.isRunning = false;
            extractionState.status = 'completed';
            stopKeepalive();
            console.log('[WA Extractor] ✅ Extração concluída, lock liberado');
        }
        
        // Garantir que keepalive está ativo durante extração
        if (extractionState.progress > 0 && extractionState.progress < 100) {
            startKeepalive();
        }
        
        // Broadcast para todas as views do popup (se estiver aberto)
        chrome.runtime.sendMessage(message).catch(() => {
            // Popup pode estar fechado, ignorar erro
            console.log('[WA Extractor] Popup fechado, mensagem não enviada');
        });
        
        // Salvar estado em storage periodicamente
        if (extractionState.membersCount % 5 === 0) {
            chrome.storage.local.set({ 
                backgroundExtractionState: extractionState 
            }).catch(console.error);
        }
    }
    
    // Comandos de controle de extração
    if (message.action === 'updateExtractionState') {
        extractionState = { ...extractionState, ...message.state };
        console.log('[WA Extractor] Estado atualizado:', extractionState);
        
        // Ativar keepalive se está rodando
        if (extractionState.isRunning) {
            startKeepalive();
        } else {
            stopKeepalive();
        }
        
        sendResponse({ success: true });
        return true;
    }
    
    if (message.action === 'getExtractionState') {
        sendResponse({ success: true, state: extractionState });
        return true;
    }
    
    if (message.action === 'startExtraction') {
        if (extractionLock) {
            console.log('[WA Extractor] ⚠️ Extração já em andamento, ignorando...');
            sendResponse({ 
                success: false, 
                error: 'Já existe uma extração em andamento. Aguarde a conclusão.' 
            });
            return true;
        }
        console.log('[WA Extractor] 🚀 Iniciando extração em background...');
        setExtractionLock(true);
        extractionState.isRunning = true;
        extractionState.isPaused = false;
        extractionState.status = 'running';
        startKeepalive();
        sendResponse({ success: true });
        return true;
    }
    
    if (message.action === 'stopExtraction') {
        console.log('[WA Extractor] ⏹️ Parando extração...');
        setExtractionLock(false);
        extractionState.isRunning = false;
        extractionState.isPaused = false;
        extractionState.status = 'idle';
        stopKeepalive();
        sendResponse({ success: true });
        return true;
    }
    
    if (message.action === 'pauseExtraction') {
        console.log('[WA Extractor] ⏸️ Pausando extração...');
        extractionState.isPaused = true;
        extractionState.isRunning = false;
        extractionState.status = 'paused';
        sendResponse({ success: true });
        return true;
    }
    
    if (message.action === 'resumeExtraction') {
        console.log('[WA Extractor] ▶️ Retomando extração...');
        extractionState.isPaused = false;
        extractionState.isRunning = true;
        extractionState.status = 'running';
        startKeepalive();
        sendResponse({ success: true });
        return true;
    }
    
    return false;
});

// Listener para erros não capturados
self.addEventListener('error', (event) => {
    console.error('[WA Extractor] Erro no background:', event.error);
});

// Listener para rejeições de promise não tratadas
self.addEventListener('unhandledrejection', (event) => {
    console.error('[WA Extractor] Promise rejeitada:', event.reason);
});

// Listener para quando o service worker é ativado
self.addEventListener('activate', (event) => {
    console.log('[WA Extractor] Service worker ativado');
});

// Restaurar estado ao iniciar
chrome.storage.local.get('backgroundExtractionState').then(result => {
    if (result.backgroundExtractionState) {
        extractionState = result.backgroundExtractionState;
        console.log('[WA Extractor] Estado restaurado do storage:', extractionState);
        
        // Se estava rodando, reativar keepalive
        if (extractionState.isRunning) {
            console.log('[WA Extractor] ⚠️ Extração anterior ainda em execução, reativando keepalive...');
            startKeepalive();
        }
    }
}).catch(console.error);

console.log('[WA Extractor] Background script inicializado com persistência completa');