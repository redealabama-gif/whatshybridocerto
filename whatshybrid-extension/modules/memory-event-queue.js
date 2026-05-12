/**
 * memory-event-queue.js — v9.5.5
 *
 * Event-level memory sync ("Leão" pattern, adopted from RedeAlabama
 * serviceWorker.js:62-93). Complements data-sync-manager.js, which syncs whole
 * storage blobs — this module captures GRANULAR events as they happen and
 * flushes them in batches to the backend.
 *
 * Why both: data-sync-manager pushes the entire `whl_ai_memory` object on
 * change (good for state but blob-heavy). This queue pushes individual events
 * (`message_received`, `suggestion_used`, `profile_updated`, `feedback`),
 * which the backend can index and analyze later, and which survive across
 * devices even if the whole-blob sync is paused/throttled.
 *
 * Bounded: max 500 events. Flush triggers: every 30s OR when queue ≥ 50.
 *
 * Public API:
 *   window.WHLMemoryEventQueue.push(eventType, payload)
 *   window.WHLMemoryEventQueue.flush()
 *   window.WHLMemoryEventQueue.getStats()
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'whl_memory_event_queue';
  const FLUSH_INTERVAL_MS = 30 * 1000;
  const FLUSH_THRESHOLD = 50;
  const MAX_QUEUE_SIZE = 500;
  const ENDPOINT = '/api/v1/sync/ai_memory_events';

  const state = {
    queue: [],
    flushing: false,
    timer: null,
    initialized: false,
    stats: { pushed: 0, flushed: 0, dropped: 0, errors: 0 },
  };

  async function loadFromStorage() {
    try {
      const data = await chromeStorageGet(STORAGE_KEY);
      if (Array.isArray(data?.[STORAGE_KEY])) {
        state.queue = data[STORAGE_KEY].slice(0, MAX_QUEUE_SIZE);
      }
    } catch (_) { /* fresh start */ }
  }

  async function persist() {
    try {
      await chromeStorageSet({ [STORAGE_KEY]: state.queue });
    } catch (_) {}
  }

  function chromeStorageGet(key) {
    return new Promise(resolve => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) return resolve({});
      chrome.storage.local.get(key, resolve);
    });
  }
  function chromeStorageSet(obj) {
    return new Promise(resolve => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) return resolve();
      chrome.storage.local.set(obj, resolve);
    });
  }

  function push(eventType, payload) {
    if (!eventType) return false;
    if (state.queue.length >= MAX_QUEUE_SIZE) {
      // Drop oldest to keep newest — newer events are more valuable.
      state.queue.shift();
      state.stats.dropped++;
    }
    state.queue.push({
      type: String(eventType).slice(0, 64),
      payload: payload || {},
      ts: Date.now(),
    });
    state.stats.pushed++;
    persist();
    if (state.queue.length >= FLUSH_THRESHOLD) flush();
    return true;
  }

  async function flush() {
    if (state.flushing || state.queue.length === 0) return;
    if (!window.BackendClient?.isConnected?.()) return;
    state.flushing = true;
    const batch = state.queue.splice(0, FLUSH_THRESHOLD);
    try {
      await window.BackendClient.request(ENDPOINT, {
        method: 'POST',
        body: { events: batch },
      });
      state.stats.flushed += batch.length;
      await persist();
    } catch (e) {
      // Re-queue on failure (front of queue) so we retry next interval.
      state.queue = [...batch, ...state.queue].slice(0, MAX_QUEUE_SIZE);
      state.stats.errors++;
      console.warn('[MemoryEventQueue] Flush falhou (re-enfileirado):', e?.message);
    } finally {
      state.flushing = false;
    }
  }

  async function init() {
    if (state.initialized) return;
    state.initialized = true;
    await loadFromStorage();
    state.timer = setInterval(() => { flush().catch(() => {}); }, FLUSH_INTERVAL_MS);
    // Wire to existing event bus so other modules can fire-and-forget.
    if (window.EventBus) {
      window.EventBus.on('memory:event', (e) => push(e?.type, e?.payload));
      // Auto-capture useful signals already emitted elsewhere:
      window.EventBus.on('feedback:received', (d) => push('feedback', d));
      window.EventBus.on('successfulInteraction', (d) => push('successful_interaction', d));
      window.EventBus.on('ai:tier:hit', (d) => push('ai_tier_hit', d));
      window.EventBus.on('ai:assistant:picked', (d) => push('assistant_picked', d));
      window.EventBus.on('ai:safety:blocked', (d) => push('safety_blocked', d));
    }
    // Best-effort flush on page unload.
    window.addEventListener('beforeunload', () => { flush().catch(() => {}); });
    console.log('[MemoryEventQueue] ✅ Inicializado, queue=', state.queue.length);
  }

  function getStats() {
    return { ...state.stats, queueSize: state.queue.length, flushing: state.flushing };
  }

  if (typeof window !== 'undefined') {
    window.WHLMemoryEventQueue = { push, flush, getStats, init };
    // Auto-init on load (slight delay to let BackendClient finish booting).
    setTimeout(() => { init().catch(e => console.warn('[MemoryEventQueue] init falhou:', e)); }, 2500);
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { push, flush, getStats, init };
  }
})();
