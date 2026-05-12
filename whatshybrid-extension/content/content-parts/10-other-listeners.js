/**
 * @file content/content-parts/10-other-listeners.js
 * @description Slice 9582-10308 do content.js original (refactor v9.0.0)
 * @lines 727
 */

// ===== WHL: Listeners para eventos de Arquivados, Bloqueados, Grupos e Recover =====
(function() {
  if (window.__WHL_EVENT_LISTENERS__) return;
  window.__WHL_EVENT_LISTENERS__ = true;

  // ===== ARQUIVADOS & BLOQUEADOS =====
  window.addEventListener('message', (e) => {
    // Security: Validate message origin
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === 'WHL_ARCHIVED_BLOCKED_RESULT') {
      const { archived, blocked } = e.data;
      
      // Atualizar UI
      const archivedBox = document.getElementById('whlArchivedNumbers');
      const blockedBox = document.getElementById('whlBlockedNumbers');
      
      if (archivedBox) archivedBox.value = archived.join('\n');
      if (blockedBox) blockedBox.value = blocked.join('\n');
      
      // Estatísticas
      const archCnt = document.getElementById('whlArchivedCount');
      const blkCnt = document.getElementById('whlBlockedCount');
      
      if (archCnt) archCnt.textContent = archived.length;
      if (blkCnt) blkCnt.textContent = blocked.length;
      
      console.log(`[WHL] Arquivados: ${archived.length}, Bloqueados: ${blocked.length}`);
    }

    if (e.data?.type === 'WHL_ARCHIVED_BLOCKED_ERROR') {
      console.error('[WHL] Erro arquivados/bloqueados:', e.data.error);
    }
  });

  // ===== RECOVER HISTÓRICO =====
  const recoveredList = [];

  window.addEventListener('message', (e) => {
    // Security: Validate message origin
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === 'WHL_RECOVERED_MESSAGE') {
      recoveredList.push(e.data.payload);
      
      // Salvar no storage
      try {
        chrome.storage.local.set({ recoveredList });
      } catch(err) {
        console.warn('[WHL] Erro ao salvar recoveredList:', err);
      }

      // Atualizar contador
      const cnt = document.getElementById('whlRecoveredCount');
      if (cnt) cnt.textContent = recoveredList.length;

      // Adicionar ao histórico visual
      const history = document.getElementById('whlRecoverHistory');
      if (history) {
        const row = document.createElement('div');
        row.className = 'whl-rec-row';
        row.textContent = `[${new Date(e.data.payload.ts).toLocaleString()}] ${e.data.payload.preview}`;
        history.prepend(row);
      }
      
      console.log(`[WHL Recover] Nova mensagem recuperada, total: ${recoveredList.length}`);
    }
    
    // NOVO: Handler para mensagens recebidas - Integração com CopilotEngine
    if (e.data?.type === 'WHL_MESSAGE_RECEIVED') {
      const { chatId, message, sender, senderId, timestamp, messageId } = e.data.payload;
      
      console.log('[WHL] 📩 Mensagem recebida:', message?.substring(0, 50));
      
      // Emitir para EventBus se disponível
      if (window.EventBus) {
        window.EventBus.emit('message:received', {
          chatId,
          message,
          sender,
          senderId,
          timestamp,
          messageId
        });
        console.log('[WHL] 📤 Evento message:received emitido para EventBus');
      }
    }
  });

  // ===== EXTRAÇÃO INSTANTÂNEA =====
  window.addEventListener('message', (e) => {
    // Security: Validate message origin
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === 'WHL_EXTRACT_INSTANT_RESULT') {
      const numbers = e.data.numbers || [];
      console.log(`[WHL] Extração instantânea: ${numbers.length} números`);
      
      // Adicionar ao HarvesterStore se existir
      if (window.HarvesterStore) {
        numbers.forEach(n => HarvesterStore.processPhone(n, HarvesterStore.ORIGINS.STORE));
      }
    }
  });

  // ===== GRUPOS =====
  window.addEventListener('message', (e) => {
    // Security: Validate message origin
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === 'WHL_GROUPS_RESULT') {
      const groups = e.data.groups || [];
      console.log(`[WHL] ${groups.length} grupos carregados`);
      // updateGroupsUI(groups) - implementar quando UI estiver disponível
    }
    
    if (e.data?.type === 'WHL_GROUP_MEMBERS_RESULT') {
      const { groupId, members } = e.data;
      console.log(`[WHL] Grupo ${groupId}: ${members.length} membros`);
      // Adicionar membros à lista de extração se necessário
      if (window.HarvesterStore && members) {
        members.forEach(m => HarvesterStore.processPhone(m, HarvesterStore.ORIGINS.GROUP));
      }
    }
  });

  // Funções auxiliares para solicitar dados
  window.loadArchivedBlocked = function() {
    window.postMessage({ type: 'WHL_LOAD_ARCHIVED_BLOCKED' }, window.location.origin);
  };

  window.extractInstant = function() {
    window.postMessage({ type: 'WHL_EXTRACT_INSTANT' }, window.location.origin);
  };

  window.loadGroups = function() {
    window.postMessage({ type: 'WHL_LOAD_GROUPS' }, window.location.origin);
  };

  // =====================================================================
  // BACKGROUND / SCHEDULER BRIDGE
  // ---------------------------------------------------------------------
  // The scheduled-campaign system runs in the MV3 service worker
  // (background.js) and needs a reliable way to send messages without
  // navigating/reloading WhatsApp Web.
  //
  // The background worker sends a message to the WhatsApp tab with:
  //   { action: 'SEND_MESSAGE_URL', phone, text, imageData }
  //
  // In older builds this action had no handler, so schedules would start
  // but never actually send anything.
  //
  // This bridge uses the already-validated WPP hooks (wpp-hooks.js) via
  // window.postMessage to send text/images and returns the result back to
  // background.
  // =====================================================================

  /**
   * Send one message (text and optional image) using WPP hooks.
   * Returns a result compatible with background.js expectations.
   */
  async function whlSendOneOffFromBackground({ phone, text, imageData, timeoutMs = 40000 }) {
    const rawPhone = (phone == null) ? '' : String(phone);
    const rawText = (text == null) ? '' : String(text);
    const img = imageData || null;

    // Avoid disrupting a running manual campaign in the same tab.
    // Scheduled campaigns should be executed with the UI campaign stopped.
    try {
      const st = await getState();
      if (st?.isRunning) {
        return {
          success: false,
          error: 'Já existe uma campanha em andamento neste WhatsApp Web. Pare/finalize a campanha antes de executar um agendamento.'
        };
      }
    } catch (e) {
      // If state is not available, keep going.
    }

    // Normalize phone using the shared validator when available.
    let normalizedPhone = '';
    try {
      if (window.WHL_PhoneValidator?.formatForWhatsApp) {
        normalizedPhone = window.WHL_PhoneValidator.formatForWhatsApp(rawPhone);
      }
    } catch (e) {
      // ignore
    }
    if (!normalizedPhone) {
      normalizedPhone = rawPhone.replace(/\D/g, '');
    }
    if (!normalizedPhone) {
      return { success: false, error: 'Número inválido' };
    }

    const requestId = `bg_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    return await new Promise((resolve) => {
      let finished = false;
      let timeoutHandle = null;

      const finish = (result) => {
        if (finished) return;
        finished = true;
        window.removeEventListener('message', onMessage);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve(result);
      };

      const onMessage = (event) => {
        // Security: validate origin + source
        if (event.origin !== window.location.origin || event.source !== window) return;
        const data = event.data || {};
        if (!data.type || data.requestId !== requestId) return;

        // Text
        if (data.type === 'WHL_SEND_MESSAGE_API_RESULT') {
          finish({ success: !!data.success, error: data.error || null });
          return;
        }

        // Image (to number)
        if (data.type === 'WHL_SEND_IMAGE_TO_NUMBER_RESULT') {
          finish({ success: !!data.success, error: data.error || null });
          return;
        }
        if (data.type === 'WHL_SEND_IMAGE_TO_NUMBER_ERROR') {
          finish({ success: false, error: data.error || 'Falha ao enviar imagem' });
          return;
        }

        // Complete (text + image) fallback
        if (data.type === 'WHL_SEND_COMPLETE_RESULT') {
          finish({ success: !!data.success, error: data.error || null });
          return;
        }
      };

      window.addEventListener('message', onMessage);
      timeoutHandle = setTimeout(() => {
        finish({ success: false, error: 'TIMEOUT aguardando resposta do WhatsApp (hooks)' });
      }, Math.max(1000, Number(timeoutMs) || 40000));

      // Dispatch to hooks
      try {
        if (img) {
          // CORREÇÃO BUG 2 already implemented in hooks: opens the correct chat first.
          window.postMessage({
            type: 'WHL_SEND_IMAGE_TO_NUMBER',
            phone: normalizedPhone,
            image: img,
            caption: rawText,
            requestId
          }, window.location.origin);
        } else {
          window.postMessage({
            type: 'WHL_SEND_MESSAGE_API',
            phone: normalizedPhone,
            message: rawText,
            requestId
          }, window.location.origin);
        }
      } catch (err) {
        finish({ success: false, error: err?.message || String(err) });
      }
    });
  }

  // Listen for background requests to send a message.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.action !== 'SEND_MESSAGE_URL') return false;

    (async () => {
      try {
        const result = await whlSendOneOffFromBackground({
          phone: msg.phone,
          text: msg.text,
          imageData: msg.imageData,
          timeoutMs: 40000
        });
        sendResponse(result);
      } catch (e) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();

    return true; // keep the message channel open for the async response
  });

  // Handler para inserir sugestão do Copilot
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.action !== 'insertSuggestion') return false;
    
    try {
      // Encontrar campo de input do WhatsApp
      const selectors = [
        '[contenteditable="true"][data-tab="10"]',
        'div[contenteditable="true"][title*="Digite uma mensagem"]',
        'div[contenteditable="true"][title*="Type a message"]',
        'footer div[contenteditable="true"]',
        'div[contenteditable="true"][spellcheck="true"]'
      ];
      
      let input = null;
      for (const sel of selectors) {
        input = document.querySelector(sel);
        if (input) break;
      }
      
      if (!input) {
        console.warn('[WHL] Campo de mensagem não encontrado');
        sendResponse({ success: false, error: 'Campo de mensagem não encontrado' });
        return true;
      }
      
      // Inserir texto
      input.focus();
      
      // Limpar conteúdo existente
      input.innerHTML = '';
      
      // Inserir novo texto
      const textNode = document.createTextNode(msg.text);
      input.appendChild(textNode);
      
      // Disparar evento de input para WhatsApp reconhecer
      input.dispatchEvent(new InputEvent('input', { 
        bubbles: true, 
        cancelable: true,
        inputType: 'insertText',
        data: msg.text
      }));
      
      // Também disparar evento de keyup para garantir
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      
      console.log('[WHL] ✅ Sugestão inserida:', msg.text.substring(0, 30) + '...');
      sendResponse({ success: true });
    } catch (e) {
      console.error('[WHL] Erro ao inserir sugestão:', e);
      sendResponse({ success: false, error: e.message });
    }
    
    return true;
  });

  // Handler para mostrar painel de sugestões
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.action !== 'showSuggestionsPanel') return false;
    
    try {
      // Verificar se SuggestionInjector está disponível
      if (window.SuggestionInjector && window.SuggestionInjector.showPanel) {
        window.SuggestionInjector.showPanel();
        sendResponse({ success: true });
      } else {
        // Tentar mostrar o painel diretamente
        const panel = document.getElementById('whl-suggestions-panel');
        if (panel) {
          panel.classList.add('visible');
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Painel não encontrado' });
        }
      }
    } catch (e) {
      console.error('[WHL] Erro ao mostrar painel:', e);
      sendResponse({ success: false, error: e.message });
    }
    
    return true;
  });

  // ============================================
  // HANDLER DE TEXT-TO-SPEECH
  // ============================================
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.action !== 'TTS_READ_LAST_MESSAGE') return false;
    
    try {
      // Encontrar a última mensagem recebida
      const messageSelectors = [
        '.message-in .selectable-text',
        '.message-in span[dir="ltr"]',
        '.message-in .copyable-text span',
        '[data-testid="conversation-panel-messages"] .message-in span.selectable-text'
      ];
      
      let lastMessage = null;
      let lastText = '';
      
      for (const sel of messageSelectors) {
        const messages = document.querySelectorAll(sel);
        if (messages.length > 0) {
          lastMessage = messages[messages.length - 1];
          lastText = lastMessage?.textContent?.trim();
          if (lastText) break;
        }
      }
      
      if (!lastText) {
        sendResponse({ success: false, error: 'Nenhuma mensagem encontrada' });
        return true;
      }
      
      // Usar TTS para ler a mensagem
      if (window.TTS || window.TextToSpeech) {
        const tts = window.TTS || window.TextToSpeech;
        tts.speak(lastText)
          .then(() => {
            sendResponse({ success: true, text: lastText });
          })
          .catch(err => {
            sendResponse({ success: false, error: err.message });
          });
      } else if (window.speechSynthesis) {
        // Fallback para Web Speech API nativa
        const utterance = new SpeechSynthesisUtterance(lastText);
        utterance.lang = 'pt-BR';
        
        // Tentar encontrar voz em português
        const voices = speechSynthesis.getVoices();
        const ptVoice = voices.find(v => v.lang.startsWith('pt'));
        if (ptVoice) utterance.voice = ptVoice;
        
        utterance.onend = () => {
          sendResponse({ success: true, text: lastText });
        };
        utterance.onerror = (e) => {
          sendResponse({ success: false, error: e.error });
        };
        
        speechSynthesis.speak(utterance);
      } else {
        sendResponse({ success: false, error: 'TTS não disponível' });
      }
    } catch (e) {
      console.error('[WHL] Erro ao ler mensagem:', e);
      sendResponse({ success: false, error: e.message });
    }
    
    return true;
  });

  // ============================================
  // HANDLERS DE AUTO-PILOT (Bridge para Sidepanel)
  // ============================================
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.action !== 'autopilot') return false;
    
    try {
      const AP = window.AutoPilot;
      if (!AP) {
        sendResponse({ success: false, error: 'AutoPilot não disponível' });
        return true;
      }
      
      let result = { success: true };
      
      switch (msg.command) {
        case 'start':
          AP.start(msg.options);
          console.log('[WHL] AutoPilot iniciado via sidepanel');
          break;
          
        case 'pause':
          AP.pause();
          console.log('[WHL] AutoPilot pausado via sidepanel');
          break;
          
        case 'resume':
          AP.resume();
          console.log('[WHL] AutoPilot retomado via sidepanel');
          break;
          
        case 'stop':
          AP.stop();
          console.log('[WHL] AutoPilot parado via sidepanel');
          break;
          
        case 'getStats':
          result.stats = AP.getStats();
          break;
          
        case 'getConfig':
          result.config = AP.getConfig();
          break;
          
        case 'setConfig':
          AP.setConfig(msg.config);
          break;
          
        case 'getStatus':
          const stats = AP.getStats();
          result.status = {
            isRunning: stats.isRunning,
            isPaused: stats.isPaused,
            stats: stats
          };
          break;
          
        default:
          result = { success: false, error: `Comando desconhecido: ${msg.command}` };
      }
      
      sendResponse(result);
    } catch (e) {
      console.error('[WHL] Erro no AutoPilot:', e);
      sendResponse({ success: false, error: e.message });
    }
    
    return true;
  });


  // ============================================
  // HANDLERS DE ÁUDIO E ARQUIVO (Bridge para WPP Hooks)
  // ============================================
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return false;
    
    // ENVIAR ÁUDIO
    if (msg.type === 'WHL_SEND_AUDIO_DIRECT') {
      console.log('[WHL] 🎤 Recebido pedido de envio de áudio');
      
      // Enviar para WPP Hooks via postMessage
      window.postMessage({
        type: 'WHL_SEND_AUDIO_DIRECT',
        phone: msg.phone,
        audioData: msg.audioData,
        filename: msg.filename
      }, window.location.origin);
      
      // Ouvir resposta
      const audioListener = (event) => {
        if (event.data?.type === 'WHL_SEND_AUDIO_RESULT') {
          window.removeEventListener('message', audioListener);
          sendResponse(event.data);
        }
      };
      window.addEventListener('message', audioListener);
      
      // Timeout de 30 segundos
      setTimeout(() => {
        window.removeEventListener('message', audioListener);
      }, 30000);
      
      return true; // async response
    }
    
    // ENVIAR ARQUIVO
    if (msg.type === 'WHL_SEND_FILE_DIRECT') {
      console.log('[WHL] 📁 Recebido pedido de envio de arquivo');

      // Enviar para WPP Hooks via postMessage
      window.postMessage({
        type: 'WHL_SEND_FILE_DIRECT',
        phone: msg.phone,
        fileData: msg.fileData,
        filename: msg.filename,
        caption: msg.caption || '',
        // Opcional: texto separado (mesma lógica do áudio)
        text: msg.text || ''
      }, window.location.origin);

      // Ouvir resposta
      const fileListener = (event) => {
        if (event.data?.type === 'WHL_SEND_FILE_RESULT') {
          window.removeEventListener('message', fileListener);
          sendResponse(event.data);
        }
      };
      window.addEventListener('message', fileListener);

      // Timeout de 30 segundos
      setTimeout(() => {
        window.removeEventListener('message', fileListener);
      }, 30000);

      return true; // async response
    }

    // PERFORM SNAPSHOT
    if (msg.action === 'performSnapshot') {
      console.log('[WHL] 📸 Recebido pedido de snapshot');

      // Enviar para WPP Hooks via postMessage
      window.postMessage({
        type: 'performSnapshot',
        action: 'performSnapshot'
      }, window.location.origin);

      // Ouvir resposta
      const snapshotListener = (event) => {
        if (event.data?.type === 'WHL_SNAPSHOT_RESULT') {
          window.removeEventListener('message', snapshotListener);
          sendResponse(event.data);
        }
      };
      window.addEventListener('message', snapshotListener);

      // Timeout de 60 segundos (snapshot pode demorar mais)
      setTimeout(() => {
        window.removeEventListener('message', snapshotListener);
        sendResponse({ success: false, error: 'Timeout ao capturar snapshot' });
      }, 60000);

      return true; // async response
    }

    // PERFORM DEEP SCAN
    if (msg.action === 'performDeepScan') {
      console.log('[WHL] 🔬 Recebido pedido de DeepScan');

      (async () => {
        try {
          // Verificar se RecoverAdvanced está disponível
          if (!window.RecoverAdvanced?.executeDeepScan) {
            sendResponse({ success: false, error: 'RecoverAdvanced não disponível' });
            return;
          }

          // Executar DeepScan
          const result = await window.RecoverAdvanced.executeDeepScan((progress) => {
            // TODO: Enviar atualizações de progresso para sidepanel via chrome.runtime.sendMessage
            console.log('[WHL] DeepScan progress:', progress);
          });

          sendResponse(result);
        } catch (e) {
          console.error('[WHL] DeepScan error:', e);
          sendResponse({ success: false, error: e.message || String(e) });
        }
      })();

      return true; // async response
    }

    // DOWNLOAD DELETED MESSAGE MEDIA
    if (msg.action === 'downloadDeletedMessageMedia') {
      console.log('[WHL] 📥 Recebido pedido de download de mídia deletada');

      (async () => {
        try {
          const { messageId, chatId } = msg;

          if (!messageId || !chatId) {
            sendResponse({ success: false, error: 'messageId ou chatId não fornecido' });
            return;
          }

          // Envia para wpp-hooks.js executar a lógica
          window.postMessage({
            type: 'WHL_DOWNLOAD_DELETED_MEDIA',
            messageId,
            chatId
          }, window.location.origin);

          // Ouvir resposta
          const downloadListener = (event) => {
            if (event.data?.type === 'WHL_DOWNLOAD_DELETED_MEDIA_RESULT') {
              window.removeEventListener('message', downloadListener);
              sendResponse(event.data);
            }
          };
          window.addEventListener('message', downloadListener);

          // Timeout de 30 segundos
          setTimeout(() => {
            window.removeEventListener('message', downloadListener);
            sendResponse({ success: false, error: 'Timeout ao baixar mídia' });
          }, 30000);

        } catch (e) {
          console.error('[WHL] Download error:', e);
          sendResponse({ success: false, error: e.message || String(e) });
        }
      })();

      return true; // async response
    }

    // 🔧 FIX: Re-download de mídia recuperada via Store (quando base64 não estava no cache)
    if (msg.action === 'recoverRedownloadMedia') {
      console.log('[WHL] 🔄 Pedido de re-download de mídia recuperada');

      (async () => {
        try {
          const { messageId, chatId, directPath, mediaKey, mimetype, filename } = msg;

          window.postMessage({
            type: 'WHL_RECOVER_REDOWNLOAD',
            messageId,
            chatId,
            directPath,
            mediaKey,
            mimetype,
            filename
          }, window.location.origin);

          const listener = (event) => {
            if (event.data?.type === 'WHL_RECOVER_REDOWNLOAD_RESULT') {
              window.removeEventListener('message', listener);
              sendResponse(event.data);
            }
          };
          window.addEventListener('message', listener);

          setTimeout(() => {
            window.removeEventListener('message', listener);
            sendResponse({ success: false, error: 'Timeout no re-download' });
          }, 20000);

        } catch (e) {
          console.error('[WHL] Re-download error:', e);
          sendResponse({ success: false, error: e.message || String(e) });
        }
      })();

      return true; // async response
    }

    return false;
  });


  console.log('[WHL] Event listeners registrados');
})();


