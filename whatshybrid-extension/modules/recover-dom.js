/**
 * 🔄 Recover DOM v2.0 - Sistema de Recuperação de Mensagens Apagadas
 *
 * Sistema HÍBRIDO:
 * - Funciona via DOM quando APIs internas não estão disponíveis
 * - Cacheia TODAS as mensagens visíveis
 * - Detecta mensagens apagadas e restaura conteúdo
 * - Mantém histórico persistente com opção de download
 *
 * @version 2.0.0 - CORRIGIDO
 */

(function() {
  'use strict';

  if (window.__RECOVER_DOM_V2__) return;
  window.__RECOVER_DOM_V2__ = true;

  const DEBUG = localStorage.getItem('whl_debug') === 'true';
  function log(...args) { if (DEBUG) console.log('[RecoverDOM]', ...args); }

  const STORAGE_KEY = 'whl_recover_history_v2';
  const CACHE_KEY = 'whl_message_cache_v2';
  const MAX_HISTORY = 500;
  const MAX_CACHE = 2000;
  const MAX_STORAGE_BYTES = 3 * 1024 * 1024; // 3MB

  let chatChangeInterval = null;

  // ============================================
  // ESTADO
  // ============================================

  const state = {
    initialized: false,
    messageCache: new Map(), // msgKey -> { text, from, timestamp, mediaUrl, mediaType }
    history: [], // Mensagens apagadas recuperadas
    observer: null,
    currentChatId: null,
    scanInterval: null
  };

  // ============================================
  // SELETORES ATUALIZADOS 2024/2025
  // ============================================

  const SELECTORS = {
    // Container principal de mensagens
    MESSAGES_CONTAINER: [
      '[data-testid="conversation-panel-messages"]',
      '#main div[role="application"]',
      '#main .copyable-area',
      '#main'
    ],

    // Mensagem individual
    MESSAGE: [
      '[data-testid="msg-container"]',
      'div.message-in',
      'div.message-out',
      '[data-id]'
    ],

    // Texto da mensagem
    MESSAGE_TEXT: [
      'span.selectable-text[data-testid]',
      '[data-testid="msg-text"]',
      '.copyable-text span.selectable-text',
      'span.selectable-text span',
      '.message-text'
    ],

    // Indicadores de mensagem apagada
    DELETED_INDICATORS: [
      '[data-testid="recalled-msg"]',
      'span[data-icon="recalled"]',
      'span[data-icon="recalled-in"]',
      'span[data-icon="recalled-out"]',
      '.message-recalled'
    ],

    // Texto de mensagem apagada (PT-BR e EN)
    DELETED_TEXT_PATTERNS: [
      'Esta mensagem foi apagada',
      'This message was deleted',
      'Mensagem apagada',
      'Message deleted',
      '🚫 Esta mensagem foi excluída',
      'Você apagou esta mensagem'
    ],

    // Indicadores de mensagem editada — WhatsApp Web rotula edits com
    // múltiplos selectors dependendo da versão. Mantemos uma lista
    // ampla pra resistir a renames sem precisar atualizar o módulo.
    EDITED_INDICATORS: [
      '[data-testid="msg-edited"]',
      '[data-icon="edited"]',
      '[data-icon="edited-in"]',
      '[data-icon="edited-out"]',
      'span[aria-label*="ditad" i]',  // pt-BR: editada
      'span[aria-label*="dited" i]'   // en: edited
    ],

    // Padrões textuais que aparecem em mensagens editadas
    EDITED_TEXT_PATTERNS: [
      '<Editada>',
      '<Edited>',
      '(Editada)',
      '(Edited)'
    ],

    // Info do remetente (em grupos)
    SENDER_INFO: [
      '[data-testid="author"]',
      '.copyable-text[data-pre-plain-text]',
      '._ahxt', // Classe do WhatsApp para nome do remetente
      'span[dir="auto"][aria-label]'
    ],

    // Timestamp
    TIMESTAMP: [
      '[data-testid="msg-meta"]',
      '.message-time',
      'span[data-testid="msg-time"]'
    ],

    // Mídia
    MEDIA: [
      'img[src*="blob:"]',
      'img[src*="https://web.whatsapp.com/"]',
      'video',
      '[data-testid="media-state"]',
      '[data-testid="image-thumb"]',
      '[data-testid="video-thumb"]'
    ],

    // Outgoing (mensagem enviada)
    OUTGOING: [
      '[data-testid="msg-dblcheck"]',
      '[data-icon="msg-dblcheck"]',
      '[data-icon="msg-check"]',
      '[data-icon="tail-out"]',
      '.message-out'
    ],

    // Header do chat
    CHAT_HEADER: [
      '#main header span[title]',
      '[data-testid="conversation-info-header-chat-title"]',
      'header ._amie span',
      'header span[dir="auto"]'
    ]
  };

  // ============================================
  // UTILITÁRIOS
  // ============================================

  function findElement(parent, selectorList) {
    if (!parent) return null;
    for (const sel of selectorList) {
      try {
        const el = parent.querySelector(sel);
        if (el) return el;
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }
    return null;
  }

  function findElements(parent, selectorList) {
    if (!parent) return [];
    const results = [];
    for (const sel of selectorList) {
      try {
        const els = parent.querySelectorAll(sel);
        for (const el of els) {
          if (!results.includes(el)) results.push(el);
        }
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }
    return results;
  }

  // ─── Selectors de container de mensagem ─────────────────────────────────
  // FIX crítico v9.6.3: WA Web 2.3300+ removeu `[data-testid="msg-container"]`.
  // O DOM Monitor log do usuário confirmou que agora o WA usa
  // `#main [role="row"]` e/ou `div.message-in/.message-out` pra mensagens.
  //
  // Antes deste fix, 13 querySelectors hardcoded com o testid antigo
  // retornavam ZERO matches — o observer ficava cego, scan periódico não
  // cacheava nada, isEditedMessage nunca era chamado pra mensagens reais,
  // e edits incoming passavam invisíveis. Deletes continuavam aparecendo
  // só porque vêm pelo hook protocolar do wpp-hooks.js.
  //
  // Ordem importa: tentamos seletores mais específicos primeiro pra evitar
  // capturar wrappers irmãos. `[data-id]` é um ótimo fallback porque toda
  // mensagem renderizada tem o atributo.
  const MSG_CONTAINER_SELECTORS = [
    '[data-testid="msg-container"]',  // legacy (mantido por safety se WA voltar)
    'div.message-in',
    'div.message-out',
    '#main [role="row"] [data-id]',
    '[role="row"] > div[tabindex] > div[role="row"]',
    '[data-id]'
  ];

  // Sobe da target node até o container de mensagem mais próximo.
  // Substitui `element.closest('[data-testid="msg-container"]')` que ficou
  // null em todos os calls após o WA mudar o markup.
  function findMsgContainer(element) {
    if (!element || !element.closest) return null;
    for (const sel of MSG_CONTAINER_SELECTORS) {
      try {
        const found = element.closest(sel);
        if (found) return found;
      } catch (_) {}
    }
    return null;
  }

  // querySelectorAll resiliente: pega TODAS as mensagens dentro de parent
  // independente de qual selector o WA está usando nesta versão. Deduplica
  // por instância de Node (Set).
  function findMsgContainers(parent) {
    if (!parent || typeof parent.querySelectorAll !== 'function') return [];
    const seen = new Set();
    for (const sel of MSG_CONTAINER_SELECTORS) {
      try {
        const matches = parent.querySelectorAll(sel);
        for (const m of matches) seen.add(m);
      } catch (_) {}
    }
    return Array.from(seen);
  }

  function findContainer() {
    for (const sel of SELECTORS.MESSAGES_CONTAINER) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetHeight) return el;
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }
    return null;
  }

  function generateMsgKey(element) {
    // Tentar extrair ID do data attribute
    const dataId = element.getAttribute('data-id') || 
                   element.closest('[data-id]')?.getAttribute('data-id');
    
    if (dataId) return dataId;

    // Fallback: criar key única baseada em posição e conteúdo
    const parent = findMsgContainer(element) || element;
    const allMsgs = findMsgContainers(document);
    const index = Array.from(allMsgs).indexOf(parent);
    const text = (element.textContent || '').slice(0, 50);
    
    return `msg_${index}_${hashString(text)}`;
  }

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  function getCurrentChatId() {
    const header = findElement(document, SELECTORS.CHAT_HEADER);
    if (header) {
      return header.getAttribute('title') || header.textContent?.trim() || 'unknown';
    }
    return 'unknown';
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ============================================
  // EXTRAÇÃO DE DADOS DA MENSAGEM
  // ============================================

  function extractMessageData(element) {
    const msgContainer = findMsgContainer(element) || element;
    
    // Texto
    const textEl = findElement(msgContainer, SELECTORS.MESSAGE_TEXT);
    let text = textEl?.textContent?.trim() || '';

    // Verificar se é mensagem apagada
    const isDeleted = isDeletedMessage(msgContainer, text);

    // Se já é uma mensagem apagada, não cachear o texto de "apagada"
    if (isDeleted) {
      text = '';
    }

    // Remetente
    let from = 'Eu';
    const isOutgoing = !!findElement(msgContainer, SELECTORS.OUTGOING);
    
    if (!isOutgoing) {
      const senderEl = findElement(msgContainer, SELECTORS.SENDER_INFO);
      if (senderEl) {
        const prePlain = senderEl.getAttribute('data-pre-plain-text');
        if (prePlain) {
          const match = prePlain.match(/\] (.+?):/);
          if (match) from = match[1];
        } else {
          from = senderEl.textContent?.trim() || 'Contato';
        }
      } else {
        from = 'Contato';
      }
    }

    // Timestamp
    const timeEl = findElement(msgContainer, SELECTORS.TIMESTAMP);
    const timeText = timeEl?.textContent?.trim() || '';

    // Mídia
    let mediaUrl = null;
    let mediaType = null;
    const mediaEl = findElement(msgContainer, SELECTORS.MEDIA);
    
    if (mediaEl) {
      if (mediaEl.tagName === 'IMG') {
        mediaUrl = mediaEl.src;
        mediaType = 'image';
      } else if (mediaEl.tagName === 'VIDEO') {
        mediaUrl = mediaEl.src;
        mediaType = 'video';
      }
    }

    return {
      text,
      from,
      isOutgoing,
      isDeleted,
      timestamp: Date.now(),
      timeText,
      mediaUrl,
      mediaType,
      chatId: getCurrentChatId()
    };
  }

  function isDeletedMessage(element, text = '') {
    // Verificar por ícone de mensagem apagada — escopo :scope evita pegar
    // ícones de mensagens vizinhas se element for um wrapper.
    if (findElement(element, SELECTORS.DELETED_INDICATORS)) {
      return true;
    }

    // Verificar por texto — IMPORTANTE: usar APENAS o texto direto da
    // mensagem, NÃO element.textContent inteiro. Quando uma mensagem
    // responde a uma apagada, o quote dentro do bubble contém "Esta
    // mensagem foi apagada" e fazia toda mensagem-resposta virar "apagada".
    let msgText = text;
    if (!msgText) {
      const textEl = findElement(element, SELECTORS.MESSAGE_TEXT);
      msgText = textEl?.textContent?.trim() || '';
    }
    if (!msgText) return false;

    for (const pattern of SELECTORS.DELETED_TEXT_PATTERNS) {
      if (msgText.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Detecta mensagem editada (espelho de isDeletedMessage).
   *
   * Mesmo princípio: usa APENAS o texto direto da mensagem pra evitar
   * falso-positivo via quotes/replies. Combina selector DOM ('msg-edited'
   * label do WA) + padrões textuais "(Editada)/(Edited)/<Editada>" no
   * fim do corpo.
   *
   * FIX v9.6.4: WA Web 2.3300+ renderiza a label como plain "Editada"
   * (sem brackets, sem data-icon, sem aria-label específico) no meta
   * area da mensagem (entre o body e o timestamp). Adicionada varredura
   * por <span> contendo APENAS "Editada"/"Edited" como text node, fora
   * do container do body, pra cobrir esse caso.
   *
   * Importante: a checagem de isDeletedMessage tem prioridade. Mensagens
   * apagadas NUNCA são consideradas editadas (caller deve checar deleted
   * primeiro).
   */
  function isEditedMessage(element, text = '') {
    if (findElement(element, SELECTORS.EDITED_INDICATORS)) {
      return true;
    }
    let msgText = text;
    if (!msgText) {
      const textEl = findElement(element, SELECTORS.MESSAGE_TEXT);
      msgText = textEl?.textContent?.trim() || '';
    }

    // Se nosso próprio prefixo já está no body, é uma mensagem editada
    // que já foi marcada via hook protocolar — ainda precisamos retornar
    // true pra que checkForEditedMessages persista no histórico, mas
    // handleEditedMessage tem early-return pra não duplicar marca DOM.
    // FIX v9.6.6: inclui o prefixo combo '📝 Antes:' (era ausente — o
    // hook protocolar atual emite esse formato como caso preferencial,
    // e o check assimétrico fazia o body marcado cair no fallback
    // cacheMessage, poluindo state.messageCache com texto-marcador).
    if (msgText && (msgText.startsWith('📝 Antes:') ||
                    msgText.startsWith('✏️ Esta mensagem foi editada para:') ||
                    msgText.startsWith('✏️ Editada para:'))) {
      return true;
    }

    if (msgText) {
      for (const pattern of SELECTORS.EDITED_TEXT_PATTERNS) {
        if (msgText.includes(pattern)) return true;
      }
      // (Editada) / (Edited) só na ponta da string (evita falso-positivo
      // de mensagens que mencionam "editada" no meio do texto livre).
      if (/\b\(Editada\)\s*$/.test(msgText) || /\b\(Edited\)\s*$/.test(msgText)) {
        return true;
      }
    }

    // FIX v9.6.4: varredura por label "Editada" plain no meta area.
    // WA Web 2.3300+ não usa mais data-icon nem aria-label, só um <span>
    // com texto puro "Editada" antes do timestamp. Iteramos os <span>
    // dentro da mensagem (excluindo os que estão dentro do MESSAGE_TEXT,
    // que é o body) e checamos se algum tem text content exatamente
    // "Editada" ou "Edited".
    try {
      const msgTextEl = findElement(element, SELECTORS.MESSAGE_TEXT);
      const spans = element.querySelectorAll?.('span') || [];
      for (const span of spans) {
        // Skip elements dentro do body (evita falso-positivo de "Editada"
        // aparecer como palavra normal no texto livre)
        if (msgTextEl && (msgTextEl === span || msgTextEl.contains(span))) continue;
        // Skip se o span tem children (queremos só leaf nodes de texto)
        if (span.children && span.children.length > 0) continue;
        const t = (span.textContent || '').trim();
        if (t === 'Editada' || t === 'Edited' ||
            t === '<Editada>' || t === '<Edited>' ||
            t === '(Editada)' || t === '(Edited)') {
          return true;
        }
      }
    } catch (_) {}

    return false;
  }

  // ============================================
  // CACHE DE MENSAGENS
  // ============================================

  function cacheMessage(element) {
    const msgKey = generateMsgKey(element);
    const data = extractMessageData(element);

    // Não cachear mensagens apagadas ou vazias (sem texto E sem mídia).
    if (data.isDeleted || (!data.text && !data.mediaUrl)) {
      return;
    }

    // FIX v9.6.3: cache write-once. Antes a lógica era
    // `if (existing.text.length >= data.text.length) return` — mantinha
    // o cache se o novo texto fosse MENOR, mas SOBRESCREVIA se fosse
    // MAIOR. Isso quebrava a detecção de edits que ampliam o texto:
    // quando o contato editava "ok" → "ok valeu", o scan periódico
    // (5s) varria, o body novo era maior, o cache era sobrescrito com
    // "ok valeu" — aí quando handleEditedMessage rodava, cached.text já
    // era "ok valeu" === currentBody, considerava "sem mudança" e nada
    // aparecia. Agora: 1ª gravação válida fica imutável. Atualizações
    // explícitas ficam por conta do handleEditedMessage.
    const existing = state.messageCache.get(msgKey);
    if (existing && existing.text) {
      return; // já cacheado — não sobrescreve
    }

    state.messageCache.set(msgKey, {
      ...data,
      key: msgKey,
      cachedAt: Date.now()
    });

    log('✅ Mensagem cacheada:', msgKey, data.text?.slice(0, 30));

    // Limitar tamanho do cache
    if (state.messageCache.size > MAX_CACHE) {
      const keys = Array.from(state.messageCache.keys());
      for (let i = 0; i < 100; i++) {
        state.messageCache.delete(keys[i]);
      }
    }
  }

  function getCachedMessage(msgKey) {
    return state.messageCache.get(msgKey);
  }

  // ============================================
  // DETECÇÃO DE MENSAGENS APAGADAS
  // ============================================

  function handleDeletedMessage(element) {
    const msgKey = generateMsgKey(element);
    const cached = getCachedMessage(msgKey);

    if (!cached || !cached.text) {
      log('⚠️ Mensagem apagada sem cache:', msgKey);
      
      // Ainda assim, registrar no histórico como "não recuperável"
      const basicData = extractMessageData(element);
      addToHistory({
        key: msgKey,
        body: '[Conteúdo não recuperável - não estava em cache]',
        originalBody: null,
        from: basicData.from,
        chatId: basicData.chatId,
        action: 'deleted',
        recovered: false,
        timestamp: Date.now()
      });
      
      return;
    }

    log('🗑️ Mensagem apagada RECUPERADA:', cached.text.slice(0, 50));

    // Adicionar ao histórico
    const entry = {
      key: msgKey,
      body: cached.text,
      originalBody: cached.text,
      from: cached.from,
      chatId: cached.chatId,
      isOutgoing: cached.isOutgoing,
      mediaUrl: cached.mediaUrl,
      mediaType: cached.mediaType,
      action: 'deleted',
      recovered: true,
      timestamp: Date.now(),
      originalTimestamp: cached.timestamp
    };

    addToHistory(entry);

    // IMPORTANTE: Injetar conteúdo recuperado no DOM
    injectRecoveredContent(element, cached);

    // Notificar
    notifyRecovery(entry);
  }

  /**
   * Espelho de handleDeletedMessage, mas para edits.
   *
   * Diferença-chave: pra edição precisamos do body ATUAL (texto novo
   * pós-edit, lido do DOM) E do body ANTERIOR (texto antes, vindo do
   * messageCache). O `cached.text` foi guardado antes do edit pelo
   * cacheMessage no scan periódico — é justamente o que queremos como
   * `originalBody`.
   *
   * Sem cache prévio (cliente nunca viu a msg pré-edit), registramos
   * só o "depois" como fallback parcial, igual fazemos para deletes.
   * Idempotência via flag whl-edit-marker no container — não duplica
   * registro a cada tick do scan.
   */
  function handleEditedMessage(element) {
    const msgContainer = findMsgContainer(element) || element;

    // Evita reprocessar a mesma edição em ticks subsequentes do observer/scan.
    if (msgContainer.dataset?.whlEditHandled === 'true') return;

    const msgKey = generateMsgKey(element);
    const cached = getCachedMessage(msgKey);
    const currentData = extractMessageData(element);
    const currentBody = currentData?.text || '';

    // Se body atual é igual ao cacheado, não houve mudança real
    // (selector EDITED_INDICATORS pegou ruído). Não registra.
    if (cached?.text && currentBody && cached.text === currentBody) {
      return;
    }

    // Se já contém nossa anotação (hook protocolar processou), não duplica.
    // FIX v9.6.5: cobre os 3 formatos de marcador possíveis (combo "Antes",
    // "Esta mensagem foi editada para", e "Editada para" sozinho).
    if (currentBody && (
        currentBody.startsWith('📝 Antes:') ||
        currentBody.startsWith('✏️ Esta mensagem foi editada para:') ||
        currentBody.startsWith('✏️ Editada para:'))) {
      msgContainer.dataset.whlEditHandled = 'true';
      return;
    }

    const entry = {
      key: msgKey,
      body: currentBody || '[texto editado não capturado]',
      originalBody: cached?.text || null,
      from: currentData?.from || cached?.from || '',
      chatId: currentData?.chatId || cached?.chatId || '',
      isOutgoing: cached?.isOutgoing ?? currentData?.isOutgoing ?? false,
      mediaUrl: cached?.mediaUrl || null,
      mediaType: cached?.mediaType || null,
      action: 'edited',
      recovered: !!cached?.text,
      timestamp: Date.now()
    };

    addToHistory(entry);
    msgContainer.dataset.whlEditHandled = 'true';

    // Atualiza cache com o body atual pra que próximas edições
    // tenham o "antes" certo (último estado conhecido).
    if (currentBody) {
      state.messageCache.set(msgKey, {
        ...(cached || {}),
        ...currentData,
        key: msgKey,
        text: currentBody,
        cachedAt: Date.now()
      });
    }

    // FIX v9.6.5: NÃO injetamos mais marker visual via DOM. O hook
    // protocolar (updateMessageEditsLocally em wpp-hooks.js) já modifica
    // o msg.body diretamente no Msg store com o formato combo
    // "📝 Antes: ...\n✏️ Editada para: ..." — o WA renderiza isso
    // nativamente sem precisar de injeção HTML separada. A injeção
    // antiga via DOM causava:
    //   - markers duplicados ou vazios quando extractMessageData não
    //     conseguia ler o texto (emojis, mídia, selectors WA mudados)
    //   - poluição visual com 2 blocos azuis quando o hook protocolar
    //     também tinha processado mas o startsWith não match'ou
    //   - dependência de selectors DOM frágeis que quebram a cada
    //     update do WA Web
    //
    // Se o hook protocolar NÃO disparar (ex.: WA renomeou módulo), o
    // user vê só a label "Editada" nativa + entrada salva no histórico
    // do Recover (acessível pelo painel). Sem poluição visual no chat.

    log('✏️ Mensagem editada registrada:', msgKey, currentBody?.slice(0, 40));
    notifyRecovery(entry);
  }

  // FIX v9.6.5: injectEditedContent removida. O hook protocolar em
  // wpp-hooks.js (updateMessageEditsLocally) agora muta msg.body com o
  // formato "📝 Antes: ...\n✏️ Editada para: ..." direto no Msg store,
  // e o WA renderiza isso nativamente. A injeção HTML separada gerava
  // markers vazios/duplicados quando extractMessageData não conseguia
  // ler o texto (emojis, mídia, selectors mudados) e poluía o chat.

  function injectRecoveredContent(element, cached) {
    try {
      const msgContainer = findMsgContainer(element) || element;
      
      // Verificar se já foi processado
      if (msgContainer.querySelector('.whl-recovered-marker')) {
        return;
      }

      // Encontrar onde injetar o texto
      const textContainer = findElement(msgContainer, SELECTORS.MESSAGE_TEXT) ||
                           msgContainer.querySelector('.copyable-text') ||
                           msgContainer.querySelector('span[dir="ltr"]');

      if (textContainer) {
        // Criar badge de recuperado
        const wrapper = document.createElement('span');
        wrapper.className = 'whl-recovered-marker';
        wrapper.innerHTML = `
          <span style="color: #ef4444; font-weight: bold;">🚫 Apagada: </span>
          <span style="color: #fbbf24; font-style: italic;">${escapeHtml(cached.text)}</span>
        `;
        wrapper.title = 'Mensagem recuperada pelo WhatsHybrid';
        wrapper.style.cssText = 'display: inline; cursor: help;';

        // Substituir conteúdo
        textContainer.innerHTML = '';
        textContainer.appendChild(wrapper);

        // Adicionar estilo ao container
        msgContainer.style.background = 'rgba(251, 191, 36, 0.1)';
        msgContainer.style.borderLeft = '3px solid #fbbf24';

        log('✅ Conteúdo recuperado injetado no DOM');
      }
    } catch (e) {
      log('Erro ao injetar conteúdo:', e);
    }
  }

  function escapeHtml(text) {
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(text);
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // ============================================
  // HISTÓRICO
  // ============================================

  async function loadHistory() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        state.history = result[STORAGE_KEY];
        log('Histórico carregado:', state.history.length, 'mensagens');
      }
    } catch (e) {
      console.error('[RecoverDOM] Erro ao carregar histórico:', e);
    }
  }

  async function saveHistory() {
    try {
      // Limitar por contagem
      if (state.history.length > MAX_HISTORY) {
        state.history = state.history.slice(-MAX_HISTORY);
      }

      // Limitar por tamanho
      let data = JSON.stringify(state.history);
      while (data.length > MAX_STORAGE_BYTES && state.history.length > 10) {
        state.history.shift();
        data = JSON.stringify(state.history);
      }

      await chrome.storage.local.set({ [STORAGE_KEY]: state.history });
      log('Histórico salvo:', state.history.length, 'mensagens');
    } catch (e) {
      console.error('[RecoverDOM] Erro ao salvar histórico:', e);
    }
  }

  function addToHistory(entry) {
    // Evitar duplicatas
    const exists = state.history.some(h => h.key === entry.key && h.action === entry.action);
    if (exists) return;

    state.history.push(entry);
    saveHistory();

    // Emitir evento
    if (window.EventBus?.emit) {
      window.EventBus.emit('recover:message_recovered', entry);
    }

    // Sincronizar com wpp-hooks se disponível
    try {
      window.postMessage({
        type: 'WHL_RECOVER_NEW_MESSAGE',
        payload: entry
      }, window.location.origin);
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
  }

  function getHistory() {
    return [...state.history];
  }

  function clearHistory() {
    state.history = [];
    saveHistory();
  }

  // ============================================
  // DOWNLOAD DE MÍDIA DO HISTÓRICO
  // ============================================

  async function downloadFromHistory(entry) {
    log('📥 Download do histórico:', entry.key);

    try {
      // Se tem URL de mídia
      if (entry.mediaUrl) {
        if (entry.mediaUrl.startsWith('blob:')) {
          // Blob URL pode não estar mais válida
          throw new Error('URL de blob expirada');
        }
        
        // Abrir em nova aba ou baixar
        const a = document.createElement('a');
        a.href = entry.mediaUrl;
        a.target = '_blank';
        a.download = `recovered_${entry.mediaType || 'media'}_${Date.now()}.${entry.mediaType === 'video' ? 'mp4' : 'jpg'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        return { ok: true, method: 'direct' };
      }

      // Se só tem texto, criar arquivo de texto
      if (entry.body) {
        const content = `Mensagem Recuperada
==================
De: ${entry.from}
Chat: ${entry.chatId}
Data: ${new Date(entry.timestamp).toLocaleString()}
Ação: ${entry.action}

Conteúdo:
${entry.body}
`;
        
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `recovered_message_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);
        
        return { ok: true, method: 'text' };
      }

      throw new Error('Sem conteúdo para download');
    } catch (e) {
      console.error('[RecoverDOM] Erro no download:', e);
      return { ok: false, error: e.message };
    }
  }

  /**
   * Baixa a mídia mais recente do chat atual
   * Método: encontrar a última mensagem com mídia e tentar baixar
   */
  async function downloadRecentMedia() {
    log('📥 Buscando mídia recente...');

    try {
      const container = findContainer();
      if (!container) throw new Error('Container não encontrado');

      // Buscar todas as mensagens com mídia
      const allMsgs = findMsgContainers(container);
      
      for (let i = allMsgs.length - 1; i >= 0; i--) {
        const msg = allMsgs[i];
        const mediaEl = findElement(msg, SELECTORS.MEDIA);
        
        if (!mediaEl) continue;

        // Tentar clicar para abrir
        const clickTarget = msg.querySelector('[data-testid="image-thumb"], [data-testid="video-thumb"], img');
        if (clickTarget) {
          clickTarget.click();
          await sleep(800);

          // Procurar botão de download
          const downloadBtn = document.querySelector('[data-testid="media-download"]') ||
                              document.querySelector('span[data-icon="download"]') ||
                              document.querySelector('[aria-label*="Download"]');

          if (downloadBtn) {
            downloadBtn.click();
            log('✅ Download iniciado');

            // Fechar preview depois de um tempo
            setTimeout(() => {
              const closeBtn = document.querySelector('[data-testid="x-viewer"]') ||
                               document.querySelector('span[data-icon="x-viewer"]') ||
                               document.querySelector('span[data-icon="x"]');
              closeBtn?.click();
            }, 1500);

            return { ok: true };
          }

          // Fechar se não encontrou download
          const closeBtn = document.querySelector('[data-testid="x-viewer"]');
          closeBtn?.click();
        }

        // Fallback: tentar extrair URL
        if (mediaEl.src && !mediaEl.src.startsWith('blob:')) {
          window.open(mediaEl.src, '_blank');
          return { ok: true, url: mediaEl.src };
        }
      }

      throw new Error('Nenhuma mídia encontrada para download');
    } catch (e) {
      console.error('[RecoverDOM] Erro:', e);
      return { ok: false, error: e.message };
    }
  }

  // ============================================
  // NOTIFICAÇÕES
  // ============================================

  function notifyRecovery(entry) {
    // FIX v9.6.5: toast pop-up só pra deletes — edits ficam só com a
    // marca inline no chat (mesmo comportamento que mensagens apagadas
    // recuperadas). Antes mostrava notification "Mensagem de X recuperada!"
    // toda vez que o contato editava, poluindo a tela.
    if (entry.action !== 'edited' && window.NotificationsModule?.toast) {
      window.NotificationsModule.toast(
        `🗑️ Mensagem de ${entry.from} recuperada!`,
        'warning',
        4000
      );
    }

    // Enviar para sidepanel SEMPRE (UI do Recover precisa do registro).
    try {
      chrome.runtime?.sendMessage({
        type: 'WHL_RECOVER_NEW_MESSAGE',
        payload: entry
      }).catch(() => {});
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
  }

  // ============================================
  // OBSERVER E SCAN
  // ============================================

  function startObserver() {
    if (state.observer) {
      state.observer.disconnect();
    }

    const container = findContainer();
    if (!container) {
      log('Container não encontrado, tentando novamente...');
      setTimeout(startObserver, 2000);
      return;
    }

    state.currentChatId = getCurrentChatId();
    log('✅ Iniciando observer para:', state.currentChatId);

    // Cachear mensagens existentes
    scanAndCacheMessages(container);

    state.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Processar nodes adicionados
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // FIX v9.6.3: resiliente a múltiplos selectors (WA mudou markup).
          const selfMatches = MSG_CONTAINER_SELECTORS.some(sel => {
            try { return node.matches?.(sel); } catch (_) { return false; }
          });
          const messages = selfMatches ? [node] : findMsgContainers(node);

          for (const msg of messages) {
            if (isDeletedMessage(msg)) {
              handleDeletedMessage(msg);
            } else if (isEditedMessage(msg)) {
              // Edição. Cacheia se for a 1ª vez antes (raro, msgs novas
              // geralmente entram limpas) e despacha pro handler.
              handleEditedMessage(msg);
            } else {
              cacheMessage(msg);
            }
          }
        }

        // Verificar alterações em nodes existentes (in-place mutations:
        // edit/revoke acontecem aqui mais frequentemente que em addedNodes)
        if (mutation.type === 'characterData' || mutation.type === 'childList') {
          const target = mutation.target;
          const msgContainer = findMsgContainer(target);

          if (msgContainer) {
            if (isDeletedMessage(msgContainer)) {
              handleDeletedMessage(msgContainer);
            } else if (isEditedMessage(msgContainer)) {
              handleEditedMessage(msgContainer);
            }
          }
        }
      }
    });

    state.observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Scan periódico para pegar mensagens que possam ter sido perdidas
    if (state.scanInterval) clearInterval(state.scanInterval);
    state.scanInterval = setInterval(() => {
      scanAndCacheMessages(container);
      checkForDeletedMessages(container);
      checkForEditedMessages(container);
    }, 5000);
  }

  /**
   * Espelha checkForDeletedMessages — varre o container atrás de
   * mensagens editadas que possam ter escapado do MutationObserver
   * (race entre injeção do label "editada" e o nosso callback,
   * ou WhatsApp pintando in-place sem disparar childList em um nó
   * que observamos diretamente).
   *
   * Usa dataset.whlEditHandled como sentinela pra não reprocessar.
   */
  function checkForEditedMessages(container) {
    const messages = findMsgContainers(container);
    for (const msg of messages) {
      if (msg.dataset?.whlEditHandled === 'true') continue;
      if (isDeletedMessage(msg)) continue;  // delete tem prioridade
      if (isEditedMessage(msg)) {
        handleEditedMessage(msg);
      }
    }
  }

  function scanAndCacheMessages(container) {
    const messages = findMsgContainers(container);
    let cached = 0;

    for (const msg of messages) {
      if (!isDeletedMessage(msg)) {
        const msgKey = generateMsgKey(msg);
        if (!state.messageCache.has(msgKey)) {
          cacheMessage(msg);
          cached++;
        }
      }
    }

    if (cached > 0) {
      log(`Scan: ${cached} novas mensagens cacheadas`);
    }
  }

  function checkForDeletedMessages(container) {
    const messages = findMsgContainers(container);

    for (const msg of messages) {
      if (isDeletedMessage(msg)) {
        const msgKey = generateMsgKey(msg);
        
        // Verificar se já processamos esta mensagem apagada
        const alreadyProcessed = msg.querySelector('.whl-recovered-marker');
        if (alreadyProcessed) continue;

        // Verificar se temos no histórico (persistência após reload)
        const historyEntry = state.history.find(h => h.key === msgKey);
        if (historyEntry) {
          // Re-injetar marcador do Recover para a mesma mensagem apagada
          try {
            const recoveredText = historyEntry.body || historyEntry.originalBody || (historyEntry.mediaType ? `[mídia: ${historyEntry.mediaType}]` : 'Mensagem apagada');
            injectRecoveredContent(msg, { text: recoveredText });
          } catch (e) {
            console.warn('[RecoverDOM] Falha ao re-injetar marcador:', e);
          }
          continue;
        }

        // Processar (novo item)
        handleDeletedMessage(msg);
      }
    }
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  async function init() {
    if (state.initialized) return;

    log('🔄 Inicializando RecoverDOM v2.0...');

    await loadHistory();

    // Aguardar DOM do WhatsApp
    const waitInterval = setInterval(() => {
      const container = findContainer();
      if (container) {
        clearInterval(waitInterval);
        startObserver();
        state.initialized = true;
        log('✅ RecoverDOM v2.0 inicializado');
        
        // Emitir evento de pronto
        if (window.EventBus?.emit) {
          window.EventBus.emit('recover:ready', { historyCount: state.history.length });
        }
      }
    }, 1000);

    // Timeout
    setTimeout(() => {
      clearInterval(waitInterval);
      if (!state.initialized) {
        log('⚠️ Timeout aguardando WhatsApp');
      }
    }, 30000);

    // Reiniciar observer quando chat muda
    if (chatChangeInterval) clearInterval(chatChangeInterval);
    chatChangeInterval = setInterval(() => {
      const currentChat = getCurrentChatId();
      if (currentChat !== state.currentChatId) {
        log('Chat mudou:', currentChat);
        state.currentChatId = currentChat;
        setTimeout(startObserver, 500);
      }
    }, 2000);
  }

  // ============================================
  // INTEGRAÇÃO COM RecoverAdvanced
  // ============================================

  function syncWithRecoverAdvanced(entry) {
    // Se RecoverAdvanced existe, registrar evento nele também
    if (window.RecoverAdvanced?.registerMessageEvent) {
      try {
        const stateMap = {
          'deleted': 'deleted_local',
          'revoked': 'revoked_global',
          'edited': 'edited'
        };
        
        window.RecoverAdvanced.registerMessageEvent(
          entry.key || entry.id,
          stateMap[entry.action] || 'deleted_local',
          {
            body: entry.body,
            from: entry.from,
            chatId: entry.chatId,
            timestamp: entry.timestamp,
            mediaUrl: entry.mediaUrl,
            mediaType: entry.mediaType
          }
        );
        
        log('✅ Sincronizado com RecoverAdvanced');
      } catch (e) {
        log('⚠️ Erro ao sincronizar com RecoverAdvanced:', e);
      }
    }
  }

  // Sobrescrever addToHistory para sincronizar
  const originalAddToHistory = addToHistory;
  function addToHistoryWithSync(entry) {
    // Evitar duplicatas
    const exists = state.history.some(h => h.key === entry.key && h.action === entry.action);
    if (exists) return;

    state.history.push(entry);
    saveHistory();

    // Sincronizar com RecoverAdvanced
    syncWithRecoverAdvanced(entry);

    // Emitir evento
    if (window.EventBus?.emit) {
      window.EventBus.emit('recover:message_recovered', entry);
    }

    // Sincronizar com wpp-hooks se disponível
    try {
      window.postMessage({
        type: 'WHL_RECOVER_NEW_MESSAGE',
        payload: entry
      }, window.location.origin);
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
  }

  // ============================================
  // API PÚBLICA
  // ============================================

  window.RecoverDOM = {
    // Lifecycle
    init,
    
    // Histórico
    getHistory,
    clearHistory,
    addToHistory: addToHistoryWithSync,
    
    // Download
    downloadFromHistory,
    downloadRecentMedia,
    
    // Cache
    getCachedMessage,
    getCacheSize: () => state.messageCache.size,
    
    // Estado
    isInitialized: () => state.initialized,
    getCurrentChat: () => state.currentChatId,
    
    // Para compatibilidade com módulo antigo
    loadFromStorage: loadHistory
  };

  // Se RecoverAdvanced não existir ou falhou ao inicializar, criar fallback
  setTimeout(() => {
    if (!window.RecoverAdvanced || !window.RecoverAdvanced.getPage) {
      console.log('[RecoverDOM] ⚠️ RecoverAdvanced não disponível, criando fallback...');
      
      window.RecoverAdvanced = {
        init,
        loadFromStorage: loadHistory,
        
        // Métodos de histórico
        getPage: (pageNum = 0, pageSize = 20) => {
          const history = getHistory();
          const start = pageNum * pageSize;
          const end = start + pageSize;
          const messages = history.slice(start, end);
          
          return {
            messages,
            page: pageNum,
            pageSize,
            total: history.length,
            totalPages: Math.ceil(history.length / pageSize),
            hasNext: end < history.length,
            hasPrev: pageNum > 0
          };
        },
        
        nextPage: () => {
          state._currentPage = (state._currentPage || 0) + 1;
          return window.RecoverAdvanced.getPage(state._currentPage);
        },
        
        prevPage: () => {
          state._currentPage = Math.max(0, (state._currentPage || 0) - 1);
          return window.RecoverAdvanced.getPage(state._currentPage);
        },
        
        setFilter: (key, value) => {
          state._filters = state._filters || {};
          state._filters[key] = value;
        },
        
        getFilters: () => state._filters || {},
        
        _favorites: new Set(),
        
        isFavorite: (id) => window.RecoverAdvanced._favorites.has(id),
        
        toggleFavorite: (id) => {
          if (window.RecoverAdvanced._favorites.has(id)) {
            window.RecoverAdvanced._favorites.delete(id);
            return false;
          }
          window.RecoverAdvanced._favorites.add(id);
          return true;
        },
        
        compareEdited: (id) => {
          const msg = getHistory().find(m => (m.id || m.key) === id);
          if (!msg) return null;
          return {
            original: msg.originalText || msg.originalBody || '[original não disponível]',
            edited: msg.body || '[editado não disponível]'
          };
        },
        
        getStats: () => {
          const history = getHistory();
          return {
            total: history.length,
            deleted: history.filter(m => m.action === 'deleted').length,
            edited: history.filter(m => m.action === 'edited').length,
            revoked: history.filter(m => m.action === 'revoked').length,
            recovered: history.filter(m => m.recovered).length
          };
        },
        
        exportToCSV: () => {
          const history = getHistory();
          const headers = ['Data', 'De', 'Para', 'Ação', 'Conteúdo'];
          const rows = history.map(m => [
            new Date(m.timestamp || Date.now()).toLocaleString('pt-BR'),
            m.from || '',
            m.to || m.chatId || '',
            m.action || '',
            (m.body || '').replace(/"/g, '""')
          ]);
          
          const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
          
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `recover_export_${Date.now()}.csv`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        },
        
        exportToTXT: () => {
          const history = getHistory();
          const content = history.map(m => 
            `[${new Date(m.timestamp || Date.now()).toLocaleString('pt-BR')}] ${m.action?.toUpperCase() || 'MSG'}\nDe: ${m.from || '?'}\nConteúdo: ${m.body || '[mídia]'}\n`
          ).join('\n---\n');
          
          const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `recover_export_${Date.now()}.txt`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        },
        
        exportToPDF: () => {
          alert('Exportação PDF não disponível. Use CSV ou TXT.');
        },
        
        registerMessageEvent: (msgId, msgState, msgData) => {
          addToHistoryWithSync({
            id: msgId,
            key: msgId,
            action: msgState === 'deleted_local' ? 'deleted' : msgState === 'revoked_global' ? 'revoked' : 'edited',
            ...msgData,
            timestamp: Date.now()
          });
        },
        
        MESSAGE_STATES: {
          DELETED_LOCAL: 'deleted_local',
          REVOKED_GLOBAL: 'revoked_global',
          EDITED: 'edited'
        },
        
        downloadFromHistory
      };
      
      console.log('[RecoverDOM] ✅ Fallback RecoverAdvanced criado');
    } else {
      console.log('[RecoverDOM] ✅ RecoverAdvanced já existe, usando-o');
    }
  }, 3000); // Aguardar 3 segundos para RecoverAdvanced carregar

  // Cleanup ao descarregar
  window.addEventListener('beforeunload', () => {
    if (state.scanInterval) clearInterval(state.scanInterval);
    if (chatChangeInterval) clearInterval(chatChangeInterval);
    if (state.observer) state.observer.disconnect();
  });

  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2000));
  } else {
    setTimeout(init, 2000);
  }

  console.log('[RecoverDOM] 🔄 Módulo v2.0 carregado');
})();
