/**
 * @file content/content-parts/11-extractor-loader.js
 * @description Slice 10309-10539 do content.js original (refactor v9.0.0)
 * @lines 231
 */

// ===== WHL: Loader seguro do extrator isolado =====
(function(){
  try {
    if (window.__WHL_EXTRACTOR_LOADER__) return;
    window.__WHL_EXTRACTOR_LOADER__ = true;

    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('content/extractor.contacts.js');
    s.onload = () => console.log('[WHL] Extractor script injetado');
    (document.head || document.documentElement).appendChild(s);
  } catch(e) {
    console.error('[WHL] Falha ao carregar extrator', e);
  }
})();


  // ============================================
  // HANDLERS DE ÁUDIO E ARQUIVO v7.5.1
  // Solução: Enviar via API própria (sem window.Store)
  // ============================================
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return false;
    
    // Handler para enviar áudio
    if (msg.type === 'WHL_SEND_AUDIO_MESSAGE') {
      console.log('[WHL] 🎤 Recebido pedido de envio de áudio');
      
      (async () => {
        try {
          // Verificar se há chat ativo
          const activeChat = getActiveChatId();
          if (!activeChat) {
            sendResponse({ success: false, error: 'Nenhum chat ativo. Abra uma conversa primeiro.' });
            return;
          }
          
          console.log('[WHL] 📤 Enviando áudio para:', activeChat);
          
          // Enviar via WPP Hooks (funciona sem Store)
          const result = await sendMediaMessage(activeChat, {
            type: 'audio',
            data: msg.audioData,
            mimetype: msg.mimeType || 'audio/ogg',
            ptt: true, // Push-to-talk (aparece como mensagem de voz)
            duration: msg.duration || 0
          });
          
          if (result) {
            console.log('[WHL] ✅ Áudio enviado com sucesso');
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Falha ao enviar áudio' });
          }
        } catch (e) {
          console.error('[WHL] ❌ Erro ao enviar áudio:', e);
          sendResponse({ success: false, error: e.message });
        }
      })();
      
      return true; // Manter canal aberto para resposta assíncrona
    }
    
    // Handler para enviar arquivo
    if (msg.type === 'WHL_SEND_FILE_MESSAGE') {
      console.log('[WHL] 📎 Recebido pedido de envio de arquivo:', msg.fileName);
      
      (async () => {
        try {
          const activeChat = getActiveChatId();
          if (!activeChat) {
            sendResponse({ success: false, error: 'Nenhum chat ativo. Abra uma conversa primeiro.' });
            return;
          }
          
          console.log('[WHL] 📤 Enviando arquivo para:', activeChat);
          
          // Determinar tipo de mídia
          const mediaType = getMediaTypeFromMime(msg.mimeType);
          
          const result = await sendMediaMessage(activeChat, {
            type: mediaType,
            data: msg.fileData,
            mimetype: msg.mimeType,
            filename: msg.fileName
          });
          
          if (result) {
            console.log('[WHL] ✅ Arquivo enviado com sucesso');
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Falha ao enviar arquivo' });
          }
        } catch (e) {
          console.error('[WHL] ❌ Erro ao enviar arquivo:', e);
          sendResponse({ success: false, error: e.message });
        }
      })();
      
      return true;
    }
    
    return false;
  });

  // Helper: Obter ID do chat ativo
  function getActiveChatId() {
    try {
      // Método 1: Via URL
      const match = window.location.href.match(/\/([0-9]+@[cs]\.us)/);
      if (match) return match[1];
      
      // Método 2: Via elemento do chat
      const chatHeader = document.querySelector('[data-testid="conversation-header"]');
      if (chatHeader) {
        const phoneEl = chatHeader.querySelector('span[title]');
        if (phoneEl) {
          const phone = phoneEl.title.replace(/\D/g, '');
          if (phone.length >= 10) return phone + '@c.us';
        }
      }
      
      // Método 3: Via data attribute
      const chatEl = document.querySelector('[data-id]');
      if (chatEl?.dataset?.id) {
        return chatEl.dataset.id;
      }
      
      return null;
    } catch (e) {
      console.error('[WHL] Erro ao obter chat ativo:', e);
      return null;
    }
  }

  // Helper: Determinar tipo de mídia pelo MIME type
  function getMediaTypeFromMime(mimeType) {
    if (!mimeType) return 'document';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'document';
  }

  // Helper: Enviar mídia via API própria (WPP Hooks)
  async function sendMediaMessage(chatId, mediaConfig) {
    return new Promise((resolve) => {
      // Enviar via postMessage para o mundo MAIN (onde WPP Hooks está)
      const messageId = 'whl_media_' + Date.now();
      
      const handler = (event) => {
        if (event.data?.type === 'WHL_MEDIA_SENT' && event.data?.messageId === messageId) {
          window.removeEventListener('message', handler);
          resolve(event.data.success);
        }
      };
      
      window.addEventListener('message', handler);
      
      // Timeout de 30s
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve(false);
      }, 30000);
      
      window.postMessage({
        type: 'WHL_SEND_MEDIA',
        messageId: messageId,
        chatId: chatId,
        media: mediaConfig
      }, window.location.origin);
    });
  }

  // ============================================
  // 🛡️ PRIVACY SHIELD — Bridge content ↔ módulos
  // ============================================
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return false;

    // Privacy: Ocultar Online
    if (msg.action === 'whlPrivacySetOnline') {
      if (window.WHL_PrivacyShield) {
        window.WHL_PrivacyShield.setHideOnline(msg.hide);
        sendResponse({ ok: true });
      } else {
        // Fallback via postMessage
        window.postMessage({ type: 'WHL_PRIVACY_SET_ONLINE', payload: { hide: msg.hide } }, window.location.origin);
        sendResponse({ ok: true, fallback: true });
      }
      return false;
    }

    // Privacy: Ocultar Typing
    if (msg.action === 'whlPrivacySetTyping') {
      if (window.WHL_PrivacyShield) {
        window.WHL_PrivacyShield.setHideTyping(msg.hide);
        sendResponse({ ok: true });
      } else {
        window.postMessage({ type: 'WHL_PRIVACY_SET_TYPING', payload: { hide: msg.hide } }, window.location.origin);
        sendResponse({ ok: true, fallback: true });
      }
      return false;
    }

    // Status Download: toggle
    if (msg.action === 'whlStatusDownloadSet') {
      if (window.WHL_StatusDownload) {
        msg.enabled ? window.WHL_StatusDownload.enable() : window.WHL_StatusDownload.disable();
        sendResponse({ ok: true });
      } else {
        window.postMessage({ type: 'WHL_STATUS_DOWNLOAD_SET', payload: { enabled: msg.enabled } }, window.location.origin);
        sendResponse({ ok: true, fallback: true });
      }
      return false;
    }

    // View Once Saver: toggle
    if (msg.action === 'whlViewOnceSet') {
      if (window.WHL_ViewOnceSaver) {
        msg.enabled ? window.WHL_ViewOnceSaver.enable() : window.WHL_ViewOnceSaver.disable();
        sendResponse({ ok: true });
      } else {
        window.postMessage({ type: 'WHL_VIEW_ONCE_TOGGLE' }, window.location.origin);
        sendResponse({ ok: true, fallback: true });
      }
      return false;
    }

    return false;
  });

