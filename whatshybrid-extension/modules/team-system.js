/**
 * 👥 Team System - Sistema de Equipe e Colaboração
 *
 * Permite gerenciar múltiplos usuários/agentes trabalhando no mesmo WhatsApp.
 *
 * Features:
 * - Gestão de membros da equipe
 * - Atribuição de conversas
 * - Status de disponibilidade
 * - Transferência de atendimento
 * - Estatísticas por membro
 * - Notas internas
 * - ✅ Disparo de mensagens via WhatsApp API (Store.Cmd, Store.Chat)
 * - ✅ Broadcast para múltiplos membros
 * - ✅ Integração com HumanTyping para digitação natural
 * - ✅ Múltiplos fallbacks de envio
 *
 * @version 1.1.0
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'whl_team_system_v1';

  // Roles disponíveis
  const ROLES = {
    ADMIN: { id: 'admin', name: 'Administrador', color: '#ef4444', permissions: ['all'], persona: 'professional' },
    MANAGER: { id: 'manager', name: 'Gerente', color: '#f59e0b', permissions: ['assign', 'view_all', 'stats'], persona: 'professional' },
    AGENT: { id: 'agent', name: 'Agente', color: '#10b981', permissions: ['chat', 'notes'], persona: 'friendly' },
    VIEWER: { id: 'viewer', name: 'Visualizador', color: '#6b7280', permissions: ['view'], persona: 'neutral' },
    SALES: { id: 'sales', name: 'Vendas', color: '#3b82f6', permissions: ['chat', 'notes'], persona: 'sales' },
    SUPPORT: { id: 'support', name: 'Suporte', color: '#8b5cf6', permissions: ['chat', 'notes'], persona: 'support' }
  };
  
  // Mapeamento de roles para personas de IA
  const ROLE_PERSONA_MAP = {
    admin: 'professional',
    manager: 'professional',
    agent: 'friendly',
    viewer: 'neutral',
    sales: 'sales',
    support: 'support'
  };

  // Status de disponibilidade
  const STATUSES = {
    AVAILABLE: { id: 'available', name: 'Disponível', icon: '🟢', color: '#10b981' },
    BUSY: { id: 'busy', name: 'Ocupado', icon: '🟡', color: '#f59e0b' },
    AWAY: { id: 'away', name: 'Ausente', icon: '🔴', color: '#ef4444' },
    OFFLINE: { id: 'offline', name: 'Offline', icon: '⚫', color: '#6b7280' }
  };

  let state = {
    currentUser: null,
    members: [],
    assignments: {}, // chatId -> userId
    notes: {}, // chatId -> [{ userId, text, timestamp }]
    statistics: {},
    initialized: false
  };

  // ============================================================
  // INICIALIZAÇÃO
  // ============================================================

  async function init() {
    if (state.initialized) return;

    console.log('[TeamSystem] 👥 Inicializando Sistema de Equipe...');

    await loadState();
    await identifyCurrentUser();

    state.initialized = true;
    console.log('[TeamSystem] ✅ Inicializado - Usuário:', state.currentUser?.name);

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit('teamsystem:initialized', {
        user: state.currentUser,
        members: state.members.length
      });
    }
  }

  // ============================================================
  // PERSISTÊNCIA
  // ============================================================

  async function loadState() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        state = { ...state, ...result[STORAGE_KEY] };
      }

      // Criar usuário padrão se não existir
      if (state.members.length === 0) {
        state.members.push({
          id: 'default_user',
          name: 'Usuário Principal',
          email: '',
          role: 'admin',
          status: 'available',
          avatar: '👤',
          joinedAt: Date.now(),
          stats: {
            chatsHandled: 0,
            messagesSent: 0,
            avgResponseTime: 0,
            satisfaction: 0
          }
        });
        await saveState();
      }
    } catch (e) {
      console.error('[TeamSystem] Erro ao carregar estado:', e);
    }
  }

  async function saveState() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    } catch (e) {
      console.error('[TeamSystem] Erro ao salvar estado:', e);
    }
  }

  // ============================================================
  // GERENCIAMENTO DE USUÁRIOS
  // ============================================================

  async function identifyCurrentUser() {
    // Tentar identificar usuário atual
    // Por padrão, usa o primeiro membro da lista
    if (!state.currentUser && state.members.length > 0) {
      state.currentUser = state.members[0];
      await saveState();
    }
  }

  function setCurrentUser(userId) {
    const user = state.members.find(m => m.id === userId);
    if (!user) return false;

    state.currentUser = user;
    saveState();

    console.log('[TeamSystem] Usuário atual:', user.name);

    // Aplicar persona de IA baseada no role do usuário
    applyCurrentUserPersona();

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit('teamsystem:user_changed', { user });
    }

    return true;
  }

  async function addMember(name, email, role = 'agent', avatar = '👤') {
    const id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const member = {
      id,
      name,
      email,
      role,
      status: 'available',
      avatar,
      joinedAt: Date.now(),
      stats: {
        chatsHandled: 0,
        messagesSent: 0,
        avgResponseTime: 0,
        satisfaction: 0
      }
    };

    state.members.push(member);
    await saveState();

    console.log('[TeamSystem] ✅ Membro adicionado:', name, '- Total:', state.members.length);

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit('teamsystem:member_added', { member });
    }

    return member;
  }

  function removeMember(userId) {
    const index = state.members.findIndex(m => m.id === userId);
    if (index === -1) return false;

    // Não permitir remover o último admin
    const member = state.members[index];
    if (member.role === 'admin') {
      const admins = state.members.filter(m => m.role === 'admin');
      if (admins.length === 1) {
        console.warn('[TeamSystem] Não é possível remover o último administrador');
        return false;
      }
    }

    state.members.splice(index, 1);

    // Remover atribuições deste usuário
    Object.keys(state.assignments).forEach(chatId => {
      if (state.assignments[chatId] === userId) {
        delete state.assignments[chatId];
      }
    });

    saveState();

    console.log('[TeamSystem] Membro removido:', userId);

    return true;
  }

  function updateMemberStatus(userId, status) {
    const member = state.members.find(m => m.id === userId);
    if (!member) return false;

    member.status = status;
    saveState();

    console.log('[TeamSystem] Status atualizado:', member.name, '→', status);

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit('teamsystem:status_changed', { userId, status });
    }

    return true;
  }

  function updateMemberRole(userId, role) {
    const member = state.members.find(m => m.id === userId);
    if (!member) return false;

    member.role = role;
    saveState();

    console.log('[TeamSystem] Role atualizado:', member.name, '→', role);

    return true;
  }

  // ============================================================
  // ATRIBUIÇÃO DE CONVERSAS
  // ============================================================

  function assignChat(chatId, userId) {
    const member = state.members.find(m => m.id === userId);
    if (!member) return false;

    const previousAssignee = state.assignments[chatId];
    state.assignments[chatId] = userId;

    // Atualizar estatísticas
    if (!member.stats) {
      member.stats = { chatsHandled: 0, messagesSent: 0, avgResponseTime: 0, satisfaction: 0 };
    }
    member.stats.chatsHandled++;

    saveState();

    console.log('[TeamSystem] Chat', chatId, 'atribuído para', member.name);

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit('teamsystem:chat_assigned', {
        chatId,
        userId,
        previousAssignee
      });
    }

    return true;
  }

  function unassignChat(chatId) {
    if (!state.assignments[chatId]) return false;

    const userId = state.assignments[chatId];
    delete state.assignments[chatId];

    saveState();

    console.log('[TeamSystem] Chat', chatId, 'desatribuído');

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit('teamsystem:chat_unassigned', { chatId, userId });
    }

    return true;
  }

  function getAssignedUser(chatId) {
    const userId = state.assignments[chatId];
    if (!userId) return null;

    return state.members.find(m => m.id === userId);
  }

  function getUserChats(userId) {
    return Object.entries(state.assignments)
      .filter(([_, assignedUserId]) => assignedUserId === userId)
      .map(([chatId]) => chatId);
  }

  function transferChat(chatId, fromUserId, toUserId) {
    const fromUser = state.members.find(m => m.id === fromUserId);
    const toUser = state.members.find(m => m.id === toUserId);

    if (!fromUser || !toUser) return false;

    if (state.assignments[chatId] !== fromUserId) {
      console.warn('[TeamSystem] Chat não está atribuído para', fromUser.name);
      return false;
    }

    assignChat(chatId, toUserId);

    console.log('[TeamSystem] Chat transferido de', fromUser.name, 'para', toUser.name);

    // Adicionar nota automática
    addNote(chatId, null, `Chat transferido de ${fromUser.name} para ${toUser.name}`, true);

    return true;
  }

  // ============================================================
  // NOTAS INTERNAS
  // ============================================================

  function addNote(chatId, userId, text, isSystem = false) {
    if (!state.notes[chatId]) {
      state.notes[chatId] = [];
    }

    const note = {
      id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: isSystem ? null : (userId || state.currentUser?.id),
      text,
      timestamp: Date.now(),
      isSystem
    };

    state.notes[chatId].push(note);

    // Manter apenas últimas 50 notas por chat
    if (state.notes[chatId].length > 50) {
      state.notes[chatId] = state.notes[chatId].slice(-50);
    }

    saveState();

    console.log('[TeamSystem] Nota adicionada ao chat', chatId);

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit('teamsystem:note_added', { chatId, note });
    }

    return note;
  }

  function getNotes(chatId) {
    return state.notes[chatId] || [];
  }

  function deleteNote(chatId, noteId) {
    if (!state.notes[chatId]) return false;

    const index = state.notes[chatId].findIndex(n => n.id === noteId);
    if (index === -1) return false;

    state.notes[chatId].splice(index, 1);
    saveState();

    return true;
  }

  // ============================================================
  // DISPARO DE MENSAGENS (WhatsApp API Integration)
  // ============================================================

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Abre chat usando API interna do WhatsApp
   * Métodos baseados em smartbot-autopilot-v2.js e crm.js
   */
  async function openChatByPhone(phone) {
    const cleanPhone = phone.replace(/\D/g, '');

    // Método 1: Via Store.Cmd.openChatAt (mais confiável)
    if (window.Store?.Cmd?.openChatAt) {
      try {
        await window.Store.Cmd.openChatAt(cleanPhone + '@c.us');
        console.log('[TeamSystem] ✅ Chat aberto via Store.Cmd.openChatAt');
        await sleep(1500);
        return true;
      } catch (e) {
        console.warn('[TeamSystem] Store.Cmd.openChatAt falhou:', e.message);
      }
    }

    // Método 2: Via Store.Chat.find
    if (window.Store?.Chat?.find) {
      try {
        const chat = await window.Store.Chat.find(cleanPhone + '@c.us');
        if (chat) {
          if (chat.open) {
            await chat.open();
          } else if (window.Store?.Cmd?.openChatFromContact) {
            await window.Store.Cmd.openChatFromContact(chat);
          }
          console.log('[TeamSystem] ✅ Chat aberto via Store.Chat.find');
          await sleep(1500);
          return true;
        }
      } catch (e) {
        console.warn('[TeamSystem] Store.Chat.find falhou:', e.message);
      }
    }

    // Método 3: Via URL (fallback)
    try {
      const link = document.createElement('a');
      link.href = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
      link.click();
      console.log('[TeamSystem] ⚠️ Chat aberto via URL fallback');
      await sleep(3000);
      return true;
    } catch (e) {
      console.error('[TeamSystem] Todos os métodos de abertura falharam:', e);
    }

    return false;
  }

  /**
   * Envia mensagem no chat atual usando HumanTyping
   * Método baseado em smartbot-autopilot-v2.js
   */
  async function sendMessageToChat(text) {
    // Encontrar campo de input
    const inputSelectors = [
      'footer div[contenteditable="true"][role="textbox"]',
      '[data-testid="conversation-compose-box-input"]',
      'div[contenteditable="true"][role="textbox"]'
    ];

    let inputField = null;
    for (const sel of inputSelectors) {
      inputField = document.querySelector(sel);
      if (inputField) {
        console.log('[TeamSystem] Campo de input encontrado:', sel);
        break;
      }
    }

    if (!inputField) {
      console.error('[TeamSystem] ❌ Campo de input não encontrado');
      return false;
    }

    // Focar no campo
    inputField.focus();
    await sleep(200);

    // Limpar campo
    inputField.textContent = '';
    inputField.innerHTML = '';

    // Usar HumanTyping se disponível
    if (window.HumanTyping?.type) {
      try {
        await window.HumanTyping.type(inputField, text, {
          minDelay: 30,
          maxDelay: 80
        });
        console.log('[TeamSystem] ✅ Texto digitado com HumanTyping');
      } catch (e) {
        console.warn('[TeamSystem] HumanTyping falhou, usando fallback');
        // Fallback: inserção direta
        for (const char of text) {
          document.execCommand('insertText', false, char);
          inputField.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(Math.random() * 40 + 20);
        }
      }
    } else {
      // Fallback: digitação manual
      console.log('[TeamSystem] HumanTyping não disponível, usando digitação manual');
      for (const char of text) {
        document.execCommand('insertText', false, char);
        inputField.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(Math.random() * 40 + 20);
      }
    }

    await sleep(300);

    // Clicar no botão enviar
    const sendBtn = document.querySelector('[data-testid="send"]') ||
                    document.querySelector('button[aria-label*="Enviar"]') ||
                    document.querySelector('span[data-icon="send"]')?.parentElement;

    if (sendBtn) {
      sendBtn.click();
      console.log('[TeamSystem] ✅ Mensagem enviada via botão');
      await sleep(500);
      return true;
    }

    // Fallback: pressionar Enter
    inputField.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      keyCode: 13,
      bubbles: true
    }));
    console.log('[TeamSystem] ✅ Mensagem enviada via Enter');
    await sleep(500);
    return true;
  }

  /**
   * Envia mensagem para um telefone específico
   * (abre chat + envia mensagem)
   */
  async function sendToPhone(phone, message) {
    try {
      const opened = await openChatByPhone(phone);
      if (!opened) {
        throw new Error('Não foi possível abrir o chat');
      }

      const sent = await sendMessageToChat(message);
      if (!sent) {
        throw new Error('Não foi possível enviar a mensagem');
      }

      return { success: true, phone, message };
    } catch (error) {
      console.error('[TeamSystem] Erro ao enviar para', phone, ':', error);
      return { success: false, phone, error: error.message };
    }
  }

  /**
   * Broadcast: envia mensagem para múltiplos membros da equipe
   * @param {Array<string>} memberIds - IDs dos membros que receberão a mensagem
   * @param {string} message - Mensagem a ser enviada
   * @param {Object} options - Opções de envio
   * @returns {Object} Resultado do broadcast
   */
  async function broadcastToTeam(memberIds, message, options = {}) {
    const {
      delayMin = 3000,
      delayMax = 7000,
      includeSignature = true,
      senderName = state.currentUser?.name || 'Equipe'
    } = options;

    const results = {
      total: memberIds.length,
      success: 0,
      failed: 0,
      details: []
    };

    // Validar membros
    const members = memberIds.map(id => state.members.find(m => m.id === id)).filter(Boolean);

    if (members.length === 0) {
      console.warn('[TeamSystem] Nenhum membro válido para broadcast');
      return results;
    }

    // Formatar mensagem com assinatura
    const fullMessage = includeSignature
      ? `*${senderName}:* ${message}`
      : message;

    console.log(`[TeamSystem] 📢 Iniciando broadcast para ${members.length} membros...`);

    for (let i = 0; i < members.length; i++) {
      const member = members[i];

      // Pular se o membro não tiver telefone/email configurado
      // (assumindo que email pode conter telefone ou ID do WhatsApp)
      if (!member.email || !member.email.match(/\d+/)) {
        console.warn('[TeamSystem] Membro sem telefone:', member.name);
        results.failed++;
        results.details.push({
          member: member.name,
          status: 'failed',
          error: 'Telefone não configurado'
        });
        continue;
      }

      try {
        // Extrair telefone do email (se for número)
        const phone = member.email.replace(/\D/g, '');

        console.log(`[TeamSystem] [${i + 1}/${members.length}] Enviando para ${member.name}...`);

        const result = await sendToPhone(phone, fullMessage);

        if (result.success) {
          results.success++;
          results.details.push({
            member: member.name,
            status: 'success'
          });

          // Atualizar estatísticas do membro
          if (!member.stats) {
            member.stats = { chatsHandled: 0, messagesSent: 0, avgResponseTime: 0, satisfaction: 0 };
          }
          member.stats.messagesSent++;
        } else {
          throw new Error(result.error);
        }

        // Delay entre envios (exceto no último)
        if (i < members.length - 1) {
          const delay = Math.random() * (delayMax - delayMin) + delayMin;
          console.log(`[TeamSystem] Aguardando ${Math.round(delay / 1000)}s antes do próximo envio...`);
          await sleep(delay);
        }

      } catch (error) {
        results.failed++;
        results.details.push({
          member: member.name,
          status: 'failed',
          error: error.message
        });
        console.error('[TeamSystem] Erro ao enviar para', member.name, ':', error);
      }
    }

    // Salvar estatísticas atualizadas
    await saveState();

    console.log('[TeamSystem] 📢 Broadcast concluído:', results);

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit('teamsystem:broadcast_completed', results);
    }

    return results;
  }

  // ============================================================
  // INTEGRAÇÃO COM IA
  // ============================================================

  /**
   * Obtém a persona de IA baseada no membro atual
   * @returns {string} ID da persona
   */
  function getAIPersonaForCurrentUser() {
    if (!state.currentUser) return 'professional';
    const role = state.currentUser.role || 'agent';
    return ROLE_PERSONA_MAP[role] || 'professional';
  }

  /**
   * Aplica persona do membro atual ao CopilotEngine
   */
  function applyCurrentUserPersona() {
    const personaId = getAIPersonaForCurrentUser();
    
    if (window.CopilotEngine?.setActivePersona) {
      window.CopilotEngine.setActivePersona(personaId);
      console.log('[TeamSystem] Persona aplicada ao CopilotEngine:', personaId);
    }
    
    // Emitir evento para outros módulos
    if (window.EventBus) {
      window.EventBus.emit('teamsystem:persona_applied', {
        userId: state.currentUser?.id,
        role: state.currentUser?.role,
        persona: personaId
      });
    }
    
    return personaId;
  }

  /**
   * Obtém contexto do membro para inclusão no prompt de IA
   * @returns {Object} Contexto do membro
   */
  function getMemberContextForAI() {
    if (!state.currentUser) return null;
    
    return {
      memberName: state.currentUser.name,
      memberRole: ROLES[state.currentUser.role?.toUpperCase()]?.name || 'Agente',
      persona: getAIPersonaForCurrentUser(),
      permissions: ROLES[state.currentUser.role?.toUpperCase()]?.permissions || [],
      status: state.currentUser.status
    };
  }

  // ============================================================
  // ESTATÍSTICAS
  // ============================================================

  function getTeamStats() {
    const stats = {
      totalMembers: state.members.length,
      activeMembers: state.members.filter(m => m.status === 'available').length,
      totalChatsAssigned: Object.keys(state.assignments).length,
      memberStats: state.members.map(m => ({
        id: m.id,
        name: m.name,
        role: m.role,
        status: m.status,
        chatsHandled: m.stats?.chatsHandled || 0,
        messagesSent: m.stats?.messagesSent || 0,
        avgResponseTime: m.stats?.avgResponseTime || 0
      }))
    };

    return stats;
  }

  function getMemberStats(userId) {
    const member = state.members.find(m => m.id === userId);
    if (!member) return null;

    return {
      ...member.stats,
      currentChats: getUserChats(userId).length
    };
  }

  // ============================================================
  // UI - RENDERIZAÇÃO
  // ============================================================

  function renderTeamPanel(container) {
    const stats = getTeamStats();

    container.innerHTML = `
      <div class="team-panel">
        <div class="team-header">
          <h3>👥 Equipe</h3>
          <button id="team-add-member-btn" class="mod-btn mod-btn-sm mod-btn-primary">➕ Adicionar</button>
        </div>

        <div class="team-stats">
          <div class="team-stat">
            <span class="stat-value">${stats.totalMembers}</span>
            <span class="stat-label">Membros</span>
          </div>
          <div class="team-stat">
            <span class="stat-value">${stats.activeMembers}</span>
            <span class="stat-label">Disponíveis</span>
          </div>
          <div class="team-stat">
            <span class="stat-value">${stats.totalChatsAssigned}</span>
            <span class="stat-label">Chats Ativos</span>
          </div>
        </div>

        <div class="team-members">
          ${state.members.map(member => {
            const statusInfo = STATUSES[member.status.toUpperCase()] || STATUSES.OFFLINE;
            const roleInfo = ROLES[member.role.toUpperCase()] || ROLES.AGENT;
            const userChats = getUserChats(member.id).length;

            return `
              <div class="team-member" data-user-id="${member.id}">
                <div class="member-avatar">${member.avatar}</div>
                <div class="member-info">
                  <div class="member-name">${member.name}</div>
                  <div class="member-meta">
                    <span class="member-role" style="color: ${roleInfo.color}">${roleInfo.name}</span>
                    <span class="member-chats">${userChats} chats</span>
                  </div>
                </div>
                <div class="member-status" style="color: ${statusInfo.color}">
                  ${statusInfo.icon}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Event listeners
    container.querySelector('#team-add-member-btn')?.addEventListener('click', () => {
      showAddMemberDialog(container);
    });

    // Adicionar estilos
    if (!document.getElementById('team-system-styles')) {
      const styles = document.createElement('style');
      styles.id = 'team-system-styles';
      styles.textContent = `
        .team-panel {
          background: rgba(26, 26, 46, 0.95);
          border-radius: 12px;
          padding: 16px;
          color: white;
        }

        .team-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .team-stats {
          display: flex;
          gap: 12px;
          margin-bottom: 16px;
        }

        .team-stat {
          flex: 1;
          background: rgba(255,255,255,0.05);
          padding: 12px;
          border-radius: 8px;
          text-align: center;
        }

        .stat-value {
          display: block;
          font-size: 24px;
          font-weight: 600;
          margin-bottom: 4px;
        }

        .stat-label {
          display: block;
          font-size: 11px;
          color: rgba(255,255,255,0.6);
        }

        .team-members {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .team-member {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: rgba(255,255,255,0.05);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .team-member:hover {
          background: rgba(255,255,255,0.1);
        }

        .member-avatar {
          font-size: 32px;
        }

        .member-info {
          flex: 1;
        }

        .member-name {
          font-weight: 600;
          margin-bottom: 4px;
        }

        .member-meta {
          display: flex;
          gap: 8px;
          font-size: 11px;
          color: rgba(255,255,255,0.6);
        }

        .member-role {
          font-weight: 600;
        }

        .member-status {
          font-size: 20px;
        }
      `;
      document.head.appendChild(styles);
    }
  }

  function showAddMemberDialog(container) {
    const dialog = document.createElement('div');
    dialog.className = 'team-dialog-overlay';
    dialog.innerHTML = `
      <div class="team-dialog">
        <h3>Adicionar Membro</h3>
        <input type="text" id="team-new-name" placeholder="Nome" class="mod-input">
        <input type="email" id="team-new-email" placeholder="Email" class="mod-input">
        <select id="team-new-role" class="mod-input mod-select">
          <option value="agent">Agente</option>
          <option value="manager">Gerente</option>
          <option value="admin">Administrador</option>
        </select>
        <div class="team-dialog-actions">
          <button id="team-cancel-btn" class="mod-btn">Cancelar</button>
          <button id="team-save-btn" class="mod-btn mod-btn-primary">Adicionar</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    dialog.querySelector('#team-cancel-btn').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#team-save-btn').addEventListener('click', async () => {
      const name = dialog.querySelector('#team-new-name').value.trim();
      const email = dialog.querySelector('#team-new-email').value.trim();
      const role = dialog.querySelector('#team-new-role').value;

      if (name) {
        await addMember(name, email, role);
        
        // Aguardar um pouco para garantir que o storage foi atualizado
        await new Promise(r => setTimeout(r, 100));
        
        // Re-carregar estado do storage para garantir consistência
        await loadState();
        
        // Renderizar com os dados atualizados
        renderTeamPanel(container);
        
        console.log('[TeamSystem] UI atualizada - Membros:', state.members.length);
        
        if (window.NotificationsModule) {
          window.NotificationsModule.success('Membro adicionado!');
        }
      }
      dialog.remove();
    });
  }

  // ============================================================
  // API PÚBLICA
  // ============================================================

  window.TeamSystem = {
    // Inicialização
    init,

    // Gerenciamento de usuários
    setCurrentUser,
    getCurrentUser: () => state.currentUser,
    getMembers: () => [...state.members],
    addMember,
    removeMember,
    updateMemberStatus,
    updateMemberRole,

    // Atribuição de conversas
    assignChat,
    unassignChat,
    getAssignedUser,
    getUserChats,
    transferChat,

    // Notas internas
    addNote,
    getNotes,
    deleteNote,

    // Disparo de mensagens
    openChatByPhone,
    sendMessageToChat,
    sendToPhone,
    broadcastToTeam,

    // Integração com IA (NOVO!)
    getAIPersonaForCurrentUser,
    applyCurrentUserPersona,
    getMemberContextForAI,

    // Estatísticas
    getTeamStats,
    getMemberStats,

    // UI
    renderTeamPanel,

    // Constantes
    ROLES,
    STATUSES,
    ROLE_PERSONA_MAP
  };

  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 500));
  } else {
    setTimeout(init, 500);
  }

})();
