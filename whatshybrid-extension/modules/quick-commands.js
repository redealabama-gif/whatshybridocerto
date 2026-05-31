/**
 * ⚡ Quick Commands - Sistema de Comandos Rápidos com /gatilho
 *
 * Permite usar respostas rápidas digitando / seguido do gatilho no chat.
 *
 * Exemplos:
 * /oi → "Olá! Como posso ajudar você hoje?"
 * /aguarde → "Um momento, por favor. Estou verificando..."
 * /pix → "Chave PIX: [SUA CHAVE]. Após o pagamento, envie o comprovante."
 *
 * Features:
 * - Autocompletar ao digitar /
 * - Dropdown de sugestões
 * - Integração com SmartRepliesModule
 * - Comandos customizáveis
 * - Categorias de comandos
 *
 * @version 1.0.0
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'whl_quick_commands_v1';

  // Lista de comandos padrão — começa VAZIA. O usuário cadastra os seus
  // próprios pela UI. Mantemos `DEFAULT_COMMANDS` (vazio) só pra preservar
  // compat com código antigo que importava esse identificador.
  const DEFAULT_COMMANDS = [];

  let state = {
    commands: [...DEFAULT_COMMANDS],
    isActive: false,
    currentMatches: [],
    selectedIndex: 0,
    initialized: false,
    editingTrigger: null  // null = modo "novo"; string = trigger sendo editado
  };

  let dropdown = null;
  let inputField = null;
  let inputObserver = null;
  let focusinAttached = false;
  let outsideHandler = null;

  // ============================================================
  // INICIALIZAÇÃO
  // ============================================================

  async function init() {
    if (state.initialized) return;

    console.log('[QuickCommands] ⚡ Inicializando...');

    await loadCommands();
    setupStorageSync();
    setupInputMonitoring();

    state.initialized = true;
    console.log('[QuickCommands] ✅ Inicializado com', state.commands.length, 'comandos');
  }

  // ============================================================
  // PERSISTÊNCIA
  // ============================================================

  async function loadCommands() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        state.commands = result[STORAGE_KEY];
      }
    } catch (e) {
      console.error('[QuickCommands] Erro ao carregar comandos:', e);
    }
  }

  async function saveCommands() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: state.commands });
    } catch (e) {
      console.error('[QuickCommands] Erro ao salvar comandos:', e);
    }
  }

  // O módulo roda em DOIS contextos isolados (content script da página do WA +
  // página interna do side panel). Cada um tem seu próprio `state.commands` em
  // memória. Sem isso aqui, comandos cadastrados pelo side panel ficavam invi-
  // síveis pro listener do `/` na página do WA — `handleInput` filtrava lista
  // vazia e o dropdown nunca abria.
  function setupStorageSync() {
    try {
      if (!chrome?.storage?.onChanged) return;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (!changes[STORAGE_KEY]) return;
        const next = changes[STORAGE_KEY].newValue;
        state.commands = Array.isArray(next) ? next : [];
        console.log('[QuickCommands] 🔄 Lista sincronizada:', state.commands.length, 'comandos');
      });
    } catch (e) {
      console.warn('[QuickCommands] storage.onChanged indisponível:', e);
    }
  }

  // ============================================================
  // MONITORAMENTO DO INPUT
  // ============================================================

  // Lista canônica de seletores do composer do WhatsApp Web (2024/2025).
  // Mesmo conjunto exposto em modules/selector-engine.js → messageInput.
  // Mantemos um fallback local pra não depender da ordem de carregamento.
  const COMPOSER_SELECTORS = [
    'footer div[contenteditable="true"][role="textbox"]',
    'footer div[contenteditable="true"][data-lexical-editor="true"]',
    '[data-lexical-editor="true"][contenteditable="true"]',
    '#main footer [contenteditable="true"]',
    'footer [contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    '.copyable-text.selectable-text[contenteditable="true"]',
    '[data-testid="conversation-compose-box-input"]',
    '[contenteditable="true"][data-tab="10"]',
    '[contenteditable="true"][data-tab="6"]',
    '[contenteditable="true"][data-tab="1"]',
  ];

  function isComposerInput(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.getAttribute && el.getAttribute('contenteditable') !== 'true') return false;
    // Tem que estar dentro do footer / #main; senão é busca, caption de mídia,
    // ou outro contenteditable que não é o composer.
    return !!(el.closest && (el.closest('footer') || el.closest('#main footer')));
  }

  function findComposerInput() {
    // Preferência: SelectorEngine (cache + ordem consistente com o resto da ext).
    try {
      if (window.SelectorEngine?.find) {
        const el = window.SelectorEngine.find('messageInput');
        if (el) return el;
      }
    } catch (_) {}

    for (const sel of COMPOSER_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  }

  // v9.5.9+: detecção robusta do composer.
  //   1. focusin global: pega o input no instante em que o usuário focar nele
  //      (cobre o caso de o user abrir o chat depois do init).
  //   2. MutationObserver permanente: pega trocas de chat e re-renderizações
  //      do composer (lexical editor recria a div em algumas builds).
  //   3. Tentativa inicial imediata: se já tem chat aberto na hora do init.
  // Removido o polling de 30s que parava silenciosamente.
  function setupInputMonitoring() {
    if (!focusinAttached) {
      document.addEventListener('focusin', handleFocusIn, true);
      focusinAttached = true;
    }

    // Tenta achar e atachar agora.
    const initial = findComposerInput();
    if (initial) attachInputListeners(initial);

    // Observer permanente — sobrevive a trocas de chat e re-render do composer.
    if (inputObserver) {
      try { inputObserver.disconnect(); } catch (_) {}
      inputObserver = null;
    }
    inputObserver = new MutationObserver(() => {
      // Só re-localiza se perdemos o campo (saiu do DOM). Não rouba o listener
      // de um campo válido só porque um seletor casou outro contenteditable —
      // isso fazia o handleInput parar de disparar no campo real. O focusin
      // cobre o caso de o usuário focar um composer novo.
      if (inputField && document.contains(inputField)) return;
      const candidate = findComposerInput();
      if (candidate) attachInputListeners(candidate);
    });
    inputObserver.observe(document.body, { childList: true, subtree: true });
  }

  function handleFocusIn(e) {
    const target = e.target;
    if (isComposerInput(target) && target !== inputField) {
      attachInputListeners(target);
    }
  }

  function attachInputListeners(newField) {
    if (!newField || newField === inputField) return;

    // Limpa listeners antigos antes de trocar.
    if (inputField) {
      try {
        inputField.removeEventListener('input', handleInput);
        inputField.removeEventListener('keydown', handleKeyDown);
      } catch (_) {}
    }

    inputField = newField;
    inputField.addEventListener('input', handleInput);
    inputField.addEventListener('keydown', handleKeyDown);
    console.log('[QuickCommands] ✅ Listeners anexados ao composer');
  }

  function handleInput(e) {
    // Lê do alvo real do evento — `inputField` pode estar stale se o Lexical
    // recriou a div. Isso garante que, ao apagar o "/oi", o texto vazio seja
    // detectado e o dropdown feche.
    const field = (e && e.target && e.target.nodeType === 1) ? e.target : inputField;
    if (field && field !== inputField && isComposerInput(field)) inputField = field;
    const text = (field?.textContent || '').trim();

    // Detectar se começou com /
    if (text.startsWith('/')) {
      const query = text.slice(1).toLowerCase();
      showSuggestions(query);
    } else {
      // Qualquer coisa que não comece com / fecha o dropdown (incl. campo vazio).
      hideSuggestions();
    }
  }

  function handleKeyDown(e) {
    if (!state.isActive) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectNext();
        break;

      case 'ArrowUp':
        e.preventDefault();
        selectPrevious();
        break;

      case 'Enter':
        if (state.currentMatches.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          insertCommand(state.currentMatches[state.selectedIndex]);
        }
        break;

      case 'Escape':
        e.preventDefault();
        hideSuggestions();
        break;

      case 'Tab':
        if (state.currentMatches.length > 0) {
          e.preventDefault();
          insertCommand(state.currentMatches[state.selectedIndex]);
        }
        break;
    }
  }

  // ============================================================
  // DROPDOWN DE SUGESTÕES
  // ============================================================

  function showSuggestions(query) {
    // Buscar comandos que correspondem
    state.currentMatches = state.commands.filter(cmd =>
      cmd.trigger.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 10);

    if (state.currentMatches.length === 0) {
      hideSuggestions();
      return;
    }

    state.isActive = true;
    state.selectedIndex = 0;

    renderDropdown();
  }

  function renderDropdown() {
    // Remover dropdown existente
    if (dropdown) {
      dropdown.remove();
    }

    // Criar dropdown
    dropdown = document.createElement('div');
    dropdown.id = 'whl-quick-commands-dropdown';
    dropdown.className = 'whl-qc-dropdown';

    const itemsHtml = state.currentMatches.map((cmd, index) => `
      <div class="whl-qc-item ${index === state.selectedIndex ? 'selected' : ''}" data-index="${index}">
        <span class="whl-qc-emoji">${cmd.emoji}</span>
        <div class="whl-qc-content">
          <div class="whl-qc-trigger">/${cmd.trigger}</div>
          <div class="whl-qc-preview">${cmd.text.slice(0, 60)}${cmd.text.length > 60 ? '...' : ''}</div>
        </div>
        <span class="whl-qc-category">${cmd.category}</span>
      </div>
    `).join('');

    dropdown.innerHTML = `
      <div class="whl-qc-header">
        <span class="whl-qc-header-label">⚡ Resposta Rápida</span>
        <button class="whl-qc-close" type="button" title="Fechar (Esc)">✕</button>
      </div>
      <div class="whl-qc-items">${itemsHtml}</div>
    `;

    // Botão ✕ fecha o dropdown sem inserir nada.
    dropdown.querySelector('.whl-qc-close')?.addEventListener('mousedown', (ev) => {
      ev.preventDefault();   // não tira o foco do composer
      ev.stopPropagation();
      hideSuggestions();
    });

    // Event listeners dos itens
    dropdown.querySelectorAll('.whl-qc-item').forEach((item, index) => {
      // mousedown + preventDefault: clicar não desfoca o composer antes do insert
      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        insertCommand(state.currentMatches[index]);
      });

      item.addEventListener('mouseenter', () => {
        state.selectedIndex = index;
        updateSelection();
      });
    });

    // Posicionar acima do input
    const inputRect = inputField.getBoundingClientRect();
    dropdown.style.cssText = `
      position: fixed;
      bottom: ${window.innerHeight - inputRect.top + 10}px;
      left: ${inputRect.left}px;
      width: ${Math.min(500, inputRect.width)}px;
      max-height: 400px;
      z-index: 99999;
    `;

    // Adicionar estilos se não existirem
    if (!document.getElementById('whl-qc-styles')) {
      const styles = document.createElement('style');
      styles.id = 'whl-qc-styles';
      styles.textContent = `
        .whl-qc-dropdown {
          background: rgba(26, 26, 46, 0.98);
          border: 1px solid rgba(139, 92, 246, 0.3);
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.5);
          overflow: hidden;
          backdrop-filter: blur(20px);
          display: flex;
          flex-direction: column;
        }

        .whl-qc-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          flex: 0 0 auto;
        }

        .whl-qc-header-label {
          color: rgba(255,255,255,0.6);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.3px;
          text-transform: uppercase;
        }

        .whl-qc-close {
          background: rgba(255,255,255,0.08);
          border: none;
          color: rgba(255,255,255,0.7);
          width: 22px;
          height: 22px;
          border-radius: 6px;
          font-size: 12px;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
        }

        .whl-qc-close:hover {
          background: rgba(248, 113, 113, 0.25);
          color: #fff;
        }

        .whl-qc-items {
          overflow-y: auto;
          max-height: 340px;
        }

        .whl-qc-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          cursor: pointer;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          transition: all 0.2s;
        }

        .whl-qc-item:last-child {
          border-bottom: none;
        }

        .whl-qc-item:hover,
        .whl-qc-item.selected {
          background: rgba(139, 92, 246, 0.2);
        }

        .whl-qc-emoji {
          font-size: 24px;
        }

        .whl-qc-content {
          flex: 1;
        }

        .whl-qc-trigger {
          color: #8b5cf6;
          font-weight: 600;
          font-size: 14px;
          margin-bottom: 4px;
        }

        .whl-qc-preview {
          color: rgba(255,255,255,0.7);
          font-size: 12px;
        }

        .whl-qc-category {
          color: rgba(255,255,255,0.5);
          font-size: 11px;
          background: rgba(255,255,255,0.1);
          padding: 4px 8px;
          border-radius: 4px;
        }
      `;
      document.head.appendChild(styles);
    }

    document.body.appendChild(dropdown);

    // Fecha ao clicar fora (mas não no próprio dropdown nem no composer, pra não
    // brigar com o insert e com a edição do "/gatilho").
    if (outsideHandler) document.removeEventListener('mousedown', outsideHandler, true);
    outsideHandler = (ev) => {
      const t = ev.target;
      if (dropdown && dropdown.contains(t)) return;
      if (inputField && inputField.contains(t)) return;
      hideSuggestions();
    };
    document.addEventListener('mousedown', outsideHandler, true);
  }

  function updateSelection() {
    if (!dropdown) return;

    dropdown.querySelectorAll('.whl-qc-item').forEach((item, index) => {
      if (index === state.selectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        item.classList.remove('selected');
      }
    });
  }

  function selectNext() {
    if (state.selectedIndex < state.currentMatches.length - 1) {
      state.selectedIndex++;
      updateSelection();
    }
  }

  function selectPrevious() {
    if (state.selectedIndex > 0) {
      state.selectedIndex--;
      updateSelection();
    }
  }

  function hideSuggestions() {
    state.isActive = false;
    state.currentMatches = [];
    state.selectedIndex = 0;

    if (dropdown) {
      dropdown.remove();
      dropdown = null;
    }

    if (outsideHandler) {
      document.removeEventListener('mousedown', outsideHandler, true);
      outsideHandler = null;
    }
  }

  // ============================================================
  // INSERÇÃO DE COMANDO (ATUALIZADO 2024/2025)
  // ============================================================

  // Seleciona TODO o conteúdo do composer (o "/gatilho" digitado) usando a
  // Selection API. Mais confiável que execCommand('selectAll') dentro do editor
  // Lexical, onde o selectAll às vezes não casa o escopo do contenteditable.
  function selectAllInField(field) {
    try {
      field.focus();
      const range = document.createRange();
      range.selectNodeContents(field);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    } catch (_) {
      return false;
    }
  }

  // v9.7.x: usuário pediu — "antes de inserir, apague o que está escrito".
  // Loop defensivo (3 tentativas de select-all + delete + verificar),
  // depois força innerHTML='' como última cartada. Cada iteração emite o
  // input event pro editor Lexical reconciliar o estado interno.
  async function clearField(field) {
    if (!field) return false;
    field.focus();
    for (let i = 0; i < 3; i++) {
      selectAllInField(field);
      try { document.execCommand('delete', false, null); } catch (_) {}
      try {
        field.dispatchEvent(new InputEvent('input', {
          bubbles: true, inputType: 'deleteContentBackward', data: null,
        }));
      } catch (_) {
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await new Promise(r => setTimeout(r, 30));
      if (!(field.textContent || '').trim()) return true;
    }
    // Último recurso — Lexical re-renderiza por cima às vezes, mas a verificação
    // final em insertionLooksGood pega esse caso.
    try {
      field.innerHTML = '';
      field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    } catch (_) {}
    return !(field.textContent || '').trim();
  }

  // Sucesso = o texto da resposta entrou E o gatilho "/xxx" não sobrou na frente.
  function insertionLooksGood(field, text) {
    const inserted = (field.textContent || field.innerText || '').trim();
    if (!inserted) return false;
    if (inserted.startsWith('/')) return false; // gatilho não foi substituído
    return inserted.includes(text.slice(0, Math.min(20, text.length)).trim());
  }

  async function insertCommand(command) {
    if (!command) return;

    // Resolve o campo real: prioriza o composer focado, cai pra ref guardada,
    // depois busca de novo. Evita inserir num campo stale.
    let field = (document.activeElement && isComposerInput(document.activeElement))
      ? document.activeElement
      : (inputField && document.contains(inputField) ? inputField : findComposerInput());
    if (!field) { hideSuggestions(); return; }
    inputField = field;

    console.log('[QuickCommands] Inserindo comando:', command.trigger);

    // v9.7.x BUG FIX: a versão anterior tentava 3 métodos em cascata. Quando o
    // método 1 não conseguia limpar (Lexical relutava), o método 2 limpava
    // mal e o execCommand('insertText') inseria EM CIMA do que sobrou. O user
    // via "/oi + resposta + resposta" (duplicação).
    //
    // Solução: UMA operação atômica. Foca → seleciona tudo → execCommand
    // ('insertText', text) SUBSTITUI a seleção pelo texto novo (mesmo
    // comportamento de "ctrl+A → digitar"). Sem dispatchEvent manual
    // (execCommand já emite os eventos nativamente); sem tentar de novo.
    field.focus();
    await new Promise(r => setTimeout(r, 80));

    selectAllInField(field);
    await new Promise(r => setTimeout(r, 50)); // Lexical reconciliar a seleção

    let success = false;
    try {
      document.execCommand('insertText', false, command.text);
      success = true;
    } catch (e) {
      console.log('[QuickCommands] insertText falhou:', e?.message);
    }

    // Fallback DURO (último recurso): se o execCommand não vingou, substitui
    // o textContent inteiro. Pode bagunçar a estrutura Lexical, mas é melhor
    // do que falhar visível pro usuário.
    if (!success) {
      try {
        field.textContent = command.text;
        field.dispatchEvent(new InputEvent('input', { bubbles: true }));
        success = true;
      } catch (e) {
        console.log('[QuickCommands] textContent fallback falhou:', e?.message);
      }
    }

    // Fechar dropdown
    hideSuggestions();

    if (!success) {
      console.error('[QuickCommands] ❌ Inserção falhou');
      return;
    }
    console.log('[QuickCommands] ✅ Inseriu:', command.trigger);

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit('quick_command:used', {
        trigger: command.trigger,
        category: command.category
      });
    }

    // Adicionar ponto no Trust System se disponível
    if (window.TrustSystem) {
      window.TrustSystem.addPoints('USE_SUGGESTION');
    }

    // Notificar
    if (window.NotificationsModule) {
      window.NotificationsModule.toast(
        `⚡ Comando /${command.trigger} inserido`,
        'success',
        1500
      );
    }
  }

  // ============================================================
  // GERENCIAMENTO DE COMANDOS
  // ============================================================

  function addCommand(trigger, text, category = 'Geral', emoji = '📝') {
    const exists = state.commands.some(cmd => cmd.trigger === trigger);
    if (exists) {
      console.warn('[QuickCommands] Comando já existe:', trigger);
      return false;
    }

    state.commands.push({
      trigger: trigger.toLowerCase().replace(/[^a-z0-9]/g, ''),
      text,
      category,
      emoji
    });

    saveCommands();
    console.log('[QuickCommands] Comando adicionado:', trigger);
    return true;
  }

  function removeCommand(trigger) {
    const index = state.commands.findIndex(cmd => cmd.trigger === trigger);
    if (index === -1) return false;

    state.commands.splice(index, 1);
    saveCommands();
    console.log('[QuickCommands] Comando removido:', trigger);
    return true;
  }

  function updateCommand(trigger, updates) {
    const cmd = state.commands.find(c => c.trigger === trigger);
    if (!cmd) return false;

    Object.assign(cmd, updates);
    saveCommands();
    console.log('[QuickCommands] Comando atualizado:', trigger);
    return true;
  }

  function getCommands() {
    return [...state.commands];
  }

  function getCommandsByCategory(category) {
    return state.commands.filter(cmd => cmd.category === category);
  }

  // ============================================================
  // UI - GERENCIAMENTO
  // ============================================================

  // Escape utilitário pra evitar HTML injection em triggers/textos do user.
  function _esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Reescrita usando as classes nativas do sidepanel (`sp-card`, `sp-btn`,
  // `sp-input`, `sp-textarea`, `sp-muted`) que já estão estilizadas em
  // `sidepanel.css`. As classes `qc-*` / `mod-*` que existiam antes não tinham
  // CSS associado → ficava tudo desformatado. Form de cadastro vem inline (sem
  // dialog flutuante) porque o sidepanel é estreito e overlay quebrava o layout.
  function renderCommandsManager(container) {
    const cmds = state.commands.slice().sort((a, b) => (a.trigger || '').localeCompare(b.trigger || ''));

    const listHtml = cmds.length === 0
      ? `<div class="sp-muted" style="padding:18px;text-align:center;font-size:12px;">
           Nenhuma resposta cadastrada ainda. Clique em <strong>➕ Nova Resposta</strong> pra começar.
         </div>`
      : cmds.map(cmd => `
          <div class="qr-item" data-trigger="${_esc(cmd.trigger)}"
               style="display:flex;gap:8px;padding:10px;border-radius:8px;background:rgba(255,255,255,0.03);
                      border:1px solid rgba(255,255,255,0.06);margin-bottom:6px;">
            <div style="font-size:18px;line-height:1;">${_esc(cmd.emoji || '📝')}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-family:ui-monospace,Menlo,monospace;color:#a78bfa;font-weight:600;font-size:12px;">
                /${_esc(cmd.trigger)}
              </div>
              <div style="font-size:13px;margin-top:2px;white-space:pre-wrap;word-break:break-word;">${_esc(cmd.text)}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
              <button class="sp-btn sp-btn-secondary qr-edit" data-trigger="${_esc(cmd.trigger)}"
                      style="padding:4px 8px;font-size:12px;flex:0 0 auto;min-width:32px;" title="Editar resposta">✏️</button>
              <button class="sp-btn sp-btn-secondary qr-copy" data-trigger="${_esc(cmd.trigger)}"
                      style="padding:4px 8px;font-size:12px;flex:0 0 auto;min-width:32px;" title="Copiar texto">📋</button>
              <button class="sp-btn sp-btn-danger qr-delete" data-trigger="${_esc(cmd.trigger)}"
                      style="padding:4px 8px;font-size:12px;flex:0 0 auto;min-width:32px;" title="Excluir">🗑️</button>
            </div>
          </div>
        `).join('');

    container.innerHTML = `
      <div class="sp-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <div class="sp-title" style="margin:0;">⚡ Resposta Rápida</div>
          <div style="display:flex;gap:6px;">
            <button id="qr-new-btn" class="sp-btn sp-btn-primary" style="padding:6px 12px;">➕ Nova Resposta</button>
            ${cmds.length > 0 ? `<button id="qr-clear-btn" class="sp-btn sp-btn-danger" style="padding:6px 10px;font-size:12px;" title="Apagar TODAS as respostas">🗑️ Limpar tudo</button>` : ''}
          </div>
        </div>
        <div class="sp-muted" style="font-size:11px;margin-top:6px;">
          Digite <code style="background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:3px;">/gatilho</code>
          no chat do WhatsApp pra inserir a resposta automaticamente.
        </div>
      </div>

      <div id="qr-form" class="sp-card" style="display:none;">
        <div class="sp-title" id="qr-form-title" style="font-size:13px;">Nova Resposta Rápida</div>
        <label class="sp-label" style="margin-top:8px;">Gatilho</label>
        <input type="text" id="qr-trigger" class="sp-input" placeholder="ex: preco" maxlength="40" />
        <div class="sp-muted" style="font-size:11px;margin-top:2px;">
          Só letras e números (vai virar minúscula). Vai responder a <code>/gatilho</code> no chat.
        </div>

        <label class="sp-label" style="margin-top:10px;">Resposta</label>
        <textarea id="qr-text" class="sp-textarea" rows="3" placeholder="Texto que vai ser inserido no chat..."></textarea>

        <label class="sp-label" style="margin-top:10px;">Emoji (opcional)</label>
        <input type="text" id="qr-emoji" class="sp-input" placeholder="📝" maxlength="4" style="width:80px;" />

        <div id="qr-form-err" style="color:#f87171;font-size:12px;margin-top:6px;display:none;"></div>

        <div style="display:flex;gap:8px;margin-top:12px;">
          <button id="qr-save-btn" class="sp-btn sp-btn-primary" style="flex:1;">💾 Salvar</button>
          <button id="qr-cancel-btn" class="sp-btn sp-btn-secondary" style="flex:1;">Cancelar</button>
        </div>
      </div>

      <div class="sp-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div class="sp-title" style="margin:0;font-size:13px;">📋 Suas respostas</div>
          <span class="sp-muted" style="font-size:11px;">${cmds.length} cadastrada(s)</span>
        </div>
        <div id="qr-list">${listHtml}</div>
      </div>
    `;

    // Binds — usados aqui (delegação no container) pra sobreviverem ao re-render.
    container.querySelector('#qr-new-btn')?.addEventListener('click', () => toggleForm(container, true));
    container.querySelector('#qr-cancel-btn')?.addEventListener('click', () => toggleForm(container, false));
    container.querySelector('#qr-save-btn')?.addEventListener('click', () => handleSave(container));

    container.querySelector('#qr-clear-btn')?.addEventListener('click', () => {
      if (!confirm(`Apagar TODAS as ${state.commands.length} respostas cadastradas? Não dá pra desfazer.`)) return;
      state.commands = [];
      saveCommands();
      renderCommandsManager(container);
    });

    container.querySelectorAll('.qr-copy').forEach(btn => {
      btn.addEventListener('click', async () => {
        const trig = btn.dataset.trigger;
        const cmd = state.commands.find(c => c.trigger === trig);
        if (!cmd) return;
        try {
          await navigator.clipboard.writeText(cmd.text);
          flashStatus(btn, '✓');
        } catch (_) { flashStatus(btn, '✗'); }
      });
    });

    container.querySelectorAll('.qr-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const trig = btn.dataset.trigger;
        if (!confirm(`Excluir a resposta /${trig}?`)) return;
        removeCommand(trig);
        renderCommandsManager(container);
      });
    });

    container.querySelectorAll('.qr-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const trig = btn.dataset.trigger;
        const cmd = state.commands.find(c => c.trigger === trig);
        if (!cmd) return;
        openEditForm(container, cmd);
      });
    });
  }

  // Abre o form em modo "editar" — preenche os campos e marca editingTrigger
  // pra `handleSave` saber que tem que chamar updateCommand em vez de addCommand.
  function openEditForm(container, cmd) {
    state.editingTrigger = cmd.trigger;
    toggleForm(container, true);

    const titleEl = container.querySelector('#qr-form-title');
    const saveBtn = container.querySelector('#qr-save-btn');
    if (titleEl) titleEl.textContent = `Editar /${cmd.trigger}`;
    if (saveBtn) saveBtn.textContent = '💾 Atualizar';

    container.querySelector('#qr-trigger').value = cmd.trigger;
    container.querySelector('#qr-text').value = cmd.text || '';
    container.querySelector('#qr-emoji').value = cmd.emoji || '';
  }

  function toggleForm(container, show) {
    const form = container.querySelector('#qr-form');
    if (!form) return;
    form.style.display = show ? '' : 'none';

    if (show) {
      container.querySelector('#qr-trigger')?.focus();
      const err = container.querySelector('#qr-form-err');
      if (err) { err.style.display = 'none'; err.textContent = ''; }
    } else {
      // Limpar form + sair do modo edit ao fechar/cancelar.
      state.editingTrigger = null;
      container.querySelector('#qr-trigger').value = '';
      container.querySelector('#qr-text').value = '';
      container.querySelector('#qr-emoji').value = '';
      const titleEl = container.querySelector('#qr-form-title');
      const saveBtn = container.querySelector('#qr-save-btn');
      if (titleEl) titleEl.textContent = 'Nova Resposta Rápida';
      if (saveBtn) saveBtn.textContent = '💾 Salvar';
    }
  }

  function handleSave(container) {
    const triggerRaw = container.querySelector('#qr-trigger').value.trim();
    const text = container.querySelector('#qr-text').value.trim();
    const emoji = container.querySelector('#qr-emoji').value.trim() || '📝';
    const errEl = container.querySelector('#qr-form-err');

    const showErr = (m) => { if (errEl) { errEl.textContent = m; errEl.style.display = ''; } };

    if (!triggerRaw) return showErr('Defina um gatilho.');
    if (!text) return showErr('Defina a resposta.');

    const trigger = triggerRaw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!trigger) return showErr('Gatilho precisa ter letras ou números (sem espaços/símbolos).');

    const editing = state.editingTrigger;

    if (editing) {
      // EDIT: se o user mudou o trigger, garante que o novo não colide com outro.
      if (trigger !== editing && state.commands.some(c => c.trigger === trigger)) {
        return showErr(`Já existe outra resposta para /${trigger}.`);
      }
      const idx = state.commands.findIndex(c => c.trigger === editing);
      if (idx === -1) return showErr('Resposta original não encontrada.');
      state.commands[idx] = { trigger, text, category: state.commands[idx].category || 'Geral', emoji };
      saveCommands();
    } else {
      // ADD
      if (state.commands.some(c => c.trigger === trigger)) {
        return showErr(`Já existe uma resposta para /${trigger}.`);
      }
      const ok = addCommand(trigger, text, 'Geral', emoji);
      if (!ok) return showErr('Falha ao salvar.');
    }

    state.editingTrigger = null;
    renderCommandsManager(container);
  }

  function flashStatus(el, msg) {
    const orig = el.textContent;
    el.textContent = msg;
    setTimeout(() => { el.textContent = orig; }, 900);
  }

  // ============================================================
  // API PÚBLICA
  // ============================================================

  window.QuickCommands = {
    init,
    addCommand,
    removeCommand,
    updateCommand,
    getCommands,
    getCommandsByCategory,
    renderCommandsManager,
    DEFAULT_COMMANDS
  };

  window.addEventListener('beforeunload', () => {
    if (inputObserver) {
      try { inputObserver.disconnect(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      inputObserver = null;
    }
    if (focusinAttached) {
      try { document.removeEventListener('focusin', handleFocusIn, true); } catch (_) {}
      focusinAttached = false;
    }
  });

  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
  } else {
    setTimeout(init, 1000);
  }

})();
