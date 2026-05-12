/**
 * 🤖 AI Routes - Endpoints de IA
 * WhatsHybrid Pro v7.1.0
 */

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();
const { authenticate, checkWorkspace } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { aiLimiter } = require('../middleware/rateLimiter');

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
router.post('/complete', authenticate, asyncHandler(async (req, res) => {
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
 * POST /api/v2/ai/replies
 * Gera sugestões de resposta
 */
router.post('/replies', authenticate, asyncHandler(async (req, res) => {
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
router.post('/process', authenticate, asyncHandler(async (req, res) => {
  const { chatId, message, language = 'pt-BR', businessRules } = req.body;
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
  try {
    const db = require('../utils/database');
    const wsRow = db.get('SELECT max_response_tokens FROM workspaces WHERE id = ?', [tenantId]);
    const workspaceConfig = {
      maxResponseTokens: wsRow?.max_response_tokens || parseInt(process.env.DEFAULT_MAX_RESPONSE_TOKENS, 10) || 400,
    };
    orchestrator = orchestratorRegistry.get(tenantId, workspaceConfig);
  } catch (e) {
    return res.status(503).json({ error: 'AIOrchestrator not available' });
  }

  // CORREÇÃO P1: Fila BullMQ assíncrona com fallback síncrono
  // Redis disponível → usa fila (controle de concorrência por tenant)
  // Redis ausente   → chamada direta (dev local sem Redis)
  let result;
  let usedQueue = false;
  try {
    const { queues, QUEUES } = require('../jobs/ai-worker');
    const realtimeQueue = queues?.[QUEUES?.REALTIME];
    if (realtimeQueue) {
      const job = await realtimeQueue.add('process', {
        tenantId, chatId, message,
        language: language || 'pt-BR',
        businessRules: businessRules || [],
        workspaceConfig,
      }, { priority: 1 });
      const queueEvents = realtimeQueue.events || new (require('bullmq').QueueEvents)(QUEUES.REALTIME, {
        connection: realtimeQueue.opts?.connection,
      });
      result = await job.waitUntilFinished(queueEvents, 28000);
      usedQueue = true;
    }
  } catch (_queueErr) {
    // Redis indisponível ou timeout — fallback para chamada síncrona
  }

  if (!usedQueue) {
    result = await orchestrator.processMessage(chatId, message, {
      language: language || 'pt-BR',
      businessRules: businessRules || [],
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
