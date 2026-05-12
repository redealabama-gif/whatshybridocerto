/**
 * ============================================
 * DocumentSender v2.1 - Módulo de Envio de Documentos
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
   */
  function requireWAModule(aliases) {
    if (typeof window.require !== 'function') {
      throw new Error('window.require não disponível — script não está no contexto do WhatsApp Web');
    }
    for (const alias of aliases) {
      try {
        const mod = window.require(alias);
        if (mod) {
          console.log(`[DocumentSender] ✅ Módulo carregado via alias "${alias}"`);
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
   * Detecta chats de forma resiliente sem depender de módulo interno.
   */
  function findChatFallback(chatJid) {
    if (window.Store?.Chat?.find && chatJid) {
      try { return window.Store.Chat.find(chatJid); } catch (_) {}
    }
    if (window.Store?.Chat?.get && chatJid) {
      try { return window.Store.Chat.get(chatJid); } catch (_) {}
    }
    return null;
  }

  const DocumentSender = {
    async send(arquivo, chatJid = null, opcoes = {}) {
      try {
        // Carrega módulos com version guard + fallback
        let ChatCollection, MediaPrep, OpaqueData;
        try {
          ChatCollection = requireWAModule(WA_MODULE_ALIASES.ChatCollection);
          MediaPrep     = requireWAModule(WA_MODULE_ALIASES.MediaPrep);
          OpaqueData    = requireWAModule(WA_MODULE_ALIASES.OpaqueData);
        } catch (moduleErr) {
          console.error('[DocumentSender] ❌ Falha ao carregar módulos WA:', moduleErr.message);
          return { success: false, error: moduleErr.message, reason: 'MODULE_UNAVAILABLE' };
        }

        // Cópia estática do array de chats para evitar mutação durante iteração
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
        let filename = opcoes.filename || 'arquivo';

        if (arquivo instanceof File) {
          blob = arquivo;
          filename = arquivo.name || filename;
        } else if (arquivo instanceof Blob) {
          blob = arquivo;
        } else if (typeof arquivo === 'string') {
          const response = await fetch(arquivo);
          if (!response.ok) throw new Error(`Falha ao baixar arquivo: HTTP ${response.status}`);
          blob = await response.blob();
        } else {
          return { success: false, error: 'Formato de arquivo inválido' };
        }

        if (blob.size === 0) {
          return { success: false, error: 'Arquivo vazio' };
        }

        const mimetype = opcoes.mimetype || blob.type || 'application/octet-stream';

        // Tenta createFromData com fallback para create
        let mediaBlob;
        if (typeof OpaqueData.createFromData === 'function') {
          mediaBlob = await OpaqueData.createFromData(blob, mimetype);
        } else if (typeof OpaqueData.create === 'function') {
          mediaBlob = await OpaqueData.create(blob, mimetype);
        } else {
          throw new Error('OpaqueData não tem método createFromData nem create');
        }

        const mediaPropsPromise = Promise.resolve({
          mediaBlob,
          mimetype,
          type: 'document',
          filename,
          caption: opcoes.caption || '',
          size: blob.size
        });

        const mediaPrep = new MediaPrep.MediaPrep('document', mediaPropsPromise);
        await mediaPrep.waitForPrep();
        const result = await MediaPrep.sendMediaMsgToChat(mediaPrep, chat, {});

        return {
          success: result.messageSendResult === 'OK',
          result,
          chatJid: chat.id?._serialized,
          filename
        };

      } catch (error) {
        console.error('[DocumentSender] Erro:', error);
        return { success: false, error: error.message };
      }
    },

    async sendBase64(base64, filename, mimetype, chatJid, caption = '') {
      const dataUrl = `data:${mimetype};base64,${base64}`;
      return this.send(dataUrl, chatJid, { filename, mimetype, caption });
    },

    async sendArrayBuffer(arrayBuffer, filename, mimetype, chatJid, caption = '') {
      const blob = new Blob([arrayBuffer], { type: mimetype });
      return this.send(blob, chatJid, { filename, mimetype, caption });
    },

    async sendText(texto, filename, chatJid, caption = '') {
      const blob = new Blob([texto], { type: 'text/plain' });
      return this.send(blob, chatJid, { filename, mimetype: 'text/plain', caption });
    },

    /**
     * Verifica disponibilidade testando aliases — não lança exceção.
     */
    isAvailable() {
      if (typeof window.require !== 'function') return false;
      try {
        requireWAModule(WA_MODULE_ALIASES.ChatCollection);
        requireWAModule(WA_MODULE_ALIASES.MediaPrep);
        requireWAModule(WA_MODULE_ALIASES.OpaqueData);
        return true;
      } catch (e) {
        console.warn('[DocumentSender] isAvailable=false:', e.message);
        return false;
      }
    }
  };

  window.DocumentSender = DocumentSender;
  console.log('[DocumentSender] ✅ v2.1 carregado (version guard ativo)');
})();
