/**
 * @file content/content-parts/03-state-storage.js
 * @description Slice 3001-4500 do content.js original (refactor v9.0.0)
 * @lines 1500
 */

      whlLog.error('Erro ao exportar CSV:', err);
      if (statusEl) {
        statusEl.textContent = '❌ Erro ao exportar CSV';
        statusEl.style.color = '#ef4444';
      }
    }
  }

  // ===== DRAFT MANAGEMENT FUNCTIONS =====
  async function saveDraft(name) {
    const st = await getState();
    
    const draft = {
      name: name,
      savedAt: new Date().toISOString(),
      // Configurações
      delayMin: st.delayMin,
      delayMax: st.delayMax,
      retryMax: st.retryMax,
      scheduleAt: st.scheduleAt,
      typingEffect: st.typingEffect,
      continueOnError: st.continueOnError,
      // Conteúdo
      numbersText: st.numbersText,
      message: st.message,
      imageData: st.imageData,
      // Contatos extraídos
      extractedNormal: document.getElementById('whlExtractedNumbers')?.value || '',
      extractedArchived: document.getElementById('whlArchivedNumbers')?.value || '',
      extractedBlocked: document.getElementById('whlBlockedNumbers')?.value || '',
      // Fila atual
      queue: st.queue,
      index: st.index,
      stats: st.stats
    };
    
    st.drafts = st.drafts || {};
    st.drafts[name] = draft;
    await setState(st);
    
    await renderDraftsTable();
  }

  async function loadDraft(name) {
    const st = await getState();
    const draft = st.drafts?.[name];
    if (!draft) return;
    
    // Restaurar configurações
    st.delayMin = draft.delayMin ?? st.delayMin;
    st.delayMax = draft.delayMax ?? st.delayMax;
    st.retryMax = draft.retryMax ?? st.retryMax;
    st.scheduleAt = draft.scheduleAt || '';
    st.typingEffect = draft.typingEffect ?? st.typingEffect;
    st.continueOnError = draft.continueOnError ?? st.continueOnError;
    
    // Restaurar conteúdo
    st.numbersText = draft.numbersText || '';
    st.message = draft.message || '';
    st.imageData = draft.imageData || null;
    
    // Restaurar fila
    st.queue = draft.queue || [];
    st.index = draft.index || 0;
    st.stats = draft.stats || { sent: 0, failed: 0, pending: 0 };
    
    await setState(st);
    
    // Restaurar campos extraídos
    const normalBox = document.getElementById('whlExtractedNumbers');
    const archivedBox = document.getElementById('whlArchivedNumbers');
    const blockedBox = document.getElementById('whlBlockedNumbers');
    
    if (normalBox) normalBox.value = draft.extractedNormal || '';
    if (archivedBox) archivedBox.value = draft.extractedArchived || '';
    if (blockedBox) blockedBox.value = draft.extractedBlocked || '';
    
    // Atualizar contadores
    const normalCount = document.getElementById('whlNormalCount');
    const archivedCount = document.getElementById('whlArchivedCount');
    const blockedCount = document.getElementById('whlBlockedCount');
    
    if (normalCount) normalCount.textContent = (draft.extractedNormal || '').split('\n').filter(n => n.trim()).length;
    if (archivedCount) archivedCount.textContent = (draft.extractedArchived || '').split('\n').filter(n => n.trim()).length;
    if (blockedCount) blockedCount.textContent = (draft.extractedBlocked || '').split('\n').filter(n => n.trim()).length;
    
    await render();
    alert(`✅ Rascunho "${name}" carregado!`);
  }

  async function deleteDraft(name) {
    const st = await getState();
    if (st.drafts?.[name]) {
      delete st.drafts[name];
      await setState(st);
      await renderDraftsTable();
    }
  }

  async function renderDraftsTable() {
    const st = await getState();
    const tbody = document.getElementById('whlDraftsBody');
    if (!tbody) return;
    
    const drafts = st.drafts || {};
    const names = Object.keys(drafts);
    
    if (names.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="padding:12px;text-align:center;opacity:0.6;font-size:11px">Nenhum rascunho salvo</td></tr>';
      return;
    }
    
    tbody.innerHTML = names.map(name => {
      const d = drafts[name];
      const date = new Date(d.savedAt).toLocaleString('pt-BR', { 
        day: '2-digit', 
        month: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      const contacts = (d.queue?.length || 0) + 
                       (d.extractedNormal?.split('\n').filter(n => n.trim()).length || 0);
      const safeName = escapeHtml(name);
      const encodedName = encodeURIComponent(String(name));
      
      return `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.05)">
          <td style="padding:8px;font-size:11px">${safeName}</td>
          <td style="padding:8px;font-size:10px;color:#888">${date}</td>
          <td style="padding:8px;text-align:center;font-size:11px">${contacts}</td>
          <td style="padding:8px;text-align:center">
            <button data-draft-load="${encodedName}" style="padding:4px 8px;margin-right:4px;font-size:11px;cursor:pointer">📂</button>
            <button data-draft-delete="${encodedName}" style="padding:4px 8px;font-size:11px;cursor:pointer;background:#d00;color:#fff;border:none;border-radius:4px">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
    
    // Bind events
    tbody.querySelectorAll('[data-draft-load]').forEach(btn => {
      btn.onclick = () => loadDraft(decodeURIComponent(btn.dataset.draftLoad || ''));
    });
    tbody.querySelectorAll('[data-draft-delete]').forEach(btn => {
      btn.onclick = () => {
        const draftName = decodeURIComponent(btn.dataset.draftDelete || '');
        if (confirm(`Excluir rascunho "${draftName}"?`)) {
          deleteDraft(draftName);
        }
      };
    });
  }


  async function whlReadFileAsDataURL(file) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ===== AUTOMATION FUNCTIONS =====

  function getRandomDelay(min, max) {
    // Usar delay inteligente do Anti-Ban se disponível
    return calculateSmartDelay(min, max);
  }

  async function waitForElement(selector, timeout = 10000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }

  // ===== DOM SELECTORS (UPDATED WITH CORRECT WHATSAPP WEB STRUCTURE) =====
  
  // NOTA: getSearchInput removido - modo DOM de busca não é mais usado
  // A extensão agora usa APENAS navegação via URL

  // Campo de mensagem para digitar (SELETORES EXATOS)
  // IMPORTANTE: Campo de mensagem está no MAIN ou FOOTER, não na sidebar
  // CORRIGIDO: Mais seletores para melhor compatibilidade
  function getMessageInput() {
    return getMessageInputField();
  }

  /**
   * Digita texto no campo de mensagem usando DOM manipulation
   * ATUALIZADO: Suporta digitação humanizada com delays variáveis
   */
  async function typeMessageInField(text, humanLike = true) {
    if (!text || !text.trim()) {
      whlLog.debug('Texto vazio, pulando digitação');
      return true;
    }
    
    whlLog.debug('Digitando texto:', text.substring(0, 50) + '...');
    whlLog.debug('Modo:', humanLike ? 'Humanizado 🧑' : 'Rápido ⚡');
    
    // Aguardar campo com mais tentativas
    let msgInput = null;
    for (let i = 0; i < 20; i++) {
      msgInput = getMessageInputField();
      if (msgInput) break;
      whlLog.debug(`Aguardando campo... tentativa ${i+1}/20`);
      await new Promise(r => setTimeout(r, 500));
    }
    
    if (!msgInput) {
      whlLog.error('Campo de mensagem não encontrado');
      return false;
    }
    
    whlLog.debug('Campo encontrado');
    
    // Focar
    msgInput.focus();
    await new Promise(r => setTimeout(r, 300));
    
    // Limpar
    msgInput.textContent = '';
    msgInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    
    if (humanLike) {
      // DIGITAÇÃO HUMANIZADA - caractere por caractere com delays variáveis
      whlLog.debug('Digitando com aspecto humano...');
      
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        
        // NOVO: Tratar quebra de linha
        if (char === '\n') {
          // Simular Shift+Enter para quebra de linha no WhatsApp
          const shiftEnterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            shiftKey: true, // IMPORTANTE: Shift+Enter
            bubbles: true,
            cancelable: true
          });
          msgInput.dispatchEvent(shiftEnterEvent);
          
          // Delay maior para quebra de linha
          await new Promise(r => setTimeout(r, 150));
          continue;
        }
        
        // Inserir caractere normal
        document.execCommand('insertText', false, char);
        msgInput.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Delay variável baseado no caractere
        let delay;
        if (['.', '!', '?'].includes(char)) {
          // Pausa maior após pontuação
          delay = 100 + Math.random() * 150; // 100-250ms
        } else if ([',', ';', ':'].includes(char)) {
          // Pausa média após vírgulas
          delay = 60 + Math.random() * 80; // 60-140ms
        } else if (char === ' ') {
          // Pausa leve após espaços
          delay = 30 + Math.random() * 50; // 30-80ms
        } else {
          // Delay normal para letras
          delay = 25 + Math.random() * 55; // 25-80ms
        }
        
        // Ocasionalmente fazer uma pausa maior (simula pensamento)
        if (Math.random() < 0.02) { // 2% de chance
          delay += 200 + Math.random() * 300; // +200-500ms extra
        }
        
        await new Promise(r => setTimeout(r, delay));
      }
      
      whlLog.debug('Digitação humanizada concluída');
    } else {
      // DIGITAÇÃO RÁPIDA - processar linha por linha para preservar \n
      whlLog.debug('Digitação rápida...');
      
      // Dividir texto em linhas e processar cada uma
      const lines = text.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) {
          // Inserir quebra de linha com Shift+Enter
          const shiftEnterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            shiftKey: true,
            bubbles: true,
            cancelable: true
          });
          msgInput.dispatchEvent(shiftEnterEvent);
          await new Promise(r => setTimeout(r, 50));
        }
        
        // Inserir linha de texto
        if (lines[i]) {
          document.execCommand('insertText', false, lines[i]);
          msgInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }
    
    await new Promise(r => setTimeout(r, 300));
    
    const ok = msgInput.textContent.trim().length > 0;
    whlLog.debug(ok ? 'Texto digitado com sucesso' : 'Falha na digitação');
    return ok;
  }

  /**
   * Encontra o botão de enviar de forma robusta
   * ATUALIZADO: Usa APENAS seletores CONFIRMADOS pelo usuário
   */
  function findSendButton() {
    // Seletores atualizados 2024/2025
    const sendSelectors = [
      '[data-testid="compose-btn-send"]',
      'span[data-icon="wds-ic-send-filled"]',
      'footer button span[data-icon="send"]',
      'footer button span[data-icon="send-light"]',
      '[data-testid="send"]',
      'button span[data-icon="send"]',
      '[aria-label="Enviar"]',
      'button[aria-label*="Send"]',
      'footer button[aria-label*="Enviar"]',
      'footer button[aria-label*="Send"]'
    ];
    
    // Primeiro: verificar se há modal/dialog aberto (imagem, vídeo, doc)
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) {
      for (const sel of sendSelectors) {
        const btn = dialog.querySelector(sel);
        if (btn) {
          const actualBtn = btn.closest('button') || btn;
          if (!actualBtn.disabled) return actualBtn;
        }
      }
      // Fallback para botão em dialog
      const fallbackBtn = dialog.querySelector('[aria-label="Enviar"]') ||
                          dialog.querySelector('button');
      if (fallbackBtn && !fallbackBtn.disabled) return fallbackBtn;
    }
    
    // Depois: verificar no footer (mensagem normal)
    for (const sel of sendSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const btn = el.closest('button') || el;
          if (!btn.disabled && btn.offsetWidth) return btn;
        }
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }
    
    // Fallback final: buscar por ícone send
    const sendIcon = document.querySelector('span[data-icon="send"], span[data-icon="send-light"]');
    if (sendIcon) {
      const btn = sendIcon.closest('button') || sendIcon.parentElement;
      if (btn) return btn;
    }
    
    return null;
  }

  // Botão de enviar (MÉTODO PROFISSIONAL - não depende de classes)
  function getSendButton() {
    return findSendButton();
  }

  // NOTA: getSearchResults removido - não é mais necessário para modo URL

  // ===== NEW URL-BASED FUNCTIONS (REPLACING DOM SEARCH) =====

  /**
   * Envia mensagem via URL (modo exclusivo)
   * Para texto: https://web.whatsapp.com/send?phone=NUM&text=MSG
   * Para imagem: https://web.whatsapp.com/send?phone=NUM (SEM texto na URL!)
   * ATUALIZADO: Quando tem imagem, NÃO coloca texto na URL
   */
  async function sendViaURL(numero, mensagem, hasImage = false) {
    const cleanNumber = String(numero).replace(/\D/g, '');
    
    if (!cleanNumber) {
      whlLog.error('Número inválido');
      return { success: false, error: 'Número inválido' };
    }
    
    // URL APENAS com o número - NUNCA colocar texto na URL
    let url = `https://web.whatsapp.com/send?phone=${cleanNumber}`;
    
    whlLog.debug('Navegando para:', url);
    whlLog.debug('Mensagem será digitada manualmente após chat abrir');
    
    // Salvar estado antes de navegar (para retomar após reload)
    const st = await getState();
    st.urlNavigationInProgress = true;
    st.currentPhoneNumber = cleanNumber;
    st.currentMessage = mensagem;
    await setState(st);
    
    // Navegar para a URL (isso vai causar reload da página)
    window.location.href = url;
    
    // NOTA: O código abaixo não será executado devido ao reload
    // A continuação acontece em checkAndResumeCampaignAfterURLNavigation()
    return { success: true, navigating: true };
  }

  /**
   * Verifica se há popup de erro após navegação via URL
   * CORRIGIDO: Remove busca de texto que causa falso positivo
   * APENAS verifica se tem botão OK SEM campo de mensagem
   */
  async function checkForErrorPopup() {
    // Aguardar um pouco para popup aparecer (se existir)
    await new Promise(r => setTimeout(r, 1000));
    
    // Procurar por botão OK (indica popup de erro real)
    const okButton = [...document.querySelectorAll('button')]
      .find(b => b.innerText.trim().toUpperCase() === 'OK');
    
    // SÓ é erro se tem botão OK E NÃO tem campo de mensagem
    if (okButton) {
      const messageField = getMessageInputField();
      if (!messageField) {
        whlLog.debug('Popup de erro detectado (botão OK sem campo de mensagem)');
        return true;
      }
    }
    
    // NÃO verificar texto na página - causa falso positivo!
    // REMOVIDO: busca por 'não encontrado', 'invalid', etc no pageText
    
    return false;
  }

  /**
   * Fecha popup de erro
   */
  async function closeErrorPopup() {
    const okButton = [...document.querySelectorAll('button')]
      .find(b => b.innerText.trim().toUpperCase() === 'OK');
    
    if (okButton) {
      okButton.click();
      await new Promise(r => setTimeout(r, 500));
      whlLog.debug('Popup de erro fechado');
      return true;
    }
    return false;
  }

  /**
   * Aguarda o chat abrir após navegação via URL
   * ATUALIZADO: Usa getMessageInputField() e lógica de erro corrigida
   */
  async function waitForChatToOpen(timeout = 15000) {
    whlLog.debug('Aguardando chat abrir...');
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      const messageField = getMessageInputField();
      if (messageField) {
        whlLog.debug('Chat aberto - campo de mensagem encontrado');
        return true;
      }
      
      // Verificar erro APENAS se tem botão OK sem campo de mensagem
      const okButton = [...document.querySelectorAll('button')]
        .find(b => b.innerText.trim().toUpperCase() === 'OK');
      if (okButton && !getMessageInputField()) {
        whlLog.debug('Popup de erro detectado');
        return false;
      }
      
      await new Promise(r => setTimeout(r, 500));
    }
    
    whlLog.warn('Timeout aguardando chat abrir');
    return false;
  }

  /**
   * Helper: Query selector with multiple fallbacks
   * Uses centralized WHL_SELECTORS object
   */
  function querySelector(selectorKey, context = document) {
    const selectors = WHL_SELECTORS[selectorKey];
    if (!selectors) return null;
    
    for (const selector of selectors) {
      const element = context.querySelector(selector);
      if (element) {
        // For icon selectors, try to find the button parent
        if (selector.includes('span[data-icon')) {
          const button = element.closest('button') || element.closest('[role="button"]');
          if (button) return button;
        }
        return element;
      }
    }
    return null;
  }

  /**
   * Helper: Obtém o campo de mensagem
   * ATUALIZADO 2024/2025: Usa seletores atualizados para WhatsApp Web moderno
   */
  function getMessageInputField() {
    // Usar a função centralizada findComposer se disponível
    if (typeof findComposer === 'function') {
      const field = findComposer();
      if (field) return field;
    }
    
    // Seletores atualizados 2024/2025 - ordem de prioridade
    const selectors = [
      '[data-testid="conversation-compose-box-input"]',
      'footer div[contenteditable="true"][data-lexical-editor="true"]',
      '[data-lexical-editor="true"]',
      'div[contenteditable="true"][data-tab="10"]',
      'div[aria-label="Digitar na conversa"][contenteditable="true"]',
      'footer div[contenteditable="true"][role="textbox"]',
      '#main footer div[contenteditable="true"]',
      'footer div[contenteditable="true"]',
      '#main footer [contenteditable="true"]'
    ];
    
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.isConnected) {
          // Verificar se é visível
          if (el.offsetWidth || el.offsetHeight || el.getClientRects().length) {
            return el;
          }
        }
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }
    
    return null;
  }

  /**
   * Helper: Dispara eventos de mouse completos em um elemento
   */
  async function dispatchMouseEvents(element) {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    await new Promise(r => setTimeout(r, 50));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    await new Promise(r => setTimeout(r, 50));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  /**
   * Helper: Envia tecla Enter em um elemento com fallback para botão
   * CORRIGIDO: Melhor suporte para WhatsApp Web moderno
   */
  async function sendEnterKey(element) {
    if (!element) return false;
    
    // Encontrar o elemento contenteditable pai
    const editableDiv = element.closest('div[contenteditable="true"]') || 
                        element.closest('div.copyable-area') ||
                        element;
    
    editableDiv.focus();
    await new Promise(r => setTimeout(r, 100));
    
    // Disparar eventos de teclado completos
    const events = ['keydown', 'keypress', 'keyup'];
    for (const eventType of events) {
      const event = new KeyboardEvent(eventType, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        charCode: eventType === 'keypress' ? 13 : 0,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      });
      editableDiv.dispatchEvent(event);
      await new Promise(r => setTimeout(r, 50));
    }
    
    await new Promise(r => setTimeout(r, 300));
    
    // FALLBACK: Clicar no botão de enviar
    const sendButton = findSendButton();
    if (sendButton) {
      whlLog.debug('Clicando no botão de enviar (fallback)');
      sendButton.click();
    }
    
    await new Promise(r => setTimeout(r, 500));
    return true;
  }

  /**
   * Envia mensagem via tecla ENTER (para mensagens de texto via URL)
   * Nota: Nome mantido como clickSendButton() por compatibilidade, mas agora usa ENTER
   */
  async function clickSendButton() {
    whlLog.debug('Enviando mensagem via tecla ENTER...');
    
    // Aguardar um pouco para garantir que o chat está carregado
    await new Promise(r => setTimeout(r, 500));
    
    // Obter o campo de mensagem usando helper
    const msgInput = getMessageInputField();
    
    if (msgInput) {
      whlLog.debug('Campo de mensagem encontrado');
      
      // Enviar tecla ENTER usando helper
      await sendEnterKey(msgInput);
      whlLog.debug('Tecla ENTER enviada');
      
      // Verificar se mensagem foi enviada
      const checkInput = getMessageInputField();
      if (!checkInput || checkInput.textContent.trim().length === 0) {
        whlLog.debug('Mensagem enviada com sucesso!');
        return { success: true };
      }
      
      whlLog.warn('Mensagem ainda presente no campo');
      return { success: true, warning: 'Não foi possível verificar se mensagem foi enviada' };
    }
    
    whlLog.error('Campo de mensagem não encontrado');
    return { success: false, error: 'Campo de mensagem não encontrado' };
  }

  // DEPRECATED: sendTextMessage removido - agora envia via tecla ENTER após navegação via URL

  /**
   * Fecha popup de número inválido
   */
  function closeInvalidNumberPopup() {
    const okBtn = [...document.querySelectorAll('button')]
      .find(b => b.innerText.trim().toUpperCase() === 'OK');

    if (okBtn) {
      okBtn.click();
      whlLog.debug('Popup de número inválido fechado');
      return true;
    }
    return false;
  }

  // ===== DOM MANIPULATION FUNCTIONS =====
  
  // Função centralizada para encontrar o composer (campo de mensagem)
  // Baseado no projeto funcional CERTO-WHATSAPPLITE
  function findComposer() {
    const selectors = WHL_SELECTORS.MESSAGE_INPUT;
    
    // Tentar cada seletor
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.isConnected) {
          // Verificar se é visível
          if (el.offsetWidth || el.offsetHeight || el.getClientRects().length) {
            whlLog.debug('Composer encontrado via:', sel);
            return el;
          }
        }
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }
    
    // Fallback: buscar todos e retornar o primeiro visível
    for (const sel of selectors) {
      try {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
          if (el && el.isConnected && (el.offsetWidth || el.offsetHeight)) {
            whlLog.debug('Composer encontrado via fallback:', sel);
            return el;
          }
        }
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }
    
    whlLog.debug('Composer não encontrado (ainda)');
    return null;
    return null;
  }

  // Função para digitar em campos do WhatsApp Web (usa execCommand)
  // ATUALIZADA com fallbacks robustos baseados no projeto funcional
  async function typeInField(element, text) {
    if (!element) {
      element = findComposer();
    }
    if (!element) return false;
    
    const st = await getState();
    window.__whl_cached_state__ = st;
    const t = String(text || '');
    if (!t) return false;

    // Focar no elemento
    element.focus();
    await new Promise(r => setTimeout(r, 100));

    // Limpar conteúdo existente
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      await new Promise(r => setTimeout(r, 50));
    } catch (_) {
      element.textContent = '';
    }

    let success = false;

    // Método 1: execCommand (mais compatível)
    if (!success) {
      try {
        if (st.typingEffect) {
          for (const ch of t) {
            document.execCommand('insertText', false, ch);
            element.dispatchEvent(new InputEvent('input', { bubbles: true }));
            await new Promise(r => setTimeout(r, Math.max(10, Number(st.typingDelayMs) || 35)));
          }
        } else {
          document.execCommand('insertText', false, t);
          element.dispatchEvent(new InputEvent('input', { bubbles: true }));
        }
        
        const inserted = element.textContent || element.innerText || '';
        if (inserted.trim() === t.trim() || inserted.includes(t.slice(0, Math.min(20, t.length)))) {
          whlLog.debug('✅ Método 1 (execCommand) funcionou');
          success = true;
        }
      } catch (e) {
        whlLog.debug('Método 1 falhou:', e);
      }
    }

    // Método 2: Clipboard API (fallback)
    if (!success) {
      try {
        element.textContent = '';
        await new Promise(r => setTimeout(r, 50));
        
        await navigator.clipboard.writeText(t);
        document.execCommand('paste');
        element.dispatchEvent(new InputEvent('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 100));
        
        const inserted = element.textContent || element.innerText || '';
        if (inserted.trim() === t.trim() || inserted.includes(t.slice(0, Math.min(20, t.length)))) {
          whlLog.debug('✅ Método 2 (Clipboard) funcionou');
          success = true;
        }
      } catch (e) {
        whlLog.debug('Método 2 falhou:', e);
      }
    }

    // Método 3: textContent direto (último recurso)
    if (!success) {
      try {
        element.textContent = t;
        element.dispatchEvent(new InputEvent('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        whlLog.debug('✅ Método 3 (textContent) aplicado');
        success = true;
      } catch (e) {
        whlLog.debug('Método 3 falhou:', e);
      }
    }

    const finalText = (element.textContent || '').length > 0;
    whlLog.debug('Texto inserido:', finalText ? '✅' : '❌', t.substring(0, 20));
    return success && finalText;
  }
  
  // Função para simular digitação caractere por caractere
  async function simulateTyping(element, text, delay = 50) {
    element.focus();
    element.textContent = '';
    
    for (const char of text) {
      element.textContent += char;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // Função para simular clique robusto
  function simulateClick(element) {
    if (!element) return false;
    
    // Método 1: Focus primeiro
    element.focus();
    
    // Método 2: Disparar eventos de mouse completos
    const mouseDownEvent = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      view: window
    });
    element.dispatchEvent(mouseDownEvent);
    
    const mouseUpEvent = new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      view: window
    });
    element.dispatchEvent(mouseUpEvent);
    
    // Método 3: Click event
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window
    });
    element.dispatchEvent(clickEvent);
    
    // Método 4: Click direto como fallback
    element.click();
    
    return true;
  }

  // DEPRECATED: clearSearchField removido - modo URL não precisa de busca

  // DEPRECATED: waitForSearchResults removido - modo URL não usa busca DOM

  // DEPRECATED: openChatViaDom removido - modo URL substitui completamente

  // DEPRECATED: typeMessageViaDom removido - modo URL não precisa digitar via DOM

  // ===== MAIN SENDING FUNCTION (URL MODE ONLY) =====
  
  /**
   * Função principal de envio usando APENAS URL
   * Não mais usa busca via DOM
   */
  async function sendMessageViaURL(phoneNumber, message) {
    whlLog.debug('════════════════════════════════════════');
    whlLog.debug('███ ENVIANDO MENSAGEM VIA URL ███');
    whlLog.debug('════════════════════════════════════════');
    whlLog.debug('Para:', phoneNumber);
    whlLog.debug('Mensagem:', message ? message.substring(0, 50) + '...' : '(sem texto)');
    
    const st = await getState();
    const hasImage = !!st.imageData;
    
    // Usar sendViaURL que navega para a URL apropriada
    await sendViaURL(phoneNumber, message, hasImage);
    
    // NOTA: A função sendViaURL causa um reload da página
    // A continuação do envio acontece em checkAndResumeCampaignAfterURLNavigation()
    return true;
  }

  // Função para validar que o chat aberto corresponde ao número esperado
  async function validateOpenChat(expectedPhone) {
    whlLog.debug('========================================');
    whlLog.debug('VALIDANDO CHAT ABERTO');
    whlLog.debug('Número esperado:', expectedPhone);
    whlLog.debug('========================================');
    
    // Normalizar o número esperado
    const normalizedExpected = sanitizePhone(expectedPhone);
    
    // Aguardar um pouco para o chat carregar
    await new Promise(r => setTimeout(r, 500));
    
    // Tentar múltiplas formas de obter o número do chat aberto
    let chatNumber = null;
    
    // Método 1: Procurar no header do chat pelo data-id
    const chatHeader = document.querySelector('header[data-testid="conversation-header"]') ||
                      document.querySelector('header.pane-header') ||
                      document.querySelector('div[data-testid="conversation-info-header"]');
    
    if (chatHeader) {
      // Buscar em elementos com data-id dentro do header
      const elementsWithDataId = chatHeader.querySelectorAll('[data-id]');
      for (const el of elementsWithDataId) {
        const dataId = el.getAttribute('data-id');
        if (dataId) {
          const nums = extractNumbersFromText(dataId);
          if (nums.length > 0) {
            chatNumber = nums[0];
            whlLog.debug('Número do chat encontrado via data-id:', chatNumber);
            break;
          }
        }
      }
      
      // Buscar em títulos e aria-labels
      if (!chatNumber) {
        const titleEl = chatHeader.querySelector('[title]');
        const ariaLabelEl = chatHeader.querySelector('[aria-label]');
        
        if (titleEl) {
          const nums = extractNumbersFromText(titleEl.getAttribute('title'));
          if (nums.length > 0) {
            chatNumber = nums[0];
            whlLog.debug('Número do chat encontrado via title:', chatNumber);
          }
        }
        
        if (!chatNumber && ariaLabelEl) {
          const nums = extractNumbersFromText(ariaLabelEl.getAttribute('aria-label'));
          if (nums.length > 0) {
            chatNumber = nums[0];
            whlLog.debug('Número do chat encontrado via aria-label:', chatNumber);
          }
        }
      }
    }
    
    // Método 2: Procurar na URL atual
    if (!chatNumber) {
      const url = window.location.href;
      const nums = extractNumbersFromText(url);
      if (nums.length > 0) {
        chatNumber = nums[0];
        whlLog.debug('Número do chat encontrado via URL:', chatNumber);
      }
    }
    
    // Método 3: Buscar em elementos do DOM principal
    if (!chatNumber) {
      const mainPanel = document.querySelector('div[data-testid="conversation-panel-wrapper"]') ||
                       document.querySelector('div.pane-main');
      
      if (mainPanel) {
        const elementsWithDataId = mainPanel.querySelectorAll('[data-id]');
        for (const el of elementsWithDataId) {
          const dataId = el.getAttribute('data-id');
          if (dataId) {
            const nums = extractNumbersFromText(dataId);
            if (nums.length > 0) {
              chatNumber = nums[0];
              whlLog.debug('Número do chat encontrado via main panel data-id:', chatNumber);
              break;
            }
          }
        }
      }
    }
    
    if (!chatNumber) {
      whlLog.warn('VALIDAÇÃO: Não foi possível determinar o número do chat aberto');
      whlLog.warn('VALIDAÇÃO INCONCLUSIVA: Prosseguindo com o envio (não bloqueante)');
      // Se não conseguimos validar, NÃO bloqueamos o envio - continuamos
      return { valid: true, chatNumber: null };
    }
    
    // Normalizar o número do chat
    const normalizedChat = sanitizePhone(chatNumber);
    
    // Comparar os números (últimos 8-10 dígitos para maior flexibilidade)
    // Alguns números podem ter código do país, então comparamos a parte final
    const minLength = Math.min(normalizedExpected.length, normalizedChat.length);
    const compareLength = Math.min(10, minLength); // Comparar até 10 dígitos
    
    const expectedSuffix = normalizedExpected.slice(-compareLength);
    const chatSuffix = normalizedChat.slice(-compareLength);
    
    const isValid = expectedSuffix === chatSuffix;
    
    whlLog.debug('Comparação de números:');
    whlLog.debug('  Esperado (normalizado):', normalizedExpected);
    whlLog.debug('  Chat (normalizado):', normalizedChat);
    whlLog.debug('  Sufixo esperado:', expectedSuffix);
    whlLog.debug('  Sufixo do chat:', chatSuffix);
    whlLog.debug('  Validação:', isValid ? '✅ VÁLIDO' : '❌ INVÁLIDO');
    
    return { valid: isValid, chatNumber: normalizedChat };
  }

  // Função auxiliar para extrair números de texto
  function extractNumbersFromText(text) {
    if (!text) return [];
    const str = String(text);
    const numbers = [];
    
    // Padrão para números (8-15 dígitos)
    const normalized = sanitizePhone(str);
    const matches = normalized.match(/\d{8,15}/g);
    if (matches) {
      matches.forEach(num => numbers.push(num));
    }
    
    // Padrão WhatsApp (@c.us)
    const whatsappPattern = /(\d{8,15})@c\.us/g;
    let match;
    while ((match = whatsappPattern.exec(str)) !== null) {
      numbers.push(match[1]);
    }
    
    return numbers;
  }

  // ===== OLD FUNCTIONS (DEPRECATED - Kept for fallback) =====

  // Função para enviar via URL (FALLBACK) - NOTA: Não usado atualmente pois causa reload
  // Mantido para referência futura
  async function sendMessageViaUrl(phoneNumber, message) {
    whlLog.debug('════════════════════════════════════════');
    whlLog.debug('═══ ENVIANDO VIA URL (FALLBACK) ═══');
    whlLog.debug('════════════════════════════════════════');
    whlLog.warn('NOTA: URL fallback não implementado pois causa reload de página');
    whlLog.warn('Isso quebraria o fluxo da campanha automática');
    whlLog.info('Use a segunda tentativa DOM ou configure retry para números que falham');
    
    return false;
  }

  // Função para enviar usando Enter no campo de mensagem
  async function sendViaEnterKey() {
    const msgInput = getMessageInput();
    if (!msgInput) return false;
    
    msgInput.focus();
    
    // Disparar Enter
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });
    msgInput.dispatchEvent(enterEvent);
    
    return true;
  }

  async function waitForPageLoad() {
    const maxWait = 20000;
    const start = Date.now();
    
    while (Date.now() - start < maxWait) {
      // Verificar se o campo de mensagem E botão de enviar existem
      const messageInput = getMessageInput();
      const sendButton = getSendButton();
      
      if (messageInput && sendButton) {
        whlLog.debug('Chat carregado, pronto para enviar');
        return true;
      }
      
      // Log de debug
      if (Date.now() - start > 5000) {
        whlLog.debug('Aguardando chat carregar...', {
          messageInput: !!messageInput,
          sendButton: !!sendButton
        });
      }
      
      await new Promise(r => setTimeout(r, 500));
    }
    
    whlLog.warn('Timeout aguardando chat carregar');
    return false;
  }

  async function autoSendMessage() {
    console.log('[WHL] Tentando enviar mensagem...');
    
    // Aguardar um pouco para garantir que a mensagem foi preenchida via URL
    await new Promise(r => setTimeout(r, 2000));
    
    // Tentar encontrar o botão de enviar
    const sendButton = getSendButton();
    
    if (sendButton) {
      console.log('[WHL] Botão de enviar encontrado:', sendButton);
      
      // Simular clique robusto
      simulateClick(sendButton);
      console.log('[WHL] Clique simulado no botão de enviar');
      
      // Aguardar um pouco
      await new Promise(r => setTimeout(r, 1000));
      
      // Verificar se a mensagem foi enviada (campo de input deve estar vazio)
      const msgInput = getMessageInput();
      if (msgInput && msgInput.textContent.trim() === '') {
        console.log('[WHL] ✅ Mensagem enviada com sucesso!');
        return true;
      }
      
      // Se ainda tem texto, tentar via Enter
      console.log('[WHL] Tentando enviar via tecla Enter...');
      await sendViaEnterKey();
      await new Promise(r => setTimeout(r, 1000));
      
      return true;
    }
    
    // Fallback: tentar enviar via Enter direto
    console.log('[WHL] Botão não encontrado, tentando via Enter...');
    const sent = await sendViaEnterKey();
    
    if (sent) {
      console.log('[WHL] Enviado via Enter');
      await new Promise(r => setTimeout(r, 1000));
      return true;
    }
    
    console.log('[WHL] ❌ Não foi possível enviar a mensagem');
    return false;
  }

  // Função para verificar e retomar campanha após navegação via URL
  async function checkAndResumeCampaignAfterURLNavigation() {
    const st = await getState();
    
    // NOVO: Verificar se foi pausado ou parado ANTES de continuar
    if (!st.isRunning) {
      console.log('[WHL] ⏹️ Campanha foi parada, não continuando');
      st.urlNavigationInProgress = false;
      await setState(st);
      await render();
      return;
    }
    
    if (st.isPaused) {
      console.log('[WHL] ⏸️ Campanha está pausada, aguardando retomada');
      st.urlNavigationInProgress = false;
      await setState(st);
      await render();
      return;
    }
    
    // Verificar se estamos retomando após navegação URL
    if (!st.urlNavigationInProgress) {
      return;
    }
    
    console.log('[WHL] 🔄 Retomando campanha após navegação URL...');
    console.log('[WHL] Número atual:', st.currentPhoneNumber);
    console.log('[WHL] Mensagem:', st.currentMessage?.substring(0, 50));
    
    // Aguardar página carregar completamente (aumentado de 4s para 5s)
    await new Promise(r => setTimeout(r, 5000));
    
    // Verificar se URL mostra erro de número inválido
    if (checkForInvalidNumber()) {
      console.log('[WHL] ❌ Número inválido detectado, pulando');
      const cur = st.queue[st.index];
      if (cur) {
        cur.status = 'failed';
        cur.errorReason = 'Número inexistente';
      }
      st.urlNavigationInProgress = false;
      st.index++;
      st.stats.failed++;
      st.stats.pending--;
      await setState(st);
      await render();
      scheduleCampaignStepViaDom();
      return;
    }
    
    // Verificar se há popup de erro
    const hasError = await checkForErrorPopup();
    if (hasError) {
      console.log('[WHL] ❌ Número não encontrado no WhatsApp');
      await closeErrorPopup();
      
      // Marcar como falha
      const cur = st.queue[st.index];
      if (cur) {
        cur.status = 'failed';
        cur.errorReason = 'Número não encontrado no WhatsApp';
      }
      
      st.urlNavigationInProgress = false;
      st.index++;
      await setState(st);
      await render();
      
      // Continuar com próximo
      scheduleCampaignStepViaDom();
      return;
    }
    
    // Verificar se chat abriu
    const chatOpened = await waitForChatToOpen();
    if (!chatOpened) {
      console.log('[WHL] ❌ Chat não abriu');
      
      // Marcar como falha
      const cur = st.queue[st.index];
      if (cur) {
        cur.status = 'failed';
        cur.errorReason = 'Chat não abriu';
      }
      
      st.urlNavigationInProgress = false;
      st.index++;
      await setState(st);
      await render();
      
      // Continuar com próximo
      scheduleCampaignStepViaDom();
      return;
    }
    
    console.log('[WHL] ✅ Chat aberto');
    
    // Processar envio conforme o tipo
    const cur = st.queue[st.index];
    let success = false;
    
    // Se tem imagem, usar fluxo correto: TEXTO PRIMEIRO, DEPOIS IMAGEM
    if (st.imageData) {
      console.log('[WHL] 📸 Modo TEXTO + IMAGEM');
      const imageResult = await sendTextWithImage(st.imageData, st.currentMessage);
      success = imageResult && imageResult.ok;
      
      if (success) {
        console.log('[WHL] ✅ Texto + Imagem enviados');
      } else {
        console.log('[WHL] ❌ Falha ao enviar texto + imagem');
      }
    } else if (st.currentMessage) {
      // MODO TEXTO: URL abriu o chat, agora digitar e enviar
      console.log('[WHL] 📝 Modo TEXTO: digitando mensagem...');
      await new Promise(r => setTimeout(r, 2000));
      
      // Obter configuração de typing effect
      const useHumanTyping = st.typingEffect !== false; // default true
      
      // SEMPRE digitar o texto manualmente (não confiar na URL)
      const typed = await typeMessageInField(st.currentMessage, useHumanTyping);
      if (!typed) {
        console.log('[WHL] ❌ Falha ao digitar texto');
        success = false;
      } else {
        await new Promise(r => setTimeout(r, 500));
        
        // Tentar enviar (3 tentativas)
        for (let attempt = 1; attempt <= 3; attempt++) {
          console.log(`[WHL] Tentativa de envio ${attempt}/3...`);
          
          // Método 1: Clicar no botão de enviar
          const sendBtn = findSendButton();
          if (sendBtn) {
            console.log('[WHL] ✅ Botão de enviar encontrado');
            sendBtn.click();
            await new Promise(r => setTimeout(r, 1000));
            
            // Verificar se foi enviado (campo deve estar vazio)
            const msgInput = getMessageInputField();
            if (!msgInput || msgInput.textContent.trim().length === 0) {
              success = true;
              console.log('[WHL] ✅ Mensagem enviada com sucesso!');
              break;
            }
          }
          
          // Método 2: Tentar via ENTER como fallback
          if (!success && attempt < 3) {
            const msgInput = getMessageInputField();
            if (msgInput) {
              await sendEnterKey(msgInput);
              await new Promise(r => setTimeout(r, 1000));
              
              const checkInput = getMessageInputField();
              if (!checkInput || checkInput.textContent.trim().length === 0) {
                success = true;
                console.log('[WHL] ✅ Mensagem enviada via ENTER!');
                break;
              }
            }
          }
          
          await new Promise(r => setTimeout(r, 500));
        }
      }
      
      if (success) {
        console.log('[WHL] ✅ Texto enviado');
      } else {
        console.log('[WHL] ❌ Falha ao enviar texto após 3 tentativas');
      }
    }
    
    // Atualizar estado
    if (cur) {
      if (success) {
        cur.status = 'sent';
        console.log(`[WHL] ✅ Sucesso: ${cur.phone}`);
        
        // Incrementar contador do Anti-Ban
        await incrementAntiBanCounter();
      } else {
        cur.status = 'failed';
        cur.errorReason = 'Falha no envio';
        console.log(`[WHL] ❌ Falha: ${cur.phone}`);
      }
    }
    
    st.urlNavigationInProgress = false;
    st.index++;
    await setState(st);
    await render();
    
    // Continuar com próximo após delay
    if (st.index < st.queue.length && st.isRunning) {
      const delay = getRandomDelay(st.delayMin, st.delayMax);
      console.log(`[WHL] ⏳ Aguardando ${Math.round(delay/1000)}s antes do próximo...`);
      
      campaignInterval = setTimeout(() => {
        processCampaignStepViaDom();
      }, delay);
    } else if (st.index >= st.queue.length) {
      // Campanha finalizada
      st.isRunning = false;
      await setState(st);
      await render();
      console.log('[WHL] 🎉 Campanha finalizada!');
    }
  }

  // ===== NEW DOM-BASED CAMPAIGN PROCESSING =====
  
  // ===== INPUT + ENTER METHOD (TESTED AND WORKING) =====
  
  /**
   * Enviar mensagem usando Input + Enter
   * Este é o método TESTADO e CONFIRMADO FUNCIONANDO pelo usuário
   */
  // Constants for WhatsApp error detection (multi-language support)
  const WHATSAPP_ERROR_PATTERNS = [
    'inválido',
    'invalid',
    'não existe',
    "doesn't exist",
    'não encontrado',
    'not found',
    'no existe',      // Spanish
    'n\'existe pas',  // French
    'nicht gefunden', // German
    'non trovato',    // Italian
    'не найден',      // Russian
    'não está',       // Portuguese variant
    'not available'   // English variant
  ];
  
  async function sendMessageViaInput(phone, text) {
    console.log(`[WHL] 📨 Enviando via Input + Enter para: ${phone}`);
    
    // Verificar se já está no chat correto
    const currentUrl = window.location.href;
    const needsNavigation = !currentUrl.includes(phone);
    
    if (needsNavigation) {
      // Abrir chat via URL
      console.log('[WHL] 🔗 Abrindo chat via URL...');
      window.location.href = `https://web.whatsapp.com/send?phone=${phone}`;
      
      // Aguardar página carregar e verificar por erros ou input
      const result = await new Promise(resolve => {
        let attempts = 0;
        const check = () => {
          attempts++;
          
          // BUG FIX 1: Detectar erro de número inexistente (EXATA mensagem do WhatsApp)
          // Verificar primeiro o body text (mensagem exata do WhatsApp)
          const bodyText = document.body.innerText || document.body.textContent || '';
          if (bodyText.includes('O número de telefone compartilhado por url é inválido')) {
            console.log('[WHL] ❌ Número inexistente detectado');
            resolve({ success: false, error: 'Número inexistente', errorType: 'INVALID_NUMBER' });
            return;
          }
          
          // BUG FIX 1: Detectar popups/modals de erro do WhatsApp
          const errorPopup = document.querySelector('[data-testid="popup-contents"]');
          const invalidPhonePopup = document.querySelector('[data-testid="phone-invalid-popup"]');
          const alertDialog = document.querySelector('[role="alert"]');
          
          // Helper function to check if text contains error patterns
          const containsErrorPattern = (text) => {
            if (!text) return false;
            const lowerText = text.toLowerCase();
            return WHATSAPP_ERROR_PATTERNS.some(pattern => 
              lowerText.includes(pattern.toLowerCase())
            );
          };
          
          // Verificar texto de erro nos popups
          if (errorPopup) {
            const errorText = errorPopup.textContent || '';
            if (containsErrorPattern(errorText)) {
              console.error('[WHL] ❌ Número inválido detectado no popup');
              resolve({ success: false, error: 'Número inexistente', errorType: 'INVALID_NUMBER' });
              return;
            }
          }
          
          if (invalidPhonePopup) {
            console.error('[WHL] ❌ Popup de número inválido detectado');
            resolve({ success: false, error: 'Número inexistente', errorType: 'INVALID_NUMBER' });
            return;
          }
          
          if (alertDialog) {
            const alertText = alertDialog.textContent || '';
            if (containsErrorPattern(alertText)) {
              console.error('[WHL] ❌ Alert de número inválido detectado');
              resolve({ success: false, error: 'Número inexistente', errorType: 'INVALID_NUMBER' });
              return;
            }
          }
          
          // Verificar se chat foi aberto corretamente
          const input = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
                        document.querySelector('footer [contenteditable="true"]');
          
          if (input) {
            console.log('[WHL] ✅ Chat aberto, input encontrado');
            resolve({ success: true });
          } else if (attempts < 60) {
            setTimeout(check, 500);
          } else {
            console.error('[WHL] ⏱️ Timeout aguardando input');
            resolve({ success: false, error: 'CHAT_OPEN_TIMEOUT', errorType: 'TIMEOUT' });
          }
        };
        setTimeout(check, 2000); // Aguardar página começar a carregar
      });
      
      if (!result.success) {
        return result;
      }
      
      // Wait for chat to fully load before validation
      await new Promise(r => setTimeout(r, 1000));
    }
    
    // BUG FIX 1: Validar que o chat aberto corresponde ao número esperado
    const validation = await validateOpenChat(phone);
    if (!validation.valid) {
      console.error('[WHL] ❌ Chat aberto não corresponde ao número esperado');
      console.error('[WHL] Esperado:', phone);
      console.error('[WHL] Chat atual:', validation.chatNumber || 'não detectado');
      return { 
        success: false, 
        error: validation.chatNumber ? 
          `Chat incorreto (esperado: ${phone}, atual: ${validation.chatNumber})` : 
          'Número inexistente',
        errorType: 'WRONG_CHAT'
      };
    }
    
    // Encontrar input
    const input = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
                  document.querySelector('footer [contenteditable="true"]');
    
    if (!input) {
      console.error('[WHL] ❌ Input não encontrado!');
      return { success: false, error: 'INPUT_NOT_FOUND' };
    }
    
    try {
      // CORREÇÃO: Limpar completamente o campo antes de digitar
      // Selecionar todo o conteúdo e deletar
      input.focus();
      
      // Método 1: Selecionar tudo e deletar
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection.removeAllRanges();
      selection.addRange(range);
      
      // Deletar conteúdo selecionado
      document.execCommand('delete', false, null);
      
