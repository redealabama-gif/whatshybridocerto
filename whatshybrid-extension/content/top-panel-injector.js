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
                    <div class="top-panel-logo" title="Vórtex">
                        <img src="${chrome.runtime.getURL('icons/48.png')}" alt="Vórtex" class="logo-icon-img" style="width:24px;height:24px;border-radius:4px;">
                        <span class="logo-text">Vórtex</span>
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
                        <button class="top-panel-tab" data-view="recover" title="Recover - Mensagens apagadas/editadas">
                            <span class="tab-icon">🔄</span>
                            <span class="tab-label">Recover</span>
                        </button>
                        <button class="top-panel-tab" data-view="crm" title="CRM">
                            <span class="tab-icon">💼</span>
                            <span class="tab-label">CRM</span>
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
                        <button class="top-panel-tab" data-view="team" title="Sistema de Equipe">
                            <span class="tab-icon">👥</span>
                            <span class="tab-label">Equipe</span>
                        </button>
                        <button class="top-panel-tab" data-view="groups" title="Extrator de Grupos — lista grupos e extrai membros">
                            <span class="tab-icon">📂</span>
                            <span class="tab-label">Grupos</span>
                        </button>
                        <button class="top-panel-tab" data-view="quickreplies" title="Resposta Rápida — gatilho / no chat">
                            <span class="tab-icon">⚡</span>
                            <span class="tab-label">Resposta Rápida</span>
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
                        <!-- v9.7.x — Botão X (remover chave). Aparece só quando assinatura
                             ativa, permitindo que o user limpe a chave pra logar em outra máquina. -->
                        <button id="whl-deactivate-btn" class="subscription-deactivate-btn"
                                title="Remover chave (sair desta máquina)"
                                style="display:none;">
                            ✕
                        </button>
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
        btn.title = 'Mostrar painéis (Vórtex Lite)';

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
        // v9.7.x — Gate de plano antes de abrir abas/popups.
        // Mapa view/action → feature key do FeatureGate. Se a feature não
        // estiver mapeada (ex: principal, recover), o clique passa direto.
        // O FeatureGate é tolerante: se não existir, o gate é no-op.
        const FEATURE_BY_VIEW = {
            ai:        'module:ai',
            autopilot: 'module:autopilot',
            extrator:  'module:extractor',
            team:      'module:team',
            // crm, tasks, config, backup, principal, recover: free → sem gate
        };
        const FEATURE_BY_ACTION = {
            'open-training': 'module:training',
        };

        // Tenta bloquear via FeatureGate. Retorna true se bloqueou (chamador
        // NÃO deve prosseguir). Se FeatureGate não está disponível, libera.
        function gateBlocked(featureKey, contextLabel) {
            if (!featureKey) return false;
            const FG = (typeof window !== 'undefined') ? window.FeatureGate : null;
            if (!FG || typeof FG.check !== 'function') return false;
            const result = FG.check(featureKey);
            if (result && result.allowed) return false;

            // Bloqueou: usa o próprio handler do FeatureGate (que mostra modal
            // de upsell via NotificationsModule + emite evento). Fallback pra
            // alert simples se o handler não estiver acessível.
            try {
                if (typeof FG.guard === 'function') {
                    // guard() chama check+handleBlocked internamente
                    FG.guard(featureKey);
                } else if (typeof FG.handleBlocked === 'function') {
                    FG.handleBlocked(featureKey, result);
                } else {
                    const msg = result?.message || `${contextLabel || 'Este recurso'} não está disponível no seu plano. Faça upgrade pra desbloquear.`;
                    alert(msg);
                }
            } catch (e) {
                console.warn('[TopPanel] gate handler falhou:', e?.message);
            }
            debugLog('[TopPanel] 🔒 Bloqueado por plano:', featureKey, result);
            return true;
        }

        // Botões que abrem em popup/nova aba (não no sidepanel)
        const popupButtons = panel.querySelectorAll('.top-panel-tab-popup');
        popupButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;

                // v9.7.x — gate antes de abrir popup
                const featureKey = FEATURE_BY_ACTION[action];
                if (gateBlocked(featureKey, 'Treinamento de IA')) return;

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

                const view = tab.dataset.view || 'principal';

                // v9.7.x — gate antes de marcar como ativo e abrir
                if (gateBlocked(FEATURE_BY_VIEW[view], view)) {
                    // Não trocar a aba ativa visualmente quando bloqueado —
                    // assim o cliente fica no contexto em que estava.
                    return;
                }

                // Não marcar popup buttons como active
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

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

        // v9.7.x — Botão X (remover chave). Confirma com o user antes pra não
        // perder estado por clique acidental. Após desativar, limpa o storage
        // local e devolve a UI ao modo "código de assinatura" pra próximo login.
        const deactivateBtn = document.getElementById('whl-deactivate-btn');
        if (deactivateBtn) {
            deactivateBtn.addEventListener('click', async () => {
                const ok = confirm(
                    'Remover a chave de assinatura desta máquina?\n\n' +
                    'Sua conta continua ativa — você só vai precisar reativar ' +
                    'a chave neste navegador / computador.\n\n' +
                    'Os dados locais (CRM, treinamento, conversas) NÃO são ' +
                    'apagados.'
                );
                if (!ok) return;

                deactivateBtn.disabled = true;
                deactivateBtn.textContent = '⏳';

                try {
                    if (window.SubscriptionManager?.deactivateSubscription) {
                        await window.SubscriptionManager.deactivateSubscription();
                        showSubscriptionMessage('Chave removida ✓', 'success');
                        // Limpa input + atualiza UI; updateSubscriptionUI agora
                        // mostra o input wrapper novamente e esconde o X.
                        const input = document.getElementById('whl-subscription-code');
                        if (input) input.value = '';
                        updateSubscriptionUI();
                    } else {
                        showSubscriptionMessage('Sistema não pronto', 'error');
                    }
                } catch (error) {
                    debugLog('[TopPanel] deactivate error:', error?.message);
                    showSubscriptionMessage('Erro ao remover chave', 'error');
                }

                deactivateBtn.disabled = false;
                deactivateBtn.textContent = '✕';
            });
        }

        // Atualizar UI inicial
        setTimeout(updateSubscriptionUI, 1000);

        // Listener para mudanças na assinatura
        if (window.EventBus) {
            window.EventBus.on('subscription:initialized', updateSubscriptionUI);
            window.EventBus.on('subscription:subscription_activated', updateSubscriptionUI);
            window.EventBus.on('subscription:credits_consumed', updateSubscriptionUI);

            // Códigos revogados, expirados ou em uso em outra máquina —
            // detectados em sync periódico. Reflete imediatamente no widget.
            window.EventBus.on('subscription:subscription_revoked', (data) => {
                updateSubscriptionUI();
                const msg = data?.reason === 'in_use_elsewhere'
                  ? 'Sua assinatura está em uso em outro dispositivo. Desvincule no painel para usar aqui.'
                  : data?.reason === 'invalid_code'
                    ? 'Código de assinatura inválido.'
                    : 'Sua assinatura foi revogada.';
                try {
                    window.NotificationsModule?.warning?.(`⚠️ ${msg}`);
                } catch (_) {}
            });

            // Falhas de ativação — feedback inline no input.
            window.EventBus.on('subscription:activation_error', (data) => {
                const input = document.getElementById('whl-subscription-code');
                if (!input) return;
                input.classList.add('whl-input-error');
                input.title = data?.message || 'Erro ao validar código';
                setTimeout(() => input.classList.remove('whl-input-error'), 5000);
            });
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

        // Estados extras que podem ser sinalizados via sync (não pelo getPlan)
        const rawStatus = SM.getStatus?.()?.subscription?.status || SM.getStatus?.()?.status || null;
        const isInUseElsewhere = rawStatus === 'in_use_elsewhere';
        const isRevoked = rawStatus === 'revoked' || rawStatus === 'invalid';
        const isExpired = rawStatus === 'expired' || rawStatus === 'trial_expired';

        // Atualizar texto do plano baseado no status
        if (planEl) {
            if (isInUseElsewhere) {
                planEl.innerHTML = `<span class="plan-active-badge" style="background:rgba(239,68,68,.2);color:#ef4444">🔒 Em outra máquina</span>`;
                planEl.style.color = '#ef4444';
                planEl.classList.add('plan-active');
            } else if (isRevoked) {
                planEl.innerHTML = `<span class="plan-active-badge" style="background:rgba(239,68,68,.2);color:#ef4444">❌ Revogado</span>`;
                planEl.style.color = '#ef4444';
                planEl.classList.add('plan-active');
            } else if (isExpired) {
                planEl.innerHTML = `<span class="plan-active-badge" style="background:rgba(245,158,11,.2);color:#f59e0b">⏰ Expirado</span>`;
                planEl.style.color = '#f59e0b';
                planEl.classList.add('plan-active');
            } else if (isMasterKey) {
                planEl.innerHTML = `<span class="plan-active-badge plan-master">👑 ACESSO TOTAL ∞</span>`;
                planEl.style.color = '#f59e0b';
                planEl.classList.add('plan-active', 'plan-master-key');
            } else if (isActive && planId !== 'free') {
                if (isTrial) {
                    const daysLeft = SM.getTrialDaysRemaining();
                    planEl.innerHTML = `<span class="plan-active-badge">Plano ${escapeHtml(plan.name)} <small>(Trial: ${daysLeft}d)</small></span>`;
                } else {
                    planEl.innerHTML = `<span class="plan-active-badge">Plano ${escapeHtml(plan.name)} Ativado ✓</span>`;
                }
                planEl.style.color = plan.color || '#8b5cf6';
                planEl.classList.add('plan-active');
            } else {
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

        // v9.7.x — Botão de remover chave aparece só com assinatura ativa.
        // Permite que o user limpe a chave aqui e ative em outra máquina.
        const deactivateBtn = document.getElementById('whl-deactivate-btn');
        if (deactivateBtn) {
            const showDeactivate = isActive && planId !== 'free';
            deactivateBtn.style.display = showDeactivate ? 'inline-flex' : 'none';
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
