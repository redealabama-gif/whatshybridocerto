/**
 * AI Worker — Fila assíncrona BullMQ + Redis
 *
 * CORREÇÃO P1: Substituí requisições síncronas de LLM (bloqueavam o event loop)
 * por fila dedicada com workers e controle de concorrência por tenant.
 *
 * Filas separadas:
 *  - ai:realtime   → respostas em tempo real (alta prioridade, concorrência 10)
 *  - ai:batch      → campanhas em lote (baixa prioridade, concorrência 3)
 *  - ai:embeddings → indexação de embeddings (fundo, concorrência 2)
 *  - ai:learning   → jobs de aprendizado (fundo, concorrência 2)
 */

'use strict';

const logger = require('../utils/logger');

// Verifica se BullMQ está disponível (opcional em dev sem Redis)
let Queue, Worker, QueueEvents;
try {
  ({ Queue, Worker, QueueEvents } = require('bullmq'));
} catch (e) {
  logger.warn('[AIWorker] BullMQ não disponível. Instale: npm install bullmq');
  // CORREÇÃO: este arquivo também é REQUERIDO pela rota /api/v2/ai/process.
  // Um process.exit() aqui derrubaria o WEB SERVER inteiro no primeiro request
  // de IA caso bullmq faltasse. Só encerramos quando rodando como processo
  // dedicado (node src/jobs/ai-worker.js). Quando requerido, propagamos o erro
  // — a rota tem try/catch + fallback síncrono.
  if (require.main === module) {
    process.exit(0);
  }
  throw e;
}

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY, 10) || 5;

const connection = {
  host: new URL(REDIS_URL).hostname,
  port: parseInt(new URL(REDIS_URL).port, 10) || 6379,
};

// ── Definição das filas ───────────────────────────────────────────────────────
// IMPORTANTE: nomes de fila NÃO podem conter ':' — o BullMQ 5.x lança
// "Queue name cannot contain :" no construtor (o ':' é reservado pros prefixos
// internos de chave no Redis). Os nomes antigos eram 'ai:realtime' etc., o que
// fazia o worker dedicado crash-loopar no boot E o web server cair no fallback
// síncrono (executando LLM no event loop). Usamos '-' como separador.
const QUEUES = {
  REALTIME:   'ai-realtime',
  BATCH:      'ai-batch',
  EMBEDDINGS: 'ai-embeddings',
  LEARNING:   'ai-learning',
};

// Configurações por fila
const QUEUE_CONFIG = {
  [QUEUES.REALTIME]:   { concurrency: Math.min(WORKER_CONCURRENCY, 10), priority: 1 },
  [QUEUES.BATCH]:      { concurrency: 3,  priority: 3 },
  [QUEUES.EMBEDDINGS]: { concurrency: 2,  priority: 5 },
  [QUEUES.LEARNING]:   { concurrency: 2,  priority: 5 },
};

const defaultJobOptions = {
  removeOnComplete: { count: 100 },
  removeOnFail:     { count: 50 },
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
};

// ── Instanciar filas (exportadas para uso nas rotas) ──────────────────────────
const queues = {};
for (const [, qName] of Object.entries(QUEUES)) {
  queues[qName] = new Queue(qName, { connection, defaultJobOptions });
}

// ── QueueEvents COMPARTILHADOS (uma instância por fila, criadas uma vez) ──────
// CORREÇÃO CRÍTICA DE ESCALA: a rota /api/v2/ai/process chamava
// `new QueueEvents(...)` a CADA request quando o web server processa IA.
// Cada QueueEvents abre uma conexão Redis dedicada (blocking BRPOPLPUSH) que
// NUNCA era fechada — vazamento de conexões. Sob vários clientes simultâneos,
// o Redis estoura `maxclients`, novas conexões são recusadas, e TODA a IA
// (e o rate-limiting que também usa Redis) começa a falhar em cascata.
// Aqui criamos UMA instância por fila, reusada por todos os requests.
const queueEvents = {};
for (const [, qName] of Object.entries(QUEUES)) {
  queueEvents[qName] = new QueueEvents(qName, { connection });
}

// ── Processor: ai:realtime ────────────────────────────────────────────────────
async function processRealtimeJob(job) {
  const { tenantId, chatId, message, language, businessRules, persona, workspaceConfig } = job.data;

  const orchestratorRegistry = require('../registry/OrchestratorRegistry');
  const orchestrator = orchestratorRegistry.get(tenantId, workspaceConfig || {});

  const startTime = Date.now();
  const result = await orchestrator.processMessage(chatId, message, {
    language: language || 'pt-BR',
    businessRules: businessRules || [],
    persona: persona || null,
  });

  // Métrica de observabilidade (P2)
  try {
    const db = require('../utils/database');
    db.run(
      `INSERT INTO ai_requests (workspace_id, model, tokens_used, response_time, pipeline_stage, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tenantId, result.metadata?.model || 'unknown', result.metadata?.tokenCount || 0,
       Date.now() - startTime, 'realtime', 'success']
    );
  } catch (_) {}

  return result;
}

// ── Processor: ai:batch ───────────────────────────────────────────────────────
async function processBatchJob(job) {
  const { tenantId, contacts, messageTemplate, workspaceConfig } = job.data;
  const results = [];

  for (const contact of contacts) {
    try {
      const orchestratorRegistry = require('../registry/OrchestratorRegistry');
      const orchestrator = orchestratorRegistry.get(tenantId, workspaceConfig || {});
      const msg = messageTemplate.replace(/\{\{name\}\}/gi, contact.name || '');
      const result = await orchestrator.processMessage(contact.chatId, msg, { language: 'pt-BR' });
      results.push({ contactId: contact.id, success: true, response: result.response });

      // Delay entre mensagens de campanha (anti-ban)
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
      await job.updateProgress(Math.round((results.length / contacts.length) * 100));
    } catch (err) {
      results.push({ contactId: contact.id, success: false, error: err.message });
    }
  }

  return { processed: results.length, results };
}

// ── Processor: ai:embeddings ──────────────────────────────────────────────────
async function processEmbeddingsJob(job) {
  const { tenantId, documents } = job.data;
  let indexed = 0;

  for (const doc of documents) {
    try {
      const HybridSearch = require('../ai/search/HybridSearch');
      const search = new HybridSearch({ tenantId });
      await search.indexDocument(doc);
      indexed++;
      await job.updateProgress(Math.round((indexed / documents.length) * 100));
    } catch (err) {
      logger.warn(`[EmbeddingsWorker] Failed to index doc ${doc.id}:`, err.message);
    }
  }

  return { indexed, total: documents.length };
}

// ── Processor: ai:learning ────────────────────────────────────────────────────
async function processLearningJob(job) {
  const { tenantId, interactionId, feedback, metadata } = job.data;
  const orchestratorRegistry = require('../registry/OrchestratorRegistry');
  const orchestrator = orchestratorRegistry.get(tenantId);

  // Injetar metadados diretamente no store antes de chamar recordFeedback
  if (metadata && interactionId) {
    orchestrator._interactionMetadataStore.set(interactionId, metadata);
  }
  await orchestrator.recordFeedback(interactionId, feedback);
  return { processed: true };
}

// ── Iniciar workers ────────────────────────────────────────────────────────────
const processors = {
  [QUEUES.REALTIME]:   processRealtimeJob,
  [QUEUES.BATCH]:      processBatchJob,
  [QUEUES.EMBEDDINGS]: processEmbeddingsJob,
  [QUEUES.LEARNING]:   processLearningJob,
};

// CORREÇÃO CRÍTICA DE ARQUITETURA: os Workers só devem rodar no PROCESSO
// DEDICADO (`node src/jobs/ai-worker.js`, container ai-worker do compose).
//
// Antes, qualquer `require('../jobs/ai-worker')` — incluindo o feito pela rota
// /api/v2/ai/process no WEB SERVER pra enfileirar um job — instanciava os
// Workers DENTRO do processo web. Resultado: o web server consumia os próprios
// jobs e executava chamadas de LLM in-process, bloqueando o event loop que
// atende todos os outros clientes. Exatamente o gargalo que a fila deveria
// eliminar. Além disso, registrava handlers SIGTERM/SIGINT que chamavam
// process.exit(0), sequestrando o graceful shutdown do server.js.
//
// Agora: o web server importa só queues + queueEvents (pra enfileirar e
// aguardar). Os Workers e os signal handlers só sobem quando este arquivo é o
// processo principal.
const workers = {};

function startWorkers() {
  for (const [qName, processor] of Object.entries(processors)) {
    const cfg = QUEUE_CONFIG[qName];
    workers[qName] = new Worker(qName, processor, {
      connection,
      concurrency: cfg.concurrency,
      limiter: { max: cfg.concurrency * 2, duration: 1000 },
    });

    workers[qName].on('completed', (job) => {
      logger.debug(`[AIWorker] ${qName} job ${job.id} completed`);
    });
    workers[qName].on('failed', (job, err) => {
      logger.error(`[AIWorker] ${qName} job ${job?.id} failed:`, err.message);
    });
    workers[qName].on('error', (err) => {
      logger.error(`[AIWorker] ${qName} worker error:`, err.message);
    });

    logger.info(`[AIWorker] Worker iniciado: ${qName} (concurrency: ${cfg.concurrency})`);
  }

  logger.info('[AIWorker] ✅ AI Worker iniciado com BullMQ');
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────
async function shutdown() {
  logger.info('[AIWorker] Encerrando workers...');
  await Promise.all(Object.values(workers).map(w => w.close()));
  await Promise.all(Object.values(queueEvents).map(qe => qe.close()));
  await Promise.all(Object.values(queues).map(q => q.close()));
  process.exit(0);
}

if (require.main === module) {
  startWorkers();
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}

// Exportar filas + QueueEvents compartilhados para uso nas rotas HTTP.
// `startWorkers` exportado pra cobertura de testes / uso programático.
module.exports = { queues, queueEvents, QUEUES, startWorkers };
