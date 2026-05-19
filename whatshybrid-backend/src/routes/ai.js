/**
 * AI Routes - Proxy para providers de IA
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const axios = require('axios');

const config = require('../../config');
const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');
const { checkTokenBalance } = require('../middleware/tokenBalance');
const { checkSubscription } = require('../middleware/subscription');
const { makeLikeTerm } = require('../utils/sql-helpers');
// v9.5.0 BUG #137: `aiCompletionLimiter` nunca foi exportado por rateLimiter.js.
// Em v9.4.7 era importado e passado como middleware → undefined → Express
// quebrava no boot ("Route.post() requires a callback function but got Undefined").
// Reusamos `aiLimiter` que tem semântica equivalente (20/min por workspace).
const { aiLimiter } = require('../middleware/rateLimiter');
const aiCompletionLimiter = aiLimiter;
const logger = require('../utils/logger');

const PROVIDERS = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    getHeaders: (apiKey) => ({ 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' })
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    getHeaders: (apiKey) => ({ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' })
  },
  venice: {
    endpoint: 'https://api.venice.ai/api/v1/chat/completions',
    getHeaders: (apiKey) => ({ 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' })
  },
  groq: {
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    getHeaders: (apiKey) => ({ 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' })
  }
};

// ─── Task-based routing ────────────────────────────────────────────────────
// Cada chamada de IA aceita opcionalmente `task: 'simple'|'normal'|'complex'`.
// O backend mapeia para uma cadeia de candidates (provider+model) ordenada
// por preferência. Cada candidate é tentado em ordem até um responder OK;
// erros transientes (429/5xx/timeout/network) caem pro próximo. Erros
// definitivos (4xx ≠ 429) abortam imediato.
//
// Decisões:
//   simple  — saudação, "ok", "obrigado", classificação binária. Modelo
//             menor é suficiente. Groq 8b-instant é praticamente free.
//   normal  — atendimento padrão. Groq 70b é grátis e tem qualidade próxima
//             do gpt-4o-mini. Fallback OpenAI mini se Groq ficar fora.
//   complex — análise profunda, ticket técnico longo, raciocínio multi-step.
//             Vai direto pro gpt-4o-mini (qualidade > custo aqui).
//
// SaaS economy: ~95% dos atendimentos cabe em 'normal' (free via Groq).
// O cliente NÃO paga você toda vez que a IA responder — só quando consumir
// o que custou ao backend de verdade (TokenService.consume com tokens reais).
const TASK_CHAINS = {
  simple: [
    { provider: 'groq',   model: 'llama-3.1-8b-instant' },
    { provider: 'groq',   model: 'llama-3.3-70b-versatile' },
    { provider: 'openai', model: 'gpt-4o-mini' },
  ],
  normal: [
    { provider: 'groq',   model: 'llama-3.3-70b-versatile' },
    { provider: 'openai', model: 'gpt-4o-mini' },
  ],
  complex: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'groq',   model: 'llama-3.3-70b-versatile' },
  ],
};

/**
 * Monta a chain de candidates para tentativa em ordem.
 * - Se cliente especifica `provider`, respeita E adiciona o "outro lado"
 *   (groq/openai) como fallback runtime.
 * - Se não especifica, usa task chain.
 * Filtra automaticamente candidates cujo provider não tem API key configurada.
 */
function resolveProviderChain(task, explicitProvider, explicitModel) {
  let candidates;
  if (explicitProvider && PROVIDERS[explicitProvider]) {
    candidates = [{
      provider: explicitProvider,
      model: explicitModel || config.ai[explicitProvider]?.defaultModel || 'gpt-4o-mini'
    }];
    // Adiciona o oposto como degradação resiliente.
    const opposite = explicitProvider === 'openai' ? 'groq' : 'openai';
    candidates.push({
      provider: opposite,
      model: config.ai[opposite]?.defaultModel
        || (opposite === 'openai' ? 'gpt-4o-mini' : 'llama-3.3-70b-versatile')
    });
  } else {
    const key = (task || 'normal').toLowerCase();
    candidates = TASK_CHAINS[key] || TASK_CHAINS.normal;
  }
  // Mantém só candidates com key configurada no .env.
  return candidates.filter(c => !!config.ai[c.provider]?.apiKey);
}

/**
 * Faz UMA chamada HTTP a um provider/model. Retorna {content, usage} ou
 * THROW Axios error (deixa retryability pra quem chamou decidir).
 */
async function callProviderOnce(provider, model, messages, temperature, max_tokens) {
  const providerConfig = PROVIDERS[provider];
  const apiKey = config.ai[provider]?.apiKey;
  if (!providerConfig || !apiKey) {
    const e = new Error(`Provider ${provider} sem API key configurada`);
    e.code = 'PROVIDER_NOT_CONFIGURED';
    throw e;
  }

  let requestBody;
  if (provider === 'anthropic') {
    const systemMsg = messages.find(m => m.role === 'system');
    const otherMsgs = messages.filter(m => m.role !== 'system');
    requestBody = {
      model,
      max_tokens: max_tokens || 1000,
      ...(systemMsg && { system: systemMsg.content }),
      messages: otherMsgs.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      ...(temperature !== undefined && { temperature })
    };
  } else {
    requestBody = {
      model,
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: max_tokens || 1000
    };
  }

  const startTime = Date.now();
  const response = await axios.post(
    providerConfig.endpoint,
    requestBody,
    { headers: providerConfig.getHeaders(apiKey), timeout: 60000 }
  );
  const latency = Date.now() - startTime;

  let content, usage;
  if (provider === 'anthropic') {
    content = response.data.content?.[0]?.text || '';
    usage = { prompt_tokens: response.data.usage?.input_tokens, completion_tokens: response.data.usage?.output_tokens };
  } else {
    content = response.data.choices?.[0]?.message?.content || '';
    usage = response.data.usage;
  }

  return { content, usage, latency, model, provider };
}

/**
 * Decide se vale tentar o próximo candidate na chain.
 * - 429 (rate limit), 5xx, timeout, network error → vale.
 * - 400/401/403 → não vale (problema de auth/payload, não transient).
 */
function isRetryableError(err) {
  if (err.code === 'PROVIDER_NOT_CONFIGURED') return true; // só pula esse provider
  if (err.code === 'ECONNABORTED') return true; // axios timeout
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') return true;
  const status = err.response?.status;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

// v9.4.6: getCredits/deductCredits REMOVIDOS — usavam workspaces.credits
// (tabela legada). Tudo migrado pra TokenService (única fonte de verdade).

router.use(aiLimiter);

/**
 * @route POST /api/v1/ai/complete
 * @desc AI completion (proxied)
 */
router.post(
  '/complete',
  aiCompletionLimiter,
  authenticate,
  // v9.7.x — Gate de plano: free não tem acesso a IA. Antes só o saldo de
  // tokens segurava (free=0 tokens), mas isso retornava erro genérico de
  // saldo. Agora retorna 402 FEATURE_NOT_AVAILABLE com upgradeUrl —
  // frontend mostra modal de upsell adequado.
  checkSubscription('ai_basic'),
  // P1: plugado o middleware checkTokenBalance — antes o check era manual
  // dentro do handler. Agora qualquer rota IA nova herda a proteção só
  // adicionando o middleware. estimatedCost=1 mantém o comportamento
  // antigo ("bloqueia só se zerou completamente"); a contabilização real
  // acontece pós-resposta via tokenService.consume.
  checkTokenBalance(1),
  asyncHandler(async (req, res) => {
    const { provider: explicitProvider, model: explicitModel, messages, temperature, max_tokens, requestId, chatId, task } = req.body;

    // v9.4.3 BUG #110: idempotência via requestId
    const safeRequestId = (typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 100)
      ? requestId
      : null;

    // Monta chain de fallback (task-based ou explicit-provider com degradação).
    const chain = resolveProviderChain(task, explicitProvider, explicitModel);
    if (chain.length === 0) {
      throw new AppError('No AI provider configured. Set GROQ_API_KEY ou OPENAI_API_KEY no .env', 503);
    }

    // Tenta cada candidate; primeiro sucesso é a resposta.
    let lastError = null;
    let result = null;
    let attemptedChain = [];
    for (const candidate of chain) {
      attemptedChain.push(`${candidate.provider}/${candidate.model}`);
      try {
        result = await callProviderOnce(
          candidate.provider,
          candidate.model,
          messages,
          temperature,
          max_tokens
        );
        break; // sucesso
      } catch (err) {
        lastError = err;
        const status = err.response?.status || err.code || 'unknown';
        if (isRetryableError(err)) {
          logger.warn(`[ai/complete] ${candidate.provider}/${candidate.model} falhou (${status}) — tentando próximo candidate`);
          continue;
        }
        // Erro definitivo (auth/payload). Aborta sem fallback.
        logger.error(`[ai/complete] ${candidate.provider}/${candidate.model} erro definitivo (${status}):`, err.response?.data?.error?.message || err.message);
        throw new AppError(
          err.response?.data?.error?.message || 'AI request failed',
          err.response?.status || 500
        );
      }
    }

    if (!result) {
      logger.error('[ai/complete] Todos os providers falharam:', attemptedChain.join(' → '));
      throw new AppError(
        lastError?.response?.data?.error?.message
          || `Todos os providers falharam: ${attemptedChain.join(' → ')}`,
        lastError?.response?.status || 503
      );
    }

    const { content, usage, latency, model, provider } = result;

    // Débito via TokenService (única fonte de verdade) com idempotência.
    const tokenService = require('../services/TokenService');
    const totalTokens = (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0);
    let consumeResult = { allowed: true, balance_after: 0, idempotent_replay: false };
    if (totalTokens > 0) {
      consumeResult = tokenService.consume(req.workspaceId, totalTokens, {
        ai_request_id: safeRequestId,
        model,
        prompt_tokens: usage?.prompt_tokens,
        completion_tokens: usage?.completion_tokens,
        description: `AI completion: ${provider}/${model}${task ? ` (task=${task})` : ''}`,
      });
    } else {
      const bal = tokenService.getBalance(req.workspaceId);
      consumeResult.balance_after = bal?.balance || 0;
    }

    // Analytics
    db.run(
      'INSERT INTO analytics_events (id, workspace_id, event_type, event_data, user_id) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), req.workspaceId, 'ai:completion', JSON.stringify({ provider, model, tokens: usage, latency, requestId: safeRequestId, task: task || null, attempted: attemptedChain }), req.userId]
    );

    // CostLogger fire-and-forget
    try {
      const costLogger = require('../services/CostLoggerService');
      costLogger.log({
        workspaceId: req.workspaceId,
        userId: req.userId,
        requestId: safeRequestId,
        provider,
        model,
        promptTokens: usage?.prompt_tokens || 0,
        completionTokens: usage?.completion_tokens || 0,
        latencyMs: latency,
        httpStatus: 200,
        chatId: chatId || null,
      });
    } catch (_) { /* logged inside the service */ }

    res.json({
      content,
      provider,
      model,
      usage,
      latency,
      balance: consumeResult.balance_after,
      idempotent_replay: consumeResult.idempotent_replay || false,
      // Útil pra debug: se o cliente pediu openai e caiu pra groq, ele vê.
      ...(attemptedChain.length > 1 && { fallback_used: true, attempted: attemptedChain }),
    });
  })
);

/**
 * @route GET /api/v1/ai/credits
 * @desc Get AI credits
 */
router.get('/credits', authenticate, asyncHandler(async (req, res) => {
  const tokenService = require('../services/TokenService');
  const balance = tokenService.getBalance(req.workspaceId);
  res.json({ credits: balance?.balance || 0, balance: balance?.balance || 0 });
}));

/**
 * @route GET /api/v1/ai/usage
 * @desc Get AI usage history
 */
router.get('/usage', authenticate, asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const usage = db.all(
    `SELECT event_data, created_at FROM analytics_events 
     WHERE workspace_id = ? AND event_type = 'ai:completion' AND created_at >= ?
     ORDER BY created_at DESC`,
    [req.workspaceId, startDate.toISOString()]
  ).map(e => ({ ...JSON.parse(e.event_data), timestamp: e.created_at }));

  const summary = {
    totalRequests: usage.length,
    totalTokens: usage.reduce((sum, u) => sum + (u.tokens?.prompt_tokens || 0) + (u.tokens?.completion_tokens || 0), 0),
    totalCost: usage.reduce((sum, u) => sum + (u.cost || 0), 0),
    byProvider: {}
  };

  usage.forEach(u => {
    if (!summary.byProvider[u.provider]) {
      summary.byProvider[u.provider] = { requests: 0, tokens: 0 };
    }
    summary.byProvider[u.provider].requests++;
    summary.byProvider[u.provider].tokens += (u.tokens?.prompt_tokens || 0) + (u.tokens?.completion_tokens || 0);
  });

  res.json({ usage: usage.slice(0, 100), summary });
}));

/**
 * @route GET /api/v1/ai/costs/summary
 * @desc v9.5.5 — Per-request economic summary (USD cost by provider/model/day).
 * Replaces the lossy /usage endpoint that only had token counts. Each row in
 * llm_cost_log has cost_usd computed at insert time using the current pricing
 * table, so historical rows are honest about what the workspace was charged.
 */
router.get('/costs/summary', authenticate, asyncHandler(async (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 365);
  const costLogger = require('../services/CostLoggerService');
  const summary = costLogger.summarize(req.workspaceId, days);
  res.json(summary);
}));

/**
 * @route POST /api/v1/ai/knowledge
 * @desc Add to knowledge base
 */
router.post('/knowledge', authenticate, asyncHandler(async (req, res) => {
  const { type, question, answer, content, tags } = req.body;
  const id = uuidv4();
  db.run(
    'INSERT INTO knowledge_base (id, workspace_id, type, question, answer, content, tags) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, req.workspaceId, type || 'faq', question, answer, content, JSON.stringify(tags || [])]
  );
  const item = db.get('SELECT * FROM knowledge_base WHERE id = ?', [id]);
  res.status(201).json({ item });
}));

/**
 * @route GET /api/v1/ai/knowledge
 * @desc Get knowledge base
 */
router.get('/knowledge', authenticate, asyncHandler(async (req, res) => {
  const { type, search } = req.query;
  let sql = 'SELECT * FROM knowledge_base WHERE workspace_id = ?';
  const params = [req.workspaceId];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (search) {
    // v9.3.7: makeLikeTerm
    const term = makeLikeTerm(search);
    if (term) {
      sql += ` AND (question LIKE ? ESCAPE '\\' OR answer LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')`;
      params.push(term, term, term);
    }
  }
  sql += ' ORDER BY usage_count DESC, created_at DESC';
  const items = db.all(sql, params).map(i => ({ ...i, tags: JSON.parse(i.tags || '[]') }));
  res.json({ items });
}));

/**
 * @route DELETE /api/v1/ai/knowledge/:id
 */
router.delete('/knowledge/:id', authenticate, asyncHandler(async (req, res) => {
  db.run('DELETE FROM knowledge_base WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  res.json({ message: 'Knowledge item deleted' });
}));

/**
 * @route POST /api/v1/ai/few-shot/sync
 * @desc Sync few-shot learning examples (alias for /api/v1/examples/sync)
 */
router.post('/few-shot/sync', authenticate, asyncHandler(async (req, res) => {
  const { examples: clientExamples = [] } = req.body;
  const workspaceId = req.workspaceId;
  const userId = req.userId;

  logger.info(`[FewShot] Syncing ${clientExamples.length} examples for workspace ${workspaceId}`);

  // Inserir exemplos do cliente que não existem
  let inserted = 0;
  for (const ex of clientExamples) {
    const existing = db.get(
      'SELECT id FROM training_examples WHERE id = ? AND workspace_id = ?',
      [ex.id, workspaceId]
    );

    if (!existing) {
      db.run(`
        INSERT INTO training_examples
        (id, workspace_id, user_id, input, output, context, category, tags, usage_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `, [
        ex.id || uuidv4(),
        workspaceId,
        userId,
        ex.input,
        ex.output,
        ex.context || '',
        ex.category || 'Geral',
        JSON.stringify(ex.tags || []),
        ex.usageCount || 0
      ]);
      inserted++;
    }
  }

  // Retornar todos os exemplos do servidor
  const serverExamples = db.all(`
    SELECT id, input, output, context, category, tags, usage_count, created_at, updated_at
    FROM training_examples
    WHERE workspace_id = ?
    ORDER BY usage_count DESC
    LIMIT 100
  `, [workspaceId]);

  const formattedExamples = serverExamples.map(ex => ({
    ...ex,
    tags: ex.tags ? JSON.parse(ex.tags) : [],
    usageCount: ex.usage_count
  }));

  logger.info(`[FewShot] Sync complete: ${inserted} inserted, ${formattedExamples.length} total`);

  res.json({
    success: true,
    examples: formattedExamples,
    synced: clientExamples.length,
    inserted,
    total: formattedExamples.length
  });
}));

/**
 * @route GET /api/v1/ai/few-shot
 * @desc Get few-shot learning examples
 */
router.get('/few-shot', authenticate, asyncHandler(async (req, res) => {
  const { category, limit = 100 } = req.query;
  const workspaceId = req.workspaceId;

  let query = `
    SELECT id, input, output, context, category, tags, usage_count, created_at, updated_at
    FROM training_examples
    WHERE workspace_id = ?
  `;
  const params = [workspaceId];

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  query += ' ORDER BY usage_count DESC, updated_at DESC LIMIT ?';
  params.push(parseInt(limit));

  const examples = db.all(query, params);

  const formattedExamples = examples.map(ex => ({
    ...ex,
    tags: ex.tags ? JSON.parse(ex.tags) : [],
    usageCount: ex.usage_count
  }));

  res.json({
    success: true,
    examples: formattedExamples,
    total: formattedExamples.length
  });
}));

/**
 * v9.4.0 BUG #94 FIX — endpoints /learn/feedback e /learn/context que a extensão
 * já vinha chamando (linhas 1128 e 2532 do copilot-engine.js) mas o backend NUNCA
 * teve. Frontend mandava feedback que sumia, ValidatedLearningPipeline ficava sem
 * dados, autopilot não aprendia com correções do user.
 *
 * /learn/feedback aceita correções do user (rating + correctedResponse) e persiste
 * em ai_feedback pra ValidatedLearningPipeline consumir. Tabela criada inline em
 * database-legacy.js no boot.
 *
 * /learn/context retorna histórico recente do chat + few-shot examples relevantes
 * pra extensão montar contexto híbrido (já implementado em conversations + few-shot,
 * só faltava endpoint unificado).
 */
router.post('/learn/feedback', authenticate, checkSubscription('ai_basic'), asyncHandler(async (req, res) => {
  const { chatId, messageId, interactionId, userMessage, assistantResponse, rating, correctedResponse, feedbackType } = req.body;

  // Validação rigorosa pra não corromper base de aprendizado
  if (!chatId || typeof chatId !== 'string' || chatId.length > 200) {
    return res.status(400).json({ error: 'chatId inválido' });
  }

  // v9.7.x — FIX FEEDBACK LOOP: extensão envia rating como STRING ('positive'/'negative')
  // ou número (0-5). Aceita ambos e normaliza pra número antes de gravar.
  // Bug anterior: Number('positive') = NaN → 400 → IA nunca aprendia com feedback.
  let ratingNum;
  if (typeof rating === 'number') {
    ratingNum = rating;
  } else if (typeof rating === 'string') {
    const r = rating.toLowerCase().trim();
    if (r === 'positive' || r === 'thumbs_up' || r === 'good' || r === 'up') ratingNum = 5;
    else if (r === 'negative' || r === 'thumbs_down' || r === 'bad' || r === 'down') ratingNum = 0;
    else if (r === 'neutral') ratingNum = 3;
    else ratingNum = Number(r); // tenta como número stringificado
  } else if (rating === undefined && (feedbackType === 'thumbs_up' || feedbackType === 'thumbs_down')) {
    // Sinal binário sem rating numérico — deriva do feedbackType
    ratingNum = feedbackType === 'thumbs_up' ? 5 : 0;
  }
  if (!Number.isFinite(ratingNum) || ratingNum < 0 || ratingNum > 5) {
    return res.status(400).json({
      error: "rating deve ser número 0-5 ou string ('positive'/'negative'/'neutral')",
      received: rating,
    });
  }

  // v9.7.x — userMessage/assistantResponse podem ser RECONSTRUÍDOS via interactionId.
  // Antes exigíamos os dois sempre, mas a UI nem sempre tem como reconstruir o texto
  // exato da sugestão original. Com interactionId, o orchestrator carrega do
  // _interactionMetadataStore / DB. Sem interactionId, exigimos os textos.
  const hasInteractionId = interactionId && typeof interactionId === 'string' && interactionId.length <= 200;
  if (!hasInteractionId) {
    if (!userMessage || typeof userMessage !== 'string' || userMessage.length > 10000) {
      return res.status(400).json({ error: 'userMessage obrigatório quando não há interactionId (max 10k chars)' });
    }
    if (!assistantResponse || typeof assistantResponse !== 'string' || assistantResponse.length > 10000) {
      return res.status(400).json({ error: 'assistantResponse obrigatório quando não há interactionId (max 10k chars)' });
    }
  } else {
    if (userMessage !== undefined && (typeof userMessage !== 'string' || userMessage.length > 10000)) {
      return res.status(400).json({ error: 'userMessage inválido (max 10k chars)' });
    }
    if (assistantResponse !== undefined && (typeof assistantResponse !== 'string' || assistantResponse.length > 10000)) {
      return res.status(400).json({ error: 'assistantResponse inválido (max 10k chars)' });
    }
  }
  if (correctedResponse !== undefined && correctedResponse !== null) {
    if (typeof correctedResponse !== 'string' || correctedResponse.length > 10000) {
      return res.status(400).json({ error: 'correctedResponse inválido' });
    }
  }
  const ALLOWED_TYPES = ['rating', 'correction', 'thumbs_up', 'thumbs_down'];
  const fbType = ALLOWED_TYPES.includes(feedbackType) ? feedbackType : 'rating';

  const { v4: uuid } = require('../utils/uuid-wrapper');
  const id = uuid();

  // Defaults seguros pra colunas NOT NULL quando vier só interactionId
  const safeUserMessage      = (userMessage      ?? '').toString();
  const safeAssistantResponse = (assistantResponse ?? '').toString();

  try {
    db.run(
      `INSERT INTO ai_feedback
        (id, workspace_id, chat_id, message_id, user_message, assistant_response,
         rating, corrected_response, feedback_type, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [id, req.workspaceId, chatId, messageId || null, safeUserMessage, safeAssistantResponse,
       ratingNum, correctedResponse || null, fbType, req.userId]
    );
  } catch (e) {
    require('../utils/logger').warn(`[AI/feedback] persist failed: ${e.message}`);
    return res.json({ success: true, persisted: false });
  }

  // v9.4.1 BUG #95 FIX: chamada anterior `pipeline.recordFeedback({...obj})` era no-op
  // por 2 razões — module.exports é a CLASSE (não instância) e a assinatura real é
  // `recordFeedback(interactionId, feedback)` recebendo string 'positive'/'negative'/'neutral'.
  // Agora: pega o orchestrator do workspace via registry (mesma instância que processou
  // a request original) e chama recordFeedback corretamente. Orchestrator carrega
  // metadata da interação via _interactionMetadataStore (in-memory) ou DB fallback.
  if (hasInteractionId) {
    setImmediate(async () => {
      try {
        const orchestratorRegistry = require('../registry/OrchestratorRegistry');
        const orchestrator = orchestratorRegistry.get(req.workspaceId);
        if (!orchestrator?.recordFeedback) return;

        // Normaliza feedback pra string que o pipeline aceita.
        // - rating >= 4   -> 'positive'
        // - rating <= 2   -> 'negative'
        // - 'correction'  -> 'edited' (user corrigiu a resposta)
        // - resto         -> 'neutral'
        let normalized = 'neutral';
        if (fbType === 'correction' && correctedResponse) normalized = 'edited';
        else if (fbType === 'thumbs_up' || ratingNum >= 4) normalized = 'positive';
        else if (fbType === 'thumbs_down' || ratingNum <= 2) normalized = 'negative';

        orchestrator.recordFeedback(interactionId, normalized);
      } catch (err) {
        require('../utils/logger').warn(`[AI/feedback] orchestrator.recordFeedback failed: ${err.message}`);
      }
    });
  } else {
    // Sem interactionId, persistimos em ai_feedback pra agregação posterior
    // (ETL pode rodar depois e treinar com dados acumulados). Pipeline ao vivo
    // só aprende quando interactionId chega.
    require('../utils/logger').debug?.(`[AI/feedback] sem interactionId, salvo em ai_feedback (id=${id})`);
  }

  res.json({ success: true, id });
}));

/**
 * GET /api/v1/ai/learn/context/:chatId
 * Retorna contexto agregado pra montar prompt do autopilot:
 *   - últimas N mensagens do chat
 *   - few-shot examples relevantes
 *   - feedback histórico do mesmo chat
 */
router.get('/learn/context/:chatId', authenticate, asyncHandler(async (req, res) => {
  const chatId = String(req.params.chatId || '');
  if (!chatId || chatId.length > 200) {
    return res.status(400).json({ error: 'chatId inválido' });
  }

  const includeExamples = req.query.includeExamples === 'true';
  const maxMessages = Math.min(parseInt(req.query.maxMessages, 10) || 30, 100);
  const maxExamples = Math.min(parseInt(req.query.maxExamples, 10) || 3, 20);

  let messages = [];
  let examples = [];
  let feedbackCount = 0;

  // Últimas mensagens (de conversations se existir)
  try {
    messages = db.all(
      `SELECT role, content, created_at FROM ai_messages
       WHERE workspace_id = ? AND chat_id = ?
       ORDER BY created_at DESC LIMIT ?`,
      [req.workspaceId, chatId, maxMessages]
    ).reverse();
  } catch (_) { /* tabela pode não existir */ }

  if (includeExamples) {
    try {
      examples = db.all(
        `SELECT input, output FROM training_examples
         WHERE workspace_id = ? ORDER BY usage_count DESC LIMIT ?`,
        [req.workspaceId, maxExamples]
      );
    } catch (_) {}
  }

  try {
    const fb = db.get(
      `SELECT COUNT(*) as c FROM ai_feedback WHERE workspace_id = ? AND chat_id = ?`,
      [req.workspaceId, chatId]
    );
    feedbackCount = fb?.c || 0;
  } catch (_) {}

  res.json({
    chatId,
    messages,
    examples,
    feedbackCount,
    timestamp: new Date().toISOString(),
  });
}));

module.exports = router;
