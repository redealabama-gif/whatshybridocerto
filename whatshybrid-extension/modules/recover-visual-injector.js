/**
 * Recover Visual Injector - Injetor Visual de Indicadores de Mensagens Recover
 *
 * Injeta visualmente badges/indicadores nas mensagens do WhatsApp para mostrar:
 * - 🗑️ Mensagem DELETADA (deleted locally)
 * - 🔴 Mensagem REVOGADA (revoked by sender)
 * - ✏️ Mensagem EDITADA (edited)
 *
 * NOVO: Persiste indicadores após reload da página usando:
 * - messageVersions do RecoverAdvanced (Map em memória)
 * - chrome.storage.local para persistência entre reloads
 * - Injeção de "quote-like" visual mostrando o conteúdo original
 *
 * @version 2.0.0
 */

(function() {
  'use strict';

  console.log('[RecoverVisualInjector] 🎨 Inicializando v2.0...');

  // Configurações
  const CONFIG = {
    CHECK_INTERVAL: 2000, // Verificar a cada 2 segundos
    BADGE_CLASS: 'whl-recover-badge',
    QUOTE_CLASS: 'whl-recover-quote',
    INJECTED_ATTR: 'data-whl-recover-injected',
    STORAGE_KEY: 'whl_recover_visual_markers',
    MAX_MARKERS: 500
  };

  // Estado com que o elemento foi marcado como pronto (ver processMessage).
  const STATE_ATTR = 'data-whl-recover-state';

  // Storage para marcadores persistentes
  let persistentMarkers = new Map();

  // Tipos de estados e seus estilos
  const MESSAGE_STATES = {
    DELETED_LOCAL: {
      id: 'deleted_local',
      emoji: '🗑️',
      text: 'Essa mensagem foi apagada',
      color: '#ef4444',
      bgColor: '#fee2e2'
    },
    REVOKED_GLOBAL: {
      id: 'revoked_global',
      emoji: '🔴',
      text: 'Essa mensagem foi apagada',
      color: '#dc2626',
      bgColor: '#fef2f2'
    },
    EDITED: {
      id: 'edited',
      emoji: '✏️',
      text: 'Essa mensagem foi editada',
      color: '#3b82f6',
      bgColor: '#dbeafe'
    }
  };

  // Estado
  let observer = null;
  let initialized = false;
  let checkInterval = null;
  let chatChangeInterval = null;

  // ============================================
  // PERSISTÊNCIA DE MARCADORES
  // ============================================

  /**
   * Carrega marcadores persistentes do storage
   */
  async function loadPersistentMarkers() {
    try {
      const result = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
      if (result[CONFIG.STORAGE_KEY]) {
        const data = result[CONFIG.STORAGE_KEY];
        if (typeof data === 'object') {
          let dropped = 0;
          Object.entries(data).forEach(([id, marker]) => {
            // Id inválido = gravado com o bug do id "container": descarta.
            if (!isValidMsgId(id)) { dropped++; return; }
            persistentMarkers.set(id, marker);
          });
          if (dropped) {
            console.warn('[RecoverVisualInjector] 🧹 Removidos', dropped, 'marcadores com id inválido');
            savePersistentMarkers();
          }
          console.log('[RecoverVisualInjector] ✅ Carregados', persistentMarkers.size, 'marcadores persistentes');
        }
      }
    } catch (e) {
      console.warn('[RecoverVisualInjector] Erro ao carregar marcadores:', e);
    }
  }

  /**
   * Salva marcadores no storage
   */
  async function savePersistentMarkers() {
    try {
      // Converter Map para objeto
      const data = {};
      persistentMarkers.forEach((marker, id) => {
        data[id] = marker;
      });
      
      // Limitar tamanho
      const keys = Object.keys(data);
      if (keys.length > CONFIG.MAX_MARKERS) {
        const toRemove = keys.slice(0, keys.length - CONFIG.MAX_MARKERS);
        toRemove.forEach(k => delete data[k]);
      }
      
      await chrome.storage.local.set({ [CONFIG.STORAGE_KEY]: data });
    } catch (e) {
      console.warn('[RecoverVisualInjector] Erro ao salvar marcadores:', e);
    }
  }

  /**
   * Adiciona um marcador persistente
   */
  function addPersistentMarker(msgId, markerData) {
    persistentMarkers.set(msgId, {
      ...markerData,
      createdAt: Date.now()
    });
    savePersistentMarkers();
  }

  /**
   * Verifica se há um marcador persistente para esta mensagem
   */
  function getPersistentMarker(msgId) {
    return persistentMarkers.get(msgId);
  }

  /**
   * Inicializa o injetor visual
   */
  async function init() {
    if (initialized) return;

    console.log('[RecoverVisualInjector] 🎨 Registrando...');

    // Carregar marcadores persistentes primeiro
    await loadPersistentMarkers();

    // Auto-clean defensivo: storage de markers corrompido em versões
    // antigas (pré PR #49) marcou TODAS as mensagens como deleted. Mesmo
    // com a detecção nova rigorosa, esses markers persistiam e o usuário
    // continuava vendo "essa mensagem foi apagada" em tudo. Limite empírico:
    // usuário comum mantém ~50 msgs/conversa × ~5 conversas ativas ≈ 250 max.
    // > MAX_MARKERS (500) = certeza de bug; > 300 = forte indício. Limpa
    // automaticamente pra o usuário não precisar rodar comando no console.
    const CORRUPTION_THRESHOLD = 300;
    if (persistentMarkers.size > CORRUPTION_THRESHOLD) {
      console.warn('[RecoverVisualInjector] 🧹 Storage corrompido detectado:', persistentMarkers.size, 'markers (>', CORRUPTION_THRESHOLD, '). Auto-limpando.');
      persistentMarkers.clear();
      try {
        await chrome.storage.local.remove(CONFIG.STORAGE_KEY);
        // Limpa também badges já injetados na sessão
        document.querySelectorAll(`.${CONFIG.QUOTE_CLASS}`).forEach(q => q.remove());
        document.querySelectorAll(`[${CONFIG.INJECTED_ATTR}]`).forEach(el => {
          el.removeAttribute(CONFIG.INJECTED_ATTR);
          el.style.background = '';
        });
      } catch (e) {
        console.warn('[RecoverVisualInjector] Falha ao limpar storage corrompido:', e?.message);
      }
    }

    // Injetar CSS
    injectCSS();

    // Iniciar observador
    startObserver();

    // Processar mensagens existentes (com atraso para garantir que DOM está pronto)
    setTimeout(processExistingMessages, 500);

    // Verificar periodicamente
    if (checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(processExistingMessages, CONFIG.CHECK_INTERVAL);

    // Também verificar quando a conversa muda
    setupChatChangeListener();

    // Registro novo (ou mídia que chegou depois) no Recover → completa os
    // banners na hora, sem esperar a próxima verificação periódica.
    if (window.EventBus?.on) {
      let kickTimer = null;
      const kick = () => {
        clearTimeout(kickTimer);
        kickTimer = setTimeout(processExistingMessages, 150);
      };
      window.EventBus.on('recover:message_added', kick);
      window.EventBus.on('recover:message_updated', kick);
    }

    initialized = true;
    console.log('[RecoverVisualInjector] ✅ Inicializado com', persistentMarkers.size, 'marcadores');

    // Cleanup
    window.addEventListener('beforeunload', () => {
      if (checkInterval) clearInterval(checkInterval);
      if (chatChangeInterval) clearInterval(chatChangeInterval);
      if (observer) observer.disconnect();
    });
  }

  /**
   * Detecta mudanças de chat e reprocessa mensagens
   */
  function setupChatChangeListener() {
    let lastChatId = null;
    
    if (chatChangeInterval) clearInterval(chatChangeInterval);
    chatChangeInterval = setInterval(() => {
      const header = document.querySelector('#main header span[title], [data-testid="conversation-info-header-chat-title"]');
      const currentChatId = header?.getAttribute('title') || header?.textContent;
      
      if (currentChatId && currentChatId !== lastChatId) {
        lastChatId = currentChatId;
        console.log('[RecoverVisualInjector] 🔄 Chat mudou, reprocessando...');
        setTimeout(processExistingMessages, 1000);
      }
    }, 1000);
  }

  /**
   * Injeta CSS para os badges e quote-like visual
   */
  function injectCSS() {
    const style = document.createElement('style');
    style.id = 'whl-recover-visual-styles';
    style.textContent = `
      /* Badge simples */
      .${CONFIG.BADGE_CLASS} {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        margin-top: 6px;
        margin-bottom: 2px;
        border: 1px solid currentColor;
        opacity: 0.9;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      .${CONFIG.BADGE_CLASS}-deleted,
      .${CONFIG.BADGE_CLASS}-deleted-local {
        color: #ef4444;
        background-color: #fee2e2;
        border-color: #fca5a5;
      }

      .${CONFIG.BADGE_CLASS}-revoked,
      .${CONFIG.BADGE_CLASS}-revoked-global {
        color: #dc2626;
        background-color: #fef2f2;
        border-color: #fca5a5;
      }

      .${CONFIG.BADGE_CLASS}-edited {
        color: #3b82f6;
        background-color: #dbeafe;
        border-color: #93c5fd;
      }

      .${CONFIG.BADGE_CLASS}:hover {
        opacity: 1;
      }

      /* Quote-like visual (como resposta do WhatsApp) */
      .${CONFIG.QUOTE_CLASS} {
        display: flex;
        flex-direction: column;
        background: linear-gradient(135deg, rgba(255, 87, 87, 0.1), rgba(255, 87, 87, 0.05));
        border-left: 4px solid #ff5757;
        border-radius: 8px;
        padding: 8px 12px;
        margin: 8px 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        max-width: 100%;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .${CONFIG.QUOTE_CLASS}:hover {
        background: linear-gradient(135deg, rgba(255, 87, 87, 0.15), rgba(255, 87, 87, 0.08));
        transform: translateY(-1px);
        box-shadow: 0 2px 6px rgba(0,0,0,0.15);
      }

      .${CONFIG.QUOTE_CLASS}-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 600;
        color: #ff5757;
        margin-bottom: 4px;
      }

      .${CONFIG.QUOTE_CLASS}-icon {
        font-size: 14px;
      }

      /* Cor herdada do balão: segue o tema do WhatsApp (claro/escuro), não o
         do sistema — antes, com sistema claro e WhatsApp escuro, o texto
         original ficava escuro sobre o balão escuro (quase invisível). */
      .${CONFIG.QUOTE_CLASS}-content {
        font-size: 13px;
        color: inherit;
        opacity: 0.9;
        line-height: 1.4;
        word-break: break-word;
        max-height: 60px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .${CONFIG.QUOTE_CLASS}-footer {
        font-size: 10px;
        color: inherit;
        opacity: 0.6;
        margin-top: 4px;
        font-style: italic;
      }

      .${CONFIG.QUOTE_CLASS}-media {
        display: block;
        max-width: 220px;
        max-height: 220px;
        width: auto;
        border-radius: 6px;
        margin: 4px 0;
        object-fit: cover;
      }

      .${CONFIG.QUOTE_CLASS}-audio {
        display: block;
        width: 240px;
        max-width: 100%;
        height: 36px;
        margin: 4px 0;
      }

      .${CONFIG.QUOTE_CLASS}-download {
        display: inline-block;
        font-size: 12px;
        margin-top: 4px;
        color: #53bdeb;
        text-decoration: none;
      }

      .${CONFIG.QUOTE_CLASS}-label {
        font-size: 12px;
        opacity: 0.85;
        margin-top: 2px;
        word-break: break-word;
      }

      /* Variação para editadas */
      .${CONFIG.QUOTE_CLASS}-edited {
        border-left-color: #3b82f6;
        background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(59, 130, 246, 0.05));
      }

      .${CONFIG.QUOTE_CLASS}-edited:hover {
        background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(59, 130, 246, 0.08));
      }

      .${CONFIG.QUOTE_CLASS}-edited .${CONFIG.QUOTE_CLASS}-header {
        color: #3b82f6;
      }

      /* Container da mensagem com indicador */
      [data-whl-recover-injected="true"] {
        position: relative;
      }

    `;

    if (!document.getElementById('whl-recover-visual-styles')) {
      document.head.appendChild(style);
      console.log('[RecoverVisualInjector] 🎨 CSS injetado');
    }
  }

  /**
   * Inicia MutationObserver para detectar novas mensagens
   */
  function startObserver() {
    // Observar mudanças no container de mensagens
    const chatContainer = document.querySelector('#main') || document.body;

    if (observer) {
      observer.disconnect();
    }

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          // Processar novas mensagens
          setTimeout(processExistingMessages, 100);
          break;
        }
      }
    });

    observer.observe(chatContainer, {
      childList: true,
      subtree: true
    });

    console.log('[RecoverVisualInjector] 👁️ MutationObserver ativo');
  }

  // ============================================
  // CONTEÚDO ORIGINAL (mesma fonte usada pelo painel Recover)
  // ============================================

  const REVOKED_STATES = ['revoked_global', 'deleted_local'];

  // Textos que o próprio Recover grava quando NÃO conseguiu o conteúdo —
  // não são o conteúdo original e não devem aparecer como se fossem.
  const PLACEHOLDER_RE = /^\[(Conteúdo não capturado|Mensagem sem texto|[^\]]* apagad[oa] — arquivo não disponível)/i;

  const MEDIA_LABELS = {
    image: '📷 Imagem',
    video: '🎥 Vídeo',
    audio: '🎵 Áudio',
    sticker: '🏷️ Figurinha',
    document: '📄 Arquivo'
  };

  function isRealContent(text) {
    return typeof text === 'string' && text.trim() !== '' && !PLACEHOLDER_RE.test(text.trim());
  }

  function mediaKindOf(ev) {
    if (!ev) return null;
    const candidates = [ev.type, ev.mediaType].map(v => String(v || '').toLowerCase());
    for (const t of candidates) {
      if (t === 'ptt') return 'audio';
      if (MEDIA_LABELS[t]) return t;
    }
    const mime = String(ev.mimetype || (String(ev.mediaType || '').includes('/') ? ev.mediaType : '') || '').toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime) return 'document';
    return null;
  }

  const DEFAULT_MIME = { audio: 'audio/ogg', video: 'video/mp4', document: 'application/octet-stream' };

  function sniffImageSrc(raw) {
    if (raw.startsWith('/9j/')) return `data:image/jpeg;base64,${raw}`;
    if (raw.startsWith('iVBOR')) return `data:image/png;base64,${raw}`;
    if (raw.startsWith('R0lGOD')) return `data:image/gif;base64,${raw}`;
    if (raw.startsWith('UklGR')) return `data:image/webp;base64,${raw}`;
    return null;
  }

  function mediaSrcOf(raw, mime, kind, isThumbnail) {
    if (typeof raw !== 'string' || raw.length < 50 || raw === '__HAS_MEDIA__') return null;
    if (raw.startsWith('data:')) return raw;
    // Imagem/figurinha (ou a miniatura de um vídeo): pelo cabeçalho do arquivo.
    if (kind === 'image' || kind === 'sticker' || isThumbnail) {
      const sniffed = sniffImageSrc(raw);
      if (sniffed) return sniffed;
    }
    // Áudio/vídeo/arquivo: pelo tipo real (um WAV começa como um WEBP, "RIFF").
    // Sem parâmetros ("audio/ogg; codecs=opus" → "audio/ogg") no data URL.
    const m = mime && String(mime).includes('/') ? String(mime).split(';')[0].trim() : DEFAULT_MIME[kind];
    return m ? `data:${m};base64,${raw}` : null;
  }

  /**
   * Conteúdo original de um evento — o mesmo que o painel mostra.
   * Edição: o texto ANTERIOR. Exclusão/revogação: o texto (ou a legenda) e,
   * se era mídia, a própria mídia (imagem/miniatura, áudio) ou o arquivo.
   * Retorna { text, label, media } ou null.
   */
  function contentFromEvent(ev, state) {
    if (!ev) return null;
    if (state === 'edited') {
      const text = ev.previousBody || ev.previousContent || ev.body;
      return isRealContent(text) ? { text, label: null, media: null } : null;
    }
    const text = isRealContent(ev.body) ? ev.body : null;
    const kind = mediaKindOf(ev);
    if (!kind) {
      return text ? { text, label: null, media: null } : null;
    }
    const mime = ev.mimetype || (String(ev.mediaType || '').includes('/') ? ev.mediaType : null);
    const isThumbnail = !!ev.mediaIsThumbnail;
    const src = mediaSrcOf(ev.mediaDataPreview || ev.mediaData, mime, kind, isThumbnail);
    if (!text && !src && ev.contentCaptured === false) return null;
    return {
      text,
      label: MEDIA_LABELS[kind],
      media: { kind, src, mime, filename: ev.filename || null, isThumbnail: !!(src && isThumbnail) }
    };
  }

  // Pronto = tem o que mostrar e, se é mídia, o arquivo original já chegou
  // (só a miniatura, ou nada, continua sendo verificado por um tempo).
  function isComplete(found) {
    if (!found || !(found.text || found.label)) return false;
    if (found.media && (!found.media.src || found.media.isThumbnail)) return false;
    return true;
  }

  // Junta o que as duas fontes têm (ex.: registro antigo sem nome do arquivo
  // no histórico de versões, mas com ele na lista do painel).
  function mergeFound(a, b) {
    if (!a) return b;
    if (!b) return a;
    const media = a.media || b.media ? { ...(b.media || {}), ...(a.media || {}) } : null;
    if (media && a.media && b.media) {
      if (!a.media.src || (a.media.isThumbnail && b.media.src && !b.media.isThumbnail)) {
        media.src = b.media.src;
        media.isThumbnail = b.media.isThumbnail;
      }
      media.filename = a.media.filename || b.media.filename || null;
      media.mime = a.media.mime || b.media.mime || null;
    }
    return { ...b, ...a, text: a.text || b.text, label: a.label || b.label, media, timestamp: a.timestamp || b.timestamp };
  }

  function stateMatches(evState, state) {
    if (!evState) return false;
    if (state === 'edited') return evState === 'edited';
    return REVOKED_STATES.includes(evState);
  }

  /**
   * Procura o conteúdo original da mensagem no que o RecoverAdvanced já
   * registrou: primeiro no histórico de versões (messageVersions), depois na
   * lista de mensagens do painel. Retorna { text, label, media, timestamp },
   * ou { notCaptured: true } quando o evento foi registrado mas sem o conteúdo
   * (a mensagem foi apagada antes de a extensão vê-la), ou null quando ainda
   * não há registro.
   */
  function lookupOriginalContent(msgId, state) {
    const ra = window.RecoverAdvanced;
    if (!ra || !msgId) return null;
    let recordFound = false;
    let fromVersions = null;
    let fromList = null;

    try {
      const entry = ra.messageVersions?.get?.(msgId);
      const history = entry?.history;
      if (Array.isArray(history)) {
        for (let i = history.length - 1; i >= 0; i--) {
          const ev = history[i];
          if (!ev || !stateMatches(ev.state, state)) continue;
          recordFound = true;
          const found = contentFromEvent({ ...ev, type: ev.type || entry.type }, state);
          if (found) {
            const f = { ...found, timestamp: ev.timestamp || null };
            if (!fromVersions || (isComplete(f) && !isComplete(fromVersions))) fromVersions = f;
            if (isComplete(f)) break;
          }
        }
      }
    } catch (_) { /* ignore */ }

    if (!fromVersions || !isComplete(fromVersions) || (fromVersions.media && !fromVersions.media.filename)) {
      try {
        const list = typeof ra.getMessages === 'function' ? ra.getMessages() : [];
        for (let i = 0; i < list.length; i++) {
          const m = list[i];
          if (!m || String(m.id) !== msgId) continue;
          const action = m.action === 'edited' ? 'edited' : (m.action === 'deleted' ? 'deleted_local' : 'revoked_global');
          if (!stateMatches(action, state)) continue;
          recordFound = true;
          const found = contentFromEvent(m, state);
          if (found) {
            fromList = { ...found, timestamp: m.timestamp || null };
            break;
          }
        }
      } catch (_) { /* ignore */ }
    }

    const merged = mergeFound(fromVersions, fromList);
    if (merged) return merged;
    return recordFound ? { notCaptured: true } : null;
  }

  // ============================================
  // RETRATO DO TEXTO NA TELA (rede de segurança)
  // ============================================
  // O texto de cada balão visível fica guardado (por id) enquanto a mensagem
  // existe. Se ela for apagada e o registro do Recover não tiver o conteúdo
  // (ex.: a página não conseguiu ler a tempo), o banner usa este retrato — e
  // o registro do painel é completado com ele.
  const domSnapshots = new Map(); // msgId → { text, chatId, fromMe, at }
  const MAX_DOM_SNAPSHOTS = 3000;
  const postedFromSnapshot = new Set();

  function cleanSnapshotText(text) {
    const t = String(text || '').trim();
    // Balão já marcado pela edição: guarda só o texto atual.
    const m = t.match(/✏️ (?:Esta mensagem foi editada para|Editada para): ([\s\S]*)$/);
    return (m ? m[1] : t).trim();
  }

  function rememberSnapshot(msgEl, msgId) {
    const text = cleanSnapshotText(extractSnapshotText(msgEl));
    if (text && textLooksRevoked(text)) return;
    const prev = domSnapshots.get(msgId);
    const media = snapshotMedia(msgEl, prev && prev.media);
    if (!text && !media) return;
    if (prev && prev.text === text && prev.media === media) return;
    const dataId = (msgEl.closest && msgEl.closest('[data-id]')?.getAttribute('data-id')) || '';
    const parts = dataId.split('_');
    domSnapshots.delete(msgId);
    domSnapshots.set(msgId, { text, media, chatId: parts[1] || null, fromMe: parts[0] === 'true', at: Date.now() });
    while (domSnapshots.size > MAX_DOM_SNAPSHOTS) {
      domSnapshots.delete(domSnapshots.keys().next().value);
    }
  }

  // ---- Mídia na tela (imagem/vídeo/figurinha: cópia da imagem; áudio e
  // documento: tipo e nome do arquivo) ----
  const SNAPSHOT_MAX_DIM = 960;

  function largestMediaImg(msgEl) {
    let best = null;
    let bestArea = 0;
    for (const img of msgEl.querySelectorAll('img')) {
      if (img.closest(`.${CONFIG.QUOTE_CLASS}`)) continue;
      const src = img.currentSrc || img.src || '';
      if (!(src.startsWith('blob:') || src.startsWith('data:image'))) continue; // nunca de outro domínio
      if (/emoji/i.test(img.className || '')) continue;
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      if (w < 48 || h < 48) continue; // emoji/ícone
      if (w * h > bestArea) { best = img; bestArea = w * h; }
    }
    return best;
  }

  function imgToDataUrl(img) {
    try {
      if (!img || !img.complete || !img.naturalWidth) return null;
      const scale = Math.min(1, SNAPSHOT_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.85);
    } catch (_) {
      return null; // canvas "contaminado" ou imagem indisponível
    }
  }

  function detectMediaKind(msgEl) {
    if (msgEl.querySelector('video, [data-icon*="video" i], [data-icon="media-play"], [data-icon*="gif" i]')) return 'video';
    if (msgEl.querySelector('[data-icon*="ptt" i], [data-icon*="audio" i], [data-icon*="mic" i]')) return 'audio';
    if (msgEl.querySelector('[data-icon*="document" i], [data-icon*="doc-" i], [data-icon*="pdf" i], [data-icon*="xls" i], [data-icon*="ppt" i]')) return 'document';
    if (largestMediaImg(msgEl)) return 'image';
    return null;
  }

  function findFilename(msgEl) {
    const looksLikeFile = (t) => typeof t === 'string' && /\.[A-Za-z0-9]{2,5}$/.test(t.trim()) && t.trim().length <= 200;
    for (const el of msgEl.querySelectorAll('[title]')) {
      if (el.closest(`.${CONFIG.QUOTE_CLASS}`)) continue;
      const t = el.getAttribute('title');
      if (looksLikeFile(t)) return t.trim();
    }
    for (const el of msgEl.querySelectorAll('span')) {
      if (el.closest(`.${CONFIG.QUOTE_CLASS}`) || el.children.length) continue;
      const t = (el.textContent || '').trim();
      if (looksLikeFile(t)) return t;
    }
    return null;
  }

  // Reaproveita a cópia anterior se a imagem não mudou (evita recodificar a
  // cada varredura); recodifica quando a miniatura vira a imagem completa.
  function snapshotMedia(msgEl, prevMedia) {
    const kind = detectMediaKind(msgEl);
    if (!kind) return null;
    const img = (kind === 'image' || kind === 'video') ? largestMediaImg(msgEl) : null;
    const src = img ? (img.currentSrc || img.src) : null;
    if (prevMedia && prevMedia.kind === kind && prevMedia.src === src) return prevMedia;
    const dataUrl = img ? imgToDataUrl(img) : null;
    return {
      kind,
      src,
      dataUrl: dataUrl || (prevMedia && prevMedia.dataUrl) || null,
      filename: findFilename(msgEl) || (prevMedia && prevMedia.filename) || null
    };
  }

  function foundFromSnapshot(snap) {
    if (!snap) return null;
    const m = snap.media;
    return {
      text: snap.text || null,
      label: m ? MEDIA_LABELS[m.kind] : null,
      media: m ? { kind: m.kind, src: m.dataUrl || null, mime: m.dataUrl ? 'image/jpeg' : null, filename: m.filename, isThumbnail: !!m.dataUrl } : null,
      timestamp: snap.at
    };
  }

  // Só o texto da mensagem (o seletor de texto do WhatsApp), nunca o
  // container inteiro — que inclui horário, citações e nossos banners.
  function extractSnapshotText(msgEl) {
    try {
      const el = msgEl.querySelector('[data-pre-plain-text] span.selectable-text, .copyable-text span.selectable-text, [data-testid="msg-text"]');
      if (!el) return '';
      let text = '';
      const walk = (node) => {
        for (const c of node.childNodes || []) {
          if (c.nodeType === 3) text += c.nodeValue;
          else if (c.nodeName === 'IMG') text += c.getAttribute('alt') || '';
          else if (c.nodeName === 'BR') text += '\n';
          else walk(c);
        }
      };
      walk(el);
      return text;
    } catch (_) {
      return '';
    }
  }

  // Completa o registro do painel com o texto do retrato (mesmo id e ação:
  // o RecoverAdvanced junta com o registro que veio sem conteúdo).
  function postSnapshotRecord(msgId, state, snap) {
    if (!isValidMsgId(msgId)) return;
    const key = `${msgId}_${state}`;
    if (postedFromSnapshot.has(key)) return;
    postedFromSnapshot.add(key);
    try {
      window.postMessage({
        type: 'WHL_RECOVER_NEW_MESSAGE',
        payload: {
          id: msgId,
          action: state === 'deleted_local' ? 'deleted' : 'revoked',
          body: snap.text || '',
          type: snap.media ? snap.media.kind : 'chat',
          mediaType: snap.media ? snap.media.kind : null,
          mimetype: snap.media && snap.media.dataUrl ? 'image/jpeg' : null,
          mediaData: snap.media ? snap.media.dataUrl : null,
          // cópia da tela: o original (se a página conseguir baixar) substitui
          mediaIsThumbnail: !!(snap.media && snap.media.dataUrl),
          filename: snap.media ? snap.media.filename : null,
          chatId: snap.chatId,
          from: snap.fromMe ? null : snap.chatId,
          to: snap.fromMe ? snap.chatId : null,
          fromMe: snap.fromMe,
          contentCaptured: true,
          timestamp: Date.now(),
          source: 'dom_snapshot'
        }
      }, window.location.origin);
      // Registro que já existia sem a mídia: anexa a cópia da tela.
      if (snap.media && snap.media.dataUrl) {
        window.postMessage({
          type: 'WHL_RECOVER_MEDIA_READY',
          payload: { id: msgId, action: state === 'deleted_local' ? 'deleted' : 'revoked', mediaData: snap.media.dataUrl, mimetype: 'image/jpeg', filename: snap.media.filename || null, isThumbnail: true }
        }, window.location.origin);
      }
    } catch (_) { /* ignore */ }
  }

  // Sem registro com o conteúdo depois deste tempo, o banner deixa de dizer
  // "buscando" e assume que o conteúdo não foi capturado.
  const PENDING_GIVE_UP_MS = 15000;

  /**
   * Processa todas as mensagens existentes no chat
   */
  function processExistingMessages() {
    // Raiz de cada mensagem = elemento com data-id dentro da conversa aberta.
    // O WhatsApp atual não usa mais .message-in/.message-out e quase não tem
    // [data-testid="msg-container"] — antes só esses eram procurados (e o
    // primeiro que existisse), então a maioria das mensagens era ignorada.
    const roots = new Set();
    const add = (el) => {
      if (!el) return;
      const root = el.closest ? (el.closest('[data-id]') || el) : el;
      if (isMessageContainer(root)) roots.add(root);
    };
    document.querySelectorAll(MESSAGE_AREA_SELECTORS.map(a => `${a} [data-id]`).join(', ')).forEach(add);
    document.querySelectorAll('[data-testid="msg-container"], .message-in, .message-out').forEach(add);
    roots.forEach(processMessage);
  }

  // Onde ficam as mensagens da conversa aberta (fora daqui: lista de chats,
  // cabeçalho, pop-ups — nunca recebem banner).
  const MESSAGE_AREA_SELECTORS = ['#main', '[data-testid="conversation-panel-messages"]'];

  /**
   * Processa uma mensagem individual
   * @param {HTMLElement} msgEl - Elemento da mensagem
   */
  function processMessage(msgEl) {
    // Já processado com o conteúdo original → nada a fazer. Se ficou
    // 'pending' (o banner foi criado antes de o registro com o conteúdo
    // chegar), continua tentando até o conteúdo aparecer.
    if (msgEl.getAttribute(CONFIG.INJECTED_ATTR) === 'true') {
      // Pronto como apagada: final. Pronto como edição: só volta a processar
      // se o balão agora estiver apagado (editada e depois apagada).
      const doneState = msgEl.getAttribute(STATE_ATTR);
      if (doneState !== 'edited' || detectDomState(msgEl) !== 'revoked') return;
      msgEl.removeAttribute(CONFIG.INJECTED_ATTR);
      const box = msgEl.closest('[data-testid="msg-container"]') || msgEl;
      box.querySelectorAll(`.${CONFIG.QUOTE_CLASS}`).forEach(q => q.remove());
    }

    // GUARD: só processa elementos que são MESMO containers de mensagem
    // individuais. processExistingMessages cai em fallback para [data-id]
    // quando msg-container não existe — esse seletor casa demais (chat-list,
    // headers, popups). Sem este guard, qualquer elemento com data-id
    // recebia badge "apagada" só porque tinha texto "Esta mensagem foi
    // apagada" em algum filho (ex.: preview do chat-list).
    if (!isMessageContainer(msgEl)) {
      return;
    }

    // Tentar extrair ID da mensagem
    const msgId = extractMessageId(msgEl);
    if (!msgId) {
      return;
    }

    let state = null;
    let stateTimestamp = null;

    // Apenas estes 3 estados merecem badge. Estados como "created",
    // "snapshot_initial", "cached_only" são metadados internos do
    // RecoverAdvanced e NÃO indicam que a mensagem foi alterada.
    const BADGE_STATES = ['deleted_local', 'revoked_global', 'edited'];

    // Fonte 1: Verificar marcadores persistentes (prioridade - funciona após reload)
    // Mas validar contra o DOM atual — se a mensagem hoje NÃO mostra mais o
    // texto/ícone de "apagada" nem "editada", o marker é stale (provavelmente
    // do bug antigo) e deve ser ignorado. Isso impede que markers
    // residuais continuem injetando badges em mensagens normais mesmo depois
    // do auto-clean por threshold ter limpado o pior do storage.
    const persistentMarker = getPersistentMarker(msgId);
    if (persistentMarker && BADGE_STATES.includes(persistentMarker.state)) {
      if (domConfirmsState(msgEl, persistentMarker.state)) {
        state = persistentMarker.state;
        stateTimestamp = persistentMarker.timestamp || null;
      } else {
        // Marker stale — remove pra não voltar no próximo render.
        try {
          persistentMarkers.delete(msgId);
          savePersistentMarkers();
        } catch (_) { /* ignore */ }
      }
    }

    // Fonte 2: Verificar no RecoverAdvanced se há histórico dessa mensagem
    if (!state && window.RecoverAdvanced?.messageVersions) {
      const messageHistory = window.RecoverAdvanced.messageVersions.get(msgId);
      if (messageHistory && messageHistory.history && messageHistory.history.length > 0) {
        const candidate = messageHistory.history[messageHistory.history.length - 1];
        // Só aceita estado se for um dos 3 que geram badge — antes qualquer
        // 'created'/'cached_only' virava badge nulo mas marcava processado.
        // Apagada/revogada: só se o balão estiver MESMO apagado na tela. Sem
        // esta conferência, um registro com id errado punha "apagada" em
        // mensagens normais (foi o que aconteceu com o id "container").
        // Edição: vale enquanto o balão não estiver apagado (editada e depois
        // apagada vira apagada).
        const confirmed = candidate && (candidate.state === 'edited'
          ? detectDomState(msgEl) !== 'revoked'
          : domConfirmsState(msgEl, candidate.state));
        if (candidate && BADGE_STATES.includes(candidate.state) && confirmed) {
          state = candidate.state;
          stateTimestamp = candidate.timestamp || null;
        }
      }
    }

    // Fonte 3: Detectar estado via DOM da própria mensagem.
    // CRÍTICO: extrair texto APENAS do elemento de texto direto da mensagem
    // (não do textContent inteiro do container, que inclui replies/quotes que
    // referenciam mensagens apagadas e causavam falso-positivo em TODAS as
    // mensagens da conversa).
    if (!state) {
      const looks = detectDomState(msgEl);
      if (looks === 'revoked') state = 'revoked_global';
      else if (looks === 'edited') state = 'edited';
    }

    if (!state) {
      // Mensagem normal: guarda o texto como está na tela.
      rememberSnapshot(msgEl, msgId);
      return;
    }

    // Determinar qual badge mostrar
    let badgeConfig = null;
    if (state === 'deleted_local') {
      badgeConfig = MESSAGE_STATES.DELETED_LOCAL;
    } else if (state === 'revoked_global') {
      badgeConfig = MESSAGE_STATES.REVOKED_GLOBAL;
    } else if (state === 'edited') {
      badgeConfig = MESSAGE_STATES.EDITED;
    }

    if (!badgeConfig) {
      return;
    }

    // Editada: guarda o texto atual também (se for apagada depois).
    if (state === 'edited') rememberSnapshot(msgEl, msgId);

    if (state === 'edited' && hasHookEditMarker(msgEl)) {
      // Durante a sessão o balão já mostra "Antes: … / Editada para: …".
      // Depois de recarregar a página esse texto some — aí o banner aparece.
      msgEl.setAttribute(CONFIG.INJECTED_ATTR, 'true');
      msgEl.setAttribute(STATE_ATTR, 'edited');
      return;
    }

    // Conteúdo original — SEMPRE do registro do Recover (a mesma fonte do
    // painel), a cada verificação enquanto não estiver completo. Antes o
    // conteúdo era lido uma vez só: se o banner nascesse antes de o registro
    // chegar (o WhatsApp troca o balão por "Mensagem apagada" na hora), o
    // marcador ficava sem conteúdo e o banner vazio para sempre.
    let found = lookupOriginalContent(msgId, state);
    let notCaptured = !!(found && found.notCaptured);
    if (state !== 'edited') {
      // Retrato da tela antes de a mensagem ser apagada: completa o que o
      // registro não tem (texto, mídia ou os dois) e manda para o painel.
      const snap = domSnapshots.get(msgId);
      const fromSnap = foundFromSnapshot(snap);
      if (fromSnap && (fromSnap.text || fromSnap.label)) {
        if (!found || !(found.text || found.label)) {
          found = fromSnap;
          notCaptured = false;
          postSnapshotRecord(msgId, state, snap);
        } else if (fromSnap.media && fromSnap.media.src && (!found.media || !found.media.src)) {
          found = { ...found, label: found.label || fromSnap.label, media: { ...(found.media || {}), ...fromSnap.media, filename: (found.media && found.media.filename) || fromSnap.media.filename } };
          postSnapshotRecord(msgId, state, snap);
        }
      }
    }
    if (!found || !(found.text || found.label)) {
      // Reservas: marcador salvo (após reload) e histórico do RecoverDOM.
      let text = persistentMarker && isRealContent(persistentMarker.originalContent)
        ? persistentMarker.originalContent : null;
      if (!text && window.RecoverDOM?.getHistory) {
        try {
          const match = window.RecoverDOM.getHistory().find(h => h.key === msgId || h.id === msgId);
          if (match && isRealContent(match.body || match.originalBody)) text = match.body || match.originalBody;
        } catch (_) { /* ignore */ }
      }
      if (text) {
        // fromFallback: o registro do Recover ainda pode chegar (ex.: logo após
        // o reload) com a mídia — continua verificando por um tempo.
        found = { text, label: null, media: null, timestamp: stateTimestamp, fromFallback: true };
        notCaptured = false;
      }
    }

    const hasContent = !!(found && (found.text || found.label));
    const markerContent = hasContent ? (found.text || found.label) : null;
    if (!persistentMarker || persistentMarker.state !== state ||
        (markerContent && persistentMarker.originalContent !== markerContent)) {
      const entry = window.RecoverAdvanced?.messageVersions?.get?.(msgId);
      addPersistentMarker(msgId, {
        state: state,
        originalContent: markerContent,
        timestamp: (found && found.timestamp) || stateTimestamp || Date.now(),
        chatId: entry?.chatId,
        from: entry?.from
      });
    }

    const PENDING_ATTR = 'data-whl-pending-since';
    let pendingExpired = false;
    if (!hasContent || found.fromFallback || !isComplete(found)) {
      let since = Number(msgEl.getAttribute(PENDING_ATTR));
      if (!since) {
        since = Date.now();
        msgEl.setAttribute(PENDING_ATTR, String(since));
      }
      pendingExpired = Date.now() - since > PENDING_GIVE_UP_MS;
      if (!hasContent && pendingExpired) notCaptured = true;
    }

    // Injetar (ou completar) o quote visual
    injectQuoteVisual(msgEl, badgeConfig, {
      state,
      timestamp: (found && found.timestamp) || stateTimestamp,
      text: hasContent ? found.text : null,
      label: hasContent ? found.label : null,
      media: hasContent ? found.media : null,
      notCaptured,
      pendingExpired
    });

    // 'true' = pronto (ou registrado sem conteúdo, não vai mudar);
    // 'pending' = ainda falta o conteúdo ou a mídia — será completado quando
    // o registro (ou o arquivo) chegar, ver o recheck no início.
    const done = (hasContent && (isComplete(found) || pendingExpired) && (!found.fromFallback || pendingExpired)) ||
      (!hasContent && found && found.notCaptured);
    msgEl.setAttribute(CONFIG.INJECTED_ATTR, done ? 'true' : 'pending');
    msgEl.setAttribute(STATE_ATTR, state);
  }

  /**
   * Valida se o elemento é REALMENTE um container de mensagem individual
   * (não chat-list item, popup de notificação, header do chat etc).
   * Bug original: processExistingMessages caía em fallback para [data-id]
   * que casa com muita coisa que não é mensagem.
   */
  function isMessageContainer(el) {
    if (!el || el.nodeType !== 1) return false;
    const dataId = el.getAttribute && el.getAttribute('data-id');
    if (dataId) {
      // Só a raiz da mensagem (um data-id dentro de outro é citação/prévia).
      if (el.parentElement && el.parentElement.closest('[data-id]')) return false;
      if (!el.closest(MESSAGE_AREA_SELECTORS.join(', '))) return false;
      return isValidMsgId(idFromDataId(dataId));
    }
    // Sem data-id: só os marcadores clássicos de balão.
    if (el.matches && el.matches('[data-testid="msg-container"]')) return true;
    if (el.classList && (el.classList.contains('message-in') || el.classList.contains('message-out'))) return true;
    return false;
  }

  /**
   * Extrai apenas o texto direto da mensagem (NÃO textContent inteiro).
   * Sem isto, replies que quotam uma mensagem apagada faziam a mensagem
   * que respondeu virar "apagada" também — falso-positivo em cascata.
   */
  /**
   * Verifica se o DOM da mensagem ainda confirma o state armazenado.
   * Usado para validar persistent markers contra a realidade visual atual.
   * Se a mensagem hoje aparece normal, marker antigo é descartado.
   */
  function domConfirmsState(msgEl, state) {
    try {
      const looks = detectDomState(msgEl);
      if (state === 'revoked_global' || state === 'deleted_local') return looks === 'revoked';
      if (state === 'edited') return looks === 'edited';
      return false;
    } catch (_) {
      // Se não conseguimos avaliar, fica conservador: rejeita o marker.
      return false;
    }
  }

  /**
   * O que o PRÓPRIO balão mostra hoje: 'revoked' (balão de mensagem apagada),
   * 'edited' (rótulo "Editada" do WhatsApp) ou null.
   */
  function detectDomState(msgEl) {
    const directText = extractDirectMessageText(msgEl);
    const hasRecalledIcon = !!msgEl.querySelector(':scope > [data-testid="recalled-msg"], :scope [data-icon="recalled"], :scope [data-icon="recalled-in"], :scope [data-icon="recalled-out"]');
    if (hasRecalledIcon || textLooksRevoked(directText)) return 'revoked';
    const hasEditedLabel = !!msgEl.querySelector(':scope [data-testid="msg-edited"], :scope [data-icon="edited"], :scope [data-icon="edited-in"], :scope [data-icon="edited-out"], :scope [aria-label*="ditad" i], :scope [aria-label*="dited" i], :scope [title*="ditad" i], :scope [title*="dited" i]');
    if (hasEditedLabel || hasEditedWord(msgEl) || (directText && (
      directText.includes('<Editada>') ||
      directText.includes('<Edited>') ||
      /\b\(Editada\)\s*$/.test(directText) ||
      /\b\(Edited\)\s*$/.test(directText)
    ))) return 'edited';
    return null;
  }

  // Rótulo "Editada" do WhatsApp ao lado do horário: um span só com a palavra
  // (fora do texto da mensagem e dos nossos banners).
  function hasEditedWord(msgEl) {
    try {
      for (const sp of msgEl.querySelectorAll('span')) {
        if (sp.closest(`.${CONFIG.QUOTE_CLASS}`) || sp.closest('.selectable-text')) continue;
        if (/^(Editada|Editado|Edited)$/i.test((sp.textContent || '').trim())) return true;
      }
    } catch (_) { /* ignore */ }
    return false;
  }

  // O hook da página já escreveu "Antes/Editada para" DENTRO do balão
  // (durante a sessão). Aí o banner de edição seria repetido.
  function hasHookEditMarker(msgEl) {
    const t = extractDirectMessageText(msgEl) || '';
    return /✏️ (?:Esta mensagem foi editada para|Editada para):/.test(t);
  }

  // Textos que o WhatsApp mostra no lugar de uma mensagem apagada — inclui a
  // versão de quem apagou ("Você apagou esta mensagem").
  const REVOKED_TEXTS = [
    'Esta mensagem foi apagada',
    'Você apagou esta mensagem',
    'Você apagou essa mensagem',
    'Mensagem apagada',
    'This message was deleted',
    'You deleted this message',
    'Message deleted'
  ];

  function textLooksRevoked(directText) {
    if (!directText) return false;
    return REVOKED_TEXTS.some(t => directText.includes(t));
  }

  function extractDirectMessageText(msgEl) {
    if (!msgEl) return '';
    const textSelectors = [
      '[data-testid="msg-text"]',
      'span.selectable-text[data-testid]',
      '.copyable-text span.selectable-text',
      '.message-text'
    ];
    for (const sel of textSelectors) {
      try {
        const el = msgEl.querySelector(sel);
        if (el) return (el.textContent || '').trim();
      } catch (_) { /* ignore */ }
    }
    // Fallback conservador: textContent direto do bubble SEM quotes/replies.
    // Remove temporariamente quotes do clone pra extrair só texto do corpo.
    try {
      const clone = msgEl.cloneNode(true);
      clone.querySelectorAll(`[data-testid="quoted-mention"], .quoted-mention, [aria-label*="esposta" i], [aria-label*="eply" i], .${CONFIG.QUOTE_CLASS}`).forEach(n => n.remove());
      return (clone.textContent || '').trim();
    } catch (_) {
      return '';
    }
  }

  /**
   * Extrai o ID da mensagem do elemento DOM
   * @param {HTMLElement} msgEl - Elemento da mensagem
   * @returns {string|null} ID da mensagem
   */
  /**
   * data-id do WhatsApp: "<fromMe>_<chat>_<id>[_<autor em grupos>]".
   * O id da mensagem é o 3º segmento — é com ele que o Recover registra.
   * (A regex antiga pegava o primeiro trecho de 16+ dígitos/hex, que em
   * grupos/@lid é o número do chat, não o id da mensagem.)
   */
  function idFromDataId(dataId) {
    if (!dataId) return null;
    // WhatsApp atual: data-id é só o id da mensagem ("3EB0B584D3AEA026CD34F9").
    if (/^[0-9A-Za-z]{10,64}$/.test(String(dataId))) return String(dataId);
    const parts = String(dataId).split('_');
    if (parts.length >= 3 && /^(true|false)$/.test(parts[0]) && parts[2]) {
      return parts[2];
    }
    const match = String(dataId).match(/[A-F0-9]{16,}/);
    return match ? match[0] : null;
  }

  // Id de mensagem do WhatsApp: letras/dígitos (ex.: "3EB0…", "3A…", "A5F3…").
  // Rejeita palavras como "container" — vinha de data-testid="msg-container"
  // e fazia TODAS as mensagens terem o mesmo id.
  function isValidMsgId(id) {
    return typeof id === 'string' && /^[0-9A-Za-z]{10,64}$/.test(id) && /\d/.test(id);
  }

  function extractMessageId(msgEl) {
    // data-id do próprio elemento ou do ancestral (no WhatsApp atual o
    // data-id fica num div acima do balão [data-testid="msg-container"]).
    const holder = (msgEl.hasAttribute && msgEl.hasAttribute('data-id'))
      ? msgEl
      : (msgEl.closest && msgEl.closest('[data-id]'));
    const fromDataId = holder ? idFromDataId(holder.getAttribute('data-id')) : null;
    if (isValidMsgId(fromDataId)) return fromDataId;

    // data-testid no formato "msg-<id>" (nunca "msg-container").
    const testId = msgEl.getAttribute && msgEl.getAttribute('data-testid');
    const m = testId && /^msg-([0-9A-Za-z]{10,64})$/.exec(testId);
    if (m && isValidMsgId(m[1])) return m[1];

    return null;
  }

  /**
   * Injeta quote visual (como resposta do WhatsApp) na mensagem
   * @param {HTMLElement} msgEl - Elemento da mensagem
   * @param {Object} config - Configuração do badge
   * @param {Object} event - Evento do histórico
   */
  const EXT_BY_MIME = {
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/3gpp': '3gp',
    'application/pdf': 'pdf', 'application/zip': 'zip', 'text/plain': 'txt'
  };

  function extOf(src) {
    const mime = (String(src).match(/^data:([^;,]+)/) || [])[1] || '';
    return EXT_BY_MIME[mime] || (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin';
  }

  const NOT_CAPTURED_TEXT = 'Conteúdo original não capturado — a mensagem foi apagada antes de a extensão carregá-la.';

  function injectQuoteVisual(msgEl, config, event) {
    // Procurar container apropriado para inserir o quote
    const msgContainer = msgEl.closest('[data-testid="msg-container"]') || msgEl;
    const isEdited = config.id === 'edited';

    // Conteúdo original. Na edição é o texto anterior (body é o novo).
    const text = event.text || event.originalContent ||
      (isEdited ? (event.previousBody || event.body) : (event.body || event.previousBody)) ||
      null;
    const label = event.label || null;
    const media = event.media || null;
    const hasContent = !!(text || label);
    const sig = [
      text || '', label || '',
      media && media.src ? media.src.length : 0,
      media && media.isThumbnail ? 't' : '',
      (media && media.filename) || '',
      media && !media.src && event.pendingExpired ? 'x' : ''
    ].join('|');

    // Já existe um quote: troca só se agora há conteúdo diferente (o
    // registro ou o arquivo chegou depois). Nunca troca conteúdo por vazio.
    const existing = msgContainer.querySelector(`.${CONFIG.QUOTE_CLASS}`);
    if (existing) {
      if (!hasContent || existing.getAttribute('data-whl-sig') === sig) {
        const note = existing.querySelector(`.${CONFIG.QUOTE_CLASS}-pending`);
        if (note && event.notCaptured) note.textContent = NOT_CAPTURED_TEXT;
        return;
      }
      existing.remove();
    }

    const timestamp = event.timestamp ? new Date(event.timestamp).toLocaleString('pt-BR') : '';

    // Criar quote visual
    const quote = document.createElement('div');
    quote.className = `${CONFIG.QUOTE_CLASS}${isEdited ? ` ${CONFIG.QUOTE_CLASS}-edited` : ''}`;
    quote.setAttribute('data-whl-sig', hasContent ? sig : '');

    const header = document.createElement('div');
    header.className = `${CONFIG.QUOTE_CLASS}-header`;
    header.innerHTML = `<span class="${CONFIG.QUOTE_CLASS}-icon">${config.emoji}</span><span>${escapeHtml(config.text)}</span>`;
    quote.appendChild(header);

    // Mídia apagada: a própria imagem/figurinha (ou a miniatura do vídeo),
    // o áudio para ouvir, e o tipo + nome do arquivo.
    if (media) {
      if (media.src) {
        let el = null;
        const isImageSrc = media.src.startsWith('data:image');
        if (media.kind === 'image' || media.kind === 'sticker' || (media.kind === 'video' && isImageSrc)) {
          el = document.createElement('img');
          el.alt = label || 'Mídia';
        } else if (media.kind === 'audio') {
          el = document.createElement('audio');
          el.controls = true;
          el.preload = 'metadata';
        } else if (media.kind === 'video') {
          el = document.createElement('video');
          el.controls = true;
          el.preload = 'metadata';
        }
        if (el) {
          el.className = media.kind === 'audio' ? `${CONFIG.QUOTE_CLASS}-audio` : `${CONFIG.QUOTE_CLASS}-media`;
          el.src = media.src;
          quote.appendChild(el);
        }
      }
      if (label) {
        const lbl = document.createElement('div');
        lbl.className = `${CONFIG.QUOTE_CLASS}-label`;
        let suffix = '';
        if (media.src && media.isThumbnail) suffix = ' (miniatura)';
        else if (!media.src) suffix = event.pendingExpired ? ' — arquivo não disponível' : ' — baixando o arquivo…';
        lbl.textContent = label + (media.filename ? ` · ${media.filename}` : '') + suffix;
        quote.appendChild(lbl);
      }
      // Arquivo (ou áudio/vídeo original): link para salvar.
      if (media.src && !media.isThumbnail && !media.src.startsWith('data:image')) {
        const a = document.createElement('a');
        a.className = `${CONFIG.QUOTE_CLASS}-download`;
        a.href = media.src;
        a.download = media.filename || `recover_${Date.now()}.${extOf(media.src)}`;
        a.textContent = '⬇️ Baixar';
        a.addEventListener('click', (e) => e.stopPropagation());
        quote.appendChild(a);
      }
    }

    if (text) {
      const content = document.createElement('div');
      content.className = `${CONFIG.QUOTE_CLASS}-content`;
      const shown = text.length > 150 ? text.substring(0, 150) + '...' : text;
      content.textContent = isEdited ? `Antes: ${shown}` : shown;
      quote.appendChild(content);
      // Tooltip com conteúdo completo
      if (text.length > 150) quote.title = `Conteúdo completo: ${text}`;
    } else if (!hasContent && !isEdited) {
      const note = document.createElement('div');
      note.className = `${CONFIG.QUOTE_CLASS}-footer ${CONFIG.QUOTE_CLASS}-pending`;
      note.textContent = event.notCaptured ? NOT_CAPTURED_TEXT : 'Buscando o conteúdo original…';
      quote.appendChild(note);
    }

    if (timestamp) {
      const footer = document.createElement('div');
      footer.className = `${CONFIG.QUOTE_CLASS}-footer`;
      footer.textContent = `Capturado em ${timestamp}`;
      quote.appendChild(footer);
    }

    // Encontrar onde inserir o quote (antes do texto da mensagem)
    const textContainer = msgContainer.querySelector('[data-testid="msg-text"]') ||
                          msgContainer.querySelector('.copyable-text') ||
                          msgContainer.querySelector('.selectable-text');
    
    if (textContainer && textContainer.parentElement) {
      textContainer.parentElement.insertBefore(quote, textContainer);
    } else {
      // Fallback: inserir no início do container
      msgContainer.insertBefore(quote, msgContainer.firstChild);
    }

    // Adicionar visual de destaque ao container
    msgContainer.style.background = isEdited 
      ? 'rgba(59, 130, 246, 0.05)' 
      : 'rgba(255, 87, 87, 0.05)';
    msgContainer.style.borderRadius = '8px';

    console.log(`[RecoverVisualInjector] ✅ Quote injetado: ${config.emoji} ${config.text}`);
  }

  /**
   * Escapa HTML para evitar XSS
   */
  function escapeHtml(text) {
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(text);
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  /**
   * Mantém função injectBadge para compatibilidade
   * @deprecated Use injectQuoteVisual instead
   */
  function injectBadge(msgEl, config, event) {
    injectQuoteVisual(msgEl, config, event);
  }

  /**
   * API pública
   */
  window.RecoverVisualInjector = {
    init,
    processExistingMessages,
    MESSAGE_STATES,
    // Para os testes (tests/unit/recover-visual-injector.test.js)
    _internals: { extractMessageId, isValidMsgId, idFromDataId },
    
    // Persistência
    loadPersistentMarkers,
    savePersistentMarkers,
    addPersistentMarker,
    getPersistentMarker,
    getMarkersCount: () => persistentMarkers.size,
    
    // Limpeza — agora também remove badges visuais e marca de processado,
    // pra que usuários afetados pelo bug "todas viraram apagadas" possam
    // sair da inconsistência sem reinstalar a extensão.
    clearMarkers: async () => {
      persistentMarkers.clear();
      await chrome.storage.local.remove(CONFIG.STORAGE_KEY);
      document.querySelectorAll(`.${CONFIG.QUOTE_CLASS}`).forEach(q => q.remove());
      document.querySelectorAll(`[${CONFIG.INJECTED_ATTR}]`).forEach(el => {
        el.removeAttribute(CONFIG.INJECTED_ATTR);
        el.style.background = '';
      });
      console.log('[RecoverVisualInjector] 🧹 Marcadores limpos (storage + DOM)');
    },

    // Forçar reprocessamento
    reprocess: () => {
      // Remover atributos de processamento
      document.querySelectorAll(`[${CONFIG.INJECTED_ATTR}]`).forEach(el => {
        el.removeAttribute(CONFIG.INJECTED_ATTR);
        // Remover quotes existentes
        el.querySelectorAll(`.${CONFIG.QUOTE_CLASS}`).forEach(q => q.remove());
      });
      // Reprocessar
      processExistingMessages();
    }
  };

  // Atalho de console amigável pra usuários relatando "todas apagadas":
  // window.WHL_clearRecoverMarkers() limpa tudo e reprocessa.
  window.WHL_clearRecoverMarkers = async () => {
    await window.RecoverVisualInjector.clearMarkers();
    window.RecoverVisualInjector.processExistingMessages();
    console.log('[RecoverVisualInjector] ✅ Reset completo concluído');
  };

  // Auto-inicializar quando RecoverAdvanced estiver pronto
  function tryInit() {
    if (window.RecoverAdvanced?.messageVersions) {
      init();
    } else {
      console.log('[RecoverVisualInjector] ⏳ Aguardando RecoverAdvanced...');
      setTimeout(tryInit, 1000);
    }
  }

  // Aguardar DOM estar pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    setTimeout(tryInit, 1000);
  }

})();

console.log('[RecoverVisualInjector] 📦 Módulo carregado');
