/**
 * 🎨 ModernUI - Sistema de UI moderno para WhatsHybrid
 * WhatsHybrid Pro v7.1.0
 * 
 * Controla todos os elementos visuais e interações
 */

(function() {
  'use strict';

  const VERSION = '1.0.0';

  // ============================================
  // SECURITY HELPERS
  // ============================================

  /**
   * SECURITY FIX P0-004: Escape HTML to prevent XSS attacks
   * Converts dangerous characters to HTML entities
   */
  function escapeHtml(text) {
    if (text == null) return '';
    const str = String(text);
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================
  // TOAST NOTIFICATIONS
  // ============================================

  const ToastManager = {
    container: null,

    init() {
      if (this.container) return;
      
      this.container = document.createElement('div');
      this.container.id = 'whl-toast-container';
      this.container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-width: 350px;
      `;
      document.body.appendChild(this.container);
    },

    show(message, type = 'info', duration = 3000) {
      this.init();

      const toast = document.createElement('div');
      toast.className = `whl-toast whl-toast-${type}`;
      
      const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
      };

      const colors = {
        success: 'rgba(16, 185, 129, 0.95)',
        error: 'rgba(239, 68, 68, 0.95)',
        warning: 'rgba(245, 158, 11, 0.95)',
        info: 'rgba(59, 130, 246, 0.95)'
      };

      toast.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 16px;
        background: ${colors[type] || colors.info};
        color: white;
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        font-size: 13px;
        animation: slideIn 0.3s ease;
        cursor: pointer;
      `;

      // SECURITY FIX P0-004: Escape message to prevent XSS
      toast.innerHTML = `
        <span style="font-size: 18px;">${icons[type] || icons.info}</span>
        <span style="flex: 1;">${escapeHtml(message)}</span>
        <button style="background: none; border: none; color: white; cursor: pointer; opacity: 0.7; font-size: 16px;">×</button>
      `;

      toast.querySelector('button').onclick = () => this.remove(toast);
      toast.onclick = () => this.remove(toast);

      this.container.appendChild(toast);

      if (duration > 0) {
        setTimeout(() => this.remove(toast), duration);
      }

      return toast;
    },

    remove(toast) {
      if (!toast || !toast.parentNode) return;
      
      toast.style.animation = 'slideOut 0.3s ease forwards';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    },

    success(message, duration) { return this.show(message, 'success', duration); },
    error(message, duration) { return this.show(message, 'error', duration); },
    warning(message, duration) { return this.show(message, 'warning', duration); },
    info(message, duration) { return this.show(message, 'info', duration); }
  };

  // ============================================
  // MODAL MANAGER
  // ============================================

  const ModalManager = {
    container: null,
    activeModals: [],

    init() {
      if (this.container) return;
      
      this.container = document.createElement('div');
      this.container.id = 'whl-modal-container';
      this.container.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 99998;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
      `;
      document.body.appendChild(this.container);

      // Close on backdrop click
      this.container.addEventListener('click', (e) => {
        if (e.target === this.container) {
          this.closeTop();
        }
      });

      // Close on Escape
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.activeModals.length > 0) {
          this.closeTop();
        }
      });
    },

    show(options = {}) {
      this.init();

      const {
        title = 'Modal',
        content = '',
        width = '500px',
        buttons = [],
        closable = true,
        onClose = null
      } = options;

      const modal = document.createElement('div');
      modal.className = 'whl-modal';
      modal.style.cssText = `
        background: linear-gradient(145deg, rgba(26, 26, 46, 0.98), rgba(40, 40, 70, 0.98));
        border: 1px solid rgba(139, 92, 246, 0.3);
        border-radius: 16px;
        width: ${width};
        max-width: 90vw;
        max-height: 85vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        animation: modalIn 0.3s ease;
        box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
      `;

      // SECURITY FIX P0-004: Escape title and content to prevent XSS
      modal.innerHTML = `
        <div class="whl-modal-header" style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        ">
          <h3 style="margin: 0; font-size: 16px; color: white;">${escapeHtml(title)}</h3>
          ${closable ? '<button class="whl-modal-close" style="background: none; border: none; color: rgba(255,255,255,0.6); font-size: 24px; cursor: pointer; padding: 0; line-height: 1;">&times;</button>' : ''}
        </div>
        <div class="whl-modal-content" style="
          padding: 20px;
          overflow-y: auto;
          flex: 1;
          color: white;
        ">${escapeHtml(content)}</div>
        ${buttons.length > 0 ? `
          <div class="whl-modal-footer" style="
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            padding: 16px 20px;
            border-top: 1px solid rgba(255,255,255,0.1);
          ">
            ${buttons.map(btn => `
              <button class="whl-modal-btn ${btn.primary ? 'primary' : ''}" data-action="${escapeHtml(btn.action || '')}" style="
                padding: 10px 20px;
                border-radius: 8px;
                border: none;
                cursor: pointer;
                font-size: 14px;
                background: ${btn.primary ? 'linear-gradient(135deg, #8B5CF6, #7C3AED)' : 'rgba(255,255,255,0.1)'};
                color: white;
                transition: all 0.2s;
              ">${escapeHtml(btn.text)}</button>
            `).join('')}
          </div>
        ` : ''}
      `;

      // Close button
      const closeBtn = modal.querySelector('.whl-modal-close');
      if (closeBtn) {
        closeBtn.onclick = () => this.close(modal);
      }

      // Button actions
      modal.querySelectorAll('.whl-modal-btn').forEach(btn => {
        btn.onclick = () => {
          const action = btn.dataset.action;
          const button = buttons.find(b => b.action === action);
          if (button?.onClick) {
            const result = button.onClick(modal);
            if (result !== false && button.closeOnClick !== false) {
              this.close(modal);
            }
          } else {
            this.close(modal);
          }
        };
      });

      modal._onClose = onClose;
      this.container.appendChild(modal);
      this.activeModals.push(modal);
      this.container.style.display = 'flex';

      return modal;
    },

    close(modal) {
      const index = this.activeModals.indexOf(modal);
      if (index === -1) return;

      modal.style.animation = 'modalOut 0.2s ease forwards';
      setTimeout(() => {
        if (modal._onClose) modal._onClose();
        modal.remove();
        this.activeModals.splice(index, 1);
        
        if (this.activeModals.length === 0) {
          this.container.style.display = 'none';
        }
      }, 200);
    },

    closeTop() {
      if (this.activeModals.length > 0) {
        this.close(this.activeModals[this.activeModals.length - 1]);
      }
    },

    closeAll() {
      [...this.activeModals].forEach(modal => this.close(modal));
    },

    confirm(message, title = '') {
      // PEND-LOW-001 FIX: Usar i18n ao invés de hardcoded
      const defaultTitle = (typeof window.t === 'function') ? window.t('notifications.confirm') : 'Confirmar';
      const cancelText = (typeof window.t === 'function') ? window.t('common.cancel') : 'Cancelar';
      const confirmText = (typeof window.t === 'function') ? window.t('common.confirm') : 'Confirmar';

      return new Promise((resolve) => {
        this.show({
          title: title || defaultTitle,
          // SECURITY FIX P0-004: Escape message to prevent XSS
          content: `<p style="margin: 0; font-size: 14px;">${escapeHtml(message)}</p>`,
          width: '400px',
          buttons: [
            { text: cancelText, action: 'cancel', onClick: () => resolve(false) },
            { text: confirmText, action: 'confirm', primary: true, onClick: () => resolve(true) }
          ],
          onClose: () => resolve(false)
        });
      });
    },

    alert(message, title = '') {
      // PEND-LOW-001 FIX: Usar i18n ao invés de hardcoded
      const defaultTitle = (typeof window.t === 'function') ? window.t('notifications.alert') : 'Aviso';
      const okText = (typeof window.t === 'function') ? window.t('common.ok') : 'OK';
      title = title || defaultTitle;
      return new Promise((resolve) => {
        this.show({
          title,
          // SECURITY FIX P0-004: Escape message to prevent XSS
          content: `<p style="margin: 0; font-size: 14px;">${escapeHtml(message)}</p>`,
          width: '400px',
          buttons: [
            { text: okText, action: 'ok', primary: true, onClick: () => resolve(true) }
          ],
          onClose: () => resolve(true)
        });
      });
    },

    prompt(message, defaultValue = '', title) {
      // PEND-LOW-001 FIX: Usar i18n ao invés de hardcoded
      const defaultTitle = (typeof window.t === 'function') ? window.t('notifications.input') : 'Entrada';
      title = title || defaultTitle;
      return new Promise((resolve) => {
        const modal = this.show({
          title,
          // SECURITY FIX P0-004: Escape message and defaultValue to prevent XSS
          content: `
            <p style="margin: 0 0 12px; font-size: 14px;">${escapeHtml(message)}</p>
            <input type="text" class="whl-modal-input" value="${escapeHtml(defaultValue)}" style="
              width: 100%;
              padding: 10px 12px;
              border: 1px solid rgba(255,255,255,0.2);
              border-radius: 8px;
              background: rgba(0,0,0,0.3);
              color: white;
              font-size: 14px;
              box-sizing: border-box;
            ">
          `,
          width: '400px',
          buttons: [
            { text: 'Cancelar', action: 'cancel', onClick: () => resolve(null) },
            { 
              text: 'OK', 
              action: 'ok', 
              primary: true, 
              onClick: (modal) => {
                const input = modal.querySelector('.whl-modal-input');
                resolve(input?.value || '');
              }
            }
          ],
          onClose: () => resolve(null)
        });

        // Focus input
        setTimeout(() => {
          const input = modal.querySelector('.whl-modal-input');
          if (input) {
            input.focus();
            input.select();
          }
        }, 100);
      });
    }
  };

  // ============================================
  // LOADING MANAGER
  // ============================================

  const LoadingManager = {
    overlay: null,

    show(message) {
      // PEND-LOW-001 FIX: Usar i18n ao invés de hardcoded
      const defaultMessage = (typeof window.t === 'function') ? window.t('common.loading') : 'Carregando...';
      message = message || defaultMessage;

      this.hide();

      this.overlay = document.createElement('div');
      this.overlay.className = 'whl-loading-overlay';
      this.overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 99999;
      `;

      // SECURITY FIX P0-004: Escape message to prevent XSS
      this.overlay.innerHTML = `
        <div class="whl-spinner" style="
          width: 48px;
          height: 48px;
          border: 4px solid rgba(139, 92, 246, 0.2);
          border-top-color: #8B5CF6;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        "></div>
        <p style="color: white; margin-top: 16px; font-size: 14px;">${escapeHtml(message)}</p>
      `;

      document.body.appendChild(this.overlay);
    },

    hide() {
      if (this.overlay) {
        this.overlay.remove();
        this.overlay = null;
      }
    },

    async withLoading(fn, message) {
      this.show(message);
      try {
        return await fn();
      } finally {
        this.hide();
      }
    }
  };

  // ============================================
  // GLOBAL STYLES
  // ============================================

  function injectStyles() {
    if (document.getElementById('whl-modern-ui-styles')) return;

    const style = document.createElement('style');
    style.id = 'whl-modern-ui-styles';
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
      @keyframes modalIn {
        from { transform: scale(0.9); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }
      @keyframes modalOut {
        from { transform: scale(1); opacity: 1; }
        to { transform: scale(0.9); opacity: 0; }
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      .whl-modal-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
      }
      
      .whl-modal-btn.primary:hover {
        background: linear-gradient(135deg, #9F7AEA, #8B5CF6) !important;
      }

      /* Switches */
      .whl-switch {
        position: relative;
        display: inline-block;
        width: 44px;
        height: 24px;
      }
      .whl-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      .whl-switch-slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(255,255,255,0.2);
        transition: 0.3s;
        border-radius: 24px;
      }
      .whl-switch-slider:before {
        position: absolute;
        content: "";
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: 0.3s;
        border-radius: 50%;
      }
      .whl-switch input:checked + .whl-switch-slider {
        background-color: #8B5CF6;
      }
      .whl-switch input:checked + .whl-switch-slider:before {
        transform: translateX(20px);
      }

      /* Inputs */
      .whl-input {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 8px;
        background: rgba(0,0,0,0.3);
        color: white;
        font-size: 14px;
        transition: all 0.2s;
        box-sizing: border-box;
      }
      .whl-input:focus {
        outline: none;
        border-color: rgba(139, 92, 246, 0.5);
        box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
      }
      .whl-input::placeholder {
        color: rgba(255,255,255,0.4);
      }

      /* Buttons */
      .whl-btn {
        padding: 10px 16px;
        border-radius: 8px;
        border: none;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .whl-btn-primary {
        background: linear-gradient(135deg, #8B5CF6, #7C3AED);
        color: white;
      }
      .whl-btn-primary:hover {
        background: linear-gradient(135deg, #9F7AEA, #8B5CF6);
        transform: translateY(-1px);
      }
      .whl-btn-secondary {
        background: rgba(255,255,255,0.1);
        color: white;
      }
      .whl-btn-secondary:hover {
        background: rgba(255,255,255,0.15);
      }
      .whl-btn-danger {
        background: rgba(239, 68, 68, 0.8);
        color: white;
      }
      .whl-btn-danger:hover {
        background: rgba(239, 68, 68, 1);
      }
      .whl-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Cards */
      .whl-card {
        background: rgba(26, 26, 46, 0.95);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        padding: 16px;
        transition: all 0.3s;
      }
      .whl-card:hover {
        border-color: rgba(139, 92, 246, 0.3);
      }
      .whl-card-title {
        font-size: 14px;
        font-weight: 600;
        color: white;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .whl-card-muted {
        font-size: 12px;
        color: rgba(255,255,255,0.6);
      }

      /* Badges */
      .whl-badge {
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 500;
      }
      .whl-badge-purple {
        background: rgba(139, 92, 246, 0.2);
        color: #A78BFA;
      }
      .whl-badge-green {
        background: rgba(16, 185, 129, 0.2);
        color: #10B981;
      }
      .whl-badge-red {
        background: rgba(239, 68, 68, 0.2);
        color: #EF4444;
      }
      .whl-badge-yellow {
        background: rgba(245, 158, 11, 0.2);
        color: #F59E0B;
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  function init() {
    injectStyles();
    console.log(`[ModernUI] v${VERSION} initialized`);
  }

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export
  const ModernUI = {
    VERSION,
    Toast: ToastManager,
    Modal: ModalManager,
    Loading: LoadingManager,
    toast: (msg, type, dur) => ToastManager.show(msg, type, dur),
    confirm: (msg, title) => ModalManager.confirm(msg, title),
    alert: (msg, title) => ModalManager.alert(msg, title),
    prompt: (msg, def, title) => ModalManager.prompt(msg, def, title),
    loading: (msg) => LoadingManager.show(msg),
    hideLoading: () => LoadingManager.hide()
  };

  if (typeof window !== 'undefined') {
    window.ModernUI = ModernUI;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ModernUI;
  }

})();
