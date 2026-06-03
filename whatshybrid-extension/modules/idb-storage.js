/**
 * idb-storage.js — IndexedDB Storage Adapter
 * WhatsHybrid Pro v9.0.0
 *
 * P6 FIX: Replaces chrome.storage.local (10MB limit) with IndexedDB,
 * which supports up to 50–80% of available disk space (typically GBs).
 *
 * API mirrors the chrome.storage.local async interface so existing callers
 * can be migrated with minimal changes:
 *
 *   // Before (chrome.storage.local, 10MB cap):
 *   await chrome.storage.local.set({ [KEY]: data });
 *   const result = await chrome.storage.local.get(KEY);
 *
 *   // After (IndexedDB, no practical cap):
 *   await IDBStorage.set(KEY, data);
 *   const value = await IDBStorage.get(KEY);
 *
 * Features:
 * - Async Promise API
 * - Transparent JSON serialisation / deserialisation
 * - Atomic writes (IDB transactions)
 * - Lazy DB initialisation (opens on first access)
 * - Graceful fallback to chrome.storage.local if IndexedDB is unavailable
 * - Quota error detection with automatic eviction of oldest entries
 */

(function () {
  'use strict';

  const DB_NAME    = 'whl_idb_store';
  const DB_VERSION = 1;
  const STORE_NAME = 'keyval';

  let _db = null;

  // ─────────────────────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────────────────────

  function _openDB() {
    if (_db) return Promise.resolve(_db);

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          // keyPath = 'k' so we can iterate and sort by insertion
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'k' });
          store.createIndex('ts', 'ts', { unique: false }); // for eviction ordering
        }
      };

      req.onsuccess = (event) => {
        _db = event.target.result;
        resolve(_db);
      };

      req.onerror = () => reject(req.error);
    });
  }

  function _tx(mode) {
    return _openDB().then(db => {
      const tx    = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      return { tx, store };
    });
  }

  function _idbRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────

  const IDBStorage = {

    /**
     * Store a value under a key.
     * @param {string} key
     * @param {*} value  — any JSON-serialisable value
     * @returns {Promise<void>}
     */
    async set(key, value) {
      try {
        const { store } = await _tx('readwrite');
        await _idbRequest(store.put({ k: key, v: value, ts: Date.now() }));
      } catch (err) {
        if (err && err.name === 'QuotaExceededError') {
          await IDBStorage._evictOldest(10);
          const { store } = await _tx('readwrite');
          await _idbRequest(store.put({ k: key, v: value, ts: Date.now() }));
        } else {
          // Fallback to chrome.storage.local
          console.warn('[IDBStorage] write failed, using fallback:', err.message);
          await new Promise(r => chrome.storage.local.set({ [key]: value }, r));
        }
      }
    },

    /**
     * Retrieve a value by key.
     * @param {string} key
     * @returns {Promise<*>} The stored value or undefined
     */
    async get(key) {
      try {
        const { store } = await _tx('readonly');
        const record    = await _idbRequest(store.get(key));
        return record ? record.v : undefined;
      } catch (err) {
        console.warn('[IDBStorage] read failed, using fallback:', err.message);
        const result = await new Promise(r => chrome.storage.local.get(key, r));
        return result[key];
      }
    },

    /**
     * Delete a key.
     * @param {string} key
     * @returns {Promise<void>}
     */
    async remove(key) {
      try {
        const { store } = await _tx('readwrite');
        await _idbRequest(store.delete(key));
      } catch (err) {
        console.warn('[IDBStorage] remove failed, using fallback:', err.message);
        await new Promise(r => chrome.storage.local.remove(key, r));
      }
    },

    /**
     * Clear all entries.
     * @returns {Promise<void>}
     */
    async clear() {
      try {
        const { store } = await _tx('readwrite');
        await _idbRequest(store.clear());
      } catch (err) {
        console.warn('[IDBStorage] clear failed:', err.message);
      }
    },

    /**
     * Get all stored keys.
     * @returns {Promise<string[]>}
     */
    async keys() {
      try {
        const { store } = await _tx('readonly');
        return await _idbRequest(store.getAllKeys());
      } catch (err) {
        return [];
      }
    },

    /**
     * Approximate bytes in use (sums JSON-stringified values).
     * Useful for monitoring — not a replacement for getBytesInUse.
     * @returns {Promise<number>}
     */
    async getBytesInUse() {
      try {
        const { store } = await _tx('readonly');
        const all = await _idbRequest(store.getAll());
        return all.reduce((sum, r) => sum + JSON.stringify(r.v).length * 2, 0);
      } catch {
        return 0;
      }
    },

    // ── Internal ──────────────────────────────────────────────────

    /** Evict the N oldest entries by timestamp to free space. @private */
    async _evictOldest(n = 10) {
      try {
        const { store } = await _tx('readwrite');
        const index  = store.index('ts');
        const cursor = await _idbRequest(index.openCursor());
        let deleted  = 0;

        async function advance(cursor) {
          if (!cursor || deleted >= n) return;
          await _idbRequest(cursor.delete());
          deleted++;
          const next = await _idbRequest(cursor.continue());
          await advance(next);
        }

        await advance(cursor);
        console.warn(`[IDBStorage] Evicted ${deleted} entries to free quota`);
      } catch (err) {
        console.error('[IDBStorage] Eviction failed:', err.message);
      }
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Migration helper: one-time copy from chrome.storage.local → IDB
  // Run once after deploying this module; safe to call multiple times.
  // ─────────────────────────────────────────────────────────────

  async function migrateFromChromeStorage() {
    const MIGRATION_FLAG = '__whl_idb_migrated_v1';
    const alreadyDone    = await IDBStorage.get(MIGRATION_FLAG);
    if (alreadyDone) return;

    try {
      const all = await new Promise(r => chrome.storage.local.get(null, r));
      for (const [key, value] of Object.entries(all)) {
        await IDBStorage.set(key, value);
      }
      await IDBStorage.set(MIGRATION_FLAG, true);
      console.log(`[IDBStorage] Migrated ${Object.keys(all).length} entries from chrome.storage.local`);
    } catch (err) {
      console.error('[IDBStorage] Migration failed:', err.message);
    }
  }

  // Expose globally
  window.IDBStorage         = IDBStorage;
  window.whlMigrateStorage  = migrateFromChromeStorage;

  // Trigger migration when the extension loads
  migrateFromChromeStorage();

})();
