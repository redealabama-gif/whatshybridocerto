/**
 * Feature Flags Service — v9.2.0
 *
 * Liga/desliga features sem deploy. Crucial pra:
 *   - Desabilitar feature que quebrou em produção (kill switch)
 *   - Rollout gradual: ativa pra 1 cliente teste antes de todos
 *   - A/B testing operacional
 *
 * Convenção de nomes: `area.feature`
 *   ai.auto_reply, ai.copilot, ai.fallback_provider
 *   billing.stripe_enabled, billing.mp_enabled, billing.tokens_purchase
 *   ext.advanced_bundle_lazy, ext.recover_messages
 *   ops.health_score_alerts, ops.drip_campaigns
 *
 * Uso:
 *   const flags = require('./FeatureFlagsService');
 *   if (await flags.isEnabled('ai.auto_reply', workspaceId)) { ... }
 *
 * Cache em memória 60s pra reduzir hits no DB.
 */

const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const logger = require('../utils/logger').logger;

// v9.5.0 BUG #155: cache de feature flags era unbounded. Em produção com 100+
// workspaces × N flags poderia crescer sem limite até TTL kicking in. Agora
// MAX_CACHE_SIZE limita; ao atingir, eviction de 10% LRU.
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_SIZE = parseInt(process.env.FFLAGS_CACHE_MAX, 10) || 2000;
const cache = new Map(); // key = `${flagName}:${workspaceId||'*'}` → { value, expires }

function _cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) { cache.delete(key); return undefined; }
  return entry.value;
}

function _cacheSet(key, value) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const evict = Math.max(1, Math.floor(MAX_CACHE_SIZE * 0.1));
    let n = 0;
    for (const k of cache.keys()) {
      cache.delete(k);
      if (++n >= evict) break;
    }
  }
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

/**
 * Verifica se uma flag está ativada.
 *
 * Resolução:
 *   1. Override por workspace (se existir)
 *   2. Flag global (workspace_id IS NULL)
 *   3. Default: false
 *
 * @param {string} flagName
 * @param {string} [workspaceId]
 * @param {boolean} [defaultValue=false]
 * @returns {boolean}
 */
function isEnabled(flagName, workspaceId = null, defaultValue = false) {
  if (!flagName) return defaultValue;

  const cacheKey = `${flagName}:${workspaceId || '*'}`;
  const cached = _cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const db = require('../utils/database');

    // 1. Workspace-specific override
    if (workspaceId) {
      const wsFlag = db.get(
        `SELECT enabled FROM feature_flags WHERE flag_name = ? AND workspace_id = ?`,
        [flagName, workspaceId]
      );
      if (wsFlag) {
        const value = wsFlag.enabled === 1 || wsFlag.enabled === true;
        _cacheSet(cacheKey, value);
        return value;
      }
    }

    // 2. Global flag
    const globalFlag = db.get(
      `SELECT enabled FROM feature_flags WHERE flag_name = ? AND workspace_id IS NULL`,
      [flagName]
    );
    if (globalFlag) {
      const value = globalFlag.enabled === 1 || globalFlag.enabled === true;
      _cacheSet(cacheKey, value);
      return value;
    }

    // 3. Default
    _cacheSet(cacheKey, defaultValue);
    return defaultValue;
  } catch (err) {
    logger.warn(`[FeatureFlags] isEnabled error: ${err.message}`);
    return defaultValue;
  }
}

/**
 * Define uma flag (global ou por workspace)
 */
function setFlag(flagName, enabled, workspaceId = null, opts = {}) {
  try {
    const db = require('../utils/database');
    const existing = db.get(
      `SELECT id FROM feature_flags WHERE flag_name = ? AND ${workspaceId ? 'workspace_id = ?' : 'workspace_id IS NULL'}`,
      workspaceId ? [flagName, workspaceId] : [flagName]
    );
    if (existing) {
      db.run(
        `UPDATE feature_flags SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [enabled ? 1 : 0, existing.id]
      );
    } else {
      db.run(
        `INSERT INTO feature_flags (id, flag_name, enabled, workspace_id, description, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [uuidv4(), flagName, enabled ? 1 : 0, workspaceId, opts.description || null,
         opts.metadata ? JSON.stringify(opts.metadata) : null]
      );
    }

    // Invalida cache
    cache.delete(`${flagName}:${workspaceId || '*'}`);
    cache.delete(`${flagName}:*`);
    if (workspaceId) cache.delete(`${flagName}:${workspaceId}`);

    logger.info(`[FeatureFlags] Set ${flagName} = ${enabled}${workspaceId ? ` for ${workspaceId}` : ' (global)'}`);
    return true;
  } catch (err) {
    logger.error(`[FeatureFlags] setFlag error: ${err.message}`);
    return false;
  }
}

/**
 * Lista todas as flags (admin)
 */
function listAll() {
  try {
    const db = require('../utils/database');
    return db.all(`SELECT * FROM feature_flags ORDER BY flag_name, workspace_id NULLS FIRST`);
  } catch (err) {
    logger.warn(`[FeatureFlags] listAll error: ${err.message}`);
    return [];
  }
}

/**
 * Limpa cache (útil em testes ou após mudança via admin direto no DB)
 */
function clearCache() {
  cache.clear();
}

module.exports = { isEnabled, setFlag, listAll, clearCache };
