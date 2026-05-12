/**
 * SessionManager
 * @file Extraído de SmartBotExtendedService.js (refactor v9)
 */


class SessionManager {
  constructor(options = {}) {
    this.sessions = new Map();
    this.defaultTimeout = options.timeout || 1800000;
    this.maxSessions = options.maxSessions || 10000;
    this.onExpire = options.onExpire || null;
    this.cleanupInterval = setInterval(() => this._cleanup(), 30000);
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  create(sessionId, data = {}) {
    if (this.sessions.size >= this.maxSessions) this._evictOldest();
    const session = {
      id: sessionId, data: { ...data }, createdAt: Date.now(), lastActivity: Date.now(),
      expiresAt: Date.now() + this.defaultTimeout, metadata: { userAgent: data.userAgent, ip: data.ip }
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  get(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() > session.expiresAt) { this._expireSession(sessionId); return null; }
    return session;
  }

  touch(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session && Date.now() <= session.expiresAt) {
      session.lastActivity = Date.now();
      session.expiresAt = Date.now() + this.defaultTimeout;
      return true;
    }
    return false;
  }

  update(sessionId, data) {
    const session = this.get(sessionId);
    if (session) { session.data = { ...session.data, ...data }; session.lastActivity = Date.now(); return true; }
    return false;
  }

  set(sessionId, key, value) {
    const session = this.get(sessionId);
    if (session) { session.data[key] = value; session.lastActivity = Date.now(); return true; }
    return false;
  }

  getValue(sessionId, key, defaultValue = undefined) {
    const session = this.get(sessionId);
    return session ? (session.data[key] ?? defaultValue) : defaultValue;
  }

  destroy(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) { this.sessions.delete(sessionId); return true; }
    return false;
  }

  isValid(sessionId) {
    const session = this.sessions.get(sessionId);
    return session && Date.now() <= session.expiresAt;
  }

  renew(sessionId, timeout = null) {
    const session = this.get(sessionId);
    if (session) {
      session.expiresAt = Date.now() + (timeout || this.defaultTimeout);
      session.lastActivity = Date.now();
      return session.expiresAt;
    }
    return null;
  }

  getOrCreate(sessionId, initialData = {}) {
    let session = this.get(sessionId);
    if (!session) session = this.create(sessionId, initialData);
    return session;
  }

  _expireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session && this.onExpire) { try { this.onExpire(session); } catch (e) {} }
    this.sessions.delete(sessionId);
  }

  _evictOldest() {
    let oldest = null, oldestTime = Infinity;
    this.sessions.forEach((session, id) => {
      if (session.lastActivity < oldestTime) { oldestTime = session.lastActivity; oldest = id; }
    });
    if (oldest) this._expireSession(oldest);
  }

  _cleanup() {
    const now = Date.now();
    const toExpire = [];
    this.sessions.forEach((session, id) => { if (now > session.expiresAt) toExpire.push(id); });
    toExpire.forEach(id => this._expireSession(id));
  }

  listSessions() {
    return Array.from(this.sessions.entries()).map(([id, session]) => ({
      id, createdAt: session.createdAt, lastActivity: session.lastActivity,
      expiresAt: session.expiresAt, timeToExpire: session.expiresAt - Date.now()
    }));
  }

  getStats() {
    const now = Date.now();
    let totalAge = 0, activeCount = 0;
    this.sessions.forEach(session => {
      if (now <= session.expiresAt) { activeCount++; totalAge += now - session.createdAt; }
    });
    return { totalSessions: this.sessions.size, activeSessions: activeCount, avgAge: activeCount > 0 ? totalAge / activeCount : 0, maxSessions: this.maxSessions };
  }

  destroy() { clearInterval(this.cleanupInterval); this.sessions.clear(); }
}

// ============================================================
// 📊 FEEDBACK ANALYZER
// ============================================================

module.exports = SessionManager;
