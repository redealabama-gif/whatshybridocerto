/**
 * WhatsHybrid Human Typing Simulator v7.5.0
 * Simula digitação humana com velocidade variável
 * Anti-ban stealth features incluídas
 */
(function() {
  'use strict';

  // Configuração Stealth Anti-Ban
  const STEALTH_CONFIG = {
    typingDelayMin: 30,
    typingDelayMax: 120,
    beforeSendDelayMin: 200,
    beforeSendDelayMax: 800,
    delayVariation: 0.3,
    humanHoursStart: 7,
    humanHoursEnd: 22,
    maxMessagesPerHour: 30,
    randomLongPauseChance: 0.05,
    randomLongPauseMin: 30000,
    randomLongPauseMax: 120000
  };

  const CONFIG = {
    minDelay: STEALTH_CONFIG.typingDelayMin,
    maxDelay: STEALTH_CONFIG.typingDelayMax,
    punctuationPause: 150,
    commaPause: 100
  };

  // Controle de rate limit
  const messageTimestamps = [];

  async function humanType(field, text, opts = {}) {
    if (!field || !text) return false;
    
    const min = opts.minDelay || CONFIG.minDelay;
    const max = opts.maxDelay || CONFIG.maxDelay;
    
    field.focus();
    await sleep(100);
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      // Inserir caractere
      if (field.contentEditable === 'true') {
        document.execCommand('insertText', false, char);
      } else {
        const start = field.selectionStart || 0;
        field.value = field.value.substring(0, start) + char + field.value.substring(field.selectionEnd || 0);
        field.selectionStart = field.selectionEnd = start + 1;
      }
      
      // Disparar eventos
      field.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Calcular delay com variação humana
      let delay = Math.random() * (max - min) + min;
      
      // Variação adicional (±30%)
      const variation = delay * STEALTH_CONFIG.delayVariation;
      delay += (Math.random() - 0.5) * 2 * variation;
      
      // Pausas em pontuação
      if (['.', '!', '?', ';'].includes(char)) delay += CONFIG.punctuationPause;
      else if (char === ',') delay += CONFIG.commaPause;
      
      // 2% de chance de pausa "pensando"
      if (Math.random() < 0.02) {
        delay += Math.random() * 500 + 300; // 300-800ms extra
      }
      
      await sleep(delay);
    }
    
    console.log('[HumanTyping] ✅ Digitação concluída');
    return true;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * Verifica se está dentro do horário humano (7h-22h)
   * @returns {boolean}
   */
  function isHumanHour() {
    const now = new Date();
    const hour = now.getHours();
    return hour >= STEALTH_CONFIG.humanHoursStart && hour < STEALTH_CONFIG.humanHoursEnd;
  }

  /**
   * Verifica rate limit (máximo 30 msgs/hora)
   * @returns {boolean} - true se está dentro do limite
   */
  function checkRateLimit() {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    // Remove timestamps antigos
    while (messageTimestamps.length > 0 && messageTimestamps[0] < oneHourAgo) {
      messageTimestamps.shift();
    }
    
    // Verifica se ultrapassou o limite
    if (messageTimestamps.length >= STEALTH_CONFIG.maxMessagesPerHour) {
      console.warn('[HumanTyping] ⚠️ Rate limit atingido:', messageTimestamps.length, 'msgs na última hora');
      return false;
    }
    
    return true;
  }

  /**
   * Registra envio de mensagem para controle de rate limit
   */
  function recordMessageSent() {
    messageTimestamps.push(Date.now());
    console.log('[HumanTyping] Mensagem registrada. Total na última hora:', messageTimestamps.length);
  }

  /**
   * Pode fazer uma pausa longa aleatória (5% chance, 30s-2min)
   * @returns {Promise<void>}
   */
  async function maybeRandomLongPause() {
    if (Math.random() < STEALTH_CONFIG.randomLongPauseChance) {
      const pauseDuration = Math.random() * 
        (STEALTH_CONFIG.randomLongPauseMax - STEALTH_CONFIG.randomLongPauseMin) + 
        STEALTH_CONFIG.randomLongPauseMin;
      
      console.log('[HumanTyping] 💤 Pausa longa aleatória:', Math.round(pauseDuration / 1000), 's');
      await sleep(pauseDuration);
    }
  }

  /**
   * Delay antes de enviar (200-800ms)
   * @returns {Promise<void>}
   */
  async function beforeSendDelay() {
    const delay = Math.random() * 
      (STEALTH_CONFIG.beforeSendDelayMax - STEALTH_CONFIG.beforeSendDelayMin) + 
      STEALTH_CONFIG.beforeSendDelayMin;
    
    await sleep(delay);
  }

  // Função para digitar no WhatsApp
  async function typeInWhatsApp(text, opts = {}) {
    const selectors = [
      'footer div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][role="textbox"]',
      '[data-testid="conversation-compose-box-input"]'
    ];
    
    for (const sel of selectors) {
      const field = document.querySelector(sel);
      if (field) return humanType(field, text, opts);
    }
    
    console.error('[HumanTyping] Campo não encontrado');
    return false;
  }

  // API Pública
  window.HumanTyping = {
    type: humanType,
    typeInWhatsApp: typeInWhatsApp,
    config: CONFIG,
    stealthConfig: STEALTH_CONFIG,
    isHumanHour: isHumanHour,
    checkRateLimit: checkRateLimit,
    recordMessageSent: recordMessageSent,
    maybeRandomLongPause: maybeRandomLongPause,
    beforeSendDelay: beforeSendDelay
  };

  window.humanType = humanType;
  window.simulateHumanTyping = humanType;

  console.log('[HumanTyping] ✅ Módulo carregado com stealth features');
})();
