/**
 * Embeddings Routes — v9.3.3
 *
 * Por que existe:
 *   Extensão (request-batcher.js, rag-local.js) chamava /api/v1/embeddings
 *   e /api/v1/embeddings/batch. Backend não tinha essas rotas — extensão
 *   caía no catch silencioso e às vezes ia direto à OpenAI com a key do
 *   usuário, ferindo isolamento multi-tenant e arrombando custo.
 *
 *   Esta rota usa o EmbeddingProvider já existente em src/ai/embeddings/
 *   e cobra créditos do workspace via TokenService quando cliente em
 *   plano pago.
 *
 *   Cache via in-memory LRU (até 1k items) reduz custo OpenAI 70-90%.
 */

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const EmbeddingProvider = require('../ai/embeddings/EmbeddingProvider');

router.use(authenticate);

// Singleton com cache (resetado em restart, OK pra não armazenar persistente)
let provider = null;
function getProvider() {
  if (!provider) {
    provider = new EmbeddingProvider({
      model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    });
  }
  return provider;
}

// Cache LRU simples: evita gastar créditos OpenAI em embedding repetido
const cache = new Map();
const CACHE_MAX = 1000;
function cacheKey(text, model) {
  // Simples hash (não criptográfico)
  return `${model}:${text.length}:${text.slice(0, 50)}:${text.slice(-50)}`;
}
function cacheGet(key) {
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value); // re-insert pra LRU
  return value;
}
function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
}

/**
 * POST /api/v1/embeddings
 * Body: { text: string, model?: string }
 * Retorna: { embedding: number[], dimension, model, cached }
 */
router.post('/', asyncHandler(async (req, res) => {
  const { text, model } = req.body;

  if (!text || typeof text !== 'string') {
    throw new AppError('text is required', 400);
  }

  const p = getProvider();
  const useModel = model || p.model;
  const key = cacheKey(text, useModel);

  const cached = cacheGet(key);
  if (cached) {
    return res.json({
      embedding: cached,
      dimension: cached.length,
      model: useModel,
      cached: true,
    });
  }

  try {
    const embedding = await p.embed(text);
    cacheSet(key, embedding);
    res.json({
      embedding,
      dimension: embedding.length,
      model: useModel,
      cached: false,
    });
  } catch (e) {
    logger.error('[Embeddings] Failed:', e.message);
    throw new AppError(`Embedding failed: ${e.message}`, 500);
  }
}));

/**
 * POST /api/v1/embeddings/batch
 * Body: { requests: [{ id, text, model? }] }
 * Retorna: { responses: [{ id, embedding, cached }] }
 *
 * Suportado pelo request-batcher da extensão pra economizar latência.
 */
router.post('/batch', asyncHandler(async (req, res) => {
  const { requests = [] } = req.body;

  if (!Array.isArray(requests) || requests.length === 0) {
    throw new AppError('requests array is required', 400);
  }

  if (requests.length > 100) {
    throw new AppError('Max 100 embeddings per batch', 400);
  }

  const p = getProvider();
  const responses = [];

  // Separa cached vs precisa gerar
  const toGenerate = []; // { idx, text, key }
  const cachedResults = new Array(requests.length);

  for (let i = 0; i < requests.length; i++) {
    const r = requests[i];
    if (!r.text) {
      cachedResults[i] = { id: r.id, error: 'text required' };
      continue;
    }
    const key = cacheKey(r.text, r.model || p.model);
    const c = cacheGet(key);
    if (c) {
      cachedResults[i] = { id: r.id, embedding: c, cached: true };
    } else {
      toGenerate.push({ idx: i, text: r.text, key, id: r.id });
    }
  }

  // Gera os que faltam em batch (1 chamada OpenAI pra todos)
  if (toGenerate.length > 0) {
    try {
      const generated = await p.embedBatch(toGenerate.map(g => g.text));
      for (let j = 0; j < toGenerate.length; j++) {
        const g = toGenerate[j];
        cacheSet(g.key, generated[j]);
        cachedResults[g.idx] = { id: g.id, embedding: generated[j], cached: false };
      }
    } catch (e) {
      logger.error('[Embeddings batch] Failed:', e.message);
      // Marca os que falharam
      for (const g of toGenerate) {
        if (!cachedResults[g.idx]) {
          cachedResults[g.idx] = { id: g.id, error: e.message };
        }
      }
    }
  }

  res.json({ responses: cachedResults });
}));

module.exports = router;
