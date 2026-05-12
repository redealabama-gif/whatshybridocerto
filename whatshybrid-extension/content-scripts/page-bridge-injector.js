/**
 * page-bridge-injector.js
 *
 * Tiny content script that runs at document_start and injects
 * `injected/wa-page-bridge.js` into the page world via a real <script src=...>
 * tag. The page bridge exposes window.WHL_Store and answers postMessage
 * commands from the isolated world.
 *
 * This is the ONLY content script that should be touching the page DOM at
 * document_start — keep it tiny.
 */
(function () {
  'use strict';
  if (window.__WHL_BRIDGE_INJECTED__) return;
  window.__WHL_BRIDGE_INJECTED__ = true;
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('injected/wa-page-bridge.js');
    s.async = false;
    s.onload = () => { try { s.remove(); } catch (_) {} };
    s.onerror = () => console.error('[WHL] Failed to inject wa-page-bridge.js');
    (document.documentElement || document.head).appendChild(s);
  } catch (e) {
    console.error('[WHL] page-bridge-injector failed:', e);
  }
})();
