/**
 * 👥 Team System UI - Interface de Membros da Equipe (CORRIGIDO)
 *
 * Renderiza a lista de membros no sidepanel.
 *
 * @version 2.0.0 - CORRIGIDO
 */

(function() {
  'use strict';

  if (window.__TEAM_SYSTEM_UI_FIXED__) return;
  window.__TEAM_SYSTEM_UI_FIXED__ = true;

  const DEBUG = localStorage.getItem('whl_debug') === 'true';
  function log(...args) { if (DEBUG) console.log('[TeamUI]', ...args); }

  const STORAGE_KEY = 'whl_team_system_v1';

  // ============================================
  // ESTADO
  // ============================================

  let state = {
    members: [],
    currentUser: null,
    initialized: false
  };

  // ============================================
  // PERSISTÊNCIA
  // ============================================

  async function loadState() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        state = { ...state, ...result[STORAGE_KEY] };
      }

      // Criar usuário padrão se não existir
      if (!state.members || state.members.length === 0) {
        state.members = [{
          id: 'default_user',
          name: 'Usuário Principal',
          email: '',
          role: 'admin',
          status: 'available',
          avatar: '👤',
          joinedAt: Date.now()
        }];
        state.currentUser = state.members[0];
        await saveState();
      }

      if (!state.currentUser && state.members.length > 0) {
        state.currentUser = state.members[0];
      }

      log('Estado carregado:', state.members.length, 'membros');
    } catch (e) {
      console.error('[TeamUI] Erro ao carregar:', e);
    }
  }

  async function saveState() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    } catch (e) {
      console.error('[TeamUI] Erro ao salvar:', e);
    }
  }

  // ============================================
  // RENDERIZAÇÃO
  // ============================================

  function renderMembersList() {
    const container = document.getElementById('team-members-list');
    if (!container) {
      log('Container team-members-list não encontrado');
      return;
    }

    if (!state.members || state.members.length === 0) {
      container.innerHTML = `
        <div style="padding: 20px; text-align: center; color: rgba(255,255,255,0.5);">
          <div style="font-size: 32px; margin-bottom: 8px;">👥</div>
          <div>Nenhum membro cadastrado</div>
        </div>
      `;
      return;
    }

    const statusIcons = {
      available: '🟢',
      busy: '🟡',
      away: '🔴',
      offline: '⚫'
    };

    const roleLabels = {
      admin: { name: 'Admin', color: '#ef4444' },
      manager: { name: 'Gerente', color: '#f59e0b' },
      agent: { name: 'Agente', color: '#10b981' },
      viewer: { name: 'Visualizador', color: '#6b7280' }
    };

    container.innerHTML = state.members.map(member => {
      const isCurrentUser = state.currentUser?.id === member.id;
      const role = roleLabels[member.role] || roleLabels.agent;
      const statusIcon = statusIcons[member.status] || '⚫';

      return `
        <div class="team-member-card ${isCurrentUser ? 'current' : ''}" data-member-id="${escapeHtml(member.id)}" style="
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          background: ${isCurrentUser ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255, 255, 255, 0.03)'};
          border: 1px solid ${isCurrentUser ? 'rgba(139, 92, 246, 0.4)' : 'rgba(255, 255, 255, 0.08)'};
          border-radius: 10px;
          margin-bottom: 8px;
          cursor: pointer;
          transition: all 0.2s;
        ">
          <div style="font-size: 28px;">${escapeHtml(member.avatar || '👤')}</div>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-weight: 600; color: white; font-size: 14px;">${escapeHtml(member.name)}</span>
              <span style="font-size: 12px;">${statusIcon}</span>
              ${isCurrentUser ? '<span style="font-size: 10px; background: rgba(139, 92, 246, 0.3); padding: 2px 6px; border-radius: 4px; color: #a78bfa;">Você</span>' : ''}
            </div>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
              <span style="font-size: 11px; background: ${role.color}20; color: ${role.color}; padding: 2px 8px; border-radius: 4px;">
                ${escapeHtml(role.name)}
              </span>
              ${member.email ? `<span style="font-size: 11px; color: rgba(255,255,255,0.4);">${escapeHtml(member.email)}</span>` : ''}
            </div>
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="team-edit-btn" data-id="${escapeHtml(member.id)}" title="Editar" style="
              width: 28px; height: 28px;
              background: rgba(255,255,255,0.1);
              border: none;
              border-radius: 6px;
              cursor: pointer;
              color: white;
              font-size: 12px;
            ">✏️</button>
            ${member.id !== 'default_user' ? `
              <button class="team-delete-btn" data-id="${escapeHtml(member.id)}" title="Remover" style="
                width: 28px; height: 28px;
                background: rgba(239, 68, 68, 0.2);
                border: none;
                border-radius: 6px;
                cursor: pointer;
                color: #f87171;
                font-size: 12px;
              ">🗑️</button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Adicionar event listeners
    container.querySelectorAll('.team-member-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.team-edit-btn') || e.target.closest('.team-delete-btn')) return;
        const memberId = card.dataset.memberId;
        setCurrentUser(memberId);
      });
    });

    container.querySelectorAll('.team-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const memberId = btn.dataset.id;
        editMember(memberId);
      });
    });

    container.querySelectorAll('.team-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const memberId = btn.dataset.id;
        deleteMember(memberId);
      });
    });

    log('Lista de membros renderizada:', state.members.length);
  }

  // ============================================
  // GERENCIAMENTO DE MEMBROS
  // ============================================

  async function addMember(name, email = '', role = 'agent', avatar = '👤') {
    if (!name || name.trim().length === 0) {
      alert('❌ Digite o nome do membro');
      return null;
    }

    const member = {
      id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: name.trim(),
      email: email.trim(),
      role,
      status: 'available',
      avatar,
      joinedAt: Date.now()
    };

    state.members.push(member);
    await saveState();

    log('Membro adicionado:', member.name);
    renderMembersList();

    return member;
  }

  async function editMember(memberId) {
    const member = state.members.find(m => m.id === memberId);
    if (!member) return;

    const newName = prompt('Nome do membro:', member.name);
    if (newName === null) return; // Cancelou
    if (!newName.trim()) {
      alert('❌ Nome não pode estar vazio');
      return;
    }

    const newEmail = prompt('Email (opcional):', member.email || '');
    const newRole = prompt('Cargo (admin/manager/agent/viewer):', member.role);

    member.name = newName.trim();
    member.email = newEmail?.trim() || '';
    if (['admin', 'manager', 'agent', 'viewer'].includes(newRole)) {
      member.role = newRole;
    }

    await saveState();
    renderMembersList();
    log('Membro editado:', member.name);
  }

  async function deleteMember(memberId) {
    if (memberId === 'default_user') {
      alert('❌ Não é possível remover o usuário padrão');
      return;
    }

    const member = state.members.find(m => m.id === memberId);
    if (!member) return;

    if (!confirm(`Remover ${member.name} da equipe?`)) return;

    state.members = state.members.filter(m => m.id !== memberId);

    // Se removeu o usuário atual, definir outro
    if (state.currentUser?.id === memberId) {
      state.currentUser = state.members[0] || null;
    }

    await saveState();
    renderMembersList();
    log('Membro removido:', member.name);
  }

  async function setCurrentUser(memberId) {
    const member = state.members.find(m => m.id === memberId);
    if (!member) return;

    state.currentUser = member;
    await saveState();
    renderMembersList();

    log('Usuário atual:', member.name);

    // Emitir evento
    if (window.EventBus?.emit) {
      window.EventBus.emit('teamsystem:user_changed', { user: member });
    }
  }

  async function updateStatus(memberId, status) {
    const member = state.members.find(m => m.id === memberId);
    if (!member) return;

    if (!['available', 'busy', 'away', 'offline'].includes(status)) return;

    member.status = status;
    await saveState();
    renderMembersList();
    log('Status atualizado:', member.name, '->', status);
  }

  function escapeHtml(text) {
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(text);
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // ============================================
  // INICIALIZAÇÃO DO FORMULÁRIO
  // ============================================

  function setupForm() {
    const addBtn = document.getElementById('team_add_member_btn');
    const nameInput = document.getElementById('team_member_name');
    const emailInput = document.getElementById('team_member_email');
    const roleSelect = document.getElementById('team_member_role');

    if (addBtn) {
      addBtn.addEventListener('click', async () => {
        const name = nameInput?.value || '';
        const email = emailInput?.value || '';
        const role = roleSelect?.value || 'agent';

        const member = await addMember(name, email, role);

        if (member) {
          // Limpar inputs
          if (nameInput) nameInput.value = '';
          if (emailInput) emailInput.value = '';
          if (roleSelect) roleSelect.value = 'agent';
        }
      });
    }

    // Status do usuário atual
    const statusSelect = document.getElementById('team_current_status');
    if (statusSelect) {
      statusSelect.addEventListener('change', () => {
        if (state.currentUser) {
          updateStatus(state.currentUser.id, statusSelect.value);
        }
      });
    }
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  async function init() {
    if (state.initialized) return;

    log('Inicializando Team System UI...');

    await loadState();
    renderMembersList();
    setupForm();

    state.initialized = true;
    log('✅ Team System UI inicializado');

    // Expor funções para o TeamSystem original
    if (window.TeamSystem) {
      window.TeamSystem.renderUI = renderMembersList;
    }
  }

  // Expor API global
  window.TeamSystemUI = {
    init,
    loadState,
    saveState,
    renderMembersList,
    addMember,
    editMember,
    deleteMember,
    setCurrentUser,
    updateStatus,
    getState: () => state,
    getMembers: () => state.members,
    getCurrentUser: () => state.currentUser
  };

  // Auto-inicializar quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 500));
  } else {
    setTimeout(init, 500);
  }

  log('Módulo Team System UI carregado');
})();
