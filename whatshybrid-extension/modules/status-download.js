/**
 * 📥 Status Download v1.0 - Download de Status/Stories do WhatsApp
 *
 * Portado do WAIncognito e adaptado para a arquitetura WhatsHybrid Pro.
 * Detecta quando um status (foto/vídeo) está sendo visualizado e injeta
 * um botão de download flutuante diretamente na tela.
 *
 * Funciona 100% via DOM — não depende de WebSocket ou APIs internas.
 *
 * @version 1.0.0
 * @author WhatsHybrid Pro (baseado em WAIncognito by tomer8007)
 */

(function () {
  'use strict';

  if (window.__WHL_STATUS_DOWNLOAD__) return;
  window.__WHL_STATUS_DOWNLOAD__ = true;

  // ============================================================
  // CONFIGURAÇÃO
  // ============================================================

  const CONFIG_KEY = 'whl_status_download_enabled';
  let enabled = localStorage.getItem(CONFIG_KEY) !== 'false'; // padrão: ativo

  const DEBUG = localStorage.getItem('whl_debug') === 'true';
  function log(...args) { if (DEBUG) console.log('[WHL StatusDownload]', ...args); }

  // ============================================================
  // ESTILOS
  // ============================================================

  const STYLES = `
    .whl-status-dl-btn {
      position: fixed;
      bottom: 80px;
      right: 24px;
      z-index: 9999;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(8px);
      border: 2px solid rgba(255, 255, 255, 0.25);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s, transform 0.15s;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }
    .whl-status-dl-btn:hover {
      background: rgba(0,168,132,0.85);
      transform: scale(1.1);
    }
    .whl-status-dl-btn svg {
      width: 22px;
      height: 22px;
      fill: white;
    }
    .whl-status-dl-toast {
      position: fixed;
      bottom: 140px;
      right: 24px;
      z-index: 10000;
      background: #1f2937;
      color: #f9fafb;
      padding: 10px 16px;
      border-radius: 10px;
      font-size: 13px;
      font-family: system-ui, -apple-system, sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      animation: whlFadeIn 0.2s ease;
      pointer-events: none;
    }
    .whl-status-dl-fail {
      background: #7f1d1d;
      color: #fecaca;
    }
    @keyframes whlFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;

  const DOWNLOAD_ICON_SVG = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 4h14v-2H5v2z"/>
    </svg>
  `;

  function injectStyles() {
    if (document.getElementById('whl-status-dl-styles')) return;
    const style = document.createElement('style');
    style.id = 'whl-status-dl-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  // ============================================================
  // DETECÇÃO DE STATUS
  // ============================================================

  /**
   * Verifica se um nó IMG ou VIDEO faz parte de um status/story.
   * O WhatsApp marca o container do visualizador de status com
   * data-animate-status-viewer (mesma heurística do WAIncognito).
   */
  function isStatusNode(node) {
    if (!node) return false;
    // Subir até 15 níveis procurando o atributo de status viewer
    let el = node;
    for (let i = 0; i < 15; i++) {
      if (!el || !el.parentElement) break;
      el = el.parentElement;
      if (el.hasAttribute && (
        el.hasAttribute('data-animate-status-viewer') ||
        el.getAttribute('data-testid') === 'status-viewer' ||
        el.getAttribute('data-testid') === 'story-viewer'
      )) {
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // BOTÃO DE DOWNLOAD
  // ============================================================

  let currentButton = null;
  let currentSrc = null;
  let currentType = null; // 'image' | 'video'
  let toastTimeout = null;

  function removeButton() {
    if (currentButton) {
      currentButton.remove();
      currentButton = null;
      currentSrc = null;
      currentType = null;
    }
  }

  function showToast(message, isError = false) {
    // Remover toast anterior
    document.querySelectorAll('.whl-status-dl-toast').forEach(t => t.remove());
    clearTimeout(toastTimeout);

    const toast = document.createElement('div');
    toast.className = 'whl-status-dl-toast' + (isError ? ' whl-status-dl-fail' : '');
    toast.textContent = message;
    document.body.appendChild(toast);

    toastTimeout = setTimeout(() => toast.remove(), 3000);
  }

  async function downloadMedia(src, type) {
    log('Iniciando download:', src?.substring(0, 60), 'Tipo:', type);

    try {
      if (src.startsWith('blob:')) {
        // Blob URL — acesso direto
        const res = await fetch(src);
        if (!res.ok) throw new Error('Falha ao buscar blob');
        const blob = await res.blob();
        const ext = type === 'video' ? 'mp4' : 'jpg';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `whl_status_${Date.now()}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast('✅ Download iniciado!');
        log('Download via blob bem-sucedido');

      } else if (src.startsWith('https://')) {
        // URL direta — abrir em nova aba (stream de vídeo não é baixável diretamente)
        if (src.includes('stream') || src.includes('video')) {
          showToast('⚠️ Reabra o status para baixar este vídeo.', true);
        } else {
          window.open(src, '_blank');
          showToast('✅ Aberto em nova aba!');
        }
      } else {
        showToast('❌ Formato de mídia não suportado.', true);
      }
    } catch (e) {
      console.error('[WHL StatusDownload] Erro no download:', e);
      showToast('❌ Erro ao baixar. Tente reabrir o status.', true);
    }
  }

  function createButton(src, type) {
    // Evitar criar botão duplicado para a mesma mídia
    if (currentSrc === src) return;
    removeButton();

    currentSrc = src;
    currentType = type;

    const btn = document.createElement('div');
    btn.className = 'whl-status-dl-btn';
    btn.title = 'Baixar este status (WhatsHybrid)';
    btn.innerHTML = DOWNLOAD_ICON_SVG;
    btn.setAttribute('data-whl-status-btn', src);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadMedia(src, type);
    });

    document.body.appendChild(btn);
    currentButton = btn;
    log('Botão criado para:', src?.substring(0, 60));
  }

  // ============================================================
  // DETECÇÃO VIA MUTATION OBSERVER
  // ============================================================

  function checkNodeForStatus(node, added) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

    const mediaNodes = [];

    if (node.nodeName === 'IMG' || node.nodeName === 'VIDEO') {
      mediaNodes.push(node);
    }

    // Buscar descendentes
    const imgs = node.querySelectorAll ? node.querySelectorAll('img, video') : [];
    imgs.forEach(n => mediaNodes.push(n));

    for (const media of mediaNodes) {
      const src = media.src || media.currentSrc || '';
      if (!src) continue;

      if (!isStatusNode(media)) continue;

      const type = media.nodeName === 'VIDEO' ? 'video' : 'image';

      if (added) {
        createButton(src, type);
      } else {
        // Nó removido — checar se era o atual
        if (currentSrc === src) {
          removeButton();
        }
      }
    }
  }

  // Observar mudanças de atributo src em mídias já existentes
  function handleAttributeMutation(mutation) {
    const node = mutation.target;
    if (node.nodeName !== 'IMG' && node.nodeName !== 'VIDEO') return;
    if (mutation.attributeName !== 'src') return;

    const oldSrc = mutation.oldValue || '';
    const newSrc = node.src || '';

    if (oldSrc !== newSrc) {
      // Fonte mudou — remover botão antigo
      if (currentSrc === oldSrc) removeButton();

      if (newSrc && isStatusNode(node)) {
        const type = node.nodeName === 'VIDEO' ? 'video' : 'image';
        createButton(newSrc, type);
      }
    }
  }

  let observer = null;

  function startObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver((mutations) => {
      if (!enabled) return;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(n => checkNodeForStatus(n, true));
          mutation.removedNodes.forEach(n => checkNodeForStatus(n, false));
        } else if (mutation.type === 'attributes') {
          handleAttributeMutation(mutation);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
      attributeOldValue: true
    });

    log('Observer iniciado');
  }

  // ============================================================
  // API PÚBLICA
  // ============================================================

  window.WHL_StatusDownload = {
    enable() {
      enabled = true;
      localStorage.setItem(CONFIG_KEY, 'true');
      log('Ativado');
    },
    disable() {
      enabled = false;
      localStorage.setItem(CONFIG_KEY, 'false');
      removeButton();
      log('Desativado');
    },
    toggle() {
      if (enabled) this.disable(); else this.enable();
      return enabled;
    },
    isEnabled: () => enabled
  };

  // ============================================================
  // INTEGRAÇÃO COM EventBus / Mensagens
  // ============================================================

  // Escutar mensagens do painel lateral para toggle
  window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin) return;
    const { type, payload } = e.data || {};
    if (type === 'WHL_STATUS_DOWNLOAD_TOGGLE') {
      const isNowEnabled = window.WHL_StatusDownload.toggle();
      window.postMessage({ type: 'WHL_STATUS_DOWNLOAD_STATE', enabled: isNowEnabled }, window.location.origin);
    }
    if (type === 'WHL_STATUS_DOWNLOAD_SET') {
      payload?.enabled ? window.WHL_StatusDownload.enable() : window.WHL_StatusDownload.disable();
    }
  });

  // Integração com EventBus se disponível
  if (window.EventBus?.on) {
    window.EventBus.on('statusDownload:toggle', () => window.WHL_StatusDownload.toggle());
    window.EventBus.on('statusDownload:enable', () => window.WHL_StatusDownload.enable());
    window.EventBus.on('statusDownload:disable', () => window.WHL_StatusDownload.disable());
  }

  // ============================================================
  // INICIALIZAÇÃO
  // ============================================================

  function init() {
    injectStyles();
    startObserver();
    console.log('[WHL StatusDownload] ✅ Módulo v1.0 iniciado. Status:', enabled ? 'ATIVO' : 'INATIVO');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
