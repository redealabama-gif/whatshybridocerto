/**
 * anti-ban.js - Sistema Anti-Ban Inteligente
 * 
 * Implementa delays com variação gaussiana e limite diário de mensagens
 * para simular comportamento humano e evitar bloqueios.
 */

class AntiBanSystem {
  constructor() {
    this.STORAGE_KEY = 'whl_anti_ban_data';
    this.dailyLimit = 200;
    this.sentToday = 0;
    this.warningThreshold = 0.8;
    this.businessHoursOnly = false;
    this.lastResetDate = null;
    this.init();
  }

  async init() {
    try {
      await this.loadData();
      await this.checkDailyReset();
      console.log('[AntiBan] Inicializado - Enviadas hoje:', this.sentToday, '/', this.dailyLimit);
    } catch (error) {
      console.error('[AntiBan] Erro na inicialização:', error);
    }
  }

  /**
   * Carrega dados do storage
   */
  async loadData() {
    try {
      const data = await chrome.storage.local.get(this.STORAGE_KEY);
      const saved = data[this.STORAGE_KEY] || {};
      
      this.dailyLimit = saved.dailyLimit || 200;
      this.sentToday = saved.sentToday || 0;
      this.warningThreshold = saved.warningThreshold || 0.8;
      this.businessHoursOnly = saved.businessHoursOnly || false;
      this.lastResetDate = saved.lastResetDate || this.getTodayDate();
      
      return saved;
    } catch (error) {
      console.error('[AntiBan] Erro ao carregar dados:', error);
      return {};
    }
  }

  /**
   * Salva dados no storage
   */
  async saveData() {
    try {
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: {
          dailyLimit: this.dailyLimit,
          sentToday: this.sentToday,
          warningThreshold: this.warningThreshold,
          businessHoursOnly: this.businessHoursOnly,
          lastResetDate: this.lastResetDate
        }
      });
    } catch (error) {
      console.error('[AntiBan] Erro ao salvar dados:', error);
      throw error;
    }
  }

  /**
   * Obtém a data de hoje no formato YYYY-MM-DD
   */
  getTodayDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  /**
   * Verifica se precisa resetar contador diário
   */
  async checkDailyReset() {
    const today = this.getTodayDate();
    
    if (this.lastResetDate !== today) {
      console.log('[AntiBan] Novo dia detectado - resetando contador');
      this.sentToday = 0;
      this.lastResetDate = today;
      await this.saveData();
    }
  }

  /**
   * Calcula delay inteligente com variação gaussiana
   */
  calculateSmartDelay(baseMin, baseMax) {
    // Função gaussiana (Box-Muller transform) com safety counter
    const gaussian = () => {
      let u = 0, v = 0;
      let counter = 0;
      const maxIterations = 100;
      
      while (u === 0 && counter < maxIterations) {
        u = Math.random();
        counter++;
      }
      
      counter = 0;
      while (v === 0 && counter < maxIterations) {
        v = Math.random();
        counter++;
      }
      
      // Fallback if random generation failed
      if (u === 0) u = 0.5;
      if (v === 0) v = 0.5;
      
      return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    };
    
    // Calcular média e desvio padrão
    const mean = (baseMin + baseMax) / 2;
    const stdDev = (baseMax - baseMin) / 4;
    
    // Aplicar variação gaussiana
    let delay = mean + gaussian() * stdDev;
    
    // Pausas aleatórias humanas (10% de chance)
    if (Math.random() < 0.1) {
      delay += Math.random() * 10000; // até 10 segundos extras
    }
    
    // Garantir que está dentro dos limites (com margem de 50%)
    return Math.max(baseMin, Math.min(baseMax * 1.5, delay));
  }

  /**
   * Incrementa contador e verifica limites
   */
  async incrementSentCount() {
    await this.checkDailyReset();
    
    this.sentToday++;
    await this.saveData();
    
    // Notificar UI para atualizar barra de progresso
    this.notifyUIUpdate();
    
    const warningLimit = Math.floor(this.dailyLimit * this.warningThreshold);
    
    if (this.sentToday >= this.dailyLimit) {
      return { 
        blocked: true, 
        current: this.sentToday, 
        limit: this.dailyLimit,
        message: `Limite diário atingido (${this.sentToday}/${this.dailyLimit})`
      };
    }
    
    if (this.sentToday >= warningLimit) {
      return { 
        warning: true, 
        current: this.sentToday, 
        limit: this.dailyLimit,
        message: `Próximo do limite diário (${this.sentToday}/${this.dailyLimit})`
      };
    }
    
    return { 
      ok: true, 
      current: this.sentToday, 
      limit: this.dailyLimit 
    };
  }

  /**
   * Notificar UI para atualizar displays
   * Usa múltiplos métodos para garantir que a UI seja atualizada
   */
  notifyUIUpdate() {
    const updateData = {
      sentToday: this.sentToday,
      dailyLimit: this.dailyLimit,
      percentage: Math.round((this.sentToday / this.dailyLimit) * 100),
      timestamp: Date.now()
    };
    
    // Método 1: Emitir evento customizado (para mesmo contexto)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('antiban-update', {
        detail: updateData
      }));
    }
    
    // Método 2: chrome.storage para persistência e sincronização entre tabs
    try {
      chrome.storage.local.set({
        'whl_antiban_ui_update': updateData
      });
    } catch (e) {
      // Ignorar erros de storage
    }
    
    // Método 3: chrome.runtime.sendMessage para comunicação com sidepanel
    try {
      chrome.runtime.sendMessage({
        action: 'ANTIBAN_UPDATE',
        data: updateData
      }).catch(() => {
        // Ignorar erros se não houver listener
      });
    } catch (e) {
      // Ignorar erros de messaging
    }
  }

  /**
   * Verifica se está dentro do horário comercial (8h-20h)
   */
  isWithinBusinessHours() {
    const hour = new Date().getHours();
    return hour >= 8 && hour <= 20;
  }

  /**
   * Verifica se pode enviar mensagem agora
   */
  async canSendNow() {
    await this.checkDailyReset();
    
    // Verificar limite diário
    if (this.sentToday >= this.dailyLimit) {
      return {
        allowed: false,
        reason: 'daily_limit',
        message: `Limite diário atingido (${this.sentToday}/${this.dailyLimit})`
      };
    }
    
    // Verificar horário comercial (se ativado)
    if (this.businessHoursOnly && !this.isWithinBusinessHours()) {
      const hour = new Date().getHours();
      return {
        allowed: false,
        reason: 'business_hours',
        message: `Fora do horário comercial (8h-20h). Horário atual: ${hour}h`
      };
    }
    
    return {
      allowed: true,
      current: this.sentToday,
      limit: this.dailyLimit
    };
  }

  /**
   * Define o limite diário
   */
  async setDailyLimit(limit) {
    if (limit < 1 || limit > 1000) {
      throw new Error('Limite deve estar entre 1 e 1000');
    }
    
    this.dailyLimit = limit;
    await this.saveData();
  }

  /**
   * Define se deve enviar apenas em horário comercial
   */
  async setBusinessHoursOnly(enabled) {
    this.businessHoursOnly = !!enabled;
    await this.saveData();
  }

  /**
   * Reseta o contador diário (uso manual)
   */
  async resetDailyCount() {
    this.sentToday = 0;
    this.lastResetDate = this.getTodayDate();
    await this.saveData();
    console.log('[AntiBan] Contador resetado manualmente');
  }

  /**
   * Obtém estatísticas atuais
   */
  async getStats() {
    // Garantir que dados estão carregados do storage
    await this.loadData();
    await this.checkDailyReset();
    
    const percentage = Math.round((this.sentToday / this.dailyLimit) * 100);
    const remaining = this.dailyLimit - this.sentToday;
    const warningLimit = Math.floor(this.dailyLimit * this.warningThreshold);
    
    return {
      sentToday: this.sentToday,
      dailyLimit: this.dailyLimit,
      remaining: remaining,
      percentage: percentage,
      isNearLimit: this.sentToday >= warningLimit,
      isAtLimit: this.sentToday >= this.dailyLimit,
      businessHoursOnly: this.businessHoursOnly,
      isBusinessHours: this.isWithinBusinessHours()
    };
  }

  /**
   * Calcula tempo de espera até o horário comercial
   */
  getTimeUntilBusinessHours() {
    const now = new Date();
    const hour = now.getHours();
    
    if (hour >= 8 && hour < 20) {
      return 0; // Já está no horário comercial
    }
    
    // Calcular próximo horário comercial
    let targetHour = 8;
    let daysToAdd = 0;
    
    if (hour >= 20) {
      // Após 20h, próximo horário é amanhã às 8h
      daysToAdd = 1;
    }
    
    const target = new Date(now);
    target.setDate(target.getDate() + daysToAdd);
    target.setHours(targetHour, 0, 0, 0);
    
    const diff = target.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    return {
      milliseconds: diff,
      hours: hours,
      minutes: minutes,
      formatted: `${hours}h ${minutes}min`
    };
  }
}

// Exportar instância global
if (typeof window !== 'undefined') {
  window.antiBanSystem = new AntiBanSystem();
}
