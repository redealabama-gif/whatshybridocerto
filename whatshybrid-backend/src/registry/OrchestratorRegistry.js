/**
 * OrchestratorRegistry — Singleton real por tenant com LRU eviction e TTL
 *
 * CORREÇÃO P1: Substitui o antipadrão router._orchestrators (Map no objeto Express)
 * — Singleton de módulo: compartilhado entre todas as rotas do processo
 * — LRU eviction: remove tenant menos usado quando mapa excede MAX_SIZE
 * — TTL: orquestradores inativos descartados após TENANT_TTL_MS
 */

const logger = require('../utils/logger');

const MAX_SIZE = parseInt(process.env.ORCHESTRATOR_MAX_TENANTS, 10) || 200;
const TENANT_TTL_MS = parseInt(process.env.ORCHESTRATOR_TTL_MS, 10) || 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

class OrchestratorRegistry {
  constructor() {
    this._store = new Map();
    // v9.3.4: lock map pra evitar race em get() concorrente.
    // Antes: 2 requests simultâneos pro mesmo tenant criavam 2 orchestrators
    // (segundo sobrescrevia o primeiro no Map mas o primeiro continuava órfão
    // com init() rodando em background). Custo dobrado, eventos duplicados.
    this._creating = new Map();
    this._AIOrchestrator = null;
    this._cleanupTimer = setInterval(() => this._evictExpired(), CLEANUP_INTERVAL_MS);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
    logger.info(`[OrchestratorRegistry] Inicializado (max=${MAX_SIZE}, ttl=${TENANT_TTL_MS}ms)`);
  }

  _loadClass() {
    if (!this._AIOrchestrator) {
      this._AIOrchestrator = require('../ai/AIOrchestrator');
    }
    return this._AIOrchestrator;
  }

  /**
   * Sync get — retorna o orquestrador imediatamente (compatibilidade com código existente).
   * Se for o primeiro acesso, dispara init() em background. As primeiras mensagens
   * podem usar memória vazia até o init() completar.
   *
   * Para garantir init completo antes de processar, use `await registry.getAsync(tenantId)`.
   */
  get(tenantId, config = {}) {
    const key = tenantId || 'default';
    const now = Date.now();

    if (this._store.has(key)) {
      const entry = this._store.get(key);
      entry.lastUsed = now;
      this._store.delete(key);
      this._store.set(key, entry);
      return entry.orchestrator;
    }

    // v9.3.4: lock check — se outro request já criou, retorna o mesmo
    // (mas em sync, isso só acontece em race entre microtasks. JS single-thread
    // garante que entre `_store.has` e `_store.set` não há outro `get()`.
    // O lock real importa pra getAsync abaixo.)

    if (this._store.size >= MAX_SIZE) this._evictLRU();

    const AIOrchestrator = this._loadClass();
    const orchestrator = new AIOrchestrator({
      tenantId: key,
      enableCommercialIntelligence: true,
      enableQualityChecker: true,
      enableBehaviorAdapter: true,
      enableAutoLearning: true,
      ...config,
    });

    // FIX HIGH: dispara init() em background. Antes, o init nunca era chamado e
    // ConversationMemory ficava initialized=false, podendo lançar erros.
    const initPromise = orchestrator.init
      ? orchestrator.init().catch(err => {
          logger.warn(`[OrchestratorRegistry] init() failed para "${key}": ${err.message}`);
        })
      : Promise.resolve();

    this._store.set(key, { orchestrator, lastUsed: now, createdAt: now, initPromise });
    logger.debug(`[OrchestratorRegistry] Criado tenant "${key}" (total: ${this._store.size})`);
    return orchestrator;
  }

  /**
   * Async get — aguarda init() completar antes de retornar.
   *
   * v9.3.4: lock real pra evitar criação concorrente.
   *   Antes: 2 requests simultâneos pra novo tenant disparariam this.get() 2x,
   *   criando 2 orchestrators (segundo sobrescrevia primeiro no Map → primeiro
   *   ficava órfão com init() rodando, custando memória/IO duplicado).
   *
   *   Agora: se há criação em andamento pro mesmo key, todos os concorrentes
   *   esperam pela MESMA Promise — só 1 orchestrator é criado, todos usam.
   *
   * Use em handlers críticos (primeira mensagem de uma conversa).
   */
  async getAsync(tenantId, config = {}) {
    const key = tenantId || 'default';

    // Já existe? retorna direto
    if (this._store.has(key)) {
      const entry = this._store.get(key);
      entry.lastUsed = Date.now();
      // re-insert pra LRU
      this._store.delete(key);
      this._store.set(key, entry);
      if (entry.initPromise) {
        try { await entry.initPromise; } catch (_) { /* já logado */ }
      }
      return entry.orchestrator;
    }

    // Criação em andamento? espera por ela
    if (this._creating.has(key)) {
      try {
        return await this._creating.get(key);
      } catch (_) {
        // Se a criação concorrente falhou, tenta de novo abaixo
      }
    }

    // Cria com lock
    const creationPromise = (async () => {
      // Re-check (pode ter sido criado entre o check e o lock)
      if (this._store.has(key)) {
        return this._store.get(key).orchestrator;
      }

      if (this._store.size >= MAX_SIZE) this._evictLRU();

      const AIOrchestrator = this._loadClass();
      const orchestrator = new AIOrchestrator({
        tenantId: key,
        enableCommercialIntelligence: true,
        enableQualityChecker: true,
        enableBehaviorAdapter: true,
        enableAutoLearning: true,
        ...config,
      });

      const now = Date.now();
      const initPromise = orchestrator.init
        ? orchestrator.init().catch(err => {
            logger.warn(`[OrchestratorRegistry] init() failed para "${key}": ${err.message}`);
          })
        : Promise.resolve();

      this._store.set(key, { orchestrator, lastUsed: now, createdAt: now, initPromise });
      logger.debug(`[OrchestratorRegistry] Criado tenant "${key}" (total: ${this._store.size})`);

      // Aguarda init completar antes de retornar
      try { await initPromise; } catch (_) { /* já logado */ }

      return orchestrator;
    })();

    this._creating.set(key, creationPromise);

    try {
      return await creationPromise;
    } finally {
      // Limpa o lock independentemente do sucesso (próximo get vai achar no _store ou recriar)
      this._creating.delete(key);
    }
  }

  _evictLRU() {
    const oldest = this._store.keys().next().value;
    if (oldest) {
      this._store.delete(oldest);
      logger.debug(`[OrchestratorRegistry] LRU eviction: "${oldest}"`);
    }
  }

  _evictExpired() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this._store) {
      if (now - entry.lastUsed > TENANT_TTL_MS) { this._store.delete(key); removed++; }
    }
    if (removed > 0) logger.debug(`[OrchestratorRegistry] TTL eviction: ${removed} tenant(s)`);
  }

  remove(tenantId) { this._store.delete(tenantId || 'default'); }

  getStats() {
    return { activeOrchestrators: this._store.size, maxSize: MAX_SIZE, ttlMs: TENANT_TTL_MS, tenants: Array.from(this._store.keys()) };
  }

  destroy() { clearInterval(this._cleanupTimer); this._store.clear(); }
}

module.exports = new OrchestratorRegistry();
