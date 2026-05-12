/**
 * scheduler.js - Sistema de Agendamento de Campanhas
 * 
 * Permite agendar múltiplas campanhas para serem executadas automaticamente
 * em horários específicos usando a chrome.alarms API.
 */

class SchedulerManager {
  constructor() {
    this.STORAGE_KEY = 'whl_schedules';
    this.schedules = [];
    this.init();
  }

  async init() {
    try {
      await this.loadSchedules();
      console.log('[Scheduler] Inicializado com', this.schedules.length, 'agendamentos');
    } catch (error) {
      console.error('[Scheduler] Erro na inicialização:', error);
    }
  }

  /**
   * Carrega agendamentos do storage
   */
  async loadSchedules() {
    try {
      const data = await chrome.storage.local.get(this.STORAGE_KEY);
      this.schedules = data[this.STORAGE_KEY] || [];
      
      // Limpar agendamentos antigos (mais de 30 dias)
      const now = Date.now();
      this.schedules = this.schedules.filter(s => {
        const scheduledTime = new Date(s.scheduledTime).getTime();
        return scheduledTime > now - (30 * 24 * 60 * 60 * 1000);
      });
      
      await this.saveSchedules();
      return this.schedules;
    } catch (error) {
      console.error('[Scheduler] Erro ao carregar agendamentos:', error);
      return [];
    }
  }

  /**
   * Salva agendamentos no storage
   */
  async saveSchedules() {
    try {
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: this.schedules
      });
    } catch (error) {
      console.error('[Scheduler] Erro ao salvar agendamentos:', error);
      throw error;
    }
  }

  /**
   * Cria um novo agendamento
   */
  async createSchedule(schedule) {
    try {
      // Validar dados
      if (!schedule.name || !schedule.scheduledTime) {
        throw new Error('Nome e horário são obrigatórios');
      }

      const scheduledTime = new Date(schedule.scheduledTime);
      const now = new Date();

      if (scheduledTime <= now) {
        throw new Error('O horário deve ser no futuro');
      }

      // Criar agendamento
      const newSchedule = {
        id: Date.now().toString(),
        name: schedule.name,
        scheduledTime: schedule.scheduledTime,
        status: 'pending',
        queue: schedule.queue || [],
        config: schedule.config || {},
        createdAt: new Date().toISOString()
      };

      this.schedules.push(newSchedule);
      await this.saveSchedules();

      // Criar alarm no Chrome
      const alarmName = `whl_schedule_${newSchedule.id}`;
      await chrome.alarms.create(alarmName, {
        when: scheduledTime.getTime()
      });

      console.log('[Scheduler] Agendamento criado:', newSchedule.id);
      return newSchedule;
    } catch (error) {
      console.error('[Scheduler] Erro ao criar agendamento:', error);
      throw error;
    }
  }

  /**
   * Remove um agendamento
   */
  async deleteSchedule(scheduleId) {
    try {
      const index = this.schedules.findIndex(s => s.id === scheduleId);
      
      if (index === -1) {
        throw new Error('Agendamento não encontrado');
      }

      // Remover alarm do Chrome
      const alarmName = `whl_schedule_${scheduleId}`;
      await chrome.alarms.clear(alarmName);

      // Remover do array
      this.schedules.splice(index, 1);
      await this.saveSchedules();

      console.log('[Scheduler] Agendamento removido:', scheduleId);
      return true;
    } catch (error) {
      console.error('[Scheduler] Erro ao remover agendamento:', error);
      throw error;
    }
  }

  /**
   * Obtém um agendamento por ID
   */
  getSchedule(scheduleId) {
    return this.schedules.find(s => s.id === scheduleId);
  }

  /**
   * Obtém todos os agendamentos - SEMPRE carrega do storage para garantir dados atualizados
   */
  async getAllSchedules() {
    // Sempre recarregar do storage para ter dados atualizados
    await this.loadSchedules();
    return [...this.schedules].sort((a, b) => {
      return new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime();
    });
  }
  
  /**
   * Versão síncrona (usa cache local - pode estar desatualizado)
   */
  getAllSchedulesSync() {
    return [...this.schedules].sort((a, b) => {
      return new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime();
    });
  }

  /**
   * Obtém agendamentos pendentes
   */
  getPendingSchedules() {
    return this.schedules.filter(s => s.status === 'pending');
  }

  /**
   * Atualiza o status de um agendamento
   */
  async updateScheduleStatus(scheduleId, status) {
    try {
      const schedule = this.getSchedule(scheduleId);
      
      if (!schedule) {
        throw new Error('Agendamento não encontrado');
      }

      schedule.status = status;
      
      if (status === 'completed' || status === 'failed') {
        schedule.completedAt = new Date().toISOString();
      }

      await this.saveSchedules();
      return schedule;
    } catch (error) {
      console.error('[Scheduler] Erro ao atualizar status:', error);
      throw error;
    }
  }

  /**
   * Executa um agendamento
   */
  async executeSchedule(scheduleId) {
    try {
      const schedule = this.getSchedule(scheduleId);
      
      if (!schedule) {
        throw new Error('Agendamento não encontrado');
      }

      console.log('[Scheduler] Executando agendamento:', schedule.name);

      // Atualizar status para running
      await this.updateScheduleStatus(scheduleId, 'running');

      // Enviar mensagem para iniciar campanha
      chrome.runtime.sendMessage({
        action: 'START_SCHEDULED_CAMPAIGN',
        scheduleId: scheduleId,
        queue: schedule.queue,
        config: schedule.config
      }).catch(err => {
        console.error('[Scheduler] Erro ao enviar mensagem:', err);
      });

      // Iniciar monitoramento de progresso
      this.startProgressMonitoring(scheduleId);

      return schedule;
    } catch (error) {
      console.error('[Scheduler] Erro ao executar agendamento:', error);
      await this.updateScheduleStatus(scheduleId, 'failed');
      throw error;
    }
  }

  /**
   * Monitorar progresso de uma campanha agendada
   * CORRIGIDO: Agora busca estado real da fila via chrome.storage
   */
  startProgressMonitoring(scheduleId) {
    const checkProgress = async () => {
      try {
        const schedule = this.getSchedule(scheduleId);
        if (!schedule || schedule.status !== 'running') {
          return; // Parar monitoramento
        }

        // CORRIGIDO: Buscar estado REAL da fila do storage, não da schedule local
        const queueData = await chrome.storage.local.get('whl_queue');
        const realQueue = queueData.whl_queue || [];
        
        // Verificar se a campanha terminou
        const sent = realQueue.filter(c => c.status === 'sent').length;
        const failed = realQueue.filter(c => c.status === 'failed').length;
        const total = realQueue.length;
        const pending = realQueue.filter(c => ['pending', 'opened', 'confirming', 'pending_retry'].includes(c.status)).length;

        console.log(`[Scheduler] Progresso "${schedule.name}": ${sent}/${total} enviadas, ${failed} falharam, ${pending} pendentes`);

        // Atualizar UI via chrome.runtime.sendMessage
        try {
          chrome.runtime.sendMessage({
            action: 'QUEUE_PROGRESS_UPDATE',
            data: {
              sent,
              failed,
              pending,
              total,
              completed: sent + failed,
              percentage: total > 0 ? Math.round(((sent + failed) / total) * 100) : 0
            }
          }).catch(() => {});
        } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

        // Verificar se terminou (não há mais pendentes e pelo menos uma foi processada)
        if (pending === 0 && (sent + failed) > 0) {
          await this.updateScheduleStatus(scheduleId, 'completed');
          console.log(`[Scheduler] ✅ Campanha "${schedule.name}" concluída: ${sent} enviadas, ${failed} falharam`);
          
          // Notificar UI para atualizar lista de agendamentos
          try {
            chrome.runtime.sendMessage({ action: 'SCHEDULE_COMPLETED', scheduleId }).catch(() => {});
          } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
          return;
        }

        // Se a fila está vazia mas não processou nada, pode ter sido limpa (parada manual)
        if (total === 0) {
          await this.updateScheduleStatus(scheduleId, 'completed');
          console.log(`[Scheduler] Campanha "${schedule.name}" finalizada (fila vazia)`);
          return;
        }

        // Continuar monitoramento
        setTimeout(checkProgress, 3000); // Verificar a cada 3 segundos
      } catch (e) {
        console.error('[Scheduler] Erro no monitoramento:', e);
        // Continuar tentando mesmo com erro
        setTimeout(checkProgress, 5000);
      }
    };

    // Iniciar após 2 segundos
    setTimeout(checkProgress, 2000);
  }

  /**
   * Atualizar progresso de um item na fila do agendamento
   */
  async updateQueueItemStatus(scheduleId, phoneIndex, status) {
    try {
      const schedule = this.getSchedule(scheduleId);
      if (!schedule || !schedule.queue || !schedule.queue[phoneIndex]) return;

      schedule.queue[phoneIndex].status = status;
      await this.saveSchedules();
    } catch (error) {
      console.error('[Scheduler] Erro ao atualizar item da fila:', error);
    }
  }

  /**
   * Formata um agendamento para exibição
   */
  formatSchedule(schedule) {
    const scheduledTime = new Date(schedule.scheduledTime);
    const now = new Date();
    const diff = scheduledTime.getTime() - now.getTime();

    let timeRemaining = '';
    if (diff > 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      
      if (hours > 24) {
        const days = Math.floor(hours / 24);
        timeRemaining = `${days} dia(s)`;
      } else if (hours > 0) {
        timeRemaining = `${hours}h ${minutes}min`;
      } else {
        timeRemaining = `${minutes} minuto(s)`;
      }
    }

    return {
      ...schedule,
      scheduledTimeFormatted: scheduledTime.toLocaleString('pt-BR'),
      timeRemaining: timeRemaining,
      queueSize: schedule.queue?.length || 0
    };
  }
}

// Exportar instância global
if (typeof window !== 'undefined') {
  window.schedulerManager = new SchedulerManager();
}
