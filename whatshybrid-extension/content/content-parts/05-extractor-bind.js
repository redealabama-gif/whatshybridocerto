/**
 * @file content/content-parts/05-extractor-bind.js
 * @description Slice 6162-6515 do content.js original (refactor v9.0.0)
 * @lines 354
 */

// ===== WHL: Bind Extrator Isolado ao Painel =====
try {
  const btnExtract = document.getElementById('whlExtractContacts');
  const boxExtract = document.getElementById('whlExtractedNumbers');

  if (btnExtract && boxExtract) {
    btnExtract.addEventListener('click', async () => {
      btnExtract.disabled = true;
      btnExtract.textContent = '⏳ Extraindo...';
      
      const statusEl = document.getElementById('whlExtractStatus');
      if (statusEl) statusEl.textContent = 'Extraindo via API interna...';
      
      // Usar extração instantânea (SEM ROLAGEM)
      window.postMessage({ 
        type: 'WHL_EXTRACT_ALL_INSTANT',
        requestId: Date.now().toString()
      }, window.location.origin);
    });
  }

  window.addEventListener('message', (e) => {
    // Security: Validate message origin
    if (e.origin !== window.location.origin) return;
    if (!e || !e.data) return;

    // Keep the old WHL_EXTRACT_RESULT handler for backward compatibility
    // but it will no longer be used with instant extraction
    if (e.data.type === 'WHL_EXTRACT_RESULT') {
      // Receber resultados categorizados (usado pelo extractor.contacts.js com scroll)
      const normal = e.data.normal || e.data.numbers || [];
      const archived = e.data.archived || [];
      const blocked = e.data.blocked || [];
      
      // Preencher textareas
      if (boxExtract) boxExtract.value = normal.join('\n');
      
      const archivedBox = document.getElementById('whlArchivedNumbers');
      if (archivedBox) archivedBox.value = archived.join('\n');
      
      const blockedBox = document.getElementById('whlBlockedNumbers');
      if (blockedBox) blockedBox.value = blocked.join('\n');
      
      // Atualizar contadores
      const normalCount = document.getElementById('whlNormalCount');
      if (normalCount) normalCount.textContent = normal.length;
      
      const archivedCount = document.getElementById('whlArchivedCount');
      if (archivedCount) archivedCount.textContent = archived.length;
      
      const blockedCount = document.getElementById('whlBlockedCount');
      if (blockedCount) blockedCount.textContent = blocked.length;
      
      const statusEl = document.getElementById('whlExtractStatus');
      const totalCount = normal.length + archived.length + blocked.length;
      if (e.data.cancelled) {
        if (statusEl) statusEl.textContent = `⛔ Extração cancelada. Total: ${totalCount} números (${normal.length} normais, ${archived.length} arquivados, ${blocked.length} bloqueados)`;
      } else {
        if (statusEl) statusEl.textContent = `✅ Finalizado! Total: ${totalCount} números (${normal.length} normais, ${archived.length} arquivados, ${blocked.length} bloqueados)`;
      }
      
      if (btnExtract) {
        btnExtract.disabled = false;
        btnExtract.textContent = '📥 Extrair contatos';
      }
      
      // Item 12: Ensure extraction progress bar disappears after 100%
      setTimeout(() => {
        const progressBar = document.getElementById('whlExtractProgress');
        if (progressBar) progressBar.style.display = 'none';
        const extractControls = document.getElementById('whlExtractControls');
        if (extractControls) extractControls.style.display = 'none';
      }, 2000);
    }
    
    // Handler para extração instantânea
    if (e.data.type === 'WHL_EXTRACT_ALL_INSTANT_RESULT') {
      // CORREÇÃO ISSUE 03: Usar os arrays diretamente, não stats
      const normalContacts = e.data.normal || [];
      const archivedContacts = e.data.archived || [];
      const blockedContacts = e.data.blocked || [];
      
      // Calcular contagens dos arrays
      const normalCount = normalContacts.length;
      const archivedCount = archivedContacts.length;
      const blockedCount = blockedContacts.length;
      const totalCount = normalCount + archivedCount + blockedCount;
      
      console.log('[WHL] Extração instantânea - Normais:', normalCount, 'Arquivados:', archivedCount, 'Bloqueados:', blockedCount);
      
      // Preencher caixas de texto
      const normalBox = document.getElementById('whlExtractedNumbers');
      if (normalBox) normalBox.value = normalContacts.join('\n');
      
      const archivedBox = document.getElementById('whlArchivedNumbers');
      if (archivedBox) archivedBox.value = archivedContacts.join('\n');
      
      const blockedBox = document.getElementById('whlBlockedNumbers');
      if (blockedBox) blockedBox.value = blockedContacts.join('\n');
      
      // CORREÇÃO BUG 1: Atualizar contadores com múltiplos seletores
      const normalCountEl = document.getElementById('whlNormalCount') || 
                            document.querySelector('[data-count="normal"]') ||
                            document.querySelector('.whl-normal-count') ||
                            document.querySelector('#whlNormalCount');
      
      if (normalCountEl) {
        normalCountEl.textContent = normalCount;
        normalCountEl.innerText = normalCount; // Fallback
        console.log('[WHL] ✅ Contador normais atualizado:', normalCount);
      } else {
        console.error('[WHL] ❌ Elemento contador normais não encontrado!');
      }
      
      const archivedCountEl = document.getElementById('whlArchivedCount') ||
                              document.querySelector('[data-count="archived"]') ||
                              document.querySelector('.whl-archived-count');
      if (archivedCountEl) {
        archivedCountEl.textContent = archivedCount;
        archivedCountEl.innerText = archivedCount;
        console.log('[WHL] ✅ Contador arquivados atualizado:', archivedCount);
      } else {
        console.error('[WHL] ❌ Elemento contador arquivados não encontrado!');
      }
      
      const blockedCountEl = document.getElementById('whlBlockedCount') ||
                             document.querySelector('[data-count="blocked"]') ||
                             document.querySelector('.whl-blocked-count');
      if (blockedCountEl) {
        blockedCountEl.textContent = blockedCount;
        blockedCountEl.innerText = blockedCount;
        console.log('[WHL] ✅ Contador bloqueados atualizado:', blockedCount);
      } else {
        console.error('[WHL] ❌ Elemento contador bloqueados não encontrado!');
      }
      
      // Restaurar botão
      const btnExtract = document.getElementById('whlExtractContacts');
      if (btnExtract) {
        btnExtract.disabled = false;
        btnExtract.textContent = '📥 Extrair contatos';
      }
      
      // Status final
      const statusEl = document.getElementById('whlExtractStatus');
      if (statusEl) {
        statusEl.textContent = `✅ Extração finalizada! Total: ${totalCount} números`;
      }
      
      // Item 12: Ensure extraction progress bar disappears after 100%
      setTimeout(() => {
        const progressBar = document.getElementById('whlExtractProgress');
        if (progressBar) {
          progressBar.style.display = 'none';
        }
        const extractControls = document.getElementById('whlExtractControls');
        if (extractControls) {
          extractControls.style.display = 'none';
        }
      }, 2000); // Hide after 2 seconds to allow users to see 100%
      
      // CORREÇÃO: Alert com valores dos arrays, não stats
      alert(`✅ Extração instantânea concluída!\n\n📱 Contatos: ${normalCount}\n📁 Arquivados: ${archivedCount}\n🚫 Bloqueados: ${blockedCount}\n\n📊 Total: ${totalCount}`);
    }
    
    // Handler para erro na extração
    if (e.data.type === 'WHL_EXTRACT_ALL_INSTANT_ERROR') {
      if (btnExtract) {
        btnExtract.disabled = false;
        btnExtract.textContent = '📥 Extrair contatos';
      }
      
      const statusEl = document.getElementById('whlExtractStatus');
      if (statusEl) {
        statusEl.textContent = '❌ Erro na extração: ' + e.data.error;
      }
      
      alert('❌ Erro na extração: ' + e.data.error);
    }
    
    // Handler para extração de arquivados e bloqueados
    if (e.data.type === 'WHL_EXTRACT_ARCHIVED_BLOCKED_DOM_RESULT') {
      const { archived, blocked } = e.data;
      
      const archivedBox = document.getElementById('whlArchivedNumbers');
      if (archivedBox) archivedBox.value = (archived || []).join('\n');
      const archivedCount = document.getElementById('whlArchivedCount');
      if (archivedCount) archivedCount.textContent = (archived || []).length;
      
      const blockedBox = document.getElementById('whlBlockedNumbers');
      if (blockedBox) blockedBox.value = (blocked || []).join('\n');
      const blockedCount = document.getElementById('whlBlockedCount');
      if (blockedCount) blockedCount.textContent = (blocked || []).length;
      
      console.log(`[WHL] Arquivados: ${archived?.length || 0}, Bloqueados: ${blocked?.length || 0}`);
    }

    if (e.data.type === 'WHL_EXTRACT_ERROR') {
      console.error('[WHL] Erro no extrator:', e.data.error);
      alert('Erro ao extrair contatos');
      
      isExtracting = false;
      isPaused = false;
      
      if (extractControls) extractControls.style.display = 'none';
      
      const progressBar = document.getElementById('whlExtractProgress');
      if (progressBar) progressBar.style.display = 'none';
      
      if (btnExtract) {
        btnExtract.disabled = false;
        btnExtract.textContent = '📥 Extrair contatos';
      }
    }
    
    if (e.data.type === 'WHL_EXTRACTION_PAUSED') {
      const statusEl = document.getElementById('whlExtractStatus');
      if (statusEl) statusEl.textContent = 'Extração pausada. Clique em "Continuar" para retomar.';
    }
    
    if (e.data.type === 'WHL_EXTRACTION_RESUMED') {
      const statusEl = document.getElementById('whlExtractStatus');
      if (statusEl) statusEl.textContent = 'Extração retomada...';
    }
  });

  // Copiar TODOS os números (soma de normais + arquivados + bloqueados)
  const btnCopyToClipboard = document.getElementById('whlCopyExtracted');
  if (btnCopyToClipboard) {
    btnCopyToClipboard.addEventListener('click', async () => {
      const normalBox = document.getElementById('whlExtractedNumbers');
      const archivedBox = document.getElementById('whlArchivedNumbers');
      const blockedBox = document.getElementById('whlBlockedNumbers');
      
      const normal = (normalBox?.value || '').split('\n').filter(n => n.trim());
      const archived = (archivedBox?.value || '').split('\n').filter(n => n.trim());
      const blocked = (blockedBox?.value || '').split('\n').filter(n => n.trim());
      
      const allNumbers = [...normal, ...archived, ...blocked].join('\n');
      
      if (!allNumbers.trim()) {
        alert('Nenhum número para copiar. Execute a extração primeiro.');
        return;
      }
      
      try {
        await navigator.clipboard.writeText(allNumbers);
        const originalText = btnCopyToClipboard.textContent;
        btnCopyToClipboard.textContent = '✅ Copiado!';
        setTimeout(() => {
          btnCopyToClipboard.textContent = originalText;
        }, 2000);
        
        const statusEl = document.getElementById('whlExtractStatus');
        if (statusEl) {
          const total = normal.length + archived.length + blocked.length;
          statusEl.textContent = `✅ ${total} números copiados (${normal.length} normais, ${archived.length} arquivados, ${blocked.length} bloqueados)`;
        }
      } catch (err) {
        console.error('[WHL] Erro ao copiar:', err);
        alert('Erro ao copiar números para área de transferência');
      }
    });
  }
  
  // Copiar apenas números NORMAIS
  const btnCopyNormal = document.getElementById('whlCopyNormal');
  if (btnCopyNormal) {
    btnCopyNormal.addEventListener('click', async () => {
      const normalBox = document.getElementById('whlExtractedNumbers');
      const numbers = normalBox?.value || '';
      
      if (!numbers.trim()) {
        alert('Nenhum número normal para copiar.');
        return;
      }
      
      try {
        await navigator.clipboard.writeText(numbers);
        const originalText = btnCopyNormal.textContent;
        btnCopyNormal.textContent = '✅ Copiado!';
        setTimeout(() => {
          btnCopyNormal.textContent = originalText;
        }, 2000);
      } catch (err) {
        console.error('[WHL] Erro ao copiar:', err);
        alert('Erro ao copiar números');
      }
    });
  }
  
  // Copiar apenas números ARQUIVADOS
  const btnCopyArchived = document.getElementById('whlCopyArchived');
  if (btnCopyArchived) {
    btnCopyArchived.addEventListener('click', async () => {
      const archivedBox = document.getElementById('whlArchivedNumbers');
      const numbers = archivedBox?.value || '';
      
      if (!numbers.trim()) {
        alert('Nenhum número arquivado para copiar.');
        return;
      }
      
      try {
        await navigator.clipboard.writeText(numbers);
        const originalText = btnCopyArchived.textContent;
        btnCopyArchived.textContent = '✅ Copiado!';
        setTimeout(() => {
          btnCopyArchived.textContent = originalText;
        }, 2000);
      } catch (err) {
        console.error('[WHL] Erro ao copiar:', err);
        alert('Erro ao copiar números');
      }
    });
  }
  
  // Copiar apenas números BLOQUEADOS
  const btnCopyBlocked = document.getElementById('whlCopyBlocked');
  if (btnCopyBlocked) {
    btnCopyBlocked.addEventListener('click', async () => {
      const blockedBox = document.getElementById('whlBlockedNumbers');
      const numbers = blockedBox?.value || '';
      
      if (!numbers.trim()) {
        alert('Nenhum número bloqueado para copiar.');
        return;
      }
      
      try {
        await navigator.clipboard.writeText(numbers);
        const originalText = btnCopyBlocked.textContent;
        btnCopyBlocked.textContent = '✅ Copiado!';
        setTimeout(() => {
          btnCopyBlocked.textContent = originalText;
        }, 2000);
      } catch (err) {
        console.error('[WHL] Erro ao copiar:', err);
        alert('Erro ao copiar números');
      }
    });
  }

  // Export Extracted CSV
  const btnExportExtractedCsv = document.getElementById('whlExportExtractedCsv');
  if (btnExportExtractedCsv) {
    btnExportExtractedCsv.addEventListener('click', async () => {
      await whlExportExtractedCSV();
    });
  }
} catch(e) {
  console.error('[WHL] Falha ao bindar extrator no painel', e);
}

