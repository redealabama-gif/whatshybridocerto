/**
 * 📋 Task Markers Injector - Marcadores de tarefas na lista de chats
 * WhatsHybrid v49 - Baseado no Quantum CRM
 * 
 * Funcionalidades:
 * - Mostra quantidade de tarefas pendentes por conversa
 * - Prioridade com cores (urgent, high, medium, low)
 * - Modo compacto
 * - Atualização automática
 */

(function() {
    'use strict';

    // Evitar múltiplas instâncias
    if (window.__WHL_TASK_MARKERS_INJECTOR__) {
        console.log('[TaskMarkers] Já carregado');
        return;
    }

    let recheckInterval = null;

    // ============================================
    // CONFIGURAÇÃO
    // ============================================

    const PRIORITY_COLORS = {
        urgent: { bg: 'rgba(239, 68, 68, 0.16)', color: '#B91C1C', label: 'URGENTE' },
        high: { bg: 'rgba(249, 115, 22, 0.16)', color: '#C2410C', label: 'ALTA' },
        medium: { bg: 'rgba(245, 158, 11, 0.16)', color: '#92400E', label: 'MÉDIA' },
        low: { bg: 'rgba(16, 185, 129, 0.16)', color: '#047857', label: 'BAIXA' },
        normal: { bg: 'rgba(59, 130, 246, 0.15)', color: '#1D4ED8', label: 'NORMAL' }
    };

    const CONFIG = {
        RECHECK_INTERVAL: 3000,
        DEBOUNCE_DELAY: 150
    };

    // ============================================
    // ESTADO
    // ============================================

    let tasks = {};
    let settings = {
        enabled: true,
        showOnlyPending: true,
        showCount: true,
        showPriority: true,
        compactMode: true
    };

    let observer = null;
    let updateTimeout = null;
    let initialized = false;

    // ============================================
    // STORAGE
    // ============================================

    async function loadData() {
        try {
            const result = await chrome.storage.local.get([
                'whl_tasks_v2',
                'whl_task_marker_settings'
            ]);

            if (result.whl_tasks_v2) {
                tasks = result.whl_tasks_v2;
            }
            if (result.whl_task_marker_settings) {
                settings = { ...settings, ...result.whl_task_marker_settings };
            }
        } catch (error) {
            console.error('[TaskMarkers] Erro ao carregar dados:', error);
        }
    }

    async function saveSettings() {
        try {
            await chrome.storage.local.set({ whl_task_marker_settings: settings });
        } catch (error) {
            console.error('[TaskMarkers] Erro ao salvar settings:', error);
        }
    }

    // ============================================
    // ESTILOS CSS
    // ============================================

    function injectStyles() {
        if (document.getElementById('whl-task-markers-style')) return;

        const style = document.createElement('style');
        style.id = 'whl-task-markers-style';
        style.textContent = `
            .whl-task-marker {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 6px;
                border-radius: 999px;
                font-size: 10px;
                line-height: 1;
                background: rgba(59, 130, 246, 0.15);
                color: #1D4ED8;
                margin-left: 4px;
                cursor: default;
                user-select: none;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                transition: all 0.2s ease;
            }

            .whl-task-marker[data-priority="urgent"] {
                background: ${PRIORITY_COLORS.urgent.bg};
                color: ${PRIORITY_COLORS.urgent.color};
                font-weight: 600;
                animation: whlTaskPulse 2s infinite;
            }

            .whl-task-marker[data-priority="high"] {
                background: ${PRIORITY_COLORS.high.bg};
                color: ${PRIORITY_COLORS.high.color};
            }

            .whl-task-marker[data-priority="medium"] {
                background: ${PRIORITY_COLORS.medium.bg};
                color: ${PRIORITY_COLORS.medium.color};
            }

            .whl-task-marker[data-priority="low"] {
                background: ${PRIORITY_COLORS.low.bg};
                color: ${PRIORITY_COLORS.low.color};
            }

            .whl-task-marker-dot {
                width: 6px;
                height: 6px;
                border-radius: 999px;
                background: currentColor;
            }

            .whl-task-marker-count {
                font-weight: 600;
            }

            .whl-task-marker-priority {
                text-transform: uppercase;
                letter-spacing: 0.03em;
                font-size: 8px;
            }

            .whl-task-marker.compact {
                padding: 2px 5px;
                font-size: 9px;
            }

            .whl-task-marker.compact .whl-task-marker-priority {
                display: none;
            }

            /* Hover */
            [data-whl-chat-id]:hover .whl-task-marker {
                transform: scale(1.05);
            }

            /* Animação de pulso para urgentes */
            @keyframes whlTaskPulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }

            /* Tooltip */
            .whl-task-marker[data-tooltip] {
                position: relative;
            }

            .whl-task-marker[data-tooltip]:hover::after {
                content: attr(data-tooltip);
                position: absolute;
                bottom: 100%;
                left: 50%;
                transform: translateX(-50%);
                padding: 4px 8px;
                background: #1f2937;
                color: white;
                font-size: 11px;
                border-radius: 4px;
                white-space: nowrap;
                z-index: 1000;
                margin-bottom: 4px;
            }
        `;

        document.head.appendChild(style);
    }

    // ============================================
    // SELETORES DO WHATSAPP
    // ============================================

    const CHAT_SELECTORS = [
        '[data-testid="cell-frame-container"]',
        '[data-testid="list-item"]',
        '._8nE1Y',
        '.X7YrQ',
        '[role="listitem"]'
    ];

    function getChatItems() {
        for (const selector of CHAT_SELECTORS) {
            const items = document.querySelectorAll(selector);
            if (items.length > 0) {
                return Array.from(items);
            }
        }
        return [];
    }

    function extractChatId(element) {
        const existing = element.getAttribute('data-whl-chat-id');
        if (existing) return existing;

        const link = element.querySelector('a[href*="@"]');
        if (link) {
            const href = link.getAttribute('href');
            const match = href?.match(/(\d+@[cg]\.us)/);
            if (match) return match[1];
        }

        const dataId = element.getAttribute('data-id') || 
                       element.querySelector('[data-id]')?.getAttribute('data-id');
        if (dataId) {
            const match = dataId.match(/(\d+@[cg]\.us)/);
            if (match) return match[1];
        }

        const titleEl = element.querySelector('[title]');
        const title = titleEl?.getAttribute('title');
        if (title) {
            const phoneMatch = title.match(/^\+?(\d{10,15})/);
            if (phoneMatch) {
                return phoneMatch[1] + '@c.us';
            }
        }

        return null;
    }

    // ============================================
    // LÓGICA DE TAREFAS
    // ============================================

    function getTasksForChat(chatId) {
        if (!chatId) return [];

        // Normalizar chatId para comparação
        const phone = chatId.replace('@c.us', '').replace('@g.us', '');

        return Object.values(tasks).filter(task => {
            if (!task) return false;

            // Filtrar por status se configurado
            if (settings.showOnlyPending && task.completed) return false;

            // Verificar se a tarefa está associada ao chat
            const taskPhone = (task.contactId || task.phone || '').replace('@c.us', '').replace('@g.us', '');
            return taskPhone === phone || task.contactId === chatId;
        });
    }

    function getHighestPriority(chatTasks) {
        const priorities = ['urgent', 'high', 'medium', 'low', 'normal'];
        
        for (const priority of priorities) {
            if (chatTasks.some(t => t.priority === priority)) {
                return priority;
            }
        }
        
        return 'normal';
    }

    function getOverdueTasks(chatTasks) {
        const now = Date.now();
        return chatTasks.filter(t => {
            if (!t.dueDate) return false;
            const due = new Date(t.dueDate).getTime();
            return due < now && !t.completed;
        });
    }

    // ============================================
    // MARKERS
    // ============================================

    function createMarker(chatTasks) {
        const count = chatTasks.length;
        const priority = getHighestPriority(chatTasks);
        const overdue = getOverdueTasks(chatTasks);
        const priorityConfig = PRIORITY_COLORS[priority] || PRIORITY_COLORS.normal;

        const marker = document.createElement('span');
        marker.className = `whl-task-marker ${settings.compactMode ? 'compact' : ''}`;
        marker.setAttribute('data-priority', priority);

        // Tooltip com detalhes
        let tooltipText = `${count} tarefa${count > 1 ? 's' : ''} pendente${count > 1 ? 's' : ''}`;
        if (overdue.length > 0) {
            tooltipText += ` (${overdue.length} atrasada${overdue.length > 1 ? 's' : ''})`;
        }
        marker.setAttribute('data-tooltip', tooltipText);

        // Dot colorido
        const dot = document.createElement('span');
        dot.className = 'whl-task-marker-dot';
        marker.appendChild(dot);

        // Contador
        if (settings.showCount) {
            const countEl = document.createElement('span');
            countEl.className = 'whl-task-marker-count';
            countEl.textContent = count;
            marker.appendChild(countEl);
        }

        // Label de prioridade
        if (settings.showPriority && !settings.compactMode) {
            const prioEl = document.createElement('span');
            prioEl.className = 'whl-task-marker-priority';
            prioEl.textContent = priorityConfig.label;
            marker.appendChild(prioEl);
        }

        return marker;
    }

    function insertMarker(chatItem, marker) {
        const titleContainer = chatItem.querySelector('[data-testid="cell-frame-title"]') ||
                               chatItem.querySelector('._21S-L') ||
                               chatItem.querySelector('[dir="auto"]')?.parentElement;

        if (titleContainer) {
            const parent = titleContainer.parentElement;
            if (parent) {
                parent.style.display = 'flex';
                parent.style.alignItems = 'center';
                parent.style.gap = '4px';
            }
            titleContainer.after(marker);
        } else {
            chatItem.appendChild(marker);
        }
    }

    function updateChatMarker(chatItem) {
        const chatId = extractChatId(chatItem);
        if (!chatId) return;

        chatItem.setAttribute('data-whl-chat-id', chatId);

        // Remover marker existente
        const existingMarker = chatItem.querySelector('.whl-task-marker');
        if (existingMarker) existingMarker.remove();

        if (!settings.enabled) return;

        // Buscar tarefas do chat
        const chatTasks = getTasksForChat(chatId);
        if (chatTasks.length === 0) return;

        // Criar e inserir marker
        const marker = createMarker(chatTasks);
        insertMarker(chatItem, marker);
    }

    function updateAllMarkers() {
        const chatItems = getChatItems();
        for (const chatItem of chatItems) {
            updateChatMarker(chatItem);
        }
    }

    function removeAllMarkers() {
        document.querySelectorAll('.whl-task-marker').forEach(el => el.remove());
    }

    function scheduleUpdate() {
        if (updateTimeout) {
            clearTimeout(updateTimeout);
        }
        updateTimeout = setTimeout(() => {
            updateAllMarkers();
        }, CONFIG.DEBOUNCE_DELAY);
    }

    // ============================================
    // OBSERVER
    // ============================================

    function setupObserver() {
        const chatList = document.querySelector('[data-testid="chat-list"]') ||
                         document.querySelector('[role="grid"]') ||
                         document.querySelector('#pane-side');

        if (!chatList) {
            setTimeout(setupObserver, 1000);
            return;
        }

        observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;

            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    shouldUpdate = true;
                    break;
                }
            }

            if (shouldUpdate) {
                scheduleUpdate();
            }
        });

        observer.observe(chatList, {
            childList: true,
            subtree: true
        });

        console.log('[TaskMarkers] Observer configurado');
    }

    function setupStorageListener() {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;

            if (changes.whl_tasks_v2) {
                tasks = changes.whl_tasks_v2.newValue || {};
                scheduleUpdate();
            }

            if (changes.whl_task_marker_settings) {
                settings = { ...settings, ...changes.whl_task_marker_settings.newValue };
                scheduleUpdate();
            }
        });
    }

    // ============================================
    // INICIALIZAÇÃO
    // ============================================

    async function init() {
        if (initialized) return;

        console.log('[TaskMarkers] Inicializando...');

        await loadData();
        injectStyles();
        setupStorageListener();

        waitForWhatsApp();

        initialized = true;
    }

    function waitForWhatsApp() {
        const chatList = document.querySelector('[data-testid="chat-list"]') ||
                         document.querySelector('[role="grid"]') ||
                         document.querySelector('#pane-side');

        if (chatList) {
            setupObserver();
            updateAllMarkers();

            if (recheckInterval) clearInterval(recheckInterval);
            recheckInterval = setInterval(updateAllMarkers, CONFIG.RECHECK_INTERVAL);
        } else {
            setTimeout(waitForWhatsApp, 500);
        }
    }

    // ============================================
    // API PÚBLICA
    // ============================================

    function updateSettings(newSettings) {
        settings = { ...settings, ...newSettings };
        saveSettings();
        scheduleUpdate();
    }

    function refresh() {
        loadData()
            .then(() => updateAllMarkers())
            .catch((e) => console.warn('[TaskMarkers] Falha ao atualizar marcadores:', e?.message || e));
    }

    function destroy() {
        if (observer) {
            observer.disconnect();
        }
        if (recheckInterval) {
            clearInterval(recheckInterval);
            recheckInterval = null;
        }
        removeAllMarkers();
        const styles = document.getElementById('whl-task-markers-style');
        if (styles) styles.remove();
        initialized = false;
    }

    // Cleanup ao descarregar
    window.addEventListener('beforeunload', destroy);

    // ============================================
    // EXPORT
    // ============================================

    window.__WHL_TASK_MARKERS_INJECTOR__ = true;

    window.TaskMarkersInjector = {
        init,
        refresh,
        updateSettings,
        updateAllMarkers,
        removeAllMarkers,
        destroy,
        getSettings: () => ({ ...settings })
    };

    // Auto-inicializar
    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

    console.log('[TaskMarkersInjector] Módulo carregado');
})();
