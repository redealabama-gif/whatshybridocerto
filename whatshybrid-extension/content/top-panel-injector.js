// top-panel-injector.js - Injects a top panel into WhatsApp Web
// The Top Panel is the main navigation bar and can (re)open the Side Panel
// based on user interaction (Chrome requires a user gesture to open Side Panel).

(function() {
    'use strict';

    const WHL_DEBUG = (typeof localStorage !== 'undefined' && localStorage.getItem('whl_debug') === 'true');
    const debugLog = (...args) => { if (WHL_DEBUG) console.log(...args); };

    function escapeHtml(str) {
        const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
        if (typeof fn === 'function' && fn !== escapeHtml) return fn(str);
        if (str === undefined || str === null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    debugLog('[TopPanel] 🚀 Initializing top panel injector...');

    const TOP_PANEL_ID = 'wa-extractor-top-panel';
    const RESTORE_BTN_ID = 'wa-extractor-restore-btn';

    let autoOpenArmed = false;
    let autoOpenDone = false;

    // Wait for WhatsApp to load
    function waitForWhatsApp() {
        return new Promise((resolve) => {
            let checkInterval = null;
            checkInterval = setInterval(() => {
                const whatsappRoot = document.getElementById('app');
                if (whatsappRoot) {
                    if (checkInterval) clearInterval(checkInterval);
                    checkInterval = null;
                    debugLog('[TopPanel] ✅ WhatsApp loaded, injecting panel...');
                    resolve();
                }
            }, 500);

            // Cleanup no unload
            window.addEventListener('beforeunload', () => {
                if (checkInterval) {
                    clearInterval(checkInterval);
                    checkInterval = null;
                }
            });
        });
    }

    // Helpers for Side Panel
    function setSidePanelEnabled(enabled) {
        try {
            chrome.runtime.sendMessage({ action: 'WHL_SET_SIDE_PANEL_ENABLED', enabled })
                .then(() => {
                    debugLog(`[TopPanel] Side panel ${enabled ? 'enabled' : 'disabled'}`);
                })
                .catch((err) => {
                    console.warn('[TopPanel] Failed to set side panel enabled state:', err);
                });
        } catch (e) {
            console.warn('[TopPanel] Error in setSidePanelEnabled:', e);
        }
    }

    function openSidePanel(view) {
        try {
            debugLog(`[TopPanel] ▶️ Opening side panel with view: ${view}`);
            
            // Enviar mensagem para background
            chrome.runtime.sendMessage({ action: 'WHL_OPEN_SIDE_PANEL_VIEW', view })
                .then((response) => {
                    debugLog('[TopPanel] ✅ Response from background:', response);
                    if (response && response.success) {
                        debugLog(`[TopPanel] ✅ Side panel opened successfully for view: ${view}`);
                    } else {
                        debugLog('[TopPanel] ⚠️ Side panel response not success:', response);
                    }
                })
                .catch((err) => {
                    debugLog('[TopPanel] Side panel não disponível - clique no ícone da extensão');
                });
        } catch (e) {
            debugLog('[TopPanel] Erro ao abrir side panel:', e);
        }
    }

    function getActiveView() {
        const panel = document.getElementById(TOP_PANEL_ID);
        const active = panel?.querySelector('.top-panel-tab.active');
        return active?.dataset?.view || 'principal';
    }

    // Create the top panel HTML
    function createTopPanel() {
        const panel = document.createElement('div');
        panel.id = TOP_PANEL_ID;
        panel.className = 'wa-extractor-top-panel';

        panel.innerHTML = `
            <div class="top-panel-container">
                <div class="top-panel-left">
                    <div class="top-panel-logo" title="WhatsHybrid">
                        <img src="${chrome.runtime.getURL('icons/48.png')}" alt="WhatsHybrid" class="logo-icon-img" style="width:24px;height:24px;border-radius:4px;">
                        <span class="logo-text">WhatsHybrid</span>
                    </div>
                </div>
                <div class="top-panel-center">
                    <div class="top-panel-tabs">
                        <button class="top-panel-tab active" data-view="principal" title="Disparo de mensagens">
                            <span class="tab-icon">📨</span>
                            <span class="tab-label">Disparo</span>
                        </button>
                        <button class="top-panel-tab" data-view="extrator" title="Extrator">
                            <span class="tab-icon">📥</span>
                            <span class="tab-label">Extrator</span>
                        </button>
                        <button class="top-panel-tab" data-view="groups" title="Grupos">
                            <span class="tab-icon">👥</span>
                            <span class="tab-label">Grupos</span>
                        </button>
                        <button class="top-panel-tab" data-view="recover" title="Recover - Mensagens apagadas/editadas">
                            <span class="tab-icon">🔄</span>
                            <span class="tab-label">Recover</span>
                        </button>
                        <button class="top-panel-tab" data-view="crm" title="CRM">
                            <span class="tab-icon">💼</span>
                            <span class="tab-label">CRM</span>
                        </button>
                        <button class="top-panel-tab" data-view="analytics" title="Analytics">
                            <span class="tab-icon">📊</span>
                            <span class="tab-label">Analytics</span>
                        </button>
                        <button class="top-panel-tab" data-view="tasks" title="Tarefas">
                            <span class="tab-icon">📋</span>
                            <span class="tab-label">Tarefas</span>
                        </button>
                        <button class="top-panel-tab" data-view="ai" title="Smart Replies">
                            <span class="tab-icon">🧠</span>
                            <span class="tab-label">IA</span>
                        </button>
                        <button class="top-panel-tab" data-view="autopilot" title="Auto-Pilot">
                            <span class="tab-icon">🤖</span>
                            <span class="tab-label">Auto-Pilot</span>
                        </button>
                        <button class="top-panel-tab top-panel-tab-popup" data-action="open-training" title="Treinamento de IA - Abre em nova aba">
                            <span class="tab-icon">🎓</span>
                            <span class="tab-label">Treinamento IA</span>
                        </button>
                        <button class="top-panel-tab" data-view="quickreplies" title="Respostas Rápidas">
                            <span class="tab-icon">⚡</span>
                            <span class="tab-label">Quick Replies</span>
                        </button>
                        <button class="top-panel-tab" data-view="team" title="Sistema de Equipe">
                            <span class="tab-icon">👥</span>
                            <span class="tab-label">Equipe</span>
                        </button>
                        <button class="top-panel-tab" data-view="config" title="Configurações">
                            <span class="tab-icon">⚙️</span>
                            <span class="tab-label">Config</span>
                        </button>
                        <button class="top-panel-tab" data-view="backup" title="Backup">
                            <span class="tab-icon">💾</span>
                            <span class="tab-label">Backup</span>
                        </button>
                    </div>
                </div>
                <div class="top-panel-right">
                    <div class="subscription-widget" id="whl-subscription-widget">
                        <div class="subscription-status" id="whl-sub-status">
                            <span class="sub-icon" id="whl-sub-icon">🆓</span>
                            <span class="sub-plan" id="whl-sub-plan">Gratuito</span>
                        </div>
                        <div class="subscription-credits" id="whl-sub-credits" title="Créditos de IA restantes">
                            <span class="credits-icon">🤖</span>
                            <span class="credits-value" id="whl-credits-value">0</span>
                        </div>
                        <div class="subscription-input-wrapper" id="whl-sub-input-wrapper">
                            <input type="text" 
                                   id="whl-subscription-code" 
                                   class="subscription-input" 
                                   placeholder="Código de Assinatura" 
                                   maxlength="30">
                            <button id="whl-activate-btn" class="subscription-activate-btn" title="Ativar Assinatura">
                                ✓
                            </button>
                        </div>
                    </div>
                    <button class="top-panel-action" data-action="toggle" title="Minimizar (oculta painel superior + lateral)">🗕</button>
                </div>
            </div>
        `;

        return panel;
    }

    // Restore button (to bring the panels back)
    function ensureRestoreButton() {
        let btn = document.getElementById(RESTORE_BTN_ID);
        if (btn) return btn;

        btn = document.createElement('button');
        btn.id = RESTORE_BTN_ID;
        btn.className = 'wa-extractor-restore-btn';
        btn.type = 'button';
        btn.textContent = 'WHL';
        btn.title = 'Mostrar painéis (WhatsHybrid Lite)';

        btn.addEventListener('click', () => {
            // User gesture: we can reopen side panel here
            showTopPanel();
            hideRestoreButton();

            setSidePanelEnabled(true);
            openSidePanel(getActiveView());
        });

        document.body.appendChild(btn);
        return btn;
    }

    function showRestoreButton() {
        const btn = ensureRestoreButton();
        btn.style.display = '';
    }

    function hideRestoreButton() {
        const btn = document.getElementById(RESTORE_BTN_ID);
        if (btn) btn.style.display = 'none';
    }

    // Compress WhatsApp to make room for the panel
    function compressWhatsAppContent() {
        const whatsappRoot = document.getElementById('app');
        if (whatsappRoot) {
            whatsappRoot.style.setProperty('margin-top', '64px', 'important');
            whatsappRoot.style.setProperty('height', 'calc(100vh - 64px)', 'important');
            document.body.classList.add('wa-extractor-top-panel-visible');
        }
    }

    function restoreWhatsAppContent() {
        const whatsappRoot = document.getElementById('app');
        if (whatsappRoot) {
            whatsappRoot.style.removeProperty('margin-top');
            whatsappRoot.style.removeProperty('height');
        }
        document.body.classList.remove('wa-extractor-top-panel-visible');
    }

    // Show top panel
    function showTopPanel() {
        const panel = document.getElementById(TOP_PANEL_ID);
        if (panel) {
            panel.classList.remove('hidden');
            compressWhatsAppContent();
            debugLog('[TopPanel] ✅ Top panel shown');
        }
    }

    // Hide top panel
    function hideTopPanel() {
        const panel = document.getElementById(TOP_PANEL_ID);
        if (panel) {
            panel.classList.add('hidden');
            restoreWhatsAppContent();

            // Sync with Side Panel: disable it (this closes/hides it for this tab)
            setSidePanelEnabled(false);

            showRestoreButton();
            debugLog('[TopPanel] ✅ Top panel hidden');
        }
    }

    // Auto-open Side Panel on the first user interaction after WhatsApp loads
    // (Chrome requires a user gesture for sidePanel.open)
    function armAutoOpenSidePanelOnce() {
        if (autoOpenArmed) return;
        autoOpenArmed = true;

        const handler = () => {
            if (autoOpenDone) return;
            autoOpenDone = true;

            document.removeEventListener('click', handler, true);
            document.removeEventListener('keydown', handler, true);

            const panel = document.getElementById(TOP_PANEL_ID);
            if (panel?.classList.contains('hidden')) return;

            setSidePanelEnabled(true);
            openSidePanel(getActiveView());
        };

        // Use capture to catch the first interaction early
        document.addEventListener('click', handler, true);
        document.addEventListener('keydown', handler, true);
    }

    // Setup event listeners for the panel
    function setupEventListeners(panel) {
        // Botões que abrem em popup/nova aba (não no sidepanel)
        const popupButtons = panel.querySelectorAll('.top-panel-tab-popup');
        popupButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                
                if (action === 'open-training') {
                    debugLog('[TopPanel] 🎓 Abrindo Treinamento de IA em nova aba...');
                    chrome.runtime.sendMessage({ 
                        action: 'WHL_OPEN_POPUP_TAB', 
                        url: 'training/training.html' 
                    });
                }
            });
        });

        // View switching (Top Panel is the main router)
        const tabs = panel.querySelectorAll('.top-panel-tab:not(.top-panel-tab-popup)');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                debugLog('[TopPanel] 🖱️ Tab clicked:', tab.dataset.view);
                
                // Não marcar popup buttons como active
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const view = tab.dataset.view || 'principal';
                debugLog(`[TopPanel] View switched to: ${view}`);

                // Garantir que side panel está habilitado
                setSidePanelEnabled(true);
                
                // Abrir com a nova view
                openSidePanel(view);
                
                debugLog(`[TopPanel] ✅ Message sent for view: ${view}`);
            });
        });

        // Minimize button
        const toggleBtn = panel.querySelector('.top-panel-action[data-action="toggle"]');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                hideTopPanel();
            });
        }

        // Subscription activation
        setupSubscriptionWidget();
    }

    // Subscription Widget
    function setupSubscriptionWidget() {
        const activateBtn = document.getElementById('whl-activate-btn');
        const codeInput = document.getElementById('whl-subscription-code');

        if (activateBtn && codeInput) {
            activateBtn.addEventListener('click', async () => {
                const code = codeInput.value.trim();
                if (!code) {
                    showSubscriptionMessage('Digite um código', 'error');
                    return;
                }

                activateBtn.disabled = true;
                activateBtn.textContent = '⏳';

                try {
                    if (window.SubscriptionManager) {
                        const result = await window.SubscriptionManager.activateSubscription(code);
                        if (result.success) {
                            showSubscriptionMessage('Ativado! ✓', 'success');
                            codeInput.value = '';
                            updateSubscriptionUI();
                        } else {
                            showSubscriptionMessage(result.error || 'Código inválido', 'error');
                        }
                    } else {
                        showSubscriptionMessage('Sistema não pronto', 'error');
                    }
                } catch (error) {
                    showSubscriptionMessage('Erro ao ativar', 'error');
                }

                activateBtn.disabled = false;
                activateBtn.textContent = '✓';
            });

            // Enter para ativar
            codeInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    activateBtn.click();
                }
            });
        }

        // Atualizar UI inicial
        setTimeout(updateSubscriptionUI, 1000);

        // Listener para mudanças na assinatura
        if (window.EventBus) {
            window.EventBus.on('subscription:initialized', updateSubscriptionUI);
            window.EventBus.on('subscription:subscription_activated', updateSubscriptionUI);
            window.EventBus.on('subscription:credits_consumed', updateSubscriptionUI);
        }
    }

    function updateSubscriptionUI() {
        if (!window.SubscriptionManager) return;

        const SM = window.SubscriptionManager;
        const plan = SM.getPlan();
        const credits = SM.getCredits();
        const isActive = SM.isActive();
        const isTrial = SM.isTrial();
        const isMasterKey = SM.isMasterKey ? SM.isMasterKey() : false;
        const planId = SM.getPlanId();

        // Elementos
        const statusEl = document.getElementById('whl-sub-status');
        const iconEl = document.getElementById('whl-sub-icon');
        const planEl = document.getElementById('whl-sub-plan');
        const creditsEl = document.getElementById('whl-credits-value');
        const inputWrapper = document.getElementById('whl-sub-input-wrapper');
        const creditsWidget = document.getElementById('whl-sub-credits');
        const widget = document.getElementById('whl-subscription-widget');

        // Atualizar ícone
        if (iconEl) iconEl.textContent = plan.icon || '🆓';
        
        // Atualizar texto do plano baseado no status
        if (planEl) {
            if (isMasterKey) {
                // Master Key - Acesso total
                planEl.innerHTML = `<span class="plan-active-badge plan-master">👑 ACESSO TOTAL ∞</span>`;
                planEl.style.color = '#f59e0b';
                planEl.classList.add('plan-active', 'plan-master-key');
            } else if (isActive && planId !== 'free') {
                // Plano ativo - mostrar "Plano X Ativado"
                if (isTrial) {
                    const daysLeft = SM.getTrialDaysRemaining();
                    planEl.innerHTML = `<span class="plan-active-badge">Plano ${escapeHtml(plan.name)} <small>(Trial: ${daysLeft}d)</small></span>`;
                } else {
                    planEl.innerHTML = `<span class="plan-active-badge">Plano ${escapeHtml(plan.name)} Ativado ✓</span>`;
                }
                planEl.style.color = plan.color || '#8b5cf6';
                planEl.classList.add('plan-active');
            } else {
                // Sem plano ou gratuito
                planEl.textContent = plan.name;
                planEl.style.color = plan.color || '#6b7280';
                planEl.classList.remove('plan-active');
            }
        }

        // Adicionar classe de status ao widget
        if (widget) {
            widget.classList.remove('status-free', 'status-starter', 'status-pro', 'status-enterprise', 'status-trial', 'status-master');
            if (isMasterKey) {
                widget.classList.add('status-master');
            } else if (isActive && planId !== 'free') {
                widget.classList.add(`status-${planId}`);
                if (isTrial) widget.classList.add('status-trial');
            } else {
                widget.classList.add('status-free');
            }
        }

        // Atualizar créditos
        if (creditsEl) {
            creditsEl.textContent = credits.remaining;
            creditsEl.style.color = credits.remaining <= 10 ? '#ef4444' : 
                                    credits.remaining <= 50 ? '#f59e0b' : '#10b981';
        }

        // Mostrar/ocultar campo de entrada baseado no status
        if (inputWrapper) {
            if (isActive && planId !== 'free') {
                inputWrapper.style.display = 'none';
            } else {
                inputWrapper.style.display = 'flex';
            }
        }

        // Mostrar créditos apenas se tiver plano pago
        if (creditsWidget) {
            if (isActive && plan.features.aiCredits > 0) {
                creditsWidget.style.display = 'flex';
            } else {
                creditsWidget.style.display = 'none';
            }
        }

        debugLog(`[TopPanel] 📊 Subscription UI updated: ${planId} (active: ${isActive})`);
    }

    function showSubscriptionMessage(message, type) {
        const statusEl = document.getElementById('whl-sub-status');
        if (!statusEl) return;

        const originalContent = statusEl.innerHTML;
        const allowedTypes = ['success', 'error', 'warning', 'info'];
        const safeType = allowedTypes.includes(type) ? type : 'info';
        statusEl.innerHTML = `<span class="sub-message ${safeType}">${escapeHtml(message)}</span>`;

        setTimeout(() => {
            statusEl.innerHTML = originalContent;
            updateSubscriptionUI();
        }, 2000);
    }

    // Listen for custom events from content.js (which receives messages from background)
    function registerEventListeners() {
        window.addEventListener('wa-extractor-show-top-panel', () => {
            debugLog('[TopPanel] Received show event');
            showTopPanel();
            hideRestoreButton();
            setSidePanelEnabled(true);
        });

        window.addEventListener('wa-extractor-hide-top-panel', () => {
            debugLog('[TopPanel] Received hide event');
            hideTopPanel();
        });

        debugLog('[TopPanel] ✅ Event listeners registered');
    }

    // Inject the panel into WhatsApp
    function injectPanel() {
        if (document.getElementById(TOP_PANEL_ID)) {
            debugLog('[TopPanel] ⚠️ Panel already injected');
            return;
        }

        const panel = createTopPanel();
        document.body.insertBefore(panel, document.body.firstChild);

        // Visible by default
        compressWhatsAppContent();

        setupEventListeners(panel);
        registerEventListeners();

        // Ensure side panel is enabled on this tab (opening still requires user gesture)
        setSidePanelEnabled(true);

        // Arm auto-open on first user gesture
        armAutoOpenSidePanelOnce();

        // Restore button hidden by default
        hideRestoreButton();

        debugLog('[TopPanel] ✅ Panel injected successfully (visible by default)');
    }

    // Initialize
    async function init() {
        await waitForWhatsApp();
        setTimeout(() => {
            injectPanel();
        }, 1000);
    }

    // Start the injection process
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
