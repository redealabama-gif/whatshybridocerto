/**
 * 🏷️ CRM Badge Injector v53 - CORRIGIDO
 * WhatsHybrid - Injeta badges visuais no WhatsApp Web
 * 
 * CORREÇÕES v53:
 * - Lê dados do storage CORRETO (whl_crm_v2)
 * - Sincroniza contatos por phone->chatId
 * - Posicionamento corrigido (não cortado)
 * - Suporte a etiquetas/labels também
 */

(function() {
    'use strict';

    // Evitar múltiplas instâncias
    if (window.__WHL_CRM_BADGE_INJECTOR_V53__) {
        console.log('[BadgeInjector v53] Já carregado');
        return;
    }
    window.__WHL_CRM_BADGE_INJECTOR_V53__ = true;

    // ============================================
    // CONFIGURAÇÃO
    // ============================================

    const CONFIG = {
        RECHECK_INTERVAL: 3000,
        DEBOUNCE_DELAY: 150,
        DEBUG: false  // DESATIVADO
    };

    // Storage keys - CORRIGIDO para ler do local certo
    const STORAGE_KEYS = {
        CRM_DATA: 'whl_crm_v2',           // ← Chave CORRETA do CRM
        LABELS_DATA: 'whl_labels_v2',      // ← Chave das labels
        BADGE_SETTINGS: 'whl_badge_settings_v2'
    };

    // v9.3.2: stages SINCRONIZADOS com crm.js (mesma ordem, mesmas cores).
    // Antes: badge-injector tinha negotiation antes de proposal e cores diferentes.
    // Resultado: badge mostrava cor X, kanban mostrava cor Y pro mesmo estágio.
    const DEFAULT_STAGES = [
        { id: 'new',         name: 'Novo',          color: '#6B7280', icon: '🆕', order: 0 },
        { id: 'lead',        name: 'Lead',          color: '#8B5CF6', icon: '🎯', order: 1 },
        { id: 'contact',     name: 'Contato Feito', color: '#3B82F6', icon: '📞', order: 2 },
        { id: 'proposal',    name: 'Proposta',      color: '#F59E0B', icon: '📋', order: 3 },
        { id: 'negotiation', name: 'Negociação',    color: '#EC4899', icon: '💼', order: 4 },
        { id: 'won',         name: 'Ganho',         color: '#10B981', icon: '✅', order: 5 },
        { id: 'lost',        name: 'Perdido',       color: '#EF4444', icon: '❌', order: 6 }
    ];

    // ============================================
    // ESTADO
    // ============================================

    let crmData = { contacts: [], deals: [], pipeline: null };
    let labelsData = { labels: [], contactLabels: {} };
    let stageMap = {};
    let labelMap = {};
    let contactByPhone = {};  // Mapa phone -> contact
    
    let settings = {
        showBadge: true,
        showIcon: true,
        showName: false,
        showLabel: true,
        position: 'right',
        size: 'small'
    };

    let observer = null;
    let updateTimeout = null;
    let badgeUpdateInterval = null;
    let initialized = false;

    // Cleanup
    window.addEventListener('beforeunload', () => {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        if (badgeUpdateInterval) {
            clearInterval(badgeUpdateInterval);
            badgeUpdateInterval = null;
        }
        if (updateTimeout) {
            clearTimeout(updateTimeout);
            updateTimeout = null;
        }
    });

    // ============================================
    // LOGGING
    // ============================================

    function log(...args) {
        if (CONFIG.DEBUG) {
            console.log('[BadgeInjector v53]', ...args);
        }
    }

    // ============================================
    // STORAGE - CORRIGIDO
    // ============================================

    async function loadData() {
        try {
            const result = await chrome.storage.local.get([
                STORAGE_KEYS.CRM_DATA,
                STORAGE_KEYS.LABELS_DATA,
                STORAGE_KEYS.BADGE_SETTINGS
            ]);

            // Carregar CRM - do local CORRETO
            if (result[STORAGE_KEYS.CRM_DATA]) {
                crmData = result[STORAGE_KEYS.CRM_DATA];
                log('CRM carregado:', crmData.contacts?.length || 0, 'contatos');
            }

            // Carregar Labels
            if (result[STORAGE_KEYS.LABELS_DATA]) {
                labelsData = result[STORAGE_KEYS.LABELS_DATA];
                log('Labels carregadas:', labelsData.labels?.length || 0);
            }

            // Carregar settings
            if (result[STORAGE_KEYS.BADGE_SETTINGS]) {
                settings = { ...settings, ...result[STORAGE_KEYS.BADGE_SETTINGS] };
            }

            buildMaps();

        } catch (error) {
            console.error('[BadgeInjector v53] Erro ao carregar dados:', error);
        }
    }

    function buildMaps() {
        // Mapa de estágios
        stageMap = {};
        const stages = crmData.pipeline?.stages || DEFAULT_STAGES;
        for (const stage of stages) {
            stageMap[stage.id] = stage;
        }

        // Mapa de labels
        labelMap = {};
        if (labelsData.labels) {
            for (const label of labelsData.labels) {
                labelMap[label.id] = label;
            }
        }

        // Mapa de contatos por phone (normalizado)
        contactByPhone = {};
        if (crmData.contacts) {
            for (const contact of crmData.contacts) {
                if (contact.phone) {
                    const normalizedPhone = normalizePhone(contact.phone);
                    if (normalizedPhone) {
                        contactByPhone[normalizedPhone] = contact;
                    }
                }
            }
        }

        log('Maps construídos:', Object.keys(contactByPhone).length, 'phones mapeados');
    }

    // ============================================
    // NORMALIZAÇÃO DE TELEFONE
    // ============================================

    function normalizePhone(phone) {
        if (!phone) return null;
        // Remove tudo que não é dígito
        let digits = String(phone).replace(/\D/g, '');
        // Remove @c.us ou @g.us se presente
        digits = digits.replace(/@[cg]\.us$/, '');
        // Retorna se tiver pelo menos 8 dígitos
        return digits.length >= 8 ? digits : null;
    }

    function phoneToChat(phone) {
        const normalized = normalizePhone(phone);
        return normalized ? `${normalized}@c.us` : null;
    }

    function chatIdToPhone(chatId) {
        if (!chatId) return null;
        return normalizePhone(chatId.replace(/@[cg]\.us$/, ''));
    }

    // ============================================
    // ESTILOS CSS - MELHORADO
    // ============================================

    function injectStyles() {
        if (document.getElementById('whl-badge-styles-v53')) return;

        const styles = document.createElement('style');
        styles.id = 'whl-badge-styles-v53';
        styles.textContent = `
            /* ===== BADGE PRINCIPAL ===== */
            .whl-crm-badge-v53 {
                display: inline-flex !important;
                align-items: center !important;
                gap: 3px !important;
                padding: 2px 6px !important;
                border-radius: 8px !important;
                font-size: 10px !important;
                font-weight: 600 !important;
                line-height: 1.3 !important;
                white-space: nowrap !important;
                z-index: 50 !important;
                pointer-events: none !important;
                transition: all 0.15s ease !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
                flex-shrink: 0 !important;
                /* v9.3.2: aumentado de 80px → 110px pra caber "Negociação" e "Contato Feito" */
                max-width: 110px !important;
                overflow: hidden !important;
            }

            /* Tamanhos */
            .whl-crm-badge-v53.size-small {
                font-size: 9px !important;
                padding: 1px 5px !important;
                /* v9.3.2: 65px → 90px */
                max-width: 90px !important;
            }
            .whl-crm-badge-v53.size-medium {
                font-size: 10px !important;
                padding: 2px 6px !important;
                /* v9.3.2: 90px → 110px */
                max-width: 110px !important;
            }
            .whl-crm-badge-v53.size-large {
                font-size: 11px !important;
                padding: 3px 8px !important;
                /* v9.3.2: 100px → 130px */
                max-width: 130px !important;
            }

            /* ===== WRAPPER ===== */
            .whl-badge-wrapper-v53 {
                display: inline-flex !important;
                align-items: center !important;
                gap: 3px !important;
                flex-shrink: 0 !important;
                margin-left: 4px !important;
                max-width: 150px !important;
                overflow: hidden !important;
            }

            /* ===== ÍCONE ===== */
            .whl-crm-badge-icon-v53 {
                font-size: 9px !important;
                line-height: 1 !important;
                flex-shrink: 0 !important;
            }

            .whl-crm-badge-v53.size-small .whl-crm-badge-icon-v53 {
                font-size: 8px !important;
            }

            /* ===== NOME DO ESTÁGIO ===== */
            .whl-crm-badge-name-v53 {
                /* v9.3.2: 50px → 80px pra acomodar "Negociação" sem ellipsis */
                max-width: 80px !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                white-space: nowrap !important;
            }

            /* ===== INDICADOR LATERAL ===== */
            .whl-stage-indicator-v53 {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                bottom: 0 !important;
                width: 3px !important;
                border-radius: 0 2px 2px 0 !important;
                z-index: 10 !important;
            }

            /* ===== CONTAINER DO TÍTULO - FIX PARA NÃO CORTAR ===== */
            .whl-title-row-fixed {
                display: flex !important;
                align-items: center !important;
                gap: 4px !important;
                width: 100% !important;
                min-width: 0 !important;
            }

            .whl-title-text-v53 {
                flex: 1 !important;
                min-width: 0 !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
            }

            /* ===== HOVER ===== */
            [data-whl-chat-id]:hover .whl-crm-badge-v53 {
                transform: scale(1.03);
            }

            /* ===== ANIMAÇÃO ===== */
            @keyframes whlBadgeFadeIn53 {
                from { opacity: 0; transform: scale(0.9); }
                to { opacity: 1; transform: scale(1); }
            }

            .whl-crm-badge-v53.animate-in {
                animation: whlBadgeFadeIn53 0.15s ease-out;
            }

            /* ===== TOOLTIP ===== */
            .whl-crm-badge-v53[data-tooltip] {
                position: relative !important;
                pointer-events: auto !important;
                cursor: default !important;
            }

            .whl-crm-badge-v53[data-tooltip]:hover::after {
                content: attr(data-tooltip);
                position: absolute;
                bottom: calc(100% + 4px);
                left: 50%;
                transform: translateX(-50%);
                padding: 4px 8px;
                background: #1f2937;
                color: white;
                font-size: 10px;
                border-radius: 4px;
                white-space: nowrap;
                z-index: 10000;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            }

            /* ===== LABEL BADGE ===== */
            .whl-label-badge-v53 {
                display: inline-flex !important;
                align-items: center !important;
                padding: 1px 4px !important;
                border-radius: 6px !important;
                font-size: 8px !important;
                font-weight: 500 !important;
                white-space: nowrap !important;
                flex-shrink: 0 !important;
            }
        `;

        document.head.appendChild(styles);
        log('Estilos injetados');
    }

    // ============================================
    // UTILITÁRIOS
    // ============================================

    function hexToRgba(hex, alpha) {
        if (!hex || hex[0] !== '#') {
            return `rgba(107, 114, 128, ${alpha})`;
        }
        
        let r, g, b;
        if (hex.length === 7) {
            r = parseInt(hex.slice(1, 3), 16);
            g = parseInt(hex.slice(3, 5), 16);
            b = parseInt(hex.slice(5, 7), 16);
        } else if (hex.length === 4) {
            r = parseInt(hex[1] + hex[1], 16);
            g = parseInt(hex[2] + hex[2], 16);
            b = parseInt(hex[3] + hex[3], 16);
        } else {
            return `rgba(107, 114, 128, ${alpha})`;
        }
        
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // ============================================
    // SELETORES DO WHATSAPP — MULTI-VERSÃO (v9.3.2)
    // ============================================
    //
    // WhatsApp Web atualiza seletores frequentemente. Esta lista cobre
    // múltiplas gerações em ordem do mais novo pro mais antigo.
    // Use WHL_WaBridge.get('chat') quando precisar de fallback robusto.
    //
    // Estratégia: tenta cada seletor; primeiro que retornar elementos vence.
    // Se o WhatsApp atualizar e quebrar, logamos via reportFailure e o
    // canary do v9.2.0 detecta dentro de 30 minutos.

    const CHAT_SELECTORS = [
        // 2026 (atual): role-based, mais semântico
        '[role="listitem"]',
        // 2025-2026: testid moderno
        '[data-testid="cell-frame-container"]',
        '[data-testid="list-item"]',
        // 2024 fallbacks
        'div[tabindex="-1"][role="row"]',
        // 2023 (legados — manter pra compatibilidade)
        '._8nE1Y',
        '.X7YrQ',
        // último recurso: qualquer div com data-id que pareça chat
        'div[data-id*="@c.us"], div[data-id*="@g.us"]',
    ];

    const TITLE_SELECTORS = [
        // 2026: busca pelo span dentro do header da célula
        'span[dir="auto"][title]:not([title=""])',
        // 2025: testid moderno
        '[data-testid="cell-frame-title"]',
        // 2024
        'span[title][dir="auto"]',
        // 2023 fallbacks
        '._21S-L span[title]',
        // último: qualquer span com title de tamanho razoável
        'span[title]',
    ];

    function getChatItems() {
        for (const selector of CHAT_SELECTORS) {
            try {
                const items = document.querySelectorAll(selector);
                if (items.length > 0) {
                    return Array.from(items);
                }
            } catch (e) {
                // Selector inválido — continua
            }
        }
        // v9.3.2: integra com telemetria do v9.2.0 — quando NENHUM seletor
        // funciona, registra falha pro canary detectar e backend dashboard mostrar
        if (window.WHL_WaBridge?.reportFailure) {
            window.WHL_WaBridge.reportFailure('chat_list', {
                metadata: { component: 'crm-badge-injector', selectors_tried: CHAT_SELECTORS.length }
            });
        }
        return [];
    }

    function extractChatId(element) {
        // Verificar se já tem ID
        const existing = element.getAttribute('data-whl-chat-id');
        if (existing) return existing;

        // 1. Tentar data-id no próprio elemento ou filhos
        const dataId = element.getAttribute('data-id') || 
                       element.querySelector('[data-id]')?.getAttribute('data-id');
        if (dataId) {
            const match = dataId.match(/(\d+)@([cg])\.us/);
            if (match) return `${match[1]}@${match[2]}.us`;
        }

        // 2. Tentar de link
        const link = element.querySelector('a[href]');
        if (link) {
            const href = link.getAttribute('href') || '';
            const match = href.match(/(\d+)@([cg])\.us/);
            if (match) return `${match[1]}@${match[2]}.us`;
        }

        // 3. Tentar do título (número de telefone)
        for (const sel of TITLE_SELECTORS) {
            const titleEl = element.querySelector(sel);
            const title = titleEl?.getAttribute('title') || titleEl?.textContent;
            if (title) {
                // Número com formato: +55 11 99999-9999 ou similar
                const phoneMatch = title.match(/\+?(\d[\d\s\-().]{8,})/);
                if (phoneMatch) {
                    const digits = phoneMatch[1].replace(/\D/g, '');
                    if (digits.length >= 10) {
                        return `${digits}@c.us`;
                    }
                }
            }
        }

        // 4. Tentar de qualquer span com número
        const spans = element.querySelectorAll('span');
        for (const span of spans) {
            const text = span.textContent?.trim();
            if (text) {
                const phoneMatch = text.match(/^\+?(\d{10,15})$/);
                if (phoneMatch) {
                    return `${phoneMatch[1]}@c.us`;
                }
            }
        }

        return null;
    }

    // ============================================
    // BUSCAR CONTATO POR CHATID
    // ============================================

    function findContactByChatId(chatId) {
        if (!chatId) return null;

        const phone = chatIdToPhone(chatId);
        if (!phone) return null;

        // Buscar no mapa por diferentes variações
        const variations = [
            phone,
            phone.replace(/^55/, ''),  // Sem código do Brasil
            `55${phone}`,               // Com código do Brasil
        ];

        for (const v of variations) {
            if (contactByPhone[v]) {
                return contactByPhone[v];
            }
        }

        // Buscar por substring (caso telefone esteja incompleto)
        for (const [key, contact] of Object.entries(contactByPhone)) {
            if (phone.endsWith(key) || key.endsWith(phone)) {
                return contact;
            }
        }

        return null;
    }

    // ============================================
    // BUSCAR LABELS POR CHATID
    // ============================================

    function findLabelsByChatId(chatId) {
        if (!chatId || !labelsData.contactLabels) return [];

        const phone = chatIdToPhone(chatId);
        if (!phone) return [];

        // Buscar labels associadas
        const labelIds = labelsData.contactLabels[phone] || 
                         labelsData.contactLabels[chatId] ||
                         [];

        return labelIds.map(id => labelMap[id]).filter(Boolean);
    }

    // ============================================
    // CRIAR BADGES
    // ============================================

    function createStageBadge(stage, contact) {
        const badge = document.createElement('span');
        badge.className = `whl-crm-badge-v53 size-${settings.size} stage-${stage.id} animate-in`;
        badge.style.backgroundColor = hexToRgba(stage.color, 0.15);
        badge.style.color = stage.color;
        badge.style.border = `1px solid ${hexToRgba(stage.color, 0.3)}`;

        // Tooltip
        let tooltipParts = [stage.name];
        if (contact.name) tooltipParts.push(contact.name);
        
        // Buscar deal value
        const deal = crmData.deals?.find(d => d.contactId === contact.id);
        if (deal?.value) {
            tooltipParts.push(`R$ ${deal.value.toLocaleString('pt-BR')}`);
        }
        
        badge.setAttribute('data-tooltip', tooltipParts.join(' • '));

        // Ícone
        if (settings.showIcon && stage.icon) {
            const icon = document.createElement('span');
            icon.className = 'whl-crm-badge-icon-v53';
            icon.textContent = stage.icon;
            badge.appendChild(icon);
        }

        // Nome do estágio
        if (settings.showName) {
            const name = document.createElement('span');
            name.className = 'whl-crm-badge-name-v53';
            name.textContent = stage.name;
            badge.appendChild(name);
        }

        return badge;
    }

    function createLabelBadge(label) {
        const badge = document.createElement('span');
        badge.className = 'whl-label-badge-v53';
        badge.style.backgroundColor = hexToRgba(label.color || '#8B5CF6', 0.2);
        badge.style.color = label.color || '#8B5CF6';
        badge.textContent = label.name?.substring(0, 8) || '•';
        badge.title = label.name || '';
        return badge;
    }

    // ============================================
    // INSERIR BADGE NO CHAT
    // ============================================

    function updateChatBadge(chatItem) {
        const chatId = extractChatId(chatItem);
        if (!chatId) return;

        chatItem.setAttribute('data-whl-chat-id', chatId);
        chatItem.style.position = 'relative';

        // Remover badges existentes
        chatItem.querySelectorAll('.whl-badge-wrapper-v53, .whl-stage-indicator-v53').forEach(el => el.remove());

        if (!settings.showBadge) return;

        // Buscar contato
        const contact = findContactByChatId(chatId);
        const labels = findLabelsByChatId(chatId);

        // Se não tem contato nem labels, sair
        if (!contact && labels.length === 0) return;

        // Encontrar onde inserir
        let titleContainer = null;
        for (const sel of TITLE_SELECTORS) {
            titleContainer = chatItem.querySelector(sel);
            if (titleContainer) break;
        }

        if (!titleContainer) {
            // Fallback: primeiro span com dir=auto
            titleContainer = chatItem.querySelector('span[dir="auto"]');
        }

        if (!titleContainer) return;

        // Criar wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'whl-badge-wrapper-v53';

        // Adicionar badge de estágio se tiver contato com estágio
        if (contact?.stage) {
            const stage = stageMap[contact.stage];
            if (stage) {
                const stageBadge = createStageBadge(stage, contact);
                wrapper.appendChild(stageBadge);

                // Adicionar indicador lateral
                const indicator = document.createElement('div');
                indicator.className = 'whl-stage-indicator-v53';
                indicator.style.backgroundColor = stage.color;
                chatItem.appendChild(indicator);
            }
        }

        // Adicionar labels (máximo 2)
        if (settings.showLabel && labels.length > 0) {
            const maxLabels = Math.min(labels.length, 2);
            for (let i = 0; i < maxLabels; i++) {
                const labelBadge = createLabelBadge(labels[i]);
                wrapper.appendChild(labelBadge);
            }
        }

        // Inserir wrapper após o título
        if (wrapper.children.length > 0) {
            // Ajustar o parent para flex
            const parent = titleContainer.parentElement;
            if (parent) {
                parent.style.display = 'flex';
                parent.style.alignItems = 'center';
                parent.style.gap = '4px';
                parent.style.overflow = 'hidden';
            }

            // v9.3.2: respeitar settings.position (antes ficava sempre à direita do título)
            if (settings.position === 'left') {
                titleContainer.before(wrapper);
                wrapper.style.marginLeft = '0';
                wrapper.style.marginRight = '4px';
            } else {
                titleContainer.after(wrapper);
                wrapper.style.marginLeft = '4px';
                wrapper.style.marginRight = '0';
            }
        }
    }

    function updateAllBadges() {
        const chatItems = getChatItems();
        log('Atualizando', chatItems.length, 'chats');
        
        for (const chatItem of chatItems) {
            try {
                updateChatBadge(chatItem);
            } catch (error) {
                console.error('[BadgeInjector v53] Erro ao atualizar chat:', error);
            }
        }
    }

    function removeAllBadges() {
        document.querySelectorAll('.whl-badge-wrapper-v53').forEach(el => el.remove());
        document.querySelectorAll('.whl-stage-indicator-v53').forEach(el => el.remove());
    }

    function scheduleUpdate() {
        if (updateTimeout) {
            clearTimeout(updateTimeout);
        }
        updateTimeout = setTimeout(() => {
            updateAllBadges();
        }, CONFIG.DEBOUNCE_DELAY);
    }

    // ============================================
    // OBSERVER
    // ============================================

    function setupObserver() {
        // Tentar encontrar a lista de chats
        const chatList = document.querySelector('[data-testid="chat-list"]') ||
                         document.querySelector('[role="grid"]') ||
                         document.querySelector('#pane-side') ||
                         document.querySelector('div[aria-label]');

        if (!chatList) {
            log('Lista de chats não encontrada, tentando novamente...');
            setTimeout(setupObserver, 1000);
            return;
        }

        if (observer) {
            observer.disconnect();
        }

        observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;

            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    // Verificar se são novos itens de chat
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            shouldUpdate = true;
                            break;
                        }
                    }
                }
                if (shouldUpdate) break;
            }

            if (shouldUpdate) {
                scheduleUpdate();
            }
        });

        observer.observe(chatList, {
            childList: true,
            subtree: true
        });

        log('Observer configurado');
    }

    function setupStorageListener() {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;

            let needsRebuild = false;
            let needsForcedRepaint = false;

            if (changes[STORAGE_KEYS.CRM_DATA]) {
                crmData = changes[STORAGE_KEYS.CRM_DATA].newValue || { contacts: [], deals: [], pipeline: null };
                needsRebuild = true;
                needsForcedRepaint = true;  // v9.3.2 FIX: dados mudaram → repinta JÁ
                log('CRM atualizado');
            }

            if (changes[STORAGE_KEYS.LABELS_DATA]) {
                labelsData = changes[STORAGE_KEYS.LABELS_DATA].newValue || { labels: [], contactLabels: {} };
                needsRebuild = true;
                needsForcedRepaint = true;
                log('Labels atualizadas');
            }

            if (changes[STORAGE_KEYS.BADGE_SETTINGS]) {
                settings = { ...settings, ...changes[STORAGE_KEYS.BADGE_SETTINGS].newValue };
                needsForcedRepaint = true;  // settings mudaram → repinta tudo
            }

            if (needsRebuild) {
                buildMaps();
            }

            // v9.3.2 FIX: quando dados mudam (usuário marcou contato com nova cor),
            // força repaint imediato em vez de esperar debounce (150ms parece pouco
            // mas em listas com 1000+ chats o usuário percebe lag visual).
            if (needsForcedRepaint) {
                // Limpa todos os badges antes pra evitar duplicação
                removeAllBadges();
                // Usa requestAnimationFrame pra coalescer com próximo paint do browser
                requestAnimationFrame(() => updateAllBadges());
            } else {
                scheduleUpdate();
            }
        });
    }

    // ============================================
    // INICIALIZAÇÃO
    // ============================================

    async function init() {
        if (initialized) return;

        console.log('[BadgeInjector v53] 🚀 Inicializando...');

        await loadData();
        injectStyles();
        setupStorageListener();

        // Aguardar WhatsApp carregar
        waitForWhatsApp();

        initialized = true;
    }

    function waitForWhatsApp() {
        const chatList = document.querySelector('[data-testid="chat-list"]') ||
                         document.querySelector('[role="grid"]') ||
                         document.querySelector('#pane-side');

        if (chatList) {
            setupObserver();
            
            // Primeira atualização
            setTimeout(() => {
                updateAllBadges();
            }, 500);

            // Atualização periódica
            if (badgeUpdateInterval) clearInterval(badgeUpdateInterval);
            badgeUpdateInterval = setInterval(updateAllBadges, CONFIG.RECHECK_INTERVAL);
            
            console.log('[BadgeInjector v53] ✅ Inicializado com sucesso');
        } else {
            setTimeout(waitForWhatsApp, 500);
        }
    }

    // ============================================
    // API PÚBLICA
    // ============================================

    function updateSettings(newSettings) {
        settings = { ...settings, ...newSettings };
        chrome.storage.local.set({ [STORAGE_KEYS.BADGE_SETTINGS]: settings });
        scheduleUpdate();
    }

    function refresh() {
        loadData().then(() => {
            buildMaps();
            updateAllBadges();
        });
    }

    function destroy() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        if (badgeUpdateInterval) {
            clearInterval(badgeUpdateInterval);
            badgeUpdateInterval = null;
        }
        removeAllBadges();
        const styles = document.getElementById('whl-badge-styles-v53');
        if (styles) styles.remove();
        initialized = false;
        window.__WHL_CRM_BADGE_INJECTOR_V53__ = false;
    }

    // Debug
    function debugInfo() {
        return {
            contacts: Object.keys(contactByPhone).length,
            stages: Object.keys(stageMap).length,
            labels: Object.keys(labelMap).length,
            settings,
            initialized
        };
    }

    // ============================================
    // EXPORT
    // ============================================

    window.CRMBadgeInjector = {
        init,
        refresh,
        updateSettings,
        updateAllBadges,
        removeAllBadges,
        destroy,
        debugInfo,
        getSettings: () => ({ ...settings }),
        getStages: () => Object.values(stageMap)
    };

    // Auto-inicializar
    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

    console.log('[CRMBadgeInjector v53] Módulo carregado');
})();
