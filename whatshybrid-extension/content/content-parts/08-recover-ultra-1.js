/**
 * @file content/content-parts/08-recover-ultra-1.js
 * @description Slice 7146-8500 do content.js original (refactor v9.0.0)
 * @lines 1355
 */

// ===== WHL: Bind Recover Ultra++ Tab =====
// Note: With the new WPP Boladão hooks approach, recovery is always active
// The hooks intercept messages at the protocol level automatically
try {
  const btnExportRecovered = document.getElementById('whlExportRecovered');
  const btnClearRecovered = document.getElementById('whlClearRecovered');
  
  // Update status to show it's always active
  const recoverStatus = document.getElementById('whlRecoverStatus');
  if (recoverStatus) {
    recoverStatus.textContent = '🟢 Ativo';
  }
  
  // Load recover history on init
  window.postMessage({ type: 'WHL_GET_RECOVER_HISTORY' }, window.location.origin);

  if (btnExportRecovered) {
    btnExportRecovered.addEventListener('click', () => {
      // Item 19: Validate history content before allowing JSON export
      const history = localStorage.getItem('whl_recover_history');
      
      // Validate history exists and is not empty
      if (!history || history.trim() === '' || history === '[]' || history === 'null') {
        alert('⚠️ Nenhuma mensagem recuperada para exportar.\n\nO histórico está vazio.');
        return;
      }
      
      // Validate JSON format
      let parsedHistory;
      try {
        parsedHistory = JSON.parse(history);
        if (!Array.isArray(parsedHistory) || parsedHistory.length === 0) {
          alert('⚠️ Nenhuma mensagem recuperada para exportar.\n\nO histórico está vazio.');
          return;
        }
      } catch (e) {
        console.error('[WHL] Erro ao validar histórico:', e);
        alert('❌ Erro ao validar histórico de mensagens.\n\nO formato está corrompido.');
        return;
      }
      
      // Export validated history
      const blob = new Blob([history], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `whl_recover_history_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      
      alert(`✅ Histórico exportado como JSON!\n\n${parsedHistory.length} mensagem(ns) exportada(s).`);
    });
  }

  if (btnClearRecovered) {
    btnClearRecovered.addEventListener('click', () => {
      if (confirm('⚠️ Tem certeza que deseja limpar todo o histórico de mensagens recuperadas?')) {
        window.postMessage({ type: 'WHL_CLEAR_RECOVER_HISTORY' }, window.location.origin);
        alert('✅ Histórico limpo!');
      }
    });
  }
} catch(e) {
  console.error('[WHL] Falha ao bindar recover no painel', e);
}

// persist typing
    document.getElementById('whlNumbers').addEventListener('input', async (e) => {
      const st = await getState();
      st.numbersText = e.target.value || '';
      await setState(st);
    });
    document.getElementById('whlMsg').addEventListener('input', async (e) => {
      const st = await getState();
      st.message = e.target.value || '';
      await setState(st);
      // PR #78: Update preview automatically
      updateMessagePreview();
    });
    
    // PR #78: Add blur and change listeners for preview update
    document.getElementById('whlMsg').addEventListener('blur', updateMessagePreview);
    document.getElementById('whlMsg').addEventListener('change', updateMessagePreview);
    
    // Enter key to auto-generate queue (build table)
    const msgTextarea = document.getElementById('whlMsg');
    if (msgTextarea) {
      msgTextarea.addEventListener('keydown', async (e) => {
        // Check if Enter key was pressed (without Shift for new line)
        if (e.key === 'Enter' && !e.shiftKey) {
          const st = await getState();
          
          // Only auto-build if there are numbers and a message
          if (st.numbersText.trim() && st.message.trim()) {
            e.preventDefault(); // Prevent default new line behavior only when triggering action
            console.log('[WHL] 📨 Enter pressionado - gerando tabela automaticamente');
            // Trigger build queue
            const buildBtn = document.getElementById('whlBuild');
            if (buildBtn) {
              buildBtn.click();
            }
          }
        }
      });
    }
    
    // Item 10: Delay configuration - Validate DelayMin never exceeds DelayMax
    document.getElementById('whlDelayMin').addEventListener('input', async (e) => {
      const st = await getState();
      let newMin = Math.max(1, parseInt(e.target.value) || 5);
      
      // Ensure DelayMin never exceeds DelayMax
      if (newMin > st.delayMax) {
        newMin = st.delayMax;
        e.target.value = newMin;
        alert(`⚠️ O delay mínimo não pode ser maior que o máximo (${st.delayMax}s)`);
      }
      
      st.delayMin = newMin;
      await setState(st);
    });
    document.getElementById('whlDelayMax').addEventListener('input', async (e) => {
      const st = await getState();
      let newMax = Math.max(1, parseInt(e.target.value) || 10);
      
      // Ensure DelayMax is never less than DelayMin
      if (newMax < st.delayMin) {
        newMax = st.delayMin;
        e.target.value = newMax;
        alert(`⚠️ O delay máximo não pode ser menor que o mínimo (${st.delayMin}s)`);
      }
      
      st.delayMax = newMax;
      await setState(st);
    });
    
    // PR #78: Removed obsolete settings event listeners (continueOnError, useWorker, retryMax)
    
    // Schedule
    document.getElementById('whlScheduleAt').addEventListener('input', async (e) => {
      const st = await getState();
      st.scheduleAt = e.target.value || '';
      await setState(st);
      await render();
    });
    // CSV
    document.getElementById('whlCsv').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      const csvHint = document.getElementById('whlCsvHint');
      const clearCsvBtn = document.getElementById('whlClearCsvBtn');
      const selectCsvBtn = document.getElementById('whlSelectCsvBtn');
      
      if (!file) {
        if (csvHint) csvHint.textContent = '';
        if (clearCsvBtn) clearCsvBtn.style.display = 'none';
        if (selectCsvBtn) selectCsvBtn.textContent = '📁 Escolher arquivo';
        return;
      }
      
      const text = await file.text();
      const rows = whlCsvToRows(text);
      const st = await getState();
      const queue = [];
      for (const r of rows) {
        const phone = whlSanitize(r[0]||'');
        const valid = whlIsValidPhone(phone);
        queue.push({ phone, status: valid?'pending':'failed', valid, retries:0 });
      }
      st.queue = queue;
      st.numbersText = queue.map(x=>x.phone).join('\n');
      st.index = 0;
      st.stats = { sent:0, failed: queue.filter(x=>x.status==='failed').length, pending: queue.filter(x=>x.status==='pending').length };
      await setState(st);
      await render();
      
      // Atualizar UI
      if (csvHint) {
        csvHint.textContent = `✅ ${file.name} - ${queue.length} números carregados`;
        csvHint.style.color = '#78ffa0';
      }
      if (clearCsvBtn) {
        clearCsvBtn.style.display = '';
      }
      if (selectCsvBtn) {
        selectCsvBtn.textContent = '📁 Trocar arquivo';
      }
    });
    
    // CSV button handlers
    const selectCsvBtn = document.getElementById('whlSelectCsvBtn');
    if (selectCsvBtn) {
      selectCsvBtn.addEventListener('click', () => {
        const csvInput = document.getElementById('whlCsv');
        if (csvInput) {
          csvInput.click();
        }
      });
    }
    
    const clearCsvBtn = document.getElementById('whlClearCsvBtn');
    if (clearCsvBtn) {
      clearCsvBtn.addEventListener('click', async () => {
        const csvInput = document.getElementById('whlCsv');
        
        // Limpar fila e números
        const st = await getState();
        st.queue = [];
        st.numbersText = '';
        st.index = 0;
        st.stats = { sent: 0, failed: 0, pending: 0 };
        await setState(st);
        await render();
        
        // Clear the file input and trigger change event to update UI
        if (csvInput) {
          csvInput.value = '';
          csvInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }
    
    // Item 6 & 14 & 24: Image validation - size, type, dimensions and immediate preview update
    document.getElementById('whlImage').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      const st = await getState();
      const imageHint = document.getElementById('whlImageHint');
      
      if (!file) { 
        st.imageData = null; 
        await setState(st); 
        await render(); 
        if (imageHint) imageHint.textContent = '';
        return; 
      }
      
      // Validate image type
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        alert('❌ Tipo de arquivo inválido!\n\nApenas imagens são permitidas: JPG, PNG, GIF, WEBP');
        e.target.value = '';
        if (imageHint) imageHint.textContent = '';
        return;
      }
      
      // Validate file size (max 16MB - WhatsApp limit is 16MB for images)
      const maxSize = 16 * 1024 * 1024; // 16MB in bytes
      if (file.size > maxSize) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
        alert(`❌ Imagem muito grande!\n\nTamanho: ${sizeMB}MB\nMáximo permitido: 16MB`);
        e.target.value = '';
        if (imageHint) imageHint.textContent = '';
        return;
      }
      
      // Read image to validate dimensions
      const imageDataURL = await whlReadFileAsDataURL(file);
      
      // Create image element to get dimensions
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imageDataURL;
      });
      
      // Validate dimensions (reasonable limits)
      const maxDimension = 4096; // 4K resolution
      if (img.width > maxDimension || img.height > maxDimension) {
        alert(`❌ Dimensões muito grandes!\n\nDimensões: ${img.width}x${img.height}px\nMáximo: ${maxDimension}x${maxDimension}px`);
        e.target.value = '';
        if (imageHint) imageHint.textContent = '';
        return;
      }
      
      // All validations passed - save image
      st.imageData = imageDataURL;
      await setState(st);
      
      // Item 24: Display size and dimensions in preview
      const fileSizeKB = (file.size / 1024).toFixed(2);
      if (imageHint) {
        imageHint.textContent = `✅ ${file.name} - ${fileSizeKB}KB - ${img.width}x${img.height}px`;
        imageHint.style.color = '#78ffa0';
      }
      
      // Item 14: Force immediate preview update
      await render();
      
      // Force preview image update
      const previewImg = document.getElementById('whlPreviewImg');
      if (previewImg) {
        previewImg.src = imageDataURL;
        previewImg.style.display = 'block';
      }
    });
    
    // Image button handlers
    const selectImageBtn = document.getElementById('whlSelectImageBtn');
    if (selectImageBtn) {
      selectImageBtn.addEventListener('click', () => {
        // Trigger the hidden file input
        const imageInput = document.getElementById('whlImage');
        if (imageInput) {
          imageInput.click();
        }
      });
    }
    
    const clearImageBtn = document.getElementById('whlClearImageBtn');
    if (clearImageBtn) {
      clearImageBtn.addEventListener('click', async () => {
        // Clear the file input and trigger change event to handle state update
        const fileInput = document.getElementById('whlImage');
        if (fileInput) {
          fileInput.value = '';
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }
    
    // Drafts
    document.getElementById('whlSaveDraft').addEventListener('click', async () => {
      const nameInput = document.getElementById('whlDraftName');
      const name = nameInput?.value?.trim() || '';
      
      if (!name) {
        alert('Por favor, digite um nome para o rascunho.');
        return;
      }
      
      // Item 16: Request confirmation before overwriting duplicate drafts
      const st = await getState();
      if (st.drafts && st.drafts[name]) {
        const confirmed = confirm(`⚠️ Já existe um rascunho com o nome "${name}".\n\nDeseja sobrescrevê-lo?`);
        if (!confirmed) {
          return;
        }
      }
      
      await saveDraft(name);
      
      if (nameInput) nameInput.value = '';
      
      alert(`✅ Rascunho "${name}" salvo com sucesso!`);
    });
    
    // Render drafts table on load
    await renderDraftsTable();
    // Report
    document.getElementById('whlExportReport').addEventListener('click', async ()=>{ await whlExportReportCSV(); const h=document.getElementById('whlReportHint'); if(h) h.textContent='✅ Exportado.'; });
    document.getElementById('whlCopyFailed').addEventListener('click', async ()=>{ const st=await getState(); const f=(st.queue||[]).filter(x=>x.status==='failed'||x.valid===false).map(x=>x.phone).join('\n'); await navigator.clipboard.writeText(f); const h=document.getElementById('whlReportHint'); if(h) h.textContent='✅ Falhas copiadas.'; });

    // Save message button
    document.getElementById('whlSaveMessage').addEventListener('click', async () => {
      const st = await getState();
      const msgValue = document.getElementById('whlMsg').value || '';
      
      if (!msgValue.trim()) {
        alert('Por favor, digite uma mensagem antes de salvar.');
        return;
      }
      
      // Save to drafts with a timestamp-based name
      const timestamp = new Date().toLocaleString('pt-BR');
      const name = prompt('Nome da mensagem salva:', `Mensagem ${timestamp}`) || `Mensagem ${timestamp}`;
      
      st.drafts = st.drafts || {};
      st.drafts[name] = {
        numbersText: st.numbersText,
        message: msgValue,
        imageData: st.imageData,
        delayMin: st.delayMin,
        delayMax: st.delayMax,
        retryMax: st.retryMax,
        scheduleAt: st.scheduleAt,
        typingEffect: st.typingEffect
      };
      
      await setState(st);
      alert(`✅ Mensagem "${name}" salva com sucesso!`);
    });

    document.getElementById('whlBuild').addEventListener('click', buildQueueFromInputs);
    // Item 22: Require confirmation before clearing main fields
    document.getElementById('whlClear').addEventListener('click', async () => {
      const st = await getState();
      const hasNumbers = st.numbersText && st.numbersText.trim();
      const hasMessage = st.message && st.message.trim();
      
      if (hasNumbers || hasMessage) {
        const confirmed = confirm('⚠️ Tem certeza que deseja limpar os campos principais?\n\nNúmeros e mensagem serão apagados.');
        if (!confirmed) return;
      }
      
      st.numbersText = '';
      st.message = '';
      await setState(st);
      await render();
    });

    // Campaign controls
    document.getElementById('whlStartCampaign').addEventListener('click', startCampaign);
    document.getElementById('whlPauseCampaign').addEventListener('click', pauseCampaign);
    document.getElementById('whlStopCampaign').addEventListener('click', stopCampaign);

    document.getElementById('whlSkip').addEventListener('click', skip);
    document.getElementById('whlWipe').addEventListener('click', wipe);

    // PR #78: Emoji Picker
    const emojiBtn = document.getElementById('whlEmojiBtn');
    const emojiPicker = document.getElementById('whlEmojiPicker');
    const emojiMsgTextarea = document.getElementById('whlMsg');
    
    if (emojiBtn && emojiPicker && emojiMsgTextarea) {
      // Emoji list - categorized
      const emojis = [
        // Smileys
        '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', 
        '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜',
        '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐',
        '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪',
        '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶',
        // Gestures
        '👍', '👎', '👊', '✊', '🤛', '🤜', '🤞', '✌️', '🤟', '🤘',
        '👌', '🤌', '🤏', '👈', '👉', '👆', '👇', '☝️', '👋', '🤚',
        '🖐️', '✋', '🖖', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '💪',
        // Hearts & Symbols
        '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
        '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️',
        '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '⛎',
        '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑',
        // Common
        '⭐', '🌟', '✨', '⚡', '🔥', '💥', '💫', '💦', '💨', '🌈',
        '☀️', '🌤️', '⛅', '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️',
        '✅', '❌', '⚠️', '🚫', '📌', '📍', '🎉', '🎊', '🎈', '🎁'
      ];
      
      // Populate emoji picker
      const emojiGrid = emojiPicker.querySelector('div');
      if (emojiGrid) {
        emojiGrid.innerHTML = emojis.map(e => 
          `<span class="emoji-item" style="font-size:22px;cursor:pointer;padding:4px;border-radius:6px;display:flex;align-items:center;justify-content:center;transition:background 0.1s" onmouseover="this.style.background='rgba(111,0,255,0.2)'" onmouseout="this.style.background='transparent'">${e}</span>`
        ).join('');
        
        // Handle emoji selection
        emojiGrid.addEventListener('click', (e) => {
          if (e.target.classList.contains('emoji-item')) {
            const emoji = e.target.textContent;
            
            // Insert at cursor position
            const start = emojiMsgTextarea.selectionStart;
            const end = emojiMsgTextarea.selectionEnd;
            const text = emojiMsgTextarea.value;
            
            emojiMsgTextarea.value = text.substring(0, start) + emoji + text.substring(end);
            emojiMsgTextarea.selectionStart = emojiMsgTextarea.selectionEnd = start + emoji.length;
            emojiMsgTextarea.focus();
            
            // Update preview
            updateMessagePreview();
            
            // Hide picker
            emojiPicker.style.display = 'none';
          }
        });
      }
      
      // Toggle picker
      emojiBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (emojiPicker.style.display === 'none' || !emojiPicker.style.display) {
          // Position picker
          const btnRect = emojiBtn.getBoundingClientRect();
          emojiPicker.style.display = 'block';
          emojiPicker.style.position = 'absolute';
          emojiPicker.style.right = '10px';
          emojiPicker.style.top = (btnRect.bottom + 5) + 'px';
        } else {
          emojiPicker.style.display = 'none';
        }
      });
      
      // Close picker when clicking outside
      document.addEventListener('click', (e) => {
        if (emojiPicker.style.display !== 'none' && 
            !emojiPicker.contains(e.target) && 
            e.target !== emojiBtn) {
          emojiPicker.style.display = 'none';
        }
      });
    }

    document.getElementById('whlHide').addEventListener('click', async () => {
      const st = await getState();
      st.panelVisible = false;
      await setState(st);
      await render();
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // ===== FUSION: Side Panel Bridge (UI lives in Side Panel, logic stays here) =====
    if (msg?.type === 'WHL_SIDE_PANEL') {
      (async () => {
        try {
          const cmd = msg.cmd;

          // Ensure the original panel DOM exists (even if hidden)
          try { ensurePanel(); } catch {}

if (cmd === 'GET_STATE') {


  const st = await getState();





  // Modo "light": evita mandar a fila inteira repetidamente para o Side Panel.


  if (msg.light) {


    const queue = Array.isArray(st.queue) ? st.queue : [];


    let sent = 0, failed = 0, pending = 0;


    for (const c of queue) {


      if (!c) continue;


      if (c.status === 'sent') sent++;


      else if (c.status === 'failed') failed++;


      else pending++;


    }





    sendResponse({


      success: true,


      state: {


        isRunning: !!st.isRunning,


        isPaused: !!st.isPaused,


        index: st.index || 0,


        delayMin: st.delayMin,


        delayMax: st.delayMax,


        scheduleAt: st.scheduleAt || '',


        queueTotal: queue.length,


        queueSent: sent,


        queueFailed: failed,


        queuePending: pending,


      }


    });


    return;


  }





  sendResponse({ success: true, state: st });


  return;


}

          if (cmd === 'SET_PANEL_VISIBLE') {
            const st = await getState();
            st.panelVisible = !!msg.visible;
            await setState(st);
            await render();
            sendResponse({ success: true });
            return;
          }

          // ======= Side Panel: campos/arquivos/ações extras (sem reescrever a lógica do motor) =======

          if (cmd === 'SET_FIELDS') {
            const st = await getState();
            if (typeof msg.numbersText === 'string') st.numbersText = msg.numbersText;
            if (typeof msg.messageText === 'string') st.message = msg.messageText;

            // mantém os inputs do painel interno sincronizados (o painel fica hidden)
            const numbersEl = document.getElementById('whlNumbers');
            const msgEl = document.getElementById('whlMsg');
            if (numbersEl && typeof st.numbersText === 'string') numbersEl.value = st.numbersText;
            if (msgEl && typeof st.message === 'string') msgEl.value = st.message;

            await setState(st);
            sendResponse({ success: true });
            return;
          }

          if (cmd === 'CLEAR_FIELDS') {
            const st = await getState();
            st.numbersText = '';
            st.message = '';

            const numbersEl = document.getElementById('whlNumbers');
            const msgEl = document.getElementById('whlMsg');
            if (numbersEl) numbersEl.value = '';
            if (msgEl) msgEl.value = '';

            await setState(st);
            sendResponse({ success: true });
            return;
          }

          if (cmd === 'SET_IMAGE_DATA') {
            const st = await getState();
            st.imageData = msg.imageData || null;

            // hint interno (opcional)
            const hint = document.getElementById('whlImageHint');
            if (hint) hint.textContent = st.imageData ? 'Imagem pronta para envio.' : 'Nenhuma imagem selecionada.';

            await setState(st);
            sendResponse({ success: true });
            return;
          }


          if (cmd === 'SET_FILE_DATA') {
            const st = await getState();
            st.fileData = msg.fileData || null;
            st.fileName = msg.filename || null;
            st.fileMimeType = msg.mimeType || null;

            const hint = document.getElementById('whlImageHint');
            if (hint) hint.textContent = st.fileData ? 'Arquivo pronto para envio.' : (st.imageData ? 'Imagem pronta para envio.' : 'Nenhuma mídia selecionada.');

            await setState(st);
            sendResponse({ success: true });
            return;
          }

          if (cmd === 'SET_AUDIO_DATA') {
            const st = await getState();
            st.audioData = msg.audioData || null;
            st.audioFilename = msg.filename || null;
            st.audioMimeType = msg.mimeType || null;
            st.audioDuration = Number(msg.duration || 0);

            const hint = document.getElementById('whlImageHint');
            if (hint) hint.textContent = st.audioData ? 'Áudio pronto para envio.' : (st.imageData ? 'Imagem pronta para envio.' : (st.fileData ? 'Arquivo pronto para envio.' : 'Nenhuma mídia selecionada.'));

            await setState(st);
            sendResponse({ success: true });
            return;
          }

          if (cmd === 'IMPORT_CSV_TEXT') {
            const csvText = String(msg.csvText || '');
            if (!csvText.trim()) {
              sendResponse({ success: false, message: 'CSV vazio.' });
              return;
            }

            try {
              const rows = whlCsvToRows(csvText);
              if (!rows || rows.length < 2) {
                sendResponse({ success: false, message: 'CSV precisa de cabeçalho e pelo menos 1 linha.' });
                return;
              }

              const header = rows[0] || [];
              const phoneCol = header.findIndex(h => /phone|numero|number|celular|mobile/i.test(String(h || '')));
              const msgCol = header.findIndex(h => /message|mensagem|msg|texto/i.test(String(h || '')));

              if (phoneCol === -1) {
                sendResponse({ success: false, message: 'Coluna de telefone não encontrada. Use "phone" / "numero".' });
                return;
              }

              const contacts = [];
              for (let i = 1; i < rows.length; i++) {
                const r = rows[i] || [];
                const rawPhone = r[phoneCol];
                if (!rawPhone) continue;

                const phone = whlSanitize(String(rawPhone));
                if (!phone) continue;

                const valid = whlIsValidPhone(phone);
                const customMessage = (msgCol !== -1 ? String(r[msgCol] || '').trim() : '');

                contacts.push({
                  phone,
                  valid,
                  status: valid ? 'pending' : 'failed',
                  retries: 0,
                  lastError: valid ? null : 'Número inválido',
                  customMessage: customMessage || null,
                });
              }

              const st = await getState();
              st.queue = contacts;
              st.index = 0;
              st.numbersText = contacts.map(c => c.phone).join('\n');
              st.stats = {
                sent: 0,
                failed: contacts.filter(c => !c.valid).length,
                pending: contacts.filter(c => c.valid).length
              };

              // sync inputs internos
              const numbersEl = document.getElementById('whlNumbers');
              if (numbersEl) numbersEl.value = st.numbersText;

              await setState(st);
              await render();

              const validCount = st.stats.pending;
              const invalidCount = st.stats.failed;
              sendResponse({
                success: true,
                message: `✅ CSV importado: ${contacts.length} contato(s) (${validCount} válidos, ${invalidCount} inválidos).`,
                state: st
              });
              return;
            } catch (err) {
              sendResponse({ success: false, message: err?.message || String(err) });
              return;
            }
          }

          if (cmd === 'CLEAR_CSV') {
            const st = await getState();
            st.numbersText = '';
            st.queue = [];
            st.index = 0;
            st.isRunning = false;
            st.isPaused = false;
            st.lastSentAt = null;
            st.stats = { sent: 0, failed: 0, pending: 0 };

            const numbersEl = document.getElementById('whlNumbers');
            if (numbersEl) numbersEl.value = '';

            await setState(st);
            await render();

            sendResponse({ success: true });
            return;
          }

          if (cmd === 'DELETE_QUEUE_ITEM') {
            const idx = Number(msg.index);
            const st = await getState();
            if (!Array.isArray(st.queue) || st.queue.length === 0) {
              sendResponse({ success: false, message: 'Fila vazia.' });
              return;
            }
            if (!Number.isFinite(idx) || idx < 0 || idx >= st.queue.length) {
              sendResponse({ success: false, message: 'Índice inválido.' });
              return;
            }

            st.queue.splice(idx, 1);
            if (idx < st.index) st.index = Math.max(0, st.index - 1);
            if (st.index >= st.queue.length) st.index = st.queue.length;

            st.stats = { sent: 0, failed: 0, pending: 0 };
            await setState(st);
            await render();

            sendResponse({ success: true, state: st });
            return;
          }

          if (cmd === 'SKIP_CURRENT') {
            const st = await getState();
            if (!Array.isArray(st.queue) || st.queue.length === 0) {
              sendResponse({ success: false, message: 'Fila vazia.' });
              return;
            }
            if (st.index >= st.queue.length) {
              sendResponse({ success: false, message: 'Fim da fila.' });
              return;
            }

            const current = st.queue[st.index];
            if (current) {
              current.status = 'failed';
              current.lastError = 'Pulado manualmente';
              st.queue[st.index] = current;
            }

            st.index = Math.min(st.index + 1, st.queue.length);
            st.lastSentAt = null;
            st.stats = { sent: 0, failed: 0, pending: 0 };

            await setState(st);
            await render();

            try { toast('Contato pulado.'); } catch {}
            sendResponse({ success: true, state: st });
            return;
          }

          if (cmd === 'WIPE_QUEUE') {
            const st = await getState();
            st.queue = [];
            st.index = 0;
            st.isRunning = false;
            st.isPaused = false;
            st.stats = { sent: 0, failed: 0, pending: 0 };
            st.lastSentAt = null;

            await setState(st);
            await render();

            try { toast('Fila zerada.'); } catch {}
            sendResponse({ success: true, state: st });
            return;
          }

          if (cmd === 'SAVE_MESSAGE_DRAFT') {
            const name = String(msg.name || '').trim();
            if (!name) {
              sendResponse({ success: false, message: 'Nome inválido.' });
              return;
            }

            const st = await getState();
            st.drafts = st.drafts || {};

            // valores enviados pelo Side Panel (ou o estado atual)
            const numbersText = (typeof msg.numbersText === 'string') ? msg.numbersText : (st.numbersText || '');
            const messageText = (typeof msg.messageText === 'string') ? msg.messageText : (st.message || '');
            const imageData = (typeof msg.imageData === 'string') ? msg.imageData : (st.imageData || null);

            // contatos extraídos (texto) do painel interno
            const normal = document.getElementById('whlNormal')?.value || '';
            const archived = document.getElementById('whlArchived')?.value || '';
            const blocked = document.getElementById('whlBlocked')?.value || '';

            st.drafts[name] = {
              numbersText,
              message: messageText,
              normal,
              archived,
              blocked,
              queue: st.queue || [],
              imageData,
              delayMin: st.delayMin,
              delayMax: st.delayMax,
              scheduleAt: st.scheduleAt || '',
              stats: st.stats || { sent: 0, failed: 0, pending: 0 },
              index: st.index || 0,
              savedAt: Date.now(),
            };

            await setState(st);
            sendResponse({ success: true, message: `✅ Salvo: ${name}` });
            return;
          }

          if (cmd === 'SAVE_DRAFT') {
            const name = String(msg.name || '').trim();
            if (!name) {
              sendResponse({ success: false, message: 'Nome inválido.' });
              return;
            }

            const st = await getState();
            st.drafts = st.drafts || {};

            const numbersText = st.numbersText || '';
            const messageText = st.message || '';
            const normal = document.getElementById('whlNormal')?.value || '';
            const archived = document.getElementById('whlArchived')?.value || '';
            const blocked = document.getElementById('whlBlocked')?.value || '';

            st.drafts[name] = {
              numbersText,
              message: messageText,
              normal,
              archived,
              blocked,
              queue: st.queue || [],
              imageData: st.imageData || null,
              delayMin: st.delayMin,
              delayMax: st.delayMax,
              scheduleAt: st.scheduleAt || '',
              stats: st.stats || { sent: 0, failed: 0, pending: 0 },
              index: st.index || 0,
              savedAt: Date.now(),
            };

            await setState(st);
            sendResponse({ success: true, message: `✅ Rascunho salvo: ${name}` });
            return;
          }

          if (cmd === 'LOAD_DRAFT') {
            const name = String(msg.name || '').trim();
            const st = await getState();
            const draft = st.drafts?.[name];

            if (!draft) {
              sendResponse({ success: false, message: 'Rascunho não encontrado.' });
              return;
            }

            // aplica no estado
            st.numbersText = draft.numbersText || '';
            st.message = draft.message || '';
            st.queue = Array.isArray(draft.queue) ? draft.queue : [];
            st.index = Number.isFinite(draft.index) ? draft.index : 0;
            st.stats = draft.stats || { sent: 0, failed: 0, pending: 0 };
            st.delayMin = (typeof draft.delayMin === 'number') ? draft.delayMin : st.delayMin;
            st.delayMax = (typeof draft.delayMax === 'number') ? draft.delayMax : st.delayMax;
            st.scheduleAt = draft.scheduleAt || '';
            st.imageData = draft.imageData || null;

            // sync inputs internos
            const numbersEl = document.getElementById('whlNumbers');
            const msgEl = document.getElementById('whlMsg');
            if (numbersEl) numbersEl.value = st.numbersText;
            if (msgEl) msgEl.value = st.message;

            const normalEl = document.getElementById('whlNormal');
            const archivedEl = document.getElementById('whlArchived');
            const blockedEl = document.getElementById('whlBlocked');
            if (normalEl) normalEl.value = draft.normal || '';
            if (archivedEl) archivedEl.value = draft.archived || '';
            if (blockedEl) blockedEl.value = draft.blocked || '';

            const hint = document.getElementById('whlImageHint');
            if (hint) hint.textContent = st.imageData ? 'Imagem pronta para envio.' : 'Nenhuma imagem selecionada.';

            await setState(st);
            await render();

            sendResponse({ success: true, message: `✅ Rascunho carregado: ${name}`, state: st });
            return;
          }

          if (cmd === 'DELETE_DRAFT') {
            const name = String(msg.name || '').trim();
            const st = await getState();
            if (!st.drafts?.[name]) {
              sendResponse({ success: false, message: 'Rascunho não encontrado.' });
              return;
            }
            delete st.drafts[name];
            await setState(st);
            sendResponse({ success: true, message: `✅ Rascunho excluído: ${name}` });
            return;
          }



          if (cmd === 'BUILD_QUEUE') {
            const numbersEl = document.getElementById('whlNumbers');
            const msgEl = document.getElementById('whlMsg');
            const dMinEl = document.getElementById('whlDelayMin');
            const dMaxEl = document.getElementById('whlDelayMax');
            const schedEl = document.getElementById('whlScheduleAt');

            if (numbersEl) numbersEl.value = msg.numbersText || '';
            if (msgEl) msgEl.value = msg.messageText || '';
            if (dMinEl && msg.delayMin != null) dMinEl.value = String(msg.delayMin);
            if (dMaxEl && msg.delayMax != null) dMaxEl.value = String(msg.delayMax);
            if (schedEl) schedEl.value = msg.scheduleAt || '';

            const st = await getState();
            st.panelVisible = false;
            st.delayMin = Number(msg.delayMin ?? st.delayMin ?? 2);
            st.delayMax = Number(msg.delayMax ?? st.delayMax ?? 6);
            st.scheduleAt = msg.scheduleAt || '';
            st.numbersText = msg.numbersText || '';
            st.message = msg.messageText || '';
            await setState(st);

            await buildQueueFromInputs();

            const st2 = await getState();
            sendResponse({ success: true, state: st2 });
            return;
          }

          if (cmd === 'START_CAMPAIGN') {
            const schedEl = document.getElementById('whlScheduleAt');
            if (schedEl && msg.scheduleAt != null) schedEl.value = msg.scheduleAt || '';

            const st = await getState();
            if (msg.scheduleAt != null) st.scheduleAt = msg.scheduleAt || '';
            st.panelVisible = false;
            await setState(st);

            await startCampaign();
            sendResponse({ success: true });
            return;
          }

          if (cmd === 'PAUSE_TOGGLE') {
            await pauseCampaign();
            sendResponse({ success: true });
            return;
          }

          if (cmd === 'STOP_CAMPAIGN') {
            await stopCampaign();
            sendResponse({ success: true });
            return;
          }

          if (cmd === 'EXTRACT_CONTACTS') {
            // Extração instantânea via wpp-hooks (sem depender do painel visível)
            const requestId = msg.requestId || (Date.now().toString() + '_' + Math.random().toString(16).slice(2));
            const timeoutMs = Number(msg.timeoutMs || 15000);

            const result = await new Promise((resolve, reject) => {
              let timeout = null;
              const handler = (e) => {
                try {
                  if (e.origin !== window.location.origin) return;
                  const data = e?.data || {};
                  if (data.type === 'WHL_EXTRACT_ALL_INSTANT_RESULT' && data.requestId === requestId) {
                    window.removeEventListener('message', handler);
                    if (timeout) clearTimeout(timeout);
                    resolve(data);
                  }
                } catch (err) {
                  // ignore
                }
              };
              window.addEventListener('message', handler);
              timeout = setTimeout(() => {
                window.removeEventListener('message', handler);
                reject(new Error('Timeout na extração de contatos'));
              }, timeoutMs);

              window.postMessage({
                type: 'WHL_EXTRACT_ALL_INSTANT',
                requestId
              }, window.location.origin);
            });

            const normalArr = Array.isArray(result.normal) ? result.normal : [];
            const archivedArr = Array.isArray(result.archived) ? result.archived : [];
            const blockedArr = Array.isArray(result.blocked) ? result.blocked : [];

            const normalStr = normalArr.join('\n');
            const archivedStr = archivedArr.join('\n');
            const blockedStr = blockedArr.join('\n');

            // Atualizar campos do motor (se existirem) para compatibilidade com GET_EXTRACTED_CONTACTS
            const normalBox = document.getElementById('whlExtractedNumbers');
            const archivedBox = document.getElementById('whlArchivedNumbers');
            const blockedBox = document.getElementById('whlBlockedNumbers');

            if (normalBox) normalBox.value = normalStr;
            if (archivedBox) archivedBox.value = archivedStr;
            if (blockedBox) blockedBox.value = blockedStr;

            const normalCountEl = document.getElementById('whlNormalCount');
            const archivedCountEl = document.getElementById('whlArchivedCount');
            const blockedCountEl = document.getElementById('whlBlockedCount');

            if (normalCountEl) normalCountEl.textContent = String(normalArr.length);
            if (archivedCountEl) archivedCountEl.textContent = String(archivedArr.length);
            if (blockedCountEl) blockedCountEl.textContent = String(blockedArr.length);

            const statusEl = document.getElementById('whlExtractStatus');
            if (statusEl) statusEl.textContent = `✅ Extraído: ${normalArr.length} normais, ${archivedArr.length} arquivados, ${blockedArr.length} bloqueados`;

            sendResponse({
              success: true,
              data: {
                normal: normalStr,
                archived: archivedStr,
                blocked: blockedStr,
                counts: { normal: normalArr.length, archived: archivedArr.length, blocked: blockedArr.length }
              }
            });
            return;
          }

          if (cmd === 'GET_EXTRACTED_CONTACTS') {
            const normal = (document.getElementById('whlExtractedNumbers')?.value || '').trim();
            const archived = (document.getElementById('whlArchivedNumbers')?.value || '').trim();
            const blocked = (document.getElementById('whlBlockedNumbers')?.value || '').trim();

            const normalCount = Number(document.getElementById('whlNormalCount')?.textContent || 0);
            const archivedCount = Number(document.getElementById('whlArchivedCount')?.textContent || 0);
            const blockedCount = Number(document.getElementById('whlBlockedCount')?.textContent || 0);

            sendResponse({
              success: true,
              data: { normal, archived, blocked, counts: { normal: normalCount, archived: archivedCount, blocked: blockedCount } }
            });
            return;
          }
          if (cmd === 'SET_SETTINGS') {
            const st = await getState();
            
            // Update state with new settings
            if (typeof msg.delayMin === 'number') {
                st.delayMin = Math.max(1, msg.delayMin);
            }
            if (typeof msg.delayMax === 'number') {
                st.delayMax = Math.max(st.delayMin, msg.delayMax);
            }
            if (typeof msg.scheduleAt === 'string') {
                st.scheduleAt = msg.scheduleAt;
            }
            
            // Legacy settings (for backward compatibility)
            if (msg.continueOnError != null) st.continueOnError = !!msg.continueOnError;
            if (msg.typingEffect != null) st.typingEffect = !!msg.typingEffect;
            if (msg.typingDelayMs != null) st.typingDelayMs = Number(msg.typingDelayMs) || 0;
            if (msg.openInNewTab != null) st.openInNewTab = !!msg.openInNewTab;
            
            // Sincronizar com os inputs internos se existirem
            const dMinEl = document.getElementById('whlDelayMin');
            const dMaxEl = document.getElementById('whlDelayMax');
            const schedEl = document.getElementById('whlScheduleAt');
            
            if (dMinEl) dMinEl.value = String(st.delayMin);
            if (dMaxEl) dMaxEl.value = String(st.delayMax);
            if (schedEl) schedEl.value = st.scheduleAt || '';
            
            // Keep the old central overlay hidden in the Fusion build
            st.panelVisible = false;

            await setState(st);
            await render();
            sendResponse({ success: true, message: '✅ Configurações salvas com sucesso!' });
            return;
          }


          if (cmd === 'GET_RECOVER_HISTORY') {
            let history = [];
            try {
              const saved = localStorage.getItem('whl_recover_history');
              if (saved) history = JSON.parse(saved) || [];
            } catch {}
            sendResponse({ success: true, history });
            return;
          }

          if (cmd === 'CLEAR_RECOVER_HISTORY') {
            try { localStorage.removeItem('whl_recover_history'); } catch {}
            // Keep UI hidden
            const st = await getState();
            st.panelVisible = false;
            await setState(st);
            await render();
            sendResponse({ success: true });
            return;
          }

          sendResponse({ success: false, error: 'cmd inválido' });
        } catch (e) {
          sendResponse({ success: false, error: e?.message || String(e) });
        }
      })();
      return true; // async response
    }
    if (msg?.type === 'WHL_TOGGLE_PANEL') {
      (async () => {
        const st = await getState();
        st.panelVisible = !st.panelVisible;
        await setState(st);
        await render();
      })();
    }
    
    // PR #79: Handle tab switching from popup
    if (msg?.type === 'WHL_SWITCH_TAB') {
      const targetTab = msg.tab;
      if (targetTab) {
        setTimeout(() => {
          const tabBtn = document.querySelector(`.whl-tab[data-tab="${targetTab}"]`);
          if (tabBtn) {
            tabBtn.click();
          }
        }, 100);
      }
    }
    
    // NEW: Handle worker-related messages
    if (msg?.action === 'CAMPAIGN_PROGRESS') {
      (async () => {
        const st = await getState();
        // Update index if worker is ahead
        if (msg.current > st.index) {
          st.index = msg.current;
          await setState(st);
        }
        await render();
      })();
    }
    
    if (msg?.action === 'SEND_RESULT') {
      (async () => {
        const st = await getState();
        // Find the contact in queue and update status
        const contact = st.queue.find(c => c.phone === msg.phone);
        if (contact) {
          contact.status = msg.status;
          if (msg.error) contact.error = msg.error;
          
          // Update stats
          st.stats.sent = st.queue.filter(c => c.status === 'sent').length;
          st.stats.failed = st.queue.filter(c => c.status === 'failed').length;
          st.stats.pending = st.queue.filter(c => c.status === 'pending' || c.status === 'opened').length;
          
          await setState(st);
          await render();
        }
      })();
    }
    
    if (msg?.action === 'CAMPAIGN_COMPLETED') {
      (async () => {
        const st = await getState();
        st.isRunning = false;
        st.isPaused = false;
        await setState(st);
        await render();
        alert('🎉 Campanha finalizada!');
      })();
    }
    
    if (msg?.action === 'WORKER_CLOSED') {
      (async () => {
        const st = await getState();
        st.isPaused = true;
        await setState(st);
        await render();
        alert('⚠️ A aba worker foi fechada. A campanha foi pausada.');
      })();
    }
    
    if (msg?.action === 'WORKER_STATUS_UPDATE') {
      console.log('[WHL] Worker status:', msg.status);
      if (msg.status === 'QR_CODE_REQUIRED') {
        alert('⚠️ A aba worker precisa escanear o QR Code do WhatsApp.');
      }
    }
    
    if (msg?.action === 'WORKER_ERROR') {
      console.error('[WHL] Worker error:', msg.error);
      alert('❌ Erro no worker: ' + msg.error);
    }
  });

  // Item 5: Close panel when pressing ESC
  document.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      const st = await getState();
      if (st.panelVisible) {
        st.panelVisible = false;
        await setState(st);
        await render();
        e.preventDefault();
        e.stopPropagation();
      }
    }
  });

  // init
  (async () => {
    bindOnce();
    await whlUpdateSelectorHealth();
    await render();
    
    // Check and resume campaign if needed (for URL navigation)
    await checkAndResumeCampaignAfterURLNavigation();
    
    console.log('[WHL] Extension initialized');
  })();


  // ===== IMAGE AUTO SEND (FROM ORIGINAL) =====
  // ATUALIZADO: Usa APENAS seletor CONFIRMADO pelo usuário
  function getAttachButton() {
    // Seletores atualizados 2024/2025
    const attachSelectors = [
      'footer button[aria-label*="Anexar"]',
      'footer button[title*="Anexar"]',
      '[data-testid="attach-clip"]',
      '[data-testid="clip"]',
      'footer span[data-icon="attach-menu-plus"]',
      'footer span[data-icon="clip"]',
      'footer span[data-icon="attach"]',
      '[aria-label="Anexar"]',
      'button[aria-label*="Attach"]'
    ];
    
    for (const sel of attachSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const btn = el.closest('button') || el;
          if (btn.offsetWidth) {
            console.log('[WHL] ✅ Botão de anexar encontrado via:', sel);
            return btn;
          }
