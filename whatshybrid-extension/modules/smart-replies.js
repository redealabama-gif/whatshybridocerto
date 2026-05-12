/**
 * 🤖 SmartRepliesModule - Sistema Completo de Respostas Inteligentes com IA
 * WhatsHybrid v50 - Baseado no CopilotEngine do Quantum CRM
 * 
 * TODO: AUDIT-NEW-018 (P3) - i18n AI Prompts
 * This module has hardcoded Portuguese AI prompts that should be internationalized.
 * See: docs/internal/PEND-MED-003-I18N-AI-PROMPTS-FIX.md for full implementation guide.
 * Lines affected: 94-124 (PERSONAS definitions)
 * 
 * Funcionalidades COMPLETAS:
 * - Integração com OpenAI, Anthropic, Venice AI
 * - Modos: OFF, SUGGEST, SEMI_AUTO, FULL_AUTO
 * - Personas customizáveis + prompt personalizado
 * - Quick replies predefinidas com categorias
 * - Correção de texto inline (gramática, formal, informal)
 * - Painel flutuante de sugestões
 * - Resumo de conversas
 * - Simulação de digitação
 * - Histórico de contexto
 * - Análise de sentimento
 */

(function() {
    'use strict';

    // Rate limiting: 10 req/min
    const rateLimiter = {
        requests: [],
        maxRequests: 10,
        windowMs: 60 * 1000
    };

    function checkRateLimit() {
        const now = Date.now();
        rateLimiter.requests = rateLimiter.requests.filter(t => now - t < rateLimiter.windowMs);
        if (rateLimiter.requests.length >= rateLimiter.maxRequests) {
            return { allowed: false, error: 'Rate limit atingido. Aguarde 1 minuto.' };
        }
        rateLimiter.requests.push(now);
        return { allowed: true };
    }
    const STORAGE_KEY = 'whl_smart_replies_v2';

    // v7.9.13: Removidos modos automáticos/semi-automáticos/assistente.
    // Mantemos compatibilidade: qualquer estado antigo migra para SUGGEST (não envia sozinho).
    const MODES = {
        OFF: 'off',
        SUGGEST: 'suggest'
    };

    function normalizeMode(mode) {
        if (!mode) return MODES.SUGGEST;
        if (mode === 'full_auto' || mode === 'semi_auto' || mode === 'assist') return MODES.SUGGEST;
        return (mode === MODES.OFF || mode === MODES.SUGGEST) ? mode : MODES.SUGGEST;
    }

    const PROVIDERS = {
        OPENAI: {
            id: 'openai',
            name: 'OpenAI',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            models: [
                { id: 'gpt-4o', name: 'GPT-4o (Recomendado)' },
                { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Econômico)' },
                { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
                { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
            ],
            headerKey: 'Authorization',
            headerPrefix: 'Bearer '
        },
        ANTHROPIC: {
            id: 'anthropic',
            name: 'Anthropic Claude',
            endpoint: 'https://api.anthropic.com/v1/messages',
            models: [
                { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
                { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku (Rápido)' },
                { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' }
            ],
            headerKey: 'x-api-key',
            headerPrefix: ''
        },
        VENICE: {
            id: 'venice',
            name: 'Venice AI',
            endpoint: 'https://api.venice.ai/api/v1/chat/completions',
            models: [
                { id: 'llama-3.3-70b', name: 'Llama 3.3 70B' },
                { id: 'llama-3.1-405b', name: 'Llama 3.1 405B' }
            ],
            headerKey: 'Authorization',
            headerPrefix: 'Bearer '
        }
    };

    const DEFAULT_PERSONAS = {
        professional: {
            id: 'professional', name: '👔 Profissional', description: 'Formal e objetivo',
            systemPrompt: `Você é um assistente profissional de atendimento ao cliente. Mantenha um tom formal, educado e objetivo. Seja conciso e direto. Sempre ofereça ajuda adicional.`,
            temperature: 0.5, maxTokens: 300
        },
        friendly: {
            id: 'friendly', name: '😊 Amigável', description: 'Descontraído e acolhedor',
            systemPrompt: `Você é um assistente amigável e acolhedor. Use um tom descontraído mas respeitoso. Pode usar emojis ocasionalmente. Seja empático e atencioso.`,
            temperature: 0.7, maxTokens: 350
        },
        sales: {
            id: 'sales', name: '💼 Vendas', description: 'Persuasivo e entusiasmado',
            systemPrompt: `Você é um vendedor experiente. Destaque benefícios e valor. Use técnicas de persuasão éticas. Crie senso de oportunidade. Responda objeções positivamente.`,
            temperature: 0.7, maxTokens: 400
        },
        support: {
            id: 'support', name: '🛠️ Suporte', description: 'Técnico e solucionador',
            systemPrompt: `Você é um especialista em suporte técnico. Forneça soluções claras e passo a passo. Seja paciente e detalhado. Confirme a resolução.`,
            temperature: 0.4, maxTokens: 500
        },
        concierge: {
            id: 'concierge', name: '🎩 Concierge', description: 'Elegante e prestativo',
            systemPrompt: `Você é um concierge de luxo. Mantenha um tom elegante, sofisticado e extremamente prestativo. Antecipe necessidades e ofereça soluções premium. Seja discreto e atencioso aos detalhes.`,
            temperature: 0.6, maxTokens: 400
        },
        coach: {
            id: 'coach', name: '🎯 Coach', description: 'Motivacional e questionador',
            systemPrompt: `Você é um coach motivacional. Faça perguntas poderosas que levem à reflexão. Encoraje o crescimento e a ação. Use uma abordagem positiva e inspiradora. Ajude as pessoas a encontrarem suas próprias soluções.`,
            temperature: 0.7, maxTokens: 400
        },
        custom: {
            id: 'custom', name: '✨ Personalizado', description: 'Configure seu próprio assistente',
            systemPrompt: '', temperature: 0.7, maxTokens: 400
        }
    };

    const DEFAULT_QUICK_REPLIES = [
        { id: 'greeting', text: 'Olá! Como posso ajudar você hoje?', category: 'Saudações', emoji: '👋' },
        { id: 'thanks', text: 'Obrigado pelo contato! Estou à disposição.', category: 'Saudações', emoji: '🙏' },
        { id: 'wait', text: 'Um momento, por favor. Estou verificando...', category: 'Aguardo', emoji: '⏳' },
        { id: 'checking', text: 'Vou verificar essa informação e já retorno.', category: 'Aguardo', emoji: '🔍' },
        { id: 'confirm', text: 'Perfeito! Confirmado. Mais alguma dúvida?', category: 'Confirmação', emoji: '✅' },
        { id: 'price', text: 'O valor é R$ [VALOR]. Posso ajudar com mais alguma informação?', category: 'Vendas', emoji: '💰' },
        { id: 'pix', text: 'Chave PIX: [SUA CHAVE]. Após o pagamento, envie o comprovante.', category: 'Vendas', emoji: '💳' },
        { id: 'closing', text: 'Foi um prazer atendê-lo! Tenha um ótimo dia! 😊', category: 'Encerramento', emoji: '👋' },
        { id: 'unavailable', text: 'No momento não estou disponível. Retornarei assim que possível.', category: 'Ausência', emoji: '🔕' }
    ];

    const CONFIG = {
        AUTO_RESPONSE_DELAY: 3000,
        TYPING_SPEED: 50,
        MAX_TYPING_TIME: 5000,
        MAX_AUTO_RESPONSES: 5,
        CONTEXT_MESSAGES: 10,
        SUGGESTIONS_COUNT: 1, // Generate only ONE best suggestion
        SENTIMENT_KEYWORDS: {
            positive: ['obrigado', 'ótimo', 'excelente', 'perfeito', 'adorei', 'maravilhoso', 'parabéns', 'top', 'amei', 'incrível', 'show', 'demais', 'legal', 'bom', 'gostei', 'satisfeito'],
            negative: [
                'problema', 'ruim', 'péssimo', 'horrível', 'reclamar', 'insatisfeito', 'cancelar', 'devolver',
                'merda', 'bosta', 'porra', 'caralho', 'droga', 'inferno',
                'idiota', 'burro', 'imbecil', 'otário', 'babaca', 'cretino',
                'fdp', 'pqp', 'vsf', 'vtnc', 'tnc', 'vai tomar', 'vai se foder', 'foda-se',
                'filho da puta', 'desgraça', 'maldito', 'lixo', 'nojo'
            ],
            urgent: ['urgente', 'emergência', 'agora', 'imediato', 'rápido', 'socorro', 'ajuda']
        }
    };

    let state = {
        mode: MODES.OFF,
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: null,
        activePersona: 'professional',
        customPersonas: {},
        customSystemPrompt: '',
        quickReplies: [...DEFAULT_QUICK_REPLIES],
        conversationHistory: {},
        autoResponseCounts: {},
        suggestions: [],
        isLoading: false,
        lastError: null,
        floatingPanelVisible: false,
        currentChatId: null
    };

    let autoResponseTimeouts = new Map();
    let initialized = false;
    let floatingPanel = null;

    // ============ STORAGE ============
    async function loadState() {
        try {
            const result = await chrome.storage.local.get(STORAGE_KEY);
            if (result[STORAGE_KEY]) state = { ...state, ...result[STORAGE_KEY] };
            // v7.9.12: migrar modos antigos (ex.: full_auto)
            state.mode = normalizeMode(state.mode);
            state.apiKey = await loadApiKey();
        } catch (e) { console.error('[SmartReplies] Erro ao carregar:', e); }
    }

    async function saveState() {
        try {
            const toSave = { ...state };
            delete toSave.apiKey; delete toSave.isLoading; delete toSave.lastError; delete toSave.floatingPanelVisible;
            await chrome.storage.local.set({ [STORAGE_KEY]: toSave });
        } catch (e) { console.error('[SmartReplies] Erro ao salvar:', e); }
    }

    async function saveApiKey(key) {
        try { await chrome.storage.local.set({ 'whl_ai_api_key': key }); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }

    async function loadApiKey() {
        try { const r = await chrome.storage.local.get('whl_ai_api_key'); return r['whl_ai_api_key'] || null; } catch (e) { return null; }
    }

    // ============ INIT ============
    async function init() {
        if (initialized) return;
        console.log('[SmartReplies] Inicializando...');
        
        await loadState();
        
        // Sincronizar com AIService se disponível
        await syncWithAIService();
        
        injectStyles();
        initialized = true;
        
        if (window.EventBus) {
            window.EventBus.emit(window.EventBus.EVENTS.MODULE_LOADED, { module: 'SmartReplies' });
        }
        
        console.log('[SmartReplies] Modo:', state.mode);
        console.log('[SmartReplies] Configurado:', isConfigured());
    }

    // BUG FIX 2: Nova função para sincronizar com AIService
    async function syncWithAIService() {
        try {
            if (!window.AIService) {
                console.log('[SmartReplies] AIService não disponível, usando config própria');
                return;
            }

            // BUG FIX 2: Wait for AIService to be fully initialized
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verificar se AIService tem provider configurado
            // BUG FIX: Use getConfiguredProviders() instead of isProviderConfigured() without parameter
            if (window.AIService.getConfiguredProviders &&
                window.AIService.getConfiguredProviders().length > 0) {
                console.log('[SmartReplies] ✅ Sincronizado com AIService');

                // Obter configuração do provider padrão
                const defaultProvider = window.AIService.getDefaultProvider?.();
                if (defaultProvider) {
                    state.provider = defaultProvider;

                    // Get model from AIService
                    const providerConfig = window.AIService.getProviderConfig?.(defaultProvider);
                    if (providerConfig?.model) {
                        state.model = providerConfig.model;
                    }

                    console.log('[SmartReplies] Provider:', state.provider, 'Model:', state.model);
                }
            }
        } catch (e) {
            console.warn('[SmartReplies] Erro ao sincronizar com AIService:', e);
        }
    }

    function injectStyles() {
        if (document.getElementById('smart-replies-styles')) return;
        const style = document.createElement('style');
        style.id = 'smart-replies-styles';
        style.textContent = `
            .sr-floating-panel{position:fixed;bottom:80px;right:20px;width:340px;max-height:450px;background:linear-gradient(135deg,rgba(26,26,46,0.98),rgba(30,30,60,0.98));border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.4),0 0 0 1px rgba(139,92,246,0.3);z-index:10000;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;animation:srSlideIn .3s ease}
            @keyframes srSlideIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
            .sr-panel-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:linear-gradient(135deg,#8B5CF6,#3B82F6);color:#fff}
            .sr-panel-title{font-weight:600;font-size:14px}
            .sr-panel-close{background:rgba(255,255,255,0.2);border:none;color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}
            .sr-panel-close:hover{background:rgba(255,255,255,0.3)}
            .sr-panel-body{padding:12px;max-height:350px;overflow-y:auto}
            .sr-suggestion-item{padding:10px 12px;background:rgba(255,255,255,0.05);border-radius:10px;margin-bottom:8px;cursor:pointer;border:1px solid rgba(255,255,255,0.1);transition:all .2s}
            .sr-suggestion-item:hover{background:rgba(139,92,246,0.2);border-color:rgba(139,92,246,0.5);transform:translateX(4px)}
            .sr-suggestion-type{font-size:10px;text-transform:uppercase;color:#8B5CF6;margin-bottom:4px;font-weight:600}
            .sr-suggestion-text{font-size:13px;color:rgba(255,255,255,0.9);line-height:1.4}
            .sr-loading{display:flex;align-items:center;justify-content:center;padding:20px;color:rgba(255,255,255,0.6)}
            .sr-loading-spinner{width:24px;height:24px;border:2px solid rgba(139,92,246,0.3);border-top-color:#8B5CF6;border-radius:50%;animation:spin 1s linear infinite;margin-right:10px}
            @keyframes spin{to{transform:rotate(360deg)}}
            .sr-fab{position:fixed;bottom:20px;right:20px;width:56px;height:56px;background:linear-gradient(135deg,#8B5CF6,#3B82F6);border-radius:50%;box-shadow:0 4px 16px rgba(139,92,246,0.4);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:9999;transition:all .3s;font-size:24px;border:none;color:#fff}
            .sr-fab:hover{transform:scale(1.1);box-shadow:0 6px 24px rgba(139,92,246,0.6)}
            .sr-fab.active{background:linear-gradient(135deg,#EF4444,#DC2626)}
            .sr-correction-input{width:100%;padding:10px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:13px;resize:none;min-height:80px}
            .sr-correction-input:focus{outline:none;border-color:#8B5CF6}
            .sr-actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
            .sr-btn{padding:8px 12px;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s}
            .sr-btn-primary{background:linear-gradient(135deg,#8B5CF6,#3B82F6);color:#fff}
            .sr-btn-secondary{background:rgba(255,255,255,0.1);color:#fff}
            .sr-btn:hover{transform:translateY(-1px);opacity:0.9}
            .sr-tabs{display:flex;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:12px}
            .sr-tab{flex:1;padding:8px;text-align:center;font-size:12px;color:rgba(255,255,255,0.5);cursor:pointer;border-bottom:2px solid transparent;transition:all .2s}
            .sr-tab:hover{color:rgba(255,255,255,0.8)}
            .sr-tab.active{color:#8B5CF6;border-bottom-color:#8B5CF6}
            .sr-summary-box{background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:10px;padding:12px;margin-bottom:12px}
            .sr-summary-title{font-size:11px;text-transform:uppercase;color:#3B82F6;margin-bottom:6px;font-weight:600}
            .sr-summary-text{font-size:13px;color:rgba(255,255,255,0.8);line-height:1.5}
            .sr-sentiment{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:12px;font-size:11px;font-weight:600}
            .sr-sentiment-positive{background:rgba(16,185,129,0.2);color:#10B981}
            .sr-sentiment-negative{background:rgba(239,68,68,0.2);color:#EF4444}
            .sr-sentiment-neutral{background:rgba(107,114,128,0.2);color:#9CA3AF}
            .sr-sentiment-urgent{background:rgba(245,158,11,0.2);color:#F59E0B}
        `;
        document.head.appendChild(style);
    }

    // ============ CONFIG ============
    function getMode() { return state.mode; }
    async function setMode(mode) {
        mode = normalizeMode(mode);
        if (!Object.values(MODES).includes(mode)) throw new Error(`Modo inválido: ${mode}`);
        state.mode = mode;
        await saveState();
        if (mode === MODES.OFF) { clearAllAutoResponses(); hideFloatingPanel(); }
    }
    function getProvider() { return PROVIDERS[state.provider.toUpperCase()] || PROVIDERS.OPENAI; }
    async function setProvider(providerId, modelId) {
        const p = PROVIDERS[providerId.toUpperCase()];
        if (!p) throw new Error(`Provider inválido: ${providerId}`);
        state.provider = providerId.toLowerCase();
        state.model = modelId || p.models[0].id;
        await saveState();
    }
    async function setApiKey(_key) {
        // v9.4.0: setApiKey desativado. IA passa pelo backend.
        console.warn('[SmartReplies] setApiKey ignorado — modelo SaaS gerencia API keys no backend');
    }
    function isConfigured() {
        // v9.4.0: backend é única fonte de IA. Considera configurado se:
        //   - AIGateway disponível (caminho preferencial)
        //   - OU AIService legado com providers (compat)
        if (window.AIGateway && typeof window.AIGateway.complete === 'function') {
            return true;
        }
        if (window.AIService && typeof window.AIService.getConfiguredProviders === 'function') {
            const configuredProviders = window.AIService.getConfiguredProviders();
            if (configuredProviders && configuredProviders.length > 0) {
                return true;
            }
        }
        return false;
    }
    async function setCustomSystemPrompt(prompt) { state.customSystemPrompt = prompt; await saveState(); }

    // ============ PERSONAS ============
    function getPersonas() { return { ...DEFAULT_PERSONAS, ...state.customPersonas }; }
    function getActivePersona() {
        const p = getPersonas()[state.activePersona] || getPersonas().professional;
        if (p.id === 'custom' && state.customSystemPrompt) return { ...p, systemPrompt: state.customSystemPrompt };
        return p;
    }
    async function setActivePersona(id) { if (!getPersonas()[id]) throw new Error(`Persona não encontrada: ${id}`); state.activePersona = id; await saveState(); }
    async function createPersona(p) {
        if (!p.id || !p.name || !p.systemPrompt) throw new Error('Persona inválida');
        state.customPersonas[p.id] = { ...p, temperature: p.temperature || 0.7, maxTokens: p.maxTokens || 300 };
        await saveState();
        return state.customPersonas[p.id];
    }
    async function deletePersona(id) {
        if (DEFAULT_PERSONAS[id]) throw new Error('Não é possível excluir personas padrão');
        delete state.customPersonas[id];
        if (state.activePersona === id) state.activePersona = 'professional';
        await saveState();
    }

    // ============ QUICK REPLIES ============
    function getQuickReplies() { return state.quickReplies; }
    function getQuickRepliesByCategory() {
        const r = {};
        for (const qr of state.quickReplies) { if (!r[qr.category]) r[qr.category] = []; r[qr.category].push(qr); }
        return r;
    }
    async function addQuickReply(text, category = 'Geral', emoji = '💬') {
        const qr = { id: `qr_${Date.now()}`, text, category, emoji, createdAt: new Date().toISOString() };
        state.quickReplies.push(qr);
        await saveState();
        return qr;
    }
    async function updateQuickReply(id, updates) {
        const i = state.quickReplies.findIndex(r => r.id === id);
        if (i === -1) throw new Error('Quick reply não encontrada');
        state.quickReplies[i] = { ...state.quickReplies[i], ...updates };
        await saveState();
        return state.quickReplies[i];
    }
    async function deleteQuickReply(id) { state.quickReplies = state.quickReplies.filter(r => r.id !== id); await saveState(); }

    // ============ AI CALLS ============
    async function callAI(messages, options = {}) {
        const rl = checkRateLimit();
        if (!rl.allowed) {
            throw new Error(rl.error);
        }
        state.isLoading = true;
        state.lastError = null;

        try {
            // PRIORIDADE 1: Usar AIService (funciona e bypassa CSP)
            // FIX: Usar getConfiguredProviders() que é mais confiável que isProviderConfigured()
            if (window.AIService && typeof window.AIService.getConfiguredProviders === 'function') {
                const configuredProviders = window.AIService.getConfiguredProviders();
                
                if (configuredProviders && configuredProviders.length > 0) {
                    console.log('[SmartReplies] ✅ Usando AIService com providers:', configuredProviders.join(', '));
                    
                    const persona = getActivePersona();
                    const systemPrompt = options.systemPrompt || persona.systemPrompt;
                    
                    // Formatar mensagens com system prompt
                    const formattedMessages = [
                        { role: 'system', content: systemPrompt },
                        ...messages.map(m => ({
                            role: m.role || 'user',
                            content: m.content || m.text || String(m)
                        }))
                    ];
                    
                    const result = await window.AIService.complete(formattedMessages, {
                        temperature: options.temperature ?? persona.temperature ?? 0.7,
                        maxTokens: options.maxTokens ?? persona.maxTokens ?? 300
                    });
                    
                    // Verificar se resposta é válida (não é fallback vazio)
                    const content = result.content || result.text || '';
                    if (!content || content.length < 2) {
                        console.warn('[SmartReplies] ⚠️ Resposta vazia do AIService, verificando config...');
                        throw new Error('Resposta vazia - verifique a configuração da API key');
                    }
                    
                    // Consumir crédito se SubscriptionModule disponível
                    if (window.SubscriptionModule) {
                        try { await window.SubscriptionModule.consumeCredit(1); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
                    }
                    
                    return { 
                        content: content,
                        usage: result.usage,
                        provider: result.provider || configuredProviders[0]
                    };
                } else {
                    console.warn('[SmartReplies] ⚠️ AIService disponível mas SEM providers configurados');
                }
            }
            
            // v9.4.0 SECURITY: caminho direct-to-provider removido. Smart-replies
            // agora SEMPRE usa AIGateway, que rotea pelo backend. Sem isso, cliente
            // podia configurar key própria e bypassar billing/limites de plano.
            if (window.AIGateway && typeof window.AIGateway.complete === 'function') {
                const persona = getActivePersona();
                const systemPrompt = options.systemPrompt || persona.systemPrompt;
                const temperature = options.temperature ?? persona.temperature;
                const maxTokens = options.maxTokens ?? persona.maxTokens;

                const msgs = systemPrompt
                    ? [{ role: 'system', content: systemPrompt }, ...messages]
                    : messages;

                const result = await window.AIGateway.complete(msgs, {
                    temperature,
                    max_tokens: maxTokens,
                });

                if (window.SubscriptionModule) {
                    try { await window.SubscriptionModule.consumeCredit(1); } catch (_) {}
                }

                return {
                    content: result.text || result.content || '',
                    usage: result.usage,
                    model: result.model,
                    provider: result.provider || 'backend',
                };
            }

            throw new Error('AIGateway não disponível. Recarregue a extensão.');

            // Código abaixo está DEAD (mantido por referência histórica).
            // eslint-disable-next-line no-unreachable
            const provider = getProvider();
            const persona = getActivePersona();
            const systemPrompt = options.systemPrompt || persona.systemPrompt;
            const temperature = options.temperature ?? persona.temperature;
            const maxTokens = options.maxTokens ?? persona.maxTokens;

            let result;
            if (provider.id === 'anthropic') {
                result = await callAnthropic(messages, systemPrompt, temperature, maxTokens);
            } else {
                result = await callOpenAI(provider, messages, systemPrompt, temperature, maxTokens);
            }
            
            if (window.SubscriptionModule) {
                try { await window.SubscriptionModule.consumeCredit(1); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
            }
            
            return result;
        } catch (e) {
            state.lastError = e.message;
            console.error('[SmartReplies] Erro em callAI:', e);
            throw e;
        } finally {
            state.isLoading = false;
        }
    }

    async function callOpenAI(provider, messages, systemPrompt, temperature, maxTokens) {
        const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;
        const res = await fetch(provider.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', [provider.headerKey]: `${provider.headerPrefix}${state.apiKey}` },
            body: JSON.stringify({ model: state.model, messages: msgs, temperature, max_tokens: maxTokens })
        });
        if (!res.ok) throw new Error(`API Error: ${res.status}`);
        const data = await res.json();
        return { content: data.choices[0].message.content, usage: data.usage, model: data.model };
    }

    async function callAnthropic(messages, systemPrompt, temperature, maxTokens) {
        const res = await fetch(PROVIDERS.ANTHROPIC.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': state.apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: state.model, system: systemPrompt, messages, temperature, max_tokens: maxTokens })
        });
        if (!res.ok) throw new Error(`API Error: ${res.status}`);
        const data = await res.json();
        return { content: data.content[0].text, usage: data.usage, model: data.model };
    }

    // ============ GENERATION ============
    // v7.9.13: Backend Soberano - Propagar erros, sem fallback silencioso
    const FORCE_BACKEND = true;
    const DISABLE_LOCAL_FALLBACK = false; // R-002 FIX: Enable local fallback for graceful degradation
    
    /**
     * Gera resposta usando CopilotEngine (mesma lógica do copiloto automático)
     * Garante uso de: memória, exemplos, knowledge base, contexto híbrido do servidor
     */
    async function generateReply(chatId, contextMessages = []) {
        console.log('[SmartReplies] 🚀 [MOTOR: BACKEND] Gerando resposta...');
        
        // PRIORIDADE 1: Usar CopilotEngine (mesma lógica robusta do copiloto)
        if (window.CopilotEngine && typeof window.CopilotEngine.generateResponse === 'function') {
            try {
                console.log('[SmartReplies] 🤖 [MOTOR: BACKEND/CopilotEngine] Iniciando...');
                
                // Extrair última mensagem do cliente para análise
                const lastUserMsg = [...contextMessages].reverse().find(m => m.role === 'user');
                const messageText = lastUserMsg?.content || '';
                
                // Analisar mensagem (usa toda a inteligência: intent, sentiment, KB, etc)
                const analysis = await window.CopilotEngine.analyzeMessage(messageText, chatId);
                
                // Gerar resposta com contexto híbrido (memória + exemplos + KB do servidor)
                const response = await window.CopilotEngine.generateResponse(chatId, analysis);
                
                addToHistory(chatId, { role: 'assistant', content: response.content });
                console.log('[SmartReplies] ✅ [MOTOR: BACKEND] Resposta gerada');
                return response.content;
            } catch (e) {
                console.error('[SmartReplies] ❌ [MOTOR: BACKEND] CopilotEngine falhou:', e.message);
                
                // V3-001 FIX: Check both FORCE_BACKEND AND DISABLE_LOCAL_FALLBACK
                if (FORCE_BACKEND && DISABLE_LOCAL_FALLBACK) {
                    throw new Error(`❌ Backend obrigatório falhou: ${e.message}`);
                }
            }
        }
        
        // V3-001 FIX: Check both FORCE_BACKEND AND DISABLE_LOCAL_FALLBACK
        if (FORCE_BACKEND && DISABLE_LOCAL_FALLBACK) {
            console.error('[SmartReplies] ❌ [MOTOR: BLOQUEADO] CopilotEngine não disponível');
            throw new Error('❌ Backend obrigatório indisponível. CopilotEngine não carregado.');
        }
        
        // Fallback: callAI direto (APENAS se FORCE_BACKEND = false)
        console.warn('[SmartReplies] ⚠️ [MOTOR: LOCAL] Usando callAI como fallback');
        const result = await callAI(contextMessages.slice(-CONFIG.CONTEXT_MESSAGES));
        addToHistory(chatId, { role: 'assistant', content: result.content });
        return result.content;
    }

    /**
     * Gera sugestões usando CopilotEngine (mesma lógica do copiloto automático)
     * Garante uso de: memória, exemplos, knowledge base, contexto híbrido do servidor
     */
    async function generateSuggestions(chatId, contextMessages = []) {
        console.log('[SmartReplies] 🚀 [MOTOR: BACKEND] Gerando sugestões...');
        
        // PRIORIDADE 1: Usar CopilotEngine (mesma lógica robusta do copiloto)
        if (window.CopilotEngine && typeof window.CopilotEngine.generateSuggestions === 'function') {
            try {
                console.log('[SmartReplies] 💡 [MOTOR: BACKEND/CopilotEngine] Iniciando...');
                
                // Extrair última mensagem do cliente para análise
                const lastUserMsg = [...contextMessages].reverse().find(m => m.role === 'user');
                const messageText = lastUserMsg?.content || '';
                
                // Analisar mensagem (usa toda a inteligência)
                const analysis = await window.CopilotEngine.analyzeMessage(messageText, chatId);
                
                // Gerar sugestões com contexto híbrido
                const suggestions = await window.CopilotEngine.generateSuggestions(chatId, analysis);
                
                // Converter formato para compatibilidade com SmartReplies
                state.suggestions = suggestions.map(s => ({
                    text: s.content,
                    type: s.type || s.source || 'ai',
                    confidence: s.confidence
                }));
                
                console.log('[SmartReplies] ✅ [MOTOR: BACKEND] Sugestões geradas:', state.suggestions.length);
                return state.suggestions;
            } catch (e) {
                console.error('[SmartReplies] ❌ [MOTOR: BACKEND] CopilotEngine falhou:', e.message);
                
                // v7.9.13: Se FORCE_BACKEND, propagar erro
                // R-002 FIX: Check both FORCE_BACKEND AND DISABLE_LOCAL_FALLBACK
                if (FORCE_BACKEND && DISABLE_LOCAL_FALLBACK) {
                    throw new Error(`❌ Backend obrigatório falhou: ${e.message}`);
                }
            }
        }
        
        // v7.9.13: Se FORCE_BACKEND e CopilotEngine não disponível, erro
        // R-002 FIX: Check both FORCE_BACKEND AND DISABLE_LOCAL_FALLBACK
        if (FORCE_BACKEND && DISABLE_LOCAL_FALLBACK) {
            console.error('[SmartReplies] ❌ [MOTOR: BLOQUEADO] CopilotEngine não disponível');
            throw new Error('❌ Backend obrigatório indisponível. CopilotEngine não carregado.');
        }
        
        // Fallback: gerar via callAI direto (APENAS se FORCE_BACKEND = false)
        console.warn('[SmartReplies] ⚠️ [MOTOR: LOCAL] Usando callAI como fallback');
        const persona = getActivePersona();
        const systemPrompt = `${persona.systemPrompt}\n\nGere ${CONFIG.SUGGESTIONS_COUNT} sugestões de resposta diferentes. Responda APENAS em JSON:\n{"suggestions":[{"text":"sugestão","type":"tipo"}]}`;
        const result = await callAI(contextMessages.slice(-CONFIG.CONTEXT_MESSAGES), { systemPrompt, temperature: 0.9, maxTokens: 600 });
        try {
            const m = result.content.match(/\{[\s\S]*\}/);
            if (m) { state.suggestions = JSON.parse(m[0]).suggestions; return state.suggestions; }
        } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
        state.suggestions = [{ text: result.content, type: 'default' }];
        return state.suggestions;
    }

    async function correctText(text, type = 'full') {
        const types = { spelling: 'ortografia', grammar: 'gramática', punctuation: 'pontuação', full: 'correção completa', formal: 'mais formal', informal: 'mais informal' };
        const systemPrompt = `Corretor de texto PT-BR. Tipo: ${types[type] || types.full}. Responda APENAS com o texto corrigido.`;
        const result = await callAI([{ role: 'user', content: text }], { systemPrompt, temperature: 0.3, maxTokens: text.length + 200 });
        return { original: text, corrected: result.content.trim(), hasChanges: text.trim() !== result.content.trim(), type };
    }

    async function summarizeConversation(messages) {
        const systemPrompt = `Resuma a conversa em 3-4 frases. Destaque: assunto, solicitações, pendências.`;
        const formatted = messages.map(m => `[${m.role === 'user' ? 'Cliente' : 'Atendente'}]: ${m.content}`).join('\n');
        const result = await callAI([{ role: 'user', content: `Conversa:\n${formatted}` }], { systemPrompt, temperature: 0.5, maxTokens: 200 });
        return result.content;
    }

    function analyzeSentiment(text) {
        const lower = text.toLowerCase();
        let sentiment = 'neutral', isUrgent = false, positiveScore = 0, negativeScore = 0;
        for (const w of CONFIG.SENTIMENT_KEYWORDS.urgent) if (lower.includes(w)) { isUrgent = true; break; }
        for (const w of CONFIG.SENTIMENT_KEYWORDS.positive) if (lower.includes(w)) positiveScore++;
        for (const w of CONFIG.SENTIMENT_KEYWORDS.negative) if (lower.includes(w)) negativeScore++;
        if (positiveScore > negativeScore) sentiment = 'positive';
        else if (negativeScore > positiveScore) sentiment = 'negative';
        return { sentiment, isUrgent, label: isUrgent ? '⚠️ Urgente' : sentiment === 'positive' ? '😊 Positivo' : sentiment === 'negative' ? '😟 Negativo' : '😐 Neutro' };
    }

    // ============ CONTEXT ============
    function addToHistory(chatId, message) {
        if (!state.conversationHistory[chatId]) state.conversationHistory[chatId] = [];
        state.conversationHistory[chatId].push({ ...message, timestamp: Date.now() });
        if (state.conversationHistory[chatId].length > CONFIG.CONTEXT_MESSAGES * 2) state.conversationHistory[chatId] = state.conversationHistory[chatId].slice(-CONFIG.CONTEXT_MESSAGES);
    }
    function getHistory(chatId) { return state.conversationHistory[chatId] || []; }
    function clearHistory(chatId) { delete state.conversationHistory[chatId]; }

    // ============ AUTO-RESPONSE ============
    function scheduleAutoResponse(chatId, callback) {
        // Modos automáticos/semi-automáticos foram removidos.
        // Mantemos a função por compatibilidade, mas sem agendamento.
        return;
        if ((state.autoResponseCounts[chatId] || 0) >= CONFIG.MAX_AUTO_RESPONSES) return;
        if (autoResponseTimeouts.has(chatId)) clearTimeout(autoResponseTimeouts.get(chatId));
        autoResponseTimeouts.set(chatId, setTimeout(async () => {
            autoResponseTimeouts.delete(chatId);
            if (callback) await callback(chatId);
            state.autoResponseCounts[chatId] = (state.autoResponseCounts[chatId] || 0) + 1;
        }, CONFIG.AUTO_RESPONSE_DELAY));
    }
    function cancelAutoResponse(chatId) { if (autoResponseTimeouts.has(chatId)) { clearTimeout(autoResponseTimeouts.get(chatId)); autoResponseTimeouts.delete(chatId); } }
    function clearAllAutoResponses() { for (const t of autoResponseTimeouts.values()) clearTimeout(t); autoResponseTimeouts.clear(); }
    function resetAutoResponseCount(chatId) { delete state.autoResponseCounts[chatId]; }

    // ============ FLOATING PANEL ============
    function showFloatingPanel(chatId, contextMessages = []) {
        hideFloatingPanel();
        state.currentChatId = chatId;
        state.floatingPanelVisible = true;

        floatingPanel = document.createElement('div');
        floatingPanel.className = 'sr-floating-panel';
        floatingPanel.innerHTML = `
            <div class="sr-panel-header">
                <span class="sr-panel-title">🤖 Smart Replies</span>
                <button class="sr-panel-close" onclick="window.SmartRepliesModule.hideFloatingPanel()">×</button>
            </div>
            <div class="sr-panel-body">
                <div class="sr-tabs">
                    <div class="sr-tab active" data-tab="suggestions">💡 Sugestões</div>
                    <div class="sr-tab" data-tab="correct">✏️ Corrigir</div>
                    <div class="sr-tab" data-tab="summary">📋 Resumo</div>
                </div>
                <div class="sr-tab-content" id="sr-tab-suggestions">
                    <div class="sr-loading"><div class="sr-loading-spinner"></div>Gerando sugestões...</div>
                </div>
                <div class="sr-tab-content" id="sr-tab-correct" style="display:none">
                    <textarea class="sr-correction-input" placeholder="Cole ou digite o texto para corrigir..."></textarea>
                    <div class="sr-actions">
                        <button class="sr-btn sr-btn-secondary" onclick="window.SmartRepliesModule.correctFromPanel('grammar')">📝 Gramática</button>
                        <button class="sr-btn sr-btn-secondary" onclick="window.SmartRepliesModule.correctFromPanel('formal')">👔 Formal</button>
                        <button class="sr-btn sr-btn-primary" onclick="window.SmartRepliesModule.correctFromPanel('full')">✨ Completa</button>
                    </div>
                </div>
                <div class="sr-tab-content" id="sr-tab-summary" style="display:none">
                    <button class="sr-btn sr-btn-primary" style="width:100%" onclick="window.SmartRepliesModule.loadSummaryFromPanel()">📋 Gerar Resumo</button>
                    <div id="sr-summary-result" style="margin-top:12px"></div>
                </div>
            </div>
        `;
        document.body.appendChild(floatingPanel);

        floatingPanel.querySelectorAll('.sr-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                floatingPanel.querySelectorAll('.sr-tab').forEach(t => t.classList.remove('active'));
                floatingPanel.querySelectorAll('.sr-tab-content').forEach(c => c.style.display = 'none');
                tab.classList.add('active');
                document.getElementById(`sr-tab-${tab.dataset.tab}`).style.display = 'block';
            });
        });

        loadSuggestions(chatId, contextMessages);
    }

    async function loadSuggestions(chatId, contextMessages) {
        const container = document.getElementById('sr-tab-suggestions');
        if (!container) return;
        try {
            const suggestions = await generateSuggestions(chatId, contextMessages);
            container.innerHTML = suggestions.map(s => `
                <div class="sr-suggestion-item" data-text="${encodeURIComponent(String(s.text || ''))}">
                    <div class="sr-suggestion-type">${escapeHtml(s.type || 'sugestão')}</div>
                    <div class="sr-suggestion-text">${escapeHtml(s.text)}</div>
                </div>
            `).join('');
            container.querySelectorAll('.sr-suggestion-item').forEach(item => {
                item.addEventListener('click', () => {
                    let decoded = '';
                    try { decoded = decodeURIComponent(item.dataset.text || ''); } catch (_) { decoded = item.dataset.text || ''; }
                    navigator.clipboard.writeText(decoded);
                    if (window.NotificationsModule) window.NotificationsModule.toast('📋 Copiado!', 'success', 1500);
                });
            });
        } catch (e) {
            container.innerHTML = `<div style="color:#EF4444;padding:12px">Erro: ${escapeHtml(e.message)}</div>`;
        }
    }

    async function correctFromPanel(type) {
        const input = floatingPanel?.querySelector('.sr-correction-input');
        if (!input || !input.value.trim()) { if (window.NotificationsModule) window.NotificationsModule.warning('Digite um texto'); return; }
        try {
            input.disabled = true;
            const result = await correctText(input.value.trim(), type);
            input.value = result.corrected;
            input.disabled = false;
            if (window.NotificationsModule) window.NotificationsModule.success(result.hasChanges ? 'Texto corrigido!' : 'Texto já estava correto');
        } catch (e) {
            input.disabled = false;
            if (window.NotificationsModule) window.NotificationsModule.error('Erro: ' + e.message);
        }
    }

    async function loadSummaryFromPanel() {
        const container = document.getElementById('sr-summary-result');
        if (!container) return;
        const history = getHistory(state.currentChatId);
        if (history.length < 2) { container.innerHTML = '<div style="color:#F59E0B">Histórico insuficiente</div>'; return; }
        container.innerHTML = '<div class="sr-loading"><div class="sr-loading-spinner"></div>Gerando...</div>';
        try {
            const summary = await summarizeConversation(history);
            container.innerHTML = `<div class="sr-summary-box"><div class="sr-summary-title">📋 Resumo</div><div class="sr-summary-text">${escapeHtml(summary)}</div></div>`;
        } catch (e) {
            container.innerHTML = `<div style="color:#EF4444">Erro: ${escapeHtml(e.message)}</div>`;
        }
    }

    function hideFloatingPanel() { if (floatingPanel) { floatingPanel.remove(); floatingPanel = null; } state.floatingPanelVisible = false; }
    function toggleFloatingPanel(chatId, contextMessages = []) { if (state.floatingPanelVisible) hideFloatingPanel(); else showFloatingPanel(chatId, contextMessages); }

    // ============ UTILS ============
    async function simulateTyping(text) { return new Promise(r => setTimeout(r, Math.min(text.length * CONFIG.TYPING_SPEED, CONFIG.MAX_TYPING_TIME))); }
    function getSuggestions() { return state.suggestions; }
    function isLoading() { return state.isLoading; }
    function getLastError() { return state.lastError; }
    function getStats() {
        return { mode: state.mode, provider: state.provider, model: state.model, isConfigured: isConfigured(), activePersona: state.activePersona, quickRepliesCount: state.quickReplies.length, historyChats: Object.keys(state.conversationHistory).length, pendingAutoResponses: autoResponseTimeouts.size };
    }
    function escapeHtml(str) {
        const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
        if (typeof fn === 'function' && fn !== escapeHtml) return fn(str);
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ============ RENDER SETTINGS ============
    function renderSettings(container) {
        const personas = getPersonas();
        const provider = getProvider();
        container.innerHTML = `
            <div class="mod-card">
                <div class="mod-card-header">
                    <span class="mod-card-title">⚙️ Configurações de IA</span>
                    <span class="mod-badge ${isConfigured() ? 'mod-badge-success' : 'mod-badge-warning'}">${isConfigured() ? '✅ Configurado' : '⚠️ Não configurado'}</span>
                </div>
                <div style="display:grid;gap:12px">
                    <div>
                        <label class="mod-label">Modo de Operação</label>
                        <select id="sr-mode" class="mod-input mod-select">
                            <option value="off" ${state.mode === 'off' ? 'selected' : ''}>🔴 Desativado</option>
                            <option value="suggest" ${state.mode === 'suggest' ? 'selected' : ''}>💡 Apenas Sugestões</option>
                        </select>
                    </div>
                    <div>
                        <label class="mod-label">Provedor de IA</label>
                        <select id="sr-provider" class="mod-input mod-select">${Object.values(PROVIDERS).map(p => `<option value="${escapeHtml(p.id)}" ${state.provider === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select>
                    </div>
                    <div>
                        <label class="mod-label">Modelo</label>
                        <select id="sr-model" class="mod-input mod-select">${provider.models.map(m => `<option value="${escapeHtml(m.id)}" ${state.model === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}</select>
                    </div>
                    <!-- v9.4.0: Campo de API key removido. IA passa pelo backend, sem configuração do cliente. -->
                    <div style="font-size:11px;color:var(--mod-text-muted);padding:8px;background:rgba(139,92,246,0.05);border-radius:6px;border-left:3px solid var(--mod-primary)">
                        🔒 IA gerenciada pelo plano — tokens consumidos do saldo do workspace.
                    </div>
                    <div>
                        <label class="mod-label">Persona do Assistente</label>
                        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
                            ${Object.values(personas).map(p => `
                                <label class="mod-card" style="padding:10px;cursor:pointer;${state.activePersona === p.id ? 'border-color:var(--mod-primary);background:rgba(139,92,246,0.1);' : ''}">
                                    <input type="radio" name="sr-persona" value="${p.id}" ${state.activePersona === p.id ? 'checked' : ''} style="display:none">
                                    <div style="font-weight:600">${p.name}</div>
                                    <div style="font-size:11px;color:var(--mod-text-muted)">${p.description}</div>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    <div id="sr-custom-prompt-container" style="${state.activePersona === 'custom' ? '' : 'display:none'}">
                        <label class="mod-label">Prompt Personalizado</label>
                        <textarea id="sr-custom-prompt" class="mod-input" style="min-height:80px;resize:vertical" placeholder="Descreva como o assistente deve se comportar...">${state.customSystemPrompt || ''}</textarea>
                    </div>
                    <div class="sp-row">
                        <button id="sr-save-settings" class="mod-btn mod-btn-primary" style="flex:1">💾 Salvar</button>
                        <button id="sr-test-connection" class="mod-btn mod-btn-secondary">🔌 Testar</button>
                    </div>
                </div>
            </div>
        `;
        setupSettingsEvents(container);
    }

    function setupSettingsEvents(container) {
        container.querySelector('#sr-provider')?.addEventListener('change', e => {
            const p = PROVIDERS[e.target.value.toUpperCase()];
            if (p) container.querySelector('#sr-model').innerHTML = p.models.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('');
        });
        container.querySelectorAll('input[name="sr-persona"]').forEach(input => {
            input.addEventListener('change', e => {
                container.querySelectorAll('input[name="sr-persona"]').forEach(i => { const c = i.closest('.mod-card'); c.style.borderColor = ''; c.style.background = ''; });
                const c = e.target.closest('.mod-card'); c.style.borderColor = 'var(--mod-primary)'; c.style.background = 'rgba(139,92,246,0.1)';
                document.getElementById('sr-custom-prompt-container').style.display = e.target.value === 'custom' ? '' : 'none';
            });
        });
        container.querySelector('#sr-save-settings')?.addEventListener('click', async () => {
            try {
                await setMode(container.querySelector('#sr-mode').value);
                await setProvider(container.querySelector('#sr-provider').value, container.querySelector('#sr-model').value);
                // v9.4.0: campo de API key removido — IA passa pelo backend
                const persona = container.querySelector('input[name="sr-persona"]:checked')?.value;
                if (persona) await setActivePersona(persona);
                const cp = container.querySelector('#sr-custom-prompt')?.value;
                if (cp !== undefined) await setCustomSystemPrompt(cp);
                if (window.NotificationsModule) window.NotificationsModule.success('Configurações salvas!');
            } catch (e) { if (window.NotificationsModule) window.NotificationsModule.error('Erro: ' + e.message); }
        });
        container.querySelector('#sr-test-connection')?.addEventListener('click', async () => {
            const btn = container.querySelector('#sr-test-connection');
            btn.disabled = true; btn.textContent = '⏳...';
            try {
                const r = await callAI([{ role: 'user', content: 'Diga OK' }], { maxTokens: 10 });
                if (window.NotificationsModule) window.NotificationsModule.success('✅ OK: ' + r.content);
            } catch (e) { if (window.NotificationsModule) window.NotificationsModule.error('❌ ' + e.message); }
            btn.disabled = false; btn.textContent = '🔌 Testar';
        });
    }

    function renderQuickReplies(container) {
        const byCategory = getQuickRepliesByCategory();
        container.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:12px">
                ${Object.entries(byCategory).map(([cat, replies]) => `
                    <div>
                        <div class="mod-label">${cat}</div>
                        <div style="display:flex;flex-wrap:wrap;gap:6px">
                            ${replies.map(r => `
                                <button class="mod-btn mod-btn-secondary mod-btn-sm qr-btn" data-qr-id="${r.id}" data-qr-text="${escapeHtml(r.text)}" title="${escapeHtml(r.text)}">
                                    ${r.emoji || '💬'} ${r.text.substring(0, 20)}${r.text.length > 20 ? '...' : ''}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
                <div class="sp-row" style="margin-top:8px;gap:8px">
                    <input type="text" id="new-qr-text" class="mod-input" placeholder="Nova resposta rápida..." style="flex:1">
                    <select id="new-qr-category" class="mod-input mod-select" style="width:120px">
                        <option>Geral</option><option>Saudações</option><option>Vendas</option><option>Suporte</option><option>Encerramento</option>
                    </select>
                    <button id="add-qr-btn" class="mod-btn mod-btn-primary">➕</button>
                </div>
            </div>
        `;
        container.querySelectorAll('.qr-btn').forEach(btn => {
            btn.addEventListener('click', () => { navigator.clipboard.writeText(btn.dataset.qrText); if (window.NotificationsModule) window.NotificationsModule.toast('📋 Copiado!', 'success', 1500); });
        });
        container.querySelector('#add-qr-btn')?.addEventListener('click', async () => {
            const input = container.querySelector('#new-qr-text');
            const cat = container.querySelector('#new-qr-category').value;
            if (input.value.trim()) { await addQuickReply(input.value.trim(), cat); input.value = ''; renderQuickReplies(container); if (window.NotificationsModule) window.NotificationsModule.success('Adicionado!'); }
        });
    }

    // ============ EXPORT ============
    window.SmartRepliesModule = {
        init, getMode, setMode, getProvider, setProvider, setApiKey, isConfigured, setCustomSystemPrompt,
        getPersonas, getActivePersona, setActivePersona, createPersona, deletePersona,
        getQuickReplies, getQuickRepliesByCategory, addQuickReply, updateQuickReply, deleteQuickReply,
        callAI, generateReply, generateSuggestions, correctText, summarizeConversation, analyzeSentiment, getSuggestions,
        addToHistory, getHistory, clearHistory,
        scheduleAutoResponse, cancelAutoResponse, resetAutoResponseCount,
        showFloatingPanel, hideFloatingPanel, toggleFloatingPanel, correctFromPanel, loadSummaryFromPanel,
        simulateTyping, isLoading, getLastError, getStats,
        renderSettings, renderQuickReplies,
        MODES, PROVIDERS, DEFAULT_PERSONAS
    };

    console.log('[SmartReplies] Módulo COMPLETO carregado');
})();
