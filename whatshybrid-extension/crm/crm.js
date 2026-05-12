/**
 * WhatsHybrid CRM - Kanban em Aba Separada
 * v6.9.0 - Versão completa e corrigida
 * 
 * Correções:
 * - Abrir WhatsApp via background script (chrome.runtime.sendMessage)
 * - Editar contato funcionando via event delegation
 * - Sincronização bidirecional com sidepanel
 * - Drag & drop entre colunas
 * - Modal de contato completo
 */

(function() {
    'use strict';

    // ============================================
    // CONFIGURAÇÃO
    // ============================================

    const STORAGE_KEY = 'whl_crm_v2';
    const LABELS_KEY = 'whl_labels_v2';

    const DEFAULT_STAGES = [
        { id: 'new', name: 'Novo', color: '#6B7280', icon: '🆕', order: 0 },
        { id: 'lead', name: 'Lead', color: '#8B5CF6', icon: '🎯', order: 1 },
        { id: 'contact', name: 'Contato Feito', color: '#3B82F6', icon: '📞', order: 2 },
        { id: 'proposal', name: 'Proposta', color: '#F59E0B', icon: '📋', order: 3 },
        { id: 'negotiation', name: 'Negociação', color: '#EC4899', icon: '💼', order: 4 },
        { id: 'won', name: 'Ganho', color: '#10B981', icon: '✅', order: 5 },
        { id: 'lost', name: 'Perdido', color: '#EF4444', icon: '❌', order: 6 }
    ];

    const DEFAULT_LABELS = [
        { id: 'vip', name: 'VIP', color: '#F59E0B' },
        { id: 'urgent', name: 'Urgente', color: '#EF4444' },
        { id: 'follow_up', name: 'Follow-up', color: '#8B5CF6' },
        { id: 'new_client', name: 'Novo Cliente', color: '#10B981' }
    ];

    // ============================================
    // ESTADO
    // ============================================

    let state = {
        contacts: [],
        deals: [],
        pipeline: { stages: DEFAULT_STAGES },
        labels: DEFAULT_LABELS,
        contactLabels: {},
        whatsappConnected: false,
        whatsappTabId: null
    };

    let currentEditingContact = null;
    let draggedCard = null;
    let elements = {};
    let connectionCheckInterval = null;

    // ============================================
    // INICIALIZAÇÃO
    // ============================================

    function initElements() {
        elements = {
            kanbanBoard: document.getElementById('kanbanBoard'),
            searchInput: document.getElementById('searchInput'),
            connectionStatus: document.getElementById('connectionStatus'),
            btnAddContact: document.getElementById('btnAddContact'),
            btnRefresh: document.getElementById('btnRefresh'),
            contactModal: document.getElementById('contactModal'),
            contactForm: document.getElementById('contactForm'),
            modalTitle: document.getElementById('modalTitle'),
            closeModal: document.getElementById('closeModal'),
            btnCancel: document.getElementById('btnCancel'),
            btnSave: document.getElementById('btnSave'),
            btnDelete: document.getElementById('btnDelete'),
            btnOpenChat: document.getElementById('btnOpenChat'),
            labelsContainer: document.getElementById('labelsContainer'),
            toastContainer: document.getElementById('toastContainer'),
            statTotal: document.getElementById('statTotal'),
            statLeads: document.getElementById('statLeads'),
            statNegotiation: document.getElementById('statNegotiation'),
            statWon: document.getElementById('statWon'),
            statValue: document.getElementById('statValue'),
            contactId: document.getElementById('contactId'),
            contactPhone: document.getElementById('contactPhone'),
            contactName: document.getElementById('contactName'),
            contactEmail: document.getElementById('contactEmail'),
            contactCompany: document.getElementById('contactCompany'),
            contactStage: document.getElementById('contactStage'),
            contactValue: document.getElementById('contactValue'),
            contactNotes: document.getElementById('contactNotes')
        };
        
        // Log de elementos não encontrados para debug
        Object.entries(elements).forEach(([key, el]) => {
            if (!el) console.warn(`[CRM] Elemento não encontrado: ${key}`);
        });
    }

    async function init() {
        console.log('[CRM] 🚀 Inicializando CRM Standalone v6.9.0...');
        
        initElements();
        await loadData();
        setupEventListeners();
        renderKanban();
        updateStats();
        await checkWhatsAppConnection();
        
        // Verificar conexão periodicamente
        if (connectionCheckInterval) clearInterval(connectionCheckInterval);
        connectionCheckInterval = setInterval(checkWhatsAppConnection, 5000);
        
        console.log('[CRM] ✅ CRM Pronto -', state.contacts.length, 'contatos carregados');
    }
    
    // Cleanup ao descarregar
    window.addEventListener('beforeunload', () => {
        if (connectionCheckInterval) {
            clearInterval(connectionCheckInterval);
            connectionCheckInterval = null;
        }
    });

    // ============================================
    // STORAGE
    // ============================================

    async function loadData() {
        try {
            const result = await chrome.storage.local.get([STORAGE_KEY, LABELS_KEY]);
            
            if (result[STORAGE_KEY]) {
                state.contacts = result[STORAGE_KEY].contacts || [];
                state.deals = result[STORAGE_KEY].deals || [];
                state.pipeline = result[STORAGE_KEY].pipeline || { stages: DEFAULT_STAGES };
            }
            
            if (result[LABELS_KEY]) {
                state.labels = result[LABELS_KEY].labels || DEFAULT_LABELS;
                state.contactLabels = result[LABELS_KEY].contactLabels || {};
            }
            
            console.log('[CRM] 📦 Dados carregados:', state.contacts.length, 'contatos,', state.labels.length, 'labels');
        } catch (error) {
            console.error('[CRM] ❌ Erro ao carregar dados:', error);
            showToast('error', 'Erro ao carregar dados');
        }
    }

    async function saveData() {
        try {
            await chrome.storage.local.set({
                [STORAGE_KEY]: {
                    contacts: state.contacts,
                    deals: state.deals,
                    pipeline: state.pipeline
                },
                [LABELS_KEY]: {
                    labels: state.labels,
                    contactLabels: state.contactLabels
                }
            });
            console.log('[CRM] 💾 Dados salvos com sucesso');
        } catch (error) {
            console.error('[CRM] ❌ Erro ao salvar:', error);
            showToast('error', 'Erro ao salvar dados');
        }
    }

    // ============================================
    // WHATSAPP - COMUNICAÇÃO CORRIGIDA
    // ============================================

    async function checkWhatsAppConnection() {
        try {
            const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
            state.whatsappConnected = tabs.length > 0;
            state.whatsappTabId = tabs[0]?.id || null;
            updateConnectionStatus(state.whatsappConnected);
        } catch (error) {
            console.error('[CRM] Erro ao verificar WhatsApp:', error);
            state.whatsappConnected = false;
            state.whatsappTabId = null;
            updateConnectionStatus(false);
        }
    }

    function updateConnectionStatus(connected) {
        if (!elements.connectionStatus) return;
        
        const text = elements.connectionStatus.querySelector('.status-text');
        elements.connectionStatus.classList.toggle('connected', connected);
        elements.connectionStatus.classList.toggle('disconnected', !connected);
        
        if (text) {
            text.textContent = connected ? 'WhatsApp conectado' : 'WhatsApp não encontrado';
        }
    }

    /**
     * Abre chat no WhatsApp - CORRIGIDO
     * Usa chrome.runtime.sendMessage para comunicar com background.js
     * que então encaminha para o content script
     */
    async function openWhatsAppChat(phone) {
        if (!phone) {
            showToast('warning', 'Telefone não informado');
            return;
        }

        const cleanPhone = String(phone).replace(/\D/g, '');
        
        if (!cleanPhone || cleanPhone.length < 10) {
            showToast('error', 'Telefone inválido');
            return;
        }
        
        console.log('[CRM] 📱 Abrindo chat para:', cleanPhone);
        showToast('info', 'Abrindo chat...');

        try {
            // Método 1: Enviar via runtime.sendMessage para o background.js
            // O background.js tem handler WHL_OPEN_CHAT que encaminha para content script
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    type: 'WHL_OPEN_CHAT',
                    phone: cleanPhone
                }, (resp) => {
                    if (chrome.runtime.lastError) {
                        console.warn('[CRM] Runtime error:', chrome.runtime.lastError);
                        resolve(null);
                    } else {
                        resolve(resp);
                    }
                });
                
                // Timeout de 3 segundos
                setTimeout(() => resolve(null), 3000);
            });

            if (response?.success) {
                console.log('[CRM] ✅ Chat aberto via background script');
                showToast('success', 'Chat aberto!');
                return;
            }

            // Método 2: Tentar diretamente via tabs.sendMessage
            if (state.whatsappConnected && state.whatsappTabId) {
                try {
                    await chrome.tabs.sendMessage(state.whatsappTabId, {
                        type: 'WHL_OPEN_CHAT',
                        phone: cleanPhone
                    });
                    
                    await chrome.tabs.update(state.whatsappTabId, { active: true });
                    const tab = await chrome.tabs.get(state.whatsappTabId);
                    await chrome.windows.update(tab.windowId, { focused: true });
                    
                    console.log('[CRM] ✅ Chat aberto via tabs.sendMessage');
                    showToast('success', 'Chat aberto!');
                    return;
                } catch (e) {
                    console.warn('[CRM] tabs.sendMessage falhou:', e.message);
                }

                // Método 3: Atualizar URL da aba do WhatsApp
                try {
                    const waUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
                    await chrome.tabs.update(state.whatsappTabId, { url: waUrl, active: true });
                    const tab = await chrome.tabs.get(state.whatsappTabId);
                    await chrome.windows.update(tab.windowId, { focused: true });
                    
                    console.log('[CRM] ✅ Chat aberto via URL update');
                    showToast('success', 'Abrindo chat...');
                    return;
                } catch (e) {
                    console.warn('[CRM] URL update falhou:', e.message);
                }
            }

            // Método 4: Último recurso - abrir nova aba
            const waUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
            window.open(waUrl, '_blank');
            console.log('[CRM] ✅ Chat aberto em nova aba');
            showToast('info', 'Abrindo WhatsApp em nova aba...');

        } catch (error) {
            console.error('[CRM] Erro ao abrir chat:', error);
            // Fallback absoluto
            const waUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
            window.open(waUrl, '_blank');
            showToast('info', 'Abrindo WhatsApp...');
        }
    }

    // ============================================
    // KANBAN - RENDERIZAÇÃO
    // ============================================

    function renderKanban() {
        if (!elements.kanbanBoard) {
            console.error('[CRM] kanbanBoard não encontrado');
            return;
        }

        const stages = state.pipeline?.stages || DEFAULT_STAGES;
        const searchTerm = elements.searchInput?.value?.toLowerCase() || '';
        
        elements.kanbanBoard.innerHTML = '';
        
        stages.forEach(stage => {
            const contacts = getContactsByStage(stage.id, searchTerm);
            
            const column = document.createElement('div');
            column.className = 'kanban-column';
            column.dataset.stageId = stage.id;
            
            column.innerHTML = `
                <div class="column-header">
                    <div class="column-title">
                        <span class="column-icon">${stage.icon}</span>
                        <span class="column-name">${stage.name}</span>
                        <span class="column-count">${contacts.length}</span>
                    </div>
                    <div class="column-indicator" style="background: ${stage.color}"></div>
                </div>
                <div class="column-cards" data-stage="${stage.id}">
                    ${contacts.length === 0 ? `
                        <div class="empty-column">
                            <div class="empty-column-icon">📭</div>
                            <div class="empty-column-text">Nenhum contato</div>
                        </div>
                    ` : contacts.map(c => createCardHTML(c)).join('')}
                </div>
            `;
            
            elements.kanbanBoard.appendChild(column);
        });
        
        setupDragAndDrop();
        console.log('[CRM] 📊 Kanban renderizado com', state.contacts.length, 'contatos');
    }

    function createCardHTML(contact) {
        const labels = getContactLabels(contact.phone);
        const value = contact.value || 0;
        const phoneFormatted = formatPhone(contact.phone);
        const phoneClean = String(contact.phone || '').replace(/\D/g, '');
        
        return `
            <div class="contact-card" draggable="true" data-contact-id="${contact.id}" data-phone="${phoneClean}">
                <div class="card-header">
                    <div>
                        <div class="contact-name">${escapeHtml(contact.name || 'Sem nome')}</div>
                        <div class="contact-phone">${phoneFormatted}</div>
                    </div>
                    ${value > 0 ? `<div class="contact-value">R$ ${formatMoney(value)}</div>` : ''}
                </div>
                ${labels.length > 0 ? `
                    <div class="card-labels">
                        ${labels.slice(0, 3).map(l => `
                            <span class="card-label" style="background: ${hexToRgba(l.color, 0.2)}; color: ${l.color}">
                                ${escapeHtml(l.name)}
                            </span>
                        `).join('')}
                    </div>
                ` : ''}
                <div class="card-footer">
                    <span class="card-date">${formatDate(contact.updatedAt || contact.createdAt)}</span>
                    <div class="card-actions">
                        <button type="button" class="card-action-btn whatsapp" data-action="open-chat" data-phone="${phoneClean}" title="Abrir WhatsApp">💬</button>
                        <button type="button" class="card-action-btn" data-action="edit-contact" data-contact-id="${contact.id}" title="Editar">✏️</button>
                    </div>
                </div>
            </div>
        `;
    }

    function getContactsByStage(stageId, searchTerm = '') {
        return state.contacts.filter(c => {
            if (c.stage !== stageId) return false;
            if (!searchTerm) return true;
            
            const s = searchTerm.toLowerCase();
            return (
                (c.name || '').toLowerCase().includes(s) ||
                (c.phone || '').includes(searchTerm) ||
                (c.email || '').toLowerCase().includes(s) ||
                (c.company || '').toLowerCase().includes(s)
            );
        });
    }

    function getContactLabels(phone) {
        if (!phone) return [];
        const ids = state.contactLabels[phone] || state.contactLabels[String(phone).replace(/\D/g, '')] || [];
        return ids.map(id => state.labels.find(l => l.id === id)).filter(Boolean);
    }

    // ============================================
    // DRAG & DROP
    // ============================================

    function setupDragAndDrop() {
        document.querySelectorAll('.contact-card').forEach(card => {
            card.addEventListener('dragstart', handleDragStart);
            card.addEventListener('dragend', handleDragEnd);
        });
        
        document.querySelectorAll('.column-cards').forEach(col => {
            col.addEventListener('dragover', handleDragOver);
            col.addEventListener('dragleave', handleDragLeave);
            col.addEventListener('drop', handleDrop);
        });
    }

    function handleDragStart(e) {
        draggedCard = this;
        this.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    }

    function handleDragEnd() {
        this.classList.remove('dragging');
        document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('drag-over'));
        draggedCard = null;
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        this.closest('.kanban-column')?.classList.add('drag-over');
    }

    function handleDragLeave() {
        this.closest('.kanban-column')?.classList.remove('drag-over');
    }

    async function handleDrop(e) {
        e.preventDefault();
        this.closest('.kanban-column')?.classList.remove('drag-over');
        
        if (!draggedCard) return;
        
        const contactId = draggedCard.dataset.contactId;
        const newStage = this.dataset.stage;
        const contact = state.contacts.find(c => c.id === contactId);
        
        if (contact && contact.stage !== newStage) {
            const oldStage = contact.stage;
            contact.stage = newStage;
            contact.updatedAt = new Date().toISOString();
            
            await saveData();
            renderKanban();
            updateStats();
            
            const stageName = (state.pipeline?.stages || DEFAULT_STAGES).find(s => s.id === newStage)?.name || newStage;
            showToast('success', `Movido para ${stageName}`);
            console.log('[CRM] Contato movido:', contactId, 'de', oldStage, 'para', newStage);
        }
        
        draggedCard = null;
    }

    // ============================================
    // MODAL - CRUD DE CONTATOS
    // ============================================

    function openModal(contact = null) {
        currentEditingContact = contact;
        
        // Reset form
        if (elements.contactForm) elements.contactForm.reset();
        
        // Popular select de estágios
        if (elements.contactStage) {
            const stages = state.pipeline?.stages || DEFAULT_STAGES;
            elements.contactStage.innerHTML = stages.map(s => 
                `<option value="${s.id}">${s.icon} ${s.name}</option>`
            ).join('');
        }
        
        // Popular labels
        renderLabelsSelector(contact?.phone);
        
        if (contact) {
            // Modo edição
            if (elements.modalTitle) elements.modalTitle.textContent = 'Editar Contato';
            if (elements.contactId) elements.contactId.value = contact.id || '';
            if (elements.contactPhone) elements.contactPhone.value = contact.phone || '';
            if (elements.contactName) elements.contactName.value = contact.name || '';
            if (elements.contactEmail) elements.contactEmail.value = contact.email || '';
            if (elements.contactCompany) elements.contactCompany.value = contact.company || '';
            if (elements.contactStage) elements.contactStage.value = contact.stage || 'new';
            if (elements.contactValue) elements.contactValue.value = contact.value || '';
            if (elements.contactNotes) elements.contactNotes.value = contact.notes || '';
            if (elements.btnDelete) elements.btnDelete.style.display = 'inline-flex';
            if (elements.btnOpenChat) elements.btnOpenChat.style.display = 'inline-flex';
            
            console.log('[CRM] Modal aberto para edição:', contact.id);
        } else {
            // Modo criação
            if (elements.modalTitle) elements.modalTitle.textContent = 'Novo Contato';
            if (elements.btnDelete) elements.btnDelete.style.display = 'none';
            if (elements.btnOpenChat) elements.btnOpenChat.style.display = 'none';
            
            console.log('[CRM] Modal aberto para novo contato');
        }
        
        if (elements.contactModal) {
            elements.contactModal.classList.add('active');
        }
        
        setTimeout(() => elements.contactPhone?.focus(), 100);
    }

    function closeModal() {
        if (elements.contactModal) {
            elements.contactModal.classList.remove('active');
        }
        currentEditingContact = null;
        console.log('[CRM] Modal fechado');
    }

    function renderLabelsSelector(phone = null) {
        if (!elements.labelsContainer) return;
        
        const phoneClean = phone ? String(phone).replace(/\D/g, '') : null;
        const selectedIds = phoneClean ? (state.contactLabels[phoneClean] || state.contactLabels[phone] || []) : [];
        
        elements.labelsContainer.innerHTML = state.labels.map(label => `
            <div class="label-chip ${selectedIds.includes(label.id) ? 'selected' : ''}" 
                 data-label-id="${label.id}"
                 style="background: ${hexToRgba(label.color, 0.2)}; color: ${label.color}">
                ${escapeHtml(label.name)}
            </div>
        `).join('');
    }

    async function saveContact() {
        const phoneRaw = elements.contactPhone?.value || '';
        const phone = phoneRaw.replace(/\D/g, '');
        
        if (!phone || phone.length < 10) {
            showToast('error', 'Telefone inválido (mínimo 10 dígitos)');
            return;
        }
        
        const contactData = {
            phone,
            name: elements.contactName?.value?.trim() || '',
            email: elements.contactEmail?.value?.trim() || '',
            company: elements.contactCompany?.value?.trim() || '',
            stage: elements.contactStage?.value || 'new',
            notes: elements.contactNotes?.value?.trim() || '',
            value: parseFloat(elements.contactValue?.value) || 0,
            updatedAt: new Date().toISOString()
        };
        
        if (currentEditingContact) {
            // Atualizar existente
            const idx = state.contacts.findIndex(c => c.id === currentEditingContact.id);
            if (idx !== -1) {
                state.contacts[idx] = { ...state.contacts[idx], ...contactData };
                console.log('[CRM] Contato atualizado:', currentEditingContact.id);
            }
        } else {
            // Criar novo
            contactData.id = `contact_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            contactData.createdAt = contactData.updatedAt;
            state.contacts.unshift(contactData);
            console.log('[CRM] Novo contato criado:', contactData.id);
        }
        
        // Salvar labels selecionadas
        const selectedLabels = Array.from(document.querySelectorAll('#labelsContainer .label-chip.selected'))
            .map(el => el.dataset.labelId)
            .filter(Boolean);
        
        if (selectedLabels.length > 0) {
            state.contactLabels[phone] = selectedLabels;
        } else {
            delete state.contactLabels[phone];
        }
        
        await saveData();
        closeModal();
        renderKanban();
        updateStats();
        
        showToast('success', currentEditingContact ? 'Contato atualizado!' : 'Contato criado!');
    }

    async function deleteContact() {
        if (!currentEditingContact) return;
        
        if (!confirm('Tem certeza que deseja excluir este contato?')) return;
        
        const phone = currentEditingContact.phone;
        const phoneClean = String(phone).replace(/\D/g, '');
        
        state.contacts = state.contacts.filter(c => c.id !== currentEditingContact.id);
        state.deals = state.deals.filter(d => d.contactId !== currentEditingContact.id);
        
        // Remover labels associadas
        delete state.contactLabels[phone];
        delete state.contactLabels[phoneClean];
        
        await saveData();
        closeModal();
        renderKanban();
        updateStats();
        
        showToast('success', 'Contato excluído');
        console.log('[CRM] Contato excluído:', currentEditingContact.id);
    }

    function editContact(contactId) {
        console.log('[CRM] Editando contato:', contactId);
        const contact = state.contacts.find(c => c.id === contactId);
        if (contact) {
            openModal(contact);
        } else {
            showToast('error', 'Contato não encontrado');
            console.error('[CRM] Contato não encontrado:', contactId);
        }
    }

    // ============================================
    // ESTATÍSTICAS
    // ============================================

    function updateStats() {
        const total = state.contacts.length;
        const leads = state.contacts.filter(c => c.stage === 'lead').length;
        const negotiation = state.contacts.filter(c => c.stage === 'negotiation').length;
        const won = state.contacts.filter(c => c.stage === 'won').length;
        const totalValue = state.contacts.filter(c => c.stage === 'won').reduce((s, c) => s + (c.value || 0), 0);
        
        if (elements.statTotal) elements.statTotal.textContent = total;
        if (elements.statLeads) elements.statLeads.textContent = leads;
        if (elements.statNegotiation) elements.statNegotiation.textContent = negotiation;
        if (elements.statWon) elements.statWon.textContent = won;
        if (elements.statValue) elements.statValue.textContent = `R$ ${formatMoney(totalValue)}`;
    }

    // ============================================
    // UTILITÁRIOS
    // ============================================

    function formatPhone(phone) {
        if (!phone) return '';
        const d = String(phone).replace(/\D/g, '');
        if (d.length === 13) return `+${d.slice(0,2)} ${d.slice(2,4)} ${d.slice(4,9)}-${d.slice(9)}`;
        if (d.length === 12) return `+${d.slice(0,2)} ${d.slice(2,4)} ${d.slice(4,8)}-${d.slice(8)}`;
        if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
        if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
        return phone;
    }

    function formatMoney(v) {
        return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v || 0);
    }

    function formatDate(str) {
        if (!str) return '';
        try {
            const d = new Date(str);
            const now = new Date();
            const diff = now - d;
            if (diff < 60000) return 'agora';
            if (diff < 3600000) return `${Math.floor(diff/60000)}min`;
            if (diff < 86400000) return `${Math.floor(diff/3600000)}h`;
            if (diff < 604800000) return `${Math.floor(diff/86400000)}d`;
            return d.toLocaleDateString('pt-BR');
        } catch { return ''; }
    }

    function hexToRgba(hex, alpha) {
        if (!hex || hex[0] !== '#') return `rgba(139,92,246,${alpha})`;
        try {
            const r = parseInt(hex.slice(1,3), 16);
            const g = parseInt(hex.slice(3,5), 16);
            const b = parseInt(hex.slice(5,7), 16);
            return `rgba(${r},${g},${b},${alpha})`;
        } catch { return `rgba(139,92,246,${alpha})`; }
    }

    function escapeHtml(text) {
        const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
        if (typeof fn === 'function' && fn !== escapeHtml) return fn(text);
        if (!text) return '';
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    function showToast(type, message) {
        console.log(`[CRM Toast] ${type}: ${message}`);
        
        if (!elements.toastContainer) return;
        
        const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${escapeHtml(message)}</span>`;
        
        elements.toastContainer.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function debounce(fn, ms) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
    }

    // ============================================
    // EVENT LISTENERS - SETUP COMPLETO
    // ============================================

    function setupEventListeners() {
        console.log('[CRM] Configurando event listeners...');
        
        // === Header buttons ===
        elements.btnAddContact?.addEventListener('click', () => {
            console.log('[CRM] Botão Adicionar clicado');
            openModal();
        });
        
        elements.btnRefresh?.addEventListener('click', async () => {
            console.log('[CRM] Botão Refresh clicado');
            await loadData();
            renderKanban();
            updateStats();
            showToast('success', 'Dados atualizados!');
        });
        
        // === Search - listener simplificado ===
        if (elements.searchInput) {
            let searchTimeout = null;
            elements.searchInput.addEventListener('input', function(e) {
                const searchValue = e.target.value;
                console.log('[CRM] Busca input:', searchValue);
                
                // Debounce manual
                if (searchTimeout) clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    console.log('[CRM] Executando busca:', searchValue);
                    renderKanban();
                }, 300);
            });
            console.log('[CRM] ✅ Listener de busca configurado');
        } else {
            console.warn('[CRM] searchInput não encontrado');
        }
        
        // === Modal buttons ===
        elements.closeModal?.addEventListener('click', () => {
            console.log('[CRM] Botão Fechar modal clicado');
            closeModal();
        });
        
        elements.btnCancel?.addEventListener('click', () => {
            console.log('[CRM] Botão Cancelar clicado');
            closeModal();
        });
        
        elements.btnSave?.addEventListener('click', () => {
            console.log('[CRM] Botão Salvar clicado');
            saveContact();
        });
        
        elements.btnDelete?.addEventListener('click', () => {
            console.log('[CRM] Botão Excluir clicado');
            deleteContact();
        });
        
        elements.btnOpenChat?.addEventListener('click', () => {
            console.log('[CRM] Botão Abrir Chat clicado');
            if (currentEditingContact?.phone) {
                openWhatsAppChat(currentEditingContact.phone);
            }
        });
        
        // === Modal backdrop click ===
        elements.contactModal?.addEventListener('click', (e) => {
            if (e.target === elements.contactModal) {
                closeModal();
            }
        });
        
        // === Kanban board - Event Delegation ===
        elements.kanbanBoard?.addEventListener('click', (e) => {
            // Verificar se clicou em um botão de ação
            const actionBtn = e.target.closest('[data-action]');
            
            if (actionBtn) {
                e.preventDefault();
                e.stopPropagation();
                
                const action = actionBtn.dataset.action;
                console.log('[CRM] Ação clicada:', action);
                
                if (action === 'open-chat') {
                    const phone = actionBtn.dataset.phone;
                    console.log('[CRM] Abrir chat para:', phone);
                    if (phone) {
                        openWhatsAppChat(phone);
                    } else {
                        showToast('warning', 'Telefone não encontrado');
                    }
                } else if (action === 'edit-contact') {
                    const contactId = actionBtn.dataset.contactId;
                    console.log('[CRM] Editar contato:', contactId);
                    if (contactId) {
                        editContact(contactId);
                    }
                }
                return;
            }
            
            // Verificar se clicou no card (para editar)
            const card = e.target.closest('.contact-card');
            if (card && !e.target.closest('[data-action]')) {
                const contactId = card.dataset.contactId;
                console.log('[CRM] Card clicado, editando:', contactId);
                if (contactId) {
                    editContact(contactId);
                }
            }
        });
        
        // === Labels selector - Event Delegation ===
        elements.labelsContainer?.addEventListener('click', (e) => {
            const chip = e.target.closest('.label-chip');
            if (chip) {
                chip.classList.toggle('selected');
                console.log('[CRM] Label toggled:', chip.dataset.labelId);
            }
        });
        
        // === Keyboard shortcuts ===
        document.addEventListener('keydown', (e) => {
            // ESC para fechar modal
            if (e.key === 'Escape' && elements.contactModal?.classList.contains('active')) {
                closeModal();
            }
            
            // Ctrl+N para novo contato
            if (e.ctrlKey && e.key === 'n' && !elements.contactModal?.classList.contains('active')) {
                e.preventDefault();
                openModal();
            }
        });
        
        // === Storage sync listener - Sincronização com sidepanel ===
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;
            
            let needsUpdate = false;
            
            if (changes[STORAGE_KEY]?.newValue) {
                const newData = changes[STORAGE_KEY].newValue;
                state.contacts = newData.contacts || [];
                state.deals = newData.deals || [];
                state.pipeline = newData.pipeline || { stages: DEFAULT_STAGES };
                needsUpdate = true;
                console.log('[CRM] 🔄 Dados CRM sincronizados do storage');
            }
            
            if (changes[LABELS_KEY]?.newValue) {
                const newData = changes[LABELS_KEY].newValue;
                state.labels = newData.labels || DEFAULT_LABELS;
                state.contactLabels = newData.contactLabels || {};
                needsUpdate = true;
                console.log('[CRM] 🔄 Labels sincronizadas do storage');
            }
            
            if (needsUpdate) {
                renderKanban();
                updateStats();
            }
        });
        
        console.log('[CRM] ✅ Event listeners configurados');
    }

    // ============================================
    // API PÚBLICA
    // ============================================

    window.CRM = {
        openChat: openWhatsAppChat,
        editContact,
        addContact: () => openModal(),
        deleteContact,
        refresh: async () => {
            await loadData();
            renderKanban();
            updateStats();
        },
        getContacts: () => [...state.contacts],
        getState: () => ({ ...state })
    };

    // ============================================
    // INICIALIZAÇÃO
    // ============================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
