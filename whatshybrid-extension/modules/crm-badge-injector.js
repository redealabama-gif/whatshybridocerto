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
    let contactByName = {};   // Mapa nome-normalizado -> contact (match das rows @lid)
    
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

        // Mapa de contatos por phone (normalizado) e por nome (normalizado).
        // O mapa por nome é o elo principal: WA 2.3000.x usa @lid nas rows da
        // lista (sem telefone visível), então só o nome exibido casa com o CRM.
        contactByPhone = {};
        contactByName = {};
        if (crmData.contacts) {
            for (const contact of crmData.contacts) {
                if (contact.phone) {
                    const normalizedPhone = normalizePhone(contact.phone);
                    if (normalizedPhone) {
                        contactByPhone[normalizedPhone] = contact;
                    }
                }
                const nk = normalizeName(contact.name);
                if (nk) contactByName[nk] = contact;
            }
        }

        log('Maps construídos:', Object.keys(contactByPhone).length, 'phones,',
            Object.keys(contactByName).length, 'nomes mapeados');
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

    // Normaliza um nome para casar row do WhatsApp ↔ contato do CRM.
    // Remove emojis/símbolos decorativos (ex: "Mãe ❤️" → "mãe"), colapsa
    // espaços e baixa a caixa — o WA costuma exibir o nome do contato salvo
    // com emojis que o usuário não digitou ao criar o contato no CRM.
    function normalizeName(s) {
        if (!s) return '';
        return String(s)
            .normalize('NFKC')
            .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    // Lê o nome exibido numa row da lista de chats (primeiro span[title] útil).
    function getRowDisplayName(row) {
        for (const sel of TITLE_SELECTORS) {
            const el = row.querySelector(sel);
            const t = (el?.getAttribute('title') || el?.textContent || '').trim();
            if (t) return t;
        }
        return '';
    }

    // Resolve as etiquetas de um contato do CRM (labels gravadas por telefone).
    function getLabelsForContact(contact) {
        if (!contact || !labelsData.contactLabels) return [];
        const phone = normalizePhone(contact.phone);
        if (!phone) return [];
        const variations = [phone, phone.replace(/^55/, ''), `55${phone}`];
        for (const v of variations) {
            const ids = labelsData.contactLabels[v];
            if (ids && ids.length) return ids.map(id => labelMap[id]).filter(Boolean);
        }
        return [];
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

    // Cache nome-de-contato → chatId resolvido pelo WHL_WaBridge.
    // Para chats com contato salvo no celular, o WhatsApp Web mostra o NOME no
    // título da row — sem data-id ou href com @c.us. Sem este map, o badge
    // injector não conseguia ligar a etiqueta do CRM (gravada por telefone) à
    // row correspondente. Atualizado a cada 30s ou quando o storage muda.
    let _nameToChatId = {};
    let _nameMapLastFetch = 0;
    const NAME_MAP_TTL_MS = 30000;

    async function refreshNameMap(force = false) {
        const now = Date.now();
        if (!force && (now - _nameMapLastFetch) < NAME_MAP_TTL_MS) return;
        _nameMapLastFetch = now;
        try {
            const chats = await bridgeRequest('getChats', {});
            if (!Array.isArray(chats)) return;
            const next = {};
            for (const c of chats) {
                if (!c?.id || !c?.name) continue;
                const nm = String(c.name).trim().toLowerCase();
                if (nm) next[nm] = c.id;
            }
            _nameToChatId = next;
        } catch (e) {
            // Bridge ainda não pronta? Silencioso — tenta de novo em 30s.
        }
    }

    function bridgeRequest(type, payload, timeoutMs = 5000) {
        return new Promise((resolve, reject) => {
            const requestId = `whl_crm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const onMsg = (e) => {
                if (e.source !== window) return;
                const d = e.data;
                if (!d || d.source !== 'WHL_PAGE_BRIDGE' || d.type !== 'RESPONSE' || d.requestId !== requestId) return;
                window.removeEventListener('message', onMsg);
                clearTimeout(timer);
                if (d.error) reject(new Error(d.error));
                else resolve(d.data);
            };
            const timer = setTimeout(() => {
                window.removeEventListener('message', onMsg);
                reject(new Error('Bridge timeout'));
            }, timeoutMs);
            window.addEventListener('message', onMsg);
            window.postMessage({ source: 'WHL_ISOLATED', type, requestId, payload }, window.location.origin);
        });
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

        // 3. Tentar do título (número de telefone) — só funciona quando
        // o contato NÃO está salvo (WA exibe o número cru).
        for (const sel of TITLE_SELECTORS) {
            const titleEl = element.querySelector(sel);
            const title = titleEl?.getAttribute('title') || titleEl?.textContent;
            if (title) {
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

        // 5. Fallback: contato salvo (WA mostra o nome). Resolve via map
        // construído a partir do WHL_WaBridge.getChats. Atualiza em background
        // se o cache estiver vazio.
        for (const sel of TITLE_SELECTORS) {
            const titleEl = element.querySelector(sel);
            const name = (titleEl?.getAttribute('title') || titleEl?.textContent || '').trim().toLowerCase();
            if (!name) continue;
            const cid = _nameToChatId[name];
            if (cid) return cid;
        }
        // Cache miss: dispara refresh assíncrono para a próxima chamada.
        if (Object.keys(_nameToChatId).length === 0 || (Date.now() - _nameMapLastFetch) > NAME_MAP_TTL_MS) {
            refreshNameMap();
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
        // Limpa badges antigos primeiro — garante que remover etiqueta/contato
        // do CRM faça o badge sumir da row no próximo ciclo.
        chatItem.querySelectorAll('.whl-badge-wrapper-v53, .whl-stage-indicator-v53').forEach(el => el.remove());

        if (!settings.showBadge) return;

        // Match primário: nome exibido na row ↔ contato do CRM (por nome).
        // WA 2.3000.x usa @lid nas rows (sem telefone/data-id), então o nome
        // é o único elo confiável com o CRM (que guarda nome + telefone).
        const displayName = getRowDisplayName(chatItem);
        let contact = displayName ? contactByName[normalizeName(displayName)] : null;
        let labels;

        if (contact) {
            labels = getLabelsForContact(contact);
        } else {
            // Fallback: contato não salvo — WA mostra o número cru na row.
            const chatId = extractChatId(chatItem);
            contact = findContactByChatId(chatId);
            labels = findLabelsByChatId(chatId);
        }

        // Se não tem contato nem labels, sair
        if (!contact && labels.length === 0) return;

        chatItem.setAttribute('data-whl-chat-id', contact?.phone || displayName || '1');
        chatItem.style.position = 'relative';

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
        // v9.6.0: badge também aparece no header do chat aberto (ao lado do
        // nome do contato). Antes só aparecia na lista lateral.
        try {
            updateActiveChatHeaderBadge();
        } catch (error) {
            console.error('[BadgeInjector v53] Erro ao atualizar header:', error);
        }
    }

    function updateActiveChatHeaderBadge() {
        // Seletores cobrindo WA 2024-2026
        const headerSelectors = [
            'header[data-testid="conversation-header"]',
            '#main header',
            'div[role="region"] header',
            'header.copyable-area'
        ];
        let header = null;
        for (const sel of headerSelectors) {
            header = document.querySelector(sel);
            if (header) break;
        }
        if (!header) return;

        // Limpa badges anteriores do header
        header.querySelectorAll('.whl-header-badge-wrapper').forEach(el => el.remove());

        // Acha o span do nome do contato no header (onde o badge é inserido)
        const nameEl = header.querySelector('span[dir="auto"][title]') ||
                       header.querySelector('div[role="button"] span[title]') ||
                       header.querySelector('span[title]');
        if (!nameEl) return;

        // Match primário por nome — mesma estratégia das rows da lista.
        const displayName = (nameEl.getAttribute('title') || nameEl.textContent || '').trim();
        let contact = displayName ? contactByName[normalizeName(displayName)] : null;
        let labels;

        if (contact) {
            labels = getLabelsForContact(contact);
        } else {
            // Fallback: resolve chatId (contato não salvo / número visível).
            let chatId = null;
            try {
                if (window.WHL_WaBridge?.getActiveChatId) {
                    chatId = window.WHL_WaBridge.getActiveChatId();
                }
            } catch (_) {}
            if (!chatId) {
                const idEl = header.querySelector('[data-id]') ||
                             document.querySelector('#main [data-id]');
                const dataId = idEl?.getAttribute('data-id') || '';
                const m = dataId.match(/(\d+)@([cg])\.us/);
                if (m) chatId = `${m[1]}@${m[2]}.us`;
            }
            contact = findContactByChatId(chatId);
            labels = findLabelsByChatId(chatId);
        }
        if (!contact && labels.length === 0) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'whl-header-badge-wrapper whl-badge-wrapper-v53';
        wrapper.style.cssText = 'display:inline-flex;gap:6px;align-items:center;margin-left:8px;';

        if (contact?.stage) {
            const stage = stageMap[contact.stage];
            if (stage) wrapper.appendChild(createStageBadge(stage, contact));
        }
        if (settings.showLabel && labels.length > 0) {
            const max = Math.min(labels.length, 2);
            for (let i = 0; i < max; i++) {
                wrapper.appendChild(createLabelBadge(labels[i]));
            }
        }
        if (wrapper.children.length > 0) {
            const parent = nameEl.parentElement;
            if (parent) {
                parent.style.display = 'flex';
                parent.style.alignItems = 'center';
            }
            nameEl.after(wrapper);
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

        // Pré-carrega o mapa nome→chatId via WHL_WaBridge para que rows com
        // contato salvo (sem data-id legível) consigam casar com etiquetas
        // do CRM gravadas por telefone. Sem await — não bloqueia init.
        refreshNameMap(true);

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
