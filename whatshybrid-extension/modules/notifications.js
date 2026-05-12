/**
 * 🔔 Notifications Module - Sistema de Notificações Premium
 * Baseado no Quantum CRM notification-center
 * Toast notifications com sons, animações e ações
 */

(function() {
  'use strict';

  const state = {
    initialized: false,
    container: null,
    notifications: [],
    settings: {
      position: 'top-right',
      maxVisible: 5,
      defaultDuration: 5000,
      soundEnabled: true,
      animationsEnabled: true
    }
  };

  const TYPES = {
    SUCCESS: { icon: '✅', color: '#10B981', sound: 'success' },
    ERROR: { icon: '❌', color: '#EF4444', sound: 'error' },
    WARNING: { icon: '⚠️', color: '#F59E0B', sound: 'warning' },
    INFO: { icon: 'ℹ️', color: '#3B82F6', sound: 'info' },
    MESSAGE: { icon: '💬', color: '#8B5CF6', sound: 'message' }
  };

  /**
   * Inicializa o módulo
   */
  async function init() {
    if (state.initialized) return;

    await loadSettings();
    createContainer();
    injectStyles();

    state.initialized = true;
    console.log('[Notifications] ✅ Módulo inicializado');

    if (window.EventBus) {
      window.EventBus.emit(window.WHL_EVENTS?.MODULE_LOADED, { module: 'notifications' });

      // Escutar eventos de notificação
      window.EventBus.on(window.WHL_EVENTS?.NOTIFICATION_SHOW, data => {
        show(data);
      });
    }
  }

  /**
   * Carrega configurações
   */
  async function loadSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get(['whl_notifications_settings'], result => {
        if (result.whl_notifications_settings) {
          Object.assign(state.settings, result.whl_notifications_settings);
        }
        resolve();
      });
    });
  }

  /**
   * Salva configurações
   */
  async function saveSettings() {
    return new Promise(resolve => {
      chrome.storage.local.set({ whl_notifications_settings: state.settings }, resolve);
    });
  }

  /**
   * Cria container de notificações
   */
  function createContainer() {
    const existing = document.getElementById('whl-notifications-container');
    if (existing) existing.remove();

    state.container = document.createElement('div');
    state.container.id = 'whl-notifications-container';
    state.container.className = `whl-notif-container ${state.settings.position}`;
    document.body.appendChild(state.container);
  }

  /**
   * Injeta estilos
   */
  function injectStyles() {
    if (document.getElementById('whl-notifications-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'whl-notifications-styles';
    styles.textContent = `
      .whl-notif-container {
        position: fixed;
        z-index: 999999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 360px;
        padding: 16px;
        pointer-events: none;
      }
      .whl-notif-container.top-right { top: 0; right: 0; }
      .whl-notif-container.top-left { top: 0; left: 0; }
      .whl-notif-container.bottom-right { bottom: 0; right: 0; }
      .whl-notif-container.bottom-left { bottom: 0; left: 0; }

      .whl-notification {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        background: rgba(26, 26, 46, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-left: 4px solid var(--notif-color, #8b5cf6);
        border-radius: 12px;
        padding: 14px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(20px);
        position: relative;
        overflow: hidden;
        pointer-events: all;
        transform: translateX(0);
        opacity: 1;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .whl-notification.entering {
        animation: notifSlideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .whl-notification.leaving {
        animation: notifSlideOut 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
      }

      @keyframes notifSlideIn {
        from {
          opacity: 0;
          transform: translateX(100%);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }

      @keyframes notifSlideOut {
        to {
          opacity: 0;
          transform: translateX(100%);
        }
      }

      .whl-notification:hover {
        transform: translateX(-4px);
        box-shadow: 0 15px 50px rgba(0, 0, 0, 0.6);
      }

      .whl-notif-icon {
        font-size: 20px;
        flex-shrink: 0;
      }

      .whl-notif-content {
        flex: 1;
        min-width: 0;
      }

      .whl-notif-title {
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        margin-bottom: 4px;
      }

      .whl-notif-message {
        font-size: 13px;
        color: rgba(255, 255, 255, 0.7);
        line-height: 1.4;
        word-break: break-word;
      }

      .whl-notif-actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
      }

      .whl-notif-action {
        padding: 6px 12px;
        background: var(--notif-color, #8b5cf6);
        border: none;
        border-radius: 6px;
        color: white;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .whl-notif-action:hover {
        opacity: 0.85;
        transform: translateY(-1px);
      }

      .whl-notif-close {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.5);
        font-size: 18px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        transition: color 0.2s;
        flex-shrink: 0;
      }

      .whl-notif-close:hover {
        color: #fff;
      }

      .whl-notif-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 3px;
        background: var(--notif-color, #8b5cf6);
        animation: notifProgress var(--duration, 5000ms) linear forwards;
      }

      @keyframes notifProgress {
        from { width: 100%; }
        to { width: 0%; }
      }
    `;
    document.head.appendChild(styles);
  }

  /**
   * Mostra notificação
   */
  function show(options) {
    if (!state.container) createContainer();

    const {
      title = '',
      message = '',
      type = 'info',
      duration = state.settings.defaultDuration,
      actions = [],
      persistent = false,
      id = `notif_${Date.now()}`,
      __safeHtml = false  // v9.3.8: caller garantiu que message é HTML seguro
    } = options;

    const typeConfig = TYPES[type.toUpperCase()] || TYPES.INFO;

    // Criar elemento
    const notification = document.createElement('div');
    notification.className = 'whl-notification';
    notification.dataset.id = id;
    notification.style.setProperty('--notif-color', typeConfig.color);

    if (state.settings.animationsEnabled) {
      notification.classList.add('entering');
      setTimeout(() => notification.classList.remove('entering'), 300);
    }

    // v9.3.8: message só passa cru se __safeHtml=true (loading spinner usa).
    // Senão escape padrão pra evitar XSS via título/conteúdo controlado externamente.
    const messageHtml = __safeHtml ? message : escapeHtml(message);

    notification.innerHTML = `
      <div class="whl-notif-icon">${typeConfig.icon}</div>
      <div class="whl-notif-content">
        ${title ? `<div class="whl-notif-title">${escapeHtml(title)}</div>` : ''}
        ${message ? `<div class="whl-notif-message">${messageHtml}</div>` : ''}
        ${actions.length > 0 ? `
          <div class="whl-notif-actions">
            ${actions.map((a, i) => `
              <button class="whl-notif-action" data-action-index="${i}">${escapeHtml(a.label)}</button>
            `).join('')}
          </div>
        ` : ''}
      </div>
      <button class="whl-notif-close" data-action="close">×</button>
      ${!persistent && duration > 0 ? `<div class="whl-notif-progress" style="--duration:${duration}ms"></div>` : ''}
    `;

    // Event listeners
    notification.querySelector('[data-action="close"]').addEventListener('click', () => {
      dismiss(id);
    });

    actions.forEach((action, index) => {
      const btn = notification.querySelector(`[data-action-index="${index}"]`);
      if (btn) {
        btn.addEventListener('click', () => {
          if (action.action) action.action();
          if (!action.keepOpen) dismiss(id);
        });
      }
    });

    // Adicionar ao container
    state.container.appendChild(notification);

    // Som
    if (state.settings.soundEnabled) {
      playSound(typeConfig.sound);
    }

    // Auto-dismiss
    let timeoutId = null;
    if (!persistent && duration > 0) {
      timeoutId = setTimeout(() => dismiss(id), duration);
    }

    // Registrar
    state.notifications.push({ id, element: notification, timeoutId });

    // Limitar visíveis
    enforceMaxVisible();

    return id;
  }

  /**
   * Atalhos
   */
  function success(message, title = '') {
    return show({ title, message, type: 'success' });
  }

  function error(message, title = '') {
    // PEND-LOW-001 FIX: Usar i18n ao invés de hardcoded
    const defaultTitle = (typeof window.t === 'function') ? window.t('notifications.error') : 'Erro';
    return show({ title: title || defaultTitle, message, type: 'error', duration: 8000 });
  }

  function warning(message, title = '') {
    // PEND-LOW-001 FIX: Usar i18n ao invés de hardcoded
    const defaultTitle = (typeof window.t === 'function') ? window.t('notifications.warning') : 'Atenção';
    return show({ title: title || defaultTitle, message, type: 'warning' });
  }

  function info(message, title = '') {
    return show({ title, message, type: 'info' });
  }

  /**
   * Toast simples
   */
  function toast(message, type = 'info', duration = 3000) {
    return show({ message, type, duration });
  }

  /**
   * Confirmação com Promise
   */
  function confirm(message, title = '') {
    // PEND-LOW-001 FIX: Usar i18n ao invés de hardcoded
    const defaultTitle = (typeof window.t === 'function') ? window.t('notifications.confirm') : 'Confirmar';
    const cancelLabel = (typeof window.t === 'function') ? window.t('common.cancel') : 'Cancelar';
    const confirmLabel = (typeof window.t === 'function') ? window.t('common.confirm') : 'Confirmar';

    return new Promise(resolve => {
      show({
        title: title || defaultTitle,
        message,
        type: 'warning',
        persistent: true,
        actions: [
          { label: cancelLabel, action: () => resolve(false) },
          { label: confirmLabel, action: () => resolve(true) }
        ]
      });
    });
  }

  /**
   * Loading notification
   */
  function loading(message) {
    // PEND-LOW-001 FIX: Usar i18n ao invés de hardcoded
    const defaultMessage = (typeof window.t === 'function') ? window.t('common.loading') : 'Carregando...';
    message = message || defaultMessage;
    // v9.3.8 SECURITY FIX: escape do message pra evitar XSS via spinner template.
    // Spinner é HTML controlado, mas message vem de caller (potencialmente
    // de erro de backend, nome de contato, etc).
    const safe = String(message)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    return show({
      message: `<span style="display:inline-flex;align-items:center;gap:8px;"><span class="whl-spinner"></span>${safe}</span>`,
      type: 'info',
      persistent: true,
      __safeHtml: true,  // sinaliza que o caller já garantiu safety
    });
  }

  /**
   * Dispensa notificação
   */
  function dismiss(id) {
    const index = state.notifications.findIndex(n => n.id === id);
    if (index === -1) return;

    const notif = state.notifications[index];

    if (notif.timeoutId) {
      clearTimeout(notif.timeoutId);
    }

    if (state.settings.animationsEnabled) {
      notif.element.classList.add('leaving');
      setTimeout(() => notif.element.remove(), 300);
    } else {
      notif.element.remove();
    }

    state.notifications.splice(index, 1);
  }

  /**
   * Dispensa todas
   */
  function dismissAll() {
    [...state.notifications].forEach(n => dismiss(n.id));
  }

  /**
   * Limita visíveis
   */
  function enforceMaxVisible() {
    while (state.notifications.length > state.settings.maxVisible) {
      dismiss(state.notifications[0].id);
    }
  }

  /**
   * Som
   */
  function playSound(type) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;

      const ctx = new AudioContext();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      const sounds = {
        success: { freq: 880, duration: 0.1 },
        error: { freq: 220, duration: 0.3 },
        warning: { freq: 440, duration: 0.2 },
        info: { freq: 660, duration: 0.1 },
        message: { freq: 523, duration: 0.15 }
      };

      const sound = sounds[type] || sounds.info;

      oscillator.frequency.value = sound.freq;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.08;

      oscillator.start();
      setTimeout(() => {
        oscillator.stop();
        ctx.close();
      }, sound.duration * 1000);
    } catch (e) {
      // Ignorar erros de áudio
    }
  }

  /**
   * Atualiza configurações
   */
  async function updateSettings(newSettings) {
    Object.assign(state.settings, newSettings);
    await saveSettings();

    if (state.container) {
      state.container.className = `whl-notif-container ${state.settings.position}`;
    }
  }

  function escapeHtml(str) {
    // v9.3.8 SECURITY FIX: removida bypass perigosa via 'whl-spinner'.
    // Antes: if (str.includes('whl-spinner')) return str — qualquer string contendo
    // 'whl-spinner' passava sem escape, permitindo XSS se atacante injetasse essa
    // string em conteúdo do user. Spinner agora deve ser construído via DOM API
    // ou marcado explicitamente como `safeHtml: true` pelo caller.
    // Adicional: tratamento de null/undefined antes do replace.
    if (str === null || str === undefined) return '';
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(str);
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // API Pública
  window.NotificationsModule = {
    init,
    show,
    success,
    error,
    warning,
    info,
    toast,
    confirm,
    loading,
    dismiss,
    dismissAll,
    updateSettings,
    TYPES
  };

})();
