/**
 * 💾 CacheManager - Gerenciador de Cache
 * WhatsHybrid Pro v7.1.0
 * 
 * Suporta Redis (production) e Memory (development)
 */

class MemoryCache {
  constructor() {
    this.cache = new Map();
    this.timers = new Map();
  }

  async get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.delete(key);
      return null;
    }
    
    return item.value;
  }

  async set(key, value, ttlSeconds = 3600) {
    // Clear existing timer
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    const expiresAt = ttlSeconds > 0 ? Date.now() + (ttlSeconds * 1000) : null;
    
    this.cache.set(key, { value, expiresAt, createdAt: Date.now() });

    // Set expiration timer
    if (ttlSeconds > 0) {
      const timer = setTimeout(() => {
        this.delete(key);
      }, ttlSeconds * 1000);
      this.timers.set(key, timer);
    }

    return true;
  }

  async delete(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    return this.cache.delete(key);
  }

  async exists(key) {
    const value = await this.get(key);
    return value !== null;
  }

  async ttl(key) {
    const item = this.cache.get(key);
    if (!item || !item.expiresAt) return -1;
    const remaining = Math.ceil((item.expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -1;
  }

  async keys(pattern = '*') {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return Array.from(this.cache.keys()).filter(key => regex.test(key));
  }

  async clear() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.cache.clear();
    return true;
  }

  async size() {
    return this.cache.size;
  }

  // Hash operations
  async hset(key, field, value) {
    let hash = await this.get(key);
    if (!hash || typeof hash !== 'object') {
      hash = {};
    }
    hash[field] = value;
    return this.set(key, hash);
  }

  async hget(key, field) {
    const hash = await this.get(key);
    return hash?.[field] ?? null;
  }

  async hgetall(key) {
    return await this.get(key) || {};
  }

  async hdel(key, field) {
    const hash = await this.get(key);
    if (hash && hash[field] !== undefined) {
      delete hash[field];
      await this.set(key, hash);
      return 1;
    }
    return 0;
  }

  // List operations
  async lpush(key, ...values) {
    let list = await this.get(key);
    if (!Array.isArray(list)) {
      list = [];
    }
    list.unshift(...values);
    await this.set(key, list);
    return list.length;
  }

  async rpush(key, ...values) {
    let list = await this.get(key);
    if (!Array.isArray(list)) {
      list = [];
    }
    list.push(...values);
    await this.set(key, list);
    return list.length;
  }

  async lrange(key, start, stop) {
    const list = await this.get(key);
    if (!Array.isArray(list)) return [];
    const end = stop === -1 ? undefined : stop + 1;
    return list.slice(start, end);
  }

  async llen(key) {
    const list = await this.get(key);
    return Array.isArray(list) ? list.length : 0;
  }

  // Counter operations
  async incr(key) {
    let value = await this.get(key);
    value = (parseInt(value) || 0) + 1;
    await this.set(key, value);
    return value;
  }

  async decr(key) {
    let value = await this.get(key);
    value = (parseInt(value) || 0) - 1;
    await this.set(key, value);
    return value;
  }

  async incrby(key, increment) {
    let value = await this.get(key);
    value = (parseInt(value) || 0) + increment;
    await this.set(key, value);
    return value;
  }
}

class CacheManager {
  constructor(options = {}) {
    this.prefix = options.prefix || 'whl:';
    this.defaultTTL = options.defaultTTL || 3600;
    this.driver = options.driver || 'memory';
    
    // Initialize cache driver
    if (this.driver === 'redis' && options.redis) {
      this.client = options.redis;
      logger.info('[CacheManager] Using Redis driver');
    } else {
      this.client = new MemoryCache();
      logger.info('[CacheManager] Using Memory driver');
    }

    // Stats
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };
  }

  /**
   * Build key with prefix
   */
  key(key) {
    return `${this.prefix}${key}`;
  }

  /**
   * Get value
   */
  async get(key) {
    const value = await this.client.get(this.key(key));
    
    if (value !== null) {
      this.stats.hits++;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    
    this.stats.misses++;
    return null;
  }

  /**
   * Set value
   */
  async set(key, value, ttl = this.defaultTTL) {
    this.stats.sets++;
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    return this.client.set(this.key(key), serialized, ttl);
  }

  /**
   * Delete value
   */
  async delete(key) {
    this.stats.deletes++;
    return this.client.delete(this.key(key));
  }

  /**
   * Check if key exists
   */
  async exists(key) {
    return this.client.exists(this.key(key));
  }

  /**
   * Get remaining TTL
   */
  async ttl(key) {
    return this.client.ttl(this.key(key));
  }

  /**
   * Get or set (cache aside pattern)
   */
  async getOrSet(key, fetchFn, ttl = this.defaultTTL) {
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }

    const value = await fetchFn();
    await this.set(key, value, ttl);
    return value;
  }

  /**
   * Delete by pattern
   */
  async deletePattern(pattern) {
    const keys = await this.client.keys(this.key(pattern));
    let deleted = 0;
    
    for (const key of keys) {
      await this.client.delete(key);
      deleted++;
    }
    
    return deleted;
  }

  /**
   * Clear all cache
   */
  async clear() {
    return this.client.clear();
  }

  /**
   * Get stats
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? (this.stats.hits / total * 100).toFixed(2) + '%' : '0%',
      driver: this.driver
    };
  }

  // Convenience methods for common patterns

  /**
   * Cache user session
   */
  async cacheSession(userId, sessionData, ttl = 86400) {
    return this.set(`session:${userId}`, sessionData, ttl);
  }

  async getSession(userId) {
    return this.get(`session:${userId}`);
  }

  async deleteSession(userId) {
    return this.delete(`session:${userId}`);
  }

  /**
   * Cache workspace data
   */
  async cacheWorkspace(workspaceId, data, ttl = 3600) {
    return this.set(`workspace:${workspaceId}`, data, ttl);
  }

  async getWorkspace(workspaceId) {
    return this.get(`workspace:${workspaceId}`);
  }

  async invalidateWorkspace(workspaceId) {
    return this.deletePattern(`workspace:${workspaceId}*`);
  }

  /**
   * Rate limiting
   */
  async checkRateLimit(key, limit, windowSeconds) {
    const countKey = `ratelimit:${key}`;
    let count = await this.get(countKey);
    
    if (count === null) {
      await this.set(countKey, 1, windowSeconds);
      return { allowed: true, remaining: limit - 1, resetIn: windowSeconds };
    }

    count = parseInt(count);
    
    if (count >= limit) {
      const ttl = await this.ttl(countKey);
      return { allowed: false, remaining: 0, resetIn: ttl };
    }

    await this.client.incrby(this.key(countKey), 1);
    const ttl = await this.ttl(countKey);
    
    return { allowed: true, remaining: limit - count - 1, resetIn: ttl };
  }

  /**
   * AI response caching
   */
  async cacheAIResponse(promptHash, response, ttl = 3600) {
    return this.set(`ai:${promptHash}`, response, ttl);
  }

  async getAIResponse(promptHash) {
    return this.get(`ai:${promptHash}`);
  }
}

// Singleton
let instance = null;

module.exports = {
  CacheManager,
  MemoryCache,
  getInstance: () => instance,
  initialize: (options) => {
    instance = new CacheManager(options);
    return instance;
  }
};
