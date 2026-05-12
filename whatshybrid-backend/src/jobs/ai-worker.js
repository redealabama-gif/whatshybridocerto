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
  process.exit(0);
}

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY, 10) || 5;

const connection = {
  host: new URL(REDIS_URL).hostname,
  port: parseInt(new URL(REDIS_URL).port, 10) || 6379,
};

// ── Definição das filas ───────────────────────────────────────────────────────
const QUEUES = {
  REALTIME:   'ai:realtime',
  BATCH:      'ai:batch',
  EMBEDDINGS: 'ai:embeddings',
  LEARNING:   'ai:learning',
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

// ── Processor: ai:realtime ────────────────────────────────────────────────────
async function processRealtimeJob(job) {
  const { tenantId, chatId, message, language, businessRules, workspaceConfig } = job.data;

  const orchestratorRegistry = require('../registry/OrchestratorRegistry');
  const orchestrator = orchestratorRegistry.get(tenantId, workspaceConfig || {});

  const startTime = Date.now();
  const result = await orchestrator.processMessage(chatId, message, {
    language: language || 'pt-BR',
    businessRules: businessRules || [],
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

const workers = {};
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

// ── Graceful shutdown ──────────────────────────────────────────────────────────
async function shutdown() {
  logger.info('[AIWorker] Encerrando workers...');
  await Promise.all(Object.values(workers).map(w => w.close()));
  await Promise.all(Object.values(queues).map(q => q.close()));
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

logger.info('[AIWorker] ✅ AI Worker iniciado com BullMQ');

// Exportar filas para uso nas rotas HTTP
module.exports = { queues, QUEUES };
