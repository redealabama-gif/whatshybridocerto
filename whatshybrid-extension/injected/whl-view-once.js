/**
 * WHL ViewOnceSaver — page-world half.
 *
 * Runs in the page context of web.whatsapp.com. Responsibilities:
 *   - Polls window.require until WhatsApp's renderable-message processor
 *     is available, then monkey-patches it so every incoming message
 *     passes through detectAndCapture() BEFORE rendering. That's the
 *     last moment we can grab a "view once" payload — once the user
 *     opens it, the encrypted blob is fetched and the keys are wiped.
 *   - When a view-once is seen, decrypts the media via WAWebDownloadManager
 *     and pushes the base64 + metadata to the ISOLATED world via
 *     window.postMessage. The isolated half stores it in IndexedDB.
 *
 * The isolated counterpart (modules/view-once-saver.js) cannot do any
 * of this because window.require, the Msg models and the
 * DownloadManager only live in the page world.
 *
 * Toggling the feature on/off and reading the saved DB is all done by
 * the isolated half; this script just listens for `enabled` updates.
 */
(function () {
  'use strict';
  if (window.__WHL_VIEWONCE_PAGE__) return;
  window.__WHL_VIEWONCE_PAGE__ = true;

  const TAG = '[WHL ViewOnce/page]';
  const SOURCE_OUT = 'WHL_VIEWONCE_PAGE';
  const SOURCE_IN = 'WHL_VIEWONCE_ISOLATED';
  const DEBUG = (typeof localStorage !== 'undefined' && localStorage.getItem('whl_debug') === 'true');
  function log(...args) { if (DEBUG) console.log(TAG, ...args); }

  // Initial state mirrored from the isolated half via postMessage. Default
  // is ON — same default as v1.0 (whl_view_once_saver_enabled !== 'false').
  let enabled = (typeof localStorage !== 'undefined' &&
                 localStorage.getItem('whl_view_once_saver_enabled') !== 'false');

  // ── Helpers ──────────────────────────────────────────────────────────
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    // Chunked to avoid stack overflow on large videos.
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function bytesToBase64(maybeBytes) {
    if (!maybeBytes) return null;
    if (typeof maybeBytes === 'string') return maybeBytes;
    try { return btoa(String.fromCharCode.apply(null, maybeBytes)); } catch (_) { return null; }
  }

  function getMimeExt(mimetype) {
    if (!mimetype) return 'bin';
    const map = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
      'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
      'audio/ogg; codecs=opus': 'ogg',
    };
    return map[mimetype] || mimetype.split('/')[1] || 'bin';
  }

  function isViewOnce(msg) {
    if (!msg) return false;
    return msg.isViewOnce ||
      msg.viewOnce ||
      msg.type === 'view_once' ||
      msg.__x_isViewOnce ||
      msg.__x_viewOnce ||
      msg._data?.type === 'view_once' ||
      msg.viewOnceMessageV2 !== undefined ||
      msg.viewOnceMessageV2Extension !== undefined;
  }

  // ── Download via WAWebDownloadManager ────────────────────────────────
  async function downloadViewOnceMedia(msg) {
    const type = msg?.type || msg?.__x_type || 'image';
    const mimetype = msg?.mimetype || msg?.__x_mimetype || '';

    // Path 1: WAWebDownloadManager
    try {
      const dlMod = window.require?.('WAWebDownloadManager');
      const downloadManager = dlMod?.downloadManager || dlMod?.default?.downloadManager;
      if (downloadManager?.downloadAndMaybeDecrypt) {
        const directPath = msg.directPath || msg.__x_directPath;
        const mediaKey = bytesToBase64(msg.mediaKey || msg.__x_mediaKey);
        const encFilehash = bytesToBase64(msg.encFilehash || msg.__x_encFilehash);
        const filehash = bytesToBase64(msg.filehash || msg.__x_filehash);

        if (mediaKey && directPath) {
          const decrypted = await downloadManager.downloadAndMaybeDecrypt({
            directPath, encFilehash, filehash, mediaKey, type,
            signal: (new AbortController()).signal,
          });
          if (decrypted) {
            return { base64: arrayBufferToBase64(decrypted), mimetype, type, ext: getMimeExt(mimetype) };
          }
        }
      }
    } catch (e) {
      log('WAWebDownloadManager path failed:', e?.message);
    }

    // Path 2: direct URL if available
    try {
      const url = msg.url || msg.__x_url || msg.deprecatedMms3Url;
      if (typeof url === 'string' && (url.startsWith('blob:') || url.startsWith('https://'))) {
        const res = await fetch(url);
        if (res.ok) {
          const ab = await res.arrayBuffer();
          return { base64: arrayBufferToBase64(ab), mimetype, type, ext: getMimeExt(mimetype) };
        }
      }
    } catch (e) {
      log('Direct URL fetch failed:', e?.message);
    }

    return null;
  }

  // ── Capture + push to isolated half ──────────────────────────────────
  const _seen = new Set();

  async function detectAndCapture(msg) {
    if (!enabled) return;
    if (!isViewOnce(msg)) return;

    const messageId = msg?.id?.id ||
      (typeof msg?.id?._serialized === 'string' ? msg.id._serialized : null) ||
      msg?.__x_id?.id;
    if (!messageId || _seen.has(messageId)) return;
    _seen.add(messageId);

    log('detected view-once', messageId);
    try {
      const mediaInfo = await downloadViewOnceMedia(msg);
      const from = msg?.from?._serialized ||
                   msg?.author?._serialized ||
                   msg?.id?.remote?._serialized || 'desconhecido';
      const chatId = msg?.id?.remote?._serialized || msg?.chatId?._serialized || from;
      const caption = msg?.caption || msg?.__x_caption || msg?.text || '';

      const record = {
        id: messageId,
        chatId, from, caption,
        timestamp: Date.now(),
        originalTimestamp: ((msg?.t || msg?.timestamp || (Date.now() / 1000)) * 1000),
        type: msg?.type || msg?.__x_type || 'image',
        mimetype: mediaInfo?.mimetype || msg?.mimetype || msg?.__x_mimetype || '',
        hasMedia: !!mediaInfo,
        mediaBase64: mediaInfo?.base64 || null,
        mediaMimetype: mediaInfo?.mimetype || msg?.mimetype || '',
        mediaExt: mediaInfo?.ext || 'bin',
        dataUri: mediaInfo ? `data:${mediaInfo.mimetype};base64,${mediaInfo.base64}` : null,
        thumbnailBase64: bytesToBase64(msg?.thumbnailData || msg?._data?.preview) || null,
      };

      try {
        window.postMessage({ source: SOURCE_OUT, type: 'captured', record }, '*');
      } catch (_) {}
      log('captured & forwarded', messageId, 'hasMedia=' + record.hasMedia);
    } catch (e) {
      console.error(TAG, 'capture failed:', e?.message || e);
    }
  }

  // ── Hook the renderable-message pipeline ─────────────────────────────
  // WA 2.3000.x exposes the processor as
  // require('WAWebMessageProcessRenderable').processRenderableMessages.
  // Older builds used WAWebProcessMessage. We try both.
  let _hookInstalled = false;
  function tryInstallHook() {
    if (_hookInstalled) return true;
    if (typeof window.require !== 'function') return false;

    const candidates = [
      ['WAWebMessageProcessRenderable', 'processRenderableMessages'],
      ['WAWebProcessMessage', 'processRenderableMessages'],
      ['WAWebMessageProcessor', 'processMessages'],
    ];

    for (const [modName, fnName] of candidates) {
      try {
        const mod = window.require(modName);
        const fn = mod?.[fnName] || mod?.default?.[fnName];
        if (typeof fn === 'function' && !mod['__whl_voc_patched_' + fnName]) {
          const orig = fn;
          const patched = function (...args) {
            try {
              const messages = args[0];
              if (Array.isArray(messages)) {
                for (const m of messages) {
                  try { detectAndCapture(m); } catch (_) {}
                }
              } else if (messages && typeof messages === 'object') {
                try { detectAndCapture(messages); } catch (_) {}
              }
            } catch (_) {}
            return orig.apply(this, args);
          };
          if (mod[fnName]) mod[fnName] = patched;
          else mod.default[fnName] = patched;
          mod['__whl_voc_patched_' + fnName] = true;
          _hookInstalled = true;
          log('✅ hooked ' + modName + '.' + fnName);
          return true;
        }
      } catch (_) {}
    }
    return false;
  }

  function pollHook() {
    let attempts = 0;
    const id = setInterval(() => {
      if (tryInstallHook() || ++attempts > 80) {
        if (!_hookInstalled) {
          console.warn(TAG, 'could not install message-processor hook after 20s — view-once capture inactive');
        }
        clearInterval(id);
      }
    }, 250);
  }
  pollHook();

  // ── Inbound state updates from isolated half ─────────────────────────
  window.addEventListener('message', (ev) => {
    const d = ev?.data;
    if (!d || d.source !== SOURCE_IN || !d.type) return;
    if (d.type === 'state' && typeof d.enabled === 'boolean') {
      enabled = d.enabled;
      log('enabled =', enabled);
    } else if (d.type === 'reinstall') {
      _hookInstalled = false;
      tryInstallHook();
    }
  });

  // Announce readiness to the isolated half.
  try { window.postMessage({ source: SOURCE_OUT, type: 'ready', enabled }, '*'); } catch (_) {}
  log('page-world half loaded, enabled =', enabled);
})();
