/**
 * 🏪 WhatsApp Store - Wrapper seguro para window.Store
 * WhatsHybrid v7.9.12
 * 
 * Provê acesso seguro e robusto às APIs internas do WhatsApp Web.
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const CONFIG = {
    WAIT_TIMEOUT: 15000,
    POLL_INTERVAL: 500
  };

  /**
   * Verifica se window.Store está disponível
   * @returns {boolean}
   */
  function isStoreAvailable() {
    try {
      return !!(
        window.Store &&
        window.Store.Chat &&
        typeof window.Store.Chat.find === 'function'
      );
    } catch (_) {
      return false;
    }
  }

  /**
   * Aguarda window.Store estar disponível
   * @param {number} timeout - Timeout em ms
   * @returns {Promise<boolean>}
   */
  async function waitForStore(timeout = CONFIG.WAIT_TIMEOUT) {
    if (isStoreAvailable()) return true;

    const start = Date.now();
    
    return new Promise((resolve) => {
      const check = () => {
        if (isStoreAvailable()) {
          resolve(true);
          return;
        }
        
        if (Date.now() - start >= timeout) {
          console.warn('[WHLStore] Timeout aguardando window.Store');
          resolve(false);
          return;
        }
        
        setTimeout(check, CONFIG.POLL_INTERVAL);
      };
      
      check();
    });
  }

  /**
   * Obtém um objeto do Store de forma segura
   * @param {string} path - Caminho no Store (ex: 'Chat', 'Contact')
   * @returns {any}
   */
  function get(path) {
    if (!isStoreAvailable()) {
      console.warn('[WHLStore] Store não disponível');
      return null;
    }

    try {
      const parts = path.split('.');
      let current = window.Store;
      
      for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
          current = current[part];
        } else {
          return null;
        }
      }
      
      return current;
    } catch (error) {
      console.error('[WHLStore] Erro ao acessar path:', path, error);
      return null;
    }
  }

  /**
   * Chama um método do Store de forma segura
   * @param {string} path - Caminho do método (ex: 'Chat.find')
   * @param {...any} args - Argumentos
   * @returns {Promise<any>}
   */
  async function call(path, ...args) {
    if (!isStoreAvailable()) {
      throw new Error('Store não disponível');
    }

    try {
      const parts = path.split('.');
      const methodName = parts.pop();
      const objPath = parts.join('.');
      
      const obj = objPath ? get(objPath) : window.Store;
      
      if (!obj || typeof obj[methodName] !== 'function') {
        throw new Error(`Método não encontrado: ${path}`);
      }
      
      return await obj[methodName](...args);
    } catch (error) {
      console.error('[WHLStore] Erro ao chamar método:', path, error);
      throw error;
    }
  }

  /**
   * Obtém chat por ID
   * @param {string} chatId - ID do chat (ex: '5511999999999@c.us')
   * @returns {Promise<Object|null>}
   */
  async function getChat(chatId) {
    try {
      if (!isStoreAvailable()) {
        await waitForStore();
      }
      
      if (!window.Store?.Chat?.find) return null;
      
      return await window.Store.Chat.find(chatId);
    } catch (error) {
      console.error('[WHLStore] Erro ao buscar chat:', chatId, error);
      return null;
    }
  }

  /**
   * Obtém contato por ID
   * @param {string} contactId - ID do contato
   * @returns {Promise<Object|null>}
   */
  async function getContact(contactId) {
    try {
      if (!isStoreAvailable()) {
        await waitForStore();
      }
      
      if (!window.Store?.Contact?.find) return null;
      
      return await window.Store.Contact.find(contactId);
    } catch (error) {
      console.error('[WHLStore] Erro ao buscar contato:', contactId, error);
      return null;
    }
  }

  /**
   * Obtém chat ativo
   * @returns {Object|null}
   */
  function getActiveChat() {
    try {
      if (!isStoreAvailable()) return null;
      return window.Store.Chat?.getActive?.() || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Obtém ID serializado do chat ativo
   * @returns {string|null}
   */
  function getActiveChatId() {
    try {
      const chat = getActiveChat();
      return chat?.id?._serialized || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Obtém mensagens de um chat
   * @param {string} chatId - ID do chat
   * @param {number} limit - Limite de mensagens
   * @returns {Promise<Array>}
   */
  async function getMessages(chatId, limit = 50) {
    try {
      const chat = await getChat(chatId);
      if (!chat) return [];
      
      // Tenta carregar mensagens mais antigas se necessário
      if (chat.msgs?.length < limit && chat.loadEarlierMsgs) {
        try {
          await chat.loadEarlierMsgs();
        } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      }
      
      const msgs = chat.msgs?.getModelsArray?.() || [];
      return msgs.slice(-limit);
    } catch (error) {
      console.error('[WHLStore] Erro ao obter mensagens:', error);
      return [];
    }
  }

  /**
   * Abre um chat por ID
   * @param {string} chatId - ID do chat
   * @returns {Promise<boolean>}
   */
  async function openChat(chatId) {
    try {
      if (!isStoreAvailable()) {
        await waitForStore();
      }
      
      // Método 1: Store.Cmd.openChatAt
      if (window.Store?.Cmd?.openChatAt) {
        const chat = await getChat(chatId);
        if (chat) {
          await window.Store.Cmd.openChatAt(chat);
          return true;
        }
      }
      
      // Método 2: chat.open()
      const chat = await getChat(chatId);
      if (chat?.open) {
        chat.open();
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('[WHLStore] Erro ao abrir chat:', chatId, error);
      return false;
    }
  }

  /**
   * Envia mensagem de texto
   * @param {string} chatId - ID do chat
   * @param {string} text - Texto da mensagem
   * @returns {Promise<boolean>}
   */
  async function sendMessage(chatId, text) {
    try {
      const chat = await getChat(chatId);
      if (!chat) {
        throw new Error('Chat não encontrado');
      }
      
      // Método 1: chat.sendMessage
      if (typeof chat.sendMessage === 'function') {
        await chat.sendMessage(text);
        return true;
      }
      
      // Método 2: Store.SendTextMsgToChat
      if (window.Store?.SendTextMsgToChat) {
        await window.Store.SendTextMsgToChat(chat, text);
        return true;
      }
      
      throw new Error('Nenhum método de envio disponível');
    } catch (error) {
      console.error('[WHLStore] Erro ao enviar mensagem:', error);
      return false;
    }
  }

  /**
   * Obtém informações do usuário logado
   * @returns {Object|null}
   */
  function getMe() {
    try {
      if (!isStoreAvailable()) return null;
      return window.Store.Conn?.me || window.Store.Me || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Verifica se está em modo business
   * @returns {boolean}
   */
  function isBusiness() {
    try {
      return !!(
        window.Store?.Conn?.isBusiness ||
        window.Store?.BusinessProfile ||
        document.querySelector('[data-testid="business-profile"]')
      );
    } catch (_) {
      return false;
    }
  }

  /**
   * Obtém lista de chats recentes
   * @param {number} limit - Limite
   * @returns {Array}
   */
  function getRecentChats(limit = 20) {
    try {
      if (!isStoreAvailable() || !window.Store.Chat) return [];
      
      const chats = window.Store.Chat.getModelsArray?.() || [];
      
      return chats
        .filter(c => c.lastReceivedKey || c.t)
        .sort((a, b) => (b.t || 0) - (a.t || 0))
        .slice(0, limit)
        .map(c => ({
          id: c.id?._serialized,
          name: c.name || c.formattedTitle || c.contact?.name,
          isGroup: c.isGroup,
          lastMessage: c.lastReceivedKey?.fromMe ? 'out' : 'in',
          timestamp: c.t
        }));
    } catch (error) {
      console.error('[WHLStore] Erro ao obter chats recentes:', error);
      return [];
    }
  }

  // Exportar globalmente
  window.WHLStore = {
    isAvailable: isStoreAvailable,
    waitFor: waitForStore,
    get,
    call,
    getChat,
    getContact,
    getActiveChat,
    getActiveChatId,
    getMessages,
    openChat,
    sendMessage,
    getMe,
    isBusiness,
    getRecentChats
  };

  console.log('[WHLStore] ✅ Wrapper do WhatsApp Store carregado');
})();
