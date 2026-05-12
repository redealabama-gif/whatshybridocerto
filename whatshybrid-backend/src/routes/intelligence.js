/**
 * 🧠 Intelligence Routes
 * WhatsHybrid Pro v10.1.0
 *
 * Dashboard e controle dos módulos de inteligência comercial:
 *   GET  /api/v2/intelligence/stats         → stats consolidados de todos os motores
 *   GET  /api/v2/intelligence/client/:chatId → perfil comercial do cliente
 *   PATCH /api/v2/intelligence/client/:chatId/stage → atualizar estágio manualmente
 *   POST /api/v2/intelligence/process       → processar mensagem pelo AIOrchestrator completo
 *   GET  /api/v2/intelligence/health        → health check dos módulos
 *
 * @module routes/intelligence
 */

const express = require('express');
const router = express.Router();
const { authenticate, checkWorkspace } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { aiLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');

// ── Carregamento dos módulos de inteligência ──────────────────────────────────
let CommercialIntelligenceEngine, ResponseQualityChecker, ClientBehaviorAdapter;

// CORREÇÃO P1: Usa OrchestratorRegistry singleton em vez de Map local no módulo
const orchestratorRegistry = require('../registry/OrchestratorRegistry');

try {
  CommercialIntelligenceEngine = require('../ai/intelligence/CommercialIntelligenceEngine');
  ResponseQualityChecker = require('../ai/quality/ResponseQualityChecker');
  ClientBehaviorAdapter = require('../ai/intelligence/ClientBehaviorAdapter');
} catch (e) {
  logger.warn('[Intelligence Routes] Some AI modules not loaded:', e.message);
}

/**
 * CORREÇÃO P1: Retorna orchestrator via registry (singleton real com LRU+TTL).
 */
function getOrchestrator(tenantId, config = {}) {
  try { return orchestratorRegistry.get(tenantId, config); }
  catch(e) { logger.warn('[Intelligence] OrchestratorRegistry error:', e.message); return null; }
}

router.use(aiLimiter);

// ─────────────────────────────────────────────────────────────────────────────
// GET /stats
// Dashboard consolidado: commercial engine + quality checker + behavior adapter
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats', authenticate, asyncHandler(async (req, res) => {
  const tenantId = req.workspaceId || req.user?.workspace_id || req.user?.workspaceId || req.user?.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'workspace_id missing in session' });
  const orchestrator = getOrchestrator(tenantId);

  if (!orchestrator) {
    return res.status(503).json({ error: 'Intelligence modules not available' });
  }

  const commercialStats = orchestrator.getCommercialStats();
  const qualityStats    = orchestrator.getQualityStats();
  const behaviorStats   = orchestrator.getBehaviorStats();
  const analyticsStats  = orchestrator.analytics?.getSummary?.() ?? null;

  // Calcular métricas derivadas
  const totalInteractions = commercialStats.total || 0;
  const qualityPassRate   = qualityStats.passRate ?? 'n/a';
  const closingRate       = behaviorStats.closingRate ?? 'n/a';

  // Distribuição de goals (percentual)
  const goalDistribution = {};
  if (totalInteractions > 0) {
    for (const [goal, count] of Object.entries(commercialStats.byGoal || {})) {
      goalDistribution[goal] = {
        count,
        pct: ((count / totalInteractions) * 100).toFixed(1) + '%'
      };
    }
  }

  res.json({
    version: '10.1.0',
    tenantId,
    timestamp: new Date().toISOString(),
    summary: {
      totalInteractions,
      qualityPassRate,
      closingMomentRate: closingRate,
      avgQualityRetries: qualityStats.total > 0
        ? (qualityStats.regenerated / qualityStats.total).toFixed(2)
        : 0,
    },
    commercial: {
      ...commercialStats,
      goalDistribution,
    },
    quality: qualityStats,
    behavior: behaviorStats,
    analytics: analyticsStats,
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /client/:chatId
// Retorna perfil comercial completo do cliente (estágio, intent, goals)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/client/:chatId', authenticate, asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const tenantId = req.workspaceId || req.user?.workspace_id || req.user?.workspaceId || req.user?.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'workspace_id missing in session' });

  if (!chatId) throw new AppError('chatId is required', 400);

  const orchestrator = getOrchestrator(tenantId);
  if (!orchestrator) {
    return res.status(503).json({ error: 'Intelligence modules not available' });
  }

  const ctx = orchestrator.conversationMemory.getContext(chatId);

  res.json({
    chatId,
    tenantId,
    clientStage: ctx.clientStage,
    lastDominantIntent: ctx.lastDominantIntent,
    profile: {
      stage: ctx.profile?.stage ?? 'cold',
      intentHistory: ctx.profile?.intentHistory ?? [],
      responseGoalHistory: ctx.profile?.responseGoalHistory ?? [],
      lastInteractionAt: ctx.profile?.lastInteractionAt ?? null,
      topicsDiscussed: ctx.profile?.topicsDiscussed ?? [],
      satisfactionTrend: ctx.profile?.satisfactionTrend ?? [],
      unresolvedIssues: ctx.profile?.unresolvedIssues ?? [],
      preferredTone: ctx.profile?.preferredTone ?? 'professional',
      segment: ctx.profile?.segment ?? 'new',
    },
    conversationMeta: ctx.metadata,
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /client/:chatId/stage
// Atualização manual do estágio (ex: vendedor marca "customer" após fechar)
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/client/:chatId/stage', authenticate, asyncHandler(async (req, res) => {
  const { chatId }  = req.params;
  const { stage }   = req.body;
  const tenantId = req.workspaceId || req.user?.workspace_id || req.user?.workspaceId || req.user?.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'workspace_id missing in session' });

  const VALID_STAGES = ['cold', 'interested', 'warm', 'customer', 'inactive'];
  if (!stage || !VALID_STAGES.includes(stage)) {
    throw new AppError(`stage must be one of: ${VALID_STAGES.join(', ')}`, 400);
  }

  const orchestrator = getOrchestrator(tenantId);
  if (!orchestrator) {
    return res.status(503).json({ error: 'Intelligence modules not available' });
  }

  const conversation = orchestrator.conversationMemory.getOrCreateConversation(chatId);
  const previousStage = conversation.profile.stage;
  conversation.profile.stage = stage;
  conversation.updatedAt = Date.now();

  logger.info(`[Intelligence] Manual stage update: ${chatId} ${previousStage} → ${stage} (tenant: ${tenantId})`);

  res.json({
    success: true,
    chatId,
    previousStage,
    newStage: stage,
    updatedAt: new Date().toISOString(),
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /process
// Processa uma mensagem pelo AIOrchestrator v10.1 completo
// Body: { chatId, message, language?, businessRules?, customIntents? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/process', authenticate, asyncHandler(async (req, res) => {
  const { chatId, message, language = 'pt-BR', businessRules, customIntents } = req.body;
  const tenantId = req.workspaceId || req.user?.workspace_id || req.user?.workspaceId || req.user?.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'workspace_id missing in session' });

  if (!chatId || typeof chatId !== 'string') throw new AppError('chatId is required', 400);
  if (!message || typeof message !== 'string') throw new AppError('message is required', 400);
  if (message.length > 4000) throw new AppError('message too long (max 4000 chars)', 400);

  const orchestrator = getOrchestrator(tenantId);
  if (!orchestrator) {
    return res.status(503).json({ error: 'Intelligence modules not available' });
  }

  const result = await orchestrator.processMessage(chatId, message, {
    language,
    businessRules: businessRules || [],
    customIntents: customIntents || [],
  });

  // Enriquecer resposta com dados de intelligence
  res.json({
    ...result,
    intelligence: {
      responseGoal:          result.metadata?.responseGoal ?? null,
      commercialConfidence:  result.metadata?.commercialConfidence ?? null,
      qualityScore:          result.metadata?.qualityScore ?? null,
      qualityRetries:        result.metadata?.qualityRetries ?? 0,
      clientStage:           result.metadata?.clientStage ?? null,
      clientStyle:           result.metadata?.clientStyle ?? null,
      energyLevel:           result.metadata?.energyLevel ?? null,
      isClosingMoment:       result.metadata?.isClosingMoment ?? false,
    },
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /health
// Health check de todos os módulos de inteligência
// ─────────────────────────────────────────────────────────────────────────────
router.get('/health', authenticate, asyncHandler(async (req, res) => {
  const modules = {
    CommercialIntelligenceEngine: !!CommercialIntelligenceEngine,
    ResponseQualityChecker:       !!ResponseQualityChecker,
    ClientBehaviorAdapter:        !!ClientBehaviorAdapter,
    AIOrchestrator:               !!AIOrchestrator,
  };

  const allHealthy = Object.values(modules).every(Boolean);

  res.status(allHealthy ? 200 : 503).json({
    healthy: allHealthy,
    version: '10.1.0',
    modules,
    timestamp: new Date().toISOString(),
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /auto-learning
// v10.2: Métricas do ciclo completo de aprendizado por outcome real
// ─────────────────────────────────────────────────────────────────────────────
router.get('/auto-learning', authenticate, asyncHandler(async (req, res) => {
  const tenantId = req.workspaceId || req.user?.workspace_id || req.user?.workspaceId || req.user?.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'workspace_id missing in session' });
  const orchestrator = getOrchestrator(tenantId);

  if (!orchestrator) {
    return res.status(503).json({ error: 'Intelligence modules not available' });
  }

  const stats = orchestrator.getAutoLearningStats();

  res.json({
    version: '10.2.0',
    tenantId,
    timestamp: new Date().toISOString(),
    enabled: !!stats.loop,
    ...stats,
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /auto-learning/conversion
// v10.2: Marcar conversão manual (vendedor fechou negócio)
// Body: { interactionId }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auto-learning/conversion', authenticate, asyncHandler(async (req, res) => {
  const { interactionId } = req.body;
  const tenantId = req.workspaceId || req.user?.workspace_id || req.user?.workspaceId || req.user?.tenantId;
  if (!tenantId) return res.status(401).json({ error: 'workspace_id missing in session' });

  if (!interactionId) throw new AppError('interactionId is required', 400);

  const orchestrator = getOrchestrator(tenantId);
  if (!orchestrator) {
    return res.status(503).json({ error: 'Intelligence modules not available' });
  }

  const recorded = orchestrator.recordManualConversion(interactionId);

  res.json({
    success: recorded,
    interactionId,
    message: recorded
      ? 'Conversão registrada. O sistema aprenderá com este resultado.'
      : 'interactionId não encontrado nos outcomes pendentes.',
  });
}));

module.exports = router;
