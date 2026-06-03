/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║              API WHATSAPP BUSINESS INTEGRADA                              ║
 * ║                    WhatsHybrid v7.9.12                                    ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Integração com WhatsApp Business API (Cloud API)                         ║
 * ║  Suporta envio de mensagens, templates, mídia e webhooks                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

(function() {
  'use strict';

  const VERSION = '1.0.0';
  const STORAGE_KEY = 'whl_whatsapp_business_api';
  const EventBus = window.EventBus;

  // ═══════════════════════════════════════════════════════════════════
  // CONFIGURAÇÃO
  // ═══════════════════════════════════════════════════════════════════
  const CONFIG = {
    // Endpoints oficiais
    API_VERSION: 'v18.0',
    BASE_URL: 'https://graph.facebook.com',
    
    // Rate limits (por número de telefone)
    RATE_LIMIT: {
      messagesPerSecond: 80,
      messagesPerMinute: 1000,
      messagesPerDay: 100000
    },
    
    // Timeouts
    REQUEST_TIMEOUT: 30000,
    UPLOAD_TIMEOUT: 120000,
    
    // Retry
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000
  };

  // ═══════════════════════════════════════════════════════════════════
  // TIPOS DE MENSAGENS
  // ═══════════════════════════════════════════════════════════════════
  const MESSAGE_TYPES = {
    TEXT: 'text',
    IMAGE: 'image',
    VIDEO: 'video',
    AUDIO: 'audio',
    DOCUMENT: 'document',
    STICKER: 'sticker',
    LOCATION: 'location',
    CONTACTS: 'contacts',
    INTERACTIVE: 'interactive',
    TEMPLATE: 'template',
    REACTION: 'reaction'
  };

  // ═══════════════════════════════════════════════════════════════════
  // SECURITY HELPERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * SECURITY FIX P0-025: Sanitize objects to prevent Prototype Pollution
   */
  function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj;
    }

    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const sanitized = {};

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (dangerousKeys.includes(key)) {
          console.warn('[WhatsAppBusinessAPI Security] Blocked prototype pollution attempt:', key);
          continue;
        }

        if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
          sanitized[key] = sanitizeObject(obj[key]);
        } else {
          sanitized[key] = obj[key];
        }
      }
    }

    return sanitized;
  }

  // ═══════════════════════════════════════════════════════════════════
  // ESTADO
  // ═══════════════════════════════════════════════════════════════════
  const state = {
    config: {
      accessToken: '',
      phoneNumberId: '',
      businessAccountId: '',
      webhookVerifyToken: '',
      enabled: false
    },
    rateLimiter: {
      requests: [],
      lastReset: Date.now()
    },
    stats: {
      messagesSent: 0,
      messagesReceived: 0,
      templatesSent: 0,
      errors: 0,
      lastError: null
    },
    webhookHandlers: new Map()
  };

  // ═══════════════════════════════════════════════════════════════════
  // PERSISTÊNCIA
  // ═══════════════════════════════════════════════════════════════════
  async function loadConfig() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      if (stored[STORAGE_KEY]) {
        // SECURITY FIX P0-025: Sanitize storage data to prevent Prototype Pollution
        const sanitized = sanitizeObject(stored[STORAGE_KEY]);
        state.config = { ...state.config, ...sanitized.config };
        state.stats = { ...state.stats, ...sanitized.stats };
      }
    } catch (e) {
      console.error('[WhatsAppBusinessAPI] Erro ao carregar config:', e);
    }
  }

  async function saveConfig() {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          config: state.config,
          stats: state.stats
        }
      });
    } catch (e) {
      console.error('[WhatsAppBusinessAPI] Erro ao salvar config:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // RATE LIMITING
  // ═══════════════════════════════════════════════════════════════════
  function checkRateLimit() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Remove requisições antigas
    state.rateLimiter.requests = state.rateLimiter.requests.filter(t => t > oneMinuteAgo);
    
    if (state.rateLimiter.requests.length >= CONFIG.RATE_LIMIT.messagesPerMinute) {
      return { allowed: false, retryAfter: 60000 - (now - state.rateLimiter.requests[0]) };
    }
    
    return { allowed: true };
  }

  function recordRequest() {
    state.rateLimiter.requests.push(Date.now());
  }

  // ═══════════════════════════════════════════════════════════════════
  // NORMALIZAÇÃO DE TELEFONE
  // ═══════════════════════════════════════════════════════════════════
  function normalizePhoneE164(phone) {
    // Remove tudo que não é dígito
    let digits = phone.replace(/\D/g, '');
    
    // Se começa com 0, remove
    if (digits.startsWith('0')) {
      digits = digits.substring(1);
    }
    
    // Se não tem código do país, adiciona Brasil (55)
    if (digits.length === 10 || digits.length === 11) {
      digits = '55' + digits;
    }
    
    // Valida comprimento
    if (digits.length < 10 || digits.length > 15) {
      return null;
    }
    
    return digits;
  }

  // ═══════════════════════════════════════════════════════════════════
  // REQUISIÇÕES À API
  // ═══════════════════════════════════════════════════════════════════
  async function makeRequest(endpoint, method = 'GET', body = null, options = {}) {
    if (!state.config.accessToken || !state.config.phoneNumberId) {
      throw new Error('WhatsApp Business API não configurada');
    }

    // Verifica rate limit
    const rateCheck = checkRateLimit();
    if (!rateCheck.allowed) {
      throw new Error(`Rate limit excedido. Tente novamente em ${Math.ceil(rateCheck.retryAfter / 1000)}s`);
    }

    const url = `${CONFIG.BASE_URL}/${CONFIG.API_VERSION}/${endpoint}`;
    
    const headers = {
      'Authorization': `Bearer ${state.config.accessToken}`,
      'Content-Type': 'application/json'
    };

    const fetchOptions = {
      method,
      headers,
      timeout: options.timeout || CONFIG.REQUEST_TIMEOUT
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    let lastError;
    
    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, fetchOptions);
        const data = await response.json();

        recordRequest();

        if (!response.ok) {
          const error = data.error || {};
          throw new Error(error.message || `HTTP ${response.status}`);
        }

        return data;
        
      } catch (error) {
        lastError = error;
        
        // Não retry em erros de autenticação ou validação
        if (error.message.includes('401') || error.message.includes('400')) {
          break;
        }
        
        if (attempt < CONFIG.MAX_RETRIES) {
          // FIX PEND-MED-004: Use exponential backoff instead of linear
          await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY * Math.pow(2, attempt - 1)));
        }
      }
    }

    state.stats.errors++;
    state.stats.lastError = lastError.message;
    saveConfig();
    
    throw lastError;
  }

  // ═══════════════════════════════════════════════════════════════════
  // ENVIO DE MENSAGENS
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * Envia mensagem de texto
   */
  async function sendText(to, text, options = {}) {
    const phone = normalizePhoneE164(to);
    if (!phone) {
      throw new Error('Número de telefone inválido');
    }

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: MESSAGE_TYPES.TEXT,
      text: {
        preview_url: options.previewUrl !== false,
        body: text
      }
    };

    const result = await makeRequest(`${state.config.phoneNumberId}/messages`, 'POST', body);
    
    state.stats.messagesSent++;
    saveConfig();
    
    EventBus.emit('whatsapp_api:message_sent', { type: 'text', to: phone, messageId: result.messages?.[0]?.id });
    
    return {
      success: true,
      messageId: result.messages?.[0]?.id,
      phone
    };
  }

  /**
   * Envia imagem
   */
  async function sendImage(to, imageUrl, caption = '') {
    const phone = normalizePhoneE164(to);
    if (!phone) throw new Error('Número inválido');

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: MESSAGE_TYPES.IMAGE,
      image: {
        link: imageUrl,
        caption: caption || undefined
      }
    };

    const result = await makeRequest(`${state.config.phoneNumberId}/messages`, 'POST', body);
    
    state.stats.messagesSent++;
    saveConfig();
    
    return {
      success: true,
      messageId: result.messages?.[0]?.id,
      phone
    };
  }

  /**
   * Envia documento
   */
  async function sendDocument(to, documentUrl, filename, caption = '') {
    const phone = normalizePhoneE164(to);
    if (!phone) throw new Error('Número inválido');

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: MESSAGE_TYPES.DOCUMENT,
      document: {
        link: documentUrl,
        filename,
        caption: caption || undefined
      }
    };

    const result = await makeRequest(`${state.config.phoneNumberId}/messages`, 'POST', body);
    
    state.stats.messagesSent++;
    saveConfig();
    
    return {
      success: true,
      messageId: result.messages?.[0]?.id,
      phone
    };
  }

  /**
   * Envia vídeo
   */
  async function sendVideo(to, videoUrl, caption = '') {
    const phone = normalizePhoneE164(to);
    if (!phone) throw new Error('Número inválido');

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: MESSAGE_TYPES.VIDEO,
      video: {
        link: videoUrl,
        caption: caption || undefined
      }
    };

    const result = await makeRequest(`${state.config.phoneNumberId}/messages`, 'POST', body);
    
    state.stats.messagesSent++;
    saveConfig();
    
    return {
      success: true,
      messageId: result.messages?.[0]?.id,
      phone
    };
  }

  /**
   * Envia áudio
   */
  async function sendAudio(to, audioUrl) {
    const phone = normalizePhoneE164(to);
    if (!phone) throw new Error('Número inválido');

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: MESSAGE_TYPES.AUDIO,
      audio: {
        link: audioUrl
      }
    };

    const result = await makeRequest(`${state.config.phoneNumberId}/messages`, 'POST', body);
    
    state.stats.messagesSent++;
    saveConfig();
    
    return {
      success: true,
      messageId: result.messages?.[0]?.id,
      phone
    };
  }

  /**
   * Envia localização
   */
  async function sendLocation(to, latitude, longitude, name = '', address = '') {
    const phone = normalizePhoneE164(to);
    if (!phone) throw new Error('Número inválido');

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: MESSAGE_TYPES.LOCATION,
      location: {
        latitude,
        longitude,
        name: name || undefined,
        address: address || undefined
      }
    };

    const result = await makeRequest(`${state.config.phoneNumberId}/messages`, 'POST', body);
    
    state.stats.messagesSent++;
    saveConfig();
    
    return {
      success: true,
      messageId: result.messages?.[0]?.id,
      phone
    };
  }

  /**
   * Envia template
   */
  async function sendTemplate(to, templateName, languageCode = 'pt_BR', components = []) {
    const phone = normalizePhoneE164(to);
    if (!phone) throw new Error('Número inválido');

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: MESSAGE_TYPES.TEMPLATE,
      template: {
        name: templateName,
        language: {
          code: languageCode
        },
        components: components.length > 0 ? components : undefined
      }
    };

    const result = await makeRequest(`${state.config.phoneNumberId}/messages`, 'POST', body);
    
    state.stats.templatesSent++;
    saveConfig();
    
    EventBus.emit('whatsapp_api:template_sent', { template: templateName, to: phone });
    
    return {
      success: true,
      messageId: result.messages?.[0]?.id,
      phone
    };
  }

  /**
   * Envia mensagem interativa (botões ou lista)
   */
  async function sendInteractive(to, interactiveData) {
    const phone = normalizePhoneE164(to);
    if (!phone) throw new Error('Número inválido');

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: MESSAGE_TYPES.INTERACTIVE,
      interactive: interactiveData
    };

    const result = await makeRequest(`${state.config.phoneNumberId}/messages`, 'POST', body);
    
    state.stats.messagesSent++;
    saveConfig();
    
    return {
      success: true,
      messageId: result.messages?.[0]?.id,
      phone
    };
  }

  /**
   * Envia botões de resposta rápida
   */
  async function sendButtons(to, bodyText, buttons, headerText = '', footerText = '') {
    const buttonObjects = buttons.slice(0, 3).map((btn, index) => ({
      type: 'reply',
      reply: {
        id: btn.id || `btn_${index}`,
        title: btn.title.substring(0, 20)
      }
    }));

    const interactive = {
      type: 'button',
      body: { text: bodyText },
      action: { buttons: buttonObjects }
    };

    if (headerText) {
      interactive.header = { type: 'text', text: headerText };
    }
    if (footerText) {
      interactive.footer = { text: footerText };
    }

    return sendInteractive(to, interactive);
  }

  /**
   * Envia lista de opções
   */
  async function sendList(to, bodyText, buttonText, sections, headerText = '', footerText = '') {
    const interactive = {
      type: 'list',
      body: { text: bodyText },
      action: {
        button: buttonText,
        sections: sections.map(section => ({
          title: section.title,
          rows: section.rows.slice(0, 10).map(row => ({
            id: row.id,
            title: row.title.substring(0, 24),
            description: row.description?.substring(0, 72)
          }))
        }))
      }
    };

    if (headerText) {
      interactive.header = { type: 'text', text: headerText };
    }
    if (footerText) {
      interactive.footer = { text: footerText };
    }

    return sendInteractive(to, interactive);
  }

  /**
   * Envia reação
   */
  async function sendReaction(to, messageId, emoji) {
    const phone = normalizePhoneE164(to);
    if (!phone) throw new Error('Número inválido');

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: MESSAGE_TYPES.REACTION,
      reaction: {
        message_id: messageId,
        emoji
      }
    };

    const result = await makeRequest(`${state.config.phoneNumberId}/messages`, 'POST', body);
    
    return {
      success: true,
      phone
    };
  }

  /**
   * Marca mensagem como lida
   */
  async function markAsRead(messageId) {
    const body = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId
    };

    await makeRequest(`${state.config.phoneNumberId}/messages`, 'POST', body);
    
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════════
  // UPLOAD DE MÍDIA
  // ═══════════════════════════════════════════════════════════════════
  async function uploadMedia(file, mimeType) {
    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('file', file);
    formData.append('type', mimeType);

    const response = await fetch(
      `${CONFIG.BASE_URL}/${CONFIG.API_VERSION}/${state.config.phoneNumberId}/media`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.config.accessToken}`
        },
        body: formData,
        timeout: CONFIG.UPLOAD_TIMEOUT
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Erro no upload');
    }

    return {
      success: true,
      mediaId: data.id
    };
  }

  async function getMediaUrl(mediaId) {
    const data = await makeRequest(mediaId);
    return data.url;
  }

  // ═══════════════════════════════════════════════════════════════════
  // GERENCIAMENTO DE TEMPLATES
  // ═══════════════════════════════════════════════════════════════════
  async function getTemplates() {
    if (!state.config.businessAccountId) {
      throw new Error('Business Account ID não configurado');
    }

    const data = await makeRequest(
      `${state.config.businessAccountId}/message_templates?limit=100`
    );

    return data.data || [];
  }

  async function getTemplateByName(name) {
    const templates = await getTemplates();
    return templates.find(t => t.name === name) || null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // VERIFICAÇÃO DE NÚMERO
  // ═══════════════════════════════════════════════════════════════════
  async function checkPhoneExists(phone) {
    const normalized = normalizePhoneE164(phone);
    if (!normalized) return { exists: false, error: 'Número inválido' };

    try {
      // A API oficial não tem endpoint direto para verificar
      // Usamos uma tentativa de envio de template de teste
      // ou verificamos se o número está registrado via contacts endpoint
      
      // Por enquanto, retornamos que existe (a API retornará erro se não existir)
      return { exists: true, phone: normalized };
    } catch (e) {
      return { exists: false, error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // WEBHOOKS
  // ═══════════════════════════════════════════════════════════════════
  function registerWebhookHandler(event, handler) {
    if (!state.webhookHandlers.has(event)) {
      state.webhookHandlers.set(event, new Set());
    }
    state.webhookHandlers.get(event).add(handler);
  }

  function unregisterWebhookHandler(event, handler) {
    if (state.webhookHandlers.has(event)) {
      state.webhookHandlers.get(event).delete(handler);
    }
  }

  function processWebhook(payload) {
    // Verifica se é uma mensagem
    const entry = payload.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value) return;

    // Mensagens recebidas
    if (value.messages) {
      for (const message of value.messages) {
        const event = {
          type: 'message',
          messageId: message.id,
          from: message.from,
          timestamp: message.timestamp,
          messageType: message.type,
          content: message[message.type],
          context: message.context
        };

        state.stats.messagesReceived++;
        
        // Notifica handlers
        const handlers = state.webhookHandlers.get('message') || new Set();
        handlers.forEach(h => h(event));
        
        EventBus.emit('whatsapp_api:message_received', event);
      }
    }

    // Status de mensagens
    if (value.statuses) {
      for (const status of value.statuses) {
        const event = {
          type: 'status',
          messageId: status.id,
          recipientId: status.recipient_id,
          status: status.status, // sent, delivered, read, failed
          timestamp: status.timestamp,
          errors: status.errors
        };

        const handlers = state.webhookHandlers.get('status') || new Set();
        handlers.forEach(h => h(event));
        
        EventBus.emit('whatsapp_api:status_updated', event);
      }
    }

    saveConfig();
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONFIGURAÇÃO
  // ═══════════════════════════════════════════════════════════════════
  function configure(config) {
    state.config = {
      ...state.config,
      ...config
    };
    saveConfig();
    
    EventBus.emit('whatsapp_api:configured', { enabled: state.config.enabled });
    
    return state.config;
  }

  function getConfig() {
    return { ...state.config };
  }

  function isConfigured() {
    return !!(state.config.accessToken && state.config.phoneNumberId && state.config.enabled);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ESTATÍSTICAS
  // ═══════════════════════════════════════════════════════════════════
  function getStats() {
    return {
      ...state.stats,
      rateLimit: {
        current: state.rateLimiter.requests.length,
        max: CONFIG.RATE_LIMIT.messagesPerMinute
      }
    };
  }

  function resetStats() {
    state.stats = {
      messagesSent: 0,
      messagesReceived: 0,
      templatesSent: 0,
      errors: 0,
      lastError: null
    };
    saveConfig();
  }

  // ═══════════════════════════════════════════════════════════════════
  // ENVIO EM MASSA (COM CONTROLE DE RATE)
  // ═══════════════════════════════════════════════════════════════════
  async function sendBulk(messages, options = {}) {
    const results = {
      success: [],
      failed: [],
      total: messages.length
    };

    const delay = options.delayMs || 100;
    const batchSize = options.batchSize || 10;

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      
      for (const msg of batch) {
        try {
          let result;
          
          switch (msg.type) {
            case 'text':
              result = await sendText(msg.to, msg.content, msg.options);
              break;
            case 'template':
              result = await sendTemplate(msg.to, msg.templateName, msg.language, msg.components);
              break;
            case 'image':
              result = await sendImage(msg.to, msg.url, msg.caption);
              break;
            default:
              result = await sendText(msg.to, msg.content);
          }
          
          results.success.push({ ...msg, result });
        } catch (e) {
          results.failed.push({ ...msg, error: e.message });
        }
        
        await new Promise(r => setTimeout(r, delay));
      }
      
      // Pausa entre batches
      if (i + batchSize < messages.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    EventBus.emit('whatsapp_api:bulk_complete', results);
    
    return results;
  }

  // ═══════════════════════════════════════════════════════════════════
  // INICIALIZAÇÃO
  // ═══════════════════════════════════════════════════════════════════
  async function init() {
    console.log(`[WhatsAppBusinessAPI] Inicializando v${VERSION}...`);
    
    await loadConfig();
    
    if (state.config.enabled) {
      console.log('[WhatsAppBusinessAPI] ✅ API configurada e habilitada');
    } else {
      console.log('[WhatsAppBusinessAPI] ⚠️ API não configurada ou desabilitada');
    }
    
    EventBus.setModuleStatus('WhatsAppBusinessAPI', 'ready');
  }

  // ═══════════════════════════════════════════════════════════════════
  // API PÚBLICA
  // ═══════════════════════════════════════════════════════════════════
  const api = {
    VERSION,
    MESSAGE_TYPES,
    
    // Inicialização
    init,
    
    // Configuração
    configure,
    getConfig,
    isConfigured,
    
    // Envio de mensagens
    sendText,
    sendImage,
    sendVideo,
    sendAudio,
    sendDocument,
    sendLocation,
    sendTemplate,
    sendInteractive,
    sendButtons,
    sendList,
    sendReaction,
    markAsRead,
    
    // Envio em massa
    sendBulk,
    
    // Mídia
    uploadMedia,
    getMediaUrl,
    
    // Templates
    getTemplates,
    getTemplateByName,
    
    // Verificação
    checkPhoneExists,
    normalizePhone: normalizePhoneE164,
    
    // Webhooks
    registerWebhookHandler,
    unregisterWebhookHandler,
    processWebhook,
    
    // Estatísticas
    getStats,
    resetStats
  };

  window.WhatsAppBusinessAPI = api;
  window.WaAPI = api; // Alias curto
  
  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
