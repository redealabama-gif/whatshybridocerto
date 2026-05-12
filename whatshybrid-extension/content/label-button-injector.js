/**
 * 🏷️ Label Button Injector - Botão de etiqueta na lista de chats
 * WhatsHybrid v51 - Sincronizado com LabelsModule
 * 
 * Funcionalidades:
 * - Botão 🏷️ ao passar mouse sobre conversa
 * - Picker de etiquetas ao clicar
 * - Badges de etiquetas aplicadas visíveis na lista
 * - Sincronizado com storage do LabelsModule
 */

(function() {
    'use strict';

    const WHL_DEBUG = (typeof localStorage !== 'undefined' && localStorage.getItem('whl_debug') === 'true');
    const _console = window.console;
    // Shadow local console to make logs conditional without affecting the page globally
    const console = {
        log: (...args) => { if (WHL_DEBUG) _console.log(...args); },
        info: (...args) => { if (WHL_DEBUG) (_console.info || _console.log).call(_console, ...args); },
        debug: (...args) => { if (WHL_DEBUG) (_console.debug || _console.log).call(_console, ...args); },
        warn: (...args) => _console.warn(...args),
        error: (...args) => _console.error(...args)
    };

    if (window.__WHL_LABEL_BUTTON_INJECTOR__) return;

    // MESMA CHAVE que o LabelsModule usa
    const STORAGE_KEY = 'whl_labels_v2';
    
    let state = {
        labels: [],
        contactLabels: {},
        settings: {}
    };

    // Interval de injeção
    let injectInterval = null;

    // Labels padrão
    const DEFAULT_LABELS = [
        { id: 'new_client', name: 'Novo Cliente', color: '#10B981', icon: '🆕' },
        { id: 'vip', name: 'VIP', color: '#F59E0B', icon: '⭐' },
        { id: 'pending', name: 'Pendente', color: '#3B82F6', icon: '⏳' },
        { id: 'urgent', name: 'Urgente', color: '#EF4444', icon: '🔥' },
        { id: 'follow_up', name: 'Follow-up', color: '#8B5CF6', icon: '📞' },
        { id: 'done', name: 'Concluído', color: '#6B7280', icon: '✅' }
    ];

    // ==================== STORAGE ====================

    async function loadState() {
        return new Promise(resolve => {
            chrome.storage.local.get([STORAGE_KEY], result => {
                if (result[STORAGE_KEY]) {
                    state.labels = result[STORAGE_KEY].labels || DEFAULT_LABELS;
                    state.contactLabels = result[STORAGE_KEY].contactLabels || {};
                    state.settings = result[STORAGE_KEY].settings || {};
                } else {
                    // Inicializar com labels padrão
                    state.labels = DEFAULT_LABELS;
                    state.contactLabels = {};
                    saveState();
                }
                console.log('[LabelBtn] Estado carregado:', state.labels.length, 'etiquetas,', Object.keys(state.contactLabels).length, 'contatos');
                resolve();
            });
        });
    }

    async function saveState() {
        return new Promise(resolve => {
            const data = {
                labels: state.labels,
                contactLabels: state.contactLabels,
                settings: state.settings
            };
            chrome.storage.local.set({ [STORAGE_KEY]: data }, () => {
                console.log('[LabelBtn] Estado salvo');
                resolve();
            });
        });
    }

    function normalizePhone(phone) {
        return String(phone || '').replace(/\D/g, '');
    }

    function getContactLabels(phone) {
        const key = normalizePhone(phone);
        const ids = state.contactLabels[key] || [];
        return ids.map(id => state.labels.find(l => l.id === id)).filter(Boolean);
    }

    async function toggleLabel(phone, labelId) {
        const key = normalizePhone(phone);
        if (!key) return;
        
        if (!state.contactLabels[key]) {
            state.contactLabels[key] = [];
        }
        
        const index = state.contactLabels[key].indexOf(labelId);
        if (index > -1) {
            state.contactLabels[key].splice(index, 1);
            if (state.contactLabels[key].length === 0) {
                delete state.contactLabels[key];
            }
        } else {
            state.contactLabels[key].push(labelId);
        }
        
        await saveState();
        return index === -1; // Retorna true se foi adicionado
    }

    // ==================== ESTILOS ====================

    function injectStyles() {
        if (document.getElementById('whl-label-btn-styles')) return;

        const style = document.createElement('style');
        style.id = 'whl-label-btn-styles';
        style.textContent = `
            /* Botão de etiqueta */
            .whl-label-btn {
                position: absolute;
                right: 50px;
                top: 50%;
                transform: translateY(-50%);
                width: 26px;
                height: 26px;
                border-radius: 50%;
                background: linear-gradient(135deg, #8b5cf6, #6366f1);
                border: none;
                cursor: pointer;
                display: none;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                z-index: 100;
                box-shadow: 0 2px 8px rgba(139, 92, 246, 0.4);
                transition: all 0.2s ease;
            }

            .whl-label-btn:hover {
                transform: translateY(-50%) scale(1.15);
                box-shadow: 0 4px 12px rgba(139, 92, 246, 0.6);
            }

            /* Mostrar botão no hover do chat */
            [data-testid="cell-frame-container"]:hover .whl-label-btn,
            [data-testid="list-item-container"]:hover .whl-label-btn,
            ._ak8l:hover .whl-label-btn,
            .x10l6tqk:hover .whl-label-btn {
                display: flex !important;
            }

            /* Container de badges de etiquetas */
            .whl-chat-labels {
                display: flex;
                flex-wrap: wrap;
                gap: 2px;
                margin-top: 2px;
                max-width: 180px;
                overflow: hidden;
            }

            .whl-chat-label-badge {
                display: inline-flex;
                align-items: center;
                gap: 2px;
                padding: 1px 5px;
                border-radius: 6px;
                font-size: 9px;
                font-weight: 600;
                white-space: nowrap;
                line-height: 1.2;
            }

            /* Overlay do picker */
            .whl-label-picker-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: fadeIn 0.2s ease;
            }

            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }

            .whl-label-picker {
                background: linear-gradient(180deg, #1e1e32 0%, #1a1a2e 100%);
                border-radius: 16px;
                padding: 0;
                min-width: 300px;
                max-width: 360px;
                max-height: 450px;
                overflow: hidden;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                border: 1px solid rgba(255, 255, 255, 0.1);
            }

            .whl-label-picker-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 20px;
                background: linear-gradient(135deg, #8b5cf6, #6366f1);
            }

            .whl-label-picker-title {
                font-size: 16px;
                font-weight: 700;
                color: white;
            }

            .whl-label-picker-close {
                background: rgba(255, 255, 255, 0.2);
                border: none;
                width: 28px;
                height: 28px;
                border-radius: 50%;
                font-size: 16px;
                color: white;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
            }

            .whl-label-picker-close:hover {
                background: rgba(255, 255, 255, 0.3);
                transform: scale(1.1);
            }

            .whl-label-picker-contact {
                padding: 12px 20px;
                background: rgba(0, 0, 0, 0.2);
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            }

            .whl-label-picker-contact-name {
                font-weight: 600;
                color: white;
                font-size: 14px;
            }

            .whl-label-picker-contact-phone {
                font-size: 12px;
                color: rgba(255, 255, 255, 0.5);
                margin-top: 2px;
            }

            .whl-label-options {
                padding: 12px;
                max-height: 280px;
                overflow-y: auto;
            }

            .whl-label-option {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px 12px;
                border-radius: 10px;
                cursor: pointer;
                transition: all 0.2s;
                margin-bottom: 6px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid transparent;
            }

            .whl-label-option:hover {
                background: rgba(255, 255, 255, 0.08);
            }

            .whl-label-option.selected {
                background: rgba(139, 92, 246, 0.15);
                border-color: rgba(139, 92, 246, 0.3);
            }

            .whl-label-option-dot {
                width: 22px;
                height: 22px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                flex-shrink: 0;
            }

            .whl-label-option-name {
                flex: 1;
                color: white;
                font-weight: 500;
                font-size: 14px;
            }

            .whl-label-option-check {
                color: #10b981;
                font-size: 18px;
                font-weight: bold;
            }

            /* Toast */
            .whl-toast {
                position: fixed;
                bottom: 80px;
                left: 50%;
                transform: translateX(-50%);
                padding: 12px 24px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                z-index: 10001;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
                animation: slideUp 0.3s ease;
            }

            @keyframes slideUp {
                from { opacity: 0; transform: translateX(-50%) translateY(20px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }

    // ==================== UI ====================

    function showToast(message, type = 'info') {
        const existing = document.querySelector('.whl-toast');
        if (existing) existing.remove();

        const colors = {
            success: '#10b981',
            error: '#ef4444',
            warning: '#f59e0b',
            info: '#3b82f6'
        };

        const toast = document.createElement('div');
        toast.className = 'whl-toast';
        toast.style.background = colors[type] || colors.info;
        toast.style.color = 'white';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    }

    function showLabelPicker(phone, contactName) {
        // Remover picker existente
        const existing = document.querySelector('.whl-label-picker-overlay');
        if (existing) existing.remove();

        const contactLabels = getContactLabels(phone);
        const contactLabelIds = contactLabels.map(l => l.id);

        const overlay = document.createElement('div');
        overlay.className = 'whl-label-picker-overlay';
        overlay.innerHTML = `
            <div class="whl-label-picker">
                <div class="whl-label-picker-header">
                    <span class="whl-label-picker-title">🏷️ Etiquetas</span>
                    <button class="whl-label-picker-close">×</button>
                </div>

                <div class="whl-label-picker-contact">
                    <div class="whl-label-picker-contact-name">${escapeHtml(contactName || 'Contato')}</div>
                    <div class="whl-label-picker-contact-phone">${formatPhone(phone)}</div>
                </div>

                <div class="whl-label-options">
                    ${state.labels.length > 0 ? state.labels.map(label => `
                        <div class="whl-label-option ${contactLabelIds.includes(label.id) ? 'selected' : ''}" data-label-id="${label.id}">
                            <div class="whl-label-option-dot" style="background:${label.color}">${label.icon || '🏷️'}</div>
                            <span class="whl-label-option-name">${escapeHtml(label.name)}</span>
                            <span class="whl-label-option-check">${contactLabelIds.includes(label.id) ? '✓' : ''}</span>
                        </div>
                    `).join('') : `
                        <div style="text-align:center;color:rgba(255,255,255,0.5);padding:30px;">
                            <div style="font-size:40px;margin-bottom:10px;">🏷️</div>
                            <div>Nenhuma etiqueta criada.</div>
                            <div style="font-size:12px;margin-top:8px;">Crie etiquetas no painel do CRM.</div>
                        </div>
                    `}
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Fechar ao clicar fora
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                refreshAllBadges();
            }
        });

        // Botão fechar
        overlay.querySelector('.whl-label-picker-close').addEventListener('click', () => {
            overlay.remove();
            refreshAllBadges();
        });

        // Toggle etiquetas
        overlay.querySelectorAll('.whl-label-option').forEach(opt => {
            opt.addEventListener('click', async () => {
                const labelId = opt.dataset.labelId;
                const wasAdded = await toggleLabel(phone, labelId);

                // Atualizar visual
                opt.classList.toggle('selected', wasAdded);
                const checkSpan = opt.querySelector('.whl-label-option-check');
                checkSpan.textContent = wasAdded ? '✓' : '';

                showToast(wasAdded ? '✓ Etiqueta adicionada' : '✗ Etiqueta removida', 'success');
            });
        });
    }

    function escapeHtml(str) {
        const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
        if (typeof fn === 'function' && fn !== escapeHtml) return fn(str);
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function formatPhone(phone) {
        const clean = String(phone).replace(/\D/g, '');
        if (clean.length === 13) {
            return `+${clean.slice(0, 2)} (${clean.slice(2, 4)}) ${clean.slice(4, 9)}-${clean.slice(9)}`;
        } else if (clean.length === 12) {
            return `+${clean.slice(0, 2)} (${clean.slice(2, 4)}) ${clean.slice(4, 8)}-${clean.slice(8)}`;
        }
        return phone;
    }

    // ==================== INJEÇÃO ====================

    function extractPhoneFromChat(chatItem) {
        // Tentar várias fontes para extrair o telefone
        
        // 1. Data attribute
        const dataId = chatItem.getAttribute('data-id') || '';
        let match = dataId.match(/(\d{10,15})@/);
        if (match) return match[1];

        // 2. Título do contato
        const titleEl = chatItem.querySelector('[data-testid="cell-frame-title"]') ||
                       chatItem.querySelector('span[title]') ||
                       chatItem.querySelector('._ao3e');
        if (titleEl) {
            const title = titleEl.getAttribute('title') || titleEl.textContent || '';
            match = title.match(/\+?(\d{10,15})/);
            if (match) return match[1];
        }

        // 3. Qualquer número no innerHTML
        const html = chatItem.innerHTML;
        match = html.match(/(\d{12,15})@c\.us/);
        if (match) return match[1];

        return null;
    }

    function extractNameFromChat(chatItem) {
        const titleEl = chatItem.querySelector('[data-testid="cell-frame-title"]') ||
                       chatItem.querySelector('span[title]') ||
                       chatItem.querySelector('._ao3e');
        return titleEl?.getAttribute('title') || titleEl?.textContent || 'Contato';
    }

    function injectLabelButton(chatItem) {
        // Já tem botão?
        if (chatItem.querySelector('.whl-label-btn')) return;

        const phone = extractPhoneFromChat(chatItem);
        if (!phone) return;

        const name = extractNameFromChat(chatItem);

        // Garantir position relative
        chatItem.style.position = 'relative';

        // Criar botão
        const btn = document.createElement('button');
        btn.className = 'whl-label-btn';
        btn.innerHTML = '🏷️';
        btn.title = 'Gerenciar etiquetas';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            showLabelPicker(phone, name);
        });

        chatItem.appendChild(btn);

        // Injetar badges
        injectLabelBadges(chatItem, phone);
    }

    function injectLabelBadges(chatItem, phone) {
        // Remover badges existentes
        const existingBadges = chatItem.querySelector('.whl-chat-labels');
        if (existingBadges) existingBadges.remove();

        const contactLabels = getContactLabels(phone);
        if (contactLabels.length === 0) return;

        // Encontrar onde colocar os badges (abaixo do nome/última mensagem)
        const messageArea = chatItem.querySelector('[data-testid="cell-frame-secondary"]') ||
                           chatItem.querySelector('._ao3e')?.parentElement?.parentElement ||
                           chatItem.querySelector('span[title]')?.parentElement;

        if (!messageArea) return;

        const badgesContainer = document.createElement('div');
        badgesContainer.className = 'whl-chat-labels';
        
        // Mostrar até 3 etiquetas
        const visibleLabels = contactLabels.slice(0, 3);
        const extraCount = contactLabels.length - 3;

        badgesContainer.innerHTML = visibleLabels.map(label => `
            <span class="whl-chat-label-badge" style="background:${label.color}25;color:${label.color}">
                ${label.icon || '🏷️'} ${label.name}
            </span>
        `).join('') + (extraCount > 0 ? `
            <span class="whl-chat-label-badge" style="background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.6)">
                +${extraCount}
            </span>
        ` : '');

        messageArea.appendChild(badgesContainer);
    }

    function refreshAllBadges() {
        // Remover todos os botões e badges para reinjetar
        document.querySelectorAll('.whl-label-btn, .whl-chat-labels').forEach(el => el.remove());
        injectAll();
    }

    function injectAll() {
        // Selectors para itens da lista de chats
        const selectors = [
            '[data-testid="cell-frame-container"]',
            '[data-testid="list-item-container"]',
            '._ak8l',
            '.x10l6tqk'
        ];

        let chatItems = [];
        for (const selector of selectors) {
            chatItems = document.querySelectorAll(selector);
            if (chatItems.length > 0) break;
        }

        chatItems.forEach(item => injectLabelButton(item));
    }

    // ==================== OBSERVER ====================

    function setupObserver() {
        const chatList = document.querySelector('[data-testid="chat-list"]') ||
                        document.querySelector('#pane-side') ||
                        document.querySelector('[aria-label*="Lista"]');

        if (!chatList) {
            setTimeout(setupObserver, 1000);
            return;
        }

        const observer = new MutationObserver((mutations) => {
            // Verificar se há novos itens
            let shouldRefresh = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    shouldRefresh = true;
                    break;
                }
            }
            if (shouldRefresh) {
                setTimeout(injectAll, 100);
            }
        });

        observer.observe(chatList, {
            childList: true,
            subtree: true
        });

        // Injeção inicial
        injectAll();

        // Verificação periódica
        if (injectInterval) clearInterval(injectInterval);
        injectInterval = setInterval(injectAll, 5000);

        console.log('[LabelBtn] Observer configurado');

        // Cleanup ao descarregar
        window.addEventListener('beforeunload', () => {
            try {
                observer.disconnect();
            } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
            if (injectInterval) {
                clearInterval(injectInterval);
                injectInterval = null;
            }
        });
    }

    // ==================== INIT ====================

    async function init() {
        console.log('[LabelBtn] Inicializando...');

        await loadState();
        injectStyles();

        // Aguardar WhatsApp carregar
        const waitForWA = () => {
            const chatList = document.querySelector('[data-testid="chat-list"]') ||
                            document.querySelector('#pane-side');
            if (chatList) {
                setupObserver();
            } else {
                setTimeout(waitForWA, 500);
            }
        };
        waitForWA();

        // Escutar mudanças no storage (sincronização com LabelsModule)
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes[STORAGE_KEY]) {
                const newValue = changes[STORAGE_KEY].newValue;
                if (newValue) {
                    state.labels = newValue.labels || [];
                    state.contactLabels = newValue.contactLabels || {};
                    state.settings = newValue.settings || {};
                    console.log('[LabelBtn] Storage atualizado - refreshing badges');
                    refreshAllBadges();
                }
            }
        });

        console.log('[LabelBtn] ✅ Inicializado');
    }

    // ==================== EXPORT ====================

    window.__WHL_LABEL_BUTTON_INJECTOR__ = true;

    window.LabelButtonInjector = {
        init,
        refresh: refreshAllBadges,
        showPicker: showLabelPicker,
        getState: () => state
    };

    // Auto-inicializar
    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }
})();
