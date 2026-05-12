/**
 * notifications.js - Sistema de Notificações Desktop
 * 
 * Gerencia notificações desktop e sons para alertas importantes
 * como conclusão de campanhas, erros e limites atingidos.
 */

class NotificationSystem {
  constructor() {
    this.STORAGE_KEY = 'whl_notification_settings';
    this.enabled = true;
    this.soundEnabled = true;
    this.audioContext = null; // Reuse AudioContext
    this.init();
  }

  async init() {
    try {
      await this.loadSettings();
      console.log('[Notifications] Inicializado - Ativadas:', this.enabled, 'Som:', this.soundEnabled);
    } catch (error) {
      console.error('[Notifications] Erro na inicialização:', error);
    }
  }
  
  /**
   * Get or create AudioContext (reuse existing one)
   */
  getAudioContext() {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this.audioContext;
  }

  /**
   * Carrega configurações do storage
   */
  async loadSettings() {
    try {
      const data = await chrome.storage.local.get(this.STORAGE_KEY);
      const settings = data[this.STORAGE_KEY] || {};
      
      this.enabled = settings.enabled !== false; // default true
      this.soundEnabled = settings.soundEnabled !== false; // default true
      
      return settings;
    } catch (error) {
      console.error('[Notifications] Erro ao carregar configurações:', error);
      return {};
    }
  }

  /**
   * Salva configurações no storage
   */
  async saveSettings() {
    try {
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: {
          enabled: this.enabled,
          soundEnabled: this.soundEnabled
        }
      });
    } catch (error) {
      console.error('[Notifications] Erro ao salvar configurações:', error);
      throw error;
    }
  }



  /**
   * Envia uma notificação
   * @param {string} title - Título da notificação
   * @param {string} body - Corpo da notificação
   * @param {Object} options - Opções adicionais
   * @returns {Promise<string>} - ID da notificação criada
   */
  async notify(title, body, options = {}) {
    if (!this.enabled) {
      console.log('[Notifications] Notificações desativadas');
      return null;
    }
    
    try {
      const notificationId = options.tag || `whl-${Date.now()}`;
      
      await chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/128.png'),
        title: title,
        message: body,
        priority: 2,
        requireInteraction: options.requireInteraction || false
      });
      
      // Auto-fechar após duração especificada
      if (!options.requireInteraction) {
        setTimeout(() => {
          chrome.notifications.clear(notificationId);
        }, options.duration || 5000);
      }
      
      // Tocar som se habilitado
      if (this.soundEnabled && options.sound) {
        this.playSound(options.soundType || 'default');
      }
      
      return notificationId;
    } catch (error) {
      console.error('[Notifications] Erro ao criar notificação:', error);
      return null;
    }
  }

  /**
   * Toca um som usando Web Audio API
   * @param {string} type - Tipo de som (success, error, warning, default)
   */
  playSound(type) {
    try {
      const ctx = this.getAudioContext();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      // Configurar som baseado no tipo
      switch (type) {
        case 'success':
          // Tom agradável (E5)
          oscillator.frequency.value = 659.25;
          gainNode.gain.value = 0.3;
          break;
        case 'error':
          // Tom grave de erro (C3)
          oscillator.frequency.value = 130.81;
          gainNode.gain.value = 0.3;
          break;
        case 'warning':
          // Tom médio de aviso (G4)
          oscillator.frequency.value = 392.00;
          gainNode.gain.value = 0.3;
          break;
        default:
          // Tom padrão (C4)
          oscillator.frequency.value = 261.63;
          gainNode.gain.value = 0.3;
      }
      
      oscillator.start();
      
      // Fade out
      setTimeout(() => {
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        setTimeout(() => {
          oscillator.stop();
          oscillator.disconnect();
          gainNode.disconnect();
        }, 100);
      }, 200);
    } catch (error) {
      console.error('[Notifications] Erro ao tocar som:', error);
    }
  }

  /**
   * Notifica conclusão de campanha
   * @param {number} sent - Quantidade enviada
   * @param {number} failed - Quantidade que falhou
   */
  async campaignComplete(sent, failed) {
    const total = sent + failed;
    const successRate = total > 0 ? Math.round((sent / total) * 100) : 0;
    
    await this.notify(
      '✅ Campanha Concluída!',
      `Enviadas: ${sent} | Falhas: ${failed} | Taxa de sucesso: ${successRate}%`,
      {
        sound: true,
        soundType: 'success',
        tag: 'campaign-complete',
        requireInteraction: false
      }
    );
  }

  /**
   * Notifica erro na campanha
   * @param {string} error - Mensagem de erro
   */
  async campaignError(error) {
    await this.notify(
      '❌ Erro na Campanha',
      error || 'Ocorreu um erro durante o envio',
      {
        sound: true,
        soundType: 'error',
        tag: 'campaign-error',
        requireInteraction: true
      }
    );
  }

  /**
   * Notifica aviso de limite diário
   * @param {number} current - Quantidade atual
   * @param {number} limit - Limite configurado
   */
  async dailyLimitWarning(current, limit) {
    const percentage = Math.round((current / limit) * 100);
    
    await this.notify(
      '⚠️ Limite Diário',
      `${current}/${limit} mensagens enviadas (${percentage}%)`,
      {
        sound: true,
        soundType: 'warning',
        tag: 'daily-limit',
        requireInteraction: false
      }
    );
  }

  /**
   * Notifica limite diário atingido
   * @param {number} limit - Limite configurado
   */
  async dailyLimitReached(limit) {
    await this.notify(
      '🛑 Limite Diário Atingido',
      `Limite de ${limit} mensagens atingido hoje`,
      {
        sound: true,
        soundType: 'error',
        tag: 'daily-limit-reached',
        requireInteraction: true
      }
    );
  }

  /**
   * Notifica campanha agendada
   * @param {string} name - Nome da campanha
   * @param {string} time - Horário agendado
   */
  async scheduleCreated(name, time) {
    await this.notify(
      '📅 Campanha Agendada',
      `"${name}" agendada para ${time}`,
      {
        sound: true,
        soundType: 'default',
        tag: 'schedule-created',
        requireInteraction: false
      }
    );
  }

  /**
   * Notifica início de campanha agendada
   * @param {string} name - Nome da campanha
   */
  async scheduleStarting(name) {
    await this.notify(
      '🚀 Iniciando Campanha Agendada',
      `"${name}" está começando agora`,
      {
        sound: true,
        soundType: 'default',
        tag: 'schedule-starting',
        requireInteraction: false
      }
    );
  }

  /**
   * Ativa/desativa notificações
   * @param {boolean} enabled - true para ativar
   */
  async setEnabled(enabled) {
    this.enabled = !!enabled;
    await this.saveSettings();
  }

  /**
   * Ativa/desativa sons
   * @param {boolean} enabled - true para ativar
   */
  async setSoundEnabled(enabled) {
    this.soundEnabled = !!enabled;
    await this.saveSettings();
  }

  /**
   * Obtém configurações atuais
   */
  getSettings() {
    return {
      enabled: this.enabled,
      soundEnabled: this.soundEnabled,
      permission: 'granted' // chrome.notifications sempre tem permissão via manifest
    };
  }

  /**
   * Testa o sistema de notificações
   */
  async test() {
    await this.notify(
      '🔔 Teste de Notificação',
      'O sistema de notificações está funcionando corretamente!',
      {
        sound: true,
        soundType: 'success',
        tag: 'test-notification',
        duration: 3000
      }
    );
  }
}

// Exportar instância global
if (typeof window !== 'undefined') {
  window.notificationSystem = new NotificationSystem();
}

// ============================================
// TOAST SYSTEM - Notificações In-Page
// ============================================

/**
 * Sistema de Toast centralizado para notificações na página
 */
const WHLToast = {
  container: null,
  
  /**
   * Cria o container de toasts se não existir
   */
  _ensureContainer() {
    if (!this.container || !document.body.contains(this.container)) {
      this.container = document.createElement('div');
      this.container.id = 'whl-toast-container';
      this.container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 350px;
      `;
      document.body.appendChild(this.container);
    }
    return this.container;
  },

  /**
   * Exibe um toast
   * @param {string} message - Mensagem a exibir
   * @param {string} type - Tipo: success, error, warning, info
   * @param {number} duration - Duração em ms (default: 3000)
   */
  show(message, type = 'info', duration = 3000) {
    const container = this._ensureContainer();
    
    const toast = document.createElement('div');
    toast.className = `whl-toast whl-toast-${type}`;
    
    const colors = {
      success: { bg: '#10B981', icon: '✅' },
      error: { bg: '#EF4444', icon: '❌' },
      warning: { bg: '#F59E0B', icon: '⚠️' },
      info: { bg: '#3B82F6', icon: 'ℹ️' }
    };
    
    const config = colors[type] || colors.info;
    
    toast.style.cssText = `
      background: ${config.bg};
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
      animation: whl-toast-slide-in 0.3s ease-out;
      cursor: pointer;
    `;
    
    toast.innerHTML = `
      <span style="font-size: 18px;">${config.icon}</span>
      <span style="flex: 1;">${this._escapeHtml(message)}</span>
      <span style="opacity: 0.7; cursor: pointer;" onclick="this.parentElement.remove()">✕</span>
    `;
    
    // Adiciona animação CSS se não existir
    if (!document.getElementById('whl-toast-styles')) {
      const style = document.createElement('style');
      style.id = 'whl-toast-styles';
      style.textContent = `
        @keyframes whl-toast-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes whl-toast-slide-out {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }
    
    container.appendChild(toast);
    
    // Clique para fechar
    toast.addEventListener('click', () => {
      this._removeToast(toast);
    });
    
    // Auto-remover após duração
    if (duration > 0) {
      setTimeout(() => {
        this._removeToast(toast);
      }, duration);
    }
    
    return toast;
  },
  
  /**
   * Remove um toast com animação
   */
  _removeToast(toast) {
    if (!toast || !toast.parentElement) return;
    toast.style.animation = 'whl-toast-slide-out 0.2s ease-in forwards';
    setTimeout(() => toast.remove(), 200);
  },
  
  /**
   * Escapa HTML para prevenir XSS
   */
  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
  
  // Atalhos
  success(message, duration) { return this.show(message, 'success', duration); },
  error(message, duration) { return this.show(message, 'error', duration); },
  warning(message, duration) { return this.show(message, 'warning', duration); },
  info(message, duration) { return this.show(message, 'info', duration); }
};

/**
 * Função global showToast para compatibilidade
 */
function showToast(message, type = 'info', duration = 3000) {
  return WHLToast.show(message, type, duration);
}

// Expor globalmente
if (typeof window !== 'undefined') {
  window.WHLToast = WHLToast;
  window.showToast = showToast;
}
