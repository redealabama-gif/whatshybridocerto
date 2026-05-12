/**
 * @file content/content-parts/07-message-listeners.js
 * @description Slice 6636-7145 do content.js original (refactor v9.0.0)
 * @lines 510
 */

// ===== WHL: Message Listeners para Store Bridge =====
window.addEventListener('message', (e) => {
  // Security: Validate message origin
  if (e.origin !== window.location.origin) return;
  if (!e.data || !e.data.type) return;
  
  // Resposta de carregar grupos
  if (e.data.type === 'WHL_GROUPS_RESULT') {
    const { groups } = e.data;
    const groupsList = document.getElementById('whlGroupsList');
    const btnLoadGroups = document.getElementById('whlLoadGroups');
    
    if (groupsList) {
      groupsList.innerHTML = '';
      if (groups.length === 0) {
        const option = document.createElement('option');
        option.disabled = true;
        option.textContent = 'Nenhum grupo encontrado';
        groupsList.appendChild(option);
      } else {
        // Item 23: Get last selected group from storage
        const lastSelectedGroupId = localStorage.getItem('whl_last_selected_group');
        
        groups.forEach(g => {
          const opt = document.createElement('option');
          opt.value = g.id;
          
          // Item 2: Truncate long names with tooltip
          const maxLength = 50;
          const displayName = g.name.length > maxLength 
            ? g.name.substring(0, maxLength) + '...' 
            : g.name;
          
          opt.textContent = `${displayName} (${g.participantsCount} membros)`;
          // Item 2: Add full name as title for tooltip
          opt.title = `${g.name} (${g.participantsCount} membros)\nID: ${g.id}`;
          // Item 11: Store group ID for copying
          opt.dataset.groupId = g.id;
          opt.dataset.groupName = g.name;
          
          // Item 23: Restore last selected group
          if (g.id === lastSelectedGroupId) {
            opt.selected = true;
          }
          
          groupsList.appendChild(opt);
        });
        
        // Item 23: Save selected group when changed
        groupsList.addEventListener('change', () => {
          const selectedOption = groupsList.selectedOptions[0];
          if (selectedOption && selectedOption.dataset.groupId) {
            localStorage.setItem('whl_last_selected_group', selectedOption.dataset.groupId);
          }
        });
      }
    }
    
    if (btnLoadGroups) {
      btnLoadGroups.disabled = false;
      btnLoadGroups.textContent = '🔄 Carregar Grupos';
    }
    
    alert(`✅ ${groups.length} grupos carregados!`);
  }
  
  // Erro ao carregar grupos
  if (e.data.type === 'WHL_GROUPS_ERROR') {
    const btnLoadGroups = document.getElementById('whlLoadGroups');
    if (btnLoadGroups) {
      btnLoadGroups.disabled = false;
      btnLoadGroups.textContent = '🔄 Carregar Grupos';
    }
    alert('Erro ao carregar grupos: ' + e.data.error);
  }
  
  // CORREÇÃO BUG 3: Handler para resultado de extração de membros (API e DOM)
  
  // OTIMIZAÇÃO: Listener para progresso da extração em tempo real
  if (e.data.type === 'WHL_EXTRACTION_PROGRESS') {
    const progressIndicator = document.getElementById('whlExtractionProgress');
    const progressText = document.getElementById('whlExtractionProgressText');
    const progressBar = document.getElementById('whlExtractionProgressBar');
    const progressCount = document.getElementById('whlExtractionProgressCount');
    
    if (progressIndicator && progressText && progressBar) {
      // Mostrar indicador de progresso
      progressIndicator.classList.add('active');
      
      // Atualizar texto da fase
      progressText.textContent = e.data.message || 'Processando...';
      
      // Atualizar barra de progresso
      const progress = e.data.progress || 0;
      progressBar.style.width = progress + '%';
      
      // Atualizar contador se disponível
      if (progressCount && e.data.currentCount !== undefined) {
        progressCount.textContent = `${e.data.currentCount} membros extraídos`;
      }
      
      // Esconder indicador quando completar ou houver erro
      if (e.data.phase === 'complete' || e.data.phase === 'error') {
        setTimeout(() => {
          progressIndicator.classList.remove('active');
        }, 2000); // Esconder após 2 segundos
      }
      
      console.log(`[WHL Progress] ${e.data.phase}: ${e.data.message} (${progress}%)`);
    }
  }
  
  // PR #76 ULTRA: Handler com estatísticas detalhadas
  if (e.data.type === 'WHL_GROUP_MEMBERS_RESULT' || e.data.type === 'WHL_EXTRACT_GROUP_MEMBERS_RESULT') {
    console.log('[WHL] 📨 Resultado ULTRA recebido:', e.data);
    
    const btnExtractMembers = document.getElementById('whlExtractGroupMembers');
    const membersBox = document.getElementById('whlGroupMembersNumbers');
    const membersCount = document.getElementById('whlGroupMembersCount');
    
    if (btnExtractMembers) {
      btnExtractMembers.disabled = false;
      btnExtractMembers.textContent = '📥 Extrair Contatos';
    }
    
    if (e.data.success || e.data.members) {
      let members = e.data.members || [];
      
      console.log('[WHL] 📊 Membros recebidos da API:', members);
      console.log('[WHL] 📊 Tipo:', typeof members, 'Comprimento:', members.length);
      
      // VALIDAÇÃO FINAL: Filtrar LIDs
      const validMembers = members.filter(num => {
        if (String(num).includes(':') || String(num).includes('@lid')) {
          console.warn('[WHL] ❌ LID rejeitado:', num);
          return false;
        }
        const clean = String(num).replace(/\D/g, '');
        const isValid = /^\d{10,15}$/.test(clean);
        if (!isValid) {
          console.warn('[WHL] ❌ Número inválido rejeitado:', num, 'clean:', clean);
        }
        return isValid;
      });
      
      console.log('[WHL] ✅ Números válidos:', validMembers.length);
      console.log('[WHL] ✅ Números válidos lista:', validMembers);
      
      if (membersBox) membersBox.value = validMembers.join('\n');
      if (membersCount) membersCount.textContent = validMembers.length;
      
      // Exibir estatísticas
      if (e.data.stats) {
        const { apiDirect, lidResolved, domFallback, duplicates, failed } = e.data.stats;
        const total = apiDirect + lidResolved + domFallback;
        
        const successRate = total + failed > 0 ? Math.round((validMembers.length / (total + failed)) * 100) : 0;
        
        alert(
          `✅ ${validMembers.length} NÚMEROS REAIS extraídos!\n\n` +
          `📊 ESTATÍSTICAS:\n` +
          `🔹 Via API: ${apiDirect}\n` +
          `🔹 LIDs resolvidos: ${lidResolved}\n` +
          `🔹 Via DOM: ${domFallback}\n` +
          `♻️ Duplicatas: ${duplicates}\n` +
          `❌ Falhas: ${failed}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `✅ Taxa: ${successRate}%`
        );
      } else {
        alert(`✅ ${validMembers.length} membros extraídos!`);
      }
    } else {
      console.error('[WHL] ❌ Erro na extração:', e.data);
      alert('❌ Erro: ' + (e.data.error || 'Desconhecido'));
    }
  }
  
  // RESULTADO de extração de membros via DOM (MÉTODO NOVO E VALIDADO)
  if (e.data.type === 'WHL_EXTRACT_GROUP_CONTACTS_DOM_RESULT') {
    const { success, groupName, contacts, total, error } = e.data;
    
    const groupMembersBox = document.getElementById('whlGroupMembersNumbers');
    const groupMembersCount = document.getElementById('whlGroupMembersCount');
    const btnExtractGroupMembers = document.getElementById('whlExtractGroupMembers');
    
    if (btnExtractGroupMembers) {
      btnExtractGroupMembers.disabled = false;
      btnExtractGroupMembers.textContent = '📥 Extrair Membros';
    }
    
    if (success && contacts) {
      // Extrair apenas os números dos contatos
      const phoneNumbers = contacts.map(c => c.phone).filter(p => p && p.trim());
      
      if (groupMembersBox) {
        groupMembersBox.value = phoneNumbers.join('\n');
      }
      if (groupMembersCount) {
        groupMembersCount.textContent = phoneNumbers.length;
      }
      
      alert(`✅ ${phoneNumbers.length} membros extraídos do grupo "${groupName}"!`);
      console.log('[WHL] Membros extraídos:', contacts);
    } else {
      alert('❌ Erro ao extrair membros: ' + (error || 'Erro desconhecido'));
      console.error('[WHL] Erro na extração:', error);
    }
  }
  
  // ERRO ao extrair membros via DOM
  if (e.data.type === 'WHL_EXTRACT_GROUP_CONTACTS_DOM_ERROR') {
    const btnExtractGroupMembers = document.getElementById('whlExtractGroupMembers');
    if (btnExtractGroupMembers) {
      btnExtractGroupMembers.disabled = false;
      btnExtractGroupMembers.textContent = '📥 Extrair Contatos';
    }
    alert('❌ Erro ao extrair membros: ' + e.data.error);
  }
  
  // Erro ao extrair membros
  if (e.data.type === 'WHL_GROUP_MEMBERS_ERROR') {
    const btnExtractGroupMembers = document.getElementById('whlExtractGroupMembers');
    if (btnExtractGroupMembers) {
      btnExtractGroupMembers.disabled = false;
      btnExtractGroupMembers.textContent = '📥 Extrair Contatos';
    }
    alert('Erro ao extrair membros: ' + e.data.error);
  }
  
  // ===== LISTENERS PARA EXTRAÇÃO INSTANTÂNEA =====
  
  // Resultado de extração instantânea
  if (e.data.type === 'WHL_EXTRACT_INSTANT_RESULT') {
    const extractStatus = document.getElementById('whlExtractStatus');
    
    if (e.data.success) {
      console.log('[WHL] Extração instantânea bem-sucedida:', e.data.contacts?.length, 'contatos');
      if (extractStatus) {
        extractStatus.textContent = `✅ ${e.data.contacts?.length || 0} contatos extraídos via ${e.data.method}`;
      }
    } else {
      console.log('[WHL] Extração instantânea falhou:', e.data.error);
      if (extractStatus) {
        extractStatus.textContent = `⚠️ Método instantâneo falhou: ${e.data.error}`;
      }
    }
  }
  
  // Resultado de extração completa instantânea
  if (e.data.type === 'WHL_EXTRACT_ALL_INSTANT_RESULT') {
    const extractStatus = document.getElementById('whlExtractStatus');
    
    if (e.data.success) {
      const normalBox = document.getElementById('whlExtractedNumbers');
      const archivedBox = document.getElementById('whlArchivedNumbers');
      const blockedBox = document.getElementById('whlBlockedNumbers');
      
      const normalCount = document.getElementById('whlNormalCount');
      const archivedCount = document.getElementById('whlArchivedCount');
      const blockedCount = document.getElementById('whlBlockedCount');
      
      if (normalBox && e.data.contacts) {
        normalBox.value = e.data.contacts.join('\n');
      }
      if (archivedBox && e.data.archived) {
        archivedBox.value = e.data.archived.join('\n');
      }
      if (blockedBox && e.data.blocked) {
        blockedBox.value = e.data.blocked.join('\n');
      }
      
      if (normalCount) normalCount.textContent = e.data.contacts?.length || 0;
      if (archivedCount) archivedCount.textContent = e.data.archived?.length || 0;
      if (blockedCount) blockedCount.textContent = e.data.blocked?.length || 0;
      
      console.log('[WHL] Extração completa instantânea:', {
        normal: e.data.contacts?.length || 0,
        archived: e.data.archived?.length || 0,
        blocked: e.data.blocked?.length || 0,
        groups: e.data.groups?.length || 0
      });
      
      if (extractStatus) {
        extractStatus.textContent = `✅ Extração instantânea concluída: ${e.data.contacts?.length || 0} normais, ${e.data.archived?.length || 0} arquivados, ${e.data.blocked?.length || 0} bloqueados`;
      }
    } else {
      if (extractStatus) {
        extractStatus.textContent = `⚠️ Extração instantânea falhou: ${e.data.error}`;
      }
    }
  }
  
  // Resultado de carregar grupos (novo formato)
  if (e.data.type === 'WHL_LOAD_GROUPS_RESULT') {
    const groupsList = document.getElementById('whlGroupsList');
    const btnLoadGroups = document.getElementById('whlLoadGroups');
    
    if (btnLoadGroups) {
      btnLoadGroups.disabled = false;
      btnLoadGroups.textContent = '🔄 Carregar Grupos';
    }
    
    if (e.data.success && e.data.groups && groupsList) {
      const groups = e.data.groups;
      groupsList.innerHTML = '';
      
      groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = `${g.name} (${g.participants} membros)`;
        opt.dataset.groupId = g.id;
        groupsList.appendChild(opt);
      });
      
      console.log(`[WHL] ${groups.length} grupos carregados`);
      alert(`✅ ${groups.length} grupos carregados!`);
    } else if (!e.data.success) {
      alert('Erro ao carregar grupos: ' + (e.data.error || 'Desconhecido'));
    }
  }
  
  // ===== LISTENERS PARA RECOVER HISTORY =====
  
  // Nova mensagem recuperada
  if (e.data.type === 'WHL_RECOVER_NEW_MESSAGE') {
    const recoverCount = document.getElementById('whlRecoveredCount');
    const recoverBadgeCount = document.getElementById('whlRecoveredBadgeCount');
    const recoverHistory = document.getElementById('whlRecoverHistory');
    
    if (recoverCount) {
      recoverCount.textContent = e.data.total || 0;
    }
    if (recoverBadgeCount) {
      recoverBadgeCount.textContent = e.data.total || 0;
    }
    
    if (recoverHistory && e.data.message) {
      const msg = e.data.message;
      
      // Formatar telefone
      let phone = msg.from || 'Desconhecido';
      phone = phone.replace('@c.us', '').replace('@s.whatsapp.net', '');
      
      // Formatar mensagem
      const message = msg.body || msg.text || msg.caption || '[Mídia]';
      
      // Formatar data/hora
      const date = new Date(msg.timestamp || Date.now());
      const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
      
      // CORREÇÃO ISSUE 05: Diferenciar entre mensagens apagadas e editadas
      const isEdited = msg.action === 'edited';
      const typeClass = isEdited ? 'edited' : 'deleted';
      const typeIcon = isEdited ? '✏️' : '🗑️';
      const typeLabel = isEdited ? 'Editada' : 'Apagada';
      
      if (!recoverHistory.__whlRecoverCopyBound) {
        recoverHistory.__whlRecoverCopyBound = true;
        recoverHistory.addEventListener('click', (ev) => {
          const btn = ev.target?.closest?.('.copy-btn');
          if (!btn) return;
          const encoded = btn.getAttribute('data-copy-text') || '';
          let decoded = '';
          try { decoded = decodeURIComponent(encoded); } catch (_) { decoded = encoded; }
          Promise.resolve(navigator.clipboard.writeText(decoded)).then(() => {
            btn.textContent = '✅ Copiado!';
            setTimeout(() => { btn.textContent = '📋 Copiar'; }, 2000);
          }).catch(() => {});
        });
      }

      // Criar elemento de timeline
      const timelineItem = document.createElement('div');
      timelineItem.className = `timeline-item ${typeClass}`;
      const safePhone = escapeHtml(phone);
      const safeMessage = escapeHtml(message);
      const copyPayload = escapeHtml(encodeURIComponent(String(message || '')));
      timelineItem.innerHTML = `
        <div class="timeline-dot"></div>
        <div class="timeline-card">
          <div class="card-header">
            <span class="contact-name">📱 ${safePhone}</span>
            <span class="message-type ${typeClass}">${typeIcon} ${typeLabel}</span>
            <span class="timestamp">${timeStr}</span>
          </div>
          <div class="card-body">
            <p class="original-message">"${safeMessage}"</p>
          </div>
          <div class="card-footer">
            <span class="date">${dateStr}</span>
            <button class="copy-btn" data-copy-text="${copyPayload}">📋 Copiar</button>
          </div>
        </div>
      `;
      
      // Remover placeholder se existir
      const placeholder = recoverHistory.querySelector('.muted');
      if (placeholder) {
        recoverHistory.innerHTML = '';
      }
      
      recoverHistory.insertBefore(timelineItem, recoverHistory.firstChild);
      
      // Limitar a 20 mensagens visíveis
      while (recoverHistory.children.length > 20) {
        recoverHistory.removeChild(recoverHistory.lastChild);
      }
    }
    
    console.log('[WHL Recover] Nova mensagem recuperada:', e.data.message?.body?.substring(0, 50));
  }
  
  // CORREÇÃO BUG 4: Histórico completo de recover
  if (e.data.type === 'WHL_RECOVER_HISTORY_RESULT') {
    const recoverCount = document.getElementById('whlRecoveredCount');
    const recoverBadgeCount = document.getElementById('whlRecoveredBadgeCount');
    const recoverHistory = document.getElementById('whlRecoverHistory');
    
    if (recoverCount) {
      recoverCount.textContent = e.data.total || 0;
    }
    if (recoverBadgeCount) {
      recoverBadgeCount.textContent = e.data.total || 0;
    }
    
    if (recoverHistory && e.data.history) {
      recoverHistory.innerHTML = '';
      
      if (e.data.history.length === 0) {
        recoverHistory.innerHTML = '<div class="muted" style="text-align:center;padding:20px">Nenhuma mensagem recuperada ainda...</div>';
      } else {
        e.data.history.slice().reverse().forEach((msg, index) => {
          // CORREÇÃO BUG 4: Formatar número
          let phone = msg.from || 'Desconhecido';
          phone = phone.replace('@c.us', '').replace('@s.whatsapp.net', '');
          
          // CORREÇÃO BUG 4: Formatar mensagem
          const message = msg.body || msg.text || msg.caption || '[Mídia]';
          
          // CORREÇÃO BUG 4: Formatar data
          const date = new Date(msg.timestamp || Date.now());
          const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
          
          // CORREÇÃO ISSUE 05: Diferenciar entre mensagens apagadas e editadas
          const isEdited = msg.action === 'edited';
          const typeClass = isEdited ? 'edited' : 'deleted';
          const typeIcon = isEdited ? '✏️' : '🗑️';
          const typeLabel = isEdited ? 'Editada' : 'Apagada';
          
          const timelineItem = document.createElement('div');
          timelineItem.className = `timeline-item ${typeClass}`;
          timelineItem.style.setProperty('--card-index', index);
          const safePhone = escapeHtml(phone);
          const safeMessage = escapeHtml(message);
          const copyPayload = escapeHtml(encodeURIComponent(String(message || '')));
          timelineItem.innerHTML = `
            <div class="timeline-dot"></div>
            <div class="timeline-card">
              <div class="card-header">
                <span class="contact-name">📱 ${safePhone}</span>
                <span class="message-type ${typeClass}">${typeIcon} ${typeLabel}</span>
                <span class="timestamp">${timeStr}</span>
              </div>
              <div class="card-body">
                <p class="original-message">"${safeMessage}"</p>
              </div>
              <div class="card-footer">
                <span class="date">${dateStr}</span>
                <button class="copy-btn" data-copy-text="${copyPayload}">📋 Copiar</button>
              </div>
            </div>
          `;
          recoverHistory.appendChild(timelineItem);
        });
        
        // CORREÇÃO BUG 4: Atualizar contador
        const countEl = document.getElementById('whlRecoveredCount');
        const badgeEl = document.getElementById('whlRecoveredBadgeCount');
        if (countEl) countEl.textContent = e.data.history.length;
        if (badgeEl) badgeEl.textContent = e.data.history.length;
      }
    }
    
    console.log('[WHL Recover] Histórico carregado:', e.data.total, 'mensagens');
  }
  
  // Histórico limpo
  if (e.data.type === 'WHL_RECOVER_HISTORY_CLEARED') {
    const recoverCount = document.getElementById('whlRecoveredCount');
    const recoverBadgeCount = document.getElementById('whlRecoveredBadgeCount');
    const recoverHistory = document.getElementById('whlRecoverHistory');
    
    if (recoverCount) {
      recoverCount.textContent = '0';
    }
    if (recoverBadgeCount) {
      recoverBadgeCount.textContent = '0';
    }
    
    if (recoverHistory) {
      recoverHistory.innerHTML = '<div class="muted" style="text-align:center;padding:20px">Nenhuma mensagem recuperada ainda...</div>';
    }
    
    console.log('[WHL Recover] Histórico limpo');
  }
});

