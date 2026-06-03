/**
 * 🤖 AI Routes - Endpoints de IA
 * Axion v7.1.0
 */

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();
const { authenticate, checkWorkspace } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { aiLimiter } = require('../middleware/rateLimiter');
const { checkSubscription } = require('../middleware/subscription');

// Aplicar rate limiting específico para IA em todas as rotas
router.use(aiLimiter);

// AI Services
let AIRouter, CopilotEngine;
try {
  AIRouter = require('../ai/services/AIRouterService');
  const { getInstance } = require('../ai/engines/CopilotEngine');
  CopilotEngine = getInstance();
} catch (e) {
  logger.warn('[AI Routes] AI modules not fully loaded:', e.message);
}

// CORREÇÃO P1: OrchestratorRegistry singleton real com LRU eviction e TTL
const orchestratorRegistry = require('../registry/OrchestratorRegistry');

/**
 * GET /api/v2/ai/providers
 * Lista providers configurados (formato interno — usado pelo dashboard)
 */
router.get('/providers', authenticate, asyncHandler(async (req, res) => {
  if (!AIRouter) {
    return res.status(503).json({ error: 'AI Router not available' });
  }
  
  const providers = AIRouter.getConfiguredProviders();
  res.json({ providers });
}));

/**
 * GET /api/ai/providers   ←  P8 FIX
 * Extension-facing endpoint consumed by ai-gateway.js syncProvidersWithBackend().
 * Returns the canonical provider priority/enabled list so the extension gateway
 * always mirrors the backend router configuration.
 * No auth required — the response contains no sensitive data (just IDs, priorities).
 */
router.get('/ext/providers', asyncHandler(async (req, res) => {
  if (!AIRouter) {
    // Return safe defaults so the extension can still function
    return res.json({
      activeProviders: [
        { id: 'openai',    priority: 1, enabled: true,  defaultModel: 'gpt-4o' },
        { id: 'anthropic', priority: 2, enabled: false, defaultModel: 'claude-3-5-sonnet-20241022' },
        { id: 'groq',      priority: 3, enabled: true,  defaultModel: 'llama-3.1-70b-versatile' },
      ]
    });
  }

  const result = AIRouter.getActiveProvidersForExtension();
  res.json(result);
}));

/**
 * GET /api/v2/ai/models
 * Lista todos os modelos disponíveis
 */
router.get('/models', authenticate, asyncHandler(async (req, res) => {
  if (!AIRouter) {
    return res.status(503).json({ error: 'AI Router not available' });
  }
  
  const models = AIRouter.getAllModels();
  res.json({ models });
}));

/**
 * POST /api/v2/ai/complete
 * Chat completion
 */
router.post('/complete', authenticate, checkSubscription('ai_basic'), asyncHandler(async (req, res) => {
  if (!AIRouter) {
    return res.status(503).json({ error: 'AI Router not available' });
  }
  
  const { messages, provider, model, temperature, maxTokens, systemPrompt, requestId } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    const e = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
    e.details = [{ field: 'messages', message: 'messages deve ser um array' }];
    throw e;
  }

  // v9.4.3 BUG #110: idempotência. Se cliente passa requestId (UUID gerado
  // no frontend), usamos pra dedup no consume. Sem isso: rede cai entre
  // backend processar + responder → frontend retry → cliente cobrado 2x.
  // requestId é client-side por design (cliente tem que decidir o que é
  // "mesma chamada" — backend não tem como saber).
  const safeRequestId = (typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 100)
    ? requestId
    : null;
  
  // Add system prompt if provided
  const fullMessages = systemPrompt 
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;
  
  const result = await AIRouter.complete(fullMessages, {
    provider,
    model,
    temperature,
    maxTokens,
    tenantId: req.workspaceId,
    requestId: safeRequestId,
  });
  
  res.json({
    content: result.content,
    provider: result.provider,
    model: result.model,
    usage: result.usage,
    latency: result.latency,
    cost: result.cost,
    cached: result.cached || false,
    idempotent_replay: result.idempotent_replay || false,
  });
}));

/**
 * POST /api/v2/ai/analyze
 * Análise de mensagem (intent, sentiment, entities)
 */
router.post('/analyze', authenticate, asyncHandler(async (req, res) => {
  if (!CopilotEngine) {
    return res.status(503).json({ error: 'Copilot Engine not available' });
  }
  
  const { message, context } = req.body;
  
  if (!message) {
    const e = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
    e.details = [{ field: 'message', message: 'message é obrigatório' }];
    throw e;
  }
  
  const analysis = await CopilotEngine.analyze(message, context || {});
  res.json(analysis);
}));

/**
 * POST /api/v2/ai/replies — DEPRECATED (v9.X)
 *
 * @deprecated Use POST /api/v2/ai/process (AIOrchestrator) instead.
 *
 * Esta rota usa o CopilotEngine "magro" que NÃO carrega o treinamento
 * persistido do workspace (FAQs, produtos, business_knowledge, few-shot
 * graduados) — só faz template-based replies. Foi mantida durante a
 * transição mas a extensão e o dashboard hoje usam /process (Tier 0).
 *
 * Headers de deprecation seguem RFC 8594 (Deprecation/Sunset) pra
 * integradores externos receberem aviso programático antes da remoção.
 * Sunset: 2026-08-01 (~3 meses de janela).
 */
const REPLIES_SUNSET_DATE = 'Sat, 01 Aug 2026 00:00:00 GMT';
let _repliesDeprecationWarnings = 0;
router.post('/replies', authenticate, asyncHandler(async (req, res) => {
  // Aviso programático ao cliente (RFC 8594 + Warning header legado).
  res.set('Deprecation', 'true');
  res.set('Sunset', REPLIES_SUNSET_DATE);
  res.set('Link', '</api/v2/ai/process>; rel="successor-version"');
  res.set('Warning', '299 - "POST /api/v2/ai/replies is deprecated; migrate to POST /api/v2/ai/process (AIOrchestrator)"');

  // Log throttled — não polui em alta carga, mas sinaliza no boot e a
  // cada 100 hits que ainda há cliente nessa rota.
  _repliesDeprecationWarnings++;
  if (_repliesDeprecationWarnings === 1 || _repliesDeprecationWarnings % 100 === 0) {
    logger.warn(
      `[deprecated] POST /api/v2/ai/replies chamado (total nesta instância: ${_repliesDeprecationWarnings}). ` +
      `Migre pra POST /api/v2/ai/process — esta rota NÃO carrega FAQs/produtos/business do banco e ` +
      `será removida em ${REPLIES_SUNSET_DATE}. ` +
      `User-Agent: ${req.get('user-agent') || 'unknown'} workspace=${req.workspaceId || 'unknown'}`
    );
  }

  if (!CopilotEngine) {
    return res.status(503).json({ error: 'Copilot Engine not available' });
  }

  const { message, context, count } = req.body;

  if (!message) {
    const e = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
    e.details = [{ field: 'message', message: 'message é obrigatório' }];
    throw e;
  }

  const result = await CopilotEngine.generateReplies(message, context || {}, count || 3);

  // Também sinaliza no body — alguns clientes ignoram headers mas
  // mostram metadata da resposta.
  if (result && typeof result === 'object') {
    result.deprecated = true;
    result.deprecationNotice = `This endpoint is deprecated. Migrate to POST /api/v2/ai/process. Sunset: ${REPLIES_SUNSET_DATE}.`;
  }

  res.json(result);
}));

/**
 * POST /api/v2/ai/score
 * Lead scoring
 */
router.post('/score', authenticate, asyncHandler(async (req, res) => {
  if (!CopilotEngine) {
    return res.status(503).json({ error: 'Copilot Engine not available' });
  }
  
  const { messages, contactData } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }
  
  const score = await CopilotEngine.scoreContact(messages, contactData || {});
  res.json(score);
}));

/**
 * POST /api/v2/ai/summarize
 * Resumo de conversa
 */
router.post('/summarize', authenticate, asyncHandler(async (req, res) => {
  if (!CopilotEngine) {
    return res.status(503).json({ error: 'Copilot Engine not available' });
  }
  
  const { messages } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }
  
  const summary = await CopilotEngine.summarize(messages);
  res.json(summary);
}));

/**
 * POST /api/v2/ai/translate
 * Tradução de texto
 */
router.post('/translate', authenticate, asyncHandler(async (req, res) => {
  if (!CopilotEngine) {
    return res.status(503).json({ error: 'Copilot Engine not available' });
  }
  
  const { text, targetLang } = req.body;
  
  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }
  
  const result = await CopilotEngine.translate(text, targetLang || 'pt-BR');
  res.json(result);
}));

/**
 * POST /api/v2/ai/correct
 * Correção gramatical
 */
router.post('/correct', authenticate, asyncHandler(async (req, res) => {
  if (!CopilotEngine) {
    return res.status(503).json({ error: 'Copilot Engine not available' });
  }
  
  const { text } = req.body;
  
  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }
  
  const result = await CopilotEngine.correct(text);
  res.json(result);
}));

/**
 * GET /api/v2/ai/personas
 * Lista personas disponíveis
 */
router.get('/personas', authenticate, asyncHandler(async (req, res) => {
  if (!CopilotEngine) {
    return res.status(503).json({ error: 'Copilot Engine not available' });
  }
  
  const personas = CopilotEngine.getPersonas();
  res.json({ personas });
}));

/**
 * POST /api/v2/ai/persona
 * Define persona ativa
 */
router.post('/persona', authenticate, asyncHandler(async (req, res) => {
  if (!CopilotEngine) {
    return res.status(503).json({ error: 'Copilot Engine not available' });
  }
  
  const { personaId } = req.body;
  
  if (!personaId) {
    return res.status(400).json({ error: 'personaId is required' });
  }
  
  const success = CopilotEngine.setPersona(personaId);
  if (!success) {
    return res.status(400).json({ error: 'Invalid persona' });
  }
  
  res.json({ success: true, persona: personaId });
}));

/**
 * GET /api/v2/ai/health
 * Health check de todos os providers
 */
router.get('/health', authenticate, asyncHandler(async (req, res) => {
  if (!AIRouter) {
    return res.status(503).json({ error: 'AI Router not available' });
  }
  
  const health = await AIRouter.healthCheck();
  res.json({ health });
}));

/**
 * GET /api/v2/ai/metrics
 * Métricas de uso
 */
router.get('/metrics', authenticate, asyncHandler(async (req, res) => {
  if (!AIRouter) {
    return res.status(503).json({ error: 'AI Router not available' });
  }
  
  const metrics = AIRouter.getMetrics();
  res.json(metrics);
}));

/**
 * POST /api/v2/ai/configure
 * Configura um provider
 */
router.post('/configure', authenticate, asyncHandler(async (req, res) => {
  if (!AIRouter) {
    return res.status(503).json({ error: 'AI Router not available' });
  }
  
  const { provider, apiKey, model, baseUrl } = req.body;
  
  if (!provider || !apiKey) {
    return res.status(400).json({ error: 'provider and apiKey are required' });
  }
  
  try {
    AIRouter.setProvider(provider, { apiKey, model, baseUrl });
    res.json({ success: true, provider });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}));

/**
 * POST /api/v2/ai/knowledge
 * Adiciona item à knowledge base
 */
router.post('/knowledge', authenticate, asyncHandler(async (req, res) => {
  if (!CopilotEngine) {
    return res.status(503).json({ error: 'Copilot Engine not available' });
  }
  
  const { question, answer, content, tags } = req.body;
  
  if (!question && !content) {
    return res.status(400).json({ error: 'question or content is required' });
  }
  
  CopilotEngine.addKnowledge({ question, answer, content, tags });
  res.json({ success: true });
}));

/**
 * GET /api/v2/ai/knowledge/search
 * Busca na knowledge base
 */
router.get('/knowledge/search', authenticate, asyncHandler(async (req, res) => {
  if (!CopilotEngine) {
    return res.status(503).json({ error: 'Copilot Engine not available' });
  }
  
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'q query param is required' });
  }
  
  const results = CopilotEngine.searchKnowledge(q);
  res.json({ results });
}));

/**
 * POST /api/v2/ai/process
 * v10.1: Processa mensagem com pipeline completo de IA (intent → goal → behavior → LLM → quality)
 * Alias conveniente de /api/v2/intelligence/process para clientes que já usam /api/v2/ai/*
 *
 * Body: { chatId, message, language?, businessRules? }
 */
router.post('/process', authenticate, checkSubscription('ai_basic'), asyncHandler(async (req, res) => {
  const { chatId, message, language = 'pt-BR', businessRules, persona } = req.body;
  // FIX v9.3.0 BUG CRÍTICO MULTI-TENANT:
  //   Antes: req.user.tenantId (não existe) || req.user.workspaceId (camelCase, não existe — user tem workspace_id snake_case)
  //   Resultado: TODAS as chamadas caíam no 'default' — multi-tenant quebrado.
  //   Cada cliente compartilhava o mesmo orchestrator, sem isolamento de memória/RAG/learning.
  // O middleware authenticate seta req.workspaceId (camelCase) E req.user.workspace_id (snake_case).
  // v9.3.5: SEM fallback 'default' — falhar explicitamente é melhor que vazar dados entre clientes.
  const tenantId = req.workspaceId || req.user?.workspace_id || req.user?.workspaceId || req.user?.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'workspace_id missing in session — re-authenticate' });
  }

  if (!chatId || typeof chatId !== 'string') {
    return res.status(400).json({ error: 'chatId is required' });
  }
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  // Persona (tom/estilo de resposta) — escolhida pelo cliente na extensão.
  // É input do cliente, então sanitiza antes de injetar no system prompt:
  // só aceita objeto com systemPrompt string e limita o tamanho dos campos.
  let safePersona = null;
  if (persona && typeof persona === 'object' &&
      typeof persona.systemPrompt === 'string' && persona.systemPrompt.trim()) {
    const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    safePersona = {
      id: clip(persona.id, 64),
      name: clip(persona.name, 120),
      description: clip(persona.description, 300),
      systemPrompt: clip(persona.systemPrompt, 2000),
    };
  }

  // v9.3.9 BILLING FIX CRÍTICO: pre-check saldo de tokens ANTES de chamar IA.
  // Antes: backend chamava OpenAI/Anthropic mesmo sem saldo, devolvia resposta,
  // depois TokenService.consume retornava insufficient_balance — return ignorado.
  // Resultado: cliente sem créditos consumia API key do dev gratuitamente.
  // Agora: bloqueia request com 402 se saldo zerado, antes de qualquer chamada externa.
  try {
    // v9.5.0 BUG #141: caminho errado — ai-v2.js está em src/routes/ não em
    // src/routes/<sub>/. ../../services aponta pra src/services (existe) só por
    // coincidência geometrica errada. Caminho canônico é ../services/TokenService.
    const tokenService = require('../services/TokenService');
    const balance = tokenService.getBalance(tenantId);
    // Margem mínima: 100 tokens (cobre ao menos 1 mensagem curta).
    // Workspaces em plano free com 0 tokens são bloqueados aqui.
    if (balance.balance < 100) {
      return res.status(402).json({
        error: 'Insufficient tokens',
        code: 'INSUFFICIENT_BALANCE',
        balance: balance.balance,
        upgradeUrl: '/upgrade',
        message: 'Créditos esgotados. Adquira mais tokens ou faça upgrade do plano.',
      });
    }
  } catch (err) {
    // Se workspace_credits nem existe, deixa passar (workspace recém-criado)
    // — primeira execução cria a row.
    require('../utils/logger').debug?.(`[AI/process] Pre-check skipped: ${err.message}`);
  }

  // CORREÇÃO P1: Usa OrchestratorRegistry (singleton real com LRU+TTL) em vez de Map no router
  // CORREÇÃO P3: Passa maxResponseTokens da configuração do workspace para o orquestrador
  let orchestrator;
  // Declarado FORA do try porque é lido depois (job enfileirado abaixo).
  // Antes vivia só no escopo do try → ReferenceError no path da fila.
  let workspaceConfig = {
    maxResponseTokens: parseInt(process.env.DEFAULT_MAX_RESPONSE_TOKENS, 10) || 400,
  };
  try {
    const db = require('../utils/database');
    const wsRow = db.get('SELECT max_response_tokens FROM workspaces WHERE id = ?', [tenantId]);
    workspaceConfig = {
      maxResponseTokens: wsRow?.max_response_tokens || parseInt(process.env.DEFAULT_MAX_RESPONSE_TOKENS, 10) || 400,
    };
    orchestrator = orchestratorRegistry.get(tenantId, workspaceConfig);
  } catch (e) {
    // Antes este catch engolia o erro silenciosamente, devolvendo só
    // "AIOrchestrator not available" pro cliente. Bug do
    // DynamicPromptBuilder (instance vs class) ficou invisível semanas
    // porque ninguém via o stack trace real. Agora logamos sempre.
    require('../utils/logger').error(
      `[AI/process] orchestrator init failed tenantId=${tenantId}: ${e.message}`,
      { stack: e.stack }
    );
    return res.status(503).json({
      error: 'AIOrchestrator not available',
      reason: e.message,
    });
  }

  // CORREÇÃO P1: Fila BullMQ assíncrona com fallback síncrono
  // Redis disponível → usa fila (controle de concorrência por tenant)
  // Redis ausente   → chamada direta (dev local sem Redis)
  let result;
  let usedQueue = false;
  // Com REDIS_DISABLED=true não há worker consumindo a fila: enfileirar só
  // levaria ao timeout de 28s antes do fallback. Pula direto pro modo síncrono.
  const redisDisabled = process.env.REDIS_DISABLED === 'true';
  try {
    if (redisDisabled) throw new Error('redis disabled — sync path');
    const { queues, queueEvents, QUEUES } = require('../jobs/ai-worker');
    const realtimeQueue = queues?.[QUEUES?.REALTIME];
    const realtimeEvents = queueEvents?.[QUEUES?.REALTIME];
    // Só usa a fila se TAMBÉM houver QueueEvents compartilhado pra essa fila.
    // CORREÇÃO CRÍTICA DE ESCALA: antes criávamos `new QueueEvents()` por
    // request — cada um abre uma conexão Redis (blocking) que nunca fechava.
    // Sob carga, vazava conexões até estourar o maxclients do Redis e derrubar
    // IA + rate-limiting juntos. Agora reusamos a instância única do worker.
    if (realtimeQueue && realtimeEvents) {
      const job = await realtimeQueue.add('process', {
        tenantId, chatId, message,
        language: language || 'pt-BR',
        businessRules: businessRules || [],
        persona: safePersona,
        workspaceConfig,
      }, { priority: 1 });
      // Espera o worker terminar o job. Default 45s — DEVE ser:
      //   > AI_PROVIDER_TIMEOUT_MS (40s, timeout interno do LLM) pra não
      //     desistir enquanto a IA ainda processa, E
      //   < response_header_timeout do Caddy (50s) pra o proxy não cortar
      //     antes de a gente responder.
      // Cadeia: provider(40s) < fila(45s) < proxy(50s). Override via env.
      const queueWaitMs = parseInt(process.env.AI_QUEUE_WAIT_MS, 10) || 45000;
      result = await job.waitUntilFinished(realtimeEvents, queueWaitMs);
      usedQueue = true;
    }
  } catch (_queueErr) {
    // Redis indisponível ou timeout — fallback para chamada síncrona
  }

  if (!usedQueue) {
    result = await orchestrator.processMessage(chatId, message, {
      language: language || 'pt-BR',
      businessRules: businessRules || [],
      persona: safePersona,
    });
  }


  res.json({
    ...result,
    intelligence: {
      responseGoal:         result.metadata?.responseGoal ?? null,
      commercialConfidence: result.metadata?.commercialConfidence ?? null,
      qualityScore:         result.metadata?.qualityScore ?? null,
      qualityRetries:       result.metadata?.qualityRetries ?? 0,
      clientStage:          result.metadata?.clientStage ?? null,
      clientStyle:          result.metadata?.clientStyle ?? null,
      energyLevel:          result.metadata?.energyLevel ?? null,
      isClosingMoment:      result.metadata?.isClosingMoment ?? false,
    },
  });
}));

module.exports = router;
