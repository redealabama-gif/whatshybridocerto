/**
 * AIOrchestrator - Coordinates all AI modules for message processing
 * @module ai/AIOrchestrator
 *
 * FIXES APPLIED:
 *  P1 - _generateResponse now calls AIRouterService (real LLM) instead of returning hardcoded strings
 *  P3 - ValidatedLearningPipeline.getTopGraduated() injected into DynamicPromptBuilder as few-shot examples
 *  P4 - tenantId is accepted and propagated to ConversationMemory and HybridSearch
 */

const HybridIntentClassifier = require('./classifiers/HybridIntentClassifier');
const ConversationMemory = require('./memory/ConversationMemory');
const ResponseABTester = require('./learning/ResponseABTester');
const AIAnalyticsCollector = require('./analytics/AIAnalyticsCollector');
const ResponseSafetyFilter = require('./safety/ResponseSafetyFilter');
const HybridSearch = require('./search/HybridSearch');
const DynamicPromptBuilder = require('./prompts/DynamicPromptBuilder');
// FIX: importa proxy do singleton + classe nomeada para casos de instância dedicada
const AIRouterModule = require('./services/AIRouterService');
const { AIRouterService } = AIRouterModule;
const ValidatedLearningPipeline = require('./learning/ValidatedLearningPipeline'); // P3
const CommercialIntelligenceEngine = require('./intelligence/CommercialIntelligenceEngine'); // v10
const ResponseQualityChecker = require('./quality/ResponseQualityChecker'); // v10
const ClientBehaviorAdapter = require('./intelligence/ClientBehaviorAdapter'); // v10.1
// v10.2: Auto-Evolutionary AI
const ResponseOutcomeTracker = require('./learning/outcome/ResponseOutcomeTracker');
const PerformanceScoreEngine = require('./learning/outcome/PerformanceScoreEngine');
const StrategySelector       = require('./learning/outcome/StrategySelector');
const AutoLearningLoop       = require('./learning/outcome/AutoLearningLoop');
const logger = require('../config/logger');
// CORREÇÃO P2: PipelineTracer para observabilidade real integrada ao pipeline
let PipelineTracer;
try { PipelineTracer = require('../observability/pipeline-tracer'); } catch(e) { PipelineTracer = null; }

class AIOrchestrator {
  /**
   * @param {Object} config
   * @param {string} [config.tenantId]  – Tenant scope for all sub-components (P4)
   */
  constructor(config = {}) {
    this.tenantId = config.tenantId || 'default'; // P4

    this.intentClassifier = new HybridIntentClassifier();
    // CORREÇÃO: Injetar SQLiteAdapter em ConversationMemory para persistência real
    let _cmAdapter = null;
    try {
      const ConversationMemorySQLiteAdapter = require('./memory/ConversationMemoryPrismaAdapter');
      _cmAdapter = new ConversationMemorySQLiteAdapter(null, this.tenantId);
    } catch(e) { /* adapter opcional */ }
    this.conversationMemory = new ConversationMemory({
      tenantId: this.tenantId,
      prismaAdapter: _cmAdapter,
      enablePersistence: false, // desabilita arquivo JSON (usamos DB)
      ...(config.memory || {}),
    });
    this.abTester = new ResponseABTester();
    this.analytics = new AIAnalyticsCollector();
    this.safetyFilter = new ResponseSafetyFilter(config.safety);
    this.hybridSearch = new HybridSearch({ tenantId: this.tenantId, ...config.search });
    this.promptBuilder = new DynamicPromptBuilder(config.prompts);
    // FIX: usa singleton compartilhado (mesmo que rotas/agents/copilot usam) por padrão.
    // Cria instância dedicada APENAS se config.ai for fornecido com valores específicos.
    // Antes: cada AIOrchestrator criava sua própria instância sem env vars,
    //        ficando com providers vazios em multi-tenant.
    this.aiRouter = (config.ai && Object.keys(config.ai).length > 0)
      ? new AIRouterService(config.ai)
      : AIRouterModule;
    this.learningPipeline = new ValidatedLearningPipeline(config.learning || {}); // P3
    this.commercialEngine = new CommercialIntelligenceEngine(config.commercial || {}); // v10
    this.qualityChecker = new ResponseQualityChecker(config.quality || {}); // v10
    this.behaviorAdapter = new ClientBehaviorAdapter(config.behavior || {}); // v10.1

    // v10.2: Auto-Evolutionary AI — ciclo completo de aprendizado por outcome real
    this.outcomeTracker   = new ResponseOutcomeTracker(config.outcome || {});
    this.scoreEngine      = new PerformanceScoreEngine(config.scoring || {});
    this.strategySelector = new StrategySelector(config.strategy || {});
    this.autoLearningLoop = new AutoLearningLoop({
      outcomeTracker:     this.outcomeTracker,
      scoreEngine:        this.scoreEngine,
      strategySelector:   this.strategySelector,
      learningPipeline:   this.learningPipeline,
      abTester:           this.abTester,
      conversationMemory: this.conversationMemory,
    });

    this.config = {
      enableABTesting: true,
      enableAnalytics: true,
      enableSafety: true,
      enableCommercialIntelligence: true, // v10
      enableQualityChecker: true,         // v10
      enableBehaviorAdapter: true,        // v10.1
      enableAutoLearning: true,           // v10.2
      maxQualityRetries: 2,               // v10
      confidenceThreshold: 0.7,
      maxResponseTokens: config.maxResponseTokens || 400,  // CORREÇÃO P3: configurável por tenant
      maxHistoryMessages: 10,
      ...config
    };

    // CORREÇÃO P0: Store de metadados de interação para fechar o loop de feedback
    // Map<interactionId, {intent, question, response, responseGoal, clientStage, variant}>
    this._interactionMetadataStore = new Map();
    // Limite de 1000 entradas para evitar memory leak (TTL implícito por tamanho)
    this._interactionMetadataMaxSize = 1000;

    logger.info(`AIOrchestrator initialized for tenant "${this.tenantId}"`);
  }

  async init() {
    await Promise.all([
      this.conversationMemory.init ? this.conversationMemory.init() : Promise.resolve(),
      this.learningPipeline.init ? this.learningPipeline.init() : Promise.resolve(),
    ]);
    logger.info(`AIOrchestrator ready (tenant: ${this.tenantId})`);
  }

  async processMessage(chatId, message, context = {}) {
    if (!chatId || typeof chatId !== 'string') throw new Error('chatId is required and must be a string');
    // FIX FATAL: variável era declarada como _tracer mas usada como tracer linhas abaixo
    // Resultado: ReferenceError em strict mode → catch externo → fallback de erro em TODA mensagem
    const tracer = PipelineTracer ? new PipelineTracer({ tenantId: this.tenantId }) : null;
    if (!message || typeof message !== 'string') throw new Error('message is required and must be a string');

    const startTime = Date.now();

    try {
      // ── 1. Contexto de memória (inclui clientStage e lastDominantIntent via v10) ──
      const conversationContext = await this.conversationMemory.getContext(chatId);

      // ── 2. Classificação de intent ──────────────────────────────────────────
      tracer?.startStage('intent_classification');
      const intentResult = await this.intentClassifier.classify(message, {
        history: conversationContext.recentMessages || [],
        customIntents: context.customIntents,
        ...context
      });

      if (intentResult.confidence < this.config.confidenceThreshold && this.config.enableAnalytics) {
        this.analytics.recordKnowledgeGap({
          chatId, question: message, intent: intentResult.intent,
          confidence: intentResult.confidence, reason: 'low_confidence',
          context: { ...context, intentResult }
        });
      }

      // ── 3. RAG / HybridSearch ───────────────────────────────────────────────
      let knowledgeResults = [];
      try {
        knowledgeResults = (await this.hybridSearch.search(message, 5)) || [];
      } catch (err) { logger.warn(`HybridSearch error: ${err.message}`); }

      // ── 3b. v9.7.x — Conhecimento treinado pelo usuário (FAQs / produtos /
      //     business info / few-shot examples salvos via /training/sync).
      //     HybridSearch é in-memory e nunca foi populado a partir das tabelas
      //     de treinamento — então o treinamento ficava invisível pro caminho
      //     principal. Aqui buscamos direto do DB por keyword match leve e
      //     mergeamos como `knowledgeResults`, que o DynamicPromptBuilder já
      //     sabe injetar no prompt.
      try {
        const trained = this._loadTrainedKnowledge(message, 6);
        if (trained.length) knowledgeResults = knowledgeResults.concat(trained);
      } catch (err) { logger.warn(`loadTrainedKnowledge error: ${err.message}`); }

      // ── 4. v10: Classificação do objetivo comercial ANTES do prompt ─────────
      let commercialResult = null;
      if (this.config.enableCommercialIntelligence) {
        try {
          commercialResult = this.commercialEngine.classify(
            message,
            intentResult,
            conversationContext
          );
          logger.debug(`[Orchestrator] commercialGoal=${commercialResult.goal} (${(commercialResult.confidence * 100).toFixed(0)}%)`);
        } catch (err) { logger.warn(`CommercialEngine error: ${err.message}`); }
      }

      const responseGoal = commercialResult?.goal || 'responder_duvida';
      const behavioralDirective = commercialResult
        ? this.commercialEngine.getBehavioralDirective(responseGoal, context.language || 'pt-BR')
        : null;

      // ── 4b. v10.2: StrategySelector — escolhe melhor estratégia por histórico ─
      let strategy = null;
      if (this.config.enableAutoLearning) {
        try {
          strategy = this.strategySelector.select({
            chatId,
            clientStage:  conversationContext.clientStage,
            responseGoal,
            intent:       intentResult.intent,
          });
          logger.debug(`[Orchestrator] strategy=${JSON.stringify(strategy)}`);
        } catch (err) { logger.warn(`StrategySelector error: ${err.message}`); }
      }

      // ── 5. v10.1: Micro-adaptação comportamental ────────────────────────────
      let behaviorProfile = null;
      if (this.config.enableBehaviorAdapter) {
        try {
          behaviorProfile = this.behaviorAdapter.analyze(
            message,
            intentResult,
            commercialResult || {},
            conversationContext
          );
          logger.debug(`[Orchestrator] behavior: stage=${behaviorProfile.stageLabel} style=${behaviorProfile.clientStyle} energy=${behaviorProfile.energyLevel} closing=${behaviorProfile.isClosingMoment}`);
        } catch (err) { logger.warn(`ClientBehaviorAdapter error: ${err.message}`); }
      }

      // ── 6. Few-shot examples (P3) ───────────────────────────────────────────
      let fewShotExamples = [];
      try {
        fewShotExamples = this.learningPipeline.getTopGraduated(intentResult.intent, 3);
      } catch (err) { logger.warn(`getTopGraduated error: ${err.message}`); }

      // ── 6. Build do prompt dinâmico (agora com behavioralDirective + responseGoal) ─
      let dynamicPrompt = null;
      try {
        const promptResult = this.promptBuilder.build({
          intent: intentResult.intent,
          confidence: intentResult.confidence,
          memory: conversationContext,
          knowledge: knowledgeResults,
          emotionalContext: context.emotionalContext,
          fewShotExamples,
          businessRules: [
            ...(context.businessRules || []),
            // v10.2: injeta instrução de estratégia como business rule de alta prioridade
            ...(strategy ? [this.strategySelector.toPromptInstruction(strategy)] : []),
          ],
          language: context.language || 'pt-BR',
          behavioralDirective,   // v10
          responseGoal,          // v10
          behaviorProfile,       // v10.1
        });
        dynamicPrompt = promptResult && promptResult.prompt ? promptResult.prompt : promptResult;
      } catch (err) { logger.warn(`DynamicPromptBuilder error: ${err.message}`); }

      // ── 7. A/B testing variant ──────────────────────────────────────────────
      let responseVariant = 'default';
      if (this.config.enableABTesting && intentResult.intent) {
        const experimentId = `intent_${intentResult.intent}`;
        try {
          if (!this.abTester.experiments.has(experimentId)) {
            this.abTester.createExperiment(experimentId, ['default', 'variant_a', 'variant_b'], { minSamples: 50 });
          }
          responseVariant = this.abTester.selectVariant(experimentId);
        } catch (err) { logger.warn(`A/B testing error: ${err.message}`); }
      }

      // ── 8. Geração de resposta com ciclo de qualidade (v10) ─────────────────
      let response = await this._generateResponse(
        message, intentResult, conversationContext, responseVariant, knowledgeResults, dynamicPrompt
      );

      let qualityResult = null;
      if (this.config.enableQualityChecker) {
        qualityResult = await this._runQualityCycle(
          response, message, responseGoal, knowledgeResults,
          intentResult, conversationContext, responseVariant, dynamicPrompt
        );
        response = qualityResult.finalResponse;
      }

      // ── 9. Safety filter ────────────────────────────────────────────────────
      let safetyResult = null;
      if (this.config.enableSafety) {
        safetyResult = this.safetyFilter.validate(response, {
          intent: intentResult.intent,
          emotionalContext: context.emotionalContext,
          knownEntities: context.knownEntities
        });
        if (!safetyResult.safe) {
          logger.warn(`Unsafe response blocked for chat ${chatId}`);
          response = 'Desculpe, não posso processar essa solicitação no momento. Como posso ajudar de outra forma?';
        } else if (safetyResult.modifiedResponse !== response) {
          response = safetyResult.modifiedResponse;
        }
      }

      // ── 10. Persistir mensagens ─────────────────────────────────────────────
      await this.conversationMemory.addMessage(chatId, { role: 'user', content: message, timestamp: new Date() });
      await this.conversationMemory.addMessage(chatId, {
        role: 'assistant', content: response, timestamp: new Date(),
        metadata: { intent: intentResult.intent, confidence: intentResult.confidence, variant: responseVariant }
      });

      // ── 11. v10: Atualizar inteligência comercial do cliente ────────────────
      if (this.config.enableCommercialIntelligence) {
        try {
          this.conversationMemory.updateClientIntelligence(chatId, {
            intent: intentResult.intent,
            confidence: intentResult.confidence,
            responseGoal,
          });
        } catch (err) { logger.warn(`updateClientIntelligence error: ${err.message}`); }
      }

      // ── 12. Analytics ───────────────────────────────────────────────────────
      const latency = Date.now() - startTime;
      let interactionId = null;
      if (this.config.enableAnalytics) {
        interactionId = this.analytics.recordInteraction({
          chatId, message, intent: intentResult.intent, confidence: intentResult.confidence,
          response, latency, tokenCount: this._estimateTokens(message + response),
          metadata: {
            variant: responseVariant,
            safetyChecked: !!safetyResult,
            tenantId: this.tenantId,
            responseGoal,
            qualityScore: qualityResult?.score ?? null,
            qualityRetries: qualityResult?.retries ?? 0,
            clientStage: conversationContext.clientStage,
            strategySource: strategy?.source ?? null,
          }
        });
      }

      // CORREÇÃO P0: Persistir metadados da interação para o feedback loop funcionar
      if (interactionId) {
        // Eviction simples quando atinge limite de tamanho
        if (this._interactionMetadataStore.size >= this._interactionMetadataMaxSize) {
          const oldestKey = this._interactionMetadataStore.keys().next().value;
          this._interactionMetadataStore.delete(oldestKey);
        }
        this._interactionMetadataStore.set(interactionId, {
          intent: intentResult.intent,
          question: message,
          response,
          responseGoal,
          clientStage: conversationContext.clientStage,
          variant: responseVariant,
        });

        // Também persistir no banco para sobreviver a restarts
        try {
          const db = require('../utils/database');
          // FIX: schema exige intent NOT NULL. Se classifier não classificou,
          // fallback pra 'unknown' em vez de null (que faz INSERT falhar silenciosamente
          // e quebra o feedback loop sem sintoma visível).
          const safeIntent   = intentResult.intent   || 'unknown';
          const safeQuestion = (message ?? '').toString();
          const safeResponse = (response ?? '').toString();
          db.run(
            `INSERT OR REPLACE INTO interaction_metadata
             (interaction_id, workspace_id, chat_id, intent, question, response, response_goal, client_stage, variant)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [interactionId, this.tenantId, chatId, safeIntent, safeQuestion, safeResponse,
             responseGoal || null, conversationContext.clientStage || null, responseVariant || null]
          );
        } catch (dbErr) {
          // Eleva pra error (não warn) — falha aqui = feedback loop quebrado
          logger.error(`[Orchestrator] Falha ao persistir interaction_metadata: ${dbErr.message}`, dbErr);
        }
      }

      // ── 12b. v10.2: AutoLearningLoop — registrar envio para tracking de outcome ──
      if (this.config.enableAutoLearning && interactionId) {
        try {
          this.autoLearningLoop.trackSent(
            { interactionId, chatId, response, message,
              metadata: {
                responseGoal, clientStage: conversationContext.clientStage,
                intent: intentResult.intent, variant: responseVariant,
                qualityScore: qualityResult?.score ?? null,
              }
            },
            strategy
          );
        } catch (err) { logger.warn(`AutoLearningLoop.trackSent error: ${err.message}`); }
      }

      // FIX: tracer agora é finalizado corretamente com status real
      try { await tracer?.finish('success'); } catch (_) { /* tracer não deve quebrar resposta */ }

      return {
        success: true,
        response,
        metadata: {
          intent: intentResult.intent, confidence: intentResult.confidence, latency,
          variant: responseVariant, interactionId,
          safetyIssues: safetyResult?.issues || [],
          knowledgeResultsCount: knowledgeResults.length,
          fewShotExamplesUsed: fewShotExamples.length,
          dynamicPromptUsed: !!dynamicPrompt,
          tenantId: this.tenantId,
          // v10 additions
          responseGoal,
          commercialConfidence: commercialResult?.confidence ?? null,
          qualityScore: qualityResult?.score ?? null,
          qualityRetries: qualityResult?.retries ?? 0,
          clientStage: conversationContext.clientStage,
          // v10.1 behavior adapter fields
          clientStyle: behaviorProfile?.clientStyle ?? null,
          energyLevel: behaviorProfile?.energyLevel ?? null,
          isClosingMoment: behaviorProfile?.isClosingMoment ?? false,
          // v10.2 auto-learning fields
          strategySource: strategy?.source ?? null,
          strategyUsed: strategy ? {
            ctaStyle: strategy.ctaStyle,
            responseLength: strategy.responseLength,
            comercialAggression: strategy.comercialAggression,
          } : null,
          timestamp: new Date()
        }
      };

    } catch (error) {
      logger.error(`Error processing message for chat ${chatId} (tenant: ${this.tenantId}): ${error.message}`);
      try { await tracer?.finish('error', { error: error.message }); } catch (_) {}
      return {
        success: false,
        response: 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.',
        error: error.message,
        metadata: { latency: Date.now() - startTime, timestamp: new Date() }
      };
    }
  }

  /**
   * v10: Executa o ciclo de qualidade com até `maxQualityRetries` regenerações.
   * Avalia a resposta, e se falhar injeta reforço no prompt e regenera.
   * @private
   */
  async _runQualityCycle(
    initialResponse, message, responseGoal, knowledgeResults,
    intentResult, conversationContext, responseVariant, dynamicPrompt
  ) {
    let response = initialResponse;
    let retries = 0;
    let lastQuality = null;

    for (let attempt = 0; attempt <= this.config.maxQualityRetries; attempt++) {
      const quality = this.qualityChecker.evaluate(response, {
        message,
        goal: responseGoal,
        knowledge: knowledgeResults,
      });

      lastQuality = quality;

      if (quality.passed) {
        logger.debug(`[QualityChecker] PASSED on attempt ${attempt} (score=${quality.score})`);
        break;
      }

      if (attempt >= this.config.maxQualityRetries) {
        logger.warn(`[QualityChecker] FAILED after ${attempt} retries. Issues: ${quality.issues.join(', ')}`);
        break;
      }

      // ── Regenerar com instrução de reforço injetada ─────────────────────
      retries++;
      logger.debug(`[QualityChecker] Retry ${retries}. Issues: ${quality.issues.join(', ')}`);

      const reinforcedPrompt = dynamicPrompt
        ? `${dynamicPrompt}\n\n${quality.reinforcement}`
        : quality.reinforcement;

      response = await this._generateResponse(
        message, intentResult, conversationContext, responseVariant,
        knowledgeResults, reinforcedPrompt
      );
    }

    return {
      finalResponse: response,
      score: lastQuality?.score ?? 100,
      issues: lastQuality?.issues ?? [],
      retries,
    };
  }

  /**
   * P1: Real LLM call via AIRouterService.
   * The hardcoded stub was replaced entirely.
   * @private
   */
  async _generateResponse(message, intentResult, conversationContext, variant, knowledgeResults = [], dynamicPrompt = null) {
    const systemContent = dynamicPrompt ||
      'Você é um assistente de atendimento profissional. Responda de forma clara, útil e educada.';

    const historyMessages = (conversationContext.recentMessages || [])
      .slice(-this.config.maxHistoryMessages)
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    const messages = [
      { role: 'system', content: systemContent },
      ...historyMessages,
      { role: 'user', content: message }
    ];

    let content;
    try {
      const result = await this.aiRouter.complete(messages, {
        maxTokens: this.config.maxResponseTokens,
        temperature: 0.7,
        tenantId: this.tenantId, // FIX: isola cache do AIRouter por tenant
      });
      content = result.content || result.text || result.message || '';
    } catch (routerErr) {
      logger.error(`AIRouterService failed: ${routerErr.message}`);
      // Graceful degradation: top knowledge result if available
      if (knowledgeResults.length > 0 && knowledgeResults[0]?.content) {
        content = String(knowledgeResults[0].content).replace(/<[^>]*>/g, '').trim();
      } else {
        content = 'Desculpe, não consegui processar sua mensagem agora. Tente novamente em instantes.';
      }
    }

    // CORREÇÃO P2: A/B testing real — estratégias diferentes, não emojis decorativos
    // variant_a: resposta mais concisa e direta (estilo assertivo)
    // variant_b: resposta mais consultiva com pergunta de qualificação no final
    // O PerformanceScoreEngine fecha o loop estatístico medindo outcomes reais
    if (variant === 'variant_a') {
      // Estratégia A: direto ao ponto — remove introduções prolixas
      content = content.replace(/^(Olá!?\s*|Oi!?\s*|Claro[,!]?\s*|Com prazer[,!]?\s*)/i, '').trim();
    } else if (variant === 'variant_b') {
      // Estratégia B: consultiva — adiciona pergunta de qualificação se não houver uma
      if (!content.includes('?')) {
        content = content + ' Posso te ajudar com mais alguma informação?';
      }
    }

    return content;
  }

  recordFeedback(interactionId, feedback) {
    if (this.config.enableAnalytics) this.analytics.updateFeedback(interactionId, feedback);

    // CORREÇÃO P0: Recuperar metadados da interação e chamar recordInteraction com TODOS os campos obrigatórios
    const meta = this._interactionMetadataStore.get(interactionId)
      || this._loadInteractionMetadataFromDB(interactionId);

    if (meta && this.learningPipeline.recordInteraction) {
      // FIX FATAL v8.0.5: aprendizado JAMAIS funcionou.
      // AIOrchestrator mandava feedback como número (0, 0.5, 1).
      // ValidatedLearningPipeline.recordInteraction valida que feedback seja
      // string ('positive', 'negative', 'neutral', 'edited', 'converted') e lança
      // exception se não bate. O .catch abaixo silenciava tudo. Resultado:
      // NENHUMA interação foi registrada para aprendizado em toda a história
      // do produto. Esse é o bug que fazia o usuário sentir "a IA não aprende".
      // Agora passamos a string original (não convertemos para número).
      this.learningPipeline.recordInteraction({
        intent:    meta.intent,
        question:  meta.question,
        response:  meta.response,
        feedback,  // string: 'positive' | 'negative' | 'neutral' | 'edited' | 'converted'
      }).catch(err => logger.warn(`[Orchestrator] learningPipeline.recordInteraction error: ${err.message}`));

      // Também persistir no StrategySelector e PerformanceScoreEngine via banco
      this._persistStrategyFeedback(interactionId, meta, feedback);
    } else {
      logger.warn(`[Orchestrator] recordFeedback: metadados não encontrados para interactionId=${interactionId}`);
    }

    logger.debug(`Recorded feedback for ${interactionId}: ${feedback}`);
  }

  /** Carrega metadados de interação do banco (para feedback após restart) */
  _loadInteractionMetadataFromDB(interactionId) {
    try {
      const db = require('../utils/database');
      // v9.3.5: filtra workspace_id pra defesa em profundidade.
      // interactionId é UUID server-side mas sem o filtro um bug futuro
      // poderia vazar metadados entre tenants se o orquestrador errado
      // chamasse este método (ex: workspaceId diferente de this.tenantId).
      const row = db.get(
        'SELECT * FROM interaction_metadata WHERE interaction_id = ? AND workspace_id = ?',
        [interactionId, this.tenantId]
      );
      if (row) {
        // FIX FATAL: linha 531 tinha `await tracer?.finish('success')` órfão
        // — `tracer` não existia neste escopo
        // — `await` em método síncrono é SyntaxError em strict mode
        // — código foi colado por engano do processMessage
        return { intent: row.intent, question: row.question, response: row.response,
                 responseGoal: row.response_goal, clientStage: row.client_stage, variant: row.variant };
      }
    } catch (err) {
      logger.warn(`[Orchestrator] _loadInteractionMetadataFromDB error: ${err.message}`);
    }
    return null;
  }

  /** Persiste feedback de estratégia no banco e fecha o loop do A/B tester */
  _persistStrategyFeedback(interactionId, meta, feedback) {
    try {
      const db = require('../utils/database');
      const score = feedback === 'positive' ? 1.0 : feedback === 'negative' ? 0.0 : 0.5;
      db.run(
        `INSERT INTO strategy_history
         (workspace_id, chat_id, response_goal, client_stage, intent, outcome_label, performance_score)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [this.tenantId, '', meta.responseGoal || null, meta.clientStage || null,
         meta.intent, feedback, score]
      );
    } catch (err) {
      logger.warn(`[Orchestrator] _persistStrategyFeedback error: ${err.message}`);
    }

    // CORREÇÃO P2: Fechar loop estatístico do A/B tester com PerformanceScoreEngine
    // Conecta o feedback real ao experimento de A/B testing (Thompson Sampling)
    try {
      if (this.abTester && meta.variant && meta.variant !== 'default') {
        const experimentId = `response_strategy_${this.tenantId}`;
        if (this.abTester.experiments.has(experimentId)) {
          const isSuccess = feedback === 'positive' || feedback === 'converted';
          this.abTester.recordResult(experimentId, meta.variant, isSuccess);
          logger.debug(`[Orchestrator] A/B result recorded: ${meta.variant} → ${isSuccess ? 'success' : 'failure'}`);
        }
      }
    } catch (err) {
      logger.warn(`[Orchestrator] abTester.recordResult error: ${err.message}`);
    }

    // Registrar score no PerformanceScoreEngine com namespace de tenant
    // FIX HIGH: a propriedade real é `this.scoreEngine` (linha 75), não `this.performanceScoreEngine`.
    // Bug fazia o `if` ser sempre falso → score nunca era persistido via feedback.
    try {
      if (this.scoreEngine && meta.variant) {
        this.scoreEngine._persistScoreToDB('variant', meta.variant,
          feedback === 'positive' ? 1.0 : feedback === 'negative' ? 0.0 : 0.5, {});
      }
    } catch (err) {
      logger.warn(`[Orchestrator] scoreEngine persist error: ${err.message}`);
    }
  }

  getAnalyticsSummary() {
    return this.config.enableAnalytics ? this.analytics.getMetricsSummary() : { enabled: false };
  }

  generateWeeklyReport() {
    return this.config.enableAnalytics ? this.analytics.generateWeeklyReport() : { enabled: false };
  }

  /** v10: Returns commercial intelligence statistics */
  getCommercialStats() {
    return this.commercialEngine.getStats();
  }

  /** v10: Returns quality checker statistics */
  getQualityStats() {
    return this.qualityChecker.getStats();
  }

  /** v10.1: Returns client behavior adapter statistics */
  getBehaviorStats() {
    return this.behaviorAdapter.getStats();
  }

  /**
   * v10.2: Notifica o sistema que o cliente enviou uma mensagem.
   * Deve ser chamado pelo message-capture ao receber qualquer msg de cliente.
   * Fecha o ciclo de aprendizado ao correlacionar com outcomes pendentes.
   *
   * @param {string} chatId
   * @param {string} messageText
   */
  onClientMessage(chatId, messageText) {
    if (this.config.enableAutoLearning) {
      try { this.autoLearningLoop.onClientMessage(chatId, messageText); }
      catch (err) { logger.warn(`onClientMessage error: ${err.message}`); }
    }
  }

  /** v10.2: Registra conversão manual via CRM ou interface */
  recordManualConversion(interactionId) {
    return this.autoLearningLoop?.recordManualConversion(interactionId) ?? false;
  }

  /** v10.2: Stats do ciclo completo de auto-aprendizado */
  getAutoLearningStats() {
    return {
      loop:     this.autoLearningLoop?.getStats()    ?? null,
      outcome:  this.outcomeTracker?.getStats()      ?? null,
      score:    this.scoreEngine?.getStats()         ?? null,
      strategy: this.strategySelector?.getStats()    ?? null,
      goalMetrics: this.outcomeTracker?.getGoalMetrics() ?? null,
      goalScores:  this.scoreEngine?.getGoalScores()     ?? null,
      bestPerformers: this.scoreEngine?.getBestPerformers() ?? null,
    };
  }

  _estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  /**
   * v9.7.x — Busca conhecimento treinado (FAQs / produtos / business info)
   * direto das tabelas do workspace e devolve no shape que o DynamicPromptBuilder
   * espera ({ content, source, score }).
   *
   * Por que não usar HybridSearch? Porque ele é um índice in-memory que precisaria
   * ser populado/sincronizado a cada sync de treinamento — e não é. Adicionar essa
   * sincronia seria um sistema secundário (embeddings, persistência do índice).
   * Aqui resolvemos o caminho crítico com SQL puro: keyword match LIKE com
   * scoring por token-overlap. Funciona pra catálogos < 10k registros, que é o
   * universo de SaaS B2B small/mid.
   *
   * Fonte de prioridade (em ordem decrescente):
   *  1. FAQs com match direto na pergunta → score alto
   *  2. Produtos com match no nome/descrição → score médio
   *  3. Business info (horário, política, instruções custom) → sempre inclui
   *     porque é contexto base (não depende de match)
   *
   * @private
   */
  _loadTrainedKnowledge(message, maxItems = 6) {
    const out = [];
    let db;
    try { db = require('../utils/database'); } catch (_) { return out; }
    if (!db || !this.tenantId || this.tenantId === 'default') return out;

    const text = String(message || '').toLowerCase().trim();
    if (!text) return out;

    // Tokenização leve: palavras > 3 chars, top 6 (filtra stopwords pt-BR comuns)
    const STOPWORDS = new Set([
      'para','como','quando','onde','qual','quais','aquele','aquela','isso','esse',
      'essa','este','esta','muito','pouco','também','tambem','minha','meu','seus',
      'suas','vocês','voces','você','voce','tudo','nada','quem','porque','mais',
      'pelo','pela','dos','das','uma','umas','uns','sem','sob','sobre','entre'
    ]);
    const tokens = Array.from(new Set(
      text.split(/[^a-záàâãéêíóôõúç0-9]+/i)
          .filter(t => t.length >= 4 && !STOPWORDS.has(t))
    )).slice(0, 6);

    // Helper de score por overlap de tokens
    const scoreOf = (haystack) => {
      const h = String(haystack || '').toLowerCase();
      let hits = 0;
      for (const t of tokens) if (h.includes(t)) hits++;
      return tokens.length ? hits / tokens.length : 0;
    };

    // ── FAQs ────────────────────────────────────────────────────────
    try {
      const faqs = db.all(
        `SELECT question, answer, category
           FROM faqs
          WHERE workspace_id = ? AND is_active = 1
          ORDER BY updated_at DESC
          LIMIT 50`,
        [this.tenantId]
      ) || [];

      const scored = faqs
        .map(f => ({
          content: `Pergunta: ${f.question}\nResposta: ${f.answer}`,
          source: `FAQ${f.category ? ` / ${f.category}` : ''}`,
          score: Math.max(scoreOf(f.question) * 1.5, scoreOf(f.answer) * 0.8),
        }))
        .filter(x => x.score >= 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      out.push(...scored);
    } catch (e) { logger.debug?.(`[Orchestrator] FAQ query failed: ${e.message}`); }

    // ── Products ────────────────────────────────────────────────────
    try {
      const products = db.all(
        `SELECT name, description, short_description, sku, category, price, currency, stock_status
           FROM products
          WHERE workspace_id = ? AND is_active = 1
          ORDER BY updated_at DESC
          LIMIT 100`,
        [this.tenantId]
      ) || [];

      const scored = products
        .map(p => {
          const blob = `${p.name} ${p.short_description || ''} ${p.description || ''} ${p.category || ''} ${p.sku || ''}`;
          return {
            content: `Produto: ${p.name}` +
                     (p.sku ? ` (SKU ${p.sku})` : '') +
                     (Number.isFinite(p.price) && p.price > 0
                        ? ` — ${p.currency || 'BRL'} ${Number(p.price).toFixed(2)}`
                        : '') +
                     (p.short_description ? `\nResumo: ${p.short_description}` : '') +
                     (p.description ? `\nDescrição: ${String(p.description).slice(0, 600)}` : '') +
                     (p.stock_status ? `\nDisponibilidade: ${p.stock_status}` : ''),
            source: `Catálogo${p.category ? ` / ${p.category}` : ''}`,
            score: scoreOf(blob),
          };
        })
        .filter(x => x.score >= 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);
      out.push(...scored);
    } catch (e) { logger.debug?.(`[Orchestrator] Product query failed: ${e.message}`); }

    // ── Business Info (sempre inclui se existir — é contexto base) ──
    try {
      const wk = db.get(
        'SELECT data FROM workspace_knowledge WHERE workspace_id = ?',
        [this.tenantId]
      );
      if (wk?.data) {
        const bi = JSON.parse(wk.data);
        const lines = [];
        if (bi.name)               lines.push(`Empresa: ${bi.name}`);
        if (bi.segment)            lines.push(`Segmento: ${bi.segment}`);
        if (bi.description)        lines.push(`Sobre: ${String(bi.description).slice(0, 400)}`);
        if (bi.hours)              lines.push(`Horário de atendimento: ${bi.hours}`);
        if (bi.responseTime)       lines.push(`Tempo de resposta: ${bi.responseTime}`);
        if (bi.phone)              lines.push(`Telefone: ${bi.phone}`);
        if (bi.email)              lines.push(`Email: ${bi.email}`);
        if (Array.isArray(bi.paymentMethods) && bi.paymentMethods.length) {
          lines.push(`Formas de pagamento: ${bi.paymentMethods.join(', ')}`);
        }
        if (bi.deliveryPolicy)     lines.push(`Política de entrega: ${String(bi.deliveryPolicy).slice(0, 400)}`);
        if (bi.freeShipping)       lines.push(`Frete grátis: ${bi.freeShipping}`);
        if (bi.returnPolicy)       lines.push(`Política de troca: ${String(bi.returnPolicy).slice(0, 400)}`);
        if (bi.customInstructions) lines.push(`Instruções da empresa: ${String(bi.customInstructions).slice(0, 800)}`);

        if (lines.length) {
          out.push({
            content: lines.join('\n'),
            source: 'Informações do Negócio',
            // score alto fixo — sempre relevante como contexto base
            score: 0.95,
          });
        }
      }
    } catch (e) { logger.debug?.(`[Orchestrator] BusinessInfo load failed: ${e.message}`); }

    // Limita ao topN final mantendo a ordenação por score
    return out
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems);
  }
}

module.exports = AIOrchestrator;
