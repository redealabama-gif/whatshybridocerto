/**
 * ContextManager
 * @file Extraído de SmartBotExtendedService.js (refactor v9)
 */


class ContextManager {
  constructor(options = {}) {
    this.contexts = new Map();
    this.defaultTTL = options.defaultTTL || 1800000;
    this.maxDepth = options.maxDepth || 10;
    this.cleanupInterval = setInterval(() => this._cleanup(), 60000);
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  set(contextId, key, value, ttl = null) {
    let context = this.contexts.get(contextId);
    if (!context) {
      context = { id: contextId, data: {}, metadata: {}, createdAt: Date.now(), lastAccess: Date.now() };
      this.contexts.set(contextId, context);
    }

    const keys = key.split('.');
    let current = context.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]] || typeof current[keys[i]] !== 'object') current[keys[i]] = {};
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;

    context.metadata[key] = { setAt: Date.now(), expiresAt: ttl !== null ? Date.now() + ttl : Date.now() + this.defaultTTL };
    context.lastAccess = Date.now();
    return true;
  }

  get(contextId, key, defaultValue = undefined) {
    const context = this.contexts.get(contextId);
    if (!context) return defaultValue;

    const meta = context.metadata[key];
    if (meta && Date.now() > meta.expiresAt) { this.delete(contextId, key); return defaultValue; }

    const keys = key.split('.');
    let current = context.data;
    for (const k of keys) {
      if (current === undefined || current === null) return defaultValue;
      current = current[k];
    }

    context.lastAccess = Date.now();
    return current !== undefined ? current : defaultValue;
  }

  has(contextId, key) { return this.get(contextId, key) !== undefined; }

  delete(contextId, key) {
    const context = this.contexts.get(contextId);
    if (!context) return false;
    const keys = key.split('.');
    let current = context.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) return false;
      current = current[keys[i]];
    }
    delete current[keys[keys.length - 1]];
    delete context.metadata[key];
    return true;
  }

  getContext(contextId) {
    const context = this.contexts.get(contextId);
    if (!context) return null;
    this._cleanExpired(context);
    context.lastAccess = Date.now();
    return { ...context.data };
  }

  merge(contextId, data, ttl = null) {
    Object.entries(data).forEach(([key, value]) => this.set(contextId, key, value, ttl));
  }

  clearContext(contextId) { return this.contexts.delete(contextId); }

  push(contextId, key, value, maxLength = 100) {
    const arr = this.get(contextId, key, []);
    arr.push(value);
    if (arr.length > maxLength) arr.shift();
    this.set(contextId, key, arr);
    return arr.length;
  }

  increment(contextId, key, amount = 1) {
    const current = this.get(contextId, key, 0);
    const newValue = (typeof current === 'number' ? current : 0) + amount;
    this.set(contextId, key, newValue);
    return newValue;
  }

  _cleanExpired(context) {
    const now = Date.now();
    Object.entries(context.metadata).forEach(([key, meta]) => {
      if (now > meta.expiresAt) this.delete(context.id, key);
    });
  }

  _cleanup() {
    const now = Date.now();
    this.contexts.forEach((context, contextId) => {
      if (now - context.lastAccess > this.defaultTTL * 2) this.contexts.delete(contextId);
      else this._cleanExpired(context);
    });
  }

  listContexts() { return Array.from(this.contexts.keys()); }
  
  getStats() {
    return {
      totalContexts: this.contexts.size,
      contexts: Array.from(this.contexts.entries()).map(([id, ctx]) => ({
        id, keysCount: Object.keys(ctx.data).length, lastAccess: ctx.lastAccess, age: Date.now() - ctx.createdAt
      }))
    };
  }

  destroy() { clearInterval(this.cleanupInterval); this.contexts.clear(); }
}

// ============================================================
// 🔐 SESSION MANAGER
// ============================================================

module.exports = ContextManager;
