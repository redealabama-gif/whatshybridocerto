/**
 * 🛡️ Privacy Shield v1.0 - Mascarar status Online e indicador Digitando
 *
 * Portado do WAIncognito e adaptado para WhatsHybrid Pro.
 * Intercepta as chamadas internas do WhatsApp Web para:
 *   - Bloquear o envio do status "online" (você aparece offline)
 *   - Bloquear o indicador "digitando..." para os outros não verem
 *
 * Usa monkey-patch sobre os módulos internos via require(),
 * a mesma abordagem já usada em wpp-hooks.js.
 *
 * @version 1.0.0
 * @author WhatsHybrid Pro (baseado em WAIncognito by tomer8007)
 */

(function () {
  'use strict';

  if (window.__WHL_PRIVACY_SHIELD__) return;
  window.__WHL_PRIVACY_SHIELD__ = true;

  // ============================================================
  // CONFIGURAÇÃO PERSISTENTE
  // ============================================================

  const KEYS = {
    ONLINE: 'whl_privacy_hide_online',
    TYPING: 'whl_privacy_hide_typing'
  };

  const state = {
    hideOnline: localStorage.getItem(KEYS.ONLINE) === 'true',
    hideTyping: localStorage.getItem(KEYS.TYPING) === 'true'
  };

  const DEBUG = localStorage.getItem('whl_debug') === 'true';
  function log(...args) { if (DEBUG) console.log('[WHL PrivacyShield]', ...args); }

  // ============================================================
  // HOOKS INTERNOS
  // ============================================================

  let originalSendPresence = null;
  let originalUpdatePresence = null;
  let presenceHookInstalled = false;

  /**
   * Hook 1: Módulo WASendPresenceStatusProtocol
   * Controla o envio do status "available" (online) ao servidor.
   */
  function hookSendPresenceProtocol() {
    try {
      const mod = require('WASendPresenceStatusProtocol');
      if (!mod?.sendPresenceStatusProtocol) return false;

      if (!originalSendPresence) {
        originalSendPresence = mod.sendPresenceStatusProtocol;
      }

      mod.sendPresenceStatusProtocol = function (...args) {
        const presenceType = args[0]; // 'available' | 'unavailable'
        if (state.hideOnline && presenceType === 'available') {
          log('🔇 Bloqueado: sendPresenceStatusProtocol(available)');
          return Promise.resolve(); // Suprimir silenciosamente
        }
        return originalSendPresence.apply(this, args);
      };

      log('✅ Hook sendPresenceStatusProtocol instalado');
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Hook 2: WAWebPresenceUtils / WAWebComms
   * Controla "composing" (digitando) e "paused".
   */
  function hookComposing() {
    try {
      // Tentativa via WAWebComms (módulo de comunicação)
      const comms = (() => {
        try { return require('WAComms').getComms?.(); } catch { return null; }
      })();

      if (comms?.sendPresence) {
        const originalCommsPresence = comms.sendPresence.bind(comms);
        comms.sendPresence = function (presenceType, ...rest) {
          if (state.hideTyping && (presenceType === 'composing' || presenceType === 'paused')) {
            log('🔇 Bloqueado: comms.sendPresence(composing)');
            return Promise.resolve();
          }
          if (state.hideOnline && presenceType === 'available') {
            log('🔇 Bloqueado: comms.sendPresence(available)');
            return Promise.resolve();
          }
          return originalCommsPresence(presenceType, ...rest);
        };
        log('✅ Hook WAComms.sendPresence instalado');
      }
    } catch (e) {
      log('⚠️ WAComms hook falhou:', e.message);
    }

    try {
      // Tentativa via WAWebPresenceUtils
      const presUtils = require('WAWebPresenceUtils');
      if (presUtils?.sendComposing) {
        const orig = presUtils.sendComposing;
        presUtils.sendComposing = function (...args) {
          if (state.hideTyping) {
            log('🔇 Bloqueado: sendComposing()');
            return Promise.resolve();
          }
          return orig.apply(this, args);
        };
        log('✅ Hook WAWebPresenceUtils.sendComposing instalado');
      }
    } catch (e) {
      log('⚠️ WAWebPresenceUtils hook falhou (pode não existir)');
    }

    // Hook via chat.presence (abordagem usada em wpp-hooks.js)
    hookChatPresence();
  }

  /**
   * Hook 3: chat.presence.update — para typing no nível do objeto chat
   * O wpp-hooks.js já usa isso em sendWithTypingIndicator, aqui hookamos
   * globalmente para qualquer tentativa do WA de enviar composing.
   */
  function hookChatPresence() {
    try {
      if (typeof require !== 'function') return;
      const CC = require('WAWebChatCollection');
      const ChatCollection = CC?.ChatCollection;
      if (!ChatCollection) return;

      // Monkey-patch no prototype do ChatModel para interceptar presence.update
      const ChatModel = (() => {
        try { return require('WAWebChatModel')?.ChatModel; } catch { return null; }
      })();

      if (ChatModel?.prototype) {
        const presenceProto = ChatModel.prototype;

        // Hookar o getter/setter de presence se existir
        const origPresenceDescriptor = Object.getOwnPropertyDescriptor(presenceProto, 'presence');
        if (origPresenceDescriptor && origPresenceDescriptor.get) {
          Object.defineProperty(presenceProto, 'presence', {
            get() {
              const realPresence = origPresenceDescriptor.get.call(this);
              if (!realPresence) return realPresence;

              // Wrapping do update()
              if (realPresence.update && !realPresence.__whl_hooked__) {
                const originalUpdate = realPresence.update.bind(realPresence);
                realPresence.update = function (presenceType) {
                  if (state.hideTyping && (presenceType === 'composing' || presenceType === 'paused')) {
                    log('🔇 Bloqueado: chat.presence.update(composing)');
                    return Promise.resolve();
                  }
                  if (state.hideOnline && presenceType === 'available') {
                    log('🔇 Bloqueado: chat.presence.update(available)');
                    return Promise.resolve();
                  }
                  return originalUpdate(presenceType);
                };
                realPresence.__whl_hooked__ = true;
              }
              return realPresence;
            },
            set: origPresenceDescriptor.set,
            configurable: true
          });
          log('✅ Hook chat.presence instalado');
        }
      }
    } catch (e) {
      log('⚠️ Hook chat.presence falhou:', e.message);
    }
  }

  /**
   * Hook 4: Patching direto do WebSocket send para bloquear presence packets
   * Fallback de último recurso — bloqueio no nível do WebSocket nativo.
   * Similar ao que o WAIncognito faz, mas sem decriptação — apenas filtra
   * pequenos pacotes de texto que contenham "presence" ou "composing".
   */
  function hookWebSocketFallback() {
    if (window.__whl_ws_presence_hooked__) return;
    window.__whl_ws_presence_hooked__ = true;

    const OriginalWS = window.WebSocket;

    function PatchedWebSocket(...args) {
      const ws = new OriginalWS(...args);
      const origSend = ws.send.bind(ws);

      ws.send = function (data) {
        // Só filtrar strings JSON (pacotes de presença são geralmente texto curto)
        if (typeof data === 'string' && data.length < 500) {
          try {
            if (state.hideOnline && data.includes('"presence"') && data.includes('"available"')) {
              log('🔇 WS: bloqueado pacote presence available');
              return;
            }
            if (state.hideTyping && data.includes('"composing"')) {
              log('🔇 WS: bloqueado pacote composing');
              return;
            }
          } catch { /* seguir normalmente */ }
        }
        return origSend(data);
      };

      return ws;
    }

    // Copiar prototype e propriedades estáticas
    PatchedWebSocket.prototype = OriginalWS.prototype;
    Object.setPrototypeOf(PatchedWebSocket, OriginalWS);
    // FIX: CONNECTING/OPEN/CLOSING/CLOSED são read-only no WebSocket nativo
    try { PatchedWebSocket.CONNECTING = OriginalWS.CONNECTING; } catch (_) {}
    try { PatchedWebSocket.OPEN = OriginalWS.OPEN; } catch (_) {}
    try { PatchedWebSocket.CLOSING = OriginalWS.CLOSING; } catch (_) {}
    try { PatchedWebSocket.CLOSED = OriginalWS.CLOSED; } catch (_) {}

    try {
      Object.defineProperty(window, 'WebSocket', {
        value: PatchedWebSocket,
        writable: true,
        configurable: true
      });
      log('✅ Hook WebSocket fallback instalado');
    } catch (e) {
      log('⚠️ WebSocket patch falhou:', e.message);
    }
  }

  // ============================================================
  // INSTALAÇÃO DOS HOOKS
  // ============================================================

  function installHooks() {
    if (presenceHookInstalled) return;

    let installed = false;

    installed = hookSendPresenceProtocol() || installed;
    hookComposing();

    // WebSocket fallback sempre ativo (custo mínimo quando não há dados para bloquear)
    hookWebSocketFallback();

    presenceHookInstalled = true;
    log('Hooks instalados. Online:', state.hideOnline, '| Typing:', state.hideTyping);
  }

  /**
   * Tenta instalar após os módulos do WA estarem disponíveis.
   */
  function waitAndInstall() {
    let attempts = 0;
    const interval = setInterval(() => {
      try {
        if (typeof require === 'function' && require('WAWebMessageProcessRenderable')) {
          installHooks();
          clearInterval(interval);
          return;
        }
      } catch { /* ainda carregando */ }
      if (++attempts > 60) {
        // Timeout: instalar mesmo sem módulos (fallback WS vai funcionar)
        installHooks();
        clearInterval(interval);
      }
    }, 150);
  }

  // ============================================================
  // API PÚBLICA
  // ============================================================

  window.WHL_PrivacyShield = {
    // Online
    setHideOnline(value) {
      state.hideOnline = !!value;
      localStorage.setItem(KEYS.ONLINE, state.hideOnline);
      log('hideOnline =', state.hideOnline);
      // Disparar evento para atualizar UI do painel
      window.postMessage({ type: 'WHL_PRIVACY_STATE_UPDATE', state: this.getState() }, window.location.origin);
    },
    toggleOnline() {
      this.setHideOnline(!state.hideOnline);
      return state.hideOnline;
    },
    isHidingOnline: () => state.hideOnline,

    // Typing
    setHideTyping(value) {
      state.hideTyping = !!value;
      localStorage.setItem(KEYS.TYPING, state.hideTyping);
      log('hideTyping =', state.hideTyping);
      window.postMessage({ type: 'WHL_PRIVACY_STATE_UPDATE', state: this.getState() }, window.location.origin);
    },
    toggleTyping() {
      this.setHideTyping(!state.hideTyping);
      return state.hideTyping;
    },
    isHidingTyping: () => state.hideTyping,

    // Estado geral
    getState: () => ({ hideOnline: state.hideOnline, hideTyping: state.hideTyping }),

    // Reinstalar hooks (útil após updates do WA)
    reinstall() {
      presenceHookInstalled = false;
      installHooks();
    }
  };

  // ============================================================
  // MENSAGENS DO SIDEPANEL / POPUP
  // ============================================================

  window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin) return;
    const { type, payload } = e.data || {};

    if (type === 'WHL_PRIVACY_SET_ONLINE') {
      window.WHL_PrivacyShield.setHideOnline(payload?.hide ?? !state.hideOnline);
    }
    if (type === 'WHL_PRIVACY_SET_TYPING') {
      window.WHL_PrivacyShield.setHideTyping(payload?.hide ?? !state.hideTyping);
    }
    if (type === 'WHL_PRIVACY_GET_STATE') {
      window.postMessage({ type: 'WHL_PRIVACY_STATE_UPDATE', state: window.WHL_PrivacyShield.getState() }, window.location.origin);
    }
    if (type === 'WHL_PRIVACY_TOGGLE_ONLINE') {
      window.WHL_PrivacyShield.toggleOnline();
    }
    if (type === 'WHL_PRIVACY_TOGGLE_TYPING') {
      window.WHL_PrivacyShield.toggleTyping();
    }
  });

  // Integração com EventBus
  setTimeout(() => {
    if (window.EventBus?.on) {
      window.EventBus.on('privacy:toggleOnline', () => window.WHL_PrivacyShield.toggleOnline());
      window.EventBus.on('privacy:toggleTyping', () => window.WHL_PrivacyShield.toggleTyping());
      window.EventBus.on('privacy:setOnline', (v) => window.WHL_PrivacyShield.setHideOnline(v));
      window.EventBus.on('privacy:setTyping', (v) => window.WHL_PrivacyShield.setHideTyping(v));
    }
  }, 2000);

  // ============================================================
  // INICIALIZAÇÃO
  // ============================================================

  console.log('[WHL PrivacyShield] 🛡️ Módulo v1.0 carregado');
  console.log('[WHL PrivacyShield] Estado inicial — Online:', state.hideOnline, '| Typing:', state.hideTyping);

  // Hook no WS imediatamente (antes dos módulos WA carregarem)
  hookWebSocketFallback();

  // Aguardar módulos WA para hooks mais precisos
  waitAndInstall();
})();
