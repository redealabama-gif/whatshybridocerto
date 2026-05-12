/**
 * ⏱️ Timeouts - Constantes centralizadas de timeout
 * WhatsHybrid v7.9.12
 * 
 * Este arquivo centraliza todos os valores de timeout usados pela extensão
 * para facilitar ajustes globais e manutenção.
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const TIMEOUTS = {
    // ══════════════════════════════════════════════════════════════
    // REDE E API
    // ══════════════════════════════════════════════════════════════
    API_REQUEST: 30000,           // 30s - Requisição HTTP padrão
    API_REQUEST_SHORT: 10000,     // 10s - Requisições rápidas
    API_REQUEST_LONG: 60000,      // 60s - Requisições pesadas (uploads, etc)
    BACKEND_CONNECT: 15000,       // 15s - Conexão inicial com backend
    WEBSOCKET_PING: 25000,        // 25s - Intervalo de ping WebSocket
    WEBSOCKET_RECONNECT: 5000,    // 5s - Delay para reconexão WebSocket
    
    // ══════════════════════════════════════════════════════════════
    // IA E PROCESSAMENTO
    // ══════════════════════════════════════════════════════════════
    AI_SUGGESTION: 15000,         // 15s - Gerar sugestão
    AI_MEMORY_UPDATE: 5000,       // 5s - Atualizar memória
    AI_CONTEXT_LOAD: 3000,        // 3s - Carregar contexto
    
    // ══════════════════════════════════════════════════════════════
    // UI E INTERAÇÃO
    // ══════════════════════════════════════════════════════════════
    UI_DEBOUNCE: 300,             // 300ms - Debounce de input
    UI_TOAST: 3000,               // 3s - Duração de toast
    UI_TOAST_ERROR: 5000,         // 5s - Duração de toast de erro
    UI_ANIMATION: 300,            // 300ms - Duração de animações
    UI_TRANSITION: 200,           // 200ms - Transições CSS
    UI_INJECTION_RETRY: 2000,     // 2s - Retry de injeção de UI
    UI_INJECTION_MAX_RETRIES: 10, // Número máximo de tentativas
    
    // ══════════════════════════════════════════════════════════════
    // WHATSAPP E DOM
    // ══════════════════════════════════════════════════════════════
    WA_STORE_WAIT: 10000,         // 10s - Aguardar window.Store
    WA_STORE_POLL: 500,           // 500ms - Intervalo de polling para Store
    WA_DOM_READY: 5000,           // 5s - DOM do WhatsApp pronto
    WA_CHAT_OPEN: 2000,           // 2s - Aguardar chat abrir
    WA_MESSAGE_SEND: 1500,        // 1.5s - Aguardar após enviar mensagem
    WA_MESSAGE_CONFIRM: 6000,     // 6s - Confirmar envio (checkmark)
    WA_TYPING_INDICATOR: 3000,    // 3s - Mostrar "digitando..."
    
    // ══════════════════════════════════════════════════════════════
    // AUTOPILOT E AUTOMAÇÃO
    // ══════════════════════════════════════════════════════════════
    AUTOPILOT_MIN_DELAY: 2000,    // 2s - Delay mínimo entre ações
    AUTOPILOT_MAX_DELAY: 5000,    // 5s - Delay máximo entre ações
    AUTOPILOT_RATE_WINDOW: 60000, // 60s - Janela de rate limiting
    AUTOPILOT_COOLDOWN: 10000,    // 10s - Cooldown entre chats
    
    // ══════════════════════════════════════════════════════════════
    // SINCRONIZAÇÃO E PERSISTÊNCIA
    // ══════════════════════════════════════════════════════════════
    SYNC_INTERVAL: 60000,         // 60s - Intervalo de sincronização
    SYNC_DEBOUNCE: 5000,          // 5s - Debounce de sync após mudança
    SYNC_RETRY: 30000,            // 30s - Retry de sync após falha
    STORAGE_SAVE: 1000,           // 1s - Debounce de salvamento
    CLEANUP_INTERVAL: 86400000,   // 24h - Intervalo de limpeza
    
    // ══════════════════════════════════════════════════════════════
    // MÓDULOS E INICIALIZAÇÃO
    // ══════════════════════════════════════════════════════════════
    MODULE_INIT: 10000,           // 10s - Timeout de inicialização de módulo
    MODULE_INIT_RETRY: 2000,      // 2s - Retry de inicialização
    SYSTEM_READY: 30000,          // 30s - Sistema completo pronto
    
    // ══════════════════════════════════════════════════════════════
    // CACHE
    // ══════════════════════════════════════════════════════════════
    CACHE_TTL: 3600000,           // 1h - TTL padrão de cache
    CACHE_TTL_SHORT: 300000,      // 5min - TTL curto
    CACHE_TTL_LONG: 86400000,     // 24h - TTL longo
    
    // ══════════════════════════════════════════════════════════════
    // HUMAN TYPING
    // ══════════════════════════════════════════════════════════════
    TYPING_MIN_DELAY: 25,         // 25ms - Delay mínimo entre caracteres
    TYPING_MAX_DELAY: 65,         // 65ms - Delay máximo entre caracteres
    TYPING_PAUSE_SHORT: 100,      // 100ms - Pausa curta (vírgula, etc)
    TYPING_PAUSE_LONG: 300,       // 300ms - Pausa longa (ponto, etc)
    TYPING_RANDOM_PAUSE: 2000     // 2s - Pausa aleatória ocasional
  };

  /**
   * Obtém timeout com multiplicador opcional
   * @param {string} key - Chave do timeout
   * @param {number} multiplier - Multiplicador opcional
   * @returns {number} - Valor do timeout
   */
  function get(key, multiplier = 1) {
    const value = TIMEOUTS[key];
    if (value === undefined) {
      console.warn(`[Timeouts] Chave desconhecida: ${key}`);
      return 5000; // fallback
    }
    return Math.round(value * multiplier);
  }

  /**
   * Adiciona jitter a um timeout para evitar thundering herd
   * @param {number} timeout - Timeout base
   * @param {number} jitterPercent - Porcentagem de jitter (0-1)
   * @returns {number} - Timeout com jitter
   */
  function withJitter(timeout, jitterPercent = 0.2) {
    const jitter = timeout * jitterPercent * (Math.random() - 0.5) * 2;
    return Math.round(timeout + jitter);
  }

  /**
   * Escala todos os timeouts por um fator (útil para debugging)
   * @param {number} factor - Fator de escala
   */
  function scaleAll(factor) {
    for (const key in TIMEOUTS) {
      if (typeof TIMEOUTS[key] === 'number') {
        TIMEOUTS[key] = Math.round(TIMEOUTS[key] * factor);
      }
    }
    console.log(`[Timeouts] Todos os valores escalados por ${factor}`);
  }

  // Exportar globalmente
  window.TIMEOUTS = TIMEOUTS;
  window.WHLTimeouts = {
    values: TIMEOUTS,
    get,
    withJitter,
    scaleAll
  };

  console.log('[Timeouts] ✅ Constantes de timeout carregadas');
})();
