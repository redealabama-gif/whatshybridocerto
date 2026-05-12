/**
 * 👁️ View Once Saver v2.0 — isolated half.
 *
 * Owns the IndexedDB store of captured view-once payloads, the toggle
 * state and the public API/UI surface. The actual capture (hooking
 * WAWebMessageProcessRenderable and downloading via WAWebDownloadManager)
 * is done by the page-world half at injected/whl-view-once.js.
 *
 * v1.0 tried to do the page-world work from here — every require() call
 * silently returned undefined and the hook never installed. v2.0 keeps
 * the same public API so the sidepanel/notifications keep working, but
 * delegates capture to the page half via window.postMessage.
 */
(function () {
  'use strict';

  if (window.__WHL_VIEW_ONCE_SAVER__) return;
  window.__WHL_VIEW_ONCE_SAVER__ = true;

  const TAG = '[WHL ViewOnce]';
  const CONFIG_KEY = 'whl_view_once_saver_enabled';
  const SOURCE_OUT = 'WHL_VIEWONCE_ISOLATED';
  const SOURCE_IN = 'WHL_VIEWONCE_PAGE';

  let enabled = localStorage.getItem(CONFIG_KEY) !== 'false';

  const DEBUG = localStorage.getItem('whl_debug') === 'true';
  function log(...args) { if (DEBUG) console.log(TAG, ...args); }

  // ── IndexedDB ────────────────────────────────────────────────────────
  const DB_NAME = 'whl_view_once';
  const DB_VERSION = 1;
  const STORE_NAME = 'msgs';
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp_idx', 'timestamp');
          log('IndexedDB created');
        }
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  async function saveToDB(record) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => {
        if (req.error?.name === 'ConstraintError') {
          log('already saved:', record.id);
          resolve(false);
        } else {
          reject(req.error);
        }
      };
    });
  }

  async function getAllFromDB() {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteFromDB(id) {
    if (!db) await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve(true);
    });
  }

  // ── Receive captures from page world ─────────────────────────────────
  async function handleCapturedRecord(record) {
    if (!record || !record.id) return;
    try {
      const saved = await saveToDB(record);
      if (saved) {
        log('✅ persisted view-once', record.id, 'hasMedia=' + record.hasMedia);

        // Tell other UI parts (sidepanel, RecoverDOM listener).
        try {
          window.postMessage({
            type: 'WHL_VIEW_ONCE_SAVED',
            payload: {
              id: record.id, chatId: record.chatId, from: record.from,
              hasMedia: record.hasMedia, timestamp: record.timestamp,
            },
          }, window.location.origin);
        } catch (_) {}

        // Integrate with Recover history if available.
        if (window.RecoverAdvanced?.registerMessageEvent) {
          try {
            window.RecoverAdvanced.registerMessageEvent(
              {
                id: record.id, key: record.id, action: 'view_once',
                body: record.caption || '[mídia: ver uma vez]',
                from: record.from, chatId: record.chatId,
                timestamp: record.timestamp, mediaType: record.type,
              },
              'view_once', 'whl_view_once',
            );
          } catch (_) {}
        }

        if (window.NotificationsModule?.toast) {
          window.NotificationsModule.toast('👁️ Mídia "ver uma vez" salva!', 'info', 3000);
        }
      }
    } catch (e) {
      console.error(TAG, 'failed to persist record:', e?.message || e);
    }
  }

  let _pageReady = false;
  window.addEventListener('message', (ev) => {
    const d = ev?.data;
    if (!d || d.source !== SOURCE_IN || !d.type) return;
    if (d.type === 'ready') {
      _pageReady = true;
      log('page half ready');
      pushState();
    } else if (d.type === 'captured' && d.record) {
      handleCapturedRecord(d.record);
    }
  });

  function pushState() {
    try {
      window.postMessage({ source: SOURCE_OUT, type: 'state', enabled }, '*');
    } catch (_) {}
  }

  function setEnabled(v) {
    enabled = !!v;
    localStorage.setItem(CONFIG_KEY, enabled ? 'true' : 'false');
    pushState();
    log('enabled =', enabled);
  }

  // ── DOM fallback observer: notify the user that a view-once was
  //    seen even when the hook hasn't been installed yet. This does NOT
  //    capture the media — it's just a heads-up.
  let _viewOnceObserver = null;
  function startDomObserver() {
    if (_viewOnceObserver) try { _viewOnceObserver.disconnect(); } catch (_) {}
    const VIEW_ONCE_SELECTORS = [
      '[data-testid="view-once-msg"]',
      '[data-testid="view-once-image"]',
      '[data-testid="view-once-video"]',
      'span[data-icon="view-once"]',
      'span[data-icon="view_once"]',
      '[data-testid="msg-view-once-button"]',
      '[aria-label*="ver uma vez" i]',
      '[aria-label*="view once" i]',
    ];

    _viewOnceObserver = new MutationObserver((mutations) => {
      if (!enabled) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          for (const sel of VIEW_ONCE_SELECTORS) {
            try {
              const found = node.matches?.(sel) ? [node] : [...(node.querySelectorAll?.(sel) || [])];
              if (found.length > 0) {
                log('👁️ DOM marker detected');
                return;
              }
            } catch (_) {}
          }
        }
      }
    });
    _viewOnceObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ── Public API (unchanged from v1.0) ────────────────────────────────
  window.WHL_ViewOnceSaver = {
    enable() { setEnabled(true); },
    disable() { setEnabled(false); },
    toggle() { setEnabled(!enabled); return enabled; },
    isEnabled: () => enabled,
    getSaved: async () => {
      try {
        const records = await getAllFromDB();
        return records.sort((a, b) => b.timestamp - a.timestamp);
      } catch (e) {
        console.error(TAG, 'getSaved failed:', e?.message);
        return [];
      }
    },
    deleteSaved: deleteFromDB,
    /** Ask the page half to re-attempt installing the hook. */
    reinstall() {
      try { window.postMessage({ source: SOURCE_OUT, type: 'reinstall' }, '*'); } catch (_) {}
    },
    _pageReady: () => _pageReady,
  };

  // Top-panel / sidepanel command bus.
  window.addEventListener('message', async (e) => {
    if (e.origin !== window.location.origin) return;
    const { type } = e.data || {};
    if (type === 'WHL_GET_VIEW_ONCE_SAVED') {
      const records = await window.WHL_ViewOnceSaver.getSaved();
      try {
        window.postMessage({ type: 'WHL_VIEW_ONCE_SAVED_LIST', records }, window.location.origin);
      } catch (_) {}
    } else if (type === 'WHL_DELETE_VIEW_ONCE') {
      await deleteFromDB(e.data.id);
    } else if (type === 'WHL_VIEW_ONCE_TOGGLE') {
      window.WHL_ViewOnceSaver.toggle();
    }
  });

  // Boot.
  (async function init() {
    try { await openDB(); } catch (e) { console.warn(TAG, 'IndexedDB open failed:', e?.message); }
    startDomObserver();
    pushState();
    console.log(TAG, '✅ v2.0 isolated half loaded. enabled =', enabled);
  })();
})();
