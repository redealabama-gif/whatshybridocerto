/**
 * 📅 Scheduler + Fila Global v2.0
 * Sistema centralizado de agendamento e fila de tarefas
 * 
 * Evita conflitos entre:
 * - Backup/Recover
 * - Disparo de campanhas
 * - Automações
 * - Sincronização
 * - Outras operações que precisam de foco exclusivo
 * 
 * ✨ NOVO v2.0:
 * - Cron expressions simples
 * - Chrome Alarms integration
 * - Persistência de tarefas
 * - Frequências: diário, semanal, mensal
 * - Horários específicos
 * 
 * @version 2.0.0
 */
(function() {
  'use strict';

  let scheduledTasksInterval = null;
  let processQueueInterval = null;

  // ============================================
  // CONFIGURAÇÃO
  // ============================================

  const CONFIG = {
    MAX_CONCURRENT_JOBS: 3,
    MAX_QUEUE_SIZE: 100,
    DEFAULT_PRIORITY: 5,
    LOCK_TIMEOUT: 30000, // 30s
    RETRY_DELAY: 1000,
    MAX_RETRIES: 3,
    STORAGE_KEY: 'whl_scheduler_state',
    SCHEDULED_TASKS_KEY: 'whl_scheduled_tasks'
  };

  // ✨ Frequências suportadas
  const FREQUENCY = {
    ONCE: 'once',           // Uma vez
    INTERVAL: 'interval',   // A cada X ms
    DAILY: 'daily',         // Diariamente
    WEEKLY: 'weekly',       // Semanalmente
    MONTHLY: 'monthly',     // Mensalmente
    CRON: 'cron'           // Cron expression
  };

  // Prioridades (menor = maior prioridade)
  const PRIORITY = {
    CRITICAL: 1,
    HIGH: 3,
    NORMAL: 5,
    LOW: 7,
    BACKGROUND: 10
  };

  // Tipos de jobs
  const JOB_TYPE = {
    CAMPAIGN_DISPATCH: 'campaign_dispatch',
    MESSAGE_SEND: 'message_send',
    BACKUP_RUN: 'backup_run',
    SYNC_DATA: 'sync_data',
    AI_REQUEST: 'ai_request',
    MEDIA_DOWNLOAD: 'media_download',
    AUTOMATION: 'automation',
    SCHEDULE_MSG: 'schedule_msg',
    RECOVER_SCAN: 'recover_scan',
    CUSTOM: 'custom'
  };

  // ============================================
  // ESTADO
  // ============================================

  const state = {
    initialized: false,
    queue: [],
    running: new Map(),
    completed: [],
    failed: [],
    locks: new Map(),
    paused: false,
    processing: false
  };

  // ============================================
  // ESTRUTURA DO JOB
  // ============================================

  function createJob(options) {
    return {
      id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: options.type || JOB_TYPE.CUSTOM,
      priority: options.priority || PRIORITY.NORMAL,
      name: options.name || 'Unnamed Job',
      data: options.data || {},
      handler: options.handler,
      retries: 0,
      maxRetries: options.maxRetries ?? CONFIG.MAX_RETRIES,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      status: 'queued', // queued, running, completed, failed, cancelled
      result: null,
      error: null,
      exclusive: options.exclusive || false, // Se true, bloqueia outros jobs do mesmo tipo
      timeout: options.timeout || CONFIG.LOCK_TIMEOUT,
      onProgress: options.onProgress,
      onComplete: options.onComplete,
      onError: options.onError
    };
  }

  // ============================================
  // FILA
  // ============================================

  /**
   * Adiciona job à fila
   */
  function enqueue(options) {
    if (state.queue.length >= CONFIG.MAX_QUEUE_SIZE) {
      console.warn('[Scheduler] Fila cheia, job rejeitado');
      return null;
    }

    const job = createJob(options);
    
    // Inserir na posição correta baseado na prioridade
    let inserted = false;
    for (let i = 0; i < state.queue.length; i++) {
      if (job.priority < state.queue[i].priority) {
        state.queue.splice(i, 0, job);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      state.queue.push(job);
    }

    console.log(`[Scheduler] Job enfileirado: ${job.name} (${job.id})`);
    
    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit(window.WHL_EVENTS.SCHEDULER_JOB_QUEUED, { job });
    }

    // Processar fila
    processQueue();

    return job.id;
  }

  /**
   * Remove job da fila
   */
  function dequeue(jobId) {
    const index = state.queue.findIndex(j => j.id === jobId);
    if (index > -1) {
      const job = state.queue.splice(index, 1)[0];
      job.status = 'cancelled';
      return job;
    }
    return null;
  }

  /**
   * Processa a fila
   */
  async function processQueue() {
    if (state.paused || state.processing) return;
    if (state.running.size >= CONFIG.MAX_CONCURRENT_JOBS) return;
    if (state.queue.length === 0) return;

    state.processing = true;

    try {
      while (
        state.queue.length > 0 &&
        state.running.size < CONFIG.MAX_CONCURRENT_JOBS &&
        !state.paused
      ) {
        const job = getNextEligibleJob();
        if (!job) break;

        // Remover da fila
        const index = state.queue.indexOf(job);
        if (index > -1) state.queue.splice(index, 1);

        // Executar
        runJob(job);
      }
    } finally {
      state.processing = false;
    }
  }

  /**
   * Obtém próximo job elegível
   */
  function getNextEligibleJob() {
    for (const job of state.queue) {
      // Verificar se tipo exclusivo já está rodando
      if (job.exclusive && isTypeLocked(job.type)) {
        continue;
      }
      return job;
    }
    return null;
  }

  /**
   * Executa um job
   */
  async function runJob(job) {
    job.status = 'running';
    job.startedAt = Date.now();
    state.running.set(job.id, job);

    // Lock exclusivo
    if (job.exclusive) {
      acquireLock(job.type, job.id);
    }

    console.log(`[Scheduler] Executando: ${job.name}`);
    
    if (window.EventBus) {
      window.EventBus.emit(window.WHL_EVENTS.SCHEDULER_JOB_STARTED, { job });
    }

    try {
      // Timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Job timeout')), job.timeout);
      });

      // Executar handler
      const resultPromise = job.handler(job.data, {
        progress: (percent, message) => {
          job.progress = { percent, message };
          if (job.onProgress) job.onProgress(percent, message);
        }
      });

      job.result = await Promise.race([resultPromise, timeoutPromise]);
      job.status = 'completed';
      job.completedAt = Date.now();
      
      state.completed.push(job);
      if (state.completed.length > 50) state.completed.shift();

      console.log(`[Scheduler] ✅ Concluído: ${job.name}`);
      
      if (window.EventBus) {
        window.EventBus.emit(window.WHL_EVENTS.SCHEDULER_JOB_COMPLETED, { job });
      }
      
      if (job.onComplete) job.onComplete(job.result);

    } catch (error) {
      console.error(`[Scheduler] ❌ Erro em ${job.name}:`, error);
      job.error = error.message;
      
      // Retry
      if (job.retries < job.maxRetries) {
        job.retries++;
        job.status = 'queued';
        state.queue.unshift(job); // Recolocar no início
        
        console.log(`[Scheduler] Retry ${job.retries}/${job.maxRetries}: ${job.name}`);
      } else {
        job.status = 'failed';
        job.completedAt = Date.now();
        state.failed.push(job);
        if (state.failed.length > 50) state.failed.shift();

        if (window.EventBus) {
          window.EventBus.emit(window.WHL_EVENTS.SCHEDULER_JOB_FAILED, { job, error });
        }
        
        if (job.onError) job.onError(error);
      }

    } finally {
      state.running.delete(job.id);
      
      if (job.exclusive) {
        releaseLock(job.type);
      }

      // Continuar processando
      setTimeout(processQueue, 100);
    }
  }

  // ============================================
  // LOCKS
  // ============================================

  function acquireLock(type, jobId) {
    state.locks.set(type, {
      jobId,
      acquiredAt: Date.now()
    });
  }

  function releaseLock(type) {
    state.locks.delete(type);
  }

  function isTypeLocked(type) {
    if (!state.locks.has(type)) return false;
    
    const lock = state.locks.get(type);
    // Verificar timeout
    if (Date.now() - lock.acquiredAt > CONFIG.LOCK_TIMEOUT) {
      state.locks.delete(type);
      return false;
    }
    return true;
  }

  // ============================================
  // CONTROLE
  // ============================================

  function pause() {
    state.paused = true;
    console.log('[Scheduler] ⏸️ Pausado');
  }

  function resume() {
    state.paused = false;
    console.log('[Scheduler] ▶️ Retomado');
    processQueue();
  }

  function clear() {
    state.queue = [];
    console.log('[Scheduler] 🗑️ Fila limpa');
  }

  function cancelJob(jobId) {
    // Tentar remover da fila
    const dequeued = dequeue(jobId);
    if (dequeued) return true;

    // Verificar se está rodando
    if (state.running.has(jobId)) {
      const job = state.running.get(jobId);
      job.status = 'cancelled';
      return true;
    }

    return false;
  }

  // ============================================
  // HELPERS DE TIPOS COMUNS
  // ============================================

  /**
   * Enfileira envio de mensagem
   */
  function scheduleMessage(phone, text, options = {}) {
    return enqueue({
      type: JOB_TYPE.MESSAGE_SEND,
      name: `Enviar para ${phone}`,
      priority: options.priority || PRIORITY.NORMAL,
      data: { phone, text, ...options },
      handler: async (data) => {
        // Usar o sistema de envio existente
        if (window.MessageSender) {
          return await window.MessageSender.send(data.phone, data.text);
        }
        throw new Error('MessageSender não disponível');
      }
    });
  }

  /**
   * Enfileira campanha
   */
  function scheduleCampaign(campaignId, contacts, message, options = {}) {
    return enqueue({
      type: JOB_TYPE.CAMPAIGN_DISPATCH,
      name: `Campanha ${campaignId}`,
      priority: PRIORITY.LOW,
      exclusive: true, // Apenas uma campanha por vez
      data: { campaignId, contacts, message, ...options },
      timeout: 3600000, // 1 hora
      handler: async (data, { progress }) => {
        const total = data.contacts.length;
        let sent = 0;
        let failed = 0;

        for (const contact of data.contacts) {
          try {
            await scheduleMessage(contact.phone, data.message);
            sent++;
          } catch (e) {
            failed++;
          }
          progress(Math.round((sent + failed) / total * 100), `${sent}/${total} enviados`);
        }

        return { sent, failed, total };
      }
    });
  }

  /**
   * Enfileira requisição de IA
   */
  function scheduleAIRequest(prompt, options = {}) {
    return enqueue({
      type: JOB_TYPE.AI_REQUEST,
      name: 'Requisição IA',
      priority: PRIORITY.HIGH,
      data: { prompt, ...options },
      handler: async (data) => {
        if (window.AIGateway) {
          return await window.AIGateway.complete(data.prompt, data);
        }
        throw new Error('AIGateway não disponível');
      }
    });
  }

  /**
   * Enfileira sync
   */
  function scheduleSync(moduleKey, options = {}) {
    return enqueue({
      type: JOB_TYPE.SYNC_DATA,
      name: `Sync ${moduleKey}`,
      priority: PRIORITY.BACKGROUND,
      exclusive: true,
      data: { moduleKey, ...options },
      handler: async (data) => {
        if (window.DataSyncManager) {
          return await window.DataSyncManager.performSync();
        }
        throw new Error('DataSyncManager não disponível');
      }
    });
  }

  // ============================================
  // AGENDAMENTO (CRON-LIKE)
  // ============================================

  const scheduledTasks = new Map();

  /**
   * Agenda tarefa recorrente
   */
  function scheduleRecurring(name, interval, handler, options = {}) {
    const taskId = `recurring_${Date.now()}`;
    
    const task = {
      id: taskId,
      name,
      interval,
      handler,
      options,
      lastRun: null,
      nextRun: Date.now() + interval,
      enabled: true
    };

    scheduledTasks.set(taskId, task);

    console.log(`[Scheduler] ⏰ Tarefa agendada: ${name} (cada ${interval/1000}s)`);

    return taskId;
  }

  /**
   * Remove tarefa agendada
   */
  function unschedule(taskId) {
    scheduledTasks.delete(taskId);
  }

  /**
   * Verifica e executa tarefas agendadas
   */
  function checkScheduledTasks() {
    const now = Date.now();

    scheduledTasks.forEach((task, taskId) => {
      if (!task.enabled) return;
      if (now < task.nextRun) return;

      // Executar
      task.lastRun = now;
      task.nextRun = calculateNextRun(task);

      enqueue({
        type: JOB_TYPE.CUSTOM,
        name: task.name,
        priority: task.options.priority || PRIORITY.BACKGROUND,
        handler: task.handler,
        data: task.options.data || {}
      });

      // Se ONCE, desabilitar
      if (task.frequency === FREQUENCY.ONCE) {
        task.enabled = false;
        saveScheduledTasks();
      }
    });
  }

  // ============================================
  // ✨ NOVO v2.0: FREQUÊNCIAS AVANÇADAS
  // ============================================

  /**
   * Calcula próxima execução baseado na frequência
   */
  function calculateNextRun(task) {
    const now = new Date();

    switch (task.frequency) {
      case FREQUENCY.ONCE:
        return task.scheduledTime || Date.now();

      case FREQUENCY.INTERVAL:
        return Date.now() + (task.interval || 60000);

      case FREQUENCY.DAILY: {
        const next = new Date(now);
        if (task.time) {
          const [hours, minutes] = task.time.split(':').map(Number);
          next.setHours(hours, minutes, 0, 0);
          if (next <= now) {
            next.setDate(next.getDate() + 1);
          }
        } else {
          next.setDate(next.getDate() + 1);
        }
        return next.getTime();
      }

      case FREQUENCY.WEEKLY: {
        const next = new Date(now);
        const targetDay = task.dayOfWeek ?? 1; // 0=domingo, 1=segunda
        const daysUntilTarget = (targetDay - now.getDay() + 7) % 7 || 7;
        next.setDate(next.getDate() + daysUntilTarget);
        if (task.time) {
          const [hours, minutes] = task.time.split(':').map(Number);
          next.setHours(hours, minutes, 0, 0);
        }
        return next.getTime();
      }

      case FREQUENCY.MONTHLY: {
        const next = new Date(now);
        const targetDay = task.dayOfMonth ?? 1;
        next.setMonth(next.getMonth() + 1, targetDay);
        if (task.time) {
          const [hours, minutes] = task.time.split(':').map(Number);
          next.setHours(hours, minutes, 0, 0);
        }
        return next.getTime();
      }

      case FREQUENCY.CRON:
        return parseCronExpression(task.cronExpression, now);

      default:
        return Date.now() + (task.interval || 60000);
    }
  }

  /**
   * Parse simplificado de cron expression
   * Formato: "minuto hora dia_mes mes dia_semana"
   * Exemplo: "0 9 * * 1" = toda segunda às 9:00
   */
  function parseCronExpression(expr, fromDate = new Date()) {
    if (!expr) return Date.now() + 60000;

    try {
      const parts = expr.split(' ');
      if (parts.length < 5) return Date.now() + 60000;

      const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
      const next = new Date(fromDate);
      next.setSeconds(0, 0);

      // Hora e minuto
      if (minute !== '*') next.setMinutes(parseInt(minute));
      if (hour !== '*') next.setHours(parseInt(hour));

      // Se já passou hoje, avança para amanhã
      if (next <= fromDate) {
        next.setDate(next.getDate() + 1);
      }

      // Dia da semana (0-6, 0=domingo)
      if (dayOfWeek !== '*') {
        const targetDay = parseInt(dayOfWeek);
        while (next.getDay() !== targetDay) {
          next.setDate(next.getDate() + 1);
        }
      }

      // Dia do mês
      if (dayOfMonth !== '*') {
        next.setDate(parseInt(dayOfMonth));
        if (next <= fromDate) {
          next.setMonth(next.getMonth() + 1);
        }
      }

      // Mês (1-12)
      if (month !== '*') {
        next.setMonth(parseInt(month) - 1);
        if (next <= fromDate) {
          next.setFullYear(next.getFullYear() + 1);
        }
      }

      return next.getTime();
    } catch (e) {
      console.warn('[Scheduler] Erro ao parsear cron:', e);
      return Date.now() + 60000;
    }
  }

  /**
   * Agenda tarefa com frequência avançada
   */
  function scheduleAdvanced(name, config, handler) {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    const task = {
      id: taskId,
      name,
      frequency: config.frequency || FREQUENCY.INTERVAL,
      interval: config.interval,
      time: config.time,           // "HH:MM" para DAILY/WEEKLY/MONTHLY
      dayOfWeek: config.dayOfWeek, // 0-6 para WEEKLY
      dayOfMonth: config.dayOfMonth, // 1-31 para MONTHLY
      cronExpression: config.cron,
      scheduledTime: config.scheduledTime, // timestamp para ONCE
      handler,
      options: config.options || {},
      lastRun: null,
      nextRun: 0,
      enabled: true,
      createdAt: Date.now()
    };

    task.nextRun = calculateNextRun(task);
    scheduledTasks.set(taskId, task);
    saveScheduledTasks();

    console.log(`[Scheduler] ⏰ Tarefa agendada: ${name}`);
    console.log(`   Próxima execução: ${new Date(task.nextRun).toLocaleString()}`);

    // ✨ Usar Chrome Alarms para precisão (se disponível)
    setupChromeAlarm(task);

    return taskId;
  }

  /**
   * Configura Chrome Alarm para tarefa (mais preciso que setInterval)
   */
  function setupChromeAlarm(task) {
    if (typeof chrome === 'undefined' || !chrome.alarms) return;

    try {
      const alarmName = `whl_task_${task.id}`;
      const delayInMinutes = Math.max(1, (task.nextRun - Date.now()) / 60000);

      chrome.alarms.create(alarmName, {
        delayInMinutes,
        // Se recorrente, configura período
        ...(task.frequency !== FREQUENCY.ONCE && task.interval 
          ? { periodInMinutes: task.interval / 60000 } 
          : {})
      });
    } catch (e) {
      console.warn('[Scheduler] Chrome Alarms não disponível:', e.message);
    }
  }

  /**
   * Handler para Chrome Alarms
   */
  function handleChromeAlarm(alarm) {
    if (!alarm.name.startsWith('whl_task_')) return;

    const taskId = alarm.name.replace('whl_task_', '');
    const task = scheduledTasks.get(taskId);

    if (task && task.enabled) {
      task.lastRun = Date.now();
      task.nextRun = calculateNextRun(task);

      enqueue({
        type: JOB_TYPE.CUSTOM,
        name: task.name,
        priority: task.options.priority || PRIORITY.BACKGROUND,
        handler: task.handler,
        data: task.options.data || {}
      });

      if (task.frequency === FREQUENCY.ONCE) {
        task.enabled = false;
        chrome.alarms?.clear(alarm.name);
      }

      saveScheduledTasks();
    }
  }

  /**
   * Salva tarefas agendadas no storage
   */
  async function saveScheduledTasks() {
    try {
      const tasks = Array.from(scheduledTasks.entries()).map(([id, task]) => ({
        ...task,
        handler: task.handler?.toString() // Serializa função como string
      }));
      
      await chrome.storage.local.set({
        [CONFIG.SCHEDULED_TASKS_KEY]: JSON.stringify(tasks)
      });
    } catch (e) {
      console.warn('[Scheduler] Erro ao salvar tarefas:', e.message);
    }
  }

  /**
   * Carrega tarefas agendadas do storage
   */
  async function loadScheduledTasks() {
    try {
      const data = await chrome.storage.local.get(CONFIG.SCHEDULED_TASKS_KEY);
      if (data[CONFIG.SCHEDULED_TASKS_KEY]) {
        // FIX CRÍTICO: JSON.parse sem guard individual fazia o scheduler inteiro
        // parar de funcionar se o storage estivesse corrompido.
        let tasks;
        try {
          tasks = JSON.parse(data[CONFIG.SCHEDULED_TASKS_KEY]);
        } catch (parseErr) {
          console.error('[Scheduler] ❌ Dados corrompidos no storage — descartando e resetando:', parseErr.message);
          // Limpa a chave corrompida para não bloquear inicializações futuras
          try { await chrome.storage.local.remove(CONFIG.SCHEDULED_TASKS_KEY); } catch (_) {}
          tasks = [];
        }

        if (!Array.isArray(tasks)) {
          console.warn('[Scheduler] Dados inválidos (não é array) — ignorando');
          tasks = [];
        }

        tasks.forEach(task => {
          // Só restaura tarefas válidas e ainda no futuro
          if (task && task.enabled && task.nextRun > Date.now()) {
            scheduledTasks.set(task.id, {
              ...task,
              handler: null // Handler precisa ser re-registrado
            });
          }
        });

        console.log(`[Scheduler] ${scheduledTasks.size} tarefas restauradas`);
      }
    } catch (e) {
      console.warn('[Scheduler] Erro ao carregar tarefas:', e.message);
    }
  }

  /**
   * Re-registra handler para tarefa existente
   */
  function registerHandler(taskId, handler) {
    const task = scheduledTasks.get(taskId);
    if (task) {
      task.handler = handler;
      return true;
    }
    return false;
  }

  /**
   * Obtém tarefa por ID
   */
  function getTask(taskId) {
    return scheduledTasks.get(taskId);
  }

  /**
   * Lista todas as tarefas agendadas
   */
  function listScheduledTasks() {
    return Array.from(scheduledTasks.values()).map(t => ({
      id: t.id,
      name: t.name,
      frequency: t.frequency,
      nextRun: t.nextRun,
      lastRun: t.lastRun,
      enabled: t.enabled
    }));
  }

  /**
   * Habilita/desabilita tarefa
   */
  function toggleTask(taskId, enabled) {
    const task = scheduledTasks.get(taskId);
    if (task) {
      task.enabled = enabled;
      if (enabled) {
        task.nextRun = calculateNextRun(task);
        setupChromeAlarm(task);
      } else if (chrome.alarms) {
        chrome.alarms.clear(`whl_task_${taskId}`);
      }
      saveScheduledTasks();
      return true;
    }
    return false;
  }

  // ============================================
  // STATUS
  // ============================================

  function getStatus() {
    return {
      queued: state.queue.length,
      running: state.running.size,
      completed: state.completed.length,
      failed: state.failed.length,
      paused: state.paused,
      locks: Object.fromEntries(state.locks),
      queue: state.queue.map(j => ({ id: j.id, name: j.name, priority: j.priority, status: j.status })),
      runningJobs: Array.from(state.running.values()).map(j => ({ id: j.id, name: j.name, startedAt: j.startedAt })),
      scheduledTasks: Array.from(scheduledTasks.values()).map(t => ({ id: t.id, name: t.name, nextRun: t.nextRun }))
    };
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  async function init() {
    // FIX CRÍTICO: guard de re-entrada robusto.
    // state.initialized sozinho não era suficiente — em HMR ou reload parcial
    // a flag era resetada mas os intervalos anteriores ainda corriam,
    // acumulando loops paralelos. Agora paramos os intervalos velhos primeiro.
    if (state.initialized) {
      console.warn('[Scheduler] init() chamado mais de uma vez — ignorando (já inicializado)');
      return;
    }
    state.initialized = true;

    // Para qualquer intervalo residual de carga anterior (HMR / reload parcial)
    if (scheduledTasksInterval) {
      clearInterval(scheduledTasksInterval);
      scheduledTasksInterval = null;
    }
    if (processQueueInterval) {
      clearInterval(processQueueInterval);
      processQueueInterval = null;
    }

    // Carregar tarefas salvas
    await loadScheduledTasks();

    // Verificar tarefas agendadas a cada 10 segundos
    scheduledTasksInterval = setInterval(checkScheduledTasks, 10000);

    // Processar fila periodicamente
    processQueueInterval = setInterval(processQueue, 5000);

    // Configurar listener para Chrome Alarms
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.onAlarm.addListener(handleChromeAlarm);
    }

    console.log('[Scheduler] ✅ Scheduler global v2.0 inicializado');
  }

  // ============================================
  // EXPORT
  // ============================================

  const Scheduler = {
    // Fila
    enqueue,
    addTask: enqueue, // Alias
    dequeue,
    cancelJob,
    
    // Controle
    pause,
    resume,
    clear,
    start: () => { state.paused = false; processQueue(); }, // Alias
    stop: pause, // Alias
    
    // Helpers
    scheduleMessage,
    scheduleCampaign,
    scheduleAIRequest,
    scheduleSync,
    
    // Agendamento básico
    scheduleRecurring,
    addRecurringTask: scheduleRecurring, // Alias
    unschedule,
    removeTask: cancelJob, // Alias
    
    // ✨ Agendamento avançado v2.0
    scheduleAdvanced,
    getTask,
    listScheduledTasks,
    toggleTask,
    registerHandler,
    calculateNextRun,
    parseCronExpression,
    
    // Status
    getStatus,
    getQueueStatus: getStatus, // Alias
    
    // Constantes
    PRIORITY,
    TASK_PRIORITY: PRIORITY, // Alias
    JOB_TYPE,
    FREQUENCY, // ✨ Novo
    
    // Init
    init
  };

  // Cleanup ao descarregar
  window.addEventListener('beforeunload', () => {
    if (scheduledTasksInterval) clearInterval(scheduledTasksInterval);
    if (processQueueInterval) clearInterval(processQueueInterval);
    scheduledTasksInterval = null;
    processQueueInterval = null;
  });

  window.Scheduler = Scheduler;
  window.GlobalQueue = Scheduler;
  window.GlobalScheduler = Scheduler; // Alias para compatibilidade

  Scheduler.init();

  console.log('[Scheduler] 📅 Fila global v2.0 carregada');

})();
