/**
 * 👥 Team System Simple - Sistema de Broadcast para Equipe
 * 
 * Sistema simplificado focado em:
 * - Adicionar membros (nome + telefone)
 * - Selecionar membros
 * - Enviar mensagens para selecionados
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'whl_team_simple_v1';
  
  let state = {
    members: [],
    senderName: '',
    totalSent: 0
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
      console.log('[TeamSystem] ✅ Carregados', state.members.length, 'membros');
    } catch (e) {
      console.error('[TeamSystem] Erro ao carregar:', e);
    }
  }

  async function saveState() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    } catch (e) {
      console.error('[TeamSystem] Erro ao salvar:', e);
    }
  }

  // ============================================
  // GERENCIAMENTO DE MEMBROS
  // ============================================

  async function addMember(name, phone) {
    if (!phone) throw new Error('Telefone obrigatório');
    
    const cleanPhone = phone.replace(/\D/g, '');
    
    // Verificar duplicata
    if (state.members.some(m => m.phone === cleanPhone)) {
      throw new Error('Membro já existe');
    }
    
    const member = {
      id: `member_${Date.now()}`,
      name: name || 'Sem nome',
      phone: cleanPhone,
      selected: false,
      messagesSent: 0,
      addedAt: Date.now()
    };
    
    state.members.push(member);
    await saveState();
    console.log('[TeamSystem] ✅ Membro adicionado:', member.name);
    return member;
  }

  async function removeMember(id) {
    state.members = state.members.filter(m => m.id !== id);
    await saveState();
  }

  function getAll() {
    return state.members;
  }

  function toggleSelection(id) {
    const member = state.members.find(m => m.id === id);
    if (member) {
      member.selected = !member.selected;
      saveState();
    }
  }

  function selectAll() {
    state.members.forEach(m => m.selected = true);
    saveState();
  }

  function clearSelection() {
    state.members.forEach(m => m.selected = false);
    saveState();
  }

  function getSelected() {
    return state.members.filter(m => m.selected);
  }

  // ============================================
  // CONFIGURAÇÕES
  // ============================================

  async function setSenderName(name) {
    state.senderName = name;
    await saveState();
  }

  function getSenderName() {
    return state.senderName;
  }

  // ============================================
  // ENVIO DE MENSAGENS
  // ============================================

  async function sendToTeam(message) {
    const selected = getSelected();
    const results = { total: selected.length, success: 0, failed: 0, details: [] };
    
    if (selected.length === 0) {
      return results;
    }

    // Formatar mensagem com nome do remetente
    let finalMessage = message;
    if (state.senderName) {
      finalMessage = `*${state.senderName}:*\n${message}`;
    }

    // Normalização simples (evita erro comum: número sem DDI)
    const normalizePhone = (p) => {
      const digits = String(p || '').replace(/\D/g, '');
      if (!digits) return '';
      // Se já veio com país, manter
      if (digits.length > 11) return digits;
      // Padrão BR: prefixar 55 se não existir
      if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
        return '55' + digits;
      }
      return digits;
    };

    for (const member of selected) {
      try {
        const phone = normalizePhone(member.phone);
        if (!phone) {
          results.failed++;
          results.details.push({ id: member.id, name: member.name, phone: member.phone, status: 'failed', error: 'Número inválido' });
          continue;
        }
        // Enviar via background script
        const response = await chrome.runtime.sendMessage({
          type: 'WHL_SEND_TEXT_TO_PHONE',
          phone,
          message: finalMessage
        });
        
        if (response?.success) {
          results.success++;
          member.messagesSent = (member.messagesSent || 0) + 1;
          results.details.push({ id: member.id, name: member.name, phone, status: 'success' });
        } else {
          results.failed++;
          results.details.push({ id: member.id, name: member.name, phone, status: 'failed', error: response?.error || 'Falha ao enviar' });
        }
        
        // Delay entre envios
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.error('[TeamSystem] Erro ao enviar para', member.phone, e);
        results.failed++;
        results.details.push({ id: member.id, name: member.name, phone: member.phone, status: 'failed', error: e?.message || String(e) });
      }
    }

    state.totalSent += results.success;
    await saveState();
    
    return results;
  }

  // ============================================
  // ESTATÍSTICAS
  // ============================================

  function getStats() {
    return {
      totalMembers: state.members.length,
      selectedCount: state.members.filter(m => m.selected).length,
      totalMessagesSent: state.totalSent
    };
  }

  // ============================================
  // UTILITÁRIOS
  // ============================================

  function formatPhone(phone) {
    if (!phone) return '';
    const clean = phone.replace(/\D/g, '');
    if (clean.length === 13) {
      return `+${clean.slice(0,2)} (${clean.slice(2,4)}) ${clean.slice(4,9)}-${clean.slice(9)}`;
    } else if (clean.length === 11) {
      return `(${clean.slice(0,2)}) ${clean.slice(2,7)}-${clean.slice(7)}`;
    }
    return phone;
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  async function init() {
    await loadState();
    console.log('[TeamSystem] ✅ Sistema de Equipe inicializado');
  }

  // Exportar como window.teamSystem (lowercase para compatibilidade)
  window.teamSystem = {
    init,
    addMember,
    removeMember,
    getAll,
    toggleSelection,
    selectAll,
    clearSelection,
    getSelected,
    setSenderName,
    getSenderName,
    sendToTeam,
    getStats,
    formatPhone
  };

  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
