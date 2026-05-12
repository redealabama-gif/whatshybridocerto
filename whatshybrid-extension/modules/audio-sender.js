/**
 * ============================================
 * AudioSender v2.1 - Módulo de Envio de Áudio PTT
 * ============================================
 * FIX CRÍTICO: Version guard para módulos internos do WA
 * Os nomes de módulos WAWeb* mudam a cada deploy do WhatsApp.
 * Agora usa múltiplos aliases com fallback e detecta mudança de versão.
 */

(function() {
  'use strict';

  // ============================================
  // VERSION GUARD — nomes alternativos por versão do WA
  // ============================================
  const WA_MODULE_ALIASES = {
    ChatCollection: [
      'WAWebChatCollection',
      'WAChatCollection',
      'WAWebChats',
      'WAChats'
    ],
    MediaPrep: [
      'WAWebMediaPrep',
      'WAMediaPrep',
      'WAWebSendMediaMsg',
      'WASendMediaMsg'
    ],
    OpaqueData: [
      'WAWebMediaOpaqueData',
      'WAMediaOpaqueData',
      'WAWebBlobUtils',
      'WABlobUtils'
    ]
  };

  /**
   * Tenta carregar módulo interno do WA por lista de aliases.
   * Registra qual alias funcionou para diagnóstico.
   */
  function requireWAModule(aliases) {
    if (typeof window.require !== 'function') {
      throw new Error('window.require não disponível — script não está no contexto do WhatsApp Web');
    }
    for (const alias of aliases) {
      try {
        const mod = window.require(alias);
        if (mod) {
          console.log(`[AudioSender] ✅ Módulo carregado via alias "${alias}"`);
          return mod;
        }
      } catch (e) {
        // alias não existe nesta versão do WA — tenta o próximo
      }
    }
    throw new Error(
      `Nenhum alias funcionou para ${aliases[0]}. ` +
      `O WhatsApp pode ter atualizado os nomes dos módulos internos. ` +
      `Aliases tentados: ${aliases.join(', ')}`
    );
  }

  /**
   * Detecta chats ativos de forma resiliente sem depender de módulo interno.
   * Fallback DOM-based quando ChatCollection não estiver disponível.
   */
  function findChatFallback(chatJid) {
    // Fallback via Store se disponível
    if (window.Store?.Chat?.find && chatJid) {
      try { return window.Store.Chat.find(chatJid); } catch (_) {}
    }
    // Fallback via Store.Chat.get
    if (window.Store?.Chat?.get && chatJid) {
      try { return window.Store.Chat.get(chatJid); } catch (_) {}
    }
    return null;
  }

  const AudioSender = {
    async send(audio, chatJid = null, duration = 5) {
      try {
        // Carrega módulos com version guard + fallback
        let ChatCollection, MediaPrep, OpaqueData;
        try {
          ChatCollection = requireWAModule(WA_MODULE_ALIASES.ChatCollection);
          MediaPrep     = requireWAModule(WA_MODULE_ALIASES.MediaPrep);
          OpaqueData    = requireWAModule(WA_MODULE_ALIASES.OpaqueData);
        } catch (moduleErr) {
          console.error('[AudioSender] ❌ Falha ao carregar módulos WA:', moduleErr.message);
          return { success: false, error: moduleErr.message, reason: 'MODULE_UNAVAILABLE' };
        }

        // Obtém array de chats — copia estática para evitar mutação durante iteração
        const chats = Array.from(
          ChatCollection.ChatCollection?.getModelsArray?.() || []
        );

        let chat = chatJid
          ? chats.find(c => c.id?._serialized === chatJid || c.id?.user === chatJid.split('@')[0])
          : chats.find(c => c.active) || chats[0];

        // Fallback DOM quando módulo não encontrou o chat
        if (!chat && chatJid) {
          chat = await findChatFallback(chatJid);
        }

        if (!chat) {
          return { success: false, error: 'Chat não encontrado' };
        }

        let blob;
        if (audio instanceof Blob) {
          blob = audio;
        } else if (typeof audio === 'string') {
          const response = await fetch(audio);
          if (!response.ok) throw new Error(`Falha ao baixar áudio: HTTP ${response.status}`);
          blob = await response.blob();
        } else {
          return { success: false, error: 'Formato de áudio inválido' };
        }

        if (blob.size === 0) {
          return { success: false, error: 'Arquivo de áudio vazio' };
        }

        // Tenta createFromData com fallback para create
        let mediaBlob;
        if (typeof OpaqueData.createFromData === 'function') {
          mediaBlob = await OpaqueData.createFromData(blob, blob.type);
        } else if (typeof OpaqueData.create === 'function') {
          mediaBlob = await OpaqueData.create(blob, blob.type);
        } else {
          throw new Error('OpaqueData não tem método createFromData nem create');
        }

        const mediaPropsPromise = Promise.resolve({
          mediaBlob,
          mimetype: 'audio/ogg; codecs=opus',
          type: 'ptt',
          duration,
          seconds: duration,
          isPtt: true,
          ptt: true
        });

        const mediaPrep = new MediaPrep.MediaPrep('ptt', mediaPropsPromise);
        await mediaPrep.waitForPrep();
        const result = await MediaPrep.sendMediaMsgToChat(mediaPrep, chat, {});

        return {
          success: result.messageSendResult === 'OK',
          result,
          chatJid: chat.id?._serialized
        };

      } catch (error) {
        console.error('[AudioSender] Erro:', error);
        return { success: false, error: error.message };
      }
    },

    async sendBase64(base64, mimeType, chatJid, duration = 5) {
      const dataUrl = `data:${mimeType};base64,${base64}`;
      return this.send(dataUrl, chatJid, duration);
    },

    async sendArrayBuffer(arrayBuffer, mimeType, chatJid, duration = 5) {
      const blob = new Blob([arrayBuffer], { type: mimeType });
      return this.send(blob, chatJid, duration);
    },

    /**
     * Verifica disponibilidade testando aliases — não lança exceção.
     * Retorna detalhes para diagnóstico.
     */
    isAvailable() {
      if (typeof window.require !== 'function') return false;
      try {
        requireWAModule(WA_MODULE_ALIASES.ChatCollection);
        requireWAModule(WA_MODULE_ALIASES.MediaPrep);
        requireWAModule(WA_MODULE_ALIASES.OpaqueData);
        return true;
      } catch (e) {
        console.warn('[AudioSender] isAvailable=false:', e.message);
        return false;
      }
    }
  };

  window.AudioSender = AudioSender;
  console.log('[AudioSender] ✅ v2.1 carregado (version guard ativo)');
})();
