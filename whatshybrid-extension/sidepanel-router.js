/**
 * sidepanel-router.js - WhatsHybrid Lite Fusion
 *
 * Objetivo:
 * - Trocar as views do Side Panel de acordo com o botão do TopNav (Principal / Extrator / Grupos / Recover / Config).
 * - Manter o "motor" (lógica original) rodando no content script (WhatsApp Web), sem reescrever a lógica de envio.
 * - Devolver no Side Panel o mesmo conjunto de funcionalidades do módulo original (preview, CSV, imagem, tabela, etc.).
 */

// INÍCIO DO SCRIPT - SIDEPANEL-ROUTER.JS v7.5.0
console.log('[SidePanel Router] 📦 Arquivo carregado pelo browser');

(() => {
  'use strict';
  
  console.log('[SidePanel Router] 🚀 IIFE iniciando...');

  // View names come from the Top Panel (content/top-panel-injector.js)
  // and are persisted by background.js in chrome.storage.local (whl_active_view).
  // Keep aliases to avoid blank panels when a name changes (e.g. "groups" vs "grupos").
  const VIEW_MAP = {
    principal: 'whlViewPrincipal',
    extrator: 'whlViewExtrator',

    // Grupos / Group Extractor v6
    groups: 'whlViewGroups',
    grupos: 'whlViewGroups',

    recover: 'whlViewRecover',
    config: 'whlViewConfig',
    backup: 'whlViewBackup',
    
    // Novos módulos
    crm: 'whlViewCrm',
    analytics: 'whlViewAnalytics',
    tasks: 'whlViewTasks',
    ai: 'whlViewAi',
    autopilot: 'whlViewAutoPilot',
    backend: 'whlViewBackend',
    
    // Quick Replies e Team System
    quickreplies: 'whlViewQuickReplies',
    team: 'whlViewTeam',

    // System Auto-Protection Layer
    sapl: 'whlViewSapl',
  };

  const MAX_QUEUE_RENDER = 500;   // evita travar o side panel em filas gigantes
  const MAX_RECOVER_RENDER = 200;

  let currentView = null;
  let viewSyncInterval = null;

  // ========= Utils =========
  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(str);
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtTimeHM(d = new Date()) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function normalizeFromId(from, fullObj = null) {
    // Tenta extrair número de múltiplas fontes
    const sources = [
      from,
      fullObj?.phoneNumber,
      fullObj?.number,
      fullObj?.sender,
      fullObj?.from,
      fullObj?.chat,
      fullObj?.jid,
      fullObj?.id?.user,
      fullObj?.id?._serialized
    ];
    
    for (const src of sources) {
      if (!src) continue;
      let s = String(src).trim();
      
      // Remove sufixos do WhatsApp
      s = s
        .replace(/@c\.us/g, '')
        .replace(/@s\.whatsapp\.net/g, '')
        .replace(/@g\.us/g, '')
        .replace(/@broadcast/g, '')
        .replace(/@lid/g, '');
      
      // Extrai apenas dígitos
      const digits = s.replace(/\D/g, '');
      
      // Se tem entre 10 e 15 dígitos, é provavelmente um número de telefone
      if (digits.length >= 10 && digits.length <= 15) {
        // Formata o número de forma legível
        if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
          // Número brasileiro (55 + DDD + 8/9 dígitos)
          const ddd = digits.slice(2, 4);
          const rest = digits.slice(4);
          if (rest.length === 9) {
            // Celular: 9 dígitos após o DDD
            return `+55 ${ddd} ${rest.slice(0, 5)}-${rest.slice(5)}`;
          } else if (rest.length === 8) {
            // Fixo: 8 dígitos após o DDD
            return `+55 ${ddd} ${rest.slice(0, 4)}-${rest.slice(4)}`;
          }
        }
        // Outros números internacionais
        return '+' + digits;
      }
    }
    
    // Se não encontrou número válido, retorna o original limpo
    let s = String(from ?? '').trim();
    s = s
      .replace(/@c\.us/g, '')
      .replace(/@s\.whatsapp\.net/g, '')
      .replace(/@g\.us/g, '')
      .replace(/@broadcast/g, '')
      .replace(/@lid/g, '');
    
    return s || 'Desconhecido';
  }

  function joinNonEmptyLines(...parts) {
    return parts
      .map(p => (p || '').trim())
      .filter(Boolean)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  async function copyToClipboard(text) {
    const t = String(text ?? '');
    if (!t.trim()) return false;
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch (e) {
      // fallback
      try {
        const ta = document.createElement('textarea');
        ta.value = t;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  // ========= Messaging =========
  function sendToActiveTab(payload) {
    return new Promise((resolve, reject) => {
      // v9.4.4 BUG #119: timeout de 30s. Sem isso, content script travado
      // (DOM mudou, WhatsApp Web em loading state) deixava promise pendente
      // pra sempre → UI spinner infinito → cliente forçava reload da extensão.
      const TIMEOUT_MS = 30000;
      let resolved = false;
      const timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        reject(new Error('Timeout: WhatsApp Web não respondeu em 30s. Recarregue a página.'));
      }, TIMEOUT_MS);
      const safeResolve = (v) => { if (resolved) return; resolved = true; clearTimeout(timeoutId); resolve(v); };
      const safeReject = (e) => { if (resolved) return; resolved = true; clearTimeout(timeoutId); reject(e); };

      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const tab = (tabs || []).find(t => (t.url || '').includes('web.whatsapp.com'));
        if (!tab?.id) return safeReject(new Error('Abra o WhatsApp Web (web.whatsapp.com) e tente novamente.'));
        console.log('[SidePanel Router] 📤 Sending to tab:', tab.id, payload);
        chrome.tabs.sendMessage(tab.id, payload, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) {
            console.error('[SidePanel Router] ❌ Error sending:', err.message);
            return safeReject(new Error(err.message || String(err)));
          }
          console.log('[SidePanel Router] 📥 Response from content:', resp);
          safeResolve(resp);
        });
      });
    });
  }

  async function motor(cmd, data = {}) {
    console.log('[SidePanel Router] 📤 motor() called:', cmd, data);
    const resp = await sendToActiveTab({ type: 'WHL_SIDE_PANEL', cmd, ...data });
    console.log('[SidePanel Router] 📥 motor() response:', resp);
    if (resp && resp.success === false) {
      throw new Error(resp.message || 'Falha no comando: ' + cmd);
    }
    return resp;
  }

  // ========= View Router =========
  
  // ========= CONFIG VIEW =========
  let configBound = false;
  function configInit() {
    if (configBound) return;
    configBound = true;
    console.log('[SidePanel Router] ⚙️ configInit() called');
    // Config view é gerenciada por sidepanel-fixes.js
  }
  
  function configLoad() {
    console.log('[SidePanel Router] ⚙️ configLoad() called');
    // Config load é gerenciado por sidepanel-fixes.js
  }

function showView(viewName) {
    console.log('[SidePanel Router] ▶️ showView called with:', viewName);
    
    // Defensive: if the stored view name is unknown, fall back to principal
    const safeView = VIEW_MAP[viewName] ? viewName : 'principal';
    currentView = safeView;
    
    const activeId = VIEW_MAP[safeView];
    console.log('[SidePanel Router] ✅ Showing view:', safeView, '→ element ID:', activeId);

    // Avoid duplicate toggles when VIEW_MAP has aliases (e.g. groups/grupos)
    const ids = Array.from(new Set(Object.values(VIEW_MAP)));
    console.log('[SidePanel Router] All view IDs:', ids);
    
    let foundActive = false;
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) {
        console.warn('[SidePanel Router] ⚠️ Element NOT FOUND:', id);
        return;
      }
      const shouldShow = id === activeId;
      el.classList.toggle('hidden', !shouldShow);
      if (shouldShow) {
        foundActive = true;
        console.log('[SidePanel Router] ✅ SHOWING:', id);
      }
    });
    
    if (!foundActive) {
      console.error('[SidePanel Router] ❌ Active element not found for ID:', activeId);
    }

    // Hooks por view
    stopIntervals();
    if (safeView === 'principal') {
      principalInit();      // garante listeners e render inicial
      principalRefresh(true);
      startPrincipalInterval();
    } else if (safeView === 'extrator') {
      extratorInit();
      extratorRefresh();
    } else if (safeView === 'recover') {
      recoverInit();
      recoverRefresh();
      startRecoverInterval();
    } else if (safeView === 'config') {
      configInit();
      configLoad();
    } else if (safeView === 'backup') {
      backupInit();
      backupRefresh(true);
      startBackupInterval();
    } else if (safeView === 'grupos' || safeView === 'groups') {
      // UI do v6 já tem seu próprio JS (sidepanel.js). Nada a fazer aqui.
    } else if (safeView === 'crm' || safeView === 'tasks' || safeView === 'ai' || safeView === 'autopilot' || safeView === 'backend') {
      // Novas views de módulos - renderizadas pelo script inline no sidepanel.html
      if (typeof window.renderModuleViews === 'function') {
        window.renderModuleViews();
      }
      // Inicializar handlers específicos
      if (safeView === 'ai' && typeof window.AIBackendHandlers?.initAIView === 'function') {
        window.AIBackendHandlers.initAIView();
        window.AIBackendHandlers.updateAIMetrics();
      }
      // Carregar estatísticas de treinamento simplificadas
      if (safeView === 'ai' && typeof window.loadTrainingStatsSimplified === 'function') {
        window.loadTrainingStatsSimplified();
      }
      if (safeView === 'backend' && typeof window.AIBackendHandlers?.initBackendView === 'function') {
        window.AIBackendHandlers.initBackendView();
        window.AIBackendHandlers.checkBackendConnection();
      }
      // Emitir evento de view changed
      if (window.EventBus) {
        window.EventBus.emit('view:changed', { view: safeView });
      }
    } else if (safeView === 'quickreplies') {
      // Quick Replies view
      if (typeof window.renderQuickRepliesList === 'function') {
        window.renderQuickRepliesList();
      }
    } else if (safeView === 'team') {
      // Team view
      if (typeof window.renderTeamMembersList === 'function') {
        window.renderTeamMembersList();
      }
      if (typeof window.renderTeamStats === 'function') {
        window.renderTeamStats();
      }
    } else if (safeView === 'sapl') {
      saplInit();
      saplRefresh();
    }
  }

  async function loadCurrentView() {
    console.log('[SidePanel Router] 🔄 loadCurrentView called');
    try {
      const result = await chrome.storage.local.get('whl_active_view');
      console.log('[SidePanel Router] Storage result:', result);
      const view = result.whl_active_view || 'principal';
      console.log('[SidePanel Router] Will show view:', view);
      showView(view);
    } catch(e) {
      console.error('[SidePanel Router] ❌ Error loading view:', e);
      showView('principal');
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    console.log('[SidePanel Router] Storage changed:', area, Object.keys(changes));
    if (area !== 'local') return;
    if (changes.whl_active_view?.newValue) {
      console.log('[SidePanel Router] View changed to:', changes.whl_active_view.newValue);
      showView(changes.whl_active_view.newValue);
    }
  });

  // ========= Intervals =========
  let principalInterval = null;
  let recoverInterval = null;
  let backupInterval = null;
  let recoverSyncInterval = null;

  // Principal live-refresh state (to keep queue/table status updating in real time)
  let principalLastLight = null;
  let principalLastFullAt = 0;

  function startPrincipalInterval() {
    if (principalInterval) clearInterval(principalInterval);

    // Faster tick on Principal view so the queue status updates live
    principalInterval = setInterval(() => {
      if (currentView === 'principal') principalTick();
    }, 900);
  }

  function startRecoverInterval() {
    if (recoverInterval) clearInterval(recoverInterval);
    recoverInterval = setInterval(() => {
      if (currentView === 'recover') recoverRefresh(false);
    }, 3000);
  }

  function startBackupInterval() {
    if (backupInterval) clearInterval(backupInterval);
    backupInterval = setInterval(() => {
      if (currentView === 'backup') backupRefresh(false);
    }, 2500);
  }

  function stopIntervals() {
    if (principalInterval) clearInterval(principalInterval);
    principalInterval = null;
    if (recoverInterval) clearInterval(recoverInterval);
    recoverInterval = null;
    if (backupInterval) clearInterval(backupInterval);
    backupInterval = null;
    if (recoverSyncInterval) clearInterval(recoverSyncInterval);
    recoverSyncInterval = null;
  }

  // ========= Principal =========
  let principalBound = false;
  let principalImageData = null;
  let principalFileData = null;
  let principalFileName = null;
  let principalFileMime = null;

  let principalAudioData = null;
  let principalAudioName = null;
  let principalAudioMime = null;
  let principalAudioDuration = null;

  let principalCsvName = null;
  let principalDebounceTimer = null;

  const EMOJIS = [
    '😀','😁','😂','🤣','😊','😍','😘','😎','🤝','🙏','👍','👎','🔥','💡','✨',
    '🎉','✅','❌','⚠️','📌','📎','📞','📱','💬','🕒','📍','🧾','💰','📦'
  ];

  function principalInit() {
    console.log('[SidePanel Router] 🟢 principalInit() called');
    if (principalBound) {
      console.log('[SidePanel Router] ⚠️ principalInit already bound, skipping');
      return;
    }
    principalBound = true;
    console.log('[SidePanel Router] ✅ principalInit() binding listeners...');

    // Emoji picker
    const picker = $('sp_emoji_picker');
    if (picker) {
      picker.innerHTML = EMOJIS.map(e => `<button class="sp-btn sp-btn-secondary" data-emoji="${escapeHtml(e)}" style="padding:6px 8px; margin:4px; min-width:38px">${escapeHtml(e)}</button>`).join('');
      picker.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-emoji]');
        if (!btn) return;
        const emoji = btn.getAttribute('data-emoji');
        insertEmoji(emoji);
      });
    }

    const emojiBtn = $('sp_emoji_btn');
    if (emojiBtn && picker) {
      emojiBtn.addEventListener('click', () => {
        picker.style.display = (picker.style.display === 'none' || !picker.style.display) ? 'block' : 'none';
      });
      document.addEventListener('click', (ev) => {
        if (currentView !== 'principal') return;
        const isInside = picker.contains(ev.target) || emojiBtn.contains(ev.target);
        if (!isInside) picker.style.display = 'none';
      });
    }

    // Inputs -> preview + debounce sync
    const numbersEl = $('sp_numbers');
    const msgEl = $('sp_message');
    if (numbersEl) numbersEl.addEventListener('input', () => {
      principalScheduleSync();
    });
    if (msgEl) msgEl.addEventListener('input', () => {
      principalUpdatePreview();
      principalScheduleSync();
    });

    // CSV
    const csvInput = $('sp_csv');
    const csvBtn = $('sp_select_csv');
    const csvClear = $('sp_clear_csv');
    if (csvBtn && csvInput) {
      csvBtn.addEventListener('click', () => csvInput.click());
    }
    if (csvInput) {
      csvInput.addEventListener('change', async () => {
        const file = csvInput.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          $('sp_csv_hint').textContent = `📊 Importando: ${file.name} ...`;
          const resp = await motor('IMPORT_CSV_TEXT', { csvText: text, filename: file.name });
          principalCsvName = file.name;
          if (csvClear) csvClear.style.display = '';
          if (csvBtn) csvBtn.textContent = '📊 Trocar CSV';
          $('sp_csv_hint').textContent = resp?.message || `✅ CSV importado: ${file.name}`;
          await principalRefresh(true);
        } catch (e) {
          $('sp_csv_hint').textContent = `❌ Erro no CSV: ${e.message || e}`;
        }
      });
    }
    if (csvClear && csvInput) {
      csvClear.addEventListener('click', async () => {
        if (!confirm('Remover o CSV importado e limpar a fila gerada?')) return;
        try {
          csvInput.value = '';
          principalCsvName = null;
          csvClear.style.display = 'none';
          if (csvBtn) csvBtn.textContent = '📊 Importar CSV';
          $('sp_csv_hint').textContent = '';
          await motor('CLEAR_CSV');
          await principalRefresh(true);
        } catch (e) {
          $('sp_csv_hint').textContent = `❌ ${e.message || e}`;
        }
      });
    }

    // Image
    const imgInput = $('sp_image');
    const imgBtn = $('sp_select_image');
    const imgClear = $('sp_clear_image');
    if (imgBtn && imgInput) {
      imgBtn.addEventListener('click', () => imgInput.click());
    }
    if (imgInput) {
      imgInput.addEventListener('change', async () => {
        const file = imgInput.files?.[0];
        if (!file) return;

        const ok = await validateAndLoadImage(file);
        if (!ok) {
          imgInput.value = '';
          return;
        }
      });
    }
    if (imgClear && imgInput) {
      imgClear.addEventListener('click', async () => {
        if (!confirm('Remover anexo (imagem/arquivo/áudio)?')) return;
        try {
          imgInput.value = '';

          // Limpa todos os anexos
          principalImageData = null;
          principalFileData = null;
          principalFileName = null;
          principalFileMime = null;

          principalAudioData = null;
          principalAudioName = null;
          principalAudioMime = null;
          principalAudioDuration = null;

          const hint = $('sp_image_hint');
          if (hint) hint.textContent = '';

          imgClear.style.display = 'none';

          // Reset textos dos botões
          if (imgBtn) imgBtn.textContent = '📎 Anexar imagem';
          const fileBtn = $('sp_select_file');
          if (fileBtn) fileBtn.textContent = '📁 Anexar Arquivo';
          const audioBtn = $('sp_attach_audio');
          if (audioBtn) audioBtn.textContent = '🎵 Anexar Áudio';

          // Sincroniza estado no content script
          await motor('SET_IMAGE_DATA', { imageData: null });
          await motor('SET_FILE_DATA', { fileData: null, filename: null, mimeType: null });
          await motor('SET_AUDIO_DATA', { audioData: null, filename: null, mimeType: null, duration: 0 });

          principalUpdatePreview();
        } catch (e) {
          const hint = $('sp_image_hint');
          if (hint) hint.textContent = `❌ ${e.message || e}`;
        }
      });
    }

    // Excel import
    const excelInput = $('sp_excel_file');
    const excelBtn = $('sp_import_excel');
    if (excelBtn && excelInput) {
      excelBtn.addEventListener('click', () => excelInput.click());
    }
    if (excelInput) {
      excelInput.addEventListener('change', async () => {
        const file = excelInput.files?.[0];
        if (!file) return;
        
        try {
          $('sp_csv_hint').textContent = `📊 Importando: ${file.name} ...`;
          const result = await window.ContactImporter.importFile(file);
          
          if (!result.success) {
            $('sp_csv_hint').textContent = `❌ ${result.error}`;
            return;
          }
          
          // Add numbers to textarea
          const numbersEl = $('sp_numbers');
          if (numbersEl) {
            const existing = (numbersEl.value || '').split('\n').filter(Boolean);
            const combined = [...existing, ...result.numbers];
            const unique = [...new Set(combined)];
            numbersEl.value = unique.join('\n');
          }
          
          // Show stats
          const statsText = window.ContactImporter.formatStats(result.stats);
          $('sp_csv_hint').textContent = `✅ ${file.name}: ${statsText}`;
          
          // Clear input
          excelInput.value = '';
          
          // Sync with content script
          principalScheduleSync();
        } catch (e) {
          $('sp_csv_hint').textContent = `❌ Erro: ${e.message || e}`;
        }
      });
    }

    // Audio File Attachment
    const audioFileInput = $('sp_audio_file');
    const audioBtn = $('sp_attach_audio');
    if (audioBtn && audioFileInput) {
      audioBtn.addEventListener('click', () => audioFileInput.click());
    }
    if (audioFileInput) {
      audioFileInput.addEventListener('change', async () => {
        const file = audioFileInput.files?.[0];
        if (!file) return;

        try {
          const hint = $('sp_image_hint');

          // v9.4.4 BUG #113: validação de tamanho e tipo (antes não tinha cap).
          // Áudio de 50MB carregado em base64 trava sidepanel + estoura quota
          // de chrome.storage.local (5MB). WhatsApp aceita áudio até ~16MB.
          const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8MB — base64 fica ~10.7MB
          if (file.size > MAX_AUDIO_BYTES) {
            if (hint) hint.textContent = `❌ Áudio muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Limite: 8MB.`;
            audioFileInput.value = ''; // limpa input
            return;
          }
          const ALLOWED_AUDIO_TYPES = [
            'audio/mp3', 'audio/mpeg', 'audio/ogg', 'audio/wav',
            'audio/m4a', 'audio/x-m4a', 'audio/webm', 'audio/aac', 'audio/flac',
          ];
          if (file.type && !ALLOWED_AUDIO_TYPES.includes(file.type)) {
            if (hint) hint.textContent = `❌ Formato não suportado: ${file.type}. Use MP3, OGG, WAV ou M4A.`;
            audioFileInput.value = '';
            return;
          }

          if (hint) hint.textContent = '⏳ Carregando áudio...';

          // Read file as data URL
          const reader = new FileReader();
          reader.onload = async (e) => {
            const audioData = e.target.result;
            
            // Store audio data in state
            await motor('SET_AUDIO_DATA', { 
              audioData, 
              filename: file.name, 
              mimeType: file.type,
              duration: 0 // Duration will be calculated later if needed
            });

            // Update UI
            if (audioBtn) audioBtn.textContent = `🎵 ${file.name}`;
            const clearBtn = $('sp_clear_image');
            if (clearBtn) clearBtn.style.display = '';
            if (hint) hint.textContent = `✅ Áudio: ${file.name}`;

            console.log('[SidePanel Router] Audio file loaded:', file.name);
          };
          
          reader.onerror = () => {
            if (hint) hint.textContent = '❌ Erro ao carregar áudio';
          };
          
          reader.readAsDataURL(file);
        } catch (e) {
          const hint = $('sp_image_hint');
          if (hint) hint.textContent = `❌ ${e.message || e}`;
        }
      });
    }

    // Listener global: áudio gravado → salvar no estado da campanha (disparo em massa)
    if (!window.__WHL_AUDIO_READY_BOUND__) {
      window.__WHL_AUDIO_READY_BOUND__ = true;
      window.addEventListener('WHL_AUDIO_READY', async (ev) => {
        try {
          const d = ev?.detail || {};
          if (!d.dataUrl) return;

          // Limite (chrome.storage.local)
          const MAX_BYTES = 3 * 1024 * 1024; // 3MB
          if (typeof d.size === 'number' && d.size > MAX_BYTES) {
            const hint = $('sp_image_hint');
            if (hint) hint.textContent = `❌ Áudio muito grande (${Math.round(d.size/1024)}KB). Limite atual: ${Math.round(MAX_BYTES/1024)}KB`;
            return;
          }

          principalAudioData = d.dataUrl;
          principalAudioName = d.filename || 'voice.ogg';
          principalAudioMime = d.mimeType || 'audio/ogg; codecs=opus';
          principalAudioDuration = typeof d.duration === 'number' ? d.duration : 0;

          // Ao anexar áudio, removemos imagem/arquivo (1 anexo por disparo)
          principalImageData = null;
          principalFileData = null;
          principalFileName = null;
          principalFileMime = null;

          // UI
          const hint = $('sp_image_hint');
          if (hint) hint.textContent = `✅ Áudio anexado — ${principalAudioName}` + (principalAudioDuration ? ` (${principalAudioDuration}s)` : '');
          const clearBtn = $('sp_clear_image');
          if (clearBtn) clearBtn.style.display = '';
          const audioBtn = $('sp_attach_audio');
          if (audioBtn) audioBtn.textContent = '🎵 Trocar Áudio';
          const imgBtn = $('sp_select_image');
          if (imgBtn) imgBtn.textContent = '📎 Anexar imagem';
          const fileBtn = $('sp_select_file');
          if (fileBtn) fileBtn.textContent = '📁 Anexar Arquivo';

          // Estado no content
          await motor('SET_IMAGE_DATA', { imageData: null });
          await motor('SET_FILE_DATA', { fileData: null, filename: null, mimeType: null });
          await motor('SET_AUDIO_DATA', {
            audioData: principalAudioData,
            filename: principalAudioName,
            mimeType: principalAudioMime,
            duration: principalAudioDuration
          });

          principalUpdatePreview();
        } catch (err) {
          const hint = $('sp_image_hint');
          if (hint) hint.textContent = `❌ ${err.message || err}`;
        }
      });
    }



    // File Attachment (para disparo em massa) - seleciona e salva no estado (sem enviar imediatamente)
    const fileBtn = $('sp_select_file');
    if (fileBtn) {
      fileBtn.addEventListener('click', async () => {
        console.log('[SidePanel Router] 📁 File button clicked!');

        // Sempre abrir seletor (evita depender de métodos inexistentes)
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '*/*';
        input.style.display = 'none';
        document.body.appendChild(input);

        input.onchange = async (e) => {
          try {
            const file = e.target.files?.[0];
            document.body.removeChild(input);
            if (!file) return;

            // Limite de tamanho (chrome.storage.local). Ajuste se você trocar para IndexedDB.
            const MAX_BYTES = 3 * 1024 * 1024; // 3MB
            if (file.size > MAX_BYTES) {
              const hint = $('sp_image_hint');
              if (hint) hint.textContent = `❌ Arquivo muito grande (${Math.round(file.size/1024)}KB). Limite atual: ${Math.round(MAX_BYTES/1024)}KB`;
              return;
            }

            const dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ''));
              reader.onerror = () => reject(new Error('Falha ao ler arquivo.'));
              reader.readAsDataURL(file);
            });

            // Salva em memória do painel
            principalFileData = dataUrl;
            principalFileName = file.name;
            principalFileMime = file.type || 'application/octet-stream';

            // Ao anexar arquivo, removemos imagem/áudio para evitar conflito (1 anexo por disparo)
            principalImageData = null;
            principalAudioData = null;
            principalAudioName = null;
            principalAudioMime = null;
            principalAudioDuration = null;

            // Atualiza UI
            const hint = $('sp_image_hint');
            if (hint) hint.textContent = `✅ Arquivo anexado — ${file.name}`;
            const clearBtn = $('sp_clear_image');
            if (clearBtn) clearBtn.style.display = '';
            fileBtn.textContent = '📁 Trocar arquivo';
            const imgBtn = $('sp_select_image');
            if (imgBtn) imgBtn.textContent = '📎 Anexar imagem';
            const audioBtn = $('sp_attach_audio');
            if (audioBtn) audioBtn.textContent = '🎵 Anexar Áudio';

            // Sincroniza no content script (estado global da campanha)
            await motor('SET_IMAGE_DATA', { imageData: null });
            await motor('SET_AUDIO_DATA', { audioData: null, filename: null, mimeType: null, duration: 0 });
            await motor('SET_FILE_DATA', { fileData: dataUrl, filename: file.name, mimeType: principalFileMime });

            principalUpdatePreview();
          } catch (err) {
            const hint = $('sp_image_hint');
            if (hint) hint.textContent = `❌ ${err.message || err}`;
          }
        };

        input.click();
      });
    }


    // Buttons
    $('sp_build_queue')?.addEventListener('click', principalBuildQueue);
    $('sp_clear_fields')?.addEventListener('click', principalClearFields);

    const startBtn = $('sp_start');
    console.log('[SidePanel Router] 🔘 sp_start button:', startBtn);
    startBtn?.addEventListener('click', async () => {
      console.log('[SidePanel Router] 🚀 START button clicked!');
      const statusEl = $('sp_campaign_status');
      const startBtn = $('sp_start');
      const pauseBtn = $('sp_pause');
      
      if (statusEl) statusEl.textContent = '▶️ Iniciando...';
      if (startBtn) startBtn.disabled = true;
      
      try {
        await motor('START_CAMPAIGN');
        if (statusEl) statusEl.textContent = '✅ Enviando...';
        if (pauseBtn) pauseBtn.textContent = '⏸️ Pausar';
      } catch (e) {
        if (statusEl) statusEl.textContent = `❌ ${e.message || e}`;
      } finally {
        // v9.4.4 BUG #115: re-habilita botão SEMPRE (antes ficava disabled
        // pra sempre no success path → user precisava recarregar pra
        // iniciar nova campanha após uma terminar).
        if (startBtn) startBtn.disabled = false;
      }
      await principalRefresh(true);
    });

    $('sp_pause')?.addEventListener('click', async () => {
      const pauseBtn = $('sp_pause');
      const statusEl = $('sp_campaign_status');
      
      // Verificar estado atual antes de alternar
      try {
        const resp = await motor('GET_STATE', { light: true });
        const st = resp?.state || resp;
        
        if (st?.isPaused) {
          // Está pausado, então vamos continuar
          if (statusEl) statusEl.textContent = '▶️ Continuando...';
          await motor('PAUSE_TOGGLE');
          if (pauseBtn) pauseBtn.textContent = '⏸️ Pausar';
          if (statusEl) statusEl.textContent = '✅ Enviando...';
        } else if (st?.isRunning) {
          // Está rodando, então vamos pausar
          if (statusEl) statusEl.textContent = '⏸️ Pausando...';
          await motor('PAUSE_TOGGLE');
          if (pauseBtn) pauseBtn.textContent = '▶️ Continuar';
          if (statusEl) statusEl.textContent = '⏸️ Pausado';
        } else {
          // Não está rodando - nada a fazer
          if (statusEl) statusEl.textContent = '⚠️ Campanha não iniciada';
        }
      } catch (e) {
        if (statusEl) statusEl.textContent = `❌ ${e.message || e}`;
      }
      await principalRefresh(true);
    });

    $('sp_stop')?.addEventListener('click', async () => {
      if (!confirm('⛔ Parar a campanha completamente?\n\nIsso vai limpar a fila e encerrar todos os envios.')) return;
      
      const statusEl = $('sp_campaign_status');
      const startBtn = $('sp_start');
      const pauseBtn = $('sp_pause');
      
      if (statusEl) statusEl.textContent = '⏹️ Parando...';
      
      try {
        await motor('STOP_CAMPAIGN');
        // Também limpar a fila
        await motor('WIPE_QUEUE');
        if (statusEl) statusEl.textContent = '⏹️ Campanha encerrada';
        if (startBtn) startBtn.disabled = false;
        if (pauseBtn) pauseBtn.textContent = '⏸️ Pausar';
      } catch (e) {
        if (statusEl) statusEl.textContent = `❌ ${e.message || e}`;
      }
      await principalRefresh(true);
    });

    $('sp_skip')?.addEventListener('click', async () => {
      try {
        await motor('SKIP_CURRENT');
      } catch (e) {
        $('sp_campaign_status').textContent = `❌ ${e.message || e}`;
      }
      await principalRefresh(true);
    });

    $('sp_wipe')?.addEventListener('click', async () => {
      if (!confirm('Zerar a fila inteira?')) return;
      try {
        await motor('WIPE_QUEUE');
      } catch (e) {
        $('sp_campaign_status').textContent = `❌ ${e.message || e}`;
      }
      await principalRefresh(true);
    });

    $('sp_save_message')?.addEventListener('click', async () => {
      const nameDefault = `Mensagem ${new Date().toLocaleString()}`;
      const name = prompt('Nome para salvar a mensagem:', nameDefault);
      if (!name) return;

      const numbersText = $('sp_numbers')?.value || '';
      const messageText = $('sp_message')?.value || '';
      try {
        await motor('SAVE_MESSAGE_DRAFT', { name, numbersText, messageText, imageData: principalImageData });
        $('sp_hint').textContent = `✅ Mensagem salva: ${name}`;
      } catch (e) {
        $('sp_hint').textContent = `❌ ${e.message || e}`;
      }
    });
  }

  function insertEmoji(emoji) {
    const ta = $('sp_message');
    if (!ta || !emoji) return;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    ta.value = before + emoji + after;
    const pos = start + emoji.length;
    ta.setSelectionRange(pos, pos);
    ta.focus();
    principalUpdatePreview();
    principalScheduleSync();
  }

  function highlightVariables(msg) {
    if (!msg) return '';
    // Destaca variáveis em ambos formatos: {var} e {{var}}
    return escapeHtml(msg)
      .replace(/\{\{[^}]+\}\}/g, (match) => {
        return `<span style="background: rgba(255,255,0,0.20); padding: 1px 4px; border-radius: 3px; font-weight: bold;">${match}</span>`;
      })
      .replace(/\{[a-zA-Z_]+\}/g, (match) => {
        return `<span style="background: rgba(255,255,0,0.20); padding: 1px 4px; border-radius: 3px; font-weight: bold;">${match}</span>`;
      });
  }

  function principalUpdatePreview(stateForPhone = null) {
    const msgEl = $('sp_message');
    const textEl = $('sp_preview_text');
    const imgEl = $('sp_preview_img');
    const metaEl = $('sp_preview_meta');

    if (metaEl) metaEl.textContent = fmtTimeHM();

    const messageRaw = (msgEl?.value || '');
    let phone = '';
    if (stateForPhone?.queue?.[stateForPhone.index]?.phone) {
      phone = stateForPhone.queue[stateForPhone.index].phone;
    }

    // Process template variables if templateManager is available
    let msgProcessed = messageRaw;
    if (window.templateManager && messageRaw) {
      const contact = { phone, numero: phone };
      msgProcessed = window.templateManager.processVariables(messageRaw, contact);
    }

    // Also replace {phone} variable (existing functionality)
    msgProcessed = msgProcessed.replace(/\{phone\}/g, phone);

    if (textEl) textEl.innerHTML = highlightVariables(msgProcessed);

    // Handle media preview (image, audio, file)
    if (imgEl) {
      // Priority: Image > Audio > File
      if (principalImageData) {
        // Show image - restore to IMG if needed
        if (imgEl.tagName !== 'IMG') {
          imgEl.outerHTML = '<img id="sp_preview_img" src="" style="display:none;" />';
          const newImgEl = $('sp_preview_img');
          if (newImgEl) {
            newImgEl.src = principalImageData;
            newImgEl.style.display = 'block';
            newImgEl.style.maxWidth = '100%';
            newImgEl.style.borderRadius = '10px';
            newImgEl.style.marginBottom = '8px';
          }
        } else {
          imgEl.src = principalImageData;
          imgEl.style.display = 'block';
          imgEl.style.maxWidth = '100%';
          imgEl.style.borderRadius = '10px';
          imgEl.style.marginBottom = '8px';
        }
      } else if (principalAudioData) {
        // Show audio player
        if (imgEl.tagName !== 'AUDIO') {
          imgEl.outerHTML = `<audio id="sp_preview_img" controls style="display:block;width:100%;max-width:300px;margin-bottom:8px">
            <source src="${principalAudioData}" type="${principalAudioMime || 'audio/ogg'}">
          </audio>`;
        }
      } else if (principalFileData) {
        // Show file icon/name
        if (imgEl.tagName !== 'DIV') {
          const fileIcon = getFileIcon(principalFileMime);
          imgEl.outerHTML = `<div id="sp_preview_img" style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(0,0,0,0.1);border-radius:8px;margin-bottom:8px;">
            <span style="font-size:24px;">${fileIcon}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${principalFileName || 'arquivo'}</div>
              <div style="font-size:11px;opacity:0.7;">Documento</div>
            </div>
          </div>`;
        }
      } else {
        // No media - restore to hidden IMG
        if (imgEl.tagName !== 'IMG') {
          imgEl.outerHTML = '<img id="sp_preview_img" src="" style="display:none;" />';
        } else {
          imgEl.removeAttribute('src');
          imgEl.style.display = 'none';
        }
      }
    }
  }

  function getFileIcon(mimeType) {
    if (!mimeType) return '📄';
    if (mimeType.startsWith('application/pdf')) return '📕';
    if (mimeType.startsWith('application/vnd.ms-excel') || mimeType.includes('spreadsheet')) return '📊';
    if (mimeType.startsWith('application/vnd.ms-powerpoint') || mimeType.includes('presentation')) return '📊';
    if (mimeType.startsWith('application/msword') || mimeType.includes('document')) return '📝';
    if (mimeType.startsWith('application/zip') || mimeType.startsWith('application/x-rar')) return '🗜️';
    if (mimeType.startsWith('text/')) return '📃';
    if (mimeType.startsWith('video/')) return '🎥';
    return '📄';
  }

  function principalScheduleSync() {
    if (principalDebounceTimer) clearTimeout(principalDebounceTimer);
    principalDebounceTimer = setTimeout(() => principalSyncFields(), 350);
  }

  async function principalSyncFields() {
    try {
      await motor('SET_FIELDS', {
        numbersText: $('sp_numbers')?.value || '',
        messageText: $('sp_message')?.value || '',
      });
    } catch (e) {
      // silencioso (não travar a digitação)
      console.debug('[WHL] sync failed', e);
    }
  }

  async function validateAndLoadImage(file) {
    const hint = $('sp_image_hint');
    const imgBtn = $('sp_select_image');
    const imgClear = $('sp_clear_image');

    try {
      const validTypes = ['image/jpeg','image/jpg','image/png','image/gif','image/webp'];
      if (!validTypes.includes(file.type)) {
        if (hint) hint.textContent = '❌ Formato inválido. Use JPG, PNG, GIF ou WebP.';
        return false;
      }
      if (file.size > 16 * 1024 * 1024) {
        if (hint) hint.textContent = '❌ Imagem muito grande. Máximo 16MB.';
        return false;
      }

      // checar dimensões
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Falha ao ler arquivo.'));
        reader.readAsDataURL(file);
      });

      const dims = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.width, h: img.height });
        img.onerror = () => resolve({ w: 0, h: 0 });
        img.src = dataUrl;
      });

      if (dims.w > 4096 || dims.h > 4096) {
        if (hint) hint.textContent = `❌ Dimensões muito grandes (${dims.w}x${dims.h}). Máximo 4096px.`;
        return false;
      }

      principalImageData = dataUrl;

      // Ao anexar imagem, removemos arquivo/áudio para evitar conflito (1 anexo por disparo)
      principalFileData = null;
      principalFileName = null;
      principalFileMime = null;
      principalAudioData = null;
      principalAudioName = null;
      principalAudioMime = null;
      principalAudioDuration = null;

      if (hint) hint.textContent = `✅ Imagem anexada: ${file.name} (${Math.round(file.size/1024)}KB)`;
      if (imgClear) imgClear.style.display = '';
      if (imgBtn) imgBtn.textContent = '📎 Trocar imagem';

      await motor('SET_IMAGE_DATA', { imageData: dataUrl });
      await motor('SET_FILE_DATA', { fileData: null, filename: null, mimeType: null });
      await motor('SET_AUDIO_DATA', { audioData: null, filename: null, mimeType: null, duration: 0 });
      await motor('SET_FILE_DATA', { fileData: null, filename: null, mimeType: null });
      await motor('SET_AUDIO_DATA', { audioData: null, filename: null, mimeType: null, duration: 0 });
      principalUpdatePreview();

      return true;
    } catch (e) {
      if (hint) hint.textContent = `❌ ${e.message || e}`;
      return false;
    }
  }

  // v9.4.4 BUG #114: previne double-click. Antes, cliente clicava 5x rápido →
  // 5 BUILD_QUEUE em paralelo, last-write-wins, state oscilava.
  let _buildQueueInflight = false;
  async function principalBuildQueue() {
    if (_buildQueueInflight) {
      console.log('[SidePanel] BUILD_QUEUE ignorado — request anterior em andamento');
      return;
    }
    _buildQueueInflight = true;

    const hint = $('sp_hint');
    const buildBtn = $('sp_build_queue');
    if (hint) hint.textContent = '⏳ Gerando tabela...';
    if (buildBtn) buildBtn.disabled = true;

    try {
      const numbersText = $('sp_numbers')?.value || '';
      const messageText = $('sp_message')?.value || '';
      const resp = await motor('BUILD_QUEUE', { numbersText, messageText });

      if (resp?.state) {
        principalApplyState(resp.state);
      }
      if (hint) hint.textContent = resp?.message || '✅ Tabela gerada.';
    } catch (e) {
      if (hint) hint.textContent = `❌ ${e.message || e}`;
    } finally {
      _buildQueueInflight = false;
      if (buildBtn) buildBtn.disabled = false;
    }
  }

  async function principalClearFields() {
    if (!confirm('Limpar campos de números e mensagem?')) return;

    $('sp_numbers').value = '';
    $('sp_message').value = '';
    principalUpdatePreview();

    const hint = $('sp_hint');
    if (hint) hint.textContent = '';

    try {
      await motor('CLEAR_FIELDS');
    } catch (e) {
      // ignora
    }
  }

  async function principalTick() {
    // Light poll for status + conditional full refresh for queue table
    try {
      const resp = await motor('GET_STATE', { light: true });
      const st = resp?.state || resp; // compat
      if (!st) return;

      principalApplyStatus(st);

      // Decide when we need a full refresh (queue/table)
      let needFull = false;
      if (!principalLastLight) {
        needFull = true;
      } else {
        const keys = ['isRunning','isPaused','index','queueTotal','queueSent','queueFailed','queuePending'];
        for (const k of keys) {
          if (principalLastLight?.[k] !== st?.[k]) { needFull = true; break; }
        }
      }
      principalLastLight = st;

      if (!needFull) return;

      // Throttle full pulls to avoid excessive work on huge queues
      const now = Date.now();
      if (now - principalLastFullAt < 350) return;
      principalLastFullAt = now;

      const fullResp = await motor('GET_STATE', { light: false });
      const fullSt = fullResp?.state || fullResp;
      if (fullSt) principalApplyState(fullSt);
    } catch (e) {
      // Silencioso no polling
    }
  }

  async function principalRefresh(includeQueue) {
    // includeQueue: true quando entrou na view ou após ações; false no intervalo
    try {
      const resp = await motor('GET_STATE', { light: !includeQueue });
      const st = resp?.state || resp; // compat
      if (!st) return;

      // Se veio "light", não vamos redesenhar a tabela por completo
      if (!includeQueue) {
        principalApplyStatus(st);
        return;
      }

      principalApplyState(st);
    } catch (e) {
      $('sp_campaign_status').textContent = `❌ ${e.message || e}`;
    }
  }

  function principalApplyStatus(st) {
    // Atualiza apenas status/stats/barra/meta (sem re-render de tabela)
    const sent = st.queueSent ?? null; // se vier do motor
    const failed = st.queueFailed ?? null;
    const pending = st.queuePending ?? null;

    // Se não vier do motor (light), tenta usar totals (se existirem)
    const total = st.queueTotal ?? (Array.isArray(st.queue) ? st.queue.length : 0);

    if (typeof sent === 'number' && $('sp_stat_sent')) $('sp_stat_sent').textContent = sent;
    if (typeof failed === 'number' && $('sp_stat_failed')) $('sp_stat_failed').textContent = failed;
    if (typeof pending === 'number' && $('sp_stat_pending')) $('sp_stat_pending').textContent = pending;

    // Meta (posição atual)
    const metaEl = $('sp_queue_meta');
    if (metaEl) {
      const idx = (typeof st.index === 'number' ? st.index : 0);
      if (total > 0) {
        const pos = Math.min(idx + 1, total);
        metaEl.textContent = `${total} contatos • Próximo: ${pos}/${total}`;
      } else {
        metaEl.textContent = '0 contatos';
      }
    }

    // Status
    const statusEl = $('sp_campaign_status');
    if (statusEl) {
      if (st.isRunning && !st.isPaused) statusEl.textContent = '✅ Enviando...';
      else if (st.isPaused) statusEl.textContent = '⏸️ Pausado';
      else statusEl.textContent = '⏹️ Parado';
    }

    // Progress (best effort)
    if (typeof sent === 'number' && typeof failed === 'number' && total > 0) {
      const completed = sent + failed;
      const perc = Math.round((completed / total) * 100);
      const fill = $('sp_progress_fill');
      const ptxt = $('sp_progress_text');
      if (fill) fill.style.width = `${perc}%`;
      if (ptxt) ptxt.textContent = `${perc}% (${completed}/${total})`;
    } else {
      const fill = $('sp_progress_fill');
      const ptxt = $('sp_progress_text');
      if (fill) fill.style.width = `0%`;
      if (ptxt) ptxt.textContent = `0% (0/${total || 0})`;
    }
  }

  function principalApplyState(st) {
    // Campos (se o usuário estiver digitando, não sobrescrever constantemente)
    const nEl = $('sp_numbers');
    const mEl = $('sp_message');

    if (nEl && (document.activeElement !== nEl)) nEl.value = st.numbersText || '';
    if (mEl && (document.activeElement !== mEl)) mEl.value = st.message || '';

    principalImageData = st.imageData || principalImageData;

    // Novos anexos (arquivo/áudio) para disparo em massa
    principalFileData = st.fileData || principalFileData;
    principalFileName = st.fileName || principalFileName;
    principalFileMime = st.fileMimeType || principalFileMime;

    principalAudioData = st.audioData || principalAudioData;
    principalAudioName = st.audioFilename || principalAudioName;
    principalAudioMime = st.audioMimeType || principalAudioMime;
    principalAudioDuration = (typeof st.audioDuration === 'number' ? st.audioDuration : principalAudioDuration);

    // CSV hints
    const csvHint = $('sp_csv_hint');
    const csvBtn = $('sp_select_csv');
    const csvClear = $('sp_clear_csv');
    if (csvHint && principalCsvName) csvHint.textContent = `📊 CSV carregado: ${principalCsvName}`;


    // Attachment hints (imagem/arquivo/áudio)
    const hint = $('sp_image_hint');
    const imgBtn = $('sp_select_image');
    const fileBtn = $('sp_select_file');
    const audioBtn = $('sp_attach_audio');
    const clearBtn = $('sp_clear_image');

    const hasAudio = !!principalAudioData;
    const hasFile = !!principalFileData;
    const hasImage = !!principalImageData;

    if (hint) {
      if (hasAudio) {
        const dur = (typeof principalAudioDuration === 'number' && principalAudioDuration > 0) ? ` (${principalAudioDuration}s)` : '';
        const name = principalAudioName ? ` — ${principalAudioName}` : '';
        hint.textContent = `✅ Áudio anexado${dur}${name}`;
      } else if (hasFile) {
        const name = principalFileName ? ` — ${principalFileName}` : '';
        hint.textContent = `✅ Arquivo anexado${name}`;
      } else if (hasImage) {
        hint.textContent = '✅ Imagem anexada e pronta para envio';
      } else {
        hint.textContent = '';
      }
    }

    // Botões e limpar (um único botão "Remover" limpa qualquer anexo)
    if (clearBtn) clearBtn.style.display = (hasAudio || hasFile || hasImage) ? '' : 'none';

    if (imgBtn) imgBtn.textContent = hasImage ? '📎 Trocar imagem' : '📎 Anexar imagem';
    if (fileBtn) fileBtn.textContent = hasFile ? '📁 Trocar arquivo' : '📁 Anexar Arquivo';
    if (audioBtn) audioBtn.textContent = hasAudio ? '🎤 Trocar Áudio' : '🎤 Anexar Áudio';



    // Preview
    principalUpdatePreview(st);

    // Stats
    const queue = Array.isArray(st.queue) ? st.queue : [];
    const sent = queue.filter(c => c.status === 'sent').length;
    const failed = queue.filter(c => c.status === 'failed').length;
    const pending = queue.filter(c => ['pending','opened','confirming','pending_retry'].includes(c.status)).length;

    $('sp_stat_sent').textContent = sent;
    $('sp_stat_failed').textContent = failed;
    $('sp_stat_pending').textContent = pending;

    // Progress
    const total = queue.length;
    const completed = sent + failed;
    const perc = total > 0 ? Math.round((completed / total) * 100) : 0;
    $('sp_progress_fill').style.width = `${perc}%`;
    $('sp_progress_text').textContent = `${perc}% (${completed}/${total})`;

    // Estimated time (quando rodando)
    const estEl = $('sp_estimated_time');
    if (estEl && st.isRunning && pending > 0) {
      const avgDelay = ((Number(st.delayMin) || 0) + (Number(st.delayMax) || 0)) / 2;
      const estimatedSeconds = pending * avgDelay;
      const estimatedMinutes = Math.ceil(estimatedSeconds / 60);
      if (estimatedMinutes > 60) {
        const hours = Math.floor(estimatedMinutes / 60);
        const mins = estimatedMinutes % 60;
        estEl.textContent = `⏱️ Tempo estimado: ${hours}h ${mins}min`;
      } else {
        estEl.textContent = `⏱️ Tempo estimado: ${estimatedMinutes} min`;
      }
    } else if (estEl) {
      estEl.textContent = '';
    }

    // Campaign status
    const statusEl = $('sp_campaign_status');
    const pauseBtn = $('sp_pause');
    const startBtn = $('sp_start');
    
    if (statusEl) {
      if (st.isRunning && !st.isPaused) statusEl.textContent = '✅ Enviando...';
      else if (st.isPaused) statusEl.textContent = '⏸️ Pausado';
      else statusEl.textContent = '⏹️ Parado';
    }
    
    // Atualizar texto do botão de pausa baseado no estado
    if (pauseBtn) {
      if (st.isPaused) {
        pauseBtn.textContent = '▶️ Continuar';
      } else {
        pauseBtn.textContent = '⏸️ Pausar';
      }
    }
    
    // Atualizar estado do botão iniciar
    if (startBtn) {
      startBtn.disabled = st.isRunning && !st.isPaused;
    }

    // Queue meta
    const meta = $('sp_queue_meta');
    if (meta) meta.textContent = `${total} contato(s) • posição: ${Math.min((st.index||0)+1, Math.max(1,total))}/${Math.max(1,total)}`;

    // Queue table
    renderQueueTable(queue, st.index || 0);
  }

  function renderQueueTable(queue, currentIndex) {
    const tbody = $('sp_queue_table');
    if (!tbody) return;

    const total = queue.length;
    const limit = total > MAX_QUEUE_RENDER ? MAX_QUEUE_RENDER : total;

    const rows = [];
    for (let i = 0; i < limit; i++) {
      const c = queue[i];
      const phone = escapeHtml(c.phone || '');
      const status = String(c.status || 'pending');
      const pillClass =
        status === 'sent' ? 'sent' :
        status === 'failed' ? 'failed' :
        (c.valid === false ? 'invalid' : 'pending');

      rows.push(`
        <tr class="${i === currentIndex ? 'current' : ''}">
          <td>${i+1}</td>
          <td style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${phone}</td>
          <td><span class="sp-pill ${pillClass}">${escapeHtml(status)}</span></td>
          <td><button class="sp-btn sp-btn-danger" data-del="${i}" style="padding:6px 8px">✖</button></td>
        </tr>
      `);
    }

    if (total > MAX_QUEUE_RENDER) {
      rows.push(`
        <tr>
          <td colspan="4" style="opacity:.75">
            Mostrando ${MAX_QUEUE_RENDER} de ${total} (para performance).
          </td>
        </tr>
      `);
    }

    tbody.innerHTML = rows.join('');

    // delete buttons
    tbody.querySelectorAll('button[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.getAttribute('data-del'));
        if (!Number.isFinite(idx)) return;
        if (!confirm(`Remover o item #${idx+1} da fila?`)) return;
        try {
          await motor('DELETE_QUEUE_ITEM', { index: idx });
          await principalRefresh(true);
        } catch (e) {
          $('sp_campaign_status').textContent = `❌ ${e.message || e}`;
        }
      });
    });
  }

  // ========= Extrator =========
  let extratorBound = false;

  function extratorInit() {
    if (extratorBound) return;
    extratorBound = true;

    $('sp_extract_contacts')?.addEventListener('click', extratorExtract);
    $('sp_refresh_extract')?.addEventListener('click', extratorRefresh);

    $('sp_copy_extract_all')?.addEventListener('click', async () => {
      const all = joinNonEmptyLines(
        $('sp_normal_list')?.value,
        $('sp_archived_list')?.value,
        $('sp_blocked_list')?.value,
      );
      const ok = await copyToClipboard(all);
      $('sp_extract_status').textContent = ok ? '✅ Copiado: Todos' : '⚠️ Nada para copiar.';
    });

    $('sp_copy_normal')?.addEventListener('click', async () => {
      const ok = await copyToClipboard($('sp_normal_list')?.value || '');
      $('sp_extract_status').textContent = ok ? '✅ Copiado: Normais' : '⚠️ Nada para copiar.';
    });

    $('sp_copy_archived')?.addEventListener('click', async () => {
      const ok = await copyToClipboard($('sp_archived_list')?.value || '');
      $('sp_extract_status').textContent = ok ? '✅ Copiado: Arquivados' : '⚠️ Nada para copiar.';
    });

    $('sp_copy_blocked')?.addEventListener('click', async () => {
      const ok = await copyToClipboard($('sp_blocked_list')?.value || '');
      $('sp_extract_status').textContent = ok ? '✅ Copiado: Bloqueados' : '⚠️ Nada para copiar.';
    });
  }

  async function extratorExtract() {
    const status = $('sp_extract_status');
    if (status) status.textContent = '⏳ Extraindo...';

    try {
      const resp = await motor('EXTRACT_CONTACTS');
      const lists = resp?.lists || resp?.data;
      if (lists) renderExtractLists(lists);
      if (status) status.textContent = resp?.message || '✅ Extraído.';
    } catch (e) {
      if (status) status.textContent = `❌ ${e.message || e}`;
    }
  }

  async function extratorRefresh() {
    const status = $('sp_extract_status');
    if (status) status.textContent = '🔄 Atualizando...';

    try {
      const resp = await motor('GET_EXTRACTED_CONTACTS');
      if (resp?.lists || resp?.data) renderExtractLists(resp.lists || resp.data);
      if (status) status.textContent = '✅ Atualizado.';
    } catch (e) {
      if (status) status.textContent = `❌ ${e.message || e}`;
    }
  }

  function renderExtractLists(lists) {
  const norm = Array.isArray(lists?.normal)
    ? lists.normal
    : String(lists?.normal || '').split(/\n+/).map(s => s.trim()).filter(Boolean);

  const arch = Array.isArray(lists?.archived)
    ? lists.archived
    : String(lists?.archived || '').split(/\n+/).map(s => s.trim()).filter(Boolean);

  const block = Array.isArray(lists?.blocked)
    ? lists.blocked
    : String(lists?.blocked || '').split(/\n+/).map(s => s.trim()).filter(Boolean);

  $('sp_normal_list').value = norm.join('\n');
  $('sp_archived_list').value = arch.join('\n');
  $('sp_blocked_list').value = block.join('\n');

  const cNorm = (lists?.counts && typeof lists.counts.normal === 'number') ? lists.counts.normal : norm.length;
  const cArch = (lists?.counts && typeof lists.counts.archived === 'number') ? lists.counts.archived : arch.length;
  const cBlock = (lists?.counts && typeof lists.counts.blocked === 'number') ? lists.counts.blocked : block.length;

  $('sp_count_normal').textContent = cNorm;
  $('sp_count_archived').textContent = cArch;
  $('sp_count_blocked').textContent = cBlock;
}

  // ========= Recover =========
  let recoverBound = false;

  function recoverInit() {
    if (recoverBound) return;
    recoverBound = true;

    // BUG 5: Refresh button with RecoverAdvanced.refreshMessages()
    $('sp_refresh_recover')?.addEventListener('click', async () => {
      const refreshBtn = $('sp_refresh_recover');
      const listContainer = $('sp_recover_timeline');
      const st = $('sp_recover_status');
      if (!refreshBtn) return;
      
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '🔄 Atualizando...';
      if (listContainer) listContainer.style.opacity = '0.5';
      if (st) st.textContent = '🔄 Atualizando dados...';
      
      try {
        // Use the new RecoverAdvanced.refreshMessages() API
        const result = await window.RecoverAdvanced.refreshMessages();
        
        if (result.success) {
          // Re-render timeline
          renderRecoverTimeline();
          
          const message = result.newCount > 0 
            ? `✅ ${result.newCount} novas mensagens!` 
            : '✅ Nenhuma nova mensagem';
          
          refreshBtn.innerHTML = message;
          if (st) st.textContent = message;
          showToast(message, 'success');
        } else {
          throw new Error(result.error || 'Falha ao atualizar');
        }
      } catch (error) {
        refreshBtn.innerHTML = '❌ Erro';
        const errorMsg = `❌ Erro ao atualizar: ${error.message || error}`;
        if (st) st.textContent = errorMsg;
        showToast('❌ Erro ao atualizar', 'error');
        console.error('[Recover] Erro ao atualizar:', error);
      } finally {
        if (listContainer) listContainer.style.opacity = '1';
        setTimeout(() => {
          refreshBtn.disabled = false;
          refreshBtn.innerHTML = '🔄 Atualizar';
        }, 2000);
      }
    });

    $('sp_clear_recover')?.addEventListener('click', async () => {
      if (!confirm('Limpar histórico de recover?')) return;
      const st = $('sp_recover_status');
      if (st) st.textContent = '⏳ Limpando...';
      try {
        await motor('CLEAR_RECOVER_HISTORY');
        await recoverRefresh(true);
      } catch (e) {
        if (st) st.textContent = `❌ ${e.message || e}`;
      }
    });

    $('sp_download_all_recover')?.addEventListener('click', downloadAllRecover);
    
    // FASE 4: Snapshot button
    $('recover_snapshot')?.addEventListener('click', async () => {
      const btn = $('recover_snapshot');
      const st = $('sp_recover_status');
      if (!btn || !st) return;
      
      btn.disabled = true;
      btn.textContent = '⏳ Capturando...';
      st.textContent = '📸 Capturando snapshot inicial...';
      
      try {
        const result = await sendToActiveTab({ action: 'performSnapshot' });
        if (result?.success) {
          st.textContent = `✅ Snapshot: ${result.totalMessages} msgs de ${result.totalChats} chats`;
          await recoverRefresh(true);
        } else {
          throw new Error(result?.error || 'Falha no snapshot');
        }
      } catch (e) {
        st.textContent = `❌ ${e.message || e}`;
      } finally {
        btn.disabled = false;
        btn.textContent = '📸 Snapshot';
      }
    });
    
    // BUG 7: Deep Scan with RecoverAdvanced.executeDeepScan() via sendToActiveTab
    $('recover_deep_scan')?.addEventListener('click', async () => {
      const deepScanBtn = $('recover_deep_scan');
      const st = $('sp_recover_status');
      if (!deepScanBtn || !st) return;

      if (!confirm('🔬 Deep Scan pode levar vários minutos.\n\nIsso vai carregar mensagens antigas de todos os chats.\n\nContinuar?')) {
        return;
      }

      deepScanBtn.disabled = true;
      deepScanBtn.innerHTML = '🔍 Escaneando...';
      st.textContent = '🔬 Executando Deep Scan (isso pode demorar)...';

      try {
        const result = await sendToActiveTab({ action: 'performDeepScan' });

        if (result?.success) {
          showToast(`✅ DeepScan completo! ${result.found} mensagens`, 'success');
          await recoverRefresh(true);
          st.textContent = `✅ Deep Scan: ${result.found} mensagens encontradas`;
        } else {
          throw new Error(result?.error || 'Falha no DeepScan');
        }
      } catch (error) {
        showToast('❌ Erro: ' + error.message, 'error');
        st.textContent = `❌ Erro: ${error.message || error}`;
        console.error('[Recover] DeepScan error:', error);
      } finally {
        deepScanBtn.disabled = false;
        deepScanBtn.innerHTML = '🔍 DeepScan';
      }
    });
    
    // BUG 6: SYNC button with RecoverAdvanced.checkBackendConnection()
    // Initial update and periodic check (with reference for cleanup)
    updateRecoverSyncButton();
    if (recoverSyncInterval) clearInterval(recoverSyncInterval);
    recoverSyncInterval = setInterval(updateRecoverSyncButton, 30000); // Every 30 seconds

    // PrivacyShield: Inicializar controles de privacidade
    privacyShieldInit();
    viewOncePanelInit();
  }

  // ============================================================
  // 🛡️ PRIVACY SHIELD UI
  // ============================================================

  function makeSwitchStyle(checked) {
    return checked
      ? 'position:absolute;cursor:pointer;inset:0;background:#00a884;border-radius:22px;transition:.3s;'
      : 'position:absolute;cursor:pointer;inset:0;background:#ccc;border-radius:22px;transition:.3s;';
  }

  function updateSlider(sliderId, checked) {
    const slider = document.getElementById(sliderId);
    if (slider) slider.style.background = checked ? '#00a884' : '#ccc';
  }

  function sendToTab(msg) {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]?.id) return resolve(null);
        chrome.tabs.sendMessage(tabs[0].id, msg, (r) => resolve(r));
      });
    });
  }

  function privacyShieldInit() {
    // Carregar estado inicial do localStorage da tab ativa
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return;
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => ({
          hideOnline: localStorage.getItem('whl_privacy_hide_online') === 'true',
          hideTyping: localStorage.getItem('whl_privacy_hide_typing') === 'true',
          statusDl: localStorage.getItem('whl_status_download_enabled') !== 'false',
          viewOnce: localStorage.getItem('whl_view_once_saver_enabled') !== 'false'
        })
      }, (results) => {
        const s = results?.[0]?.result || {};
        const onlineChk = document.getElementById('whl_toggle_hide_online');
        const typingChk = document.getElementById('whl_toggle_hide_typing');
        const statusDlChk = document.getElementById('whl_toggle_status_dl');
        const viewOnceChk = document.getElementById('whl_toggle_view_once');

        if (onlineChk) { onlineChk.checked = !!s.hideOnline; updateSlider('whl_toggle_hide_online_slider', !!s.hideOnline); }
        if (typingChk) { typingChk.checked = !!s.hideTyping; updateSlider('whl_toggle_hide_typing_slider', !!s.hideTyping); }
        if (statusDlChk) { statusDlChk.checked = s.statusDl !== false; updateSlider('whl_toggle_status_dl_slider', s.statusDl !== false); }
        if (viewOnceChk) { viewOnceChk.checked = s.viewOnce !== false; updateSlider('whl_toggle_view_once_slider', s.viewOnce !== false); }
      });
    });

    // Bind: Ocultar Online
    document.getElementById('whl_toggle_hide_online')?.addEventListener('change', function () {
      updateSlider('whl_toggle_hide_online_slider', this.checked);
      sendToTab({ action: 'whlPrivacySetOnline', hide: this.checked });
      showToast(this.checked ? '🟢 Status online oculto' : '🟢 Status online visível', 'info');
    });

    // Bind: Ocultar Typing
    document.getElementById('whl_toggle_hide_typing')?.addEventListener('change', function () {
      updateSlider('whl_toggle_hide_typing_slider', this.checked);
      sendToTab({ action: 'whlPrivacySetTyping', hide: this.checked });
      showToast(this.checked ? '⌨️ "Digitando" ocultado' : '⌨️ "Digitando" visível', 'info');
    });

    // Bind: Download Status
    document.getElementById('whl_toggle_status_dl')?.addEventListener('change', function () {
      updateSlider('whl_toggle_status_dl_slider', this.checked);
      sendToTab({ action: 'whlStatusDownloadSet', enabled: this.checked });
      showToast(this.checked ? '📥 Download de status ativado' : '📥 Download de status desativado', 'info');
    });

    // Bind: View Once Saver
    document.getElementById('whl_toggle_view_once')?.addEventListener('change', function () {
      updateSlider('whl_toggle_view_once_slider', this.checked);
      sendToTab({ action: 'whlViewOnceSet', enabled: this.checked });
      const card = document.getElementById('whl_view_once_card');
      if (card) card.style.display = this.checked ? '' : 'none';
      if (this.checked) loadViewOnceSaved();
      showToast(this.checked ? '👁️ Salvar "ver uma vez" ativado' : '👁️ Salvar "ver uma vez" desativado', 'info');
    });
  }

  // ============================================================
  // 👁️ VIEW ONCE PANEL UI
  // ============================================================

  async function loadViewOnceSaved() {
    const list = document.getElementById('whl_view_once_list');
    if (!list) return;
    list.innerHTML = '<div style="color:var(--mod-text-muted);font-size:11px">⏳ Carregando...</div>';

    try {
      const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
      if (!tabs[0]?.id) throw new Error('Aba não encontrada');

      const results = await new Promise(r => chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          if (!window.WHL_ViewOnceSaver) return [];
          return window.WHL_ViewOnceSaver.getSaved();
        }
      }, r));

      const records = results?.[0]?.result || [];

      if (records.length === 0) {
        list.innerHTML = '<div style="color:var(--mod-text-muted);font-size:11px;padding:8px 0">Nenhuma mídia "ver uma vez" salva ainda.</div>';
        return;
      }

      list.innerHTML = records.map(r => {
        const date = new Date(r.timestamp).toLocaleString('pt-BR');
        const mediaHtml = r.dataUri
          ? (r.type === 'video'
            ? `<video src="${r.dataUri}" style="width:80px;height:60px;object-fit:cover;border-radius:6px;cursor:pointer" onclick="this.play()" controls></video>`
            : `<img src="${r.dataUri}" style="width:80px;height:60px;object-fit:cover;border-radius:6px" alt="view once">`)
          : r.thumbnailBase64
            ? `<img src="data:image/jpeg;base64,${r.thumbnailBase64}" style="width:80px;height:60px;object-fit:cover;border-radius:6px;opacity:0.6" alt="thumb">`
            : `<div style="width:80px;height:60px;background:rgba(0,0,0,0.2);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:24px">${r.type === 'video' ? '🎬' : r.type === 'audio' ? '🎵' : '🖼️'}</div>`;

        const downloadBtn = r.dataUri
          ? `<a href="${r.dataUri}" download="viewonce_${r.id}.${r.mediaExt || 'jpg'}" style="font-size:10px;color:#00a884;text-decoration:none">💾 Baixar</a>`
          : '';

        return `
          <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
            <div style="flex-shrink:0">${mediaHtml}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:11px;font-weight:600;color:var(--mod-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">De: ${r.from?.replace('@s.whatsapp.net','').replace('@c.us','') || '?'}</div>
              <div style="font-size:10px;color:var(--mod-text-muted);margin-top:2px">${date}</div>
              ${r.caption ? `<div style="font-size:10px;color:var(--mod-text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.caption}</div>` : ''}
              <div style="margin-top:6px">${downloadBtn}</div>
            </div>
          </div>`;
      }).join('');

    } catch (e) {
      // v9.4.4: escapeHtml em e.message — se erro vier de response do server,
      // pode conter HTML/script. Defesa em profundidade.
      list.innerHTML = `<div style="color:#ef4444;font-size:11px">❌ Erro ao carregar: ${escapeHtml(e.message || String(e))}</div>`;
    }
  }

  function viewOncePanelInit() {
    document.getElementById('whl_view_once_refresh')?.addEventListener('click', loadViewOnceSaved);

    // Mostrar painel se view once estiver ativo
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return;
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => localStorage.getItem('whl_view_once_saver_enabled') !== 'false'
      }, (results) => {
        const active = results?.[0]?.result;
        const card = document.getElementById('whl_view_once_card');
        if (card) card.style.display = active ? '' : 'none';
        if (active) loadViewOnceSaved();
      });
    });
  }

  // ============================================================
  // 🔰 SAPL — System Auto-Protection Layer UI
  // ============================================================

  let saplBound = false;

  function saplInit() {
    if (saplBound) return;
    saplBound = true;

    // Botão Self-Test
    $('sapl_btn_self_test')?.addEventListener('click', async () => {
      const btn = $('sapl_btn_self_test');
      const status = $('sapl_action_status');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Testando...'; }
      if (status) status.textContent = 'Executando self-test...';

      await saplExecInTab('forceFullCheck');
      await new Promise(r => setTimeout(r, 1200));
      await saplRefresh();

      if (btn) { btn.disabled = false; btn.textContent = '🔬 Self-Test'; }
      if (status) status.textContent = 'Self-test concluído em ' + new Date().toLocaleTimeString('pt-BR');
    });

    // Botão Auto-Heal
    $('sapl_btn_heal')?.addEventListener('click', async () => {
      const btn = $('sapl_btn_heal');
      const status = $('sapl_action_status');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Curando...'; }
      if (status) status.textContent = 'Auto-heal em andamento...';

      const result = await saplExecInTab('heal');
      await new Promise(r => setTimeout(r, 1500));
      await saplRefresh();

      const healed = result?.healed?.length || 0;
      const failed = result?.failed?.length || 0;
      if (btn) { btn.disabled = false; btn.textContent = '🔧 Auto-Heal'; }
      if (status) status.textContent = `Heal: ${healed} corrigidos, ${failed} falhos — ${new Date().toLocaleTimeString('pt-BR')}`;
    });

    // Botão Refresh
    $('sapl_btn_refresh')?.addEventListener('click', () => saplRefresh());

    // Botão Limpar Erros
    $('sapl_clear_errors')?.addEventListener('click', async () => {
      await saplExecInTab('clearErrors');
      await saplRefresh();
    });

    // Escutar updates em tempo real do SAPL (self-test automático)
    window.addEventListener('message', (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'WHL_SAPL_SELF_TEST') {
        saplRenderStatus(e.data.report);
      }
      if (e.data?.type === 'WHL_SAPL_ALERT') {
        const status = $('sapl_action_status');
        if (status) {
          const icons = { critical: '🚨', warning: '⚠️', info: 'ℹ️' };
          status.textContent = (icons[e.data.severity] || '') + ' ' + e.data.message;
          status.style.color = e.data.severity === 'critical' ? '#ef4444' : '#f59e0b';
        }
      }
    });
  }

  async function saplExecInTab(methodName, ...args) {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]?.id) return resolve(null);
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: (method, methodArgs) => {
            if (!window.SAPL || typeof window.SAPL[method] !== 'function') return null;
            try {
              const result = window.SAPL[method](...methodArgs);
              return result instanceof Promise ? result : Promise.resolve(result);
            } catch (e) {
              return null;
            }
          },
          args: [methodName, args]
        }, (results) => resolve(results?.[0]?.result ?? null));
      });
    });
  }

  async function saplRefresh() {
    const fullStatus = await saplExecInTab('getFullStatus');
    if (!fullStatus) {
      const status = $('sapl_action_status');
      if (status) status.textContent = '⚠️ SAPL não disponível na aba atual.';
      return;
    }

    saplRenderFullStatus(fullStatus);

    // Renderizar erros capturados
    const errors = await saplExecInTab('getCaughtErrors');
    saplRenderErrors(errors || []);

    // Renderizar histórico
    const history = await saplExecInTab('getSelfTestHistory');
    saplRenderHistory(history || []);
  }

  function saplRenderFullStatus(s) {
    if (!s) return;

    // Uptime
    const uptime = $('sapl_uptime');
    if (uptime && s.uptime) {
      const secs = Math.floor(s.uptime / 1000);
      const mins = Math.floor(secs / 60);
      const hrs  = Math.floor(mins / 60);
      uptime.textContent = hrs > 0
        ? `Uptime: ${hrs}h ${mins % 60}m`
        : mins > 0
          ? `Uptime: ${mins}m ${secs % 60}s`
          : `Uptime: ${secs}s`;
    }

    // Overall badge (usa lastSelfTest se disponível)
    const overall = s.lastSelfTest?.overall || 'unknown';
    saplSetOverallBadge(overall);

    // Hooks
    saplRenderHooks(s.hooks, s.hookReinitCount || 0);

    // Circuits
    saplRenderCircuits(s.circuits || {});

    // Sentinel
    const bundleHash = $('sapl_bundle_hash');
    const bundleChanged = $('sapl_bundle_changed');
    const rescans = $('sapl_rescans');
    if (bundleHash) bundleHash.textContent = s.bundleHash ? s.bundleHash.substring(0, 10) + '…' : '—';
    if (bundleChanged) bundleChanged.textContent = s.bundleChangedAt
      ? new Date(s.bundleChangedAt).toLocaleTimeString('pt-BR')
      : 'Nenhum';
    if (rescans) rescans.textContent = s.selectorRescans || 0;

    // Reinit count
    const reinit = $('sapl_reinit_count');
    if (reinit) reinit.textContent = s.hookReinitCount || 0;

    // Módulos (do lastSelfTest)
    if (s.lastSelfTest?.modules) {
      saplRenderModules(s.lastSelfTest.modules);
    }
  }

  function saplRenderStatus(report) {
    // Chamado em tempo real pelo postMessage
    if (!report) return;
    saplSetOverallBadge(report.overall);
    if (report.modules) saplRenderModules(report.modules);
    if (report.hooks) saplRenderHooks(report.hooks, 0);
    if (report.circuits) saplRenderCircuits(report.circuits);
  }

  function saplSetOverallBadge(overall) {
    const badge = $('sapl_overall_badge');
    if (!badge) return;
    const cfg = {
      healthy:  { bg: '#22c55e20', color: '#22c55e', label: '● HEALTHY' },
      degraded: { bg: '#f59e0b20', color: '#f59e0b', label: '● DEGRADED' },
      critical: { bg: '#ef444420', color: '#ef4444', label: '● CRITICAL' },
      unknown:  { bg: '#64748b20', color: '#94a3b8', label: '● UNKNOWN' },
    };
    const c = cfg[overall] || cfg.unknown;
    badge.style.background = c.bg;
    badge.style.color = c.color;
    badge.textContent = c.label;
  }

  function saplRenderHooks(hooks, reinitCount) {
    const list = $('sapl_hooks_list');
    if (!list || !hooks) return;

    const labels = {
      renderableMessages: 'Mensagens renderizáveis',
      editMessages:       'Mensagens editadas',
      messageCreated:     'Mensagens criadas',
      statusUpdates:      'Atualizações de status',
    };

    list.innerHTML = Object.entries(hooks).map(([key, alive]) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border-radius:6px;background:${alive ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.1)'}">
        <span style="font-size:11px;color:var(--mod-text)">${labels[key] || key}</span>
        <span style="font-size:10px;font-weight:600;color:${alive ? '#22c55e' : '#ef4444'}">${alive ? '✅ Ativo' : '❌ Perdido'}</span>
      </div>`).join('');

    const reinit = $('sapl_reinit_count');
    if (reinit) reinit.textContent = reinitCount;
  }

  function saplRenderCircuits(circuits) {
    const list = $('sapl_circuits_list');
    if (!list) return;

    const entries = Object.entries(circuits);
    if (entries.length === 0) {
      list.innerHTML = '<div style="font-size:10px;color:var(--mod-text-muted)">Nenhum circuit ativo ainda.</div>';
      return;
    }

    const stateColor = { CLOSED: '#22c55e', OPEN: '#ef4444', HALF_OPEN: '#f59e0b' };
    const stateLabel = { CLOSED: 'Fechado ✅', OPEN: 'Aberto 🔴', HALF_OPEN: 'Testando ⚠️' };

    list.innerHTML = entries.map(([id, cb]) => `
      <div style="padding:6px 8px;border-radius:6px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07)">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:11px;font-weight:500;color:var(--mod-text)">${id}</span>
          <span style="font-size:10px;font-weight:600;color:${stateColor[cb.state] || '#94a3b8'}">${stateLabel[cb.state] || cb.state}</span>
        </div>
        <div style="display:flex;gap:12px;margin-top:3px">
          <span style="font-size:10px;color:var(--mod-text-muted)">Falhas: <b style="color:var(--mod-text)">${cb.failures || 0}</b></span>
          <span style="font-size:10px;color:var(--mod-text-muted)">Trips: <b style="color:var(--mod-text)">${cb.trips || 0}</b></span>
        </div>
      </div>`).join('');
  }

  function saplRenderModules(modules) {
    const list = $('sapl_modules_list');
    if (!list || !modules) return;

    const labels = {
      whl_hooks:       '🪝 WPP Hooks',
      recover:         '🔄 Recover',
      privacy_shield:  '🛡️ Privacy Shield',
      status_download: '📥 Status Download',
      view_once_saver: '👁️ View Once Saver',
    };

    list.innerHTML = Object.entries(modules).map(([id, result]) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border-radius:6px;background:${result.ok ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.08)'}">
        <span style="font-size:11px;color:var(--mod-text)">${labels[id] || id}</span>
        <span style="font-size:10px;font-weight:600;color:${result.ok ? '#22c55e' : '#ef4444'}">
          ${result.ok ? '✅ OK' : `❌ ${result.reason || 'Falha'}`}
        </span>
      </div>`).join('');
  }

  function saplRenderErrors(errors) {
    const list = $('sapl_errors_list');
    if (!list) return;

    if (errors.length === 0) {
      list.innerHTML = '<div style="font-size:10px;color:var(--mod-text-muted)">Nenhum erro capturado. ✅</div>';
      return;
    }

    list.innerHTML = errors.slice(-20).reverse().map(e => {
      const time = new Date(e.ts).toLocaleTimeString('pt-BR');
      return `
        <div style="padding:5px 7px;border-radius:5px;background:rgba(239,68,68,0.08);border-left:2px solid #ef4444">
          <div style="font-size:9px;color:#94a3b8;margin-bottom:2px">${time} — <b>${e.source}</b></div>
          <div style="font-size:10px;color:#fca5a5;word-break:break-word">${e.message}</div>
        </div>`;
    }).join('');
  }

  function saplRenderHistory(history) {
    const list = $('sapl_history_list');
    if (!list) return;

    if (history.length === 0) {
      list.innerHTML = '<div style="font-size:10px;color:var(--mod-text-muted)">Sem histórico ainda.</div>';
      return;
    }

    const colors = { healthy: '#22c55e', degraded: '#f59e0b', critical: '#ef4444' };
    list.innerHTML = history.slice(-20).map(h => {
      const time = new Date(h.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return `<div title="${time}: ${h.overall}" style="width:14px;height:14px;border-radius:3px;background:${colors[h.overall] || '#64748b'};cursor:default"></div>`;
    }).join('');
  }
  
  // Helper function for SYNC button text
  function getReasonText(reason) {
    const texts = {
      'no_token': 'Não autenticado - faça login',
      'connection_failed': 'Não foi possível conectar',
      'error': 'Erro de conexão'
    };
    return texts[reason] || 'Desconectado';
  }
  
  // BUG 6: Update SYNC button based on connection status
  async function updateRecoverSyncButton() {
    const syncBtn = $('recover_sync_backend');
    if (!syncBtn) return;

    try {
      const status = await window.RecoverAdvanced.checkBackendConnection();

      // ⚠️ Se backend está desabilitado, ocultar botão completamente
      if (status.disabled) {
        syncBtn.style.display = 'none';
        return;
      }

      if (status.connected) {
        syncBtn.style.display = '';
        syncBtn.innerHTML = '☁️ Sincronizar';
        syncBtn.disabled = false;
        syncBtn.title = `Conectado${status.user ? ' como ' + status.user.name : ''}`;
        syncBtn.style.opacity = '1';

        // Set up click handler for sync
        syncBtn.onclick = async () => {
          syncBtn.innerHTML = '⏳ Sincronizando...';
          syncBtn.disabled = true;

          try {
            const result = await window.RecoverAdvanced.syncWithBackend();
            if (result) {
              showToast('✅ Sincronização completa!', 'success');
              renderRecoverTimeline();
            }
          } catch (e) {
            showToast('❌ Erro na sincronização', 'error');
            console.error('[Recover] Erro na sincronização:', e);
          } finally {
            setTimeout(() => updateRecoverSyncButton(), 1000);
          }
        };
      } else {
        // ✅ Pedido: remover botão quando backend estiver offline
        // (evita exibir o botão "Backend Offline" / "Depend Offline")
        syncBtn.style.display = 'none';
        syncBtn.onclick = null;
      }
    } catch (e) {
      console.error('[Recover] SYNC check failed:', e);
      syncBtn.innerHTML = '❌ Erro';
      syncBtn.disabled = true;
    }
  }

  // Função para baixar todos os recovers como CSV
  async function downloadAllRecover() {
    try {
      const resp = await motor('GET_RECOVER_HISTORY');
      const history = resp?.history || [];
      
      if (history.length === 0) {
        $('sp_recover_status').textContent = '⚠️ Nenhuma mensagem para baixar';
        return;
      }
      
      // Criar CSV
      const headers = ['Número', 'Mensagem', 'Tipo', 'Data', 'Hora'];
      const rows = history.map(h => {
        const ts = new Date(h?.timestamp || Date.now());
        const from = normalizeFromId(h?.from || h?.chat || '', h);
        const body = String(h?.body || h?.message || h?.text || '').replace(/"/g, '""');
        const type = h?.type === 'deleted' ? 'Apagada' : (h?.type === 'edited' ? 'Editada' : 'Outro');
        return [
          `"${from}"`,
          `"${body}"`,
          `"${type}"`,
          `"${ts.toLocaleDateString()}"`,
          `"${ts.toLocaleTimeString()}"`
        ].join(',');
      });
      
      const csv = [headers.join(','), ...rows].join('\n');
      const BOM = '\uFEFF';
      const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mensagens_recuperadas_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      
      $('sp_recover_status').textContent = `✅ ${history.length} mensagens exportadas`;
    } catch (e) {
      $('sp_recover_status').textContent = `❌ ${e.message || e}`;
    }
  }

  


  // ========= RECOVER - REFRESH COMPLETO v7.5.0 =========
  async function recoverRefresh(verbose = true) {
    if (verbose) $('sp_recover_status').textContent = '🔄 Atualizando...';
    
    let history = [];
    
    try {
      // Inicializar RecoverAdvanced se necessário
      if (window.RecoverAdvanced?.init && !window.RecoverAdvanced._initialized) {
        await window.RecoverAdvanced.init();
        window.RecoverAdvanced._initialized = true;
      }
      
      // Usar RecoverAdvanced (suporta filtros)
      if (window.RecoverAdvanced?.getFilteredMessages) {
        history = window.RecoverAdvanced.getFilteredMessages();
        
        // Atualizar estatísticas
        const stats = window.RecoverAdvanced.getStats?.() || {};
        
        const statRevoked = $('stat_revoked');
        const statDeleted = $('stat_deleted');
        const statEdited = $('stat_edited');
        const statMedia = $('stat_media');
        const statFavorites = $('stat_favorites');
        const statViewOnce = $('stat_view_once');
        
        if (statRevoked) statRevoked.textContent = stats.revoked || 0;
        if (statDeleted) statDeleted.textContent = stats.deleted || 0;
        if (statEdited) statEdited.textContent = stats.edited || 0;
        if (statMedia) {
          const mediaCount = (stats.byType?.image || 0) + (stats.byType?.video || 0) + 
                            (stats.byType?.audio || 0) + (stats.byType?.sticker || 0) + 
                            (stats.byType?.document || 0);
          statMedia.textContent = mediaCount;
        }
        if (statFavorites) statFavorites.textContent = stats.favorites || 0;
        // View Once: contar via IndexedDB do módulo se disponível
        if (statViewOnce) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]?.id) return;
            chrome.scripting.executeScript({
              target: { tabId: tabs[0].id },
              func: () => window.WHL_ViewOnceSaver?.getSaved?.().then(r => r.length) ?? Promise.resolve(0)
            }, (results) => {
              statViewOnce.textContent = results?.[0]?.result || 0;
            });
          });
        }
        
        // Total
        const totalEl = $('sp_recover_total');
        if (totalEl) totalEl.textContent = stats.total || 0;
        
        // Popular seletor de chats
        const chatFilter = $('recover_chat_filter');
        if (chatFilter) {
          const grouped = window.RecoverAdvanced.getGroupedByChat?.() || [];
          const currentValue = chatFilter.value;
          chatFilter.innerHTML = '<option value="">Todos chats</option>' + 
            grouped.map(g => `<option value="${g.chat}">${g.chat} (${g.count})</option>`).join('');
          chatFilter.value = currentValue;
        }
        
        // Paginação
        const pageResult = window.RecoverAdvanced.getPage?.() || { page: 0, totalPages: 1 };
        const pageInfo = $('recover_page_info');
        if (pageInfo) pageInfo.textContent = `Página ${pageResult.page + 1} de ${pageResult.totalPages || 1}`;
        
      } else {
        // Fallback: motor tradicional
        const resp = await motor('GET_RECOVER_HISTORY');
        history = resp?.history || [];
        
        const totalEl = $('sp_recover_total');
        if (totalEl) totalEl.textContent = history.length;
      }
      
      renderRecoverTimeline(history);
      
      if (verbose) $('sp_recover_status').textContent = `✅ ${history.length} mensagens`;
    } catch (e) {
      console.error('[RecoverRefresh] Erro:', e);
      if (verbose) $('sp_recover_status').textContent = '❌ Erro ao atualizar';
    }
  }

  // ========= RECOVER - HELPER FUNCTIONS =========
  
  // BUG 2: Render persistent notification
  function renderPersistentNotification(notification) {
    if (!notification || !notification.persistent) return '';
    
    const icons = {
      'revoked': '🚫',
      'deleted': '🗑️',
      'edited': '✏️'
    };
    
    const colors = {
      'revoked': 'rgba(239,68,68,0.15)',
      'deleted': 'rgba(107,114,128,0.15)',
      'edited': 'rgba(59,130,246,0.15)'
    };
    
    const borders = {
      'revoked': '#ef4444',
      'deleted': '#6b7280',
      'edited': '#3b82f6'
    };
    
    const type = notification.type || 'deleted';
    
    return `
      <div class="recover-notification" style="
        background: ${colors[type]};
        border-left: 3px solid ${borders[type]};
        padding: 8px 12px;
        border-radius: 6px;
        margin-top: 8px;
        font-size: 12px;
      ">
        ${icons[type]} ${escapeHtml(notification.text || '')}
        <span style="opacity: 0.6; margin-left: 8px; font-size: 10px;">
          ${formatRecoverTime(notification.timestamp)}
        </span>
      </div>
    `;
  }
  
  // BUG 3: Render deletion type badge
  function renderDeletionTypeBadge(deletionType, deletionInfo) {
    if (!deletionType) return '';
    
    const badges = {
      'revoked_by_sender': {
        icon: '🚫',
        text: 'Apagada pelo remetente',
        bg: 'rgba(239,68,68,0.15)',
        border: '#ef4444',
        color: '#ef4444'
      },
      'deleted_locally': {
        icon: '🗑️',
        text: 'Excluída localmente',
        bg: 'rgba(107,114,128,0.15)',
        border: '#6b7280',
        color: '#6b7280'
      },
      'deleted_by_admin': {
        icon: '👮',
        text: 'Removida por admin',
        bg: 'rgba(245,158,11,0.15)',
        border: '#f59e0b',
        color: '#f59e0b'
      },
      'edited': {
        icon: '✏️',
        text: 'Editada',
        bg: 'rgba(59,130,246,0.15)',
        border: '#3b82f6',
        color: '#3b82f6'
      },
      'unknown': {
        icon: '❓',
        text: 'Deletada',
        bg: 'rgba(156,163,175,0.15)',
        border: '#9ca3af',
        color: '#9ca3af'
      }
    };
    
    const badge = badges[deletionType] || badges['unknown'];
    
    return `
      <div class="deletion-type-badge" style="
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: ${badge.bg};
        border-left: 3px solid ${badge.border};
        color: ${badge.color};
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 500;
        margin-right: 8px;
      ">
        <span>${badge.icon}</span>
        <span>${escapeHtml(badge.text)}</span>
        ${deletionInfo?.actor ? `<span style="opacity:0.6;margin-left:4px;">por ${escapeHtml(deletionInfo.actor.substring(0,8))}...</span>` : ''}
      </div>
    `;
  }
  
  // BUG 1: Handle media download with RecoverAdvanced.downloadRealMedia()
  async function handleMediaDownload(messageId, mediaType) {
    const downloadBtn = event.target;
    const originalText = downloadBtn.innerHTML;
    
    downloadBtn.disabled = true;
    downloadBtn.innerHTML = '⏳';
    
    try {
      const result = await window.RecoverAdvanced.downloadRealMedia(messageId, mediaType);
      
      if (result.success) {
        if (result.data) {
          // Create download link
          const link = document.createElement('a');
          link.href = `data:${getMediaMimeType(mediaType)};base64,${result.data}`;
          link.download = `recovered_${messageId}_${Date.now()}.${getExtension(mediaType)}`;
          link.click();
        }
        showToast('✅ Download iniciado!', 'success');
      } else {
        throw new Error(result.error || 'Download falhou');
      }
    } catch (error) {
      showToast('❌ Erro no download', 'error');
      console.error('[Recover] Download error:', error);
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.innerHTML = originalText;
    }
  }
  
  // Helper: Get media MIME type
  function getMediaMimeType(mediaType) {
    const mimes = {
      'image': 'image/jpeg',
      'video': 'video/mp4',
      'audio': 'audio/ogg',
      'ptt': 'audio/ogg',
      'document': 'application/octet-stream'
    };
    return mimes[mediaType] || 'application/octet-stream';
  }
  
  // Helper: Get file extension
  function getExtension(mediaType) {
    const exts = { 
      'image': 'jpg', 
      'video': 'mp4', 
      'audio': 'ogg', 
      'ptt': 'ogg', 
      'document': 'pdf' 
    };
    return exts[mediaType] || 'bin';
  }
  
  // Helper: Format time for recover notifications
  function formatRecoverTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Agora';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m atrás`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h atrás`;
    
    return date.toLocaleDateString('pt-BR', { 
      day: '2-digit', 
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }







  // ========= RECOVER - RENDER TIMELINE COMPLETO v7.5.1 - REFACTORED =========
  function renderRecoverTimeline(history) {
    const root = $('sp_recover_timeline');
    if (!root) return;

    const slice = (history || []).slice(-MAX_RECOVER_RENDER).reverse();
    
    // BUG FIX #7: ANTI-DUPLICAÇÃO - Usar Set para rastrear mensagens já renderizadas
    // CODE REVIEW FIX: Use named constants for magic numbers
    const DEDUP_BODY_LENGTH = 50; // Characters to use for deduplication key
    const DEDUP_TIME_WINDOW_MS = 5000; // 5 seconds time window for deduplication
    
    const renderedSet = new Set();
    const uniqueMessages = slice.filter(h => {
      // Criar chave única baseada em: from + to + body (truncado) + timestamp (arredondado)
      const key = `${h?.from || ''}_${h?.to || ''}_${(h?.body || '').substring(0, DEDUP_BODY_LENGTH)}_${Math.floor((h?.timestamp || 0) / DEDUP_TIME_WINDOW_MS)}`;
      
      if (renderedSet.has(key)) {
        return false; // Duplicata, ignorar
      }
      
      renderedSet.add(key);
      return true;
    });
    
    // Empty state
    if (uniqueMessages.length === 0) {
      root.innerHTML = '<div class="whl-empty">Nenhuma mensagem recuperada ainda.</div>';
      return;
    }
    
    // Helper: Detectar tipo base64
    const isBase64Image = (content) => {
      if (!content || typeof content !== 'string') return false;
      return content.startsWith('/9j/') || content.startsWith('iVBOR') || 
             content.startsWith('R0lGOD') || content.startsWith('UklGR') || 
             content.startsWith('data:image');
    };
    
    const toDataUrl = (content, mimetype) => {
      if (!content) return null;
      // CODE REVIEW FIX: Basic validation for media data
      if (typeof content !== 'string') return null;
      
      // Check size limit (max 10MB base64 string)
      const MAX_MEDIA_SIZE = 10 * 1024 * 1024;
      if (content.length > MAX_MEDIA_SIZE) {
        console.warn('[Recover] Media data too large:', content.length);
        return null;
      }
      
      if (content.startsWith('data:')) return content;
      if (content.startsWith('/9j/')) return `data:image/jpeg;base64,${content}`;
      if (content.startsWith('iVBOR')) return `data:image/png;base64,${content}`;
      if (content.startsWith('R0lGOD')) return `data:image/gif;base64,${content}`;
      if (content.startsWith('UklGR')) return `data:image/webp;base64,${content}`;
      if (mimetype) return `data:${mimetype};base64,${content}`;
      return null;
    };
    
    // Detectar tipo de mídia
    const detectMediaType = (h) => {
      if (h?.mediaType) return h.mediaType;
      if (h?.type === 'sticker' || h?.mimetype?.includes('webp')) return 'sticker';
      if (h?.type === 'image' || h?.mimetype?.includes('image')) return 'image';
      if (h?.type === 'video' || h?.mimetype?.includes('video')) return 'video';
      if (h?.type === 'audio' || h?.type === 'ptt' || h?.mimetype?.includes('audio') || h?.mimetype?.includes('ogg')) return 'audio';
      if (h?.type === 'document' || h?.mimetype?.includes('pdf') || h?.mimetype?.includes('document')) return 'document';
      return 'text';
    };
    
    // FIX #3: renderMediaPreview - Layout horizontal compacto
    const renderMediaPreview = (h, msgId) => {
      const mediaType = detectMediaType(h);
      const mediaData = h?.mediaData || h?.mediaBase64 || h?.media || null;
      
      if (mediaType === 'image' || mediaType === 'sticker') {
        const dataUrl = mediaData ? toDataUrl(mediaData, h?.mimetype) : null;
        if (dataUrl) {
          return `<img src="${dataUrl}" alt="Imagem" style="width:60px;height:60px;object-fit:cover;border-radius:6px;cursor:pointer" onclick="window.open(this.src)"/>`;
        }
        return `<div style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;background:rgba(139,92,246,0.2);border-radius:6px;">🖼️</div>`;
      }
      
      if (mediaType === 'audio' || mediaType === 'ptt') {
        if (mediaData && mediaData !== '__HAS_MEDIA__') {
          const audioUrl = toDataUrl(mediaData, h?.mimetype || 'audio/ogg');
          return `
            <div style="width:100%;max-width:200px;">
              <audio controls src="${audioUrl}" style="width:100%;height:32px;"></audio>
              <button class="recover-action-btn" data-action="transcribe" data-id="${escapeHtml(msgId)}" style="font-size:9px;margin-top:4px;padding:2px 6px;background:rgba(139,92,246,0.2);border:none;border-radius:4px;cursor:pointer;">
                🎤 Transcrever
              </button>
              <div id="transcription_${escapeHtml(msgId)}" style="font-size:10px;margin-top:4px;color:rgba(255,255,255,0.7);font-style:italic;display:none;"></div>
            </div>
          `;
        }
        return `<div style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;background:rgba(139,92,246,0.2);border-radius:6px;">🎵</div>`;
      }
      
      if (mediaType === 'video') {
        return `<div style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;background:rgba(59,130,246,0.2);border-radius:6px;">🎬</div>`;
      }
      
      if (mediaType === 'document') {
        const filename = h?.filename || 'documento';
        return `
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px;background:rgba(245,158,11,0.1);border-radius:8px;">
            <div style="font-size:24px;">📄</div>
            <div style="font-size:10px;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${escapeHtml(filename)}
            </div>
            <button class="recover-action-btn" data-action="download-media" data-id="${escapeHtml(msgId)}" style="font-size:9px;padding:2px 8px;background:rgba(245,158,11,0.3);border:none;border-radius:4px;cursor:pointer;">
              ⬇️ Baixar
            </button>
          </div>
        `;
      }
      
      if (mediaType === 'sticker') {
        return `<div style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;background:rgba(236,72,153,0.2);border-radius:6px;">🎭</div>`;
      }
      
      // Texto
      return `<div style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;background:rgba(0,168,132,0.2);border-radius:6px;">💬</div>`;
    };
    
    // Get badge text helper
    const getBadgeText = (action) => {
      const labels = {
        'revoked': 'Revogada',
        'deleted': 'Apagada',
        'edited': 'Editada'
      };
      return labels[action] || action;
    };
    
    // Format time helper
    const formatTime = (timestamp) => {
      if (!timestamp) return '';
      const ts = new Date(timestamp);
      const hh = String(ts.getHours()).padStart(2,'0');
      const mm = String(ts.getMinutes()).padStart(2,'0');
      const dateStr = ts.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      return `${dateStr} ${hh}:${mm}`;
    };
    
    // Render action buttons helper
    const renderActionButtons = (h, msgId) => {
      let buttons = '';
      
      const mediaType = detectMediaType(h);
      
      // ✅ Botão de download para qualquer item do histórico
      // - Mídia: tenta baixar o arquivo real do chat
      // - Texto: navega até a mensagem e faz download como .txt
      const isMedia = ['image', 'video', 'audio', 'ptt', 'document'].includes(mediaType);
      buttons += `<button class="recover-action-btn" data-action="download-media" data-id="${escapeHtml(msgId)}" title="${isMedia ? 'Baixar em tamanho real' : 'Abrir no chat e baixar'}" style="background:none;border:none;cursor:pointer;font-size:14px;">⬇️</button>`;
      
      // Botão copiar
      buttons += `<button class="recover-action-btn" data-action="copy" data-id="${escapeHtml(msgId)}" title="Copiar" style="background:none;border:none;cursor:pointer;font-size:14px;">📋</button>`;
      
      // Botão favoritar
      const isFav = window.RecoverAdvanced?.isFavorite?.(msgId) || false;
      buttons += `<button class="recover-fav-btn ${isFav ? 'active' : ''}" data-id="${escapeHtml(msgId)}" title="Favoritar" style="background:none;border:none;cursor:pointer;font-size:14px;">${isFav ? '⭐' : '☆'}</button>`;
      
      // Botão comparar (só para editadas)
      if (h?.action === 'edited' && h?.previousContent) {
        buttons += `<button class="recover-action-btn" data-action="compare" data-id="${escapeHtml(msgId)}" title="Comparar versões" style="background:none;border:none;cursor:pointer;font-size:14px;">📊</button>`;
      }
      
      return buttons;
    };

    // FIX #3: renderRecoverItem - Layout horizontal compacto
    root.innerHTML = uniqueMessages.map((h, idx) => {
      const action = h?.action || h?.type || 'unknown';
      const from = h?.from || 'Desconhecido';
      const to = h?.to || '';
      const msgId = h?.id || idx;
      const raw = String(h?.body || h?.message || h?.text || '');
      const mediaType = detectMediaType(h);
      
      // Cores e labels por ação - FIX #2: Diferenciar corretamente revoked vs deleted
      const actionStyles = {
        'revoked': { color: '#ef4444', bg: 'rgba(239,68,68,0.05)', badgeClass: 'badge-revoked' },
        'deleted': { color: '#f59e0b', bg: 'rgba(245,158,11,0.05)', badgeClass: 'badge-deleted' },
        'edited': { color: '#3b82f6', bg: 'rgba(59,130,246,0.05)', badgeClass: 'badge-edited' }
      };
      const style = actionStyles[action] || { color: '#6b7280', bg: 'rgba(107,114,128,0.05)', badgeClass: '' };
      
      return `
        <div class="recover-item" style="
          display: flex;
          flex-direction: row;
          align-items: flex-start;
          gap: 10px;
          padding: 10px;
          border-radius: 8px;
          background: ${style.bg};
          margin-bottom: 8px;
          border-left: 3px solid ${style.color};
        " data-msg-id="${msgId}">
          <!-- Coluna esquerda: mídia/ícone (tamanho fixo) -->
          <div class="recover-media" style="flex-shrink: 0;">
            ${renderMediaPreview(h, msgId)}
          </div>
          
          <!-- Coluna direita: info (flex grow) -->
          <div class="recover-info" style="flex: 1; min-width: 0; overflow: hidden;">
            <!-- Header: De → Para + Badge -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; flex-wrap: wrap; gap: 4px;">
              <span style="font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.9);">
                ${escapeHtml(from)}${to ? ` → ${escapeHtml(to)}` : ''}${h?.deviceIcon ? ` <span title="${h.deviceType === 'phone' ? 'Enviado pelo celular' : 'Enviado pelo computador'}" style="font-size:11px;opacity:0.75">${h.deviceIcon}</span>` : ''}
              </span>
              <span class="${style.badgeClass}" style="font-size: 9px; padding: 2px 6px; border-radius: 4px; white-space: nowrap;">
                ${getBadgeText(action)}
              </span>
            </div>
            
            <!-- BUG 3: Deletion Type Badge -->
            ${renderDeletionTypeBadge(h?.deletionType, h?.deletionInfo)}
            
            <!-- Body: texto da mensagem (truncado se longo) -->
            <div style="font-size: 11px; color: rgba(255,255,255,0.8); word-break: break-word; max-height: ${mediaType === 'text' ? '80px' : '60px'}; overflow: hidden; text-overflow: ellipsis;">
              ${raw ? escapeHtml(raw) : (mediaType !== 'text' ? `[${mediaType}]` : '')}
            </div>
            
            <!-- Footer: timestamp + ações -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; flex-wrap: wrap; gap: 4px;">
              <span style="font-size: 9px; color: rgba(255,255,255,0.5);">${formatTime(h?.timestamp)}</span>
              <div class="recover-actions" style="display: flex; gap: 4px;">
                ${renderActionButtons(h, msgId)}
              </div>
            </div>
            
            <!-- BUG 2: Persistent Notification -->
            ${renderPersistentNotification(h?.notification)}
          </div>
        </div>
      `;
    }).join('');

    // Event delegation para botões
    root.onclick = async (e) => {
      const btn = e.target.closest('[data-action]');
      const favBtn = e.target.closest('.recover-fav-btn');
      
      if (favBtn) {
        const id = favBtn.dataset.id;
        const isFav = window.RecoverAdvanced?.toggleFavorite?.(id);
        favBtn.textContent = isFav ? '⭐' : '☆';
        favBtn.classList.toggle('active', isFav);
        recoverRefresh(false);
        return;
      }
      
      if (!btn) return;
      
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      // CODE REVIEW FIX: Use strict equality for ID comparison
      const msg = uniqueMessages.find(m => (m.id || uniqueMessages.indexOf(m)) === id || String(m.id) === String(id));
      
      switch(action) {
        case 'copy':
          if (msg?.body) {
            navigator.clipboard.writeText(msg.body).then(() => showToast('✅ Copiado!'));
          }
          break;
          
        case 'download-media':
          // ✅ LÓGICA DE DOWNLOAD — Prioridade em cascata:
          //   P0: Base64 válido no cache → download direto (melhor qualidade, sem navegação)
          //   P1: Navegar no WhatsApp e clicar o botão de download real
          //   P2: Texto em cache → baixar como .txt
          btn.textContent = '⏳';
          btn.disabled = true;
          try {
            // 🔧 FIX: Validar que mediaData é uma string base64 real (não Blob serializado / __HAS_MEDIA__ / {})
            const isValidMediaData = (d) =>
              d &&
              typeof d === 'string' &&
              d !== '__HAS_MEDIA__' &&
              d.length > 100 &&
              (d.startsWith('data:') || d.startsWith('/9j/') || d.startsWith('iVBOR') ||
               d.startsWith('UklGR') || d.startsWith('R0lGOD') || d.startsWith('AAAA') ||
               d.startsWith('T2dn') || d.startsWith('JVBER') || d.startsWith('PK'));

            // P0: Download direto do cache base64 (sem precisar navegar)
            if (isValidMediaData(msg?.mediaData)) {
              const dataUrl = toDataUrl(msg.mediaData, msg.mimetype);
              if (dataUrl) {
                const mimeExt = {
                  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
                  'image/webp': 'webp', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
                  'audio/mpeg': 'mp3', 'video/mp4': 'mp4', 'video/webm': 'webm',
                  'application/pdf': 'pdf'
                };
                const ext = mimeExt[msg.mimetype] ||
                  (msg.mimetype || '').split('/').pop()?.split(';')[0] ||
                  (msg.mediaType === 'audio' || msg.mediaType === 'ptt' ? 'ogg' :
                   msg.mediaType === 'video' ? 'mp4' :
                   msg.mediaType === 'image' ? 'jpg' : 'bin');
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = msg.filename || `recover_${Date.now()}.${ext}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                showToast('✅ Download realizado!', 'success');
                break;
              }
            }

            // P1: Navegar até a mensagem no WhatsApp e clicar o botão de download
            showToast('🔍 Localizando mensagem...', 'info');

            const chatId = msg?.chatId || msg?.chat || msg?.to || msg?.from || null;
            const result = await sendToActiveTab({
              action: 'downloadDeletedMessageMedia',
              messageId: msg?.id,
              chatId
            });

            if (result?.success) {
              showToast('✅ Download iniciado!', 'success');
            } else {
              // P2: Re-download via Store usando directPath (se disponível)
              if (msg?.directPath || msg?.mediaKey || msg?.chatId) {
                showToast('🔄 Tentando re-download via Store...', 'info');
                const reResult = await sendToActiveTab({
                  action: 'recoverRedownloadMedia',
                  messageId: msg?.id,
                  chatId: msg?.chatId,
                  directPath: msg?.directPath || null,
                  mediaKey: msg?.mediaKey || null,
                  mimetype: msg?.mimetype || null,
                  filename: msg?.filename || null
                });

                if (reResult?.success && reResult?.base64) {
                  // Disparar o download com o base64 recebido
                  const a = document.createElement('a');
                  a.href = reResult.base64;
                  a.download = reResult.filename || msg.filename || `recover_${Date.now()}`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  showToast('✅ Download realizado!', 'success');
                  break;
                }
              }

              // P3: Fallback texto
              if (msg?.body && typeof msg.body === 'string' && msg.body.trim() &&
                  msg.body !== '[Mensagem sem texto - mídia ou sticker]') {
                const blob = new Blob([msg.body], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `recover_${Date.now()}_mensagem.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                showToast('⚠️ Download do texto (mídia não disponível)', 'warning');
              } else {
                throw new Error(result?.error || 'Mídia não disponível para download');
              }
            }
          } catch(e) {
            showToast(`❌ ${e.message || 'Erro ao baixar'}`, 'error');
            console.error('[Recover] Download error:', e);
          } finally {
            btn.textContent = '⬇️';
            btn.disabled = false;
          }
          break;
          
        case 'transcribe':
          btn.textContent = '⏳...';
          btn.disabled = true;
          try {
            const text = await window.RecoverAdvanced?.transcribeAudio?.(msg?.mediaData);
            const div = document.getElementById(`transcription_${id}`);
            if (div && text) {
              div.textContent = `"${text}"`;
              div.style.display = 'block';
              showToast('✅ Transcrição concluída!');
            } else {
              showToast('❌ Transcrição não disponível');
            }
          } catch(e) {
            showToast('❌ Erro na transcrição');
          }
          btn.textContent = '🎤 Transcrever';
          btn.disabled = false;
          break;
          
        case 'compare':
          const modal = $('recover_compare_modal');
          if (modal && msg) {
            $('recover_compare_original').textContent = msg.previousContent || msg.body || '';
            $('recover_compare_edited').textContent = msg.body || '';
            const diff = window.RecoverAdvanced?.compareEdited?.(id)?.diff;
            if (diff) {
              $('recover_compare_diff').innerHTML = `
                <b>Removido:</b> <span style="color:#ef4444">${escapeHtml(diff.removedText || 'nada')}</span><br>
                <b>Adicionado:</b> <span style="color:#10b981">${escapeHtml(diff.addedText || 'nada')}</span>
              `;
            }
            modal.style.display = 'block';
          }
          break;
      }
    };

    // Fechar modal de comparação
    const closeBtn = $('recover_close_compare');
    if (closeBtn) {
      closeBtn.onclick = () => { $('recover_compare_modal').style.display = 'none'; };
    }
  }
  
  // Helper para mostrar toast
  // CODE REVIEW FIX: Prevent memory leaks from multiple toasts
  let toastTimeout = null;
  
  function showToast(message) {
    // Preferir o sistema central de notificações quando disponível
    if (window.NotificationsModule?.toast) {
      window.NotificationsModule.toast(String(message ?? ''), 'info');
      return;
    }

    // Remover toast antigo se existir
    const oldToast = document.querySelector('.recover-toast');
    if (oldToast) oldToast.remove();
    
    // Clear previous timeout
    if (toastTimeout) {
      clearTimeout(toastTimeout);
      toastTimeout = null;
    }
    
    const toast = document.createElement('div');
    toast.className = 'recover-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    toastTimeout = setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => {
        toast.remove();
        toastTimeout = null;
      }, 300);
    }, 3000);
  }


  function renderDrafts(draftsObj) {
    const body = $('sp_drafts_body');
    if (!body) return;

    const entries = Object.entries(draftsObj || {});
    if (!entries.length) {
      body.innerHTML = `<tr><td colspan="4" style="opacity:.75">Nenhum template salvo.</td></tr>`;
      return;
    }

    body.innerHTML = entries
      .sort((a,b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0))
      .map(([name, d]) => {
        const savedAt = d?.savedAt ? new Date(d.savedAt) : null;
        const date = savedAt ? savedAt.toLocaleDateString() : '-';
        const qlen = Array.isArray(d?.queue) ? d.queue.length : (d?.numbersText ? String(d.numbersText).split(/\n+/).filter(Boolean).length : 0);
        const safeName = escapeHtml(name);
        const encodedName = encodeURIComponent(String(name));

        return `
          <tr>
            <td style="font-weight:800">${safeName}</td>
            <td>${escapeHtml(date)}</td>
            <td>${qlen}</td>
            <td>
              <button class="sp-btn sp-btn-secondary" data-load="${encodedName}" style="padding:6px 8px">Carregar</button>
              <button class="sp-btn sp-btn-danger" data-del="${encodedName}" style="padding:6px 8px">Del</button>
            </td>
          </tr>
        `;
      }).join('');

    body.querySelectorAll('button[data-load]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const encoded = btn.getAttribute('data-load');
        if (!encoded) return;
        let name = '';
        try { name = decodeURIComponent(encoded); } catch (_) { name = encoded; }
        $('sp_config_status').textContent = `⏳ Carregando "${name}"...`;
        try {
          await motor('LOAD_DRAFT', { name });
          $('sp_config_status').textContent = '✅ Template carregado.';
          await principalRefresh(true); // atualiza principal se usuário voltar
          await configLoad();
        } catch (e) {
          $('sp_config_status').textContent = `❌ ${e.message || e}`;
        }
      });
    });

    body.querySelectorAll('button[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const encoded = btn.getAttribute('data-del');
        if (!encoded) return;
        let name = '';
        try { name = decodeURIComponent(encoded); } catch (_) { name = encoded; }
        if (!confirm(`Excluir template "${name}"?`)) return;
        $('sp_config_status').textContent = `⏳ Excluindo "${name}"...`;
        try {
          await motor('DELETE_DRAFT', { name });
          $('sp_config_status').textContent = '✅ Excluído.';
          await configLoad();
        } catch (e) {
          $('sp_config_status').textContent = `❌ ${e.message || e}`;
        }
      });
    });
  }

  async function exportReportCSV() {
    const hint = $('sp_report_hint');
    if (hint) hint.textContent = '⏳ Gerando CSV...';

    try {
      const resp = await motor('GET_STATE', { light: false });
      const st = resp?.state || resp;
      const queue = Array.isArray(st?.queue) ? st.queue : [];
      const header = ['phone','status','valid','retries'].join(',');
      const lines = queue.map(c => {
        const phone = String(c.phone || '').replace(/"/g,'""');
        const status = String(c.status || '').replace(/"/g,'""');
        const valid = (c.valid === false) ? 'false' : 'true';
        const retries = String(c.retries ?? 0);
        return `"${phone}","${status}",${valid},${retries}`;
      });
      const csv = [header, ...lines].join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `whl_report_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      if (hint) hint.textContent = `✅ CSV exportado (${queue.length} linhas).`;
    } catch (e) {
      if (hint) hint.textContent = `❌ ${e.message || e}`;
    }
  }

  async function copyFailedNumbers() {
    const hint = $('sp_report_hint');
    if (hint) hint.textContent = '⏳ Copiando falhas...';

    try {
      const resp = await motor('GET_STATE', { light: false });
      const st = resp?.state || resp;
      const queue = Array.isArray(st?.queue) ? st.queue : [];
      const failed = queue.filter(c => c.status === 'failed' || c.valid === false).map(c => c.phone).filter(Boolean);
      const text = failed.join('\n');
      const ok = await copyToClipboard(text);
      if (hint) hint.textContent = ok ? `✅ Copiado (${failed.length}).` : '⚠️ Nada para copiar.';
    } catch (e) {
      if (hint) hint.textContent = `❌ ${e.message || e}`;
    }
  }

  // ========= Scheduler Functions =========
  async function addSchedule() {
    const nameEl = $('sp_schedule_name');
    const timeEl = $('sp_schedule_time');
    const statusEl = $('sp_schedule_status');
    
    const name = (nameEl?.value || '').trim();
    const time = timeEl?.value;
    
    if (!name) {
      if (statusEl) statusEl.textContent = '⚠️ Informe o nome da campanha.';
      return;
    }
    
    if (!time) {
      if (statusEl) statusEl.textContent = '⚠️ Informe o horário.';
      return;
    }
    
    if (statusEl) statusEl.textContent = '⏳ Agendando...';
    
    try {
      // Get current queue and config
      const resp = await motor('GET_STATE', { light: false });
      const st = resp?.state || resp;
      
      if (!st.queue || st.queue.length === 0) {
        if (statusEl) statusEl.textContent = '⚠️ Gere a fila primeiro.';
        return;
      }
      
      // Create schedule
      const schedule = await window.schedulerManager.createSchedule({
        name: name,
        scheduledTime: time,
        queue: st.queue,
        config: {
          message: st.message,
          imageData: st.imageData,
          delayMin: st.delayMin,
          delayMax: st.delayMax
        }
      });
      
      // Clear inputs
      if (nameEl) nameEl.value = '';
      if (timeEl) timeEl.value = '';
      
      // Notify
      if (window.notificationSystem) {
        const scheduledDate = new Date(time);
        await window.notificationSystem.scheduleCreated(
          name,
          scheduledDate.toLocaleString('pt-BR')
        );
      }
      
      if (statusEl) statusEl.textContent = `✅ Campanha "${name}" agendada!`;
      
      // Reload list
      await loadSchedulesList();
    } catch (e) {
      if (statusEl) statusEl.textContent = `❌ ${e.message || e}`;
    }
  }
  
  async function loadSchedulesList() {
    const listEl = $('sp_schedules_list');
    if (!listEl || !window.schedulerManager) return;
    
    try {
      // IMPORTANTE: getAllSchedules agora é async
      const schedules = await window.schedulerManager.getAllSchedules();
      
      console.log('[WHL] Agendamentos carregados:', schedules.length, schedules);
      
      if (!schedules || schedules.length === 0) {
        listEl.innerHTML = '<div style="padding:16px;text-align:center;opacity:0.7">Nenhuma campanha agendada.</div>';
        return;
      }
      
      let html = '<table style="width:100%"><thead><tr><th>Campanha</th><th>Horário</th><th>Status</th><th style="width:80px">Ações</th></tr></thead><tbody>';
      
      schedules.forEach(s => {
        const formatted = window.schedulerManager.formatSchedule(s);
        const statusIcon = s.status === 'pending' ? '⏳' : (s.status === 'running' ? '🚀' : (s.status === 'completed' ? '✅' : '❌'));
        
        html += `
          <tr data-schedule-id="${s.id}">
            <td><strong>${escapeHtml(s.name)}</strong></td>
            <td>
              ${escapeHtml(formatted.scheduledTimeFormatted)}
              ${formatted.timeRemaining ? `<br><small>(${escapeHtml(formatted.timeRemaining)})</small>` : ''}
            </td>
            <td class="schedule-status">${statusIcon} ${escapeHtml(s.status)}</td>
            <td>
              <button class="sp-btn sp-btn-danger" data-delete-schedule="${s.id}" style="padding:4px 8px;font-size:11px">🗑️</button>
            </td>
          </tr>
        `;
      });
      
      html += '</tbody></table>';
      listEl.innerHTML = html;
      
      // Add delete handlers
      listEl.querySelectorAll('button[data-delete-schedule]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-delete-schedule');
          const schedule = window.schedulerManager.getSchedule(id);
          
          if (!schedule || !confirm(`Excluir agendamento "${schedule.name}"?`)) return;
          
          try {
            await window.schedulerManager.deleteSchedule(id);
            $('sp_schedule_status').textContent = '✅ Agendamento excluído.';
            await loadSchedulesList();
          } catch (e) {
            $('sp_schedule_status').textContent = `❌ ${e.message || e}`;
          }
        });
      });
    } catch (e) {
      console.error('[WHL] Erro ao carregar agendamentos:', e);
    }
  }

  // ========= Anti-Ban Functions =========
  async function saveAntiBanSettings() {
    const limitEl = $('sp_daily_limit');
    const businessEl = $('sp_business_hours_only');
    const statusEl = $('sp_antiban_status');
    
    if (statusEl) statusEl.textContent = '⏳ Salvando...';
    
    try {
      const limit = parseInt(limitEl?.value || '200', 10);
      const businessHours = businessEl?.checked || false;
      
      await window.antiBanSystem.setDailyLimit(limit);
      await window.antiBanSystem.setBusinessHoursOnly(businessHours);
      
      if (statusEl) statusEl.textContent = '✅ Configurações salvas!';
      
      // Update display
      await loadAntiBanStats();
    } catch (e) {
      if (statusEl) statusEl.textContent = `❌ ${e.message || e}`;
    }
  }
  
  async function resetDailyCount() {
    if (!confirm('Resetar o contador de mensagens enviadas hoje?')) return;
    
    const statusEl = $('sp_antiban_status');
    
    try {
      await window.antiBanSystem.resetDailyCount();
      if (statusEl) statusEl.textContent = '✅ Contador resetado!';
      await loadAntiBanStats();
    } catch (e) {
      if (statusEl) statusEl.textContent = `❌ ${e.message || e}`;
    }
  }
  
  async function loadAntiBanStats() {
    if (!window.antiBanSystem) return;
    
    try {
      const stats = await window.antiBanSystem.getStats();
      
      // Update UI
      const sentEl = $('sp_sent_today');
      const limitDisplayEl = $('sp_daily_limit_display');
      const progressFillEl = $('sp_daily_progress_fill');
      const limitInputEl = $('sp_daily_limit');
      const businessEl = $('sp_business_hours_only');
      
      if (sentEl) sentEl.textContent = stats.sentToday;
      if (limitDisplayEl) limitDisplayEl.textContent = stats.dailyLimit;
      if (progressFillEl) {
        progressFillEl.style.width = `${stats.percentage}%`;
        
        // Change color based on percentage
        if (stats.percentage >= 100) {
          progressFillEl.style.background = '#E53935'; // Red
        } else if (stats.percentage >= 80) {
          progressFillEl.style.background = '#FB8C00'; // Orange
        } else {
          progressFillEl.style.background = '#25D366'; // Green
        }
      }
      if (limitInputEl) limitInputEl.value = stats.dailyLimit;
      if (businessEl) businessEl.checked = stats.businessHoursOnly;
    } catch (e) {
      console.error('[WHL] Erro ao carregar stats anti-ban:', e);
    }
  }
  
  // Listener para atualizações em tempo real do anti-ban
  if (typeof window !== 'undefined') {
    window.addEventListener('antiban-update', (e) => {
      const { sentToday, dailyLimit, percentage } = e.detail || {};
      
      const sentEl = $('sp_sent_today');
      const limitDisplayEl = $('sp_daily_limit_display');
      const progressFillEl = $('sp_daily_progress_fill');
      
      if (sentEl && typeof sentToday === 'number') sentEl.textContent = sentToday;
      if (limitDisplayEl && typeof dailyLimit === 'number') limitDisplayEl.textContent = dailyLimit;
      if (progressFillEl && typeof percentage === 'number') {
        progressFillEl.style.width = `${percentage}%`;
        
        // Change color based on percentage
        if (percentage >= 100) {
          progressFillEl.style.background = '#E53935'; // Red
        } else if (percentage >= 80) {
          progressFillEl.style.background = '#FB8C00'; // Orange
        } else {
          progressFillEl.style.background = '#25D366'; // Green
        }
      }
    });
    
    // Também escutar mudanças no storage para sincronizar entre tabs
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.whl_antiban_ui_update) {
        const data = changes.whl_antiban_ui_update.newValue;
        if (data) {
          updateAntiBanUI(data);
        }
      }
      // Monitorar mudanças na fila para atualizar tabela em tempo real
      if (area === 'local' && changes.whl_queue) {
        const queue = changes.whl_queue.newValue || [];
        const sent = queue.filter(c => c.status === 'sent').length;
        const failed = queue.filter(c => c.status === 'failed').length;
        const pending = queue.filter(c => ['pending', 'opened', 'confirming', 'pending_retry'].includes(c.status)).length;
        const total = queue.length;
        const completed = sent + failed;
        
        // Atualizar estatísticas
        if ($('sp_stat_sent')) $('sp_stat_sent').textContent = sent;
        if ($('sp_stat_failed')) $('sp_stat_failed').textContent = failed;
        if ($('sp_stat_pending')) $('sp_stat_pending').textContent = pending;
        
        // Atualizar barra de progresso
        const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
        const pfill = $('sp_progress_fill');
        const ptxt = $('sp_progress_text');
        if (pfill) pfill.style.width = `${percentage}%`;
        if (ptxt) ptxt.textContent = `${percentage}% (${completed}/${total})`;
      }
      // Monitorar mudanças nos agendamentos
      if (area === 'local' && changes.whl_schedules) {
        loadSchedulesList(); // Recarregar lista de agendamentos quando houver mudanças
      }
    });
    
    // Listener para mensagens do runtime (comunicação cross-context)
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'ANTIBAN_UPDATE' && message.data) {
        updateAntiBanUI(message.data);
      }
      // Atualização de status da fila em tempo real
      if (message.action === 'QUEUE_PROGRESS_UPDATE' && message.data) {
        updateQueueDisplay(message.data);
      }
      // Atualização quando agendamento é completado
      if (message.action === 'SCHEDULE_COMPLETED') {
        loadSchedulesList(); // Recarregar lista de agendamentos
        const statusEl = $('sp_schedule_status');
        if (statusEl) statusEl.textContent = '✅ Campanha agendada concluída!';
      }
      // Atualização de status de agendamento
      if (message.action === 'SCHEDULE_STATUS_CHANGED') {
        console.log('[WHL] Status do agendamento mudou:', message.status);
        loadSchedulesList(); // Recarregar lista
        const statusEl = $('sp_schedule_status');
        if (statusEl) {
          const statusText = message.status === 'running' ? '🚀 Campanha em execução...' :
                            message.status === 'completed' ? '✅ Campanha concluída!' :
                            message.status === 'failed' ? '❌ Campanha falhou' : '';
          if (statusText) statusEl.textContent = statusText;
        }
      }
      // Resultado de envio individual
      if (message.action === 'SEND_RESULT') {
        // Atualizar tabela de fila
        principalRefresh(true);
      }
    });
  }
  
  // Função auxiliar para atualizar UI do anti-ban
  function updateAntiBanUI(data) {
    const sentEl = $('sp_sent_today');
    const limitDisplayEl = $('sp_daily_limit_display');
    const progressFillEl = $('sp_daily_progress_fill');
    
    if (sentEl && typeof data.sentToday === 'number') {
      sentEl.textContent = data.sentToday;
    }
    if (limitDisplayEl && typeof data.dailyLimit === 'number') {
      limitDisplayEl.textContent = data.dailyLimit;
    }
    if (progressFillEl) {
      const percentage = data.percentage || Math.round((data.sentToday / data.dailyLimit) * 100);
      progressFillEl.style.width = `${percentage}%`;
      
      // Change color based on percentage
      if (percentage >= 100) {
        progressFillEl.style.background = '#E53935'; // Red
      } else if (percentage >= 80) {
        progressFillEl.style.background = '#FB8C00'; // Orange
      } else {
        progressFillEl.style.background = '#25D366'; // Green
      }
    }
  }
  
  // Função auxiliar para atualizar display da fila
  function updateQueueDisplay(data) {
    if (data.sent !== undefined && $('sp_stat_sent')) {
      $('sp_stat_sent').textContent = data.sent;
    }
    if (data.failed !== undefined && $('sp_stat_failed')) {
      $('sp_stat_failed').textContent = data.failed;
    }
    if (data.pending !== undefined && $('sp_stat_pending')) {
      $('sp_stat_pending').textContent = data.pending;
    }
    if (data.percentage !== undefined) {
      const pfill = $('sp_progress_fill');
      const ptxt = $('sp_progress_text');
      if (pfill) pfill.style.width = `${data.percentage}%`;
      if (ptxt) ptxt.textContent = `${data.percentage}% (${data.completed || 0}/${data.total || 0})`;
    }
  }

  // ========= Notification Functions =========
  async function updateNotificationSettings() {
    const enabledEl = $('sp_enable_notifications');
    const soundsEl = $('sp_enable_sounds');
    const statusEl = $('sp_notification_status');
    
    try {
      const enabled = enabledEl?.checked !== false;
      const sounds = soundsEl?.checked !== false;
      
      await window.notificationSystem.setEnabled(enabled);
      await window.notificationSystem.setSoundEnabled(sounds);
      
      if (statusEl) statusEl.textContent = '✅ Configurações salvas!';
      
      // Clear status after 2 seconds
      setTimeout(() => {
        if (statusEl) statusEl.textContent = '';
      }, 2000);
    } catch (e) {
      if (statusEl) statusEl.textContent = `❌ ${e.message || e}`;
    }
  }
  
  async function testNotification() {
    const statusEl = $('sp_notification_status');
    
    try {
      // Send test notification directly (chrome.notifications doesn't need permission request)
      await window.notificationSystem.test();
      
      if (statusEl) statusEl.textContent = '✅ Notificação enviada!';
      
      setTimeout(() => {
        if (statusEl) statusEl.textContent = '';
      }, 2000);
    } catch (e) {
      if (statusEl) statusEl.textContent = `❌ ${e.message || e}`;
    }
  }
  
  async function saveDraft() {
    const nameEl = $('sp_draft_name');
    const name = (nameEl?.value || '').trim();
    
    if (!name) {
      alert('⚠️ Informe o nome do template.');
      return;
    }
    
    try {
      // Get current state from motor
      const resp = await motor('GET_STATE', { light: false });
      const st = resp?.state || resp;
      
      // Save template to storage
      const templates = await chrome.storage.local.get('whl_templates') || {};
      const templatesList = templates.whl_templates || [];
      
      const template = {
        name: name,
        message: st.message || '',
        imageData: st.imageData || null,
        queue: st.queue || [],
        delayMin: st.delayMin || 2,
        delayMax: st.delayMax || 6,
        savedAt: new Date().toISOString()
      };
      
      // Check if template with same name exists
      const existingIndex = templatesList.findIndex(t => t.name === name);
      if (existingIndex >= 0) {
        if (!confirm(`Template "${name}" já existe. Substituir?`)) {
          return;
        }
        templatesList[existingIndex] = template;
      } else {
        templatesList.push(template);
      }
      
      await chrome.storage.local.set({ whl_templates: templatesList });
      
      if (nameEl) nameEl.value = '';
      alert('✅ Template salvo com sucesso!');
    } catch (error) {
      console.error('[Sidepanel] Erro ao salvar template:', error);
      alert('❌ Erro ao salvar template: ' + error.message);
    }
  }
  
  async function loadNotificationSettings() {
    if (!window.notificationSystem) return;
    
    try {
      const settings = window.notificationSystem.getSettings();
      
      const enabledEl = $('sp_enable_notifications');
      const soundsEl = $('sp_enable_sounds');
      
      if (enabledEl) enabledEl.checked = settings.enabled;
      if (soundsEl) soundsEl.checked = settings.soundEnabled;
    } catch (e) {
      console.error('[WHL] Erro ao carregar configurações de notificação:', e);
    }
  }

  // ========= Backup (ChatBackup) =========
  let backupBound = false;
  let backupRuntimeBound = false;
  let backupExporting = false;
  let backupContacts = [];
  let backupSelectedChatId = null;
  let backupMediaDetails = {
    images: { current: 0, total: 0, failed: 0 },
    audios: { current: 0, total: 0, failed: 0 },
    docs: { current: 0, total: 0, failed: 0 }
  };

  const BK_STORE = {
    FORMAT: 'whl_chatbackup_format',
    LIMIT: 'whl_chatbackup_limit',
    DATE_FROM: 'whl_chatbackup_date_from',
    DATE_TO: 'whl_chatbackup_date_to',
    INC_TS: 'whl_chatbackup_inc_ts',
    INC_SENDER: 'whl_chatbackup_inc_sender',
    MEDIA_IMAGES: 'whl_chatbackup_media_images',
    MEDIA_AUDIOS: 'whl_chatbackup_media_audios',
    MEDIA_DOCS: 'whl_chatbackup_media_docs',
    LAST_CHAT: 'whl_chatbackup_last_chat'
  };

  function bkSetPill(state, text) {
    const pill = $('bk_status_pill');
    if (!pill) return;
    pill.classList.remove('sent', 'failed', 'pending', 'invalid');
    if (state === 'ok') pill.classList.add('sent');
    else if (state === 'err') pill.classList.add('failed');
    else pill.classList.add('pending');
    pill.textContent = text;
  }

  function bkSetStatusText(t) {
    const el = $('bk_status_text');
    if (el) el.textContent = t;
  }

  function bkSetFeedback(t) {
    const el = $('bk_feedback');
    if (el) el.textContent = t;
  }

  function bkGetElVal(id, fallback = '') {
    const el = $(id);
    if (!el) return fallback;
    return (el.value ?? fallback);
  }

  function bkGetChecked(id, fallback = false) {
    const el = $(id);
    if (!el) return fallback;
    return !!el.checked;
  }

  function bkSaveSettings() {
    try {
      localStorage.setItem(BK_STORE.FORMAT, String(bkGetElVal('bk_format', 'html')));
      localStorage.setItem(BK_STORE.LIMIT, String(bkGetElVal('bk_limit', '1000')));
      localStorage.setItem(BK_STORE.DATE_FROM, String(bkGetElVal('bk_date_from', '')));
      localStorage.setItem(BK_STORE.DATE_TO, String(bkGetElVal('bk_date_to', '')));
      localStorage.setItem(BK_STORE.INC_TS, bkGetChecked('bk_inc_ts') ? '1' : '0');
      localStorage.setItem(BK_STORE.INC_SENDER, bkGetChecked('bk_inc_sender', true) ? '1' : '0');
      localStorage.setItem(BK_STORE.MEDIA_IMAGES, bkGetChecked('bk_export_images', true) ? '1' : '0');
      localStorage.setItem('whl_chatbackup_media_videos', bkGetChecked('bk_export_videos', false) ? '1' : '0');
      localStorage.setItem(BK_STORE.MEDIA_AUDIOS, bkGetChecked('bk_export_audios') ? '1' : '0');
      localStorage.setItem(BK_STORE.MEDIA_DOCS, bkGetChecked('bk_export_docs') ? '1' : '0');
    } catch (e) {
      // ignore
    }
  }

  function bkLoadSettings() {
    try {
      const format = localStorage.getItem(BK_STORE.FORMAT) || 'html';
      const limit = localStorage.getItem(BK_STORE.LIMIT) || '1000';
      const dateFrom = localStorage.getItem(BK_STORE.DATE_FROM) || '';
      const dateTo = localStorage.getItem(BK_STORE.DATE_TO) || '';
      const incTs = (localStorage.getItem(BK_STORE.INC_TS) === '1');
      const incSender = (localStorage.getItem(BK_STORE.INC_SENDER) !== '0');
      const mImages = (localStorage.getItem(BK_STORE.MEDIA_IMAGES) !== '0');
      const mVideos = (localStorage.getItem('whl_chatbackup_media_videos') === '1');
      const mAudios = (localStorage.getItem(BK_STORE.MEDIA_AUDIOS) === '1');
      const mDocs = (localStorage.getItem(BK_STORE.MEDIA_DOCS) === '1');

      if ($('bk_format')) $('bk_format').value = format;
      if ($('bk_limit')) $('bk_limit').value = limit;
      if ($('bk_date_from')) $('bk_date_from').value = dateFrom;
      if ($('bk_date_to')) $('bk_date_to').value = dateTo;
      if ($('bk_inc_ts')) $('bk_inc_ts').checked = incTs;
      if ($('bk_inc_sender')) $('bk_inc_sender').checked = incSender;
      if ($('bk_export_images')) $('bk_export_images').checked = mImages;
      if ($('bk_export_videos')) $('bk_export_videos').checked = mVideos;
      if ($('bk_export_audios')) $('bk_export_audios').checked = mAudios;
      if ($('bk_export_docs')) $('bk_export_docs').checked = mDocs;
    } catch (e) {
      // ignore
    }
  }

  function bkRestoreSelection() {
    try {
      backupSelectedChatId = localStorage.getItem(BK_STORE.LAST_CHAT) || null;
    } catch {
      backupSelectedChatId = null;
    }
    bkUpdateSelectedBox();
  }

  function bkUpdateSelectedBox(currentChatInfo = null) {
    const box = $('bk_selected_box');
    if (!box) return;

    if (backupSelectedChatId) {
      const c = backupContacts.find(x => x.id === backupSelectedChatId);
      const label = c ? `${c.isGroup ? '👥' : '👤'} ${c.name}` : `ID: ${backupSelectedChatId}`;
      box.textContent = `Selecionado: ${label}`;
      box.style.display = '';
      // Atualizar display de contato selecionado
      if (c) {
        bkUpdateSelectedContactDisplay(c);
      }
      return;
    }

    if (currentChatInfo?.name) {
      const label = `${currentChatInfo.isGroup ? '👥' : '👤'} ${currentChatInfo.name}`;
      box.textContent = `Conversa aberta: ${label} (será exportada)`;
      box.style.display = '';
      bkUpdateSelectedContactDisplay(currentChatInfo);
      return;
    }

    box.style.display = 'none';
    box.textContent = '';
    bkUpdateSelectedContactDisplay(null);
  }
  
  // Nova função para atualizar o display visual do contato selecionado
  function bkUpdateSelectedContactDisplay(contact) {
    const displayEl = $('bk_selected_contact_display');
    const avatarEl = $('bk_selected_avatar');
    const avatarPlaceholder = $('bk_selected_avatar_placeholder');
    const nameEl = $('bk_selected_name');
    const infoEl = $('bk_selected_info');
    
    if (!displayEl) return;
    
    if (!contact) {
      displayEl.style.display = 'none';
      return;
    }
    
    displayEl.style.display = '';
    
    if (nameEl) {
      nameEl.textContent = contact.name || 'Contato';
    }
    
    if (infoEl) {
      const parts = [];
      if (contact.isGroup) parts.push('👥 Grupo');
      else parts.push('👤 Conversa');
      if (contact.id) parts.push(`ID: ${contact.id.substring(0, 15)}...`);
      infoEl.textContent = parts.join(' • ');
    }
    
    // Foto de perfil
    if (contact.avatar || contact.profilePic) {
      if (avatarEl) {
        avatarEl.src = contact.avatar || contact.profilePic;
        avatarEl.style.display = '';
      }
      if (avatarPlaceholder) {
        avatarPlaceholder.style.display = 'none';
      }
    } else {
      if (avatarEl) {
        avatarEl.style.display = 'none';
      }
      if (avatarPlaceholder) {
        avatarPlaceholder.style.display = 'flex';
        avatarPlaceholder.textContent = contact.isGroup ? '👥' : '👤';
      }
    }
  }

  function bkRenderContacts(list) {
    const container = $('bk_contacts_list');
    if (!container) return;

    if (!Array.isArray(list) || list.length === 0) {
      container.innerHTML = '<div class="sp-muted" style="padding:10px">Nenhum contato carregado.</div>';
      return;
    }

    const html = list.map(c => {
      const selected = (backupSelectedChatId && c.id === backupSelectedChatId) ? 'selected' : '';
      const icon = c.isGroup ? '👥' : '👤';
      const metaParts = [];
      if (c.isGroup) metaParts.push('Grupo');
      if (!c.isGroup) metaParts.push('Conversa');
      if (typeof c.unreadCount === 'number' && c.unreadCount > 0) metaParts.push(`${c.unreadCount} não lidas`);
      const meta = metaParts.join(' • ');

      return `
        <div class="group-item ${selected}" data-id="${escapeHtml(c.id)}">
          <div class="group-avatar">${icon}</div>
          <div class="group-info">
            <div class="group-name">${escapeHtml(c.name || c.id)}</div>
            <div class="group-meta">${escapeHtml(meta)}</div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = html;

    // Bind clicks
    container.querySelectorAll('.group-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.getAttribute('data-id');
        if (!id) return;
        backupSelectedChatId = id;
        try { localStorage.setItem(BK_STORE.LAST_CHAT, id); } catch {}
        
        // Encontrar contato selecionado e atualizar display
        const selectedContact = backupContacts.find(x => x.id === id);
        bkUpdateSelectedBox();
        if (selectedContact) {
          bkUpdateSelectedContactDisplay(selectedContact);
        }
        
        // refresh selection highlight
        container.querySelectorAll('.group-item').forEach(x => x.classList.toggle('selected', x.getAttribute('data-id') === id));
      });
    });
  }

  function bkApplyContactFilter() {
    const q = String(bkGetElVal('bk_search_contacts', '') || '').toLowerCase().trim();
    if (!q) {
      bkRenderContacts(backupContacts);
      return;
    }
    const filtered = backupContacts.filter(c => String(c.name || '').toLowerCase().includes(q) || String(c.id || '').toLowerCase().includes(q));
    bkRenderContacts(filtered);
  }

  async function backupRefresh(force = false) {
    if (backupExporting && !force) return;

    const wrong = $('bk_wrong_page');
    if (wrong) wrong.style.display = 'none';

    bkSetPill('pending', 'Verificando…');
    bkSetStatusText('—');

    try {
      const st = await sendToActiveTab({ action: 'getStatus' });
      if (!st) throw new Error('Sem resposta do WhatsApp');

      if (st.connected) {
        bkSetPill('ok', 'Conectado');
      } else {
        bkSetPill('pending', 'Aguardando');
      }

      bkSetStatusText(st.message || (st.connected ? 'Conectado' : 'WhatsApp não conectado'));
      bkUpdateSelectedBox(st.currentChat || null);
    } catch (e) {
      bkSetPill('err', 'Offline');
      bkSetStatusText(e?.message || String(e));
      bkUpdateSelectedBox(null);
      if (wrong) wrong.style.display = '';
    }
  }

  async function bkLoadContacts() {
    const btn = $('bk_load_contacts');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Carregando...';
    }
    bkSetFeedback('⏳ Carregando contatos...');

    try {
      const res = await sendToActiveTab({ action: 'getContacts' });
      if (!res || res.success === false) {
        throw new Error(res?.error || 'Falha ao carregar contatos');
      }
      const list = Array.isArray(res.contacts) ? res.contacts : [];
      backupContacts = list;
      bkApplyContactFilter();

      // Restore selection label if possible
      bkUpdateSelectedBox();

      bkSetFeedback(`✅ Contatos carregados: ${list.length}`);
    } catch (e) {
      bkSetFeedback(`❌ ${e?.message || String(e)}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🔄 Carregar contatos';
      }
    }
  }

  function bkSetExportingUI(isExporting) {
    backupExporting = !!isExporting;
    const btnExp = $('bk_export');
    const btnCancel = $('bk_cancel');
    const box = $('bk_progress_box');
    if (btnExp) {
      btnExp.disabled = backupExporting;
      btnExp.textContent = backupExporting ? '⏳ Exportando...' : '⬇️ Exportar';
    }
    if (btnCancel) {
      btnCancel.style.display = backupExporting ? '' : 'none';
    }
    if (box) {
      box.style.display = backupExporting ? '' : (box.style.display || 'none');
    }
    if (!backupExporting) {
      startBackupInterval();
    }
  }

  function bkResetProgress() {
    const fill = $('bk_bar_fill');
    const pct = $('bk_prog_pct');
    const status = $('bk_prog_status');
    const detail = $('bk_prog_detail');
    const media = $('bk_media_progress');
    if (fill) fill.style.width = '0%';
    if (pct) pct.textContent = '0%';
    if (status) status.textContent = '—';
    if (detail) detail.textContent = '0 / 0';
    backupMediaDetails = {
      images: { current: 0, total: 0, failed: 0 },
      audios: { current: 0, total: 0, failed: 0 },
      docs: { current: 0, total: 0, failed: 0 }
    };
    if (media) {
      media.textContent = '';
      media.style.display = 'none';
    }
  }

  function bkUpdateMediaDetailsUI() {
    const el = $('bk_media_progress');
    if (!el) return;

    const lines = [];
    const showImages = bkGetChecked('bk_export_images');
    const showAudios = bkGetChecked('bk_export_audios');
    const showDocs = bkGetChecked('bk_export_docs');

    if (showImages) {
      const d = backupMediaDetails.images;
      if (d.total > 0) lines.push(`🖼️ Imagens: ${d.current}/${d.total}${d.failed ? ` (falhas: ${d.failed})` : ''}`);
    }
    if (showAudios) {
      const d = backupMediaDetails.audios;
      if (d.total > 0) lines.push(`🎵 Áudios: ${d.current}/${d.total}${d.failed ? ` (falhas: ${d.failed})` : ''}`);
    }
    if (showDocs) {
      const d = backupMediaDetails.docs;
      if (d.total > 0) lines.push(`📄 Docs: ${d.current}/${d.total}${d.failed ? ` (falhas: ${d.failed})` : ''}`);
    }

    if (lines.length) {
      el.textContent = lines.join(' | ');
      el.style.display = '';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  function bkHandleRuntimeMessage(message) {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'progress') {
      const percent = Number(message.percent);
      const current = Number(message.current ?? 0);
      const total = Number(message.total ?? 0);
      const statusText = message.status || '';

      const box = $('bk_progress_box');
      if (box) box.style.display = '';

      const fill = $('bk_bar_fill');
      const pct = $('bk_prog_pct');
      const statusEl = $('bk_prog_status');
      const detailEl = $('bk_prog_detail');

      const p = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : (total > 0 ? Math.round((current / total) * 100) : 0);
      if (fill) fill.style.width = `${p}%`;
      if (pct) pct.textContent = `${p}%`;
      if (statusEl) statusEl.textContent = statusText || '—';
      if (detailEl) {
        if (total > 0) detailEl.textContent = `${current} / ${total}`;
        else detailEl.textContent = (current ? String(current) : '0') + ' / ' + (total ? String(total) : '0');
      }
      if (!backupExporting) bkSetExportingUI(true);
    }

    if (message.type === 'mediaProgressDetailed') {
      const data = message.data || {};
      if (data.images) backupMediaDetails.images = { ...backupMediaDetails.images, ...data.images };
      if (data.audios) backupMediaDetails.audios = { ...backupMediaDetails.audios, ...data.audios };
      if (data.docs) backupMediaDetails.docs = { ...backupMediaDetails.docs, ...data.docs };
      bkUpdateMediaDetailsUI();
    }

    if (message.type === 'chatUpdate') {
      // If user didn't select a chat explicitly, keep showing the open conversation
      if (!backupSelectedChatId) {
        bkUpdateSelectedBox(message.chat || null);
      }
    }

    if (message.type === 'complete') {
      const count = Number(message.count ?? 0);
      bkSetFeedback(`✅ Backup concluído. Mensagens exportadas: ${count}`);
      bkSetExportingUI(false);
      // Force 100%
      const fill = $('bk_bar_fill');
      const pct = $('bk_prog_pct');
      const statusEl = $('bk_prog_status');
      if (fill) fill.style.width = '100%';
      if (pct) pct.textContent = '100%';
      if (statusEl) statusEl.textContent = 'Concluído.';
      bkUpdateMediaDetailsUI();
    }

    if (message.type === 'error') {
      bkSetFeedback(`❌ ${message.error || 'Erro desconhecido'}`);
      bkSetExportingUI(false);
      const box = $('bk_progress_box');
      if (box) box.style.display = 'none';
    }
  }

  function backupInit() {
    if (backupBound) return;
    backupBound = true;

    bkLoadSettings();
    bkRestoreSelection();

    // Bind buttons
    $('bk_refresh')?.addEventListener('click', () => backupRefresh(true));
    $('bk_load_contacts')?.addEventListener('click', bkLoadContacts);
    $('bk_clear_selection')?.addEventListener('click', () => {
      backupSelectedChatId = null;
      try { localStorage.removeItem(BK_STORE.LAST_CHAT); } catch {}
      bkUpdateSelectedBox();
      bkUpdateSelectedContactDisplay(null);
      bkApplyContactFilter();
      bkSetFeedback('Seleção limpa.');
    });

    $('bk_search_contacts')?.addEventListener('input', () => bkApplyContactFilter());

    // Auto-save settings on change - REMOVIDO exportVideos da lista original e adicionado
    ['bk_format','bk_limit','bk_date_from','bk_date_to','bk_inc_ts','bk_inc_sender','bk_export_images','bk_export_videos','bk_export_audios','bk_export_docs'].forEach(id => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('change', () => bkSaveSettings());
    });

    // Botão Exportar conversa atual - CORRIGIDO para funcionar
    $('bk_export_current')?.addEventListener('click', async () => {
      bkSaveSettings();
      bkResetProgress();
      bkSetFeedback('⏳ Exportando conversa atual...');
      bkSetExportingUI(true);

      const settings = {
        format: String(bkGetElVal('bk_format', 'html')),
        messageLimit: Number(bkGetElVal('bk_limit', '1000')),
        includeTimestamps: bkGetChecked('bk_inc_ts', false),
        includeSender: bkGetChecked('bk_inc_sender', true),
        exportImages: bkGetChecked('bk_export_images', true),
        exportVideos: bkGetChecked('bk_export_videos', false),
        exportAudios: bkGetChecked('bk_export_audios', false),
        exportDocs: bkGetChecked('bk_export_docs', false),
        dateFrom: String(bkGetElVal('bk_date_from', '') || ''),
        dateTo: String(bkGetElVal('bk_date_to', '') || ''),
        chatId: null // null = usar conversa aberta atualmente
      };

      try {
        const resp = await sendToActiveTab({ action: 'startExport', settings });
        if (resp?.error) throw new Error(resp.error);
      } catch (e) {
        bkSetFeedback(`❌ ${e?.message || String(e)}`);
        bkSetExportingUI(false);
        const box = $('bk_progress_box');
        if (box) box.style.display = 'none';
      }
    });

    $('bk_export')?.addEventListener('click', async () => {
      bkSaveSettings();
      bkResetProgress();
      bkSetFeedback('⏳ Iniciando exportação...');

      bkSetExportingUI(true);

      const settings = {
        format: String(bkGetElVal('bk_format', 'html')),
        messageLimit: Number(bkGetElVal('bk_limit', '1000')),
        includeTimestamps: bkGetChecked('bk_inc_ts', false),
        includeSender: bkGetChecked('bk_inc_sender', true),
        exportImages: bkGetChecked('bk_export_images', true),
        exportVideos: bkGetChecked('bk_export_videos', false),
        exportAudios: bkGetChecked('bk_export_audios', false),
        exportDocs: bkGetChecked('bk_export_docs', false),
        dateFrom: String(bkGetElVal('bk_date_from', '') || ''),
        dateTo: String(bkGetElVal('bk_date_to', '') || ''),
        chatId: backupSelectedChatId || null
      };

      try {
        const resp = await sendToActiveTab({ action: 'startExport', settings });
        if (resp?.error) throw new Error(resp.error);
      } catch (e) {
        bkSetFeedback(`❌ ${e?.message || String(e)}`);
        bkSetExportingUI(false);
        const box = $('bk_progress_box');
        if (box) box.style.display = 'none';
      }
    });

    $('bk_cancel')?.addEventListener('click', async () => {
      bkSetFeedback('⛔ Cancelamento solicitado...');
      try {
        await sendToActiveTab({ action: 'cancelExport' });
      } catch (e) {
        bkSetFeedback(`❌ ${e?.message || String(e)}`);
      }
    });

    // Runtime listener (progress / complete / error)
    if (!backupRuntimeBound) {
      backupRuntimeBound = true;
      chrome.runtime.onMessage.addListener((message) => {
        try { bkHandleRuntimeMessage(message); } catch (e) { /* ignore */ }
      });
    }
  }

  // ========= Scheduler Alarm Handler =========
  // Listen for scheduled campaign alarms from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SCHEDULE_ALARM_FIRED') {
      (async () => {
        try {
          const scheduleId = message.scheduleId;
          console.log('[WHL Router] Schedule alarm fired:', scheduleId);
          
          if (window.schedulerManager) {
            await window.schedulerManager.executeSchedule(scheduleId);
            
            // Notify user
            if (window.notificationSystem) {
              const schedule = window.schedulerManager.getSchedule(scheduleId);
              if (schedule) {
                await window.notificationSystem.scheduleStarting(schedule.name);
              }
            }
          }
          
          sendResponse({ success: true });
        } catch (error) {
          console.error('[WHL Router] Error executing scheduled campaign:', error);
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true; // Will respond asynchronously
    }
  });


  // ========= Listener adicional para mudança de view via runtime message =========
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'WHL_CHANGE_VIEW' || message.type === 'WHL_CHANGE_VIEW') {
      const view = message.view || message.data?.view;
      if (view) {
        console.log('[SidePanel Router] Received direct view change message:', view);
        showView(view);
        sendResponse({ success: true });
        return true; // Resposta síncrona enviada
      }
    }
    return false;
  });

  // ========= Bootstrap =========
  console.log('[SidePanel Router] 🔧 Bootstrap starting...');
  
  // Verificar se chrome.storage está disponível
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    console.log('[SidePanel Router] ✅ chrome.storage.local disponível');
  } else {
    console.error('[SidePanel Router] ❌ chrome.storage.local NÃO disponível!');
  }
  
  // Verificar se chrome.runtime está disponível
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    console.log('[SidePanel Router] ✅ chrome.runtime.onMessage disponível');
  } else {
    console.error('[SidePanel Router] ❌ chrome.runtime.onMessage NÃO disponível!');
  }
  
  // Garantir que loadCurrentView é chamado
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('[SidePanel Router] 📄 DOMContentLoaded fired');
      loadCurrentView();
    });
  } else {
    console.log('[SidePanel Router] 📄 DOM already ready');
    loadCurrentView();
  }
  
  // Registrar handler adicional para garantir
  window.addEventListener('load', () => {
    console.log('[SidePanel Router] 🔄 Window load event - reloading view');
    loadCurrentView();
  });

  // Expor funções globalmente para outros scripts
  window.recoverRefresh = recoverRefresh;
  window.showView = showView;  // Exposed for debug
  window.renderRecoverTimeline = renderRecoverTimeline;
  window.showToast = showToast; // Expose toast helper globally
  
  // Expose dispatch and utility functions for button handlers
  window.addSchedule = addSchedule;
  window.saveAntiBanSettings = saveAntiBanSettings;
  window.testNotification = testNotification;
  window.saveDraft = saveDraft;
  window.exportReportCSV = exportReportCSV;
  window.copyFailedNumbers = copyFailedNumbers;

  // ========= Inicialização dos Novos Widgets =========
  function initializeNewWidgets() {
    console.log('[SidePanel Router] 🎯 Inicializando novos widgets...');

    // Trust System Widget
    const trustContainer = document.getElementById('trust-system-widget');
    if (trustContainer && window.TrustSystem) {
      try {
        window.TrustSystem.renderTrustWidget(trustContainer);
        console.log('[SidePanel Router] ✅ Trust System widget renderizado');
      } catch (e) {
        console.error('[SidePanel Router] Erro ao renderizar Trust System:', e);
      }
    }

    // Team System Widget
    const teamContainer = document.getElementById('team-system-widget');
    if (teamContainer && window.TeamSystem) {
      try {
        window.TeamSystem.renderTeamPanel(teamContainer);
        console.log('[SidePanel Router] ✅ Team System widget renderizado');
      } catch (e) {
        console.error('[SidePanel Router] Erro ao renderizar Team System:', e);
      }
    }
  }

  // Inicializar widgets após um delay para garantir que os módulos foram carregados
  setTimeout(() => {
    initializeNewWidgets();
  }, 2000);

  // Reinicializar widgets quando a aba AI for aberta
  document.addEventListener('click', (e) => {
    if (e.target.dataset.view === 'ai' || e.target.dataset.aiTab) {
      setTimeout(() => {
        initializeNewWidgets();
      }, 300);
    }
  });


  // ========= Fallback: Verificação periódica de view =========
  if (viewSyncInterval) clearInterval(viewSyncInterval);
  viewSyncInterval = setInterval(async () => {
    try {
      const { whl_active_view } = await chrome.storage.local.get('whl_active_view');
      if (whl_active_view && whl_active_view !== currentView) {
        console.log('[SidePanel Router] ⚡ Sync check - view mismatch, updating:', whl_active_view);
        showView(whl_active_view);
      }
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
  }, 1000);

  // Cleanup ao descarregar
  window.addEventListener('beforeunload', () => {
    stopIntervals();
    if (viewSyncInterval) clearInterval(viewSyncInterval);
  });

})();