/**
 * RateLimitManager
 * @file Extraído de SmartBotExtendedService.js (refactor v9)
 */


class RateLimitManager {
  constructor() {
    this.limiters = new Map();
    this.blocked = new Map();
    this.stats = { allowed: 0, blocked: 0, totalRequests: 0 };
  }

  configure(key, config) {
    this.limiters.set(key, {
      maxTokens: config.maxTokens || config.requests || 10,
      refillRate: config.refillRate || config.requests || 10,
      refillInterval: config.refillInterval || config.window || 60000,
      tokens: config.maxTokens || config.requests || 10,
      lastRefill: Date.now(),
      blockDuration: config.blockDuration || 0
    });
  }

  isAllowed(key, tokens = 1) {
    this.stats.totalRequests++;

    const blockInfo = this.blocked.get(key);
    if (blockInfo && Date.now() < blockInfo.until) {
      this.stats.blocked++;
      return { allowed: false, reason: 'blocked', retryAfter: blockInfo.until - Date.now(), remaining: 0 };
    } else if (blockInfo) { this.blocked.delete(key); }

    let limiter = this.limiters.get(key);
    if (!limiter) { this.configure(key, { requests: 60, window: 60000 }); limiter = this.limiters.get(key); }

    this._refillTokens(limiter);

    if (limiter.tokens >= tokens) {
      limiter.tokens -= tokens;
      this.stats.allowed++;
      return { allowed: true, remaining: limiter.tokens, resetAt: limiter.lastRefill + limiter.refillInterval };
    }

    this.stats.blocked++;
    if (limiter.blockDuration > 0) {
      this.blocked.set(key, { until: Date.now() + limiter.blockDuration, reason: 'rate_limit_exceeded' });
    }

    return {
      allowed: false, reason: 'rate_limited', remaining: limiter.tokens,
      retryAfter: limiter.refillInterval - (Date.now() - limiter.lastRefill),
      resetAt: limiter.lastRefill + limiter.refillInterval
    };
  }

  consume(key, tokens = 1) { return this.isAllowed(key, tokens); }

  _refillTokens(limiter) {
    const now = Date.now();
    const elapsed = now - limiter.lastRefill;
    if (elapsed >= limiter.refillInterval) {
      const refillCount = Math.floor(elapsed / limiter.refillInterval);
      limiter.tokens = Math.min(limiter.maxTokens, limiter.tokens + refillCount * limiter.refillRate);
      limiter.lastRefill = now - (elapsed % limiter.refillInterval);
    }
  }

  block(key, duration = 60000) { this.blocked.set(key, { until: Date.now() + duration, reason: 'manual_block' }); }
  unblock(key) { return this.blocked.delete(key); }
  
  reset(key) {
    const limiter = this.limiters.get(key);
    if (limiter) { limiter.tokens = limiter.maxTokens; limiter.lastRefill = Date.now(); }
    this.blocked.delete(key);
  }

  getStatus(key) {
    const limiter = this.limiters.get(key);
    const blockInfo = this.blocked.get(key);
    if (blockInfo && Date.now() < blockInfo.until) return { status: 'blocked', retryAfter: blockInfo.until - Date.now() };
    if (!limiter) return { status: 'not_configured' };
    this._refillTokens(limiter);
    return { status: 'active', tokens: limiter.tokens, maxTokens: limiter.maxTokens, resetAt: limiter.lastRefill + limiter.refillInterval };
  }

  getStats() {
    return { ...this.stats, blockRate: this.stats.blocked / this.stats.totalRequests || 0, activeLimiters: this.limiters.size, blockedKeys: this.blocked.size };
  }
}

// ============================================================
// 🗂️ CONTEXT MANAGER
// ============================================================

module.exports = RateLimitManager;
