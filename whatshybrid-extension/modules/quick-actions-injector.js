/**
 * ⚡ Quick Actions Injector - Botões de ação rápida no WhatsApp Web
 * WhatsHybrid v49 - Baseado no Quantum CRM
 * 
 * Funcionalidades:
 * - 🏷️ Adicionar rótulos
 * - 📊 Mover estágios do CRM
 * - 👤 Atribuir a agentes
 * - ⏰ Follow-ups programados
 * - 📝 Adicionar notas
 * - Menu de ações expandido
 */

(function() {
    'use strict';

    // Evitar múltiplas instâncias
    if (window.__WHL_QUICK_ACTIONS_INJECTOR__) {
        console.log('[QuickActions] Já carregado');
        return;
    }

    let recheckInterval = null;

    // ============================================
    // CONFIGURAÇÃO DE AÇÕES
    // ============================================

    const QUICK_ACTIONS = {
        addLabel: {
            id: 'add-label',
            icon: '🏷️',
            label: 'Rótulo',
            dynamic: true,
            loadItems: loadLabels
        },
        moveStage: {
            id: 'move-stage',
            icon: '📊',
            label: 'Estágio',
            dynamic: true,
            loadItems: loadCRMStages
        },
        setFollowUp: {
            id: 'followup',
            icon: '⏰',
            label: 'Follow-up',
            submenu: [
                { id: 'followup-1h', label: 'Em 1 hora', delay: 3600000 },
                { id: 'followup-3h', label: 'Em 3 horas', delay: 10800000 },
                { id: 'followup-tomorrow', label: 'Amanhã', delay: 86400000 },
                { id: 'followup-week', label: 'Em 1 semana', delay: 604800000 },
                { id: 'followup-custom', label: '⚙️ Personalizado...', custom: true }
            ]
        },
        addNote: {
            id: 'add-note',
            icon: '📝',
            label: 'Nota',
            action: showNoteModal
        },
        addTask: {
            id: 'add-task',
            icon: '✅',
            label: 'Tarefa',
            action: showTaskModal
        },
        more: {
            id: 'more',
            icon: '⋯',
            label: 'Mais',
            submenu: [
                { id: 'export-chat', icon: '📥', label: 'Exportar conversa' },
                { id: 'view-profile', icon: '👁️', label: 'Ver perfil CRM' },
                { id: 'sync-crm', icon: '🔄', label: 'Sincronizar CRM' },
                { id: 'open-panel', icon: '🧩', label: 'Abrir painel' }
            ]
        }
    };

    const CONFIG = {
        RECHECK_INTERVAL: 2000,
        DEBOUNCE_DELAY: 300
    };

    // ============================================
    // ESTADO
    // ============================================

    let currentChatId = null;
    let injected = false;
    let observer = null;
    let labels = [];
    let stages = [];
    let initialized = false;

    // ============================================
    // LOADERS DINÂMICOS
    // ============================================

    async function loadLabels() {
        try {
            const result = await chrome.storage.local.get('whl_labels');
            const storedLabels = result.whl_labels || [];
            
            // Labels padrão se não houver
            if (storedLabels.length === 0) {
                return [
                    { id: 'cliente', label: '🟢 Cliente', color: '#10B981' },
                    { id: 'lead', label: '🔵 Lead', color: '#3B82F6' },
                    { id: 'vip', label: '⭐ VIP', color: '#F59E0B' },
                    { id: 'pendente', label: '🟡 Pendente', color: '#EAB308' },
                    { id: 'urgente', label: '🔴 Urgente', color: '#EF4444' }
                ];
            }
            
            return storedLabels;
        } catch (error) {
            console.error('[QuickActions] Erro ao carregar labels:', error);
            return [];
        }
    }

    async function loadCRMStages() {
        try {
            const result = await chrome.storage.local.get('whl_crm_stages');
            const storedStages = result.whl_crm_stages || [];
            
            if (storedStages.length === 0) {
                return [
                    { id: 'new', label: '🆕 Novo', color: '#6B7280' },
                    { id: 'lead', label: '🎯 Lead', color: '#3B82F6' },
                    { id: 'contact', label: '📞 Contato', color: '#8B5CF6' },
                    { id: 'negotiation', label: '💼 Negociação', color: '#F59E0B' },
                    { id: 'proposal', label: '📋 Proposta', color: '#EC4899' },
                    { id: 'won', label: '✅ Ganho', color: '#10B981' },
                    { id: 'lost', label: '❌ Perdido', color: '#EF4444' }
                ];
            }
            
            return storedStages.map(s => ({
                id: s.id,
                label: `${s.icon || ''} ${s.name}`.trim(),
                color: s.color
            }));
        } catch (error) {
            console.error('[QuickActions] Erro ao carregar stages:', error);
            return [];
        }
    }

    // ============================================
    // AÇÕES
    // ============================================

    function showNoteModal() {
        if (!currentChatId) {
            showToast('Abra uma conversa primeiro', 'warning');
            return;
        }

        const note = prompt('📝 Digite a nota para este contato:');
        if (note && note.trim()) {
            saveNote(currentChatId, note.trim());
            showToast('Nota salva!', 'success');
        }
    }

    async function saveNote(chatId, text) {
        try {
            const result = await chrome.storage.local.get('whl_crm_contacts_v2');
            const contacts = result.whl_crm_contacts_v2 || {};
            
            if (!contacts[chatId]) {
                contacts[chatId] = { id: chatId, createdAt: new Date().toISOString() };
            }
            
            if (!contacts[chatId].notes) {
                contacts[chatId].notes = [];
            }
            
            contacts[chatId].notes.push({
                id: `note_${Date.now()}`,
                text,
                createdAt: new Date().toISOString()
            });
            
            await chrome.storage.local.set({ whl_crm_contacts_v2: contacts });
            
            // Emitir evento
            if (window.EventBus) {
                window.EventBus.emit('crm:note_added', { chatId, text });
            }
        } catch (error) {
            console.error('[QuickActions] Erro ao salvar nota:', error);
        }
    }

    function showTaskModal() {
        if (!currentChatId) {
            showToast('Abra uma conversa primeiro', 'warning');
            return;
        }

        const title = prompt('✅ Título da tarefa:');
        if (title && title.trim()) {
            createTask(currentChatId, title.trim());
            showToast('Tarefa criada!', 'success');
        }
    }

    async function createTask(chatId, title) {
        try {
            const result = await chrome.storage.local.get('whl_tasks_v2');
            const tasks = result.whl_tasks_v2 || {};
            
            const taskId = `task_${Date.now()}`;
            tasks[taskId] = {
                id: taskId,
                title,
                contactId: chatId,
                type: 'follow_up',
                priority: 'medium',
                completed: false,
                createdAt: new Date().toISOString()
            };
            
            await chrome.storage.local.set({ whl_tasks_v2: tasks });
            
            if (window.EventBus) {
                window.EventBus.emit('tasks:task_created', tasks[taskId]);
            }
        } catch (error) {
            console.error('[QuickActions] Erro ao criar tarefa:', error);
        }
    }

    async function setFollowUp(chatId, delay) {
        const dueDate = new Date(Date.now() + delay);
        
        try {
            const result = await chrome.storage.local.get('whl_tasks_v2');
            const tasks = result.whl_tasks_v2 || {};
            
            const taskId = `task_${Date.now()}`;
            tasks[taskId] = {
                id: taskId,
                title: `Follow-up programado`,
                contactId: chatId,
                type: 'follow_up',
                priority: 'medium',
                dueDate: dueDate.toISOString(),
                completed: false,
                createdAt: new Date().toISOString()
            };
            
            await chrome.storage.local.set({ whl_tasks_v2: tasks });
            showToast(`Follow-up agendado para ${dueDate.toLocaleString('pt-BR')}`, 'success');
            
            if (window.EventBus) {
                window.EventBus.emit('tasks:task_created', tasks[taskId]);
            }
        } catch (error) {
            console.error('[QuickActions] Erro ao criar follow-up:', error);
        }
    }

    async function setLabel(chatId, labelId) {
        try {
            const result = await chrome.storage.local.get('whl_crm_contacts_v2');
            const contacts = result.whl_crm_contacts_v2 || {};
            
            if (!contacts[chatId]) {
                contacts[chatId] = { id: chatId, createdAt: new Date().toISOString() };
            }
            
            if (!contacts[chatId].labels) {
                contacts[chatId].labels = [];
            }
            
            if (!contacts[chatId].labels.includes(labelId)) {
                contacts[chatId].labels.push(labelId);
            }
            
            await chrome.storage.local.set({ whl_crm_contacts_v2: contacts });
            showToast('Rótulo adicionado!', 'success');
            
            if (window.EventBus) {
                window.EventBus.emit('crm:label_added', { chatId, labelId });
            }
        } catch (error) {
            console.error('[QuickActions] Erro ao adicionar label:', error);
        }
    }

    async function setStage(chatId, stageId) {
        try {
            const result = await chrome.storage.local.get('whl_crm_contacts_v2');
            const contacts = result.whl_crm_contacts_v2 || {};
            
            if (!contacts[chatId]) {
                contacts[chatId] = { id: chatId, createdAt: new Date().toISOString() };
            }
            
            const oldStage = contacts[chatId].stage;
            contacts[chatId].stage = stageId;
            contacts[chatId].updatedAt = new Date().toISOString();
            
            await chrome.storage.local.set({ whl_crm_contacts_v2: contacts });
            showToast('Estágio atualizado!', 'success');
            
            if (window.EventBus) {
                window.EventBus.emit('crm:stage_changed', { chatId, oldStage, newStage: stageId });
            }
        } catch (error) {
            console.error('[QuickActions] Erro ao alterar estágio:', error);
        }
    }

    function handleMoreAction(actionId) {
        switch (actionId) {
            case 'export-chat':
                showToast('Exportação iniciada...', 'info');
                // Implementar exportação
                break;
            case 'view-profile':
                if (window.EventBus) {
                    window.EventBus.emit('navigate', { view: 'crm', chatId: currentChatId });
                }
                break;
            case 'sync-crm':
                showToast('Sincronizando CRM...', 'info');
                if (window.CRMBadgeInjector) {
                    window.CRMBadgeInjector.refresh();
                }
                break;
            case 'open-panel':
                chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
                break;
        }
    }

    // ============================================
    // TOAST
    // ============================================

    function showToast(message, type = 'info') {
        if (window.NotificationsModule) {
            window.NotificationsModule.toast(message, type);
        } else {
            console.log(`[QuickActions] ${type}: ${message}`);
        }
    }

    // ============================================
    // ESTILOS CSS
    // ============================================

    function injectStyles() {
        if (document.getElementById('whl-quick-actions-style')) return;

        const style = document.createElement('style');
        style.id = 'whl-quick-actions-style';
        style.textContent = `
            /* Container principal */
            .whl-quick-actions {
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 4px 8px;
                background: rgba(0, 0, 0, 0.05);
                border-radius: 8px;
                margin-left: 8px;
            }

            /* Botão de ação */
            .whl-qa-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 32px;
                height: 32px;
                border: none;
                background: transparent;
                border-radius: 6px;
                cursor: pointer;
                font-size: 16px;
                transition: all 0.2s ease;
                position: relative;
            }

            .whl-qa-btn:hover {
                background: rgba(139, 92, 246, 0.15);
                transform: scale(1.1);
            }

            .whl-qa-btn:active {
                transform: scale(0.95);
            }

            /* Tooltip */
            .whl-qa-btn[data-tooltip]:hover::after {
                content: attr(data-tooltip);
                position: absolute;
                bottom: -28px;
                left: 50%;
                transform: translateX(-50%);
                padding: 4px 8px;
                background: #1f2937;
                color: white;
                font-size: 11px;
                border-radius: 4px;
                white-space: nowrap;
                z-index: 1000;
            }

            /* Submenu dropdown */
            .whl-qa-submenu {
                position: absolute;
                top: 100%;
                left: 0;
                min-width: 180px;
                background: white;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                z-index: 1000;
                display: none;
                overflow: hidden;
            }

            .whl-qa-btn:hover .whl-qa-submenu,
            .whl-qa-submenu:hover {
                display: block;
            }

            .whl-qa-submenu-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 12px;
                cursor: pointer;
                transition: background 0.15s;
                font-size: 13px;
                color: #374151;
            }

            .whl-qa-submenu-item:hover {
                background: rgba(139, 92, 246, 0.1);
            }

            .whl-qa-submenu-item-icon {
                width: 20px;
                text-align: center;
            }

            .whl-qa-submenu-item-color {
                width: 12px;
                height: 12px;
                border-radius: 50%;
                flex-shrink: 0;
            }

            /* Separador */
            .whl-qa-separator {
                height: 1px;
                background: #e5e7eb;
                margin: 4px 0;
            }

            /* Dark mode */
            @media (prefers-color-scheme: dark) {
                .whl-quick-actions {
                    background: rgba(255, 255, 255, 0.05);
                }

                .whl-qa-submenu {
                    background: #1f2937;
                }

                .whl-qa-submenu-item {
                    color: #e5e7eb;
                }

                .whl-qa-submenu-item:hover {
                    background: rgba(139, 92, 246, 0.2);
                }
            }
        `;

        document.head.appendChild(style);
    }

    // ============================================
    // CRIAÇÃO DOS BOTÕES
    // ============================================

    function createActionButton(action) {
        const btn = document.createElement('button');
        btn.className = 'whl-qa-btn';
        btn.setAttribute('data-action', action.id);
        btn.setAttribute('data-tooltip', action.label);
        btn.textContent = action.icon;

        // Se tem submenu estático
        if (action.submenu) {
            const submenu = createSubmenu(action.submenu, action.id);
            btn.appendChild(submenu);
        }

        // Se é dinâmico (carrega itens)
        if (action.dynamic && action.loadItems) {
            btn.addEventListener('mouseenter', async () => {
                const existingSubmenu = btn.querySelector('.whl-qa-submenu');
                if (existingSubmenu) existingSubmenu.remove();

                const items = await action.loadItems();
                const submenu = createSubmenu(items, action.id);
                btn.appendChild(submenu);
            });
        }

        // Se tem ação direta
        if (action.action) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                action.action();
            });
        }

        return btn;
    }

    function createSubmenu(items, parentId) {
        const submenu = document.createElement('div');
        submenu.className = 'whl-qa-submenu';

        items.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.className = 'whl-qa-submenu-item';
            menuItem.setAttribute('data-item-id', item.id);

            // Ícone ou cor
            if (item.icon) {
                const icon = document.createElement('span');
                icon.className = 'whl-qa-submenu-item-icon';
                icon.textContent = item.icon;
                menuItem.appendChild(icon);
            } else if (item.color) {
                const colorDot = document.createElement('span');
                colorDot.className = 'whl-qa-submenu-item-color';
                colorDot.style.background = item.color;
                menuItem.appendChild(colorDot);
            }

            // Label
            const label = document.createElement('span');
            label.textContent = item.label;
            menuItem.appendChild(label);

            // Click handler
            menuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                handleSubmenuClick(parentId, item);
            });

            submenu.appendChild(menuItem);
        });

        return submenu;
    }

    function handleSubmenuClick(parentId, item) {
        if (!currentChatId) {
            showToast('Abra uma conversa primeiro', 'warning');
            return;
        }

        switch (parentId) {
            case 'add-label':
                setLabel(currentChatId, item.id);
                break;

            case 'move-stage':
                setStage(currentChatId, item.id);
                break;

            case 'followup':
                if (item.custom) {
                    const hours = prompt('Quantas horas para o follow-up?', '24');
                    if (hours) {
                        setFollowUp(currentChatId, parseInt(hours) * 3600000);
                    }
                } else {
                    setFollowUp(currentChatId, item.delay);
                }
                break;

            case 'more':
                handleMoreAction(item.id);
                break;
        }
    }

    // ============================================
    // INJEÇÃO NO WHATSAPP
    // ============================================

    function createQuickActionsBar() {
        const container = document.createElement('div');
        container.className = 'whl-quick-actions';
        container.id = 'whl-quick-actions-bar';

        // Criar botões para cada ação
        Object.values(QUICK_ACTIONS).forEach(action => {
            const btn = createActionButton(action);
            container.appendChild(btn);
        });

        return container;
    }

    function injectQuickActions() {
        // Remover barra existente
        const existing = document.getElementById('whl-quick-actions-bar');
        if (existing) existing.remove();

        // Encontrar header do chat
        const headerSelectors = [
            '[data-testid="conversation-header"]',
            'header._amid',
            '[data-testid="chat-header"]',
            'header'
        ];

        let header = null;
        for (const selector of headerSelectors) {
            header = document.querySelector(selector);
            if (header) break;
        }

        if (!header) {
            return false;
        }

        // Encontrar área de ações do header
        const actionsArea = header.querySelector('[data-testid="conversation-menu"]')?.parentElement ||
                           header.querySelector('._amig') ||
                           header;

        if (actionsArea) {
            const bar = createQuickActionsBar();
            actionsArea.insertBefore(bar, actionsArea.firstChild);
            injected = true;
            return true;
        }

        return false;
    }

    function updateCurrentChat() {
        // Tentar extrair o chat ID atual
        const headerTitle = document.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
                           document.querySelector('header span[title]');
        
        if (headerTitle) {
            const title = headerTitle.getAttribute('title') || headerTitle.textContent;
            const phoneMatch = title?.match(/^\+?(\d{10,15})/);
            if (phoneMatch) {
                currentChatId = phoneMatch[1] + '@c.us';
            }
        }

        // Tentar de outras fontes
        if (!currentChatId) {
            const url = window.location.href;
            const chatMatch = url.match(/(\d+)@[cg]\.us/);
            if (chatMatch) {
                currentChatId = chatMatch[0];
            }
        }
    }

    // ============================================
    // OBSERVER
    // ============================================

    function setupObserver() {
        const mainContainer = document.querySelector('#main') ||
                             document.querySelector('[data-testid="conversation-panel-wrapper"]') ||
                             document.body;

        observer = new MutationObserver((mutations) => {
            // Verificar se o chat mudou
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    // Chat pode ter mudado
                    updateCurrentChat();
                    
                    // Re-injetar se necessário
                    if (!document.getElementById('whl-quick-actions-bar')) {
                        setTimeout(injectQuickActions, 100);
                    }
                }
            }
        });

        observer.observe(mainContainer, {
            childList: true,
            subtree: true
        });
    }

    // ============================================
    // INICIALIZAÇÃO
    // ============================================

    async function init() {
        if (initialized) return;

        console.log('[QuickActions] Inicializando...');

        injectStyles();

        // Aguardar WhatsApp carregar
        waitForWhatsApp();

        initialized = true;
    }

    function waitForWhatsApp() {
        const main = document.querySelector('#main') ||
                    document.querySelector('[data-testid="conversation-panel-wrapper"]');

        if (main) {
            setupObserver();
            updateCurrentChat();
            injectQuickActions();

            // Verificação periódica
            if (recheckInterval) clearInterval(recheckInterval);
            recheckInterval = setInterval(() => {
                if (!document.getElementById('whl-quick-actions-bar')) {
                    injectQuickActions();
                }
                updateCurrentChat();
            }, CONFIG.RECHECK_INTERVAL);
        } else {
            setTimeout(waitForWhatsApp, 500);
        }
    }

    function destroy() {
        if (observer) {
            observer.disconnect();
        }
        
        if (recheckInterval) {
            clearInterval(recheckInterval);
            recheckInterval = null;
        }
        
        const bar = document.getElementById('whl-quick-actions-bar');
        if (bar) bar.remove();
        
        const styles = document.getElementById('whl-quick-actions-style');
        if (styles) styles.remove();
        
        initialized = false;
    }

    // Cleanup ao descarregar
    window.addEventListener('beforeunload', destroy);

    // ============================================
    // EXPORT
    // ============================================

    window.__WHL_QUICK_ACTIONS_INJECTOR__ = true;

    window.QuickActionsInjector = {
        init,
        destroy,
        refresh: injectQuickActions,
        getCurrentChatId: () => currentChatId
    };

    // Auto-inicializar
    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

    console.log('[QuickActionsInjector] Módulo carregado');
})();
