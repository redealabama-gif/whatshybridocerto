/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                    MOTOR DE AUTOMAÇÃO COM REGRAS                          ║
 * ║                         WhatsHybrid v7.9.12                               ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Sistema de automação baseado em eventos e regras IF-THEN configuráveis   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

(function() {
  'use strict';

  const VERSION = '1.0.0';
  const STORAGE_KEY = 'whl_automation_engine';
  const EventBus = window.EventBus;

  // ═══════════════════════════════════════════════════════════════════
  // TIPOS DE EVENTOS SUPORTADOS
  // ═══════════════════════════════════════════════════════════════════
  const EVENT_TYPES = {
    // Mensagens
    MESSAGE_RECEIVED: 'message:received',
    MESSAGE_SENT: 'message:sent',
    MESSAGE_DELETED: 'message:deleted',
    MESSAGE_EDITED: 'message:edited',
    
    // Conversas
    CHAT_OPENED: 'chat:opened',
    CHAT_CLOSED: 'chat:closed',
    FIRST_MESSAGE: 'chat:first_message',
    NO_RESPONSE: 'chat:no_response',
    
    // Contatos
    CONTACT_ADDED: 'contact:added',
    CONTACT_UPDATED: 'contact:updated',
    CONTACT_INACTIVE: 'contact:inactive',
    
    // CRM
    DEAL_CREATED: 'deal:created',
    DEAL_STAGE_CHANGED: 'deal:stage_changed',
    DEAL_WON: 'deal:won',
    DEAL_LOST: 'deal:lost',
    
    // Tempo
    SCHEDULED: 'time:scheduled',
    DAILY: 'time:daily',
    WEEKLY: 'time:weekly',
    
    // IA
    AI_SUGGESTION_USED: 'ai:suggestion_used',
    AI_LOW_CONFIDENCE: 'ai:low_confidence',
    
    // Segmentação (D0-Dn)
    SEGMENT_D0: 'segment:d0',   // Interagiu hoje
    SEGMENT_D3: 'segment:d3',   // 3 dias sem interação
    SEGMENT_D7: 'segment:d7',   // 7 dias
    SEGMENT_D15: 'segment:d15', // 15 dias
    SEGMENT_D30: 'segment:d30', // 30+ dias (dorminhoco)
    
    // Palavras-chave
    KEYWORD_DETECTED: 'keyword:detected',
    INTENT_DETECTED: 'intent:detected',
    SENTIMENT_NEGATIVE: 'sentiment:negative',
    SENTIMENT_POSITIVE: 'sentiment:positive'
  };

  // ═══════════════════════════════════════════════════════════════════
  // TIPOS DE AÇÕES SUPORTADAS
  // ═══════════════════════════════════════════════════════════════════
  const ACTION_TYPES = {
    SEND_MESSAGE: 'action:send_message',
    SEND_TEMPLATE: 'action:send_template',
    ADD_TAG: 'action:add_tag',
    REMOVE_TAG: 'action:remove_tag',
    UPDATE_CONTACT: 'action:update_contact',
    CREATE_TASK: 'action:create_task',
    MOVE_DEAL: 'action:move_deal',
    TRIGGER_WEBHOOK: 'action:trigger_webhook',
    NOTIFY_USER: 'action:notify_user',
    ADD_TO_CAMPAIGN: 'action:add_to_campaign',
    REMOVE_FROM_CAMPAIGN: 'action:remove_from_campaign',
    LOG_EVENT: 'action:log_event',
    WAIT: 'action:wait',
    AI_GENERATE: 'action:ai_generate',
    ESCALATE: 'action:escalate'
  };

  // ═══════════════════════════════════════════════════════════════════
  // OPERADORES DE CONDIÇÃO
  // ═══════════════════════════════════════════════════════════════════
  const OPERATORS = {
    EQUALS: 'eq',
    NOT_EQUALS: 'neq',
    CONTAINS: 'contains',
    NOT_CONTAINS: 'not_contains',
    STARTS_WITH: 'starts_with',
    ENDS_WITH: 'ends_with',
    GREATER_THAN: 'gt',
    LESS_THAN: 'lt',
    GREATER_OR_EQUAL: 'gte',
    LESS_OR_EQUAL: 'lte',
    REGEX: 'regex',
    IN_LIST: 'in',
    NOT_IN_LIST: 'not_in',
    IS_EMPTY: 'empty',
    IS_NOT_EMPTY: 'not_empty',
    EXISTS: 'exists'
  };

  // ═══════════════════════════════════════════════════════════════════
  // ESTADO DO MOTOR
  // ═══════════════════════════════════════════════════════════════════
  const state = {
    rules: [],
    eventQueue: [],
    executionLog: [],
    isProcessing: false,
    stats: {
      totalEventsProcessed: 0,
      totalActionsExecuted: 0,
      rulesTriggered: {},
      lastExecution: null
    },
    settings: {
      enabled: true,
      maxQueueSize: 500,
      maxLogSize: 1000,
      executionDelay: 100, // ms entre execuções
      maxActionsPerMinute: 60,
      enableParallelExecution: false
    },
    // FIX PEND-HIGH-001: Loop prevention mechanism
    loopPrevention: {
      eventChain: [],              // Track event chain to detect loops
      maxChainDepth: 5,             // Maximum recursion depth
      chainTimeout: 5000,           // Clear chain after 5s of inactivity
      lastEventTime: 0,             // Timestamp of last event
      automationGeneratedEvents: new Set() // Track automation-generated events
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // SECURITY HELPERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * SECURITY FIX P0-016: Sanitize objects to prevent Prototype Pollution
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
          console.warn('[AutomationEngine Security] Blocked prototype pollution attempt:', key);
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

  /**
   * SECURITY FIX P0-017: Validate webhook URL to prevent SSRF attacks
   */
  function validateWebhookUrl(url) {
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid webhook URL: must be a string');
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      throw new Error(`Invalid webhook URL format: ${e.message}`);
    }

    // Only allow HTTP/HTTPS protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Invalid webhook protocol: ${parsed.protocol}. Only HTTP/HTTPS allowed.`);
    }

    // Block localhost and loopback IPs
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
      throw new Error('Webhook URL cannot target localhost');
    }

    // Block private IP ranges (IPv4)
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipMatch = hostname.match(ipv4Regex);
    if (ipMatch) {
      const octets = ipMatch.slice(1, 5).map(Number);

      // 10.0.0.0/8
      if (octets[0] === 10) {
        throw new Error('Webhook URL cannot target private IP range (10.x.x.x)');
      }

      // 172.16.0.0/12
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
        throw new Error('Webhook URL cannot target private IP range (172.16-31.x.x)');
      }

      // 192.168.0.0/16
      if (octets[0] === 192 && octets[1] === 168) {
        throw new Error('Webhook URL cannot target private IP range (192.168.x.x)');
      }

      // 169.254.0.0/16 (Link-local / Cloud metadata)
      if (octets[0] === 169 && octets[1] === 254) {
        throw new Error('Webhook URL cannot target link-local IP (cloud metadata endpoint)');
      }
    }

    return url;
  }

  /**
   * SECURITY FIX P0-018: Sanitize HTTP headers to prevent Header Injection
   */
  function sanitizeHeaders(headers) {
    if (!headers || typeof headers !== 'object') {
      return {};
    }

    const sanitized = {};
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

    for (const key in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, key)) {
        // Skip dangerous prototype keys
        if (dangerousKeys.includes(key)) {
          console.warn('[AutomationEngine Security] Blocked dangerous header key:', key);
          continue;
        }

        // Validate header name (no newlines, no control chars)
        const headerName = String(key);
        if (/[\r\n\x00-\x1F]/.test(headerName)) {
          console.warn('[AutomationEngine Security] Blocked header with invalid characters:', key);
          continue;
        }

        // Sanitize header value (no newlines)
        const headerValue = String(headers[key]);
        if (/[\r\n]/.test(headerValue)) {
          console.warn('[AutomationEngine Security] Blocked header value with newlines:', key);
          continue;
        }

        sanitized[headerName] = headerValue;
      }
    }

    return sanitized;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PERSISTÊNCIA
  // ═══════════════════════════════════════════════════════════════════
  async function loadState() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      if (stored[STORAGE_KEY]) {
        // SECURITY FIX P0-019/P0-020: Sanitize all data from storage
        const data = sanitizeObject(stored[STORAGE_KEY]);

        state.rules = data.rules || [];
        state.stats = { ...state.stats, ...data.stats };
        state.settings = { ...state.settings, ...data.settings };
      }
      console.log(`[AutomationEngine] ${state.rules.length} regras carregadas`);
    } catch (e) {
      console.error('[AutomationEngine] Erro ao carregar estado:', e);
    }
  }

  async function saveState() {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          rules: state.rules,
          stats: state.stats,
          settings: state.settings
        }
      });
    } catch (e) {
      console.error('[AutomationEngine] Erro ao salvar estado:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // LOOP PREVENTION - FIX PEND-HIGH-001
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Checks if processing an event would create an infinite loop
   * @param {string} eventType - Type of event being processed
   * @param {object} eventData - Event data (must contain chatId)
   * @returns {boolean} - true if loop detected, false otherwise
   */
  function detectLoop(eventType, eventData) {
    const now = Date.now();
    const { loopPrevention } = state;

    // Clear chain if timeout exceeded (reset after inactivity)
    if (now - loopPrevention.lastEventTime > loopPrevention.chainTimeout) {
      loopPrevention.eventChain = [];
      loopPrevention.automationGeneratedEvents.clear();
    }

    // Update last event time
    loopPrevention.lastEventTime = now;

    // Check if this event was generated by automation
    const eventKey = `${eventType}:${eventData.chatId}:${eventData.messageId || now}`;
    if (loopPrevention.automationGeneratedEvents.has(eventKey)) {
      console.warn('[AutomationEngine] LOOP DETECTED: Event generated by automation, skipping to prevent infinite loop');
      return true;
    }

    // Track event in chain
    const chainEntry = { eventType, chatId: eventData.chatId, timestamp: now };
    loopPrevention.eventChain.push(chainEntry);

    // Keep only recent events in chain (last maxChainDepth)
    if (loopPrevention.eventChain.length > loopPrevention.maxChainDepth * 2) {
      loopPrevention.eventChain = loopPrevention.eventChain.slice(-loopPrevention.maxChainDepth * 2);
    }

    // Check for rapid repeated events in same chat (potential loop)
    const recentEvents = loopPrevention.eventChain.filter(e =>
      e.chatId === eventData.chatId &&
      e.eventType === eventType &&
      now - e.timestamp < 2000 // Last 2 seconds
    );

    if (recentEvents.length > loopPrevention.maxChainDepth) {
      console.error('[AutomationEngine] LOOP DETECTED: Too many rapid events', {
        eventType,
        chatId: eventData.chatId,
        count: recentEvents.length,
        maxAllowed: loopPrevention.maxChainDepth
      });

      // Clear automation events to recover from loop
      loopPrevention.automationGeneratedEvents.clear();
      loopPrevention.eventChain = [];

      return true;
    }

    return false;
  }

  /**
   * Marks an event as automation-generated to prevent re-processing
   * @param {string} eventType - Type of event
   * @param {string} chatId - Chat ID
   * @param {string} messageId - Message ID (optional)
   */
  function markAsAutomationGenerated(eventType, chatId, messageId) {
    const eventKey = `${eventType}:${chatId}:${messageId || Date.now()}`;
    state.loopPrevention.automationGeneratedEvents.add(eventKey);

    // Clean up old entries (keep only last 100)
    if (state.loopPrevention.automationGeneratedEvents.size > 100) {
      const arr = Array.from(state.loopPrevention.automationGeneratedEvents);
      state.loopPrevention.automationGeneratedEvents = new Set(arr.slice(-100));
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // AVALIAÇÃO DE CONDIÇÕES
  // ═══════════════════════════════════════════════════════════════════
  function evaluateCondition(condition, context) {
    const { field, operator, value } = condition;
    const actualValue = getFieldValue(field, context);

    switch (operator) {
      case OPERATORS.EQUALS:
        return actualValue == value;
      
      case OPERATORS.NOT_EQUALS:
        return actualValue != value;
      
      case OPERATORS.CONTAINS:
        return String(actualValue).toLowerCase().includes(String(value).toLowerCase());
      
      case OPERATORS.NOT_CONTAINS:
        return !String(actualValue).toLowerCase().includes(String(value).toLowerCase());
      
      case OPERATORS.STARTS_WITH:
        return String(actualValue).toLowerCase().startsWith(String(value).toLowerCase());
      
      case OPERATORS.ENDS_WITH:
        return String(actualValue).toLowerCase().endsWith(String(value).toLowerCase());
      
      case OPERATORS.GREATER_THAN:
        return Number(actualValue) > Number(value);
      
      case OPERATORS.LESS_THAN:
        return Number(actualValue) < Number(value);
      
      case OPERATORS.GREATER_OR_EQUAL:
        return Number(actualValue) >= Number(value);
      
      case OPERATORS.LESS_OR_EQUAL:
        return Number(actualValue) <= Number(value);
      
      case OPERATORS.REGEX:
        try {
          return new RegExp(value, 'i').test(String(actualValue));
        } catch (e) {
          return false;
        }
      
      case OPERATORS.IN_LIST:
        const list = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim());
        return list.includes(String(actualValue));
      
      case OPERATORS.NOT_IN_LIST:
        const notList = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim());
        return !notList.includes(String(actualValue));
      
      case OPERATORS.IS_EMPTY:
        return !actualValue || actualValue === '' || (Array.isArray(actualValue) && actualValue.length === 0);
      
      case OPERATORS.IS_NOT_EMPTY:
        return actualValue && actualValue !== '' && (!Array.isArray(actualValue) || actualValue.length > 0);
      
      case OPERATORS.EXISTS:
        return actualValue !== undefined && actualValue !== null;
      
      default:
        console.warn(`[AutomationEngine] Operador desconhecido: ${operator}`);
        return false;
    }
  }

  function getFieldValue(field, context) {
    // Suporta notação de ponto: "message.content", "contact.name"
    const parts = field.split('.');
    let value = context;
    
    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      value = value[part];
    }
    
    return value;
  }

  function evaluateConditions(conditions, context, logic = 'AND') {
    if (!conditions || conditions.length === 0) return true;
    
    if (logic === 'AND') {
      return conditions.every(cond => {
        if (cond.conditions) {
          // Grupo aninhado
          return evaluateConditions(cond.conditions, context, cond.logic || 'AND');
        }
        return evaluateCondition(cond, context);
      });
    } else {
      return conditions.some(cond => {
        if (cond.conditions) {
          return evaluateConditions(cond.conditions, context, cond.logic || 'AND');
        }
        return evaluateCondition(cond, context);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXECUÇÃO DE AÇÕES
  // ═══════════════════════════════════════════════════════════════════
  async function executeAction(action, context) {
    const { type, params } = action;
    
    try {
      switch (type) {
        case ACTION_TYPES.SEND_MESSAGE:
          return await executeSendMessage(params, context);
        
        case ACTION_TYPES.SEND_TEMPLATE:
          return await executeSendTemplate(params, context);
        
        case ACTION_TYPES.ADD_TAG:
          return await executeAddTag(params, context);
        
        case ACTION_TYPES.REMOVE_TAG:
          return await executeRemoveTag(params, context);
        
        case ACTION_TYPES.UPDATE_CONTACT:
          return await executeUpdateContact(params, context);
        
        case ACTION_TYPES.CREATE_TASK:
          return await executeCreateTask(params, context);
        
        case ACTION_TYPES.MOVE_DEAL:
          return await executeMoveDeal(params, context);
        
        case ACTION_TYPES.TRIGGER_WEBHOOK:
          return await executeTriggerWebhook(params, context);
        
        case ACTION_TYPES.NOTIFY_USER:
          return await executeNotifyUser(params, context);
        
        case ACTION_TYPES.ADD_TO_CAMPAIGN:
          return await executeAddToCampaign(params, context);
        
        case ACTION_TYPES.WAIT:
          return await executeWait(params);
        
        case ACTION_TYPES.AI_GENERATE:
          return await executeAIGenerate(params, context);
        
        case ACTION_TYPES.ESCALATE:
          return await executeEscalate(params, context);
        
        case ACTION_TYPES.LOG_EVENT:
          return executeLogEvent(params, context);
        
        default:
          console.warn(`[AutomationEngine] Ação desconhecida: ${type}`);
          return { success: false, error: 'Ação desconhecida' };
      }
    } catch (error) {
      console.error(`[AutomationEngine] Erro ao executar ação ${type}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Implementação das ações
  async function executeSendMessage(params, context) {
    const message = interpolateTemplate(params.message, context);
    const chatId = context.chatId || context.contact?.id;

    if (!chatId) {
      return { success: false, error: 'Chat ID não encontrado' };
    }

    // FIX PEND-HIGH-001: Mark this as automation-generated to prevent loops
    const messageId = `auto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    markAsAutomationGenerated(EVENT_TYPES.MESSAGE_SENT, chatId, messageId);

    // Usa o HumanTyping para enviar
    if (window.HumanTyping) {
      await window.HumanTyping.typeInWhatsApp(message);
      return { success: true, message, messageId };
    }

    // Fallback: envia via background
    return new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'WHL_SEND_TEXT_DIRECT',
        chatId,
        text: message
      }, response => {
        // v9.3.4 FIX: chrome.runtime.lastError swallowed pra evitar warning;
        // se lastError → response será undefined, fallback abaixo trata
        if (chrome.runtime.lastError) {
          console.warn('[Automation] WHL_SEND_TEXT_DIRECT failed:', chrome.runtime.lastError.message);
        }
        resolve(response ? { ...response, messageId } : { success: false });
      });
    });
  }

  async function executeSendTemplate(params, context) {
    const { templateId, variables } = params;
    
    // Busca template do QuickReplies ou backend
    let template = null;
    
    if (window.quickReplies) {
      const replies = await window.quickReplies.getAll();
      template = replies.find(r => r.id === templateId || r.trigger === templateId);
    }
    
    if (!template) {
      return { success: false, error: 'Template não encontrado' };
    }
    
    const message = interpolateTemplate(template.response, { ...context, ...variables });
    return executeSendMessage({ message }, context);
  }

  async function executeAddTag(params, context) {
    const { tag } = params;
    const contactId = context.contact?.id || context.chatId;
    
    if (window.CRMModule) {
      await window.CRMModule.addTag(contactId, tag);
      return { success: true, tag };
    }
    
    return { success: false, error: 'CRM não disponível' };
  }

  async function executeRemoveTag(params, context) {
    const { tag } = params;
    const contactId = context.contact?.id || context.chatId;
    
    if (window.CRMModule) {
      await window.CRMModule.removeTag(contactId, tag);
      return { success: true, tag };
    }
    
    return { success: false, error: 'CRM não disponível' };
  }

  async function executeUpdateContact(params, context) {
    const contactId = context.contact?.id || context.chatId;
    
    if (window.CRMModule) {
      await window.CRMModule.upsertContact({ id: contactId, ...params });
      return { success: true };
    }
    
    return { success: false, error: 'CRM não disponível' };
  }

  async function executeCreateTask(params, context) {
    const task = {
      title: interpolateTemplate(params.title, context),
      description: interpolateTemplate(params.description || '', context),
      dueDate: params.dueDate || new Date(Date.now() + 86400000).toISOString(),
      priority: params.priority || 'medium',
      relatedTo: context.contact?.id || context.chatId
    };
    
    if (window.TasksModule) {
      await window.TasksModule.createTask(task);
      return { success: true, task };
    }
    
    return { success: false, error: 'TasksModule não disponível' };
  }

  async function executeMoveDeal(params, context) {
    const { dealId, stageId } = params;
    
    if (window.CRMModule) {
      await window.CRMModule.updateDealStage(dealId || context.deal?.id, stageId);
      return { success: true };
    }
    
    return { success: false, error: 'CRM não disponível' };
  }

  async function executeTriggerWebhook(params, context) {
    const { url, method = 'POST', headers = {} } = params;

    try {
      // SECURITY FIX P0-017: Validate webhook URL to prevent SSRF
      const validatedUrl = validateWebhookUrl(url);

      // SECURITY FIX P0-018: Sanitize headers to prevent Header Injection
      const sanitizedHeaders = sanitizeHeaders(headers);

      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(validatedUrl, {
        method: ['GET', 'POST', 'PUT', 'DELETE'].includes(method) ? method : 'POST', // Whitelist methods
        headers: {
          'Content-Type': 'application/json',
          ...sanitizedHeaders
        },
        body: JSON.stringify({
          event: context.event,
          data: context,
          timestamp: new Date().toISOString()
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return { success: response.ok, status: response.status };

    } catch (error) {
      if (error.name === 'AbortError') {
        return { success: false, error: 'Webhook request timeout (10s)' };
      }
      return { success: false, error: error.message };
    }
  }

  async function executeNotifyUser(params, context) {
    const { title, message, type = 'info' } = params;
    
    const notificationText = interpolateTemplate(message, context);
    
    // Notificação via chrome.notifications
    if (chrome.notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-48.png'),
        title: interpolateTemplate(title, context),
        message: notificationText
      });
    }
    
    // Também emite evento no EventBus
    EventBus.emit('automation:notification', { title, message: notificationText, type });
    
    return { success: true };
  }

  async function executeAddToCampaign(params, context) {
    const { campaignId } = params;
    const contactId = context.contact?.id || context.chatId;
    
    // Adiciona à fila de campanha
    EventBus.emit('campaign:add_contact', { campaignId, contactId });
    
    return { success: true };
  }

  async function executeWait(params) {
    const { duration = 1000 } = params;
    await new Promise(resolve => setTimeout(resolve, duration));
    return { success: true };
  }

  async function executeAIGenerate(params, context) {
    const { prompt, action = 'reply' } = params;
    
    if (window.CopilotEngine) {
      const interpolatedPrompt = interpolateTemplate(prompt, context);
      const response = await window.CopilotEngine.generateResponse({
        additionalPrompt: interpolatedPrompt
      });
      
      context._aiResponse = response;
      return { success: true, response };
    }
    
    return { success: false, error: 'CopilotEngine não disponível' };
  }

  async function executeEscalate(params, context) {
    const { reason, priority = 'high' } = params;
    
    EventBus.emit('escalation:required', {
      chatId: context.chatId,
      contact: context.contact,
      reason: interpolateTemplate(reason, context),
      priority,
      timestamp: Date.now()
    });
    
    // Cria task de escalação
    if (window.TasksModule) {
      await window.TasksModule.createTask({
        title: `[ESCALAÇÃO] ${context.contact?.name || 'Cliente'}`,
        description: interpolateTemplate(reason, context),
        priority: 'urgent',
        category: 'escalation',
        relatedTo: context.chatId
      });
    }
    
    return { success: true };
  }

  function executeLogEvent(params, context) {
    const { message, level = 'info' } = params;
    const logMessage = interpolateTemplate(message, context);
    
    state.executionLog.push({
      timestamp: Date.now(),
      level,
      message: logMessage,
      context: {
        chatId: context.chatId,
        eventType: context.event?.type
      }
    });
    
    // Limita o tamanho do log
    if (state.executionLog.length > state.settings.maxLogSize) {
      state.executionLog = state.executionLog.slice(-state.settings.maxLogSize);
    }
    
    console[level](`[AutomationEngine] ${logMessage}`);
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════════
  // INTERPOLAÇÃO DE TEMPLATES
  // ═══════════════════════════════════════════════════════════════════
  function interpolateTemplate(template, context) {
    if (!template) return '';
    
    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const value = getFieldValue(path.trim(), context);
      return value !== undefined ? String(value) : match;
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // PROCESSAMENTO DE EVENTOS
  // ═══════════════════════════════════════════════════════════════════
  function emitEvent(eventType, eventData = {}) {
    if (!state.settings.enabled) return;
    
    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: eventType,
      data: eventData,
      timestamp: Date.now()
    };
    
    state.eventQueue.push(event);
    
    // Limita o tamanho da fila
    if (state.eventQueue.length > state.settings.maxQueueSize) {
      state.eventQueue = state.eventQueue.slice(-state.settings.maxQueueSize);
    }
    
    // Processa a fila
    if (!state.isProcessing) {
      processQueue();
    }
    
    EventBus.emit('automation:event_emitted', event);
  }

  async function processQueue() {
    if (state.isProcessing || state.eventQueue.length === 0) return;
    
    state.isProcessing = true;
    
    while (state.eventQueue.length > 0) {
      const event = state.eventQueue.shift();
      await processEvent(event);
      
      // Delay entre execuções
      await new Promise(r => setTimeout(r, state.settings.executionDelay));
    }
    
    state.isProcessing = false;
    await saveState();
  }

  async function processEvent(event) {
    state.stats.totalEventsProcessed++;
    state.stats.lastExecution = Date.now();

    // FIX PEND-HIGH-001: Check for infinite loops before processing
    if (detectLoop(event.type, event.data)) {
      console.error('[AutomationEngine] Event skipped due to loop detection:', event.type);
      return;
    }

    // Encontra regras que respondem a este evento
    const matchingRules = state.rules.filter(rule => {
      if (!rule.enabled) return false;
      if (rule.trigger !== event.type) return false;
      return true;
    });

    for (const rule of matchingRules) {
      const context = {
        event,
        ...event.data,
        _rule: rule
      };

      // Avalia condições
      if (!evaluateConditions(rule.conditions, context, rule.conditionLogic || 'AND')) {
        continue;
      }

      // Executa ações
      console.log(`[AutomationEngine] Executando regra: ${rule.name}`);
      
      for (const action of rule.actions) {
        const result = await executeAction(action, context);
        state.stats.totalActionsExecuted++;
        
        if (!result.success && action.stopOnError) {
          console.warn(`[AutomationEngine] Ação falhou, parando execução: ${action.type}`);
          break;
        }
        
        // Delay entre ações se configurado
        if (action.delay) {
          await new Promise(r => setTimeout(r, action.delay));
        }
      }
      
      // Atualiza estatísticas
      state.stats.rulesTriggered[rule.id] = (state.stats.rulesTriggered[rule.id] || 0) + 1;
      
      EventBus.emit('automation:rule_executed', { ruleId: rule.id, ruleName: rule.name, event });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // GERENCIAMENTO DE REGRAS
  // ═══════════════════════════════════════════════════════════════════
  function createRule(ruleData) {
    const rule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: ruleData.name || 'Nova Regra',
      description: ruleData.description || '',
      enabled: ruleData.enabled !== false,
      trigger: ruleData.trigger,
      conditions: ruleData.conditions || [],
      conditionLogic: ruleData.conditionLogic || 'AND',
      actions: ruleData.actions || [],
      priority: ruleData.priority || 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    state.rules.push(rule);
    state.rules.sort((a, b) => b.priority - a.priority);
    
    saveState();
    EventBus.emit('automation:rule_created', rule);
    
    return rule;
  }

  function updateRule(ruleId, updates) {
    const index = state.rules.findIndex(r => r.id === ruleId);
    if (index === -1) return null;
    
    state.rules[index] = {
      ...state.rules[index],
      ...updates,
      updatedAt: Date.now()
    };
    
    state.rules.sort((a, b) => b.priority - a.priority);
    saveState();
    
    EventBus.emit('automation:rule_updated', state.rules[index]);
    return state.rules[index];
  }

  function deleteRule(ruleId) {
    const index = state.rules.findIndex(r => r.id === ruleId);
    if (index === -1) return false;
    
    const rule = state.rules.splice(index, 1)[0];
    saveState();
    
    EventBus.emit('automation:rule_deleted', rule);
    return true;
  }

  function toggleRule(ruleId, enabled) {
    return updateRule(ruleId, { enabled });
  }

  function getRules() {
    return [...state.rules];
  }

  function getRule(ruleId) {
    return state.rules.find(r => r.id === ruleId) || null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // REGRAS PRÉ-DEFINIDAS
  // ═══════════════════════════════════════════════════════════════════
  function createDefaultRules() {
    const defaults = [
      {
        name: '🎉 Boas-vindas (Primeira mensagem)',
        description: 'Envia mensagem de boas-vindas na primeira interação',
        trigger: EVENT_TYPES.FIRST_MESSAGE,
        conditions: [],
        actions: [
          {
            type: ACTION_TYPES.WAIT,
            params: { duration: 2000 }
          },
          {
            type: ACTION_TYPES.AI_GENERATE,
            params: { prompt: 'Gere uma mensagem de boas-vindas calorosa e profissional' }
          }
        ],
        enabled: false
      },
      {
        name: '⏰ Cliente sem resposta (30min)',
        description: 'Notifica quando cliente não responde há 30 minutos',
        trigger: EVENT_TYPES.NO_RESPONSE,
        conditions: [
          { field: 'timeSinceLastMessage', operator: OPERATORS.GREATER_THAN, value: 1800000 }
        ],
        actions: [
          {
            type: ACTION_TYPES.NOTIFY_USER,
            params: {
              title: 'Cliente aguardando',
              message: '{{contact.name}} está sem resposta há 30 minutos'
            }
          }
        ],
        enabled: false
      },
      {
        name: '🔥 Palavra-chave: Preço',
        description: 'Detecta quando cliente pergunta sobre preço',
        trigger: EVENT_TYPES.KEYWORD_DETECTED,
        conditions: [
          { field: 'keyword', operator: OPERATORS.IN_LIST, value: 'preço,valor,quanto custa,promoção' }
        ],
        actions: [
          {
            type: ACTION_TYPES.ADD_TAG,
            params: { tag: 'interessado_preco' }
          }
        ],
        enabled: false
      },
      {
        name: '😠 Sentimento negativo',
        description: 'Escala atendimento quando detecta sentimento negativo',
        trigger: EVENT_TYPES.SENTIMENT_NEGATIVE,
        conditions: [
          { field: 'sentiment.score', operator: OPERATORS.LESS_THAN, value: -0.5 }
        ],
        actions: [
          {
            type: ACTION_TYPES.ESCALATE,
            params: {
              reason: 'Cliente {{contact.name}} demonstrou insatisfação',
              priority: 'high'
            }
          }
        ],
        enabled: false
      },
      {
        name: '💤 Remarketing D7',
        description: 'Envia mensagem para clientes inativos há 7 dias',
        trigger: EVENT_TYPES.SEGMENT_D7,
        conditions: [],
        actions: [
          {
            type: ACTION_TYPES.SEND_MESSAGE,
            params: {
              message: 'Olá {{contact.name}}! Sentimos sua falta 💜 Tem algo que possamos ajudar?'
            }
          }
        ],
        enabled: false
      }
    ];
    
    // Só cria se não existirem regras
    if (state.rules.length === 0) {
      defaults.forEach(rule => createRule(rule));
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // LISTENERS DO WHATSAPP
  // ═══════════════════════════════════════════════════════════════════
  function setupEventListeners() {
    // Escuta eventos do EventBus
    EventBus.on('message:received', data => {
      emitEvent(EVENT_TYPES.MESSAGE_RECEIVED, data);
      
      // Detecta palavras-chave
      if (data.content) {
        const keywords = ['preço', 'valor', 'quanto', 'promoção', 'desconto', 'parcelamento'];
        const found = keywords.filter(k => data.content.toLowerCase().includes(k));
        if (found.length > 0) {
          emitEvent(EVENT_TYPES.KEYWORD_DETECTED, { ...data, keyword: found[0], keywords: found });
        }
      }
    });
    
    EventBus.on('message:sent', data => {
      emitEvent(EVENT_TYPES.MESSAGE_SENT, data);
    });
    
    EventBus.on('chat:opened', data => {
      emitEvent(EVENT_TYPES.CHAT_OPENED, data);
    });
    
    EventBus.on('contact:added', data => {
      emitEvent(EVENT_TYPES.CONTACT_ADDED, data);
    });
    
    EventBus.on('deal:created', data => {
      emitEvent(EVENT_TYPES.DEAL_CREATED, data);
    });
    
    EventBus.on('deal:stage_changed', data => {
      emitEvent(EVENT_TYPES.DEAL_STAGE_CHANGED, data);
    });
    
    EventBus.on('ai:suggestion_used', data => {
      emitEvent(EVENT_TYPES.AI_SUGGESTION_USED, data);
    });
    
    EventBus.on('sentiment:analyzed', data => {
      if (data.score < -0.3) {
        emitEvent(EVENT_TYPES.SENTIMENT_NEGATIVE, data);
      } else if (data.score > 0.3) {
        emitEvent(EVENT_TYPES.SENTIMENT_POSITIVE, data);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // INICIALIZAÇÃO
  // ═══════════════════════════════════════════════════════════════════
  async function init() {
    console.log(`[AutomationEngine] Inicializando v${VERSION}...`);
    
    await loadState();
    createDefaultRules();
    setupEventListeners();
    
    EventBus.setModuleStatus('AutomationEngine', 'ready');
    console.log('[AutomationEngine] ✅ Pronto');
  }

  // ═══════════════════════════════════════════════════════════════════
  // API PÚBLICA
  // ═══════════════════════════════════════════════════════════════════
  const api = {
    // Versão
    VERSION,
    
    // Constantes
    EVENT_TYPES,
    ACTION_TYPES,
    OPERATORS,
    
    // Inicialização
    init,
    
    // Eventos
    emit: emitEvent,
    
    // Regras
    createRule,
    updateRule,
    deleteRule,
    toggleRule,
    getRules,
    getRule,
    
    // Configurações
    getSettings: () => ({ ...state.settings }),
    updateSettings: (updates) => {
      state.settings = { ...state.settings, ...updates };
      saveState();
    },
    
    // Estatísticas
    getStats: () => ({ ...state.stats }),
    getExecutionLog: () => [...state.executionLog],
    clearLog: () => { state.executionLog = []; saveState(); },
    
    // Utilitários
    evaluateConditions,
    interpolateTemplate,
    
    // Status
    isEnabled: () => state.settings.enabled,
    enable: () => { state.settings.enabled = true; saveState(); },
    disable: () => { state.settings.enabled = false; saveState(); }
  };

  window.AutomationEngine = api;
  
  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
