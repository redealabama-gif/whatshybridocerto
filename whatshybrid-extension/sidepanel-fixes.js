/**
 * WhatsHybrid Lite - Correções Consolidadas para Side Panel Router
 * 
 * Este arquivo adiciona as funcionalidades que estavam quebradas ou incompletas:
 * - CRM: Etiquetas funcionais, botões Ver/Mensagem
 * - Tasks: Botão nova tarefa, filtro atrasadas
 * - Analytics: Inicialização correta
 * - IA: Correção de estilo
 * 
 * @version 1.0.0
 */

(() => {
  'use strict';

  // ============================================
  // INICIALIZAÇÃO DOS MÓDULOS
  // ============================================

  /**
   * Inicializa todos os módulos quando a view é carregada
   */
  function initModules() {
    // CRM
    if (window.CRMModule && !window.CRMModule._initialized) {
      window.CRMModule.init().then(() => {
        window.CRMModule._initialized = true;
        console.log('[WHL Fixes] CRM Module initialized');
      });
    }

    // Labels
    if (window.LabelsModule && !window.LabelsModule._initialized) {
      window.LabelsModule.init().then(() => {
        window.LabelsModule._initialized = true;
        console.log('[WHL Fixes] Labels Module initialized');
      });
    }

    // Tasks
    if (window.TasksModule && !window.TasksModule._initialized) {
      window.TasksModule.init().then(() => {
        window.TasksModule._initialized = true;
        console.log('[WHL Fixes] Tasks Module initialized');
      });
    }

    // Analytics
    if (window.AnalyticsModule && !window.AnalyticsModule._initialized) {
      window.AnalyticsModule.init().then(() => {
        window.AnalyticsModule._initialized = true;
        console.log('[WHL Fixes] Analytics Module initialized');
      });
    }

    // Smart Replies
    if (window.SmartRepliesModule && !window.SmartRepliesModule._initialized) {
      window.SmartRepliesModule.init().then(() => {
        window.SmartRepliesModule._initialized = true;
        console.log('[WHL Fixes] Smart Replies Module initialized');
      });
    }
  }

  // ============================================
  // CRM FIXES
  // ============================================

  /**
   * Inicializa a view do CRM com todos os eventos funcionais
   */
  function crmInit() {
    console.log('[WHL Fixes] Initializing CRM view...');

    // Inicializar módulos necessários
    if (window.CRMModule) window.CRMModule.init();
    if (window.LabelsModule) window.LabelsModule.init();

    // Renderizar Kanban
    const kanbanContainer = document.getElementById('crm_kanban_container');
    if (kanbanContainer && window.CRMModule) {
      window.CRMModule.renderKanban(kanbanContainer);
    }

    // Renderizar Labels
    const labelsContainer = document.getElementById('labels_manager_container');
    if (labelsContainer && window.LabelsModule) {
      window.LabelsModule.renderLabelManager(labelsContainer);
    }

    // Renderizar Atividades
    const activitiesContainer = document.getElementById('crm_activities_container');
    if (activitiesContainer && window.CRMModule) {
      window.CRMModule.renderActivities(activitiesContainer);
    }

    // Setup botões principais
    setupCRMButtons();
  }

  /**
   * Configura os botões do CRM
   */
  function setupCRMButtons() {
    // Botão Novo Deal
    const newDealBtn = document.getElementById('crm_new_deal');
    if (newDealBtn) {
      newDealBtn.onclick = null; // Remove handlers anteriores
      newDealBtn.addEventListener('click', () => {
        openNewDealModal();
      });
    }

    // Botão Novo Contato
    const newContactBtn = document.getElementById('crm_new_contact');
    if (newContactBtn) {
      newContactBtn.onclick = null;
      newContactBtn.addEventListener('click', () => {
        openNewContactModal();
      });
    }

    // Botão Refresh
    const refreshBtn = document.getElementById('crm_refresh');
    if (refreshBtn) {
      refreshBtn.onclick = null;
      refreshBtn.addEventListener('click', () => {
        crmInit(); // Re-renderiza tudo
        showToast('CRM atualizado!', 'success');
      });
    }

    // Botão Abrir Fullscreen (nova aba)
    const fullscreenBtn = document.getElementById('crm_open_fullscreen');
    if (fullscreenBtn) {
      fullscreenBtn.onclick = null;
      fullscreenBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          action: 'WHL_OPEN_POPUP_TAB',
          url: 'crm/crm.html'
        }).catch(() => {
          // Fallback: tentar abrir diretamente
          const url = chrome.runtime.getURL('crm/crm.html');
          window.open(url, '_blank');
        });
      });
    }
  }

  /**
   * Modal para novo Deal
   */
  function openNewDealModal() {
    const contacts = window.CRMModule?.getContacts() || [];
    const stages = window.CRMModule?.getPipeline()?.stages || [];

    const modal = document.createElement('div');
    modal.id = 'crm-new-deal-modal';
    modal.className = 'mod-modal-overlay';
    modal.innerHTML = `
      <div class="mod-modal" style="max-width:450px">
        <div class="mod-modal-header">
          <span class="mod-modal-title">➕ Novo Deal</span>
          <button class="mod-modal-close" id="close-deal-modal">×</button>
        </div>
        <form id="new-deal-form">
          <div style="display:grid;gap:12px">
            <div>
              <label class="mod-label">Título *</label>
              <input type="text" id="deal-title" class="mod-input" placeholder="Ex: Venda produto X" required>
            </div>
            <div>
              <label class="mod-label">Valor (R$)</label>
              <input type="number" id="deal-value" class="mod-input" placeholder="0.00" step="0.01" min="0">
            </div>
            <div>
              <label class="mod-label">Estágio</label>
              <select id="deal-stage" class="mod-input mod-select">
                ${stages.map(s => `<option value="${s.id}">${s.icon} ${s.name}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="mod-label">Contato Vinculado</label>
              <select id="deal-contact" class="mod-input mod-select">
                <option value="">-- Nenhum --</option>
                ${contacts.map(c => `<option value="${c.id}">${c.name || c.phone}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="mod-label">Notas</label>
              <textarea id="deal-notes" class="mod-input" rows="3" placeholder="Observações..."></textarea>
            </div>
            <div class="sp-row" style="margin-top:8px;gap:8px">
              <button type="button" class="mod-btn mod-btn-secondary" style="flex:1" id="cancel-deal-btn">Cancelar</button>
              <button type="submit" class="mod-btn mod-btn-primary" style="flex:1">➕ Criar Deal</button>
            </div>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    // Event handlers
    document.getElementById('close-deal-modal').addEventListener('click', () => modal.remove());
    document.getElementById('cancel-deal-btn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    document.getElementById('new-deal-form').addEventListener('submit', async e => {
      e.preventDefault();

      const data = {
        title: document.getElementById('deal-title').value.trim(),
        value: parseFloat(document.getElementById('deal-value').value) || 0,
        stageId: document.getElementById('deal-stage').value,
        contactId: document.getElementById('deal-contact').value || null,
        notes: document.getElementById('deal-notes').value.trim()
      };

      if (!data.title) {
        alert('Título é obrigatório');
        return;
      }

      try {
        await window.CRMModule.createDeal(data);
        modal.remove();
        crmInit(); // Refresh
        showToast('Deal criado com sucesso!', 'success');
      } catch (e) {
        showToast('Erro ao criar deal: ' + e.message, 'error');
      }
    });
  }

  /**
   * Modal para novo Contato
   */
  function openNewContactModal() {
    const stages = window.CRMModule?.getPipeline()?.stages || [];
    const labels = window.LabelsModule?.getLabels() || [];

    const modal = document.createElement('div');
    modal.id = 'crm-new-contact-modal';
    modal.className = 'mod-modal-overlay';
    modal.innerHTML = `
      <div class="mod-modal" style="max-width:450px">
        <div class="mod-modal-header">
          <span class="mod-modal-title">👤 Novo Contato</span>
          <button class="mod-modal-close" id="close-contact-modal">×</button>
        </div>
        <form id="new-contact-form">
          <div style="display:grid;gap:12px">
            <div>
              <label class="mod-label">Telefone *</label>
              <input type="text" id="contact-phone" class="mod-input" placeholder="5511999999999" required>
            </div>
            <div>
              <label class="mod-label">Nome</label>
              <input type="text" id="contact-name" class="mod-input" placeholder="Nome do contato">
            </div>
            <div>
              <label class="mod-label">Email</label>
              <input type="email" id="contact-email" class="mod-input" placeholder="email@exemplo.com">
            </div>
            <div>
              <label class="mod-label">Empresa</label>
              <input type="text" id="contact-company" class="mod-input" placeholder="Nome da empresa">
            </div>
            <div>
              <label class="mod-label">Estágio no Pipeline</label>
              <select id="contact-stage" class="mod-input mod-select">
                ${stages.map(s => `<option value="${s.id}">${s.icon} ${s.name}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="mod-label">Etiquetas</label>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
                ${labels.map(l => `
                  <label style="display:flex;align-items:center;gap:4px;padding:4px 8px;background:rgba(255,255,255,0.05);border-radius:6px;cursor:pointer;font-size:12px">
                    <input type="checkbox" class="contact-label-check" value="${l.id}">
                    <span style="color:${l.color}">${l.icon || '🏷️'}</span> ${l.name}
                  </label>
                `).join('')}
              </div>
            </div>
            <div>
              <label class="mod-label">Notas</label>
              <textarea id="contact-notes" class="mod-input" rows="2" placeholder="Observações..."></textarea>
            </div>
            <div class="sp-row" style="margin-top:8px;gap:8px">
              <button type="button" class="mod-btn mod-btn-secondary" style="flex:1" id="cancel-contact-btn">Cancelar</button>
              <button type="submit" class="mod-btn mod-btn-primary" style="flex:1">👤 Criar Contato</button>
            </div>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    // Event handlers
    document.getElementById('close-contact-modal').addEventListener('click', () => modal.remove());
    document.getElementById('cancel-contact-btn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    document.getElementById('new-contact-form').addEventListener('submit', async e => {
      e.preventDefault();

      const selectedLabels = Array.from(document.querySelectorAll('.contact-label-check:checked'))
        .map(cb => cb.value);

      const data = {
        phone: document.getElementById('contact-phone').value.trim().replace(/\D/g, ''),
        name: document.getElementById('contact-name').value.trim(),
        email: document.getElementById('contact-email').value.trim(),
        company: document.getElementById('contact-company').value.trim(),
        stage: document.getElementById('contact-stage').value,
        notes: document.getElementById('contact-notes').value.trim(),
        tags: selectedLabels
      };

      if (!data.phone || data.phone.length < 10) {
        alert('Telefone inválido');
        return;
      }

      try {
        const contact = await window.CRMModule.upsertContact(data);
        
        // Aplicar etiquetas
        for (const labelId of selectedLabels) {
          await window.LabelsModule.addLabelToContact(data.phone, labelId);
        }

        modal.remove();
        crmInit(); // Refresh
        showToast('Contato criado com sucesso!', 'success');

        // Mostrar opções de ação
        showContactActionsPopup(contact);
      } catch (e) {
        showToast('Erro ao criar contato: ' + e.message, 'error');
      }
    });
  }

  /**
   * Popup de ações para contato recém-criado
   */
  function showContactActionsPopup(contact) {
    const popup = document.createElement('div');
    popup.className = 'mod-modal-overlay';
    popup.id = 'contact-actions-popup';
    popup.innerHTML = `
      <div class="mod-modal" style="max-width:350px">
        <div class="mod-modal-header">
          <span class="mod-modal-title">✅ Contato Criado</span>
          <button class="mod-modal-close" onclick="this.closest('.mod-modal-overlay').remove()">×</button>
        </div>
        <div style="padding:16px;text-align:center">
          <div style="font-size:48px;margin-bottom:12px">👤</div>
          <div style="font-size:16px;font-weight:600;margin-bottom:4px">${escapeHtml(contact.name || 'Novo Contato')}</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.6);margin-bottom:16px">${contact.phone}</div>
          
          <div style="display:flex;gap:8px">
            <button class="mod-btn mod-btn-secondary" style="flex:1" id="action-view-contact">
              👁️ Ver Detalhes
            </button>
            <button class="mod-btn mod-btn-primary" style="flex:1" id="action-message-contact">
              💬 Enviar Mensagem
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(popup);

    popup.addEventListener('click', e => { if (e.target === popup) popup.remove(); });

    // Botão Ver Detalhes
    document.getElementById('action-view-contact').addEventListener('click', () => {
      popup.remove();
      showContactDetailsModal(contact);
    });

    // Botão Enviar Mensagem
    document.getElementById('action-message-contact').addEventListener('click', () => {
      popup.remove();
      openWhatsAppChat(contact.phone);
    });
  }

  /**
   * Modal de detalhes do contato
   */
  function showContactDetailsModal(contact) {
    const labels = window.LabelsModule?.getContactLabels(contact.phone) || [];
    const stage = window.CRMModule?.getStage(contact.stage);
    const activities = window.CRMModule?.getActivities({ contactId: contact.id })?.slice(0, 5) || [];

    const modal = document.createElement('div');
    modal.className = 'mod-modal-overlay';
    modal.id = 'contact-details-modal';
    modal.innerHTML = `
      <div class="mod-modal" style="max-width:500px;max-height:80vh;overflow-y:auto">
        <div class="mod-modal-header">
          <span class="mod-modal-title">👤 Detalhes do Contato</span>
          <button class="mod-modal-close" onclick="this.closest('.mod-modal-overlay').remove()">×</button>
        </div>
        <div style="padding:16px">
          <!-- Header do contato -->
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
            <div style="width:64px;height:64px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px">
              ${(contact.name || '?')[0].toUpperCase()}
            </div>
            <div style="flex:1">
              <div style="font-size:18px;font-weight:700">${escapeHtml(contact.name || 'Sem nome')}</div>
              <div style="font-size:14px;color:rgba(255,255,255,0.7)">${contact.phone}</div>
              ${contact.email ? `<div style="font-size:12px;color:rgba(255,255,255,0.5)">${contact.email}</div>` : ''}
            </div>
          </div>

          <!-- Info cards -->
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:16px">
            <div style="padding:12px;background:rgba(139,92,246,0.1);border-radius:8px">
              <div style="font-size:11px;color:rgba(255,255,255,0.5)">Estágio</div>
              <div style="font-size:14px;font-weight:600;color:${stage?.color || '#8b5cf6'}">${stage?.icon || '📋'} ${stage?.name || 'Novo'}</div>
            </div>
            <div style="padding:12px;background:rgba(59,130,246,0.1);border-radius:8px">
              <div style="font-size:11px;color:rgba(255,255,255,0.5)">Empresa</div>
              <div style="font-size:14px;font-weight:600">${escapeHtml(contact.company) || '-'}</div>
            </div>
          </div>

          <!-- Etiquetas -->
          ${labels.length > 0 ? `
            <div style="margin-bottom:16px">
              <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:8px">Etiquetas</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px">
                ${labels.map(l => `
                  <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:${hexToRgba(l.color, 0.2)};color:${l.color};border-radius:12px;font-size:12px">
                    ${l.icon || '🏷️'} ${l.name}
                  </span>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Notas -->
          ${contact.notes ? `
            <div style="margin-bottom:16px">
              <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:8px">Notas</div>
              <div style="padding:12px;background:rgba(0,0,0,0.2);border-radius:8px;font-size:13px">${escapeHtml(contact.notes)}</div>
            </div>
          ` : ''}

          <!-- Atividades recentes -->
          ${activities.length > 0 ? `
            <div style="margin-bottom:16px">
              <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:8px">Atividades Recentes</div>
              <div style="display:flex;flex-direction:column;gap:8px">
                ${activities.map(a => `
                  <div style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,255,255,0.03);border-radius:6px;font-size:12px">
                    <span>${getActivityIcon(a.type)}</span>
                    <span style="flex:1">${escapeHtml(a.content)}</span>
                    <span style="color:rgba(255,255,255,0.4)">${formatRelativeTime(a.createdAt)}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Ações -->
          <div style="display:flex;gap:8px;margin-top:20px">
            <button class="mod-btn mod-btn-primary" style="flex:1" id="detail-message-btn">
              💬 Enviar Mensagem
            </button>
            <button class="mod-btn mod-btn-secondary" id="detail-edit-btn">
              ✏️ Editar
            </button>
            <button class="mod-btn mod-btn-secondary" style="color:#ef4444" id="detail-delete-btn">
              🗑️
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    // Botão Enviar Mensagem
    document.getElementById('detail-message-btn').addEventListener('click', () => {
      modal.remove();
      openWhatsAppChat(contact.phone);
    });

    // Botão Editar
    document.getElementById('detail-edit-btn').addEventListener('click', () => {
      modal.remove();
      openEditContactModal(contact);
    });

    // Botão Excluir
    document.getElementById('detail-delete-btn').addEventListener('click', async () => {
      if (confirm(`Excluir contato "${contact.name || contact.phone}"?`)) {
        await window.CRMModule.deleteContact(contact.id);
        modal.remove();
        crmInit();
        showToast('Contato excluído', 'success');
      }
    });
  }

  /**
   * Modal para editar contato
   */
  function openEditContactModal(contact) {
    const stages = window.CRMModule?.getPipeline()?.stages || [];
    const allLabels = window.LabelsModule?.getLabels() || [];
    const contactLabels = window.LabelsModule?.getContactLabels(contact.phone) || [];
    const contactLabelIds = contactLabels.map(l => l.id);

    const modal = document.createElement('div');
    modal.className = 'mod-modal-overlay';
    modal.id = 'edit-contact-modal';
    modal.innerHTML = `
      <div class="mod-modal" style="max-width:450px">
        <div class="mod-modal-header">
          <span class="mod-modal-title">✏️ Editar Contato</span>
          <button class="mod-modal-close" onclick="this.closest('.mod-modal-overlay').remove()">×</button>
        </div>
        <form id="edit-contact-form">
          <div style="display:grid;gap:12px">
            <div>
              <label class="mod-label">Telefone</label>
              <input type="text" class="mod-input" value="${contact.phone}" disabled style="opacity:0.6">
            </div>
            <div>
              <label class="mod-label">Nome</label>
              <input type="text" id="edit-contact-name" class="mod-input" value="${escapeHtml(contact.name || '')}">
            </div>
            <div>
              <label class="mod-label">Email</label>
              <input type="email" id="edit-contact-email" class="mod-input" value="${escapeHtml(contact.email || '')}">
            </div>
            <div>
              <label class="mod-label">Empresa</label>
              <input type="text" id="edit-contact-company" class="mod-input" value="${escapeHtml(contact.company || '')}">
            </div>
            <div>
              <label class="mod-label">Estágio</label>
              <select id="edit-contact-stage" class="mod-input mod-select">
                ${stages.map(s => `<option value="${s.id}" ${contact.stage === s.id ? 'selected' : ''}>${s.icon} ${s.name}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="mod-label">Etiquetas</label>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
                ${allLabels.map(l => `
                  <label style="display:flex;align-items:center;gap:4px;padding:4px 8px;background:${contactLabelIds.includes(l.id) ? hexToRgba(l.color, 0.2) : 'rgba(255,255,255,0.05)'};border:1px solid ${contactLabelIds.includes(l.id) ? l.color : 'transparent'};border-radius:6px;cursor:pointer;font-size:12px;transition:all 0.2s">
                    <input type="checkbox" class="edit-label-check" value="${l.id}" ${contactLabelIds.includes(l.id) ? 'checked' : ''}>
                    <span style="color:${l.color}">${l.icon || '🏷️'}</span> ${l.name}
                  </label>
                `).join('')}
              </div>
            </div>
            <div>
              <label class="mod-label">Notas</label>
              <textarea id="edit-contact-notes" class="mod-input" rows="2">${escapeHtml(contact.notes || '')}</textarea>
            </div>
            <div class="sp-row" style="margin-top:8px;gap:8px">
              <button type="button" class="mod-btn mod-btn-secondary" style="flex:1" onclick="this.closest('.mod-modal-overlay').remove()">Cancelar</button>
              <button type="submit" class="mod-btn mod-btn-primary" style="flex:1">💾 Salvar</button>
            </div>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    // Estilizar checkboxes de labels
    modal.querySelectorAll('.edit-label-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const label = cb.closest('label');
        const labelData = allLabels.find(l => l.id === cb.value);
        if (cb.checked) {
          label.style.background = hexToRgba(labelData.color, 0.2);
          label.style.borderColor = labelData.color;
        } else {
          label.style.background = 'rgba(255,255,255,0.05)';
          label.style.borderColor = 'transparent';
        }
      });
    });

    document.getElementById('edit-contact-form').addEventListener('submit', async e => {
      e.preventDefault();

      const selectedLabels = Array.from(modal.querySelectorAll('.edit-label-check:checked'))
        .map(cb => cb.value);

      const data = {
        phone: contact.phone,
        name: document.getElementById('edit-contact-name').value.trim(),
        email: document.getElementById('edit-contact-email').value.trim(),
        company: document.getElementById('edit-contact-company').value.trim(),
        stage: document.getElementById('edit-contact-stage').value,
        notes: document.getElementById('edit-contact-notes').value.trim()
      };

      try {
        await window.CRMModule.upsertContact(data);
        
        // Atualizar etiquetas
        await window.LabelsModule.setContactLabels(contact.phone, selectedLabels);

        modal.remove();
        crmInit();
        showToast('Contato atualizado!', 'success');
      } catch (e) {
        showToast('Erro: ' + e.message, 'error');
      }
    });
  }

  /**
   * Abre chat no WhatsApp Web
   */
  function openWhatsAppChat(phone) {
    const cleanPhone = String(phone).replace(/\D/g, '');
    
    // Tentar usar API direta se disponível
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
      const waTab = tabs.find(t => t.url?.includes('web.whatsapp.com'));
      if (waTab) {
        chrome.tabs.sendMessage(waTab.id, {
          type: 'WHL_OPEN_CHAT',
          phone: cleanPhone
        }, response => {
          if (!response?.success) {
            // Fallback: abrir via URL
            window.open(`https://web.whatsapp.com/send?phone=${cleanPhone}`, '_blank');
          }
        });
      } else {
        window.open(`https://web.whatsapp.com/send?phone=${cleanPhone}`, '_blank');
      }
    });

    showToast('Abrindo conversa...', 'success');
  }

  // ============================================
  // TASKS FIXES
  // ============================================

  let currentTasksFilter = 'all';
  let _tasksBusBound = false;

  /**
   * Inicializa a view de Tasks
   */
  function tasksInit() {
    console.log('[WHL Fixes] Initializing Tasks view...');

    // v9.6.x — re-render automático ao criar/editar/concluir/remover.
    // Antes nada escutava os eventos do TasksModule e a UI ficava parada
    // depois do "Salvar" no modal. _tasksBusBound garante idempotência caso
    // tasksInit seja chamado múltiplas vezes.
    if (!_tasksBusBound && window.EventBus) {
      window.EventBus.on('tasks:changed', () => {
        const open = document.getElementById('tasks_container');
        if (!open || open.offsetParent === null) return; // view não está visível
        renderTasksView();
      });
      _tasksBusBound = true;
    }

    if (window.TasksModule) {
      window.TasksModule.init();
    }

    renderTasksView();
  }

  /**
   * Renderiza a view de Tasks completa
   */
  function renderTasksView() {
    const container = document.getElementById('tasks_container');
    if (!container) return;

    const stats = window.TasksModule?.getStats() || { total: 0, pending: 0, completed: 0, overdue: 0 };

    // Atualizar stats no header
    const statTotal = document.getElementById('stat_total');
    const statPending = document.getElementById('stat_pending');
    const statOverdue = document.getElementById('stat_overdue');
    const statCompleted = document.getElementById('stat_completed');

    if (statTotal) statTotal.textContent = stats.total;
    if (statPending) statPending.textContent = stats.pending;
    if (statOverdue) statOverdue.textContent = stats.overdue;
    if (statCompleted) statCompleted.textContent = stats.completed;

    // Renderizar container com filtros e lista
    container.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
        <button class="mod-btn ${currentTasksFilter === 'all' ? 'mod-btn-primary' : 'mod-btn-secondary'} mod-btn-sm task-filter-btn" data-filter="all">
          📋 Todas (${stats.total})
        </button>
        <button class="mod-btn ${currentTasksFilter === 'pending' ? 'mod-btn-primary' : 'mod-btn-secondary'} mod-btn-sm task-filter-btn" data-filter="pending">
          ⏳ Pendentes (${stats.pending})
        </button>
        <button class="mod-btn ${currentTasksFilter === 'overdue' ? 'mod-btn-primary' : 'mod-btn-secondary'} mod-btn-sm task-filter-btn" data-filter="overdue" style="${stats.overdue > 0 ? 'color:#ef4444;border-color:#ef4444' : ''}">
          🔴 Atrasadas (${stats.overdue})
        </button>
        <button class="mod-btn ${currentTasksFilter === 'completed' ? 'mod-btn-primary' : 'mod-btn-secondary'} mod-btn-sm task-filter-btn" data-filter="completed">
          ✅ Concluídas (${stats.completed})
        </button>
      </div>
      
      <button class="mod-btn mod-btn-primary" id="new-task-btn" style="width:100%;margin-bottom:16px">
        ➕ Nova Tarefa
      </button>
      
      <div id="tasks-list-container"></div>
    `;

    // Setup filter buttons
    container.querySelectorAll('.task-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentTasksFilter = btn.dataset.filter;
        // Atualizar visual dos botões
        container.querySelectorAll('.task-filter-btn').forEach(b => {
          b.classList.remove('mod-btn-primary');
          b.classList.add('mod-btn-secondary');
        });
        btn.classList.remove('mod-btn-secondary');
        btn.classList.add('mod-btn-primary');
        // Re-renderizar lista
        renderTasksList();
      });
    });

    // Setup new task button
    document.getElementById('new-task-btn').addEventListener('click', () => {
      if (window.TasksModule) {
        window.TasksModule.openTaskModal();
      }
    });

    // Renderizar lista inicial
    renderTasksList();
  }

  /**
   * Renderiza apenas a lista de tasks (para refresh)
   */
  function renderTasksList() {
    const listContainer = document.getElementById('tasks-list-container');
    if (!listContainer || !window.TasksModule) return;

    let tasks = [];
    
    if (currentTasksFilter === 'overdue') {
      tasks = window.TasksModule.getOverdueTasks();
    } else if (currentTasksFilter === 'pending') {
      tasks = window.TasksModule.getTasks({ status: 'pending' });
    } else if (currentTasksFilter === 'completed') {
      tasks = window.TasksModule.getTasks({ status: 'completed' });
    } else {
      tasks = window.TasksModule.getTasks();
    }

    if (tasks.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align:center;padding:32px;color:rgba(255,255,255,0.5)">
          <div style="font-size:48px;margin-bottom:12px">📭</div>
          <div>Nenhuma tarefa ${currentTasksFilter === 'overdue' ? 'atrasada' : currentTasksFilter === 'pending' ? 'pendente' : currentTasksFilter === 'completed' ? 'concluída' : ''}</div>
        </div>
      `;
      return;
    }

    const priorityInfo = window.TasksModule.TASK_PRIORITY;
    const typeInfo = window.TasksModule.TASK_TYPES;

    listContainer.innerHTML = tasks.map(task => {
      const priority = Object.values(priorityInfo).find(p => p.id === task.priority) || priorityInfo.MEDIUM;
      const taskType = Object.values(typeInfo).find(t => t.id === task.type) || typeInfo.OTHER;
      const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed';
      const isCompleted = task.status === 'completed';

      return `
        <div class="whl-task-item" data-task-id="${task.id}" style="
          display:flex;
          align-items:flex-start;
          gap:12px;
          padding:14px;
          background:${isCompleted ? 'rgba(16,185,129,0.05)' : isOverdue ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.03)'};
          border-radius:10px;
          margin-bottom:10px;
          border-left:3px solid ${isCompleted ? '#10b981' : isOverdue ? '#ef4444' : priority.color};
          transition:all 0.2s;
        ">
          <button class="task-toggle-complete" data-task-id="${task.id}" style="
            width:24px;
            height:24px;
            border-radius:50%;
            border:2px solid ${isCompleted ? '#10b981' : priority.color};
            background:${isCompleted ? '#10b981' : 'transparent'};
            cursor:pointer;
            display:flex;
            align-items:center;
            justify-content:center;
            flex-shrink:0;
            margin-top:2px;
          ">${isCompleted ? '✓' : ''}</button>
          
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-size:14px">${taskType.icon}</span>
              <span style="font-size:14px;font-weight:600;${isCompleted ? 'text-decoration:line-through;opacity:0.6' : ''}">${escapeHtml(task.title)}</span>
              <span style="font-size:10px;padding:2px 6px;border-radius:8px;background:${hexToRgba(priority.color, 0.2)};color:${priority.color}">${priority.icon}</span>
            </div>
            
            ${task.description ? `<div style="font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:6px;${isCompleted ? 'opacity:0.5' : ''}">${escapeHtml(task.description)}</div>` : ''}
            
            <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:11px;color:rgba(255,255,255,0.5)">
              ${task.dueDate ? `
                <span style="${isOverdue && !isCompleted ? 'color:#ef4444' : ''}">
                  📅 ${formatTaskDate(task.dueDate)}
                </span>
              ` : ''}
              ${task.contactName || task.contactPhone ? `
                <span>👤 ${escapeHtml(task.contactName || task.contactPhone)}</span>
              ` : ''}
            </div>
          </div>
          
          <div style="display:flex;gap:4px">
            <button class="task-edit-btn" data-task-id="${task.id}" style="padding:6px;background:rgba(255,255,255,0.05);border:none;border-radius:6px;cursor:pointer;color:rgba(255,255,255,0.7)">✏️</button>
            <button class="task-delete-btn" data-task-id="${task.id}" style="padding:6px;background:rgba(255,255,255,0.05);border:none;border-radius:6px;cursor:pointer;color:rgba(255,255,255,0.7)">🗑️</button>
          </div>
        </div>
      `;
    }).join('');

    // Setup event handlers
    listContainer.querySelectorAll('.task-toggle-complete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const taskId = btn.dataset.taskId;
        const task = window.TasksModule.getTask(taskId);
        if (task) {
          if (task.status === 'completed') {
            await window.TasksModule.updateTask(taskId, { status: 'pending' });
          } else {
            await window.TasksModule.completeTask(taskId);
          }
          renderTasksView();
        }
      });
    });

    listContainer.querySelectorAll('.task-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        window.TasksModule.openTaskModal(btn.dataset.taskId);
      });
    });

    listContainer.querySelectorAll('.task-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const taskId = btn.dataset.taskId;
        const task = window.TasksModule.getTask(taskId);
        if (task && confirm(`Excluir tarefa "${task.title}"?`)) {
          await window.TasksModule.deleteTask(taskId);
          renderTasksView();
          showToast('Tarefa excluída', 'success');
        }
      });
    });
  }

  // ============================================
  // ANALYTICS FIXES
  // ============================================

  function analyticsInit() {
    console.log('[WHL Fixes] Initializing Analytics view...');

    if (window.AnalyticsModule) {
      window.AnalyticsModule.init();
    }

    const container = document.getElementById('analytics_dashboard_container');
    if (container && window.AnalyticsModule) {
      window.AnalyticsModule.renderDashboard(container);
    }

    // Setup buttons (evitar duplicação com flag)
    const refreshBtn = document.getElementById('analytics_refresh');
    if (refreshBtn && !refreshBtn.dataset.whlBound) {
      refreshBtn.dataset.whlBound = 'true';
      refreshBtn.addEventListener('click', () => {
        if (window.AnalyticsModule) {
          window.AnalyticsModule.renderDashboard(container);
          showToast('Métricas atualizadas!', 'success');
        }
      });
    }

    const exportBtn = document.getElementById('analytics_export');
    if (exportBtn && !exportBtn.dataset.whlBound) {
      exportBtn.dataset.whlBound = 'true';
      exportBtn.addEventListener('click', () => {
        if (window.AnalyticsModule) {
          const data = window.AnalyticsModule.exportData();
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `analytics_${new Date().toISOString().split('T')[0]}.json`;
          a.click();
          URL.revokeObjectURL(url);
          showToast('Dados exportados!', 'success');
        }
      });
    }

    const resetBtn = document.getElementById('analytics_reset');
    if (resetBtn && !resetBtn.dataset.whlBound) {
      resetBtn.dataset.whlBound = 'true';
      resetBtn.addEventListener('click', async () => {
        if (confirm('Resetar todas as métricas? Esta ação não pode ser desfeita.')) {
          await window.AnalyticsModule.resetAll();
          window.AnalyticsModule.renderDashboard(container);
          showToast('Métricas resetadas', 'success');
        }
      });
    }
  }

  // ============================================
  // AI/SMART REPLIES FIXES
  // ============================================

  function aiInit() {
    console.log('[WHL Fixes] Initializing AI view...');

    if (window.SmartRepliesModule) {
      window.SmartRepliesModule.init();
    }

    // Renderizar configurações
    const settingsContainer = document.getElementById('smart_replies_settings_container');
    if (settingsContainer && window.SmartRepliesModule) {
      window.SmartRepliesModule.renderSettings(settingsContainer);
    }

    // Renderizar quick replies
    const quickRepliesContainer = document.getElementById('quick_replies_container');
    if (quickRepliesContainer && window.SmartRepliesModule) {
      window.SmartRepliesModule.renderQuickReplies(quickRepliesContainer);
    }

    // Fix: texto do output - cor branca
    fixAIOutputStyle();

    // Setup test buttons
    setupAITestButtons();
  }

  /**
   * Corrige o estilo do output da IA (texto preto para branco)
   */
  function fixAIOutputStyle() {
    const output = document.getElementById('ai_test_output');
    const result = document.getElementById('ai_test_result');

    if (output) {
      output.style.color = 'white';
    }
    if (result) {
      result.style.color = 'white';
    }

    // Adicionar CSS global para garantir
    if (!document.getElementById('ai-output-fix-styles')) {
      const style = document.createElement('style');
      style.id = 'ai-output-fix-styles';
      style.textContent = `
        #ai_test_output,
        #ai_test_output *,
        #ai_test_result,
        #ai_test_result * {
          color: white !important;
        }
        #ai_test_output {
          background: rgba(139, 92, 246, 0.1) !important;
        }
      `;
      document.head.appendChild(style);
    }
  }

  /**
   * Configura botões de teste da IA
   */
  function setupAITestButtons() {
    const testBtn = document.getElementById('ai_test_btn');
    const correctBtn = document.getElementById('ai_correct_btn');
    const input = document.getElementById('ai_test_input');
    const output = document.getElementById('ai_test_output');
    const result = document.getElementById('ai_test_result');

    if (testBtn && input && output && result) {
      testBtn.onclick = null;
      testBtn.addEventListener('click', async () => {
        const text = input.value.trim();
        if (!text) {
          showToast('Digite uma mensagem para testar', 'warning');
          return;
        }

        testBtn.disabled = true;
        testBtn.textContent = '⏳ Gerando...';
        output.style.display = 'block';
        result.textContent = 'Aguarde...';
        result.style.color = 'white';

        try {
          if (!window.SmartRepliesModule?.isConfigured()) {
            throw new Error('Plano sem créditos suficientes. Faça upgrade ou aguarde renovação.');
          }

          const response = await window.SmartRepliesModule.generateReply(text);
          result.textContent = response;
          result.style.color = 'white';
        } catch (e) {
          result.textContent = '❌ ' + (e.message || 'Erro desconhecido');
          result.style.color = '#ef4444';
        }

        testBtn.disabled = false;
        testBtn.textContent = '🚀 Gerar Resposta';
      });
    }

    if (correctBtn && input && output && result) {
      correctBtn.onclick = null;
      correctBtn.addEventListener('click', async () => {
        const text = input.value.trim();
        if (!text) {
          showToast('Digite um texto para corrigir', 'warning');
          return;
        }

        correctBtn.disabled = true;
        correctBtn.textContent = '⏳...';
        output.style.display = 'block';
        result.textContent = 'Corrigindo...';
        result.style.color = 'white';

        try {
          if (!window.SmartRepliesModule?.isConfigured()) {
            throw new Error('Plano sem créditos suficientes. Faça upgrade ou aguarde renovação.');
          }

          const corrected = await window.SmartRepliesModule.correctText(text);
          result.textContent = corrected;
          result.style.color = 'white';
        } catch (e) {
          result.textContent = '❌ ' + (e.message || 'Erro desconhecido');
          result.style.color = '#ef4444';
        }

        correctBtn.disabled = false;
        correctBtn.textContent = '✏️ Corrigir Texto';
      });
    }
  }

  // ============================================
  // HELPERS
  // ============================================

  function escapeHtml(str) {
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(str);
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function hexToRgba(hex, alpha) {
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

  function formatRelativeTime(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Agora';
    if (diffMins < 60) return `${diffMins}min`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString('pt-BR');
  }

  function formatTaskDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const tomorrow = new Date(now.setDate(now.getDate() + 1)).toISOString().split('T')[0];
    const dateOnly = dateStr.split('T')[0];

    if (dateOnly === today) return 'Hoje ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (dateOnly === tomorrow) return 'Amanhã ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  function getActivityIcon(type) {
    const icons = {
      note: '📝',
      call: '📞',
      message: '💬',
      email: '📧',
      meeting: '📅',
      deal_created: '🎯',
      deal_moved: '📊',
      stage_change: '🔄',
      task: '✅'
    };
    return icons[type] || '📋';
  }

  function showToast(message, type = 'info') {
    if (window.NotificationsModule) {
      window.NotificationsModule.toast(message, type, 3000);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  }

  // ============================================
  // VIEW ROUTER HOOK
  // ============================================

  // Override do showView original para incluir inicializações
  const originalShowView = window.showView;
  
  window.whlShowView = function(viewName) {
    console.log('[WHL Fixes] Showing view:', viewName);

    // Inicializar módulos
    initModules();

    // Inicializações específicas por view
    setTimeout(() => {
      switch (viewName) {
        case 'crm':
          crmInit();
          break;
        case 'tasks':
          tasksInit();
          break;
        case 'analytics':
          analyticsInit();
          break;
        case 'ai':
          aiInit();
          break;
      }
    }, 100);
  };

  // Escutar mudanças de view via storage
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.whl_active_view) {
      const newView = changes.whl_active_view.newValue;
      window.whlShowView(newView);
    }
  });

  // Inicializar quando documento estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(initModules, 500);
    });
  } else {
    setTimeout(initModules, 500);
  }

  // Exportar funções para uso global
  window.WHL_Fixes = {
    crmInit,
    tasksInit,
    analyticsInit,
    aiInit,
    openNewDealModal,
    openNewContactModal,
    showContactDetailsModal,
    openWhatsAppChat,
    renderTasksView,
    initModules
  };

  console.log('[WHL Fixes] Correções carregadas');

})();
