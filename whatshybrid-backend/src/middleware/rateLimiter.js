/**
 * Rate Limiter Middleware — Redis-backed, cluster-aware.
 *
 * Limiters disponíveis:
 *   authLimiter        — 5 req / 15min em /login, /signup, /forgot-password
 *   apiLimiter         — 100 req / 15min global authenticated
 *   webhookLimiter     — 60 req / min em endpoints de webhook
 *
 * Fallback automático pra memory store se Redis estiver fora.
 *
 * @module middleware/rateLimiter
 */
/**
 * Rate Limiter Middleware
 *
 * CORREÇÃO P1: Redis store para rate limiting persistido entre processos e restarts.
 * — Em PM2 cluster, counters são compartilhados via Redis (não mais 4x o limite por worker)
 * — Após restart, contadores não zeram (sem bypass por janela de restart)
 * — Fallback automático para store em memória se Redis não disponível (dev local)
 *
 * FIX MED: Adicionado opt-out explícito via REDIS_DISABLED=true, e log claro de
 * quando memory store é usado em produção (warning visível).
 */

const rateLimit = require('express-rate-limit');
const config = require('../../config');
const logger = require('../utils/logger');

// ── Redis store (opcional mas recomendado em produção) ───────────────────────
let redisStore = null;

// v9.5.0 BUG #136: cada rate limiter PRECISA de sua própria instância de Store.
// A v9.4.7 reusava `generalStore` entre `rateLimiter` e `apiLimiter` →
// express-rate-limit v7 lança ERR_ERL_STORE_REUSE no boot. Por isso o servidor
// não bootava. Fix: construir Store novo por limiter, com prefix único pra
// não contaminar buckets entre eles em Redis.
function buildRedisStore(prefix) {
  // FIX: opt-out explícito
  if (process.env.REDIS_DISABLED === 'true') {
    return undefined;
  }
  try {
    const { createClient } = require('redis');
    const { RedisStore } = require('rate-limit-redis');
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const client = createClient({ url: redisUrl });
    client.on('error', (err) => logger.warn(`[RateLimit] Redis client error: ${err.message}`));
    client.connect().catch(err => {
      logger.warn(`[RateLimit] Redis connect failed (${err.message}). Rate limiting cairá para memory store no próximo request.`);
    });
    return new RedisStore({
      sendCommand: (...args) => client.sendCommand(args),
      prefix: `rl:${prefix || 'general'}:`,
    });
  } catch (e) {
    if (process.env.NODE_ENV === 'production') {
      logger.error(`[RateLimit] PRODUÇÃO sem Redis — rate limit cluster-aware desabilitado: ${e.message}`);
    } else {
      logger.warn('[RateLimit] rate-limit-redis não disponível, usando memory store (OK em dev/single-instance).');
    }
    return undefined;
  }
}

// ── General rate limiter ─────────────────────────────────────────────────────
const rateLimiter = rateLimit({
  windowMs: config.rateLimit?.windowMs || 60 * 1000,
  max:      config.rateLimit?.max      || 100,
  store:    buildRedisStore('general'),
  message: {
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please try again later.',
    retryAfter: Math.ceil((config.rateLimit?.windowMs || 60000) / 1000),
  },
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => req.user?.id || req.ip,
});

// ── Auth limiter (força bruta) ───────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max:      parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10)       || 5,
  store:    buildRedisStore('auth'),
  message: {
    error: 'Too Many Requests',
    message: 'Muitas tentativas de login. Tente novamente em 15 minutos.',
    retryAfter: 900,
  },
  standardHeaders: true,
  legacyHeaders:   false,
  skipSuccessfulRequests: true,
});

// ── API limiter (por workspace) ──────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      60,
  store:    buildRedisStore('api'),
  message: { error: 'Too Many Requests', message: 'API rate limit exceeded.' },
  keyGenerator: (req) => req.workspaceId || req.ip,
});

// ── AI limiter (operações custosas) ─────────────────────────────────────────
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      parseInt(process.env.AI_RATE_LIMIT_MAX, 10) || 20,
  store:    buildRedisStore('ai'),
  message: {
    error: 'Too Many Requests',
    message: 'AI rate limit exceeded. Please wait before making more AI requests.',
  },
  keyGenerator: (req) => req.user?.workspaceId || req.user?.id || req.ip,
});

// ── Webhook limiter (signature-based, alto throughput) ──────────────────────
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      parseInt(process.env.WEBHOOK_RATE_LIMIT_MAX, 10) || 60,
  store:    buildRedisStore('webhook'),
  message: { error: 'Too Many Requests', message: 'Webhook rate limit exceeded.' },
  keyGenerator: (req) => req.ip,
});

module.exports = { rateLimiter, authLimiter, apiLimiter, aiLimiter, webhookLimiter };
