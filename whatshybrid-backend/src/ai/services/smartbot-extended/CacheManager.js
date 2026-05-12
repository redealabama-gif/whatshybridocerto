/**
 * CacheManager
 * @file Extraído de SmartBotExtendedService.js (refactor v9)
 */


class CacheManager {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.defaultTTL = options.defaultTTL || 300000;
    this.cache = new Map();
    this.accessOrder = [];
    this.stats = { hits: 0, misses: 0, evictions: 0 };
    this.cleanupInterval = setInterval(() => this._cleanup(), 60000);
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) { this.stats.misses++; return null; }
    if (entry.expiresAt && Date.now() > entry.expiresAt) { this.delete(key); this.stats.misses++; return null; }
    this._updateAccessOrder(key);
    this.stats.hits++;
    return entry.value;
  }

  set(key, value, ttl = null) {
    if (!this.cache.has(key) && this.cache.size >= this.maxSize) this._evict();
    const entry = {
      value, createdAt: Date.now(),
      expiresAt: ttl !== null ? Date.now() + ttl : (this.defaultTTL ? Date.now() + this.defaultTTL : null),
      accessCount: 0
    };
    this.cache.set(key, entry);
    this._updateAccessOrder(key);
    return true;
  }

  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (entry.expiresAt && Date.now() > entry.expiresAt) { this.delete(key); return false; }
    return true;
  }

  delete(key) {
    const deleted = this.cache.delete(key);
    if (deleted) {
      const idx = this.accessOrder.indexOf(key);
      if (idx > -1) this.accessOrder.splice(idx, 1);
    }
    return deleted;
  }

  clear() { this.cache.clear(); this.accessOrder = []; }

  async getOrSet(key, factory, ttl = null) {
    const existing = this.get(key);
    if (existing !== null) return existing;
    const value = typeof factory === 'function' ? await factory() : factory;
    this.set(key, value, ttl);
    return value;
  }

  touch(key, ttl = null) {
    const entry = this.cache.get(key);
    if (entry) {
      entry.expiresAt = ttl !== null ? Date.now() + ttl : (this.defaultTTL ? Date.now() + this.defaultTTL : null);
      return true;
    }
    return false;
  }

  _updateAccessOrder(key) {
    const idx = this.accessOrder.indexOf(key);
    if (idx > -1) this.accessOrder.splice(idx, 1);
    this.accessOrder.push(key);
    const entry = this.cache.get(key);
    if (entry) entry.accessCount++;
  }

  _evict() {
    if (this.accessOrder.length > 0) {
      const keyToRemove = this.accessOrder.shift();
      this.cache.delete(keyToRemove);
      this.stats.evictions++;
    }
  }

  _cleanup() {
    const now = Date.now();
    const keysToDelete = [];
    this.cache.forEach((entry, key) => {
      if (entry.expiresAt && now > entry.expiresAt) keysToDelete.push(key);
    });
    keysToDelete.forEach(key => this.delete(key));
  }

  getStats() {
    return { size: this.cache.size, maxSize: this.maxSize, hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0, ...this.stats };
  }

  keys() { return Array.from(this.cache.keys()); }
  size() { return this.cache.size; }
  destroy() { clearInterval(this.cleanupInterval); this.clear(); }
}

// ============================================================
// ⏱️ RATE LIMIT MANAGER
// ============================================================

module.exports = CacheManager;
