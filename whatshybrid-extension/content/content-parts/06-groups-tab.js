/**
 * @file content/content-parts/06-groups-tab.js
 * @description Slice 6516-6635 do content.js original (refactor v9.0.0)
 * @lines 120
 */

// ===== WHL: Bind Grupos (Groups) Tab =====
try {
  const btnLoadGroups = document.getElementById('whlLoadGroups');
  const btnExtractGroupMembers = document.getElementById('whlExtractGroupMembers');
  const btnExportGroupCsv = document.getElementById('whlExportGroupCsv');
  const groupsList = document.getElementById('whlGroupsList');
  const groupMembersBox = document.getElementById('whlGroupMembersNumbers');
  const groupMembersCount = document.getElementById('whlGroupMembersCount');

  let loadedGroups = [];

  if (btnLoadGroups) {
    btnLoadGroups.addEventListener('click', () => {
      btnLoadGroups.disabled = true;
      btnLoadGroups.textContent = '⏳ Carregando...';
      
      // Enviar comando para o store-bridge
      window.postMessage({ type: 'WHL_LOAD_GROUPS' }, window.location.origin);
    });
  }

  if (btnExtractGroupMembers && groupsList && groupMembersBox) {
    btnExtractGroupMembers.addEventListener('click', async () => {
      // Verificar se um grupo está selecionado
      const selectedGroupId = groupsList.value;
      if (!selectedGroupId) {
        alert('❌ Selecione um grupo primeiro!');
        return;
      }

      btnExtractGroupMembers.disabled = true;
      btnExtractGroupMembers.textContent = '⏳ Abrindo grupo...';
      
      // Mostrar indicador de progresso
      const progressIndicator = document.getElementById('whlExtractionProgress');
      const progressBar = document.getElementById('whlExtractionProgressBar');
      const progressText = document.getElementById('whlExtractionProgressText');
      const progressCount = document.getElementById('whlExtractionProgressCount');
      
      if (progressIndicator && progressBar && progressText) {
        progressIndicator.classList.add('active');
        progressBar.style.width = '10%';
        progressText.textContent = 'Abrindo chat do grupo...';
        if (progressCount) {
          progressCount.textContent = '0 membros';
        }
      }

      try {
        // NOVO FLUXO AUTOMATIZADO:
        // 1. Abrir o chat do grupo (internamente)
        console.log('[WHL] Abrindo chat do grupo:', selectedGroupId);
        
        // Atualizar progresso
        if (progressText) {
          progressText.textContent = 'Aguardando chat carregar...';
        }
        if (progressBar) {
          progressBar.style.width = '30%';
        }
        
        // 2. Aguardar um pouco para o chat carregar
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Atualizar progresso
        btnExtractGroupMembers.textContent = '⏳ Extraindo contatos...';
        if (progressText) {
          progressText.textContent = 'Extraindo membros do grupo...';
        }
        if (progressBar) {
          progressBar.style.width = '50%';
        }
        
        // 3. Executar extração via WhatsAppExtractor
        const requestId = Date.now().toString();
        window.postMessage({ 
          type: 'WHL_EXTRACT_GROUP_MEMBERS_BY_ID', 
          groupId: selectedGroupId,
          requestId: requestId 
        }, window.location.origin);
        
      } catch (error) {
        console.error('[WHL] Erro ao processar grupo:', error);
        btnExtractGroupMembers.disabled = false;
        btnExtractGroupMembers.textContent = '📥 Extrair Contatos';
        
        if (progressIndicator) {
          progressIndicator.classList.remove('active');
        }
        
        alert('❌ Erro ao processar grupo: ' + error.message);
      }
    });
  }

  if (btnExportGroupCsv && groupMembersBox) {
    btnExportGroupCsv.addEventListener('click', () => {
      const numbers = groupMembersBox.value.split('\n').filter(n => n.trim());
      if (numbers.length === 0) {
        alert('Nenhum número para exportar');
        return;
      }

      const rows = [['phone']];
      numbers.forEach(phone => rows.push([phone.trim()]));
      
      const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `group_members_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
} catch(e) {
  console.error('[WHL] Falha ao bindar grupos no painel', e);
}

