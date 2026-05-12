/**
 * Exemplo de Integração do ContactManager com UI
 * Adicione este código ao sidepanel-handlers.js ou crie um novo módulo de UI
 */

(function() {
  'use strict';

  // ============================================
  // FUNÇÕES DE UI PARA CONTACTMANAGER
  // ============================================

  /**
   * Renderiza interface de gerenciamento de contatos
   */
  function renderContactManager(container) {
    if (!window.ContactManager) {
      container.innerHTML = '<p style="color:red">ContactManager não carregado</p>';
      return;
    }

    const cm = window.ContactManager;
    const stats = cm.getStats();

    container.innerHTML = `
      <div class="contact-manager-ui">
        <!-- Header Stats -->
        <div style="display:flex;gap:12px;margin-bottom:20px;">
          <div class="stat-card">
            <div class="stat-value">${stats.totalContacts}</div>
            <div class="stat-label">Total Contatos</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${stats.blacklisted}</div>
            <div class="stat-label">🚫 Blacklist</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${stats.whitelisted}</div>
            <div class="stat-label">⭐ Whitelist</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${stats.totalTags}</div>
            <div class="stat-label">🏷️ Tags</div>
          </div>
        </div>

        <!-- Actions -->
        <div style="display:flex;gap:8px;margin-bottom:20px;">
          <button id="cm-import-csv" class="mod-btn mod-btn-primary">
            📥 Importar CSV
          </button>
          <button id="cm-export-csv" class="mod-btn mod-btn-secondary">
            📤 Exportar CSV
          </button>
          <button id="cm-sync-crm" class="mod-btn mod-btn-secondary">
            🔄 Sincronizar CRM
          </button>
          <button id="cm-show-blacklist" class="mod-btn mod-btn-secondary">
            🚫 Ver Blacklist
          </button>
        </div>

        <!-- Search -->
        <div style="margin-bottom:20px;">
          <input 
            type="text" 
            id="cm-search" 
            placeholder="Buscar contatos..."
            style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;"
          />
        </div>

        <!-- Filter Tags -->
        <div id="cm-tags-filter" style="margin-bottom:20px;display:flex;flex-wrap:wrap;gap:8px;">
          <!-- Tags will be rendered here -->
        </div>

        <!-- Contacts List -->
        <div id="cm-contacts-list">
          <!-- Contacts will be rendered here -->
        </div>
      </div>
    `;

    // Setup event listeners
    setupContactManagerEvents(container);
    renderContactsList(container);
    renderTagsFilter(container);
  }

  /**
   * Setup event listeners
   */
  function setupContactManagerEvents(container) {
    const cm = window.ContactManager;

    // Import CSV
    container.querySelector('#cm-import-csv')?.addEventListener('click', () => {
      showImportCSVModal();
    });

    // Export CSV
    container.querySelector('#cm-export-csv')?.addEventListener('click', () => {
      exportContactsToCSV();
    });

    // Sync CRM
    container.querySelector('#cm-sync-crm')?.addEventListener('click', async () => {
      const btn = container.querySelector('#cm-sync-crm');
      btn.disabled = true;
      btn.textContent = '🔄 Sincronizando...';
      
      const result = await cm.syncWithCRM();
      
      if (window.NotificationsModule) {
        window.NotificationsModule.success(`${result.synced} contatos sincronizados`);
      }
      
      btn.disabled = false;
      btn.textContent = '🔄 Sincronizar CRM';
      renderContactManager(container);
    });

    // Show Blacklist
    container.querySelector('#cm-show-blacklist')?.addEventListener('click', () => {
      showBlacklistModal();
    });

    // Search
    let searchTimeout;
    container.querySelector('#cm-search')?.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const query = e.target.value;
        if (query.length >= 2) {
          renderContactsList(container, { search: query });
        } else {
          renderContactsList(container);
        }
      }, 300);
    });
  }

  /**
   * Render contacts list
   */
  function renderContactsList(container, options = {}) {
    const cm = window.ContactManager;
    const listContainer = container.querySelector('#cm-contacts-list');
    
    let contacts;
    if (options.search) {
      contacts = cm.searchContacts(options.search);
    } else if (options.filter) {
      contacts = cm.filterContacts(options.filter);
    } else {
      const result = cm.listContacts({ page: 1, limit: 50 });
      contacts = result.contacts;
    }

    if (contacts.length === 0) {
      listContainer.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5)">Nenhum contato encontrado</p>';
      return;
    }

    listContainer.innerHTML = contacts.map(contact => {
      // FIX HIGH XSS: contact.phone vem do extractor — pode conter caracteres HTML
      // se o usuário do WhatsApp tiver formatação maliciosa no número/nome
      const safePhone = escapeHtml(String(contact.phone || ''));
      return `
      <div class="contact-item" style="padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;margin-bottom:8px;" data-phone="${safePhone}">
        <div style="display:flex;justify-content:space-between;align-items:start;">
          <div style="flex:1;">
            <div style="font-weight:600;color:white;margin-bottom:4px;">
              ${escapeHtml(contact.name || contact.phone)}
            </div>
            <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:4px;">
              📞 ${safePhone}
            </div>
            ${contact.email ? `<div style="font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:4px;">📧 ${escapeHtml(contact.email)}</div>` : ''}
            ${contact.tags && contact.tags.length > 0 ? `
              <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;">
                ${contact.tags.map(tag => `
                  <span style="font-size:11px;padding:2px 8px;background:rgba(139,92,246,0.2);color:#a78bfa;border-radius:12px;">
                    ${escapeHtml(tag)}
                  </span>
                `).join('')}
              </div>
            ` : ''}
            ${contact.messageCount ? `
              <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:4px;">
                💬 ${contact.messageCount} mensagens
                ${contact.lastInteraction ? ` • Última: ${new Date(contact.lastInteraction).toLocaleDateString('pt-BR')}` : ''}
              </div>
            ` : ''}
          </div>
          <div style="display:flex;gap:4px;">
            <button class="contact-edit" data-phone="${safePhone}" style="padding:6px;background:rgba(255,255,255,0.1);border:none;border-radius:6px;cursor:pointer;">✏️</button>
            <button class="contact-blacklist" data-phone="${safePhone}" style="padding:6px;background:rgba(255,255,255,0.1);border:none;border-radius:6px;cursor:pointer;">🚫</button>
          </div>
        </div>
      </div>
    `;}).join('');

    // Setup contact item events
    listContainer.querySelectorAll('.contact-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const phone = btn.dataset.phone;
        showEditContactModal(phone);
      });
    });

    listContainer.querySelectorAll('.contact-blacklist').forEach(btn => {
      btn.addEventListener('click', async () => {
        const phone = btn.dataset.phone;
        
        // Use WHLModal if available, fallback to native prompt
        let reason;
        if (window.WHLModal?.prompt) {
          reason = await window.WHLModal.prompt('Motivo do bloqueio:', '', 'Bloquear Contato');
        } else {
          reason = prompt('Motivo do bloqueio:');
        }
        
        if (reason !== null) {
          cm.addToBlacklist(phone, reason);
          if (window.NotificationsModule) {
            window.NotificationsModule.success('Contato adicionado à blacklist');
          }
          renderContactsList(container, options);
        }
      });
    });
  }

  /**
   * Render tags filter
   */
  function renderTagsFilter(container) {
    const cm = window.ContactManager;
    const tags = cm.listTags();
    const tagsContainer = container.querySelector('#cm-tags-filter');

    if (tags.length === 0) return;

    tagsContainer.innerHTML = tags.slice(0, 10).map(t => `
      <button class="tag-filter-btn" data-tag="${escapeHtml(t.tag)}" style="
        padding:6px 12px;
        background:rgba(139,92,246,0.2);
        border:1px solid rgba(139,92,246,0.3);
        border-radius:20px;
        color:#a78bfa;
        cursor:pointer;
        font-size:12px;
      ">
        ${escapeHtml(t.tag)} (${t.count})
      </button>
    `).join('');

    tagsContainer.querySelectorAll('.tag-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.tag;
        renderContactsList(container, { filter: { tags: [tag] } });
      });
    });
  }

  /**
   * Show import CSV modal
   */
  function showImportCSVModal() {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:10000;';
    
    modal.innerHTML = `
      <div style="background:#1a1a2e;border-radius:16px;padding:24px;width:90%;max-width:500px;">
        <h3 style="margin:0 0 16px;color:white;">📥 Importar Contatos CSV</h3>
        
        <div style="margin-bottom:16px;">
          <label style="display:block;margin-bottom:8px;color:rgba(255,255,255,0.8);">Arquivo CSV:</label>
          <input type="file" id="csv-file-input" accept=".csv,.txt" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;">
        </div>

        <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:16px;">
          Formato esperado: telefone,nome,email,tags<br>
          Exemplo: 5511987654321,João Silva,joao@example.com,cliente;vip
        </div>

        <div style="display:flex;gap:8px;">
          <button id="modal-cancel" style="flex:1;padding:12px;background:rgba(255,255,255,0.1);border:none;border-radius:8px;color:white;cursor:pointer;">Cancelar</button>
          <button id="modal-import" style="flex:1;padding:12px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);border:none;border-radius:8px;color:white;font-weight:600;cursor:pointer;">Importar</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#modal-cancel').addEventListener('click', () => modal.remove());
    
    modal.querySelector('#modal-import').addEventListener('click', async () => {
      const fileInput = modal.querySelector('#csv-file-input');
      const file = fileInput.files[0];
      
      if (!file) {
        alert('Selecione um arquivo CSV');
        return;
      }

      const content = await file.text();
      const result = await window.ContactManager.importFromCSV(content);
      
      modal.remove();
      
      if (window.NotificationsModule) {
        window.NotificationsModule.success(`Importados: ${result.imported}, Duplicados: ${result.duplicates}`);
      }
      
      // Refresh UI
      const container = document.querySelector('.contact-manager-ui')?.parentElement;
      if (container) renderContactManager(container);
    });
  }

  /**
   * Export contacts to CSV
   */
  function exportContactsToCSV() {
    const cm = window.ContactManager;
    const csv = cm.exportToCSV();
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contatos-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    if (window.NotificationsModule) {
      window.NotificationsModule.success('Contatos exportados com sucesso');
    }
  }

  /**
   * Show blacklist modal
   */
  function showBlacklistModal() {
    const cm = window.ContactManager;
    const blacklist = cm.listBlacklist();
    
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:10000;';
    
    modal.innerHTML = `
      <div style="background:#1a1a2e;border-radius:16px;padding:24px;width:90%;max-width:600px;max-height:80vh;overflow-y:auto;">
        <h3 style="margin:0 0 16px;color:white;">🚫 Blacklist (${blacklist.length})</h3>
        
        ${blacklist.length === 0 ? 
          '<p style="text-align:center;color:rgba(255,255,255,0.5)">Nenhum número bloqueado</p>' :
          blacklist.map(item => `
            <div style="padding:12px;background:rgba(255,68,68,0.1);border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-weight:600;color:white;">${item.contact?.name || item.phone}</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.6);">${item.phone}</div>
                ${item.contact?.blacklistReason ? `<div style="font-size:11px;color:rgba(255,68,68,0.8);margin-top:4px;">Motivo: ${escapeHtml(item.contact.blacklistReason)}</div>` : ''}
              </div>
              <button class="unblock-btn" data-phone="${item.phone}" style="padding:6px 12px;background:rgba(255,255,255,0.1);border:none;border-radius:6px;color:white;cursor:pointer;">Desbloquear</button>
            </div>
          `).join('')
        }
        
        <button id="close-blacklist" style="width:100%;margin-top:16px;padding:12px;background:rgba(255,255,255,0.1);border:none;border-radius:8px;color:white;cursor:pointer;">Fechar</button>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#close-blacklist').addEventListener('click', () => modal.remove());
    
    modal.querySelectorAll('.unblock-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const phone = btn.dataset.phone;
        cm.removeFromBlacklist(phone);
        if (window.NotificationsModule) {
          window.NotificationsModule.success('Contato desbloqueado');
        }
        modal.remove();
        showBlacklistModal(); // Reabrir para atualizar
      });
    });
  }

  /**
   * Show edit contact modal
   */
  function showEditContactModal(phone) {
    const cm = window.ContactManager;
    const contact = cm.getContact(phone);
    
    if (!contact) {
      alert('Contato não encontrado');
      return;
    }

    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:10000;';
    
    modal.innerHTML = `
      <div style="background:#1a1a2e;border-radius:16px;padding:24px;width:90%;max-width:500px;">
        <h3 style="margin:0 0 16px;color:white;">✏️ Editar Contato</h3>
        
        <form id="edit-contact-form">
          <div style="margin-bottom:12px;">
            <label style="display:block;margin-bottom:4px;color:rgba(255,255,255,0.8);">Nome:</label>
            <input type="text" id="contact-name" value="${escapeHtml(contact.name || '')}" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;">
          </div>
          
          <div style="margin-bottom:12px;">
            <label style="display:block;margin-bottom:4px;color:rgba(255,255,255,0.8);">Email:</label>
            <input type="email" id="contact-email" value="${escapeHtml(contact.email || '')}" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;">
          </div>
          
          <div style="margin-bottom:12px;">
            <label style="display:block;margin-bottom:4px;color:rgba(255,255,255,0.8);">Tags (separadas por vírgula):</label>
            <input type="text" id="contact-tags" value="${(contact.tags || []).join(',')}" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;">
          </div>
          
          <div style="display:flex;gap:8px;margin-top:16px;">
            <button type="button" id="modal-cancel" style="flex:1;padding:12px;background:rgba(255,255,255,0.1);border:none;border-radius:8px;color:white;cursor:pointer;">Cancelar</button>
            <button type="submit" style="flex:1;padding:12px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);border:none;border-radius:8px;color:white;font-weight:600;cursor:pointer;">Salvar</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#modal-cancel').addEventListener('click', () => modal.remove());
    
    modal.querySelector('#edit-contact-form').addEventListener('submit', (e) => {
      e.preventDefault();
      
      const name = modal.querySelector('#contact-name').value;
      const email = modal.querySelector('#contact-email').value;
      const tagsStr = modal.querySelector('#contact-tags').value;
      const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
      
      cm.updateContact(phone, { name, email, tags });
      
      modal.remove();
      
      if (window.NotificationsModule) {
        window.NotificationsModule.success('Contato atualizado');
      }
      
      // Refresh UI
      const container = document.querySelector('.contact-manager-ui')?.parentElement;
      if (container) renderContactManager(container);
    });
  }

  function escapeHtml(str) {
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(str);
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Expor funções globalmente
  window.renderContactManager = renderContactManager;

  console.log('[ContactManager UI] Funções de UI carregadas');

})();
