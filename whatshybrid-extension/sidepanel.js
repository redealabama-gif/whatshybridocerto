// sidepanel.js - WhatsApp Group Extractor v6.0.6 - Side Panel Implementation

// ============================================
// EventListenerManager (LOW-001): cleanup básico para listeners globais
// ============================================
class EventListenerManager {
    constructor() {
        this._listeners = [];
    }
    on(target, event, handler, options) {
        if (!target || !target.addEventListener) return;
        target.addEventListener(event, handler, options);
        this._listeners.push({ target, event, handler, options });
    }
    cleanup() {
        for (const l of this._listeners) {
            try { l.target.removeEventListener(l.event, l.handler, l.options); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
        }
        this._listeners = [];
    }
}

// Evitar múltiplas instâncias em reaberturas
window.__whlSidepanelELM = window.__whlSidepanelELM || new EventListenerManager();
// Garantir cleanup do próprio manager (se carregado várias vezes)
window.__whlSidepanelELM?.on(window, 'beforeunload', () => {
    try { window.__whlSidepanelELM.cleanup(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
});

class PopupController {
    constructor() {
        // Estado
        this.groups = [];
        this.filteredGroups = [];
        this.selectedGroup = null;
        this.extractedData = null;
        this.currentFilter = 'all';
        this.stats = { total: 0, archived: 0, active: 0 };

        // Constantes de progresso
        this.PROGRESS = {
            STARTING: 3,        // 0-3%
            NAVIGATING: 12,     // 3-12%
            OPENING_INFO: 20,   // 12-20%
            PREPARING: 30,      // 20-30%
            EXTRACTING_MIN: 30, // 30%
            EXTRACTING_MAX: 95, // 95%
            FINISHING: 100      // 95-100%
        };

        // Constantes de conexão
        this.CONNECTION = {
            MAX_RETRIES: 3,           // Número de tentativas para verificar conexão
            RETRY_DELAY_MS: 800,      // Delay entre tentativas (ms)
            ERROR_MESSAGE: 'Conexão perdida. Clique no ícone da extensão para reconectar.'
        };

        // Estado de extração
        this.extractionState = {
            isRunning: false,
            isPaused: false,
            currentGroup: null,
            progress: 0,
            membersCount: 0
        };
        
        // ID da aba do WhatsApp (para garantir que mensagens vão para a aba correta)
        this.whatsappTabId = null;

        // Caches e otimizações
        this.groupsCache = null;
        this.performanceMonitor = null;
        this.virtualList = null;
        this.membersVirtualList = null; // ← CORREÇÃO: Declarar esta variável

        // Storage e exporters
        this.storage = null;
        this.sheetsExporter = null;

        // Inicializa
        this.init();
    }

    // ========================================
    // INICIALIZAÇÃO
    // ========================================
    async init() {
        // Notify background that side panel is open
        this.notifyBackgroundPanelOpen();
        
        // Verificar se as classes estão disponíveis
        this.waitForDependencies().then(() => {
            this.initializeComponents();
            this.cacheElements();
            this.bindEventsOptimized();
            this.setupHistoryEventDelegation(); // Configurar event delegation do histórico
            this.initStorage();
        });
    }

    // Notify background that side panel has opened
    notifyBackgroundPanelOpen() {
        // Prevent duplicate port connections which would cause memory leaks and multiple event handlers
        if (this.backgroundPort) {
            console.log('[SidePanel] ⚠️ Already connected to background, skipping');
            return;
        }
        
        try {
            // Establish connection to notify background of side panel state
            const port = chrome.runtime.connect({ name: 'sidepanel' });
            console.log('[SidePanel] 🔗 Connected to background');
            
            // Keep port reference to maintain connection while panel is open
            this.backgroundPort = port;
            
            // Listen for disconnect and clean up
            port.onDisconnect.addListener(() => {
                console.log('[SidePanel] 🔌 Disconnected from background');
                this.backgroundPort = null;
            });
        } catch (error) {
            console.error('[SidePanel] Error connecting to background:', error);
            // Extension context may be invalid - log and continue
            this.backgroundPort = null;
        }
    }

    waitForDependencies() {
        return new Promise((resolve) => {
            const checkDeps = () => {
                if (typeof SmartCache !== 'undefined' &&
                    typeof PerformanceMonitor !== 'undefined' &&
                    typeof ExtractionStorage !== 'undefined' &&
                    typeof GoogleSheetsExporter !== 'undefined') {
                    resolve();
                } else {
                    setTimeout(checkDeps, 50);
                }
            };
            checkDeps();
        });
    }

    initializeComponents() {
        this.groupsCache = new SmartCache({ maxAge: 2 * 60 * 1000 });
        this.performanceMonitor = new PerformanceMonitor();
        this.storage = new ExtractionStorage();
        this.sheetsExporter = new GoogleSheetsExporter();
        console.log('[SidePanel] ✅ Componentes inicializados');
    }

    async initStorage() {
        try {
            await this.storage.init();
            console.log('[SidePanel] ✅ Storage inicializado');
            
            const deleted = await this.storage.cleanOldExtractions(30);
            if (deleted > 0) {
                console.log(`[SidePanel] 🗑️ ${deleted} extrações antigas removidas`);
            }

            // Restaurar estado se houver
            await this.restoreState();
        } catch (error) {
            console.error('[SidePanel] Erro ao inicializar storage:', error);
        }
    }

    // ========================================
    // STATE PERSISTENCE
    // ========================================
    async saveState() {
        try {
            const state = {
                groups: this.groups,
                selectedGroup: this.selectedGroup,
                extractionState: this.extractionState,
                stats: this.stats,
                timestamp: Date.now()
            };
            
            await chrome.storage.local.set({ extractorState: state });
            console.log('[SidePanel] ✅ Estado salvo');
        } catch (error) {
            console.error('[SidePanel] Erro ao salvar estado:', error);
        }
    }

    async restoreState() {
        try {
            const result = await chrome.storage.local.get('extractorState');
            
            if (result.extractorState) {
                const state = result.extractorState;
                
                // Verificar se o estado não é muito antigo (mais de 1 hora)
                const age = Date.now() - state.timestamp;
                if (age > 3600000) {
                    console.log('[SidePanel] Estado muito antigo, ignorando');
                    await chrome.storage.local.remove('extractorState');
                    return;
                }
                
                // Restaurar dados
                if (state.groups && state.groups.length > 0) {
                    this.groups = state.groups;
                    this.stats = state.stats || this.stats;
                }
                
                if (state.selectedGroup) {
                    this.selectedGroup = state.selectedGroup;
                }
                
                if (state.extractionState) {
                    this.extractionState = state.extractionState;
                    
                    // Se estava em execução ou pausada, notificar usuário
                    if (state.extractionState.isRunning || state.extractionState.isPaused) {
                        console.log('[SidePanel] ⚠️ Extração anterior detectada');
                        // Usuário pode retomar manualmente
                    }
                }
                
                console.log('[SidePanel] ✅ Estado restaurado');
            }
        } catch (error) {
            console.error('[SidePanel] Erro ao restaurar estado:', error);
        }
    }

    async clearState() {
        try {
            await chrome.storage.local.remove('extractorState');
            console.log('[SidePanel] 🗑️ Estado limpo');
        } catch (error) {
            console.error('[SidePanel] Erro ao limpar estado:', error);
        }
    }

    // ========================================
    // EXTRACTION CONTROLS
    // ========================================
    async pauseExtraction() {
        try {
            console.log('[SidePanel] ⏸️ Pausando extração... (tabId:', this.whatsappTabId, ')');
            
            if (!this.whatsappTabId) {
                throw new Error('TabId do WhatsApp não disponível');
            }
            
            this.extractionState.isPaused = true;
            this.extractionState.isRunning = false;
            
            // Enviar comando para content script usando o tabId salvo
            const result = await this.sendMessage('pauseExtraction', {}, this.whatsappTabId);
            console.log('[SidePanel] ⏸️ Resultado pauseExtraction:', result);
            
            // Notificar background
            chrome.runtime.sendMessage({
                action: 'pauseExtraction',
                state: this.extractionState
            }).catch(console.error);
            
            // Atualizar UI
            this.btnPauseExtraction?.classList.add('hidden');
            this.btnResumeExtraction?.classList.remove('hidden');
            
            this.showStatus('⏸️ Extração pausada', this.extractionState.progress);
            
            await this.saveState();
        } catch (error) {
            console.error('[SidePanel] Erro ao pausar:', error);
            this.showError('❌ Não foi possível pausar a extração. Tente novamente.');
        }
    }

    async resumeExtraction() {
        try {
            console.log('[SidePanel] ▶️ Retomando extração... (tabId:', this.whatsappTabId, ')');
            
            if (!this.whatsappTabId) {
                throw new Error('TabId do WhatsApp não disponível');
            }
            
            this.extractionState.isPaused = false;
            this.extractionState.isRunning = true;
            
            // Enviar comando para content script usando o tabId salvo
            const result = await this.sendMessage('resumeExtraction', {}, this.whatsappTabId);
            console.log('[SidePanel] ▶️ Resultado resumeExtraction:', result);
            
            // Notificar background
            chrome.runtime.sendMessage({
                action: 'resumeExtraction',
                state: this.extractionState
            }).catch(console.error);
            
            // Atualizar UI
            this.btnPauseExtraction?.classList.remove('hidden');
            this.btnResumeExtraction?.classList.add('hidden');
            
            this.showStatus('▶️ Extração retomada...', this.extractionState.progress);
            
            await this.saveState();
        } catch (error) {
            console.error('[SidePanel] Erro ao retomar:', error);
            this.showError('❌ Não foi possível retomar a extração. Tente novamente.');
        }
    }

    async stopExtraction() {
        try {
            if (!confirm('⚠️ Tem certeza que deseja parar a extração?\n\nOs dados coletados até agora não serão perdidos.')) {
                return;
            }
            
            console.log('[SidePanel] ⏹️ Parando extração... (tabId:', this.whatsappTabId, ')');
            this.extractionState.isRunning = false;
            this.extractionState.isPaused = false;
            
            // Enviar comando para content script usando o tabId salvo
            if (this.whatsappTabId) {
                try {
                    const result = await this.sendMessage('stopExtraction', {}, this.whatsappTabId);
                    console.log('[SidePanel] ⏹️ Resultado stopExtraction:', result);
                } catch (e) {
                    console.warn('[SidePanel] Erro ao enviar stopExtraction (tab pode ter fechado):', e);
                }
            }
            
            // Notificar background
            chrome.runtime.sendMessage({
                action: 'stopExtraction'
            }).catch(console.error);
            
            // Ocultar controles
            this.extractionControls?.classList.add('hidden');
            
            this.hideStatus();
            this.setLoading(this.btnExtract, false);
            
            // Limpar tabId
            this.whatsappTabId = null;
            
            await this.clearState();
            
            // Se já tem dados, mostrar resultado parcial
            if (this.extractedData && this.extractedData.members && this.extractedData.members.length > 0) {
                this.showResults();
            }
        } catch (error) {
            console.error('[SidePanel] Erro ao parar:', error);
            this.showError('❌ Não foi possível parar a extração.');
            // Tentar limpar estado mesmo com erro
            this.extractionState.isRunning = false;
            this.extractionState.isPaused = false;
            this.whatsappTabId = null;
        }
    }

    cacheElements() {
        // Steps
        this.step1 = document.getElementById('step1');
        this.step2 = document.getElementById('step2');
        this.step3 = document.getElementById('step3');
        this.step4 = document.getElementById('step4');

        // Buttons
        this.btnLoadGroups = document.getElementById('btnLoadGroups');
        this.btnForceRefresh = document.getElementById('btnForceRefresh');
        this.btnBack = document.getElementById('btnBack');
        this.btnExtract = document.getElementById('btnExtract');
        this.btnNewExtraction = document.getElementById('btnNewExtraction');
        this.btnDismissError = document.getElementById('btnDismissError');
        this.btnViewHistory = document.getElementById('btnViewHistory');

        // Export buttons
        this.btnExportCSV = document.getElementById('btnExportCSV');
        this.btnCopyList = document.getElementById('btnCopyList');
        this.btnCopySheets = document.getElementById('btnCopySheets');
        this.btnOpenSheets = document.getElementById('btnOpenSheets');

        // History buttons
        this.btnBackFromHistory = document.getElementById('btnBackFromHistory');
        this.btnClearHistory = document.getElementById('btnClearHistory');

        // Extraction control buttons
        this.extractionControls = document.getElementById('extractionControls');
        this.btnPauseExtraction = document.getElementById('btnPauseExtraction');
        this.btnResumeExtraction = document.getElementById('btnResumeExtraction');
        this.btnStopExtraction = document.getElementById('btnStopExtraction');

        // Filter tabs
        this.filterTabs = document.querySelectorAll('.filter-tab');

        // Other elements
        this.statusBar = document.getElementById('statusBar');
        this.statusText = document.getElementById('statusText');
        this.progressFill = document.getElementById('progressFill');
        this.groupsList = document.getElementById('groupsList');
        this.groupCount = document.getElementById('groupCount');
        this.searchGroups = document.getElementById('searchGroups');
        this.errorBox = document.getElementById('errorBox');
        this.errorText = document.getElementById('errorText');

        // Result elements
        this.resultGroupName = document.getElementById('resultGroupName');
        this.resultGroupStatus = document.getElementById('resultGroupStatus');
        this.resultMemberCount = document.getElementById('resultMemberCount');
        this.membersList = document.getElementById('membersList');

        // History elements
        this.historyList = document.getElementById('historyList');
        this.historyStats = document.getElementById('historyStats');
    }

    // ========================================
    // BIND EVENTS
    // ========================================
    bindEventsOptimized() {
        this.btnLoadGroups?.addEventListener('click', () => this.loadGroups());
        this.btnForceRefresh?.addEventListener('click', async () => {
            // Clear cache and reload
            if (window.GroupCache) {
                await window.GroupCache.clear();
            }
            this.btnForceRefresh.style.display = 'none';
            await this.loadGroups(true);
        });
        this.btnBack?.addEventListener('click', () => this.goToStep(1));
        this.btnExtract?.addEventListener('click', () => this.startExtraction());
        this.btnNewExtraction?.addEventListener('click', () => this.reset());
        this.btnDismissError?.addEventListener('click', () => this.hideError());
        this.btnViewHistory?.addEventListener('click', () => this.showHistory());

        this.btnExportCSV?.addEventListener('click', () => this.exportCSV());
        this.btnCopyList?.addEventListener('click', () => this.copyList());
        this.btnCopySheets?.addEventListener('click', () => this.copyToSheets());
        this.btnOpenSheets?.addEventListener('click', () => this.openInSheets());

        this.btnBackFromHistory?.addEventListener('click', () => this.goToStep(1));
        this.btnClearHistory?.addEventListener('click', () => this.clearHistory());

        // Extraction controls
        this.btnPauseExtraction?.addEventListener('click', () => this.pauseExtraction());
        this.btnResumeExtraction?.addEventListener('click', () => this.resumeExtraction());
        this.btnStopExtraction?.addEventListener('click', () => this.stopExtraction());

        // Debounced search
        this.searchGroups?.addEventListener('input', 
            PerformanceUtils.debounce(() => {
                if (this.performanceMonitor) {
                    this.performanceMonitor.mark('search-start');
                }
                this.applyFilters();
                if (this.performanceMonitor) {
                    const duration = this.performanceMonitor.measure('search', 'search-start');
                    console.log(`Search completed in ${duration?.toFixed(2)}ms`);
                }
            }, 300)
        );

        this.filterTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.setFilter(tab.dataset.filter);
            });
        });

        document.addEventListener('keydown', (e) => {
            this.handleKeyboardShortcuts(e);
        });
    }

    // ========================================
    // KEYBOARD SHORTCUTS
    // ========================================
    handleKeyboardShortcuts(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
            e.preventDefault();
            if (!this.btnLoadGroups?.disabled) this.loadGroups();
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
            e.preventDefault();
            if (!this.btnExtract?.disabled) this.startExtraction();
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            if (this.extractedData) this.exportCSV();
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
            e.preventDefault();
            if (this.extractedData) this.copyToSheets();
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
            e.preventDefault();
            this.showHistory();
        }

        if (e.key === 'Escape') {
            if (this.step2 && !this.step2.classList.contains('hidden')) {
                this.goToStep(1);
            }
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            this.searchGroups?.focus();
        }
    }

    // ========================================
    // VERIFICAÇÃO INICIAL
    // ========================================
    async checkWhatsAppTab() {
        // Sidepanel sempre ativo - o usuário decide quando usar
        // A verificação de conexão é feita com retry no loadGroups()
        return true;
    }
    
    // Métodos mantidos para compatibilidade (não fazem mais nada)
    showNotWhatsAppMessage() {
        // Não bloqueamos mais - sidepanel sempre ativo
    }
    
    hideNotWhatsAppMessage() {
        // Não bloqueamos mais - sidepanel sempre ativo
    }

    // ========================================
    // NAVEGAÇÃO ENTRE ETAPAS
    // ========================================
    goToStep(step) {
        PerformanceUtils.batchUpdate(() => {
            this.step1?.classList.toggle('hidden', step !== 1);
            this.step2?.classList.toggle('hidden', step !== 2);
            this.step3?.classList.toggle('hidden', step !== 3);
            this.step4?.classList.toggle('hidden', step !== 4);
        });

        if (step === 1) {
            this.hideStatus();
            this.selectedGroup = null;
            if (this.btnExtract) this.btnExtract.disabled = true;
            if (this.btnForceRefresh) this.btnForceRefresh.style.display = 'none';

            if (this.virtualList) {
                this.virtualList.destroy();
                this.virtualList = null;
            }
        }
        
        if (step === 2) {
            // Show force refresh button in Groups view
            if (this.btnForceRefresh) this.btnForceRefresh.style.display = '';
        }
    }

    // ========================================
    // STATUS E LOADING
    // ========================================
    showStatus(text, progress = null) {
        if (!this.statusBar) return;
        this.statusBar.classList.remove('hidden');
        if (this.statusText) this.statusText.textContent = text;
        if (progress !== null && this.progressFill) {
            this.progressFill.style.width = `${progress}%`;
            // Atualizar o texto de porcentagem
            const progressPercent = document.getElementById('progressPercent');
            if (progressPercent) {
                progressPercent.textContent = `${Math.round(progress)}%`;
            }
        }
    }

    hideStatus() {
        if (!this.statusBar) return;
        this.statusBar.classList.add('hidden');
        if (this.progressFill) this.progressFill.style.width = '0%';
        const progressPercent = document.getElementById('progressPercent');
        if (progressPercent) {
            progressPercent.textContent = '0%';
        }
    }

    setLoading(button, loading) {
        if (!button) return;
        if (loading) {
            button.dataset.originalText = button.innerHTML;
            button.innerHTML = '<div class="spinner" style="width: 16px; height: 16px; border-width: 2px; margin: 0 auto;"></div>';
            button.disabled = true;
        } else {
            button.innerHTML = button.dataset.originalText || button.innerHTML;
            button.disabled = false;
        }
    }

    // ========================================
    // MENSAGENS DE ERRO
    // ========================================
    showError(message) {
        if (!this.errorBox) return;
        if (this.errorText) this.errorText.textContent = message;
        this.errorBox.classList.remove('hidden');
        setTimeout(() => this.hideError(), 5000);
    }

    hideError() {
        if (!this.errorBox) return;
        this.errorBox.classList.add('hidden');
    }

    // ========================================
    // COMUNICAÇÃO COM CONTENT SCRIPT
    // ========================================
    async sendMessage(action, data = {}, forceTabId = null) {
        // Se temos um tabId específico (para controle de extração), usar ele
        // Senão, usar o tabId salvo do WhatsApp
        // Como fallback, buscar a aba ativa
        let tabId = forceTabId || this.whatsappTabId;
        
        if (!tabId) {
            // Primeiro tentar encontrar a aba do WhatsApp
            const whatsappTabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
            if (whatsappTabs.length > 0) {
                tabId = whatsappTabs[0].id;
                this.whatsappTabId = tabId; // Salvar para uso futuro
            } else {
                // Fallback para aba ativa
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                tabId = tabs[0]?.id;
            }
        }
        
        if (!tabId) {
            throw new Error('Não foi possível encontrar a aba do WhatsApp');
        }

        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(
                tabId,
                { action, ...data },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('[SidePanel] sendMessage error:', chrome.runtime.lastError.message);
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                }
            );
        });
    }

    // ========================================
    // CARREGAR GRUPOS
    // ========================================
    async loadGroups(forceRefresh = false) {
        try {
            if (this.performanceMonitor) {
                this.performanceMonitor.mark('load-groups-start');
            }

            this.setLoading(this.btnLoadGroups, true);
            this.showStatus('🔍 Carregando lista de grupos...', 20);

            const includeArchived = true; // Sempre incluir todos os grupos

            // Try to get from GroupCache first (if not forcing refresh)
            if (!forceRefresh && window.GroupCache) {
                const cache = await window.GroupCache.get();
                if (cache && cache.fromCache) {
                    this.groups = cache.groups;
                    this.stats = cache.stats;
                    console.log('[SidePanel] ✅ Grupos do cache (GroupCache):', this.stats);
                    
                    // Show cache indicator
                    const groupCountEl = document.getElementById('groupCount');
                    if (groupCountEl) {
                        groupCountEl.textContent = `${this.groups.length} grupo${this.groups.length !== 1 ? 's' : ''} (do cache)`;
                        groupCountEl.style.opacity = '0.8';
                    }

                    this.updateStats();
                    this.setFilter('all');
                    this.goToStep(2);
                    this.setLoading(this.btnLoadGroups, false);
                    this.hideStatus();
                    return;
                }
            }

            // Clear cache indicator
            const groupCountEl = document.getElementById('groupCount');
            if (groupCountEl) {
                groupCountEl.style.opacity = '1';
            }

            // NOVO: Verificar conexão antes de prosseguir
            let isConnected = false;
            
            for (let attempt = 1; attempt <= this.CONNECTION.MAX_RETRIES; attempt++) {
                try {
                    console.log(`[SidePanel] Verificando conexão (tentativa ${attempt}/${this.CONNECTION.MAX_RETRIES})...`);
                    const checkResult = await this.sendMessage('checkPage');
                    if (checkResult?.success && checkResult?.isWhatsApp) {
                        isConnected = true;
                        console.log('[SidePanel] ✅ Conexão OK');
                        break;
                    }
                } catch (e) {
                    console.log(`[SidePanel] ⚠️ Tentativa ${attempt} falhou:`, e.message);
                    if (attempt < this.CONNECTION.MAX_RETRIES) {
                        // FIX PEND-MED-004: Use exponential backoff
                        const backoffDelay = this.CONNECTION.RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                        await this.delay(backoffDelay);
                    }
                }
            }
            
            if (!isConnected) {
                // Mostrar dica de reconexão
                this.showReconnectTip();
                throw new Error(this.CONNECTION.ERROR_MESSAGE);
            }
            
            // Ocultar dica se estava visível
            this.hideReconnectTip();

            const response = await this.sendMessage('getGroups', { 
                includeArchived: includeArchived 
            });

            if (response?.success && response.groups) {
                this.groups = response.groups;
                this.stats = response.stats || {
                    total: this.groups.length,
                    archived: this.groups.filter(g => g.isArchived).length,
                    active: this.groups.filter(g => !g.isArchived).length
                };

                // Save to GroupCache
                if (window.GroupCache) {
                    await window.GroupCache.set(this.groups, this.stats);
                }

                if (this.performanceMonitor) {
                    const duration = this.performanceMonitor.measure('load-groups', 'load-groups-start');
                    console.log(`[SidePanel] ✅ Grupos carregados em ${duration?.toFixed(2)}ms:`, this.stats);
                }

                this.updateStats();
                this.setFilter('all');
                this.goToStep(2);
                this.hideReconnectTip();
            } else {
                throw new Error(response?.error || 'Não foi possível carregar os grupos');
            }
        } catch (error) {
            console.error('[SidePanel] Erro ao carregar grupos:', error);
            this.showError(error.message);
        } finally {
            this.setLoading(this.btnLoadGroups, false);
            this.hideStatus();
        }
    }

    // ========================================
    // RECONNECT TIP
    // ========================================
    showReconnectTip() {
        const tip = document.getElementById('reconnectTip');
        if (tip) {
            tip.style.display = 'block';
        }
    }

    hideReconnectTip() {
        const tip = document.getElementById('reconnectTip');
        if (tip) {
            tip.style.display = 'none';
        }
    }

    // ========================================
    // ESTATÍSTICAS
    // ========================================
    updateStats() {
        const statTotal = document.querySelector('#statTotal .stat-value');
        const statActive = document.querySelector('#statActive .stat-value');
        const statArchived = document.querySelector('#statArchived .stat-value');

        if (statTotal) {
            statTotal.textContent = this.stats.total;
        }
        if (statActive) {
            statActive.textContent = this.stats.active;
        }
        if (statArchived) {
            statArchived.textContent = this.stats.archived;
        }
    }

    // ========================================
    // FILTROS
    // ========================================
    setFilter(filter) {
        if (this.performanceMonitor) {
            this.performanceMonitor.mark('filter-start');
        }

        this.currentFilter = filter;

        PerformanceUtils.batchUpdate(() => {
            this.filterTabs.forEach(tab => {
                tab.classList.toggle('active', tab.dataset.filter === filter);
            });
        });

        this.applyFilters();

        if (this.performanceMonitor) {
            const duration = this.performanceMonitor.measure('filter', 'filter-start');
            console.log(`Filter applied in ${duration?.toFixed(2)}ms`);
        }
    }

    applyFilters() {
        const searchQuery = this.searchGroups?.value?.toLowerCase() || '';

        this.filteredGroups = this.groups.filter(group => {
            if (this.currentFilter === 'active' && group.isArchived) return false;
            if (this.currentFilter === 'archived' && !group.isArchived) return false;
            if (searchQuery && !group.name.toLowerCase().includes(searchQuery)) return false;
            return true;
        });

        this.renderGroupsWithVirtualScroll(this.filteredGroups);

        if (this.groupCount) {
            this.groupCount.textContent = `${this.filteredGroups.length} grupo${this.filteredGroups.length !== 1 ? 's' : ''}`;
        }
    }

    // ========================================
    // RENDERIZAR COM VIRTUAL SCROLL
    // ========================================
    renderGroupsWithVirtualScroll(groups) {
        if (!this.groupsList) return;

        if (this.performanceMonitor) {
            this.performanceMonitor.mark('render-start');
        }

        if (groups.length === 0) {
            this.groupsList.innerHTML = `
                <div class="empty-state">
                    <span class="empty-state-icon">🔭</span>
                    <p>Nenhum grupo encontrado</p>
                </div>
            `;
            return;
        }

        if (this.virtualList) {
            this.virtualList.destroy();
        }

        this.groupsList.innerHTML = '';

        this.virtualList = new VirtualScroll(this.groupsList, {
            itemHeight: 72,
            buffer: 3,
            renderItem: (group, index) => this.createGroupElement(group, index)
        });

        this.virtualList.setItems(groups);

        if (this.performanceMonitor) {
            const duration = this.performanceMonitor.measure('render', 'render-start');
            console.log(`Groups rendered with VirtualScroll in ${duration?.toFixed(2)}ms`);
        }
    }

    createGroupElement(group, index) {
        const div = document.createElement('div');
        div.className = `group-item ${group.isArchived ? 'archived' : ''}`;
        div.dataset.index = index;
        div.dataset.id = group.id;
        div.dataset.archived = group.isArchived;

        div.innerHTML = `
            <div class="group-avatar">
                ${group.isArchived ? '📦' : '👥'}
            </div>
            <div class="group-info">
                <div class="group-name">
                    ${this.escapeHtml(group.name)}
                    ${group.isArchived ? '<span class="archived-badge">Arquivado</span>' : ''}
                </div>
                <div class="group-members">${group.memberCount || 'Grupo'}</div>
            </div>
            <div class="group-check">✓</div>
        `;

        div.addEventListener('click', () => this.selectGroup(div));
        return div;
    }

    selectGroup(element) {
        PerformanceUtils.batchUpdate(() => {
            this.groupsList?.querySelectorAll('.group-item').forEach(item => {
                item.classList.remove('selected');
            });
            element.classList.add('selected');
        });

        const groupId = element.dataset.id;
        const isArchived = element.dataset.archived === 'true';

        this.selectedGroup = this.groups.find(g => g.id === groupId);

        if (this.selectedGroup) {
            this.selectedGroup.isArchived = isArchived;
            if (this.btnExtract) this.btnExtract.disabled = false;
            console.log('[SidePanel] Grupo selecionado:', this.selectedGroup);
        }
    }

    // ========================================
    // EXTRAÇÃO
    // ========================================
    async startExtraction() {
        if (!this.selectedGroup) {
            this.showError('⚠️ Selecione um grupo primeiro');
            return;
        }

        // Verificar se já há uma extração em andamento (client-side check for immediate UX)
        // Note: Background script also enforces a lock for true race condition prevention
        if (this.extractionState.isRunning) {
            this.showError('⏳ Aguarde! Já existe uma extração em andamento.');
            return;
        }

        try {
            // IMPORTANTE: Salvar o tabId do WhatsApp ANTES de iniciar
            // Isso garante que pause/stop funcionem mesmo se o usuário trocar de aba
            const whatsappTabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
            if (whatsappTabs.length > 0) {
                this.whatsappTabId = whatsappTabs[0].id;
                console.log('[SidePanel] 📌 WhatsApp tabId salvo:', this.whatsappTabId);
            } else {
                throw new Error('Aba do WhatsApp não encontrada. Abra o WhatsApp Web primeiro.');
            }
            
            if (this.performanceMonitor) {
                this.performanceMonitor.mark('extraction-start');
            }

            this.setLoading(this.btnExtract, true);
            
            // INÍCIO IMEDIATO - 3% (feedback visual imediato)
            this.showStatus('🚀 Iniciando processo...', this.PROGRESS.STARTING);
            
            // Reset do tracker de progresso para nova extração
            if (typeof lastReportedProgress !== 'undefined') {
                lastReportedProgress = this.PROGRESS.STARTING;
            }
            
            // Atualizar estado
            this.extractionState.isRunning = true;
            this.extractionState.isPaused = false;
            this.extractionState.currentGroup = this.selectedGroup;
            this.extractionState.progress = this.PROGRESS.STARTING;
            this.extractionState.membersCount = 0;
            
            // Notificar background que extração iniciou
            chrome.runtime.sendMessage({
                action: 'startExtraction',
                state: this.extractionState
            }).catch(console.error);
            
            // Mostrar controles de extração
            this.extractionControls?.classList.remove('hidden');
            this.btnPauseExtraction?.classList.remove('hidden');
            this.btnResumeExtraction?.classList.add('hidden');

            await this.saveState();

            // Chamar extractMembers com retry automático
            const extractResult = await this.extractMembers();

            if (extractResult?.success && extractResult.data) {
                this.extractedData = {
                    ...extractResult.data,
                    groupId: this.selectedGroup.id,
                    isArchived: this.selectedGroup.isArchived
                };

                await this.saveExtractionToStorage();

                if (this.performanceMonitor) {
                    const duration = this.performanceMonitor.measure('extraction', 'extraction-start');
                    console.log(`[SidePanel] ✅ Extração concluída em ${duration?.toFixed(2)}ms`);
                }

                // Limpar estado de extração
                this.extractionState.isRunning = false;
                this.extractionState.isPaused = false;
                
                // Notificar background que extração finalizou
                chrome.runtime.sendMessage({
                    action: 'stopExtraction'
                }).catch(console.error);
                
                await this.clearState();

                this.showResults();
            } else {
                throw new Error(extractResult?.error || 'Erro durante a extração');
            }
        } catch (error) {
            console.error('[SidePanel] ❌ Erro na extração:', error);
            this.showError(error.message);
            this.setLoading(this.btnExtract, false);
            
            // Limpar estado em caso de erro
            this.extractionState.isRunning = false;
            this.extractionState.isPaused = false;
            
            // Notificar background
            chrome.runtime.sendMessage({
                action: 'stopExtraction'
            }).catch(console.error);
            
            await this.clearState();
        } finally {
            this.hideStatus();
            this.extractionControls?.classList.add('hidden');
        }
    }

    async extractMembers() {
        const MAX_EXTRACTION_RETRIES = 3;
        const RETRY_DELAY_MS = 1500;
        const INITIAL_WAIT_MS_ACTIVE = 2000;
        const INITIAL_WAIT_MS_ARCHIVED = 2500;
        const RETRY_WAIT_MS = 1000;
        let lastError = null;
        let currentProgress = this.PROGRESS.STARTING; // Começa de onde parou (REGRA: NUNCA regride)
        
        for (let attempt = 1; attempt <= MAX_EXTRACTION_RETRIES; attempt++) {
            try {
                console.log(`[SidePanel] 🔄 Tentativa de extração ${attempt}/${MAX_EXTRACTION_RETRIES}`);
                
                // Atualizar UI com progresso que NUNCA regride
                if (attempt > 1) {
                    // Retry avança levemente em vez de regredir (+2% por tentativa)
                    currentProgress = Math.max(currentProgress, this.PROGRESS.STARTING + (attempt - 1) * 2);
                    this.showStatus(`🔄 Retry automático (${attempt}/${MAX_EXTRACTION_RETRIES})...`, currentProgress);
                    // FIX PEND-MED-004: Use exponential backoff (1.5s, 3s, 6s)
                    const backoffDelay = RETRY_DELAY_MS * Math.pow(2, attempt - 2);
                    await this.delay(backoffDelay);
                }
                
                // Navegando - progride para ~12%
                currentProgress = Math.max(currentProgress, this.PROGRESS.NAVIGATING);
                const groupStatus = this.selectedGroup.isArchived ? 'arquivado' : 'ativo';
                this.showStatus(`🔍 Navegando até o grupo ${groupStatus}...`, currentProgress);
                
                // Navegar até o grupo
                const navResult = await this.sendMessage('navigateToGroup', {
                    groupId: this.selectedGroup.id,
                    groupName: this.selectedGroup.name,
                    isArchived: this.selectedGroup.isArchived
                });
                
                if (!navResult || !navResult.success) {
                    throw new Error(navResult?.error || 'Falha na navegação');
                }
                
                // Abrindo info - progride para ~20%
                currentProgress = Math.max(currentProgress, this.PROGRESS.OPENING_INFO);
                this.showStatus('📂 Abrindo informações...', currentProgress);
                
                // Aguardar mais tempo na primeira tentativa, com tempo extra para arquivados
                let waitTime;
                if (attempt === 1) {
                    waitTime = this.selectedGroup.isArchived ? INITIAL_WAIT_MS_ARCHIVED : INITIAL_WAIT_MS_ACTIVE;
                } else {
                    // FIX PEND-MED-004: Use exponential backoff for retries (1s, 2s, 4s)
                    waitTime = RETRY_WAIT_MS * Math.pow(2, attempt - 2);
                }
                await this.delay(waitTime);
                
                // Aguardando modal - progride para ~30%
                currentProgress = Math.max(currentProgress, this.PROGRESS.PREPARING);
                this.showStatus('⏳ Preparando extração...', currentProgress);
                
                // Extração - progride de 30% até 95% (será atualizado pelo content script)
                currentProgress = Math.max(currentProgress, this.PROGRESS.EXTRACTING_MIN);
                this.showStatus('🔍 Extraindo membros...', currentProgress);
                
                // Tentar extrair
                const extractResult = await this.sendMessage('extractMembers');
                
                if (extractResult && extractResult.success) {
                    console.log(`[SidePanel] ✅ Extração bem-sucedida na tentativa ${attempt}`);
                    // Finalizando - progride para 98%
                    this.showStatus('✅ Finalizando...', 98);
                    return extractResult; // Sucesso!
                }
                
                // Se retornou mas sem sucesso
                lastError = new Error(extractResult?.error || 'Extração falhou');
                console.log(`[SidePanel] ⚠️ Tentativa ${attempt} falhou: ${lastError.message}`);
                // Nota: currentProgress já usa Math.max, então não regride
                
            } catch (error) {
                lastError = error;
                console.error(`[SidePanel] ❌ Erro na tentativa ${attempt}:`, error.message);
                // Nota: progresso mantido, não regride
                console.log(`[SidePanel] Progresso mantido em ${currentProgress}%`);
            }
            
            // Se não é a última tentativa, continuar
            if (attempt < MAX_EXTRACTION_RETRIES) {
                console.log(`[SidePanel] 🔄 Preparando retry ${attempt + 1}...`);
            }
        }
        
        // Todas as tentativas falharam
        console.error(`[SidePanel] ❌ Todas as ${MAX_EXTRACTION_RETRIES} tentativas falharam`);
        throw lastError || new Error(`Extração falhou após ${MAX_EXTRACTION_RETRIES} tentativas`);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ========================================
    // SALVAR NO STORAGE
    // ========================================
    async saveExtractionToStorage() {
        try {
            const id = await this.storage.saveExtraction(this.extractedData);
            console.log('[SidePanel] ✅ Extração salva no IndexedDB com ID:', id);
            this.extractedData.storageId = id;
        } catch (error) {
            console.error('[SidePanel] Erro ao salvar no storage:', error);
        }
    }

    // ========================================
    // MOSTRAR RESULTADOS
    // ========================================
    showResults() {
        // Check for 0 members found
        if (this.extractedData.totalMembers === 0 || this.extractedData.members.length === 0) {
            this.showError('⚠️ Nenhum membro encontrado. O grupo pode estar vazio ou você não tem permissão para ver os membros.');
            this.setLoading(this.btnExtract, false);
            return;
        }

        if (this.resultGroupName) {
            this.resultGroupName.textContent = this.extractedData.groupName;
        }

        if (this.resultGroupStatus) {
            this.resultGroupStatus.textContent = this.extractedData.isArchived 
                ? '📦 Arquivado' 
                : '💬 Ativo';
            this.resultGroupStatus.className = `value ${
                this.extractedData.isArchived ? 'status-archived' : 'status-active'
            }`;
        }

        if (this.resultMemberCount) {
            this.resultMemberCount.textContent = `${this.extractedData.totalMembers} membros`;
        }

        this.updateMembersListVirtual(this.extractedData.members);

        this.setLoading(this.btnExtract, false);
        this.goToStep(3);
    }

    // ========================================
    // ATUALIZAR MEMBROS COM VIRTUAL SCROLL
    // ========================================
    updateMembersListVirtual(members) {
        if (!this.membersList || !members || members.length === 0) return;

        const uniqueMembers = Array.from(
            new Map(members.map(m => [(m.phone || m.name), m])).values()
        );

        // ← CORREÇÃO: Destruir a instância anterior corretamente
        if (this.membersVirtualList) {
            this.membersVirtualList.destroy();
            this.membersVirtualList = null;
        }

        this.membersList.innerHTML = '';

        this.membersVirtualList = new VirtualScroll(this.membersList, {
            itemHeight: 60,
            buffer: 5,
            renderItem: (member) => {
                const div = document.createElement('div');
                div.className = 'member-item';
                div.innerHTML = `
                    <div class="member-avatar">
                        ${member.isAdmin ? '👑' : '👤'}
                    </div>
                    <div class="member-info">
                        <div class="member-name">${this.escapeHtml(member.name)}</div>
                        ${member.phone ? `<div class="member-phone">${this.escapeHtml(member.phone)}</div>` : ''}
                    </div>
                `;
                return div;
            }
        });

        this.membersVirtualList.setItems(uniqueMembers);
    }

    // ========================================
    // EXPORTAÇÕES
    // ========================================
    exportCSV() {
        if (!this.extractedData) return;

        try {
            const headers = ['Nome', 'Telefone', 'Admin', 'Grupo Arquivado', 'Data Extração'];
            const rows = this.extractedData.members.map(m => [
                m.name,
                m.phone || '', // MANTÉM o "+" no CSV
                m.isAdmin ? 'Sim' : 'Não',
                this.extractedData.isArchived ? 'Sim' : 'Não',
                m.extractedAt
            ]);

            const csv = [headers, ...rows]
                .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
                .join('\n');

            const filename = `${this.sanitizeFilename(this.extractedData.groupName)}_membros.csv`;
            this.downloadFile(csv, filename, 'text/csv;charset=utf-8');
            console.log('[SidePanel] ✅ CSV exportado:', filename);
        } catch (error) {
            console.error('[SidePanel] Erro ao exportar CSV:', error);
            this.showError('❌ Não foi possível exportar o arquivo CSV. Tente novamente.');
        }
    }

    exportJSON() {
        if (!this.extractedData) return;

        try {
            const json = JSON.stringify(this.extractedData, null, 2);
            const filename = `${this.sanitizeFilename(this.extractedData.groupName)}_membros.json`;
            this.downloadFile(json, filename, 'application/json');
            console.log('[SidePanel] ✅ JSON exportado:', filename);
        } catch (error) {
            console.error('[SidePanel] Erro ao exportar JSON:', error);
            this.showError('❌ Não foi possível exportar o arquivo JSON. Tente novamente.');
        }
    }

    async copyList() {
        if (!this.extractedData) return;

        try {
            const list = this.extractedData.members
                .map(m => `${m.name}${m.phone ? ' - ' + m.phone : ''}${m.isAdmin ? ' [Admin]' : ''}`) // MANTÉM o "+"
                .join('\n');

            await navigator.clipboard.writeText(list);

            if (this.btnCopyList) {
                const originalText = this.btnCopyList.innerHTML;
                this.btnCopyList.innerHTML = '✓ Copiado!';
                this.btnCopyList.style.background = 'rgba(139, 92, 246, 0.3)';

                setTimeout(() => {
                    this.btnCopyList.innerHTML = originalText;
                    this.btnCopyList.style.background = '';
                }, 2000);
            }

            console.log('[SidePanel] ✅ Lista copiada');
        } catch (error) {
            console.error('[SidePanel] Erro ao copiar:', error);
            this.showError('❌ Não foi possível copiar a lista. Verifique as permissões do navegador.');
        }
    }

    // ========================================
    // GOOGLE SHEETS EXPORT
    // ========================================
    async copyToSheets() {
        if (!this.extractedData) return;

        try {
            // Preparar dados COM cleanPhone aplicado
            const dataForSheets = {
                ...this.extractedData,
                members: this.extractedData.members.map(m => ({
                    ...m,
                    phone: this.cleanPhone(m.phone) // Remove "+" para Google Sheets
                }))
            };
            
            await this.sheetsExporter.copyForSheetsWithFormatting(dataForSheets);

            if (this.btnCopySheets) {
                const originalText = this.btnCopySheets.innerHTML;
                this.btnCopySheets.innerHTML = '✓ Copiado!';
                this.btnCopySheets.style.background = 'rgba(139, 92, 246, 0.3)';

                setTimeout(() => {
                    this.btnCopySheets.innerHTML = originalText;
                    this.btnCopySheets.style.background = '';
                }, 2000);
            }

            console.log('[SidePanel] ✅ Dados copiados para Sheets (telefones sem "+")');
            alert('✅ Dados copiados!\n\n1. Abra o Google Sheets\n2. Cole com Ctrl+V\n3. Pronto!');
        } catch (error) {
            console.error('[SidePanel] Erro ao copiar para Sheets:', error);
            this.showError('❌ Não foi possível copiar para o Google Sheets. Tente novamente.');
        }
    }

    async openInSheets() {
        if (!this.extractedData) return;

        try {
            // Preparar dados COM cleanPhone aplicado
            const dataForSheets = {
                ...this.extractedData,
                members: this.extractedData.members.map(m => ({
                    ...m,
                    phone: this.cleanPhone(m.phone) // Remove "+" para Google Sheets
                }))
            };
            
            await this.sheetsExporter.openInSheets(dataForSheets);
            console.log('[SidePanel] ✅ Google Sheets aberto');
        } catch (error) {
            console.error('[SidePanel] Erro ao abrir Sheets:', error);
            this.showError('❌ Não foi possível abrir o Google Sheets. Tente novamente.');
        }
    }

    // ========================================
    // HISTÓRICO
    // ========================================
    async showHistory() {
        try {
            this.showStatus('📜 Carregando histórico...', 50);

            const history = await this.storage.getExtractionHistory({ limit: 100 });
            const stats = await this.storage.getStats();

            this.renderHistory(history, stats);
            this.goToStep(4);
        } catch (error) {
            console.error('[SidePanel] Erro ao carregar histórico:', error);
            this.showError('❌ Não foi possível carregar o histórico. Tente novamente.');
        } finally {
            this.hideStatus();
        }
    }

    renderHistory(history, stats) {
        if (!this.historyList || !this.historyStats) return;

        // Renderizar estatísticas
        this.historyStats.innerHTML = `
            <div class="stat-card">
                <span class="stat-icon">📊</span>
                <span class="stat-value">${stats.totalExtractions}</span>
                <span class="stat-label">Extrações</span>
            </div>
            <div class="stat-card">
                <span class="stat-icon">👥</span>
                <span class="stat-value">${stats.totalGroups}</span>
                <span class="stat-label">Grupos</span>
            </div>
            <div class="stat-card">
                <span class="stat-icon">📈</span>
                <span class="stat-value">${stats.averageMembersPerGroup}</span>
                <span class="stat-label">Média/Grupo</span>
            </div>
        `;

        // Renderizar histórico
        if (history.length === 0) {
            this.historyList.innerHTML = `
                <div class="empty-state">
                    <span class="empty-state-icon">🔭</span>
                    <p>Nenhuma extração no histórico</p>
                </div>
            `;
            return;
        }

        const html = history.map((extraction) => {
            const date = new Date(extraction.extractedAt);
            const dateStr = date.toLocaleString('pt-BR');

            return `
                <div class="history-item" data-id="${extraction.id}">
                    <div class="history-avatar">
                        ${extraction.isArchived ? '📦' : '👥'}
                    </div>
                    <div class="history-info">
                        <div class="history-name">${this.escapeHtml(extraction.groupName)}</div>
                        <div class="history-meta">
                            ${extraction.totalMembers} membros • ${dateStr}
                        </div>
                    </div>
                    <div class="history-actions">
                        <button class="btn-icon" data-action="view" data-id="${extraction.id}" title="Ver">👁️</button>
                        <button class="btn-icon" data-action="download" data-id="${extraction.id}" title="Baixar CSV">📥</button>
                        <button class="btn-icon" data-action="delete" data-id="${extraction.id}" title="Deletar">🗑️</button>
                    </div>
                </div>
            `;
        }).join('');

        this.historyList.innerHTML = html;

        // Event delegation já configurado no init (não precisa readicionar)
    }

    // Método para configurar event delegation do histórico (chamado uma vez no init)
    setupHistoryEventDelegation() {
        if (!this.historyList) return;
        
        // Remover listener antigo se existir
        if (this.historyClickHandler) {
            this.historyList.removeEventListener('click', this.historyClickHandler);
        }
        
        // Criar e armazenar o handler
        this.historyClickHandler = (e) => {
            const button = e.target.closest('[data-action]');
            if (!button) return;

            const action = button.dataset.action;
            const id = parseInt(button.dataset.id);

            if (action === 'view') {
                this.viewExtraction(id);
            } else if (action === 'download') {
                this.downloadExtractionCSV(id);
            } else if (action === 'delete') {
                this.deleteExtraction(id);
            }
        };
        
        // Adicionar o listener
        this.historyList.addEventListener('click', this.historyClickHandler);
    }

    async viewExtraction(id) {
        try {
            const extraction = await this.storage.getExtraction(id);
            if (extraction) {
                this.extractedData = extraction;
                this.showResults();
            }
        } catch (error) {
            console.error('[SidePanel] Erro ao visualizar extração:', error);
            this.showError('❌ Não foi possível carregar esta extração. Tente novamente.');
        }
    }

    async downloadExtractionCSV(id) {
        try {
            const extraction = await this.storage.getExtraction(id);
            if (extraction) {
                const headers = ['Nome', 'Telefone', 'Admin', 'Grupo Arquivado', 'Data Extração'];
                const rows = extraction.members.map(m => [
                    m.name,
                    m.phone || '', // MANTÉM o "+" no CSV do histórico
                    m.isAdmin ? 'Sim' : 'Não',
                    extraction.isArchived ? 'Sim' : 'Não',
                    m.extractedAt
                ]);

                const csv = [headers, ...rows]
                    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
                    .join('\n');

                const filename = `${this.sanitizeFilename(extraction.groupName)}_membros.csv`;
                this.downloadFile(csv, filename, 'text/csv;charset=utf-8');
                console.log('[SidePanel] ✅ CSV do histórico exportado:', filename);
            }
        } catch (error) {
            console.error('[SidePanel] Erro ao baixar CSV:', error);
            this.showError('❌ Não foi possível baixar o arquivo CSV. Tente novamente.');
        }
    }

    async deleteExtraction(id) {
        if (!confirm('Tem certeza que deseja deletar esta extração?')) return;

        try {
            await this.storage.deleteExtraction(id);
            this.showHistory();
        } catch (error) {
            console.error('[SidePanel] Erro ao deletar:', error);
            this.showError('❌ Não foi possível deletar a extração. Tente novamente.');
        }
    }

    // ========================================
    // LIMPAR TODO HISTÓRICO
    // ========================================
    async clearHistory() {
        if (!confirm('⚠️ Tem certeza que deseja limpar TODO o histórico?\n\nEsta ação não pode ser desfeita!')) {
            return;
        }

        try {
            this.showStatus('🗑️ Limpando histórico...', 50);
            await this.storage.clearAllExtractions();
            console.log('[SidePanel] ✅ Histórico limpo');
            await this.showHistory();
        } catch (error) {
            console.error('[SidePanel] Erro ao limpar histórico:', error);
            this.showError('❌ Não foi possível limpar o histórico. Tente novamente.');
        } finally {
            this.hideStatus();
        }
    }

    // ========================================
    // UTILITÁRIOS
    // ========================================
    cleanPhone(phone) {
        if (!phone) return '';
        // Remove o "+" do início e quaisquer espaços
        return phone.replace(/^\+/, '').trim();
    }

    sanitizeFilename(filename) {
        return filename
            .replace(/[<>:"/\\|?*]/g, '')
            .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, '')
            .replace(/[®™©]/g, '')
            .trim()
            .substring(0, 100);
    }

    downloadFile(content, filename, type) {
        try {
            const BOM = '\uFEFF';
            const blob = new Blob([BOM + content], { type });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('[SidePanel] Erro ao baixar:', error);
            throw error;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ========================================
    // RESET
    // ========================================
    reset() {
        this.selectedGroup = null;
        this.extractedData = null;
        if (this.searchGroups) this.searchGroups.value = '';
        this.currentFilter = 'all';

        // Destruir virtual lists
        if (this.virtualList) {
            this.virtualList.destroy();
            this.virtualList = null;
        }
        if (this.membersVirtualList) {
            this.membersVirtualList.destroy();
            this.membersVirtualList = null;
        }

        this.goToStep(1);

        if (this.performanceMonitor && this.performanceMonitor.measures.length > 0) {
            this.performanceMonitor.report();
        }
    }
}

// ========================================
// LISTENER PARA PROGRESSO
// ========================================
let lastReportedProgress = 3; // Track para garantir que nunca regride (começa em 3%)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'extractionProgress') {
        const statusText = document.getElementById('statusText');
        const progressFill = document.getElementById('progressFill');
        const progressPercent = document.getElementById('progressPercent');

        // REGRA ABSOLUTA: progresso NUNCA regride
        const currentProgress = Math.max(lastReportedProgress, message.progress || 0);
        lastReportedProgress = currentProgress;

        if (statusText) {
            statusText.textContent = `${message.status} (${message.count} membros)`;
        }
        if (progressFill) {
            progressFill.style.width = `${currentProgress}%`;
        }
        if (progressPercent) {
            progressPercent.textContent = `${Math.round(currentProgress)}%`;
        }
        
        // Atualizar estado de extração
        if (window.popupController) {
            window.popupController.extractionState.progress = currentProgress;
            window.popupController.extractionState.membersCount = message.count || 0;
            
            // Salvar estado periodicamente (a cada 10 membros)
            const count = message.count || 0;
            if (count > 0 && count % 10 === 0) {
                window.popupController.saveState().catch(console.error);
            }
        }
    }
});

// ========================================
// INICIALIZAÇÃO
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('[SidePanel] 🚀 Inicializando v6.0.6 COMPLETO...');
    console.log('[SidePanel] 📦 Features: Virtual Scroll + IndexedDB + Google Sheets');
    console.log('[SidePanel] 📊 Progress: Optimized bar with 65% for extraction (30-95%)');

    // v9.4.4 BUG #116 + v9.4.7 BUG #132: versão dinâmica do manifest em todos
    // os pontos visíveis (header geral + bloco "Recover").
    try {
        const manifest = chrome.runtime?.getManifest?.();
        const versionStr = manifest?.version ? `v${manifest.version}` : '';
        const versionEl = document.getElementById('sp_version');
        if (versionEl && versionStr) versionEl.textContent = versionStr;
        const recoverEl = document.getElementById('sp_recover_version');
        if (recoverEl && versionStr) recoverEl.textContent = `Recover ${versionStr}`;
    } catch (_) {}

    window.popupController = new PopupController();
});

// ========================================
// AUTO-PILOT - Integração com SidePanel
// ========================================
(function initAutoPilotCard() {
    let checkAttempts = 0;
    const maxAttempts = 10;
    let autoPilotCardInterval = null;

    // Função para enviar comando ao AutoPilot via content script
    async function sendAutoPilotCommand(command, options = {}) {
        return new Promise((resolve, reject) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs[0]?.id) {
                    reject(new Error('Nenhuma aba ativa'));
                    return;
                }
                
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'autopilot',
                    command: command,
                    ...options
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (response?.success) {
                        resolve(response);
                    } else {
                        reject(new Error(response?.error || 'Comando falhou'));
                    }
                });
            });
        });
    }

    function setupAutoPilotCard() {
        checkAttempts++;

        console.log('[SidePanel] 🤖 Configurando controles do Auto-Pilot...');
        
        // Elementos do card
        const startBtn = document.getElementById('ap-card-start');
        const pauseBtn = document.getElementById('ap-card-pause');
        const resumeBtn = document.getElementById('ap-card-resume');
        const stopBtn = document.getElementById('ap-card-stop');
        const statusEl = document.getElementById('ap-card-status');
        const infoEl = document.getElementById('ap-card-info');
        const progressEl = document.getElementById('ap-card-progress');
        const sentEl = document.getElementById('ap-card-sent');
        const pendingEl = document.getElementById('ap-card-pending');
        const skippedEl = document.getElementById('ap-card-skipped');
        const errorsEl = document.getElementById('ap-card-errors');
        const skipGroupsEl = document.getElementById('ap-card-skip-groups');
        const limitEl = document.getElementById('ap-card-limit');

        if (!startBtn) {
            if (checkAttempts < maxAttempts) {
                setTimeout(setupAutoPilotCard, 500);
                return;
            }
            console.debug('[SidePanel] Auto-Pilot UI não presente nesta aba');
            return;
        }

        // Função para atualizar UI do card
        async function updateCardUI() {
            try {
                const response = await sendAutoPilotCommand('getStatus');
                const stats = response.status?.stats || {};
                const config = (await sendAutoPilotCommand('getConfig')).config || {};
                
                // Atualiza estatísticas
                if (sentEl) sentEl.textContent = stats.totalSent || 0;
                if (pendingEl) pendingEl.textContent = stats.pendingChats || 0;
                if (skippedEl) skippedEl.textContent = stats.totalSkipped || 0;
                if (errorsEl) errorsEl.textContent = stats.totalErrors || 0;

                // Atualiza status e botões
                if (!stats.isRunning) {
                    // PARADO
                    if (statusEl) {
                        statusEl.textContent = 'PARADO';
                        statusEl.style.background = '#6b7280';
                    }
                    startBtn.style.display = '';
                    pauseBtn.style.display = 'none';
                    resumeBtn.style.display = 'none';
                    stopBtn.style.display = 'none';
                    if (infoEl) infoEl.innerHTML = '💡 Clique em <strong>Iniciar</strong> para começar a responder automaticamente.';
                    if (progressEl) progressEl.style.width = '0%';
                    
                } else if (stats.isPaused) {
                    // PAUSADO
                    if (statusEl) {
                        statusEl.textContent = 'PAUSADO';
                        statusEl.style.background = '#f59e0b';
                    }
                    startBtn.style.display = 'none';
                    pauseBtn.style.display = 'none';
                    resumeBtn.style.display = '';
                    stopBtn.style.display = '';
                    if (infoEl) infoEl.innerHTML = '⏸️ Pausado. Clique em <strong>Continuar</strong> para retomar.';
                    
                } else {
                    // ATIVO
                    if (statusEl) {
                        statusEl.textContent = 'ATIVO';
                        statusEl.style.background = '#10b981';
                    }
                    startBtn.style.display = 'none';
                    pauseBtn.style.display = '';
                    resumeBtn.style.display = 'none';
                    stopBtn.style.display = '';
                    
                    const hourlyProgress = (stats.responsesThisHour / (config.MAX_RESPONSES_PER_HOUR || 30)) * 100;
                    if (progressEl) progressEl.style.width = `${Math.min(hourlyProgress, 100)}%`;
                    
                    // PARTIAL-001 FIX: XSS P0 - Validar e sanitizar pending antes de innerHTML
                    const pending = parseInt(stats.pendingChats, 10) || 0;
                    if (infoEl) {
                        if (pending > 0) {
                            // Usar textContent para o número evita XSS se stats for comprometido
                            infoEl.innerHTML = '🔄 Processando... <strong></strong> chat(s) na fila.';
                            infoEl.querySelector('strong').textContent = String(pending);
                        } else {
                            infoEl.innerHTML = '✅ Aguardando novas mensagens...';
                        }
                    }
                }
            } catch (e) {
                // AutoPilot não disponível no content script
                if (statusEl) {
                    statusEl.textContent = 'OFFLINE';
                    statusEl.style.background = '#6b7280';
                }
                if (infoEl) infoEl.innerHTML = '⚠️ Abra o WhatsApp Web primeiro.';
            }
        }

        // Event listeners dos botões
        startBtn.addEventListener('click', async () => {
            try {
                startBtn.disabled = true;
                startBtn.textContent = '⏳...';
                await sendAutoPilotCommand('start');
                console.log('[SidePanel] AutoPilot iniciado!');
            } catch (e) {
                console.error('[SidePanel] Erro ao iniciar AutoPilot:', e);
                alert('Erro: ' + e.message);
            } finally {
                startBtn.disabled = false;
                startBtn.textContent = '▶️ Iniciar';
                updateCardUI();
            }
        });

        pauseBtn.addEventListener('click', async () => {
            try {
                await sendAutoPilotCommand('pause');
            } catch (e) {
                console.error('[SidePanel] Erro ao pausar:', e);
            }
            updateCardUI();
        });

        resumeBtn.addEventListener('click', async () => {
            try {
                await sendAutoPilotCommand('resume');
            } catch (e) {
                console.error('[SidePanel] Erro ao retomar:', e);
            }
            updateCardUI();
        });

        stopBtn.addEventListener('click', async () => {
            try {
                await sendAutoPilotCommand('stop');
            } catch (e) {
                console.error('[SidePanel] Erro ao parar:', e);
            }
            updateCardUI();
        });

        // Configurações
        if (skipGroupsEl) {
            skipGroupsEl.addEventListener('change', async (e) => {
                try {
                    await sendAutoPilotCommand('setConfig', { config: { SKIP_GROUPS: e.target.checked } });
                    console.log('[SidePanel] Auto-Pilot: Pular grupos =', e.target.checked);
                } catch (err) {
                    console.error('[SidePanel] Erro ao configurar:', err);
                }
            });
        }

        if (limitEl) {
            limitEl.addEventListener('change', async (e) => {
                try {
                    const limit = e.target.checked ? 30 : 999;
                    await sendAutoPilotCommand('setConfig', { config: { MAX_RESPONSES_PER_HOUR: limit } });
                    console.log('[SidePanel] Auto-Pilot: Limite por hora =', limit);
                } catch (err) {
                    console.error('[SidePanel] Erro ao configurar:', err);
                }
            });
        }

        // Atualiza UI periodicamente (com referência para cleanup)
        if (autoPilotCardInterval) clearInterval(autoPilotCardInterval);
        autoPilotCardInterval = setInterval(updateCardUI, 2000);

        // Atualização inicial
        updateCardUI();

        // Cleanup ao descarregar
        window.__whlSidepanelELM?.on(window, 'beforeunload', () => {
            if (autoPilotCardInterval) {
                clearInterval(autoPilotCardInterval);
                autoPilotCardInterval = null;
            }
        });

        console.log('[SidePanel] ✅ Auto-Pilot configurado com sucesso!');
    }

    // Inicia após DOM carregar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(setupAutoPilotCard, 500));
    } else {
        setTimeout(setupAutoPilotCard, 500);
    }
})();
// ============================================
// RECOVER UI HANDLERS v7.5.0
// ============================================

(function setupRecoverHandlers() {
  // Filtros (escopo restrito aos filtros do Recover)
  document.querySelectorAll('#sp_recover_filters [data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#sp_recover_filters [data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (window.RecoverAdvanced) {
        window.RecoverAdvanced.setFilter('type', btn.dataset.filter);
        renderRecoverMessages();
      }
    });
  });

  // Filtro por chat
  const chatFilter = document.getElementById('recover_filter_chat');
  if (chatFilter) {
    chatFilter.addEventListener('input', debounce(() => {
      if (window.RecoverAdvanced) {
        window.RecoverAdvanced.setFilter('chat', chatFilter.value);
        renderRecoverMessages();
      }
    }, 300));
  }

  // Filtros de data
  const dateFrom = document.getElementById('recover_filter_from');
  const dateTo = document.getElementById('recover_filter_to');
  if (dateFrom) dateFrom.addEventListener('change', () => {
    if (window.RecoverAdvanced) {
      window.RecoverAdvanced.setFilter('dateFrom', dateFrom.value);
      renderRecoverMessages();
    }
  });
  if (dateTo) dateTo.addEventListener('change', () => {
    if (window.RecoverAdvanced) {
      window.RecoverAdvanced.setFilter('dateTo', dateTo.value);
      renderRecoverMessages();
    }
  });

  // Exportação
  document.getElementById('recover_export_csv')?.addEventListener('click', () => {
    window.RecoverAdvanced?.exportToCSV();
  });
  document.getElementById('recover_export_txt')?.addEventListener('click', () => {
    window.RecoverAdvanced?.exportToTXT();
  });
  document.getElementById('recover_export_pdf')?.addEventListener('click', () => {
    window.RecoverAdvanced?.exportToPDF();
  });

  // Paginação
  document.getElementById('recover_prev_page')?.addEventListener('click', () => {
    const result = window.RecoverAdvanced?.prevPage();
    if (result) renderRecoverPage(result);
  });
  document.getElementById('recover_next_page')?.addEventListener('click', () => {
    const result = window.RecoverAdvanced?.nextPage();
    if (result) renderRecoverPage(result);
  });
  // Paginação duplicada (segunda barra) reutiliza os botões principais
  document.getElementById('recover_prev_page_2')?.addEventListener('click', () => {
    document.getElementById('recover_prev_page')?.click();
  });
  document.getElementById('recover_next_page_2')?.addEventListener('click', () => {
    document.getElementById('recover_next_page')?.click();
  });

  // Função para renderizar mensagens
  function renderRecoverMessages() {
    if (!window.RecoverAdvanced) return;
    const result = window.RecoverAdvanced.getPage(0);
    renderRecoverPage(result);
    updateRecoverStats();
  }

  function renderRecoverPage(result) {
    const container = document.getElementById('recover_messages_list') || document.getElementById('sp_recover_timeline');
    if (!container) return;

    // Helper para escapar HTML
    const esc = (s) => window.WHLHtmlUtils?.escapeHtml?.(s) || window.escapeHtml?.(s) || String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    
    container.innerHTML = result.messages.map(msg => {
      // CORREÇÃO 2.3: Não multiplicar timestamp por 1000
      const ts = msg.timestamp || msg.ts || msg.time || Date.now();
      const date = new Date(ts).toLocaleString('pt-BR');
      const actionIcons = { deleted: '🗑️', revoked: '❌', edited: '✏️' };
      const icon = actionIcons[msg.action] || '📩';
      const isFav = window.RecoverAdvanced && window.RecoverAdvanced.isFavorite(msg.id);
      const hasMedia = msg.mediaUrl || msg.mediaData || msg.mediaType;
      
      return `
        <div class="recover-item" data-id="${esc(msg.id || msg.key)}" style="padding:10px;border-bottom:1px solid rgba(255,255,255,0.1)">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:11px;color:#8696a0">${esc(date)}</span>
            <span>${icon} ${esc((msg.action || 'msg').toUpperCase())}</span>
          </div>
          <div style="margin-top:4px;font-size:12px;color:#667781">
            ${esc(msg.from || '?')} → ${esc(msg.to || msg.chatId || '?')}
          </div>
          <div style="margin-top:4px">${esc((msg.body || msg.originalBody || '[mídia]').substring(0, 150))}</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
            <button class="recover-fav-btn sp-btn sp-btn-sm" data-id="${esc(msg.id || msg.key)}">${isFav ? '⭐' : '☆'} Favorito</button>
            ${msg.action === 'edited' ? `<button class="recover-compare-btn sp-btn sp-btn-sm" data-id="${esc(msg.id || msg.key)}">📊 Comparar</button>` : ''}
            <button class="recover-download-btn sp-btn sp-btn-sm" data-id="${esc(msg.id || msg.key)}" data-has-media="${hasMedia ? 'true' : 'false'}">📥 Baixar</button>
          </div>
        </div>
      `;
    }).join('');

    // Atualizar info de página
    const pageInfo = document.getElementById('recover_page_info');
    if (pageInfo) pageInfo.textContent = `Página ${result.page + 1} de ${result.totalPages || 1}`;

    // Botões de paginação - CORREÇÃO 2.2: hasMore → hasNext
    const prevBtn = document.getElementById('recover_prev_page');
    const nextBtn = document.getElementById('recover_next_page');
    if (prevBtn) prevBtn.disabled = result.page === 0;
    if (nextBtn) nextBtn.disabled = !result.hasNext;

    // Handlers dos botões
    container.querySelectorAll('.recover-fav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const isFav = window.RecoverAdvanced.toggleFavorite(id);
        btn.innerHTML = isFav ? '⭐ Favorito' : '☆ Favorito';
      });
    });

    container.querySelectorAll('.recover-compare-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const diff = window.RecoverAdvanced.compareEdited(id);
        if (diff) {
          alert(`Original: ${diff.original}\n\nEditado: ${diff.edited}`);
        }
      });
    });

    // NOVO: Handler para botão de download - Abre chat e baixa item anterior à mensagem apagada
    container.querySelectorAll('.recover-download-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const msgId = btn.dataset.id;
        const hasMedia = btn.dataset.hasMedia === 'true';
        
        btn.disabled = true;
        btn.innerHTML = '⏳ Abrindo...';
        
        try {
          // Buscar mensagem diretamente do RecoverAdvanced
          let msg = null;
          if (window.RecoverAdvanced) {
            // Tentar múltiplas fontes de dados
            const allMsgs = window.RecoverAdvanced.getMessages?.() || 
                           window.RecoverAdvanced.getHistory?.() || [];
            msg = allMsgs.find(m => (m.id || m.key) === msgId);
            
            // Também verificar no messageVersions
            if (!msg && window.RecoverAdvanced.getMessageHistory) {
              const versionData = window.RecoverAdvanced.getMessageHistory(msgId);
              if (versionData) {
                msg = {
                  id: msgId,
                  chatId: versionData.chatId,
                  from: versionData.from,
                  to: versionData.to,
                  body: versionData.history?.[0]?.body || ''
                };
              }
            }
          }
          
          // Se não encontrou, tentar no result atual
          if (!msg && result?.messages) {
            msg = result.messages.find(m => (m.id || m.key) === msgId);
          }
          
          if (!msg) {
            console.error('[Recover] Mensagem não encontrada:', msgId);
            throw new Error('Mensagem não encontrada');
          }
          
          // FIX: Extrair e formatar chatId corretamente
          let chatId = msg.chatId || msg.chat || msg.to || msg.from;
          
          // Se chatId é um número puro, formatar para o padrão do WhatsApp
          if (chatId && typeof chatId === 'string') {
            // Limpar caracteres não numéricos (exceto @ que indica já estar formatado)
            if (!chatId.includes('@')) {
              const cleanPhone = chatId.replace(/\D/g, '');
              if (cleanPhone.length >= 10 && cleanPhone.length <= 15) {
                chatId = cleanPhone + '@c.us';
              }
            }
          }
          
          if (!chatId) {
            throw new Error('ChatId não disponível - tente abrir o chat manualmente');
          }
          
          console.log('[Recover] 📥 Iniciando download:', { msgId, chatId, hasMedia, originalData: { from: msg.from, to: msg.to } });
          
          // Encontrar aba do WhatsApp
          const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
          
          if (tabs.length === 0) {
            throw new Error('WhatsApp Web não está aberto');
          }
          
          // FIX: Focar na aba do WhatsApp antes de enviar comando
          await chrome.tabs.update(tabs[0].id, { active: true });
          
          // Pequeno delay para garantir que a aba está ativa
          await new Promise(r => setTimeout(r, 300));
          
          // Enviar comando para o content script
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'WHL_RECOVER_DOWNLOAD',
            payload: {
              chatId: chatId,
              messageId: msgId,
              timestamp: msg.timestamp || msg.ts,
              hasMedia: hasMedia,
              body: msg.body || msg.originalBody,
              from: msg.from,
              to: msg.to
            }
          });
          
          btn.innerHTML = '✅ Abrindo chat...';
          setTimeout(() => { btn.innerHTML = '📥 Baixar'; btn.disabled = false; }, 5000);
          
        } catch (e) {
          console.error('[Recover] Erro no download:', e);
          btn.innerHTML = '❌ ' + (e.message || 'Erro');
          setTimeout(() => { btn.innerHTML = '📥 Baixar'; btn.disabled = false; }, 2000);
        }
      });
    });
  }

  function updateRecoverStats() {
    if (!window.RecoverAdvanced) return;
    const stats = window.RecoverAdvanced.getStats();
    
    const totalEl = document.getElementById('recover_stat_total') || document.getElementById('sp_recover_total');
    const revokedEl = document.getElementById('recover_stat_revoked');
    const deletedEl = document.getElementById('recover_stat_deleted');
    const editedEl = document.getElementById('recover_stat_edited');
    
    if (totalEl) totalEl.textContent = stats.total;
    if (revokedEl) revokedEl.textContent = stats.revoked;
    if (deletedEl) deletedEl.textContent = stats.deleted;
    if (editedEl) editedEl.textContent = stats.edited;
    
    // CORREÇÃO 4.2: Exibir estatísticas de sentimento
    const sentimentEl = document.getElementById('recover_sentiment_stats');
    if (sentimentEl && stats.bySentiment) {
      sentimentEl.textContent = `🙂 ${stats.bySentiment.positive || 0}  😐 ${stats.bySentiment.neutral || 0}  🙁 ${stats.bySentiment.negative || 0}`;
    }
  }

  // Debounce helper
  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  // Inicializar quando RecoverAdvanced estiver pronto
  const initRecover = () => {
    if (window.RecoverAdvanced) {
      renderRecoverMessages();
      
      // CORREÇÃO 5.1: Adicionar listener para atualizações em tempo real
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, namespace) => {
          if (namespace === 'local' && changes.whl_recover_history) {
            console.log('[Recover] Histórico atualizado, recarregando...');
            if (window.RecoverAdvanced) {
              window.RecoverAdvanced.loadFromStorage();
              renderRecoverMessages();
            }
          }
        });
      }
      
      // CORREÇÃO 5.4: Listener para mensagens do runtime
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((message) => {
          if (message.type === 'WHL_RECOVER_NEW_MESSAGE' && window.RecoverAdvanced) {
            window.RecoverAdvanced.handleNewMessage(message.payload);
            renderRecoverMessages();
          }
        });
      }
    } else {
      setTimeout(initRecover, 500);
    }
  };
  setTimeout(initRecover, 1000);

})();

// ============================================
// AUTOPILOT UI HANDLERS v7.5.0
// ============================================

(function setupAutopilotHandlers() {
  // Botões do Autopilot
  document.getElementById('autopilot_start')?.addEventListener('click', () => {
    window.AutopilotV2?.start() || window.Autopilot?.start();
  });

  document.getElementById('autopilot_stop')?.addEventListener('click', () => {
    window.AutopilotV2?.stop() || window.Autopilot?.stop();
  });

  document.getElementById('autopilot_pause')?.addEventListener('click', () => {
    window.AutopilotV2?.pause() || window.Autopilot?.pause();
  });
})();

// ============================================
// AUDIO/FILE HANDLERS v7.5.0
// ============================================

(function setupAudioFileHandlers() {
  // Os handlers já estão no audio-file-handler.js via event delegation
  console.log('[Sidepanel] Audio/File handlers prontos');
})();



// ============================================
// RECOVER FILTERS v7.5.0
// ============================================
(function setupRecoverFilters() {
  // Filtros por tipo
  document.querySelectorAll('.recover-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.recover-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const filter = btn.dataset.filter;
      if (window.RecoverAdvanced?.setFilter) {
        window.RecoverAdvanced.setFilter('type', filter);
      }
      
      // Atualizar timeline (usar função existente se disponível)
      if (typeof renderRecoverTimeline === 'function') {
        renderRecoverTimeline();
      } else if (typeof refreshRecoverUI === 'function') {
        refreshRecoverUI();
      }
    });
  });

  // Busca por número
  const searchInput = document.getElementById('recover_search');
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        if (window.RecoverAdvanced?.setFilter) {
          window.RecoverAdvanced.setFilter('chat', e.target.value);
        }
        if (typeof renderRecoverTimeline === 'function') {
          renderRecoverTimeline();
        }
      }, 300);
    });
  }

  // Exportação
  document.getElementById('recover_export_csv')?.addEventListener('click', () => {
    if (window.RecoverAdvanced?.exportToCSV) {
      window.RecoverAdvanced.exportToCSV();
    }
  });

  document.getElementById('recover_export_txt')?.addEventListener('click', () => {
    if (window.RecoverAdvanced?.exportToTXT) {
      window.RecoverAdvanced.exportToTXT();
    }
  });

  console.log('[Sidepanel] ✅ Recover filters configurados');




})();


// ============================================
// RECOVER HANDLERS v7.5.0 - COMPLETO
// ============================================
(function initRecoverHandlers() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupRecoverHandlers);
  } else {
    setTimeout(setupRecoverHandlers, 300);
  }
  
  function setupRecoverHandlers() {
    console.log('[Recover] Configurando handlers completos...');
    
    // ===== FILTROS POR TIPO =====
    document.querySelectorAll('.recover-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.recover-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const filter = btn.dataset.filter;
        console.log('[Recover] Filtro:', filter);
        
        if (filter === 'favorites') {
          // Filtro especial de favoritos
          if (window.RecoverAdvanced) {
            const favs = window.RecoverAdvanced.getFavorites?.() || [];
            window.renderRecoverTimeline?.(favs);
          }
        } else {
          window.RecoverAdvanced?.setFilter?.('type', filter);
          window.recoverRefresh?.(false);
        }
      });
    });
    
    // ===== BUSCA POR NÚMERO =====
    const searchInput = document.getElementById('recover_search');
    if (searchInput) {
      let timeout;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          window.RecoverAdvanced?.setFilter?.('chat', e.target.value.trim());
          window.recoverRefresh?.(false);
        }, 300);
      });
    }
    
    // ===== SELETOR DE CHAT =====
    const chatFilter = document.getElementById('recover_chat_filter');
    if (chatFilter) {
      chatFilter.addEventListener('change', (e) => {
        window.RecoverAdvanced?.setFilter?.('chat', e.target.value);
        window.recoverRefresh?.(false);
      });
    }
    
    // ===== EXPORTAÇÃO =====
    document.getElementById('recover_export_csv')?.addEventListener('click', () => {
      window.RecoverAdvanced?.exportToCSV?.() || alert('RecoverAdvanced não disponível');
    });
    document.getElementById('recover_export_txt')?.addEventListener('click', () => {
      window.RecoverAdvanced?.exportToTXT?.() || alert('RecoverAdvanced não disponível');
    });
    document.getElementById('recover_export_pdf')?.addEventListener('click', () => {
      window.RecoverAdvanced?.exportToPDF?.() || alert('RecoverAdvanced não disponível');
    });
    
    // FIX #5: SYNC BACKEND - Improved error handling
    const syncBtn = document.getElementById('recover_sync_backend');
    if (syncBtn) {
      syncBtn.addEventListener('click', async () => {
        syncBtn.disabled = true;
        syncBtn.textContent = '⏳ Sync...';
        
        try {
          // Tentar sincronizar com backend
          const result = await window.RecoverAdvanced?.syncWithBackend?.();
          
          if (result === true) {
            syncBtn.textContent = '✅ OK!';
            showToast('✅ Sincronizado com sucesso!');
          } else if (result === false) {
            // Backend não disponível, mas não é um erro
            syncBtn.textContent = 'ℹ️ Offline';
            showToast('ℹ️ Backend não disponível. Dados salvos localmente.');
          } else {
            syncBtn.textContent = '☁️ Sync';
            showToast('ℹ️ Sync offline. Dados salvos localmente.');
          }
        } catch(e) {
          // Não mostrar erro técnico, mostrar mensagem amigável
          console.log('[Recover] Sync error (expected if no backend):', e);
          syncBtn.textContent = 'ℹ️ Local';
          showToast('ℹ️ Sync offline. Dados salvos localmente.');
        }
        
        // Restaurar botão após 2 segundos
        setTimeout(() => {
          syncBtn.disabled = false;
          syncBtn.textContent = '☁️ Sync';
        }, 2000);
      });
    }
    
    // ===== NOTIFICAÇÕES DESKTOP =====
    const notifCheckbox = document.getElementById('recover_notifications_enabled');
    if (notifCheckbox) {
      // MED-012: persistir toggle imediatamente (com rollback se permissão negada)
      const key = 'whl_recover_notifications_enabled';
      const setupToggle = window.WHLUIHelpers?.setupToggle;
      if (typeof setupToggle === 'function') {
        setupToggle(notifCheckbox, key, async (enabled) => {
          if (enabled) {
            const p = await Notification.requestPermission();
            if (p === 'granted') {
              window.RecoverAdvanced?.setContactNotification?.('all', true);
            } else {
              throw new Error('Permissão de notificação negada');
            }
          } else {
            window.RecoverAdvanced?.setContactNotification?.('all', false);
          }
        });
      }
    }
    
    // ===== ADICIONAR CONTATO PARA NOTIFICAÇÃO =====
    const addNotifyBtn = document.getElementById('recover_add_notify_contact');
    const notifyInput = document.getElementById('recover_notify_contact');
    const notifyList = document.getElementById('recover_notify_contacts_list');
    
    if (addNotifyBtn && notifyInput) {
      addNotifyBtn.addEventListener('click', () => {
        const phone = notifyInput.value.trim().replace(/\D/g, '');
        if (phone.length >= 10) {
          window.RecoverAdvanced?.setContactNotification?.(phone, true);
          notifyInput.value = '';
          updateNotifyList();
          alert(`Notificações ativadas para ${phone}`);
        } else {
          alert('Digite um número válido');
        }
      });
    }
    
    function updateNotifyList() {
      if (!notifyList) return;
      const contacts = window.RecoverAdvanced?.getContactNotifications?.() || [];
      // PARTIAL-001 FIX: XSS P0 - Usar textContent ao invés de innerHTML para dados não confiáveis
      notifyList.innerHTML = ''; // Limpar primeiro
      const filteredContacts = contacts.filter(c => c !== 'all');

      if (filteredContacts.length === 0) {
        const emptySpan = document.createElement('span');
        emptySpan.style.color = '#6b7280';
        emptySpan.textContent = 'Nenhum contato específico';
        notifyList.appendChild(emptySpan);
      } else {
        filteredContacts.forEach(c => {
          const span = document.createElement('span');
          span.style.cssText = 'background:rgba(16,185,129,0.2);padding:2px 6px;border-radius:4px;margin-right:4px';
          span.textContent = String(c); // Usar textContent evita XSS
          notifyList.appendChild(span);
        });
      }
    }
    updateNotifyList();
    
    // ===== PAGINAÇÃO =====
    document.getElementById('recover_prev_page')?.addEventListener('click', () => {
      window.RecoverAdvanced?.prevPage?.();
      window.recoverRefresh?.(false);
    });
    document.getElementById('recover_next_page')?.addEventListener('click', () => {
      window.RecoverAdvanced?.nextPage?.();
      window.recoverRefresh?.(false);
    });
    
    // FIX #8: REAL-TIME UPDATES - Setup listeners
    setupRecoverRealTimeListeners();
    
    console.log('[Recover] ✅ Handlers configurados');
  }
  
  // FIX #8: Setup Real-Time Listeners for Recover
  function setupRecoverRealTimeListeners() {
    console.log('[Recover] Setting up real-time listeners...');
    
    // 1. Listener de chrome.runtime messages
    if (chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'WHL_RECOVER_UPDATE') {
          console.log('[Recover UI] Runtime update received:', msg.event);
          handleRecoverUpdate(msg.event, msg.data);
        }
      });
    }
    
    // 2. Listener de window.postMessage
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'WHL_RECOVER_UPDATE' || 
          e.data?.type === 'WHL_RECOVER_NEW_MESSAGE' ||
          e.data?.type === 'WHL_RECOVERED_MESSAGE' ||
          e.data?.type === 'WHL_MESSAGE_DELETED' ||
          e.data?.type === 'WHL_MESSAGE_EDITED') {
        console.log('[Recover UI] PostMessage update:', e.data.type);
        handleRecoverUpdate(e.data.type, e.data.payload || e.data);
      }
    });
    
    // 3. Listener de EventBus
    if (window.EventBus) {
      window.EventBus.on('recover:message_added', (msg) => {
        handleRecoverUpdate('message_added', msg);
      });
      window.EventBus.on('recover:message_removed', (msg) => {
        handleRecoverUpdate('message_removed', msg);
      });
      window.EventBus.on('recover:message_edited', (msg) => {
        handleRecoverUpdate('message_edited', msg);
      });
    }
    
    // 4. Polling fallback - verificar a cada 3 segundos
    // CODE REVIEW FIX: Store interval ID for cleanup
    if (window._recoverPollingInterval) {
      clearInterval(window._recoverPollingInterval);
    }
    
    window._recoverPollingInterval = setInterval(() => {
      // Only poll if recover view is active
      const recoverView = document.getElementById('whlViewRecover');
      if (!recoverView || recoverView.classList.contains('hidden')) {
        return;
      }
      
      const currentCount = window.RecoverAdvanced?.getMessages?.()?.length || 0;
      const displayedTotalEl = document.getElementById('sp_recover_total');
      const displayedCount = parseInt(displayedTotalEl?.textContent || '0');
      
      if (currentCount !== displayedCount) {
        console.log('[Recover UI] Polling detected change:', displayedCount, '->', currentCount);
        if (typeof window.recoverRefresh === 'function') {
          window.recoverRefresh(false);
        }
      }
    }, 3000);
    
    console.log('[Recover] ✅ Real-time listeners configurados');
  }

  window.__whlSidepanelELM?.on(window, 'beforeunload', () => {
    if (window._recoverPollingInterval) {
      clearInterval(window._recoverPollingInterval);
      window._recoverPollingInterval = null;
    }
  });
  
  function handleRecoverUpdate(event, data) {
    // Verificar se estamos na aba recover
    const recoverView = document.getElementById('whlViewRecover');
    if (!recoverView || recoverView.classList.contains('hidden')) {
      return; // Não atualizar se não estiver visível
    }
    
    console.log('[Recover UI] Handling update:', event, data);
    
    // Adicionar nova mensagem no TOPO sem recarregar tudo
    if (event === 'message_added' || event === 'message_removed' || event === 'message_edited' ||
        event === 'WHL_RECOVER_NEW_MESSAGE' || event === 'WHL_RECOVERED_MESSAGE' || 
        event === 'WHL_MESSAGE_DELETED' || event === 'WHL_MESSAGE_EDITED') {
      
      // Re-renderizar timeline
      if (typeof window.recoverRefresh === 'function') {
        window.recoverRefresh(false);
      }
      
      // Highlight visual na primeira mensagem
      setTimeout(() => {
        const container = document.getElementById('sp_recover_timeline');
        if (container?.firstElementChild) {
          container.firstElementChild.classList.add('recover-item-new');
          setTimeout(() => {
            container.firstElementChild?.classList.remove('recover-item-new');
          }, 3000);
        }
      }, 100);
      
      // Toast notification
      if (typeof showToast === 'function') {
        const actionLabels = {
          'message_added': '💬 Nova mensagem recuperada',
          'WHL_RECOVER_NEW_MESSAGE': '💬 Nova mensagem recuperada',
          'WHL_RECOVERED_MESSAGE': '🚫 Mensagem revogada recuperada',
          'WHL_MESSAGE_DELETED': '🗑️ Mensagem apagada recuperada',
          'WHL_MESSAGE_EDITED': '✏️ Mensagem editada detectada',
          'message_edited': '✏️ Mensagem editada',
          'message_removed': '🗑️ Mensagem removida'
        };
        const label = actionLabels[event] || 'Atualização';
        showToast(label);
      }
    }
  }
})();
