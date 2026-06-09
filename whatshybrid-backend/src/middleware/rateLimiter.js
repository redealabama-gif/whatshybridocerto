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
// Teto por operação no Redis. Sem isso, um Redis "meio-vivo" (TCP aceita mas
// não responde) segura o increment indefinidamente — e o request junto.
const REDIS_OP_TIMEOUT_MS = parseInt(process.env.RATE_LIMIT_REDIS_TIMEOUT_MS, 10) || 1500;

// Wrapper resiliente em volta do RedisStore: qualquer operação que estoure o
// timeout REJEITA em vez de pendurar. Combinado com passOnStoreError nos
// limiters, request passa (fail-open) em vez de congelar a API inteira.
//
// AUDITORIA 2026-06-09 — bug provado em ambiente real: com REDIS_URL apontando
// pra um Redis fora do ar, TODA requisição (incl. /health) pendurava pra
// sempre dentro do limiter — a fila offline do node-redis enfileira comandos
// indefinidamente enquanto tenta reconectar. O "fallback pra memory store"
// prometido acima só valia quando o require falhava, não quando o Redis caía
// em runtime. Trade-off consciente do fail-open: durante um incidente de
// Redis o brute-force fica menos protegido por alguns instantes — preferível
// a derrubar 100% da API. O log de warn (com rate próprio) dá visibilidade.
class ResilientRedisStore {
  constructor(inner, label) {
    this.inner = inner;
    this.label = label;
    this._lastWarnAt = 0;
    // express-rate-limit lê essas props direto do store quando existem.
    if (inner.prefix !== undefined) this.prefix = inner.prefix;
    if (inner.localKeys !== undefined) this.localKeys = inner.localKeys;
  }

  init(options) {
    if (typeof this.inner.init === 'function') return this.inner.init(options);
  }

  _warn(op, err) {
    const now = Date.now();
    if (now - this._lastWarnAt > 60_000) {
      this._lastWarnAt = now;
      logger.warn(`[RateLimit:${this.label}] Redis indisponível em ${op} (${err.message}) — fail-open temporário (requests passam sem contar).`);
    }
  }

  _withTimeout(op, promise) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`redis ${op} timeout ${REDIS_OP_TIMEOUT_MS}ms`)), REDIS_OP_TIMEOUT_MS);
      if (timer.unref) timer.unref();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async _call(op, ...args) {
    try {
      return await this._withTimeout(op, this.inner[op](...args));
    } catch (err) {
      this._warn(op, err);
      throw err; // passOnStoreError transforma isso em "deixa passar"
    }
  }

  get(key)       { return this._call('get', key); }
  increment(key) { return this._call('increment', key); }
  decrement(key) {
    // Best-effort: falha em decrement não pode rejeitar o request
    // (skipSuccessfulRequests chama decrement após a resposta).
    return this._call('decrement', key).catch(() => {});
  }
  resetKey(key)  { return this._call('resetKey', key).catch(() => {}); }
}

function buildRedisStore(prefix) {
  // FIX: opt-out explícito
  if (process.env.REDIS_DISABLED === 'true') {
    return undefined;
  }
  try {
    const { createClient } = require('redis');
    const { RedisStore } = require('rate-limit-redis');
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const client = createClient({
      url: redisUrl,
      // Sem fila offline: com Redis caído os comandos REJEITAM na hora em vez
      // de enfileirar pra sempre (a fila era a causa do congelamento da API).
      disableOfflineQueue: true,
      socket: { connectTimeout: 2000 },
    });
    client.on('error', (err) => logger.warn(`[RateLimit] Redis client error: ${err.message}`));
    client.connect().catch(err => {
      logger.warn(`[RateLimit] Redis connect failed (${err.message}). Limiters ficam fail-open até o Redis voltar.`);
    });
    const store = new RedisStore({
      sendCommand: (...args) => client.sendCommand(args),
      prefix: `rl:${prefix || 'general'}:`,
    });
    return new ResilientRedisStore(store, prefix || 'general');
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
  // Store com erro/timeout (Redis fora) => deixa o request passar em vez
  // de travar/derrubar — disponibilidade da API > contagem estrita.
  passOnStoreError: true,
  message: {
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please try again later.',
    retryAfter: Math.ceil((config.rateLimit?.windowMs || 60000) / 1000),
  },
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => req.user?.id || req.ip,
  // A extensão sincroniza ~18 módulos em alta frequência nestes endpoints
  // internos de dados (sync/crm/tasks/recover/subscription) — todos exigem
  // token de autenticação. Contá-los no teto global por-usuário causava 429
  // em cascata: o primeiro 429 dispara retries que reabastecem a janela e a
  // mantêm estourada (mesmo com max=1000). Estes grupos ficam de fora do
  // limiter geral; o brute-force de login tem authLimiter e o custo de IA
  // tem aiLimiter próprios, então a proteção que importa permanece.
  skip: (req) => {
    const p = req.path || req.originalUrl || '';
    return /^\/api\/(v1\/)?(sync|crm|tasks|recover|subscription)(\/|$)/.test(p);
  },
});

// ── Auth limiter (força bruta) ───────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max:      parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10)       || 5,
  store:    buildRedisStore('auth'),
  // Store com erro/timeout (Redis fora) => deixa o request passar em vez
  // de travar/derrubar — disponibilidade da API > contagem estrita.
  passOnStoreError: true,
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
  // Store com erro/timeout (Redis fora) => deixa o request passar em vez
  // de travar/derrubar — disponibilidade da API > contagem estrita.
  passOnStoreError: true,
  message: { error: 'Too Many Requests', message: 'API rate limit exceeded.' },
  keyGenerator: (req) => req.workspaceId || req.ip,
});

// ── AI limiter (operações custosas) ─────────────────────────────────────────
// O default de 20/min era baixo demais: o CopilotEngine busca contexto do
// backend por conversa e, somado a sugestões, estourava 429 quase de imediato
// — derrubando a IA pro fallback genérico local. 120/min ainda limita custo
// de LLM mas comporta o uso real de um cliente. Override via AI_RATE_LIMIT_MAX.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      parseInt(process.env.AI_RATE_LIMIT_MAX, 10) || 120,
  store:    buildRedisStore('ai'),
  // Store com erro/timeout (Redis fora) => deixa o request passar em vez
  // de travar/derrubar — disponibilidade da API > contagem estrita.
  passOnStoreError: true,
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
  // Store com erro/timeout (Redis fora) => deixa o request passar em vez
  // de travar/derrubar — disponibilidade da API > contagem estrita.
  passOnStoreError: true,
  message: { error: 'Too Many Requests', message: 'Webhook rate limit exceeded.' },
  keyGenerator: (req) => req.ip,
});

module.exports = { rateLimiter, authLimiter, apiLimiter, aiLimiter, webhookLimiter };
