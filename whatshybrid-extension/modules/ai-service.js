/**
 * 🧠 AIService v1.0 - Serviço Unificado de IA Enterprise
 * Abstração multi-provider com fallback, retry, rate limiting e cache
 * 
 * TODO: AUDIT-NEW-018 (P3) - i18n AI Prompts
 * This module has no i18n fallback for AI prompts.
 * See: docs/internal/PEND-MED-003-I18N-AI-PROMPTS-FIX.md for full implementation guide.
 * Lines affected: 1038-1047 (systemPrompt defaults)
 * 
 * Features:
 * - Multi-provider (OpenAI, Anthropic, Venice, Google, Groq, Ollama)
 * - Fallback automático entre providers
 * - Retry com exponential backoff
 * - Rate limiting inteligente
 * - Cache de respostas
 * - Streaming support
 * - Token counting
 * - Cost tracking
 * - Health monitoring
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  // ============================================
  // CONFIGURAÇÃO DE PROVIDERS
  // ============================================
  const PROVIDERS = {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      models: {
        'gpt-4o': { name: 'GPT-4o', contextWindow: 128000, costPer1kInput: 0.005, costPer1kOutput: 0.015 },
        'gpt-4o-mini': { name: 'GPT-4o Mini', contextWindow: 128000, costPer1kInput: 0.00015, costPer1kOutput: 0.0006 },
        'gpt-4-turbo': { name: 'GPT-4 Turbo', contextWindow: 128000, costPer1kInput: 0.01, costPer1kOutput: 0.03 },
        'gpt-3.5-turbo': { name: 'GPT-3.5 Turbo', contextWindow: 16385, costPer1kInput: 0.0005, costPer1kOutput: 0.0015 },
        'o1-preview': { name: 'o1 Preview', contextWindow: 128000, costPer1kInput: 0.015, costPer1kOutput: 0.06 },
        'o1-mini': { name: 'o1 Mini', contextWindow: 128000, costPer1kInput: 0.003, costPer1kOutput: 0.012 }
      },
      defaultModel: 'gpt-4o',
      headerAuth: (key) => ({ 'Authorization': `Bearer ${key}` }),
      formatRequest: (messages, options) => ({
        model: options.model,
        messages: messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 1000,
        stream: options.stream ?? false,
        ...(options.responseFormat && { response_format: options.responseFormat }),
        ...(options.tools && { tools: options.tools }),
        ...(options.toolChoice && { tool_choice: options.toolChoice })
      }),
      parseResponse: (data) => ({
        content: data.choices?.[0]?.message?.content || '',
        toolCalls: data.choices?.[0]?.message?.tool_calls || null,
        finishReason: data.choices?.[0]?.finish_reason,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0
        }
      }),
      parseStreamChunk: (chunk) => {
        if (chunk.includes('[DONE]')) return { done: true };
        try {
          const data = JSON.parse(chunk.replace('data: ', ''));
          return { content: data.choices?.[0]?.delta?.content || '', done: false };
        } catch { return { content: '', done: false }; }
      }
    },

    anthropic: {
      id: 'anthropic',
      name: 'Anthropic Claude',
      endpoint: 'https://api.anthropic.com/v1/messages',
      models: {
        'claude-3-5-sonnet-20241022': { name: 'Claude 3.5 Sonnet', contextWindow: 200000, costPer1kInput: 0.003, costPer1kOutput: 0.015 },
        'claude-3-5-haiku-20241022': { name: 'Claude 3.5 Haiku', contextWindow: 200000, costPer1kInput: 0.001, costPer1kOutput: 0.005 },
        'claude-3-opus-20240229': { name: 'Claude 3 Opus', contextWindow: 200000, costPer1kInput: 0.015, costPer1kOutput: 0.075 }
      },
      defaultModel: 'claude-3-5-sonnet-20241022',
      headerAuth: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
      formatRequest: (messages, options) => {
        const systemMsg = messages.find(m => m.role === 'system');
        const otherMsgs = messages.filter(m => m.role !== 'system');
        return {
          model: options.model,
          max_tokens: options.maxTokens ?? 1000,
          ...(systemMsg && { system: systemMsg.content }),
          messages: otherMsgs.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
          ...(options.temperature && { temperature: options.temperature }),
          stream: options.stream ?? false
        };
      },
      parseResponse: (data) => ({
        content: data.content?.[0]?.text || '',
        finishReason: data.stop_reason,
        usage: {
          promptTokens: data.usage?.input_tokens || 0,
          completionTokens: data.usage?.output_tokens || 0,
          totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
        }
      }),
      parseStreamChunk: (chunk) => {
        try {
          const data = JSON.parse(chunk.replace('data: ', ''));
          if (data.type === 'message_stop') return { done: true };
          if (data.type === 'content_block_delta') return { content: data.delta?.text || '', done: false };
          return { content: '', done: false };
        } catch { return { content: '', done: false }; }
      }
    },

    venice: {
      id: 'venice',
      name: 'Venice AI',
      endpoint: 'https://api.venice.ai/api/v1/chat/completions',
      models: {
        'llama-3.3-70b': { name: 'Llama 3.3 70B', contextWindow: 128000, costPer1kInput: 0.0008, costPer1kOutput: 0.0008 },
        'llama-3.1-405b': { name: 'Llama 3.1 405B', contextWindow: 128000, costPer1kInput: 0.002, costPer1kOutput: 0.002 },
        'deepseek-r1-llama-70b': { name: 'DeepSeek R1 70B', contextWindow: 64000, costPer1kInput: 0.001, costPer1kOutput: 0.001 }
      },
      defaultModel: 'llama-3.3-70b',
      headerAuth: (key) => ({ 'Authorization': `Bearer ${key}` }),
      formatRequest: (messages, options) => ({
        model: options.model,
        messages: messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 1000,
        stream: options.stream ?? false
      }),
      parseResponse: (data) => ({
        content: data.choices?.[0]?.message?.content || '',
        finishReason: data.choices?.[0]?.finish_reason,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0
        }
      }),
      parseStreamChunk: (chunk) => {
        if (chunk.includes('[DONE]')) return { done: true };
        try {
          const data = JSON.parse(chunk.replace('data: ', ''));
          return { content: data.choices?.[0]?.delta?.content || '', done: false };
        } catch { return { content: '', done: false }; }
      }
    },

    groq: {
      id: 'groq',
      name: 'Groq',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      models: {
        'llama-3.3-70b-versatile': { name: 'Llama 3.3 70B', contextWindow: 128000, costPer1kInput: 0.00059, costPer1kOutput: 0.00079 },
        'llama-3.1-8b-instant': { name: 'Llama 3.1 8B', contextWindow: 128000, costPer1kInput: 0.00005, costPer1kOutput: 0.00008 },
        'mixtral-8x7b-32768': { name: 'Mixtral 8x7B', contextWindow: 32768, costPer1kInput: 0.00024, costPer1kOutput: 0.00024 }
      },
      defaultModel: 'llama-3.3-70b-versatile',
      headerAuth: (key) => ({ 'Authorization': `Bearer ${key}` }),
      formatRequest: (messages, options) => ({
        model: options.model,
        messages: messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 1000,
        stream: options.stream ?? false
      }),
      parseResponse: (data) => ({
        content: data.choices?.[0]?.message?.content || '',
        finishReason: data.choices?.[0]?.finish_reason,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0
        }
      }),
      parseStreamChunk: (chunk) => {
        if (chunk.includes('[DONE]')) return { done: true };
        try {
          const data = JSON.parse(chunk.replace('data: ', ''));
          return { content: data.choices?.[0]?.delta?.content || '', done: false };
        } catch { return { content: '', done: false }; }
      }
    },

    google: {
      id: 'google',
      name: 'Google Gemini',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
      models: {
        'gemini-2.0-flash-exp': { name: 'Gemini 2.0 Flash', contextWindow: 1000000, costPer1kInput: 0, costPer1kOutput: 0 },
        'gemini-1.5-pro': { name: 'Gemini 1.5 Pro', contextWindow: 2000000, costPer1kInput: 0.00125, costPer1kOutput: 0.005 },
        'gemini-1.5-flash': { name: 'Gemini 1.5 Flash', contextWindow: 1000000, costPer1kInput: 0.000075, costPer1kOutput: 0.0003 }
      },
      defaultModel: 'gemini-2.0-flash-exp',
      headerAuth: (key) => ({}),
      getEndpoint: (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      formatRequest: (messages, options) => ({
        contents: messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        })),
        ...(messages.find(m => m.role === 'system') && {
          systemInstruction: { parts: [{ text: messages.find(m => m.role === 'system').content }] }
        }),
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxTokens ?? 1000
        }
      }),
      parseResponse: (data) => ({
        content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
        finishReason: data.candidates?.[0]?.finishReason,
        usage: {
          promptTokens: data.usageMetadata?.promptTokenCount || 0,
          completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: data.usageMetadata?.totalTokenCount || 0
        }
      })
    },

    ollama: {
      id: 'ollama',
      name: 'Ollama (Local)',
      endpoint: (globalThis.WHL_ENDPOINTS?.OLLAMA_CHAT || 'http://localhost:11434/api/chat'),
      models: {
        'llama3.2': { name: 'Llama 3.2', contextWindow: 128000, costPer1kInput: 0, costPer1kOutput: 0 },
        'mistral': { name: 'Mistral', contextWindow: 32000, costPer1kInput: 0, costPer1kOutput: 0 },
        'codellama': { name: 'Code Llama', contextWindow: 16000, costPer1kInput: 0, costPer1kOutput: 0 }
      },
      defaultModel: 'llama3.2',
      headerAuth: () => ({}),
      formatRequest: (messages, options) => ({
        model: options.model,
        messages: messages,
        stream: options.stream ?? false,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens ?? 1000
        }
      }),
      parseResponse: (data) => ({
        content: data.message?.content || '',
        finishReason: data.done ? 'stop' : null,
        usage: {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
        }
      })
    }
  };

  // ============================================
  // CONFIGURAÇÃO
  // ============================================
  const CONFIG = {
    STORAGE_KEY: 'whl_ai_service',
    CACHE_TTL: 300000, // 5 minutos
    MAX_CACHE_SIZE: 100,
    RETRY_ATTEMPTS: 3,
    RETRY_BASE_DELAY: 1000,
    RATE_LIMIT_WINDOW: 60000, // 1 minuto
    RATE_LIMIT_MAX: 60, // requests por minuto
    REQUEST_TIMEOUT: 30000,
    HEALTH_CHECK_INTERVAL: 300000 // 5 minutos
  };

  // v7.5.0: Verificar se provider tem API key configurada
  function hasValidApiKey(provider) {
    const key = state.configs[provider]?.apiKey;
    if (!key || typeof key !== 'string') return false;
    // Key deve ter ao menos 10 caracteres e não ser placeholder
    if (key.length < 10) return false;
    if (key.startsWith('sk-xxx')) return false;
    if (key.startsWith('••••')) return false;
    if (key === 'YOUR_API_KEY' || key === 'API_KEY_HERE') return false;
    return true;
  }
  
  function getAvailableProviders() {
    return state.fallbackChain.filter(p => hasValidApiKey(p));
  }
  
  // FIX: Diagnóstico para debug
  function diagnoseConfiguration() {
    const result = {
      configured: [],
      invalid: [],
      missing: []
    };
    
    Object.keys(PROVIDERS).forEach(provider => {
      const config = state.configs[provider];
      if (!config || !config.enabled) {
        result.missing.push(provider);
      } else if (!hasValidApiKey(provider)) {
        result.invalid.push({ provider, reason: 'Invalid or placeholder API key' });
      } else {
        result.configured.push(provider);
      }
    });
    
    return result;
  }



  // ============================================
  // ESTADO
  // ============================================
  let state = {
    configs: {}, // { providerId: { apiKey, model, enabled, priority } }
    defaultProvider: 'openai',
    fallbackChain: ['openai', 'anthropic', 'venice', 'groq'],
    cache: new Map(),
    rateLimits: new Map(),
    healthStatus: {},
    stats: {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalTokens: 0,
      totalCost: 0,
      byProvider: {}
    }
  };

  // ============================================
  // v7.9.13 - BACKEND SOBERANO CONFIG
  // ============================================
  const BACKEND_CONFIG = {
    FORCE_BACKEND: true,           // Priorizar AIGateway (usa FETCH_PROXY)
    SHOW_MOTOR_LOGS: true,         // Mostrar logs claros sobre qual motor está sendo usado
    DISABLE_LOCAL_FALLBACK: true   // Desabilitar fallback para providers locais se AIGateway falhar
  };

  // Rate limit global (frontend) — reforço defensivo
  const RATE_LIMIT = {
    maxPerMinute: 3,
    maxPerHour: 30
  };

  const GLOBAL_RATE_LIMIT_STORAGE_KEY = 'whl_ai_global_rate_limiter';
  let globalRateLimiterLoaded = false;
  const globalRateLimiter = {
    perMinute: [],
    perHour: []
  };

  async function loadGlobalRateLimiter() {
    if (globalRateLimiterLoaded) return;
    globalRateLimiterLoaded = true;
    try {
      const data = await chrome.storage.local.get(GLOBAL_RATE_LIMIT_STORAGE_KEY);
      const stored = data?.[GLOBAL_RATE_LIMIT_STORAGE_KEY];
      if (stored && typeof stored === 'object') {
        globalRateLimiter.perMinute = Array.isArray(stored.perMinute) ? stored.perMinute : [];
        globalRateLimiter.perHour = Array.isArray(stored.perHour) ? stored.perHour : [];
      }
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
  }

  async function saveGlobalRateLimiter() {
    try {
      await chrome.storage.local.set({
        [GLOBAL_RATE_LIMIT_STORAGE_KEY]: {
          perMinute: globalRateLimiter.perMinute,
          perHour: globalRateLimiter.perHour
        }
      });
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
  }

  async function checkGlobalRateLimit() {
    await loadGlobalRateLimiter();
    const now = Date.now();
    globalRateLimiter.perMinute = globalRateLimiter.perMinute.filter(t => now - t < 60 * 1000);
    globalRateLimiter.perHour = globalRateLimiter.perHour.filter(t => now - t < 60 * 60 * 1000);

    if (globalRateLimiter.perMinute.length >= RATE_LIMIT.maxPerMinute) {
      throw new Error('Limite de 3 requisições por minuto atingido. Aguarde antes de tentar novamente.');
    }
    if (globalRateLimiter.perHour.length >= RATE_LIMIT.maxPerHour) {
      throw new Error('Limite de 30 requisições por hora atingido. Aguarde antes de tentar novamente.');
    }

    globalRateLimiter.perMinute.push(now);
    globalRateLimiter.perHour.push(now);
    await saveGlobalRateLimiter();
  }

  // ============================================
  // SANITIZAÇÃO CONTRA PROMPT INJECTION
  // ============================================

  function sanitizeForPrompt(text, maxLen = 4000) {
    if (!text) return '';
    let clean = String(text);

    // Remover caracteres de controle
    clean = clean.replace(/[\x00-\x1F\x7F]/g, '');

    // Padrões perigosos de prompt injection
    const dangerousPatterns = [
      /\b(ignore|disregard|forget|override)\s+(all\s+)?(previous|above|prior|earlier)\s*(instructions?|prompts?|rules?|guidelines?)/gi,
      /\b(you\s+are\s+now|act\s+as|pretend\s+to\s+be|roleplay\s+as)\b/gi,
      /\b(system\s*:?\s*prompt|new\s+instructions?|jailbreak|bypass)\b/gi,
      /```(system|instruction|prompt)/gi
    ];

    dangerousPatterns.forEach(pattern => {
      clean = clean.replace(pattern, '[FILTERED]');
    });

    if (clean.length > maxLen) {
      const slice = clean.substring(0, maxLen);
      const tail = slice.substring(Math.max(0, slice.length - 400));
      const idx = Math.max(tail.lastIndexOf('.'), tail.lastIndexOf('!'), tail.lastIndexOf('?'), tail.lastIndexOf('\n'));
      const cutAt = idx >= 0 ? (slice.length - tail.length + idx + 1) : slice.length;
      clean = slice.substring(0, cutAt).trimEnd() + '...';
    }

    return clean.trim();
  }

  function sanitizeMessages(messages) {
    return messages.map(msg => ({
      ...msg,
      content: msg.role === 'system' ? msg.content : sanitizeForPrompt(msg.content)
    }));
  }

  let initialized = false;

  // ============================================
  // INICIALIZAÇÃO
  // ============================================
  async function init() {
    if (initialized) return;
    
    try {
      await loadState();
      startHealthMonitor();
      initialized = true;
      console.log('[AIService] ✅ Inicializado');
      
      if (window.EventBus) {
        window.EventBus.emit('ai:service:ready', { providers: Object.keys(PROVIDERS) });
      }
    } catch (error) {
      console.error('[AIService] ❌ Erro na inicialização:', error);
    }
  }

  async function loadState() {
    try {
      const stored = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
      let data = stored[CONFIG.STORAGE_KEY];
      
      // BUG FIX 1: Parse if it's a string (stored as JSON string instead of object)
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch (e) {
          console.warn('[AIService] Failed to parse stored config:', e);
          data = null;
        }
      }
      
      if (data) {
        state.configs = data.configs || {};
        state.defaultProvider = data.defaultProvider || 'openai';
        state.fallbackChain = data.fallbackChain || ['openai', 'anthropic', 'venice', 'groq'];
        state.stats = data.stats || state.stats;
      }
    } catch (e) {
      console.warn('[AIService] Falha ao carregar estado:', e);
    }
  }

  async function saveState() {
    try {
      // BUG FIX 1: Save as object, NOT JSON.stringify()
      // Chrome storage will automatically serialize the object
      await chrome.storage.local.set({
        [CONFIG.STORAGE_KEY]: {
          configs: state.configs,
          defaultProvider: state.defaultProvider,
          fallbackChain: state.fallbackChain,
          stats: state.stats
        }
      });
    } catch (e) {
      console.error('[AIService] Falha ao salvar estado:', e);
    }
  }

  // ============================================
  // CONFIGURAÇÃO DE PROVIDERS
  // ============================================
  function configureProvider(providerId, config) {
    if (!PROVIDERS[providerId]) {
      throw new Error(`Provider não suportado: ${providerId}`);
    }

    state.configs[providerId] = {
      apiKey: config.apiKey,
      model: config.model || PROVIDERS[providerId].defaultModel,
      enabled: config.enabled ?? true,
      priority: config.priority ?? 50,
      customEndpoint: config.customEndpoint || null
    };

    saveState();
    
    if (window.EventBus) {
      window.EventBus.emit('ai:provider:configured', { providerId, enabled: config.enabled });
    }

    return true;
  }

  function getProviderConfig(providerId) {
    return state.configs[providerId] || null;
  }

  function setDefaultProvider(providerId) {
    if (!PROVIDERS[providerId]) {
      throw new Error(`Provider não suportado: ${providerId}`);
    }
    state.defaultProvider = providerId;
    saveState();
  }

  function setFallbackChain(chain) {
    state.fallbackChain = chain.filter(p => PROVIDERS[p]);
    saveState();
  }

  function isProviderConfigured(providerId) {
    // Se nenhum providerId especificado, verificar se algum está configurado
    if (!providerId) {
      return getConfiguredProviders().length > 0;
    }
    const config = state.configs[providerId];
    // FIX: Usar hasValidApiKey para validação robusta
    return config && config.enabled && hasValidApiKey(providerId);
  }

  function getConfiguredProviders() {
    // FIX: Usar hasValidApiKey para garantir que só retorna providers com keys válidas
    return Object.keys(state.configs).filter(id => {
      const config = state.configs[id];
      return config && config.enabled && hasValidApiKey(id);
    });
  }

  function getDefaultProvider() {
    return state.defaultProvider;
  }

  // ============================================
  // CACHE
  // ============================================
  function getCacheKey(messages, options) {
    return JSON.stringify({ m: messages.map(m => m.content.slice(0, 100)), o: options.model, t: options.temperature });
  }

  function getFromCache(key) {
    const cached = state.cache.get(key);
    if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_TTL) {
      return cached.response;
    }
    state.cache.delete(key);
    return null;
  }

  function setCache(key, response) {
    if (state.cache.size >= CONFIG.MAX_CACHE_SIZE) {
      const oldestKey = state.cache.keys().next().value;
      state.cache.delete(oldestKey);
    }
    state.cache.set(key, { response, timestamp: Date.now() });
  }

  function clearCache() {
    state.cache.clear();
  }

  // ============================================
  // RATE LIMITING
  // ============================================
  function checkProviderRateLimit(providerId) {
    const now = Date.now();
    const limits = state.rateLimits.get(providerId) || { requests: [], window: CONFIG.RATE_LIMIT_WINDOW };
    
    // Limpar requests antigos
    limits.requests = limits.requests.filter(t => now - t < limits.window);
    
    if (limits.requests.length >= CONFIG.RATE_LIMIT_MAX) {
      return false;
    }
    
    limits.requests.push(now);
    state.rateLimits.set(providerId, limits);
    return true;
  }

  // ============================================
  // HEALTH MONITORING
  // ============================================
  let healthMonitorInterval = null;

  function stopHealthMonitor() {
    if (healthMonitorInterval) {
      clearInterval(healthMonitorInterval);
      healthMonitorInterval = null;
    }
  }

  function startHealthMonitor() {
    stopHealthMonitor();
    healthMonitorInterval = setInterval(async () => {
      for (const providerId of getConfiguredProviders()) {
        try {
          const start = Date.now();
          await testProvider(providerId);
          state.healthStatus[providerId] = {
            status: 'healthy',
            latency: Date.now() - start,
            lastCheck: Date.now()
          };
        } catch (e) {
          state.healthStatus[providerId] = {
            status: 'unhealthy',
            error: e.message,
            lastCheck: Date.now()
          };
        }
      }
      
      if (window.EventBus) {
        window.EventBus.emit('ai:health:updated', state.healthStatus);
      }
    }, CONFIG.HEALTH_CHECK_INTERVAL);
  }

  // Limpar ao descarregar a página para evitar leaks em recarregamentos
  window.addEventListener('beforeunload', () => {
    stopHealthMonitor();
  });

  async function testProvider(providerId) {
    const config = state.configs[providerId];
    if (!config || !config.apiKey) {
      throw new Error('Provider não configurado');
    }

    return await complete([{ role: 'user', content: 'ping' }], {
      provider: providerId,
      maxTokens: 5,
      skipCache: true,
      skipFallback: true
    });
  }

  function getHealthStatus(providerId) {
    return state.healthStatus[providerId] || { status: 'unknown' };
  }

  // ============================================
  // CHAMADA PRINCIPAL
  // v7.9.13: Backend Soberano - logs claros sobre qual motor está sendo usado
  // ============================================
  async function complete(messages, options = {}) {
    const startTime = Date.now();

    // Normalizar mensagens e sanitizar para evitar prompt injection
    if (!Array.isArray(messages)) {
      messages = [{ role: 'user', content: String(messages) }];
    }
    messages = sanitizeMessages(messages);

    // Rate limit defensivo (frontend)
    await checkGlobalRateLimit();
    
    if (BACKEND_CONFIG.SHOW_MOTOR_LOGS) {
      console.log('[AIService] 🚀 Iniciando requisição IA...');
    }
    
    // PRIORIDADE 0: AIGateway (usa FETCH_PROXY, é o motor principal)
    if (window.AIGateway && typeof window.AIGateway.complete === 'function') {
      try {
        console.log('[AIService] 🔗 [MOTOR: BACKEND/AIGateway] Usando motor principal...');
        const result = await window.AIGateway.complete(messages, {
          model: options.model,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
          userId: options.userId || 'default'
        });
        
        if (result && (result.text || result.content)) {
          const latency = Date.now() - startTime;
          console.log(`[AIService] ✅ [MOTOR: BACKEND] Sucesso em ${latency}ms | Provider: ${result.provider || 'unknown'}`);
          return {
            content: result.text || result.content,
            provider: result.provider || 'backend',
            model: result.model,
            usage: result.usage || { totalTokens: 0 },
            latency
          };
        }
      } catch (gatewayError) {
        console.error('[AIService] ❌ [MOTOR: BACKEND] AIGateway falhou:', gatewayError.message);
        
        // v7.9.13: Se FORCE_BACKEND e DISABLE_LOCAL_FALLBACK, não continuar
        if (BACKEND_CONFIG.FORCE_BACKEND && BACKEND_CONFIG.DISABLE_LOCAL_FALLBACK) {
          console.error('[AIService] 🚨 [MOTOR: BLOQUEADO] Backend obrigatório falhou. Fallback local desabilitado.');
          if (window.EventBus) {
            window.EventBus.emit('ai:backend:error', { source: 'AIGateway', message: gatewayError.message });
          }
          throw new Error(`❌ Backend obrigatório falhou: ${gatewayError.message}`);
        }
      }
    }
    
    // PRIORIDADE 1: BackendClient se conectado
    if (window.BackendClient && window.BackendClient.isConnected()) {
      try {
        console.log('[AIService] 🔗 [MOTOR: BACKEND/BackendClient] Tentando backend conectado...');
        const result = await window.BackendClient.ai.complete(messages, {
          model: options.model,
          temperature: options.temperature,
          maxTokens: options.maxTokens
        });
        
        if (result && (result.content || result.text)) {
          const latency = Date.now() - startTime;
          console.log(`[AIService] ✅ [MOTOR: BACKEND] Sucesso em ${latency}ms`);
          return {
            content: result.content || result.text,
            provider: 'backend',
            model: result.model || 'groq',
            usage: result.usage || { totalTokens: 0 },
            latency
          };
        }
      } catch (backendError) {
        console.error('[AIService] ❌ [MOTOR: BACKEND] BackendClient falhou:', backendError.message);
        
        // v7.9.13: Se FORCE_BACKEND, não continuar para providers locais
        if (BACKEND_CONFIG.FORCE_BACKEND && BACKEND_CONFIG.DISABLE_LOCAL_FALLBACK) {
          console.error('[AIService] 🚨 [MOTOR: BLOQUEADO] Backend obrigatório. Fallback local desabilitado.');
          throw new Error(`❌ Backend obrigatório falhou: ${backendError.message}`);
        }
        
        console.warn('[AIService] ⚠️ [MOTOR: LOCAL] Tentando providers locais como fallback...');
      }
    }
    
    // PRIORIDADE 2: Providers configurados localmente (APENAS se FORCE_BACKEND = false)
    if (BACKEND_CONFIG.FORCE_BACKEND && BACKEND_CONFIG.DISABLE_LOCAL_FALLBACK) {
      console.error('[AIService] ❌ [MOTOR: BLOQUEADO] Nenhum backend disponível. FORCE_BACKEND=true impede uso de providers locais.');
      throw new Error('❌ Backend obrigatório indisponível. Providers locais desabilitados.');
    }
    
    console.warn('[AIService] ⚠️ [MOTOR: LOCAL] Usando providers locais (fallback)');
    
    const providerId = options.provider || state.defaultProvider;
    const useCache = options.cache !== false && !options.skipCache;
    const useFallback = options.fallback !== false && !options.skipFallback;
    
    // Verificar cache
    if (useCache) {
      const cacheKey = getCacheKey(messages, { ...options, provider: providerId });
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { ...cached, fromCache: true };
      }
    }

    // Tentar provider principal e fallbacks
    const providersToTry = useFallback
      ? [providerId, ...state.fallbackChain.filter(p => p !== providerId && isProviderConfigured(p))]
      : [providerId];

    let lastError = null;

    for (const pid of providersToTry) {
      if (!isProviderConfigured(pid)) continue;
      if (!checkProviderRateLimit(pid)) continue;

      try {
        const result = await callProvider(pid, messages, options);
        
        // Atualizar stats
        updateStats(pid, result, true, Date.now() - startTime);
        
        // Cachear resultado
        if (useCache) {
          const cacheKey = getCacheKey(messages, { ...options, provider: pid });
          setCache(cacheKey, result);
        }

        // Emitir evento
        if (window.EventBus) {
          window.EventBus.emit('ai:completion:success', {
            provider: pid,
            tokens: result.usage?.totalTokens,
            latency: Date.now() - startTime
          });
        }

        return { ...result, provider: pid, latency: Date.now() - startTime };
      } catch (error) {
        lastError = error;
        console.warn(`[AIService] Falha no provider ${pid}:`, error.message);
        updateStats(pid, null, false, Date.now() - startTime);
      }
    }

    // Emitir evento de erro
    if (window.EventBus) {
      window.EventBus.emit('ai:completion:error', { error: lastError?.message });
    }

    throw lastError || new Error('Nenhum provider disponível');
  }

  async function callProvider(providerId, messages, options) {
    const provider = PROVIDERS[providerId];
    const config = state.configs[providerId];
    
    if (!provider || !config) {
      throw new Error(`Provider ${providerId} não configurado`);
    }

    const model = options.model || config.model || provider.defaultModel;
    const endpoint = provider.getEndpoint
      ? provider.getEndpoint(model, config.apiKey)
      : (config.customEndpoint || provider.endpoint);

    const headers = {
      'Content-Type': 'application/json',
      ...provider.headerAuth(config.apiKey)
    };

    const body = provider.formatRequest(messages, { ...options, model });

    // Retry com exponential backoff
    let lastError = null;
    for (let attempt = 0; attempt < CONFIG.RETRY_ATTEMPTS; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), options.timeout || CONFIG.REQUEST_TIMEOUT);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return provider.parseResponse(data);
      } catch (error) {
        lastError = error;
        if (attempt < CONFIG.RETRY_ATTEMPTS - 1) {
          await sleep(CONFIG.RETRY_BASE_DELAY * Math.pow(2, attempt));
        }
      }
    }

    throw lastError;
  }

  // ============================================
  // STREAMING
  // ============================================
  async function* stream(messages, options = {}) {
    const providerId = options.provider || state.defaultProvider;
    const provider = PROVIDERS[providerId];
    const config = state.configs[providerId];

    if (!provider || !config) {
      throw new Error(`Provider ${providerId} não configurado`);
    }

    if (!provider.parseStreamChunk) {
      throw new Error(`Provider ${providerId} não suporta streaming`);
    }

    const model = options.model || config.model || provider.defaultModel;
    const endpoint = provider.getEndpoint
      ? provider.getEndpoint(model, config.apiKey)
      : (config.customEndpoint || provider.endpoint);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...provider.headerAuth(config.apiKey)
      },
      body: JSON.stringify(provider.formatRequest(messages, { ...options, model, stream: true }))
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim() || line.startsWith(':')) continue;
        const parsed = provider.parseStreamChunk(line);
        if (parsed.done) return;
        if (parsed.content) yield parsed.content;
      }
    }
  }

  // ============================================
  // FUNÇÕES UTILITÁRIAS
  // ============================================
  function estimateTokens(text) {
    // Estimativa simples: ~4 caracteres por token
    return Math.ceil(text.length / 4);
  }

  function estimateCost(providerId, model, inputTokens, outputTokens) {
    const provider = PROVIDERS[providerId];
    const modelInfo = provider?.models[model];
    if (!modelInfo) return 0;

    return (inputTokens / 1000 * modelInfo.costPer1kInput) +
           (outputTokens / 1000 * modelInfo.costPer1kOutput);
  }

  function updateStats(providerId, result, success, latency) {
    state.stats.totalRequests++;
    if (success) {
      state.stats.successfulRequests++;
      if (result?.usage) {
        state.stats.totalTokens += result.usage.totalTokens || 0;
        const config = state.configs[providerId];
        state.stats.totalCost += estimateCost(
          providerId,
          config?.model,
          result.usage.promptTokens,
          result.usage.completionTokens
        );
      }
    } else {
      state.stats.failedRequests++;
    }

    if (!state.stats.byProvider[providerId]) {
      state.stats.byProvider[providerId] = { requests: 0, tokens: 0, errors: 0, avgLatency: 0 };
    }

    const providerStats = state.stats.byProvider[providerId];
    providerStats.requests++;
    if (success && result?.usage) {
      providerStats.tokens += result.usage.totalTokens || 0;
      providerStats.avgLatency = (providerStats.avgLatency * (providerStats.requests - 1) + latency) / providerStats.requests;
    } else {
      providerStats.errors++;
    }

    // Salvar periodicamente
    if (state.stats.totalRequests % 10 === 0) {
      saveState();
    }
  }

  function getStats() {
    return { ...state.stats };
  }

  function resetStats() {
    state.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalTokens: 0,
      totalCost: 0,
      byProvider: {}
    };
    saveState();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================
  // FUNÇÕES DE CONVENIÊNCIA
  // ============================================
  async function chat(userMessage, options = {}) {
    const messages = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    if (options.history) {
      messages.push(...options.history);
    }
    messages.push({ role: 'user', content: userMessage });
    return complete(messages, options);
  }

  async function generateText(prompt, options = {}) {
    return complete([{ role: 'user', content: prompt }], options);
  }

  /**
   * Gera uma resposta baseada em mensagem e contexto
   * @param {string} message - Mensagem a responder
   * @param {Array} context - Histórico de mensagens [{role, content}]
   * @param {Object} options - Opções adicionais
   * @returns {Promise<string>} Texto da resposta
   */
  async function generateResponse(message, context = [], options = {}) {
    const systemPrompt = options.systemPrompt || `Você é um assistente profissional de atendimento ao cliente.
Diretrizes:
- Seja cordial e prestativo
- Responda de forma clara e objetiva
- Use linguagem profissional mas acessível
- Se não souber algo, seja honesto
- Mantenha as respostas concisas (máximo 3 parágrafos)`;

    const messages = [
      { role: 'system', content: systemPrompt }
    ];
    
    // Adicionar contexto
    if (context && context.length > 0) {
      // Limitar a últimas 10 mensagens
      const recentContext = context.slice(-10);
      messages.push(...recentContext);
    }
    
    // Adicionar mensagem atual
    messages.push({ role: 'user', content: message });
    
    try {
      const result = await complete(messages, {
        temperature: options.temperature || 0.7,
        maxTokens: options.maxTokens || 500,
        ...options
      });
      
      return result.content || result.text || '';
    } catch (error) {
      console.error('[AIService] Erro em generateResponse:', error);
      throw error;
    }
  }

  async function analyzeText(text, instruction, options = {}) {
    // SECURITY FIX P0-032: Sanitize text to prevent prompt injection
    const safeText = sanitizeForPrompt(text, 8000);
    const safeInstruction = sanitizeForPrompt(instruction, 1000);

    return complete([
      { role: 'system', content: safeInstruction },
      { role: 'user', content: safeText }
    ], options);
  }

  async function translateText(text, targetLanguage, options = {}) {
    // SECURITY FIX (PARTIAL-010): Sanitize targetLanguage to prevent prompt injection
    const safeTargetLanguage = sanitizeForPrompt(targetLanguage || 'português', 50);
    // SECURITY FIX P0-032: Sanitize text to prevent prompt injection
    const safeText = sanitizeForPrompt(text, 8000);

    return complete([
      { role: 'system', content: `Você é um tradutor. Traduza o texto para ${safeTargetLanguage}. Retorne apenas a tradução, sem explicações.` },
      { role: 'user', content: safeText }
    ], options);
  }

  async function summarize(text, options = {}) {
    // SECURITY FIX P0-032: Sanitize text to prevent prompt injection
    const safeText = sanitizeForPrompt(text, 10000);

    return complete([
      { role: 'system', content: 'Resuma o texto de forma concisa, mantendo os pontos principais.' },
      { role: 'user', content: safeText }
    ], { ...options, maxTokens: options.maxTokens || 500 });
  }

  async function extractJSON(text, schema, options = {}) {
    // SECURITY FIX (PARTIAL-010): Sanitize schema values to prevent prompt injection
    const sanitizedSchema = {};
    for (const [key, value] of Object.entries(schema || {})) {
      // Only allow simple string values in schema, sanitize them
      if (typeof value === 'string') {
        sanitizedSchema[key] = sanitizeForPrompt(value, 100);
      } else {
        sanitizedSchema[key] = String(value).substring(0, 20); // Limit to safe length
      }
    }

    // SECURITY FIX P0-032: Sanitize text to prevent prompt injection
    const safeText = sanitizeForPrompt(text, 8000);

    const result = await complete([
      { role: 'system', content: `Extraia informações do texto e retorne um JSON válido seguindo este schema: ${JSON.stringify(sanitizedSchema)}. Retorne APENAS o JSON, sem markdown ou explicações.` },
      { role: 'user', content: safeText }
    ], options);

    try {
      return JSON.parse(result.content.replace(/```json\n?|\n?```/g, ''));
    } catch {
      throw new Error('Falha ao parsear JSON da resposta');
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  window.AIService = {
    // Lifecycle
    init,
    stopHealthMonitor,
    
    // Configuration
    configureProvider,
    getProviderConfig,
    setDefaultProvider,
    getDefaultProvider,
    setFallbackChain,
    isProviderConfigured,
    getConfiguredProviders,
    hasValidApiKey,
    getAvailableProviders,
    diagnoseConfiguration,
    
    // Core
    complete,
    stream,
    chat,
    generateText,
    generateResponse,
    analyzeText,
    translateText,
    summarize,
    extractJSON,
    
    // Provider testing
    testProvider,
    getHealthStatus,
    
    // Cache
    clearCache,
    
    // Stats
    getStats,
    resetStats,
    estimateTokens,
    estimateCost,
    
    // Constants
    PROVIDERS,
    CONFIG
  };

  console.log('[AIService] 🧠 Serviço de IA v1.0 carregado');
  console.log('[AIService] 📋 Providers:', Object.keys(PROVIDERS).join(', '));
})();
