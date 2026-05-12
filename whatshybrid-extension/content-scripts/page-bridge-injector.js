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

  function injectScript(relativePath) {
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL(relativePath);
      s.async = false;
      s.onload = () => { try { s.remove(); } catch (_) {} };
      s.onerror = () => console.error('[WHL] Failed to inject ' + relativePath);
      (document.documentElement || document.head).appendChild(s);
    } catch (e) {
      console.error('[WHL] inject failed:', relativePath, e);
    }
  }

  // 1) Page-world bridge — exposes window.WHL_Store.
  injectScript('injected/wa-page-bridge.js');

  // 2) Privacy shield page-world half. Must run at document_start so it
  //    can patch window.WebSocket BEFORE WhatsApp opens its socket.
  injectScript('injected/whl-privacy-shield.js');
})();
