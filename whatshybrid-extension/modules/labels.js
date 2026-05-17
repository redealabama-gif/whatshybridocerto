/**
 * 🏷️ LabelsModule - Sistema de Etiquetas CORRIGIDO v2
 * Usando event delegation para todos os botões
 */

(function() {
    'use strict';

    // XSS Protection - Escape HTML entities
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    const STORAGE_KEY = 'whl_labels_v2';

    const DEFAULT_LABELS = [
        { id: 'new_client', name: 'Novo Cliente', color: '#10B981', icon: '🆕' },
        { id: 'vip', name: 'VIP', color: '#F59E0B', icon: '⭐' },
        { id: 'pending', name: 'Pendente', color: '#3B82F6', icon: '⏳' },
        { id: 'urgent', name: 'Urgente', color: '#EF4444', icon: '🔥' },
        { id: 'follow_up', name: 'Follow-up', color: '#8B5CF6', icon: '📞' },
        { id: 'done', name: 'Concluído', color: '#6B7280', icon: '✅' }
    ];

    const AVAILABLE_COLORS = [
        '#EF4444', '#F59E0B', '#10B981', '#3B82F6', 
        '#8B5CF6', '#EC4899', '#6B7280', '#14B8A6',
        '#F97316', '#84CC16', '#06B6D4', '#A855F7'
    ];

    const AVAILABLE_ICONS = [
        '🏷️', '⭐', '🔥', '✅', '⏳', '📞', '💼', '❤️', 
        '🎯', '💎', '🚀', '📌', '🆕', '💰', '🛒', '📧'
    ];

    let state = {
        labels: [...DEFAULT_LABELS],
        contactLabels: {},
        settings: { showInChatList: true, showColors: true, showIcons: true }
    };

    let initialized = false;
    let currentManagerContainer = null;

    // ==================== STORAGE ====================

    async function loadState() {
        return new Promise(resolve => {
            chrome.storage.local.get([STORAGE_KEY], result => {
                if (result[STORAGE_KEY]) {
                    state = { ...state, ...result[STORAGE_KEY] };
                }
                resolve();
            });
        });
    }

    async function saveState() {
        // Carimba o write — usado pelo crm.js#syncWithBackend pra decidir
        // se aceita a versão do backend ou mantém a local (timestamp merge).
        // Sem isto, sync devolvia versão estale e apagava etiquetas recém-criadas.
        state.lastUpdated = Date.now();
        return new Promise(resolve => {
            chrome.storage.local.set({ [STORAGE_KEY]: state }, resolve);
        });
    }

    // ==================== INIT ====================

    async function init() {
        if (initialized) return;
        await loadState();
        injectStyles();
        setupGlobalEventDelegation();
        initialized = true;
        console.log('[Labels] ✅ Inicializado com', state.labels.length, 'etiquetas');
    }

    function injectStyles() {
        if (document.getElementById('labels-styles-v3')) return;
        const style = document.createElement('style');
        style.id = 'labels-styles-v3';
        style.textContent = `
            .whl-label-badge{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;white-space:nowrap}
            .whl-label-item{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:rgba(255,255,255,0.05);border-radius:12px;margin-bottom:10px;border:1px solid rgba(255,255,255,0.1)}
            .whl-label-item:hover{background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.15)}
            .whl-label-item-info{display:flex;align-items:center;gap:12px}
            .whl-label-color-dot{width:24px;height:24px;border-radius:50%;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.2);transition:transform 0.2s}
            .whl-label-color-dot:hover{transform:scale(1.15)}
            .whl-label-name{font-weight:600;font-size:14px;color:white}
            .whl-label-count{font-size:11px;color:rgba(255,255,255,0.5);margin-top:2px}
            .whl-label-actions{display:flex;gap:8px}
            .whl-label-picker{position:fixed;background:rgba(26,26,46,0.98);border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,0.5);padding:14px;z-index:10001;min-width:220px;max-height:300px;overflow-y:auto;border:1px solid rgba(255,255,255,0.1)}
            .whl-label-picker-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;margin-bottom:4px;color:white}
            .whl-label-picker-item:hover{background:rgba(255,255,255,0.1)}
            .whl-label-picker-item.selected{background:rgba(139,92,246,0.2);border:1px solid rgba(139,92,246,0.4)}
            .whl-color-picker{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
            .whl-color-option{width:28px;height:28px;border-radius:50%;cursor:pointer;border:3px solid transparent;transition:all 0.2s;box-shadow:0 2px 4px rgba(0,0,0,0.2)}
            .whl-color-option:hover{transform:scale(1.15)}
            .whl-color-option.selected{border-color:white;box-shadow:0 0 0 3px rgba(139,92,246,0.5)}
            .labels-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:10001}
        `;
        document.head.appendChild(style);
    }

    /**
     * Event delegation global para Labels
     */
    function setupGlobalEventDelegation() {
        document.addEventListener('click', async (e) => {
            const target = e.target.closest('[data-label-action]');
            if (!target) return;

            e.preventDefault();
            e.stopPropagation();

            const action = target.dataset.labelAction;
            const labelId = target.dataset.labelId;
            const chatId = target.dataset.chatId;

            console.log('[Labels] Action:', action, 'LabelId:', labelId);

            switch (action) {
                case 'add-label':
                    openLabelModal(null);
                    break;
                case 'edit-label':
                    openLabelModal(labelId);
                    break;
                case 'delete-label':
                    if (confirm('Excluir esta etiqueta?')) {
                        await deleteLabel(labelId);
                        if (currentManagerContainer) renderLabelManager(currentManagerContainer);
                        alert('Etiqueta excluída!');
                    }
                    break;
                case 'change-color':
                    showColorPicker(labelId, target);
                    break;
                case 'close-modal':
                    const modal = target.closest('.labels-modal-overlay');
                    if (modal) modal.remove();
                    break;
                case 'select-color':
                    // Handled inline in color picker
                    break;
                case 'toggle-label':
                    await toggleLabelOnContact(chatId, labelId);
                    break;
            }
        });
    }

    // ==================== CRUD ====================

    function getLabels() { return state.labels; }
    function getLabel(id) { return state.labels.find(l => l.id === id); }

    async function createLabel(name, color = '#8B5CF6', icon = '🏷️') {
        const label = { 
            id: 'label_' + Date.now(), 
            name: name.trim(), 
            color, 
            icon, 
            createdAt: new Date().toISOString() 
        };
        state.labels.push(label);
        await saveState();
        return label;
    }

    async function updateLabel(id, updates) {
        const idx = state.labels.findIndex(l => l.id === id);
        if (idx === -1) return null;
        state.labels[idx] = { ...state.labels[idx], ...updates };
        await saveState();
        return state.labels[idx];
    }

    async function deleteLabel(id) {
        state.labels = state.labels.filter(l => l.id !== id);
        // Remover de todos os contatos
        for (const chatId in state.contactLabels) {
            state.contactLabels[chatId] = state.contactLabels[chatId].filter(lid => lid !== id);
            if (state.contactLabels[chatId].length === 0) {
                delete state.contactLabels[chatId];
            }
        }
        await saveState();
    }

    // ==================== CONTACT LABELS ====================

    function normalizeKey(chatId) {
        return String(chatId).replace(/\D/g, '') || chatId;
    }

    function getContactLabels(chatId) {
        const key = normalizeKey(chatId);
        const ids = state.contactLabels[key] || [];
        return ids.map(id => getLabel(id)).filter(Boolean);
    }

    async function addLabelToContact(chatId, labelId) {
        const key = normalizeKey(chatId);
        if (!state.contactLabels[key]) state.contactLabels[key] = [];
        if (!state.contactLabels[key].includes(labelId)) {
            state.contactLabels[key].push(labelId);
            await saveState();
        }
    }

    async function removeLabelFromContact(chatId, labelId) {
        const key = normalizeKey(chatId);
        if (state.contactLabels[key]) {
            state.contactLabels[key] = state.contactLabels[key].filter(id => id !== labelId);
            if (state.contactLabels[key].length === 0) {
                delete state.contactLabels[key];
            }
            await saveState();
        }
    }

    async function toggleLabelOnContact(chatId, labelId) {
        const key = normalizeKey(chatId);
        const current = state.contactLabels[key] || [];
        if (current.includes(labelId)) {
            await removeLabelFromContact(chatId, labelId);
        } else {
            await addLabelToContact(chatId, labelId);
        }
    }

    async function setContactLabels(chatId, labelIds) {
        const key = normalizeKey(chatId);
        if (labelIds.length === 0) {
            delete state.contactLabels[key];
        } else {
            state.contactLabels[key] = [...labelIds];
        }
        await saveState();
    }

    function getContactsByLabel(labelId) {
        const contacts = [];
        for (const chatId in state.contactLabels) {
            if (state.contactLabels[chatId].includes(labelId)) {
                contacts.push(chatId);
            }
        }
        return contacts;
    }

    function getLabelStats() {
        const stats = {};
        state.labels.forEach(l => { stats[l.id] = 0; });
        for (const chatId in state.contactLabels) {
            state.contactLabels[chatId].forEach(lid => {
                if (stats[lid] !== undefined) stats[lid]++;
            });
        }
        return stats;
    }

    // ==================== RENDERIZAÇÃO ====================

    function renderLabelBadge(label) {
        if (!label) return '';
        // v9.3.8 SECURITY FIX: label.color/icon/name vêm do user.
        const safeName = String(label.name || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const safeIcon = String(label.icon || '🏷️').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        // Valida cor: hex (3-8) ou rgb/rgba — caso contrário usa fallback
        const safeColor = /^#[0-9a-fA-F]{3,8}$|^rgba?\([\d.,\s%]+\)$/.test(label.color || '') ? label.color : '#8b5cf6';
        const bgColor = hexToRgba(safeColor, 0.2);
        return `<span class="whl-label-badge" style="background:${bgColor};color:${safeColor};">
            <span>${safeIcon}</span>
            <span>${safeName}</span>
        </span>`;
    }

    function renderContactLabels(chatId) {
        const labels = getContactLabels(chatId);
        if (labels.length === 0) return '';
        return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
            ${labels.map(l => renderLabelBadge(l)).join('')}
        </div>`;
    }

    function renderLabelManager(container) {
        if (!container) return;
        currentManagerContainer = container;

        const stats = getLabelStats();

        container.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <span style="font-size:13px;color:rgba(255,255,255,0.6);">${state.labels.length} etiquetas</span>
                <button data-label-action="add-label" style="
                    background:linear-gradient(135deg,#8b5cf6,#3b82f6);
                    border:none;padding:8px 16px;border-radius:8px;
                    font-size:12px;font-weight:600;cursor:pointer;color:white;
                ">➕ Nova Etiqueta</button>
            </div>
            <div id="labels-list">
                ${state.labels.map(label => `
                    <div class="whl-label-item">
                        <div class="whl-label-item-info">
                            <div class="whl-label-color-dot" 
                                 data-label-action="change-color" 
                                 data-label-id="${escapeHtml(label.id)}"
                                 style="background:${escapeHtml(label.color)};"
                                 title="Clique para mudar a cor"></div>
                            <div>
                                <div class="whl-label-name">${escapeHtml(label.icon || '🏷️')} ${escapeHtml(label.name)}</div>
                                <div class="whl-label-count">${stats[label.id] || 0} contatos</div>
                            </div>
                        </div>
                        <div class="whl-label-actions">
                            <button data-label-action="edit-label" data-label-id="${escapeHtml(label.id)}" style="
                                background:rgba(139,92,246,0.2);border:none;padding:6px 10px;
                                border-radius:6px;cursor:pointer;color:#a78bfa;font-size:12px;
                            ">✏️</button>
                            <button data-label-action="delete-label" data-label-id="${escapeHtml(label.id)}" style="
                                background:rgba(239,68,68,0.2);border:none;padding:6px 10px;
                                border-radius:6px;cursor:pointer;color:#ef4444;font-size:12px;
                            ">🗑️</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // ==================== COLOR PICKER ====================

    function showColorPicker(labelId, anchorEl) {
        // Remover pickers existentes
        document.querySelectorAll('.whl-color-picker-popup').forEach(p => p.remove());
        
        const label = getLabel(labelId);
        if (!label) return;

        const picker = document.createElement('div');
        picker.className = 'whl-label-picker whl-color-picker-popup';
        picker.innerHTML = `
            <div style="font-weight:600;margin-bottom:10px;font-size:13px;color:white;">Escolher Cor</div>
            <div class="whl-color-picker">
                ${AVAILABLE_COLORS.map(c => `
                    <div class="whl-color-option ${label.color === c ? 'selected' : ''}" 
                         data-color="${escapeHtml(c)}" 
                         style="background:${escapeHtml(c)};"></div>
                `).join('')}
            </div>
        `;

        const rect = anchorEl.getBoundingClientRect();
        picker.style.top = (rect.bottom + 5) + 'px';
        picker.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px';
        document.body.appendChild(picker);

        // Event listeners para cores
        picker.querySelectorAll('.whl-color-option').forEach(opt => {
            opt.addEventListener('click', async () => {
                await updateLabel(labelId, { color: opt.dataset.color });
                picker.remove();
                if (currentManagerContainer) renderLabelManager(currentManagerContainer);
                alert('Cor atualizada!');
            });
        });

        // Fechar ao clicar fora
        setTimeout(() => {
            const closeHandler = (e) => {
                if (!picker.contains(e.target) && e.target !== anchorEl) {
                    picker.remove();
                    document.removeEventListener('click', closeHandler);
                }
            };
            document.addEventListener('click', closeHandler);
        }, 100);
    }

    // ==================== LABEL PICKER (para contatos) ====================

    function showLabelPicker(chatId, anchorElement) {
        // Remover pickers existentes
        document.querySelectorAll('.whl-label-picker').forEach(p => p.remove());

        const key = normalizeKey(chatId);
        const currentLabels = state.contactLabels[key] || [];

        const picker = document.createElement('div');
        picker.className = 'whl-label-picker';
        picker.innerHTML = `
            <div style="font-weight:600;margin-bottom:8px;font-size:13px;color:white;">Selecionar Etiquetas</div>
            ${state.labels.map(l => `
                <div class="whl-label-picker-item ${currentLabels.includes(l.id) ? 'selected' : ''}" 
                     data-label-id="${escapeHtml(l.id)}" data-chat-id="${escapeHtml(chatId)}">
                    <div style="width:12px;height:12px;border-radius:50%;background:${escapeHtml(l.color)};"></div>
                    <span>${escapeHtml(l.icon || '')} ${escapeHtml(l.name)}</span>
                    ${currentLabels.includes(l.id) ? '<span style="margin-left:auto;">✓</span>' : ''}
                </div>
            `).join('')}
        `;

        const rect = anchorElement.getBoundingClientRect();
        picker.style.top = (rect.bottom + 5) + 'px';
        picker.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px';
        document.body.appendChild(picker);

        // Event listeners
        picker.querySelectorAll('.whl-label-picker-item').forEach(item => {
            item.addEventListener('click', async () => {
                const lid = item.dataset.labelId;
                const cid = item.dataset.chatId;
                await toggleLabelOnContact(cid, lid);
                picker.remove();
                alert('Etiqueta atualizada!');
            });
        });

        // Fechar ao clicar fora
        setTimeout(() => {
            const closeHandler = (e) => {
                if (!picker.contains(e.target) && e.target !== anchorElement) {
                    picker.remove();
                    document.removeEventListener('click', closeHandler);
                }
            };
            document.addEventListener('click', closeHandler);
        }, 100);
    }

    // ==================== MODAL ====================

    function openLabelModal(labelId) {
        const isEdit = !!labelId;
        const label = isEdit ? getLabel(labelId) : null;

        // Remover modais existentes
        document.querySelectorAll('.labels-modal-overlay').forEach(m => m.remove());

        const modal = document.createElement('div');
        modal.className = 'labels-modal-overlay';

        modal.innerHTML = `
            <div style="background:#1a1a2e;border-radius:16px;padding:24px;width:90%;max-width:400px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                    <h3 style="margin:0;font-size:18px;color:white;">${isEdit ? '✏️ Editar' : '➕ Nova'} Etiqueta</h3>
                    <button data-label-action="close-modal" style="
                        background:rgba(255,255,255,0.1);border:none;width:32px;height:32px;
                        border-radius:50%;font-size:18px;cursor:pointer;color:white;
                    ">×</button>
                </div>

                <form id="label-form" style="display:flex;flex-direction:column;gap:16px;">
                    <div>
                        <label style="font-size:12px;color:rgba(255,255,255,0.6);display:block;margin-bottom:4px;">Nome</label>
                        <input type="text" id="label-name" value="${escapeHtml(label?.name || '')}" required style="
                            width:100%;padding:10px;background:rgba(0,0,0,0.3);
                            border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:white;
                        ">
                    </div>

                    <div>
                        <label style="font-size:12px;color:rgba(255,255,255,0.6);display:block;margin-bottom:8px;">Cor</label>
                        <div class="whl-color-picker" id="color-picker-grid">
                            ${AVAILABLE_COLORS.map(c => `
                                <div class="whl-color-option ${label?.color === c ? 'selected' : ''}" 
                                     data-color="${c}" 
                                     style="background:${c};"></div>
                            `).join('')}
                        </div>
                        <input type="hidden" id="label-color" value="${label?.color || AVAILABLE_COLORS[4]}">
                    </div>

                    <div>
                        <label style="font-size:12px;color:rgba(255,255,255,0.6);display:block;margin-bottom:8px;">Ícone</label>
                        <div style="display:flex;flex-wrap:wrap;gap:6px;" id="icon-picker-grid">
                            ${AVAILABLE_ICONS.map(i => `
                                <button type="button" class="icon-option" data-icon="${i}" style="
                                    padding:8px 12px;background:rgba(255,255,255,0.1);border:2px solid ${label?.icon === i ? '#8b5cf6' : 'transparent'};
                                    border-radius:8px;cursor:pointer;font-size:16px;
                                ">${i}</button>
                            `).join('')}
                        </div>
                        <input type="hidden" id="label-icon" value="${label?.icon || '🏷️'}">
                    </div>

                    <div style="display:flex;gap:8px;margin-top:8px;">
                        <button type="button" data-label-action="close-modal" style="
                            flex:1;padding:12px;background:rgba(255,255,255,0.1);
                            border:none;border-radius:8px;color:white;cursor:pointer;
                        ">Cancelar</button>
                        <button type="submit" style="
                            flex:1;padding:12px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);
                            border:none;border-radius:8px;color:white;font-weight:600;cursor:pointer;
                        ">${isEdit ? '💾 Salvar' : '➕ Criar'}</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        // Color picker
        modal.querySelectorAll('#color-picker-grid .whl-color-option').forEach(opt => {
            opt.addEventListener('click', () => {
                modal.querySelectorAll('#color-picker-grid .whl-color-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                modal.querySelector('#label-color').value = opt.dataset.color;
            });
        });

        // Icon picker
        modal.querySelectorAll('#icon-picker-grid .icon-option').forEach(opt => {
            opt.addEventListener('click', () => {
                modal.querySelectorAll('#icon-picker-grid .icon-option').forEach(o => o.style.borderColor = 'transparent');
                opt.style.borderColor = '#8b5cf6';
                modal.querySelector('#label-icon').value = opt.dataset.icon;
            });
        });

        // Submit
        modal.querySelector('#label-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = modal.querySelector('#label-name').value.trim();
            const color = modal.querySelector('#label-color').value;
            const icon = modal.querySelector('#label-icon').value;

            if (!name) {
                alert('Nome é obrigatório');
                return;
            }

            try {
                if (isEdit) {
                    await updateLabel(labelId, { name, color, icon });
                } else {
                    await createLabel(name, color, icon);
                }
                modal.remove();
                if (currentManagerContainer) renderLabelManager(currentManagerContainer);
                alert(isEdit ? 'Etiqueta atualizada!' : 'Etiqueta criada!');
            } catch (err) {
                alert('Erro: ' + err.message);
            }
        });
    }

    // ==================== HELPERS ====================

    function hexToRgba(hex, alpha = 1) {
        if (!hex || hex[0] !== '#') return `rgba(139,92,246,${alpha})`;
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
            return `rgba(139,92,246,${alpha})`;
        }
        return `rgba(${r},${g},${b},${alpha})`;
    }

    function getSettings() { return state.settings; }
    async function updateSettings(s) { 
        state.settings = { ...state.settings, ...s }; 
        await saveState(); 
    }

    // ==================== API PÚBLICA ====================

    window.LabelsModule = {
        init,
        getLabels, getLabel, createLabel, updateLabel, deleteLabel,
        getContactLabels, addLabelToContact, removeLabelFromContact, 
        setContactLabels, toggleLabelOnContact, getContactsByLabel, getLabelStats,
        renderLabelBadge, renderContactLabels, renderLabelManager,
        showLabelPicker, showColorPicker, openLabelModal,
        getSettings, updateSettings,
        hexToRgba, DEFAULT_LABELS, AVAILABLE_COLORS, AVAILABLE_ICONS,
        reloadData: loadState
    };

    // ==================== SINCRONIZAÇÃO COM STORAGE ====================
    // Escuta mudanças do storage (quando CRM em aba separada salva labels)
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes[STORAGE_KEY]) return;

        const incoming = changes[STORAGE_KEY].newValue;
        const incomingTs = Number(incoming?.lastUpdated) || 0;
        const currentTs = Number(state?.lastUpdated) || 0;

        // Guarda 1: se o write é do PRÓPRIO labels.js#saveState (mesmo
        // timestamp do state atual), ignora — evita loop "salvei →
        // listener → loadState → re-render → outro listener atrás".
        if (incomingTs && incomingTs === currentTs) {
            return;
        }

        // Guarda 2: se o new value é vazio (sem contactLabels e só com
        // os labels default) MAS o state atual tem dados próprios do
        // usuário, ignora. Sintoma original do bug: o CRM
        // syncWithBackend escrevia whl_labels_v2 com payload vazio
        // (master workspace novo sem dados no backend), o listener
        // recarregava state vazio, etiquetas sumiam.
        const incomingHasUserData = !!incoming && (
            (incoming.contactLabels && Object.keys(incoming.contactLabels).length > 0) ||
            (Array.isArray(incoming.labels) && incoming.labels.length > DEFAULT_LABELS.length)
        );
        const currentHasUserData = (state.contactLabels && Object.keys(state.contactLabels).length > 0) ||
            (Array.isArray(state.labels) && state.labels.length > DEFAULT_LABELS.length);
        if (!incomingHasUserData && currentHasUserData) {
            console.warn('[Labels] 🛡️ Ignorado write externo vazio (state atual tem dados de usuário)');
            return;
        }

        console.log('[Labels] 🔄 Dados alterados externamente, recarregando...');
        loadState().then(() => {
            if (typeof window.renderModuleViews === 'function') {
                window.renderModuleViews();
            }
        });
    });

    console.log('[Labels] Módulo v53 carregado - Sincronização ativada');
})();
