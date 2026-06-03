/**
 * 🔑 API Configuration v1.0
 * Configuração centralizada de chaves API e providers
 * 
 * IMPORTANTE: Em produção, estas chaves devem ser obtidas
 * do backend de forma segura, não hardcoded.
 * 
 * @version 1.0.0
 */
(function() {
  'use strict';

  const WHL_DEBUG = (typeof localStorage !== 'undefined' && localStorage.getItem('whl_debug') === 'true');

  // Fallback para API base
  const API_BASE_URL = (window?.WHL_CONFIG?.apiUrl) || 'https://api.whatshybrid.com';

  // ============================================
  // CONFIGURAÇÃO DE PROVIDERS
  // ============================================

  const API_CONFIG = {
    // Provider principal
    PRIMARY_PROVIDER: 'openai',
    
    // Fallback (em ordem de prioridade)
    FALLBACK_PROVIDERS: ['groq'],
    
    // Modelos padrão por provider
    DEFAULT_MODELS: {
      openai: 'gpt-4o',
      groq: 'llama-3.1-70b-versatile'
    },
    
    // Chaves API (NUNCA hardcode em produção)
    API_KEYS: {
      openai: '',
      groq: ''
    },
    
    // Endpoints
    ENDPOINTS: {
      openai: 'https://api.openai.com/v1/chat/completions',
      groq: 'https://api.groq.com/openai/v1/chat/completions'
    },
    
    // Limites de rate
    RATE_LIMITS: {
      openai: { requestsPerMinute: 60, tokensPerMinute: 90000 },
      groq: { requestsPerMinute: 30, tokensPerMinute: 14400 }
    },
    
    // Configurações de temperatura padrão
    DEFAULT_TEMPERATURE: 0.7,
    
    // Máximo de tokens por resposta
    MAX_TOKENS: 500,
    
    // Timeout em ms
    TIMEOUT: 30000
  };

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  async function init() {
    if (WHL_DEBUG) console.log('[APIConfig] Inicializando configuração...');

    // v9.4.0 SECURITY: NÃO carregamos mais API keys de LLM providers no lado
    // do cliente. Modelo SaaS = IA passa pelo backend SEMPRE. Backend tem a key
    // no .env (OPENAI_API_KEY, ANTHROPIC_API_KEY) e debita tokens do saldo do
    // workspace por chamada. Cliente NUNCA configura key — só paga plano.
    //
    // v9.4.6: limpeza expandida pra TODAS as keys legadas que algum módulo
    // antigo possa ter salvo. Sem isso, se cliente atualizou da v8.x → v9.4.6,
    // chrome.storage ainda teria keys salvas que módulos antigos liam.
    try {
      await chrome.storage?.local?.remove?.([
        // Versão 1 (super-antigo)
        'openaiApiKey',
        'apiKey',
        // Versão 2 (whl_*_api_key naming)
        'whl_openai_api_key',
        'whl_anthropic_api_key',
        'whl_groq_api_key',
        'whl_google_api_key',
        // Versão 3 (consolidado)
        'whl_ai_config_v2',
        'whl_api_keys',
      ]).catch(() => {});
      if (WHL_DEBUG) console.log('[APIConfig] ✅ Storage legacy keys limpas');
    } catch (_) {}

    API_CONFIG.API_KEYS.openai = '';
    API_CONFIG.API_KEYS.groq = '';

    // Registrar chaves no AIGateway
    if (window.AIGateway) {
      // Limpar chaves antigas
      const existingKeys = window.AIGateway.getApiKeys() || {};
      for (const provider of Object.keys(existingKeys)) {
        for (const key of existingKeys[provider] || []) {
          window.AIGateway.removeApiKey(provider, key);
        }
      }

      // Adicionar OpenAI como primário
      if (API_CONFIG.API_KEYS.openai) {
        window.AIGateway.addApiKey('openai', API_CONFIG.API_KEYS.openai);
        if (WHL_DEBUG) console.log('[APIConfig] ✅ OpenAI configurado como primário');
      } else if (WHL_DEBUG) {
        console.warn('[APIConfig] Nenhuma API key OpenAI configurada (esperado em produção com backend).');
      }

      // Adicionar Groq como fallback
      if (API_CONFIG.API_KEYS.groq) {
        window.AIGateway.addApiKey('groq', API_CONFIG.API_KEYS.groq);
        if (WHL_DEBUG) console.log('[APIConfig] ✅ Groq configurado como fallback');
      } else if (WHL_DEBUG) {
        console.warn('[APIConfig] Nenhuma API key Groq configurada.');
      }
    }

    // Salvar no storage para persistência
    await chrome.storage.local.set({
      'whl_api_config': {
        primaryProvider: API_CONFIG.PRIMARY_PROVIDER,
        fallbackProviders: API_CONFIG.FALLBACK_PROVIDERS,
        defaultModels: API_CONFIG.DEFAULT_MODELS,
        hasOpenAI: !!API_CONFIG.API_KEYS.openai,
        hasGroq: !!API_CONFIG.API_KEYS.groq,
        configuredAt: Date.now()
      }
    });

    console.log('[APIConfig] ✅ Configuração concluída');
    return true;
  }

  /**
   * Obtém a chave API para um provider
   */
  function getApiKey(provider) {
    return API_CONFIG.API_KEYS[provider] || null;
  }

  /**
   * Obtém o modelo padrão para um provider
   */
  function getDefaultModel(provider) {
    return API_CONFIG.DEFAULT_MODELS[provider] || null;
  }

  /**
   * Obtém o endpoint de um provider
   */
  function getEndpoint(provider) {
    return API_CONFIG.ENDPOINTS[provider] || null;
  }

  /**
   * Verifica se um provider está configurado
   */
  function isProviderConfigured(provider) {
    return !!API_CONFIG.API_KEYS[provider];
  }

  /**
   * Obtém lista de providers configurados em ordem de prioridade
   */
  function getConfiguredProviders() {
    const providers = [];
    
    // Adicionar primário primeiro
    if (API_CONFIG.API_KEYS[API_CONFIG.PRIMARY_PROVIDER]) {
      providers.push(API_CONFIG.PRIMARY_PROVIDER);
    }
    
    // Adicionar fallbacks
    for (const provider of API_CONFIG.FALLBACK_PROVIDERS) {
      if (API_CONFIG.API_KEYS[provider] && !providers.includes(provider)) {
        providers.push(provider);
      }
    }
    
    return providers;
  }

  /**
   * Diagnóstico da configuração
   */
  function diagnose() {
    return {
      primaryProvider: API_CONFIG.PRIMARY_PROVIDER,
      fallbackProviders: API_CONFIG.FALLBACK_PROVIDERS,
      configuredProviders: getConfiguredProviders(),
      openaiConfigured: isProviderConfigured('openai'),
      groqConfigured: isProviderConfigured('groq'),
      claudeConfigured: false, // Removido
      googleConfigured: false  // Não configurado
    };
  }

  // ============================================
  // EXPORT
  // ============================================

  const APIConfig = {
    API_BASE_URL,
    init,
    getApiKey,
    getDefaultModel,
    getEndpoint,
    isProviderConfigured,
    getConfiguredProviders,
    diagnose,
    CONFIG: API_CONFIG
  };

  window.APIConfig = APIConfig;

  // Auto-init após DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
  } else {
    setTimeout(init, 1000);
  }

  console.log('[APIConfig] 🔑 Módulo de configuração carregado');

})();
