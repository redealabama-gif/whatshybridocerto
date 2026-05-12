/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                       JOBS RUNNER ROBUSTO                                 ║
 * ║                        WhatsHybrid Backend                                ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Sistema de processamento de jobs em background com:                      ║
 * ║  - Lock anti-duplicação                                                   ║
 * ║  - Retry automático                                                       ║
 * ║  - Logging estruturado                                                    ║
 * ║  - Execução via cron ou HTTP                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

const fs = require('fs');
const logger = require('../utils/logger');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ═══════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO
// ═══════════════════════════════════════════════════════════════════
const CONFIG = {
  LOCK_FILE: path.join(process.cwd(), '.jobs_runner.lock'),
  MAX_CONCURRENT_JOBS: 5,
  DEFAULT_TIMEOUT: 60000, // 60 segundos
  RETRY_DELAY: 60000,     // 1 minuto
  MAX_RETRIES: 3,
  BATCH_SIZE: 20,
  CHECK_INTERVAL: 10000   // 10 segundos
};

// ═══════════════════════════════════════════════════════════════════
// TIPOS DE JOBS
// ═══════════════════════════════════════════════════════════════════
const JOB_TYPES = {
  REMARKETING_BATCH: 'remarketing_batch',
  REMINDER_WHATSAPP: 'reminder_whatsapp',
  BACKUP_DATA: 'backup_data',
  SYNC_CONTACTS: 'sync_contacts',
  SEND_CAMPAIGN: 'send_campaign',
  GENERATE_REPORT: 'generate_report',
  CLEANUP_OLD_DATA: 'cleanup_old_data',
  WEBHOOK_RETRY: 'webhook_retry',
  AI_TRAINING_SYNC: 'ai_training_sync',
  SUBSCRIPTION_CHECK: 'subscription_check'
};

const JOB_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

// ═══════════════════════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════════════════════
const state = {
  isRunning: false,
  currentJobs: new Map(),
  lockHandle: null,
  checkInterval: null,
  stats: {
    totalProcessed: 0,
    totalFailed: 0,
    lastRun: null
  }
};

// ═══════════════════════════════════════════════════════════════════
// SISTEMA DE LOCK
// ═══════════════════════════════════════════════════════════════════
function acquireLock() {
  try {
    // Verifica se já existe um lock
    if (fs.existsSync(CONFIG.LOCK_FILE)) {
      const lockData = fs.readFileSync(CONFIG.LOCK_FILE, 'utf8');
      const lock = JSON.parse(lockData);
      
      // Verifica se o lock é antigo (> 5 minutos = processo morto)
      if (Date.now() - lock.timestamp < 5 * 60 * 1000) {
        logger.info('[JobsRunner] Outra instância já está rodando');
        return false;
      }
    }
    
    // Cria novo lock
    fs.writeFileSync(CONFIG.LOCK_FILE, JSON.stringify({
      pid: process.pid,
      timestamp: Date.now()
    }));
    
    state.lockHandle = true;
    return true;
  } catch (e) {
    logger.error('[JobsRunner] Erro ao adquirir lock:', e);
    return false;
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(CONFIG.LOCK_FILE)) {
      fs.unlinkSync(CONFIG.LOCK_FILE);
    }
    state.lockHandle = null;
  } catch (e) {
    logger.error('[JobsRunner] Erro ao liberar lock:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// HANDLERS DE JOBS
// ═══════════════════════════════════════════════════════════════════
const jobHandlers = {
  /**
   * Processa batch de remarketing
   */
  [JOB_TYPES.REMARKETING_BATCH]: async (job, db) => {
    const { campaignId, batchSize = 50 } = job.payload;
    
    // Busca disparos pendentes
    const disparos = await db.all(`
      SELECT * FROM remarketing_disparos
      WHERE status = 'pending' AND campaign_id = ?
      ORDER BY id ASC
      LIMIT ?
    `, [campaignId, batchSize]);
    
    if (disparos.length === 0) {
      return { success: true, message: 'Nenhum disparo pendente', processed: 0 };
    }
    
    let enviados = 0;
    let falhas = 0;
    
    for (const disparo of disparos) {
      try {
        // Aqui seria a integração com WhatsApp Business API
        // Por enquanto, simula envio
        await new Promise(r => setTimeout(r, 100));
        
        await db.run(`
          UPDATE remarketing_disparos SET status = 'sent', sent_at = ? WHERE id = ?
        `, [Date.now(), disparo.id]);
        
        enviados++;
        
        // Delay anti-ban
        await new Promise(r => setTimeout(r, Math.random() * 1000 + 500));
        
      } catch (e) {
        await db.run(`
          UPDATE remarketing_disparos SET status = 'failed', error = ? WHERE id = ?
        `, [e.message, disparo.id]);
        falhas++;
      }
    }
    
    return {
      success: true,
      processed: disparos.length,
      sent: enviados,
      failed: falhas
    };
  },

  /**
   * Envia lembrete via WhatsApp
   */
  [JOB_TYPES.REMINDER_WHATSAPP]: async (job, db) => {
    const { phone, message, title } = job.payload;
    
    // Normaliza telefone
    const phoneClean = phone.replace(/\D/g, '');
    if (phoneClean.length < 10) {
      throw new Error('Telefone inválido');
    }
    
    // Aqui seria a integração com WhatsApp Business API
    logger.info(`[JobsRunner] Enviando lembrete para ${phoneClean}: ${message}`);
    
    // Registra no log
    await db.run(`
      INSERT INTO job_logs (job_id, action, details, created_at)
      VALUES (?, 'reminder_sent', ?, ?)
    `, [job.id, JSON.stringify({ phone: phoneClean, title }), Date.now()]);
    
    return { success: true, phone: phoneClean };
  },

  /**
   * Faz backup dos dados
   */
  [JOB_TYPES.BACKUP_DATA]: async (job, db) => {
    const tables = ['contacts', 'deals', 'messages', 'campaigns', 'training_examples'];
    const backupDir = path.join(process.cwd(), 'backups');
    const allowedTables = new Set(tables);
    const safeIdentifier = (name) => {
      // Defesa em profundidade: só aceitar identificadores simples e whitelisted
      if (!allowedTables.has(name)) {
        throw new Error(`Tabela não permitida no backup: ${name}`);
      }
      if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
        throw new Error(`Identificador inválido no backup: ${name}`);
      }
      // Quote seguro para SQLite (duplica aspas duplas)
      return `"${String(name).replace(/"/g, '""')}"`;
    };
    
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupData = {};
    
    for (const table of tables) {
      try {
        const tableName = safeIdentifier(table);
        const rows = await db.all(`SELECT * FROM ${tableName}`);
        backupData[table] = rows;
      } catch (e) {
        // Tabela pode não existir
        backupData[table] = [];
      }
    }
    
    const backupFile = path.join(backupDir, `backup_${timestamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
    
    // Limpa backups antigos (mantém últimos 7)
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('backup_'))
      .sort()
      .reverse();
    
    for (let i = 7; i < backups.length; i++) {
      fs.unlinkSync(path.join(backupDir, backups[i]));
    }
    
    return {
      success: true,
      file: backupFile,
      tables: Object.keys(backupData),
      totalRows: Object.values(backupData).reduce((sum, arr) => sum + arr.length, 0)
    };
  },

  /**
   * Sincroniza contatos
   */
  [JOB_TYPES.SYNC_CONTACTS]: async (job, db) => {
    const { workspaceId, source } = job.payload;
    
    // Busca contatos não sincronizados
    const contacts = await db.all(`
      SELECT * FROM contacts
      WHERE workspace_id = ? AND (synced_at IS NULL OR synced_at < updated_at)
      LIMIT 100
    `, [workspaceId]);
    
    // Aqui seria o envio para serviço externo
    
    // Marca como sincronizado
    // v9.3.5: defesa em profundidade — também filtra workspace_id no UPDATE
    // pra evitar que job comprometido afete outros workspaces.
    for (const contact of contacts) {
      await db.run(`
        UPDATE contacts SET synced_at = ? WHERE id = ? AND workspace_id = ?
      `, [Date.now(), contact.id, workspaceId]);
    }
    
    return {
      success: true,
      synced: contacts.length
    };
  },

  /**
   * Envia campanha
   */
  [JOB_TYPES.SEND_CAMPAIGN]: async (job, db) => {
    const { campaignId, workspaceId } = job.payload;

    // SECURITY FIX (v8.5.0): exigir workspaceId no payload e validar tenant
    // Antes: qualquer job com campaignId acessava qualquer campanha (tenant leak)
    if (!workspaceId) {
      throw new Error('SEND_CAMPAIGN job requires workspaceId in payload');
    }

    const campaign = await db.get(`
      SELECT * FROM campaigns WHERE id = ? AND workspace_id = ?
    `, [campaignId, workspaceId]);

    if (!campaign) {
      throw new Error('Campanha não encontrada (ou pertence a outro workspace)');
    }

    const recipients = await db.all(`
      SELECT cr.* FROM campaign_recipients cr
      JOIN campaigns c ON c.id = cr.campaign_id
      WHERE cr.campaign_id = ? AND cr.status = 'pending' AND c.workspace_id = ?
      LIMIT 50
    `, [campaignId, workspaceId]);

    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      try {
        // Envia mensagem (integração com WhatsApp)
        await new Promise(r => setTimeout(r, 500));

        await db.run(`
          UPDATE campaign_recipients SET status = 'sent', sent_at = ? WHERE id = ?
        `, [Date.now(), recipient.id]);

        sent++;
      } catch (e) {
        await db.run(`
          UPDATE campaign_recipients SET status = 'failed', error = ? WHERE id = ?
        `, [e.message, recipient.id]);
        failed++;
      }
    }

    // Atualiza status da campanha (também validando workspace)
    const pending = await db.get(`
      SELECT COUNT(*) as count FROM campaign_recipients
      WHERE campaign_id = ? AND status = 'pending'
    `, [campaignId]);

    if (pending.count === 0) {
      await db.run(`
        UPDATE campaigns SET status = 'completed', completed_at = ?
        WHERE id = ? AND workspace_id = ?
      `, [Date.now(), campaignId, workspaceId]);
    }

    return { success: true, sent, failed, remaining: pending.count };
  },

  /**
   * Gera relatório
   */
  [JOB_TYPES.GENERATE_REPORT]: async (job, db) => {
    const { reportType, period, workspaceId } = job.payload;
    
    const report = {
      type: reportType,
      period,
      generatedAt: Date.now(),
      data: {}
    };
    
    switch (reportType) {
      case 'messages':
        report.data = await db.get(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN direction = 'in' THEN 1 ELSE 0 END) as received,
            SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END) as sent
          FROM messages
          WHERE workspace_id = ? AND created_at > ?
        `, [workspaceId, Date.now() - period * 86400000]);
        break;
        
      case 'deals':
        report.data = await db.get(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won,
            SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost,
            SUM(value) as totalValue
          FROM deals
          WHERE workspace_id = ? AND created_at > ?
        `, [workspaceId, Date.now() - period * 86400000]);
        break;
        
      case 'ai':
        report.data = await db.get(`
          SELECT 
            COUNT(*) as totalRequests,
            AVG(response_time) as avgResponseTime,
            SUM(tokens_used) as totalTokens
          FROM ai_requests
          WHERE workspace_id = ? AND created_at > ?
        `, [workspaceId, Date.now() - period * 86400000]);
        break;
    }
    
    // Salva relatório
    await db.run(`
      INSERT INTO reports (id, workspace_id, type, data, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, [uuidv4(), workspaceId, reportType, JSON.stringify(report.data), Date.now()]);
    
    return { success: true, report };
  },

  /**
   * Limpa dados antigos
   */
  [JOB_TYPES.CLEANUP_OLD_DATA]: async (job, db) => {
    const { daysToKeep = 90 } = job.payload;
    const cutoff = Date.now() - daysToKeep * 86400000;
    
    const results = {
      messages: 0,
      logs: 0,
      temp: 0
    };
    
    // Limpa mensagens antigas
    const msgResult = await db.run(`
      DELETE FROM messages WHERE created_at < ? AND archived = 1
    `, [cutoff]);
    results.messages = msgResult.changes || 0;
    
    // Limpa logs antigos
    const logResult = await db.run(`
      DELETE FROM job_logs WHERE created_at < ?
    `, [cutoff]);
    results.logs = logResult.changes || 0;

    // v9.4.5 BUG #124: limpa ai_feedback antigos.
    // Sem isso, tabela cresce 1000 rows/dia × 100 clientes × 365 dias = 36M rows/ano.
    // Aprendizado já consolidado em learning_pipeline_state — feedback bruto velho
    // só serve pra debug e ETL. 90 dias é mais que suficiente.
    try {
      const feedbackResult = await db.run(`
        DELETE FROM ai_feedback WHERE created_at < datetime(?, 'unixepoch')
      `, [Math.floor(cutoff / 1000)]);
      results.ai_feedback = feedbackResult.changes || 0;
    } catch (err) {
      // Tabela pode não existir em deployments antigos
      results.ai_feedback = 0;
    }
    
    // Limpa arquivos temporários
    const tempDir = path.join(process.cwd(), 'temp');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        const stats = fs.statSync(filePath);
        if (stats.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          results.temp++;
        }
      }
    }
    
    return { success: true, cleaned: results };
  },

  /**
   * Retenta webhooks falhados
   */
  [JOB_TYPES.WEBHOOK_RETRY]: async (job, db) => {
    const webhooks = await db.all(`
      SELECT * FROM webhook_queue
      WHERE status = 'failed' AND attempts < 3
      ORDER BY created_at ASC
      LIMIT 20
    `);
    
    let success = 0;
    let failed = 0;
    
    for (const webhook of webhooks) {
      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: webhook.payload,
          timeout: 10000
        });
        
        if (response.ok) {
          await db.run(`
            UPDATE webhook_queue SET status = 'sent', sent_at = ? WHERE id = ?
          `, [Date.now(), webhook.id]);
          success++;
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (e) {
        await db.run(`
          UPDATE webhook_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?
        `, [e.message, webhook.id]);
        failed++;
      }
    }
    
    return { success: true, retried: webhooks.length, succeeded: success, failed };
  },

  /**
   * Sincroniza treinamento de IA
   */
  [JOB_TYPES.AI_TRAINING_SYNC]: async (job, db) => {
    const { workspaceId } = job.payload;
    
    // Busca exemplos não sincronizados
    const examples = await db.all(`
      SELECT * FROM training_examples
      WHERE workspace_id = ? AND synced_at IS NULL
      LIMIT 50
    `, [workspaceId]);
    
    // Aqui seria o envio para serviço de IA
    
    // Marca como sincronizado
    for (const example of examples) {
      await db.run(`
        UPDATE training_examples SET synced_at = ? WHERE id = ?
      `, [Date.now(), example.id]);
    }
    
    return { success: true, synced: examples.length };
  },

  /**
   * Verifica assinaturas
   */
  [JOB_TYPES.SUBSCRIPTION_CHECK]: async (job, db) => {
    const now = Date.now();
    
    // Busca assinaturas expirando em 7 dias
    const expiringIn7Days = await db.all(`
      SELECT * FROM subscriptions
      WHERE status = 'active' AND expires_at BETWEEN ? AND ?
    `, [now, now + 7 * 86400000]);
    
    // Busca assinaturas expiradas
    const expired = await db.all(`
      SELECT * FROM subscriptions
      WHERE status = 'active' AND expires_at < ?
    `, [now]);
    
    // Marca expiradas
    for (const sub of expired) {
      await db.run(`
        UPDATE subscriptions SET status = 'expired' WHERE id = ?
      `, [sub.id]);
      
      // Notifica usuário (aqui seria envio de email/notificação)
    }
    
    // Notifica sobre expiração próxima
    for (const sub of expiringIn7Days) {
      // Envia notificação de renovação
    }
    
    return {
      success: true,
      expiring: expiringIn7Days.length,
      expired: expired.length
    };
  }
};

// ═══════════════════════════════════════════════════════════════════
// EXECUÇÃO DE JOBS
// ═══════════════════════════════════════════════════════════════════
async function executeJob(job, db) {
  const handler = jobHandlers[job.type];
  
  if (!handler) {
    throw new Error(`Handler não encontrado para tipo: ${job.type}`);
  }
  
  const startTime = Date.now();
  
  try {
    // Marca como running
    await db.run(`
      UPDATE scheduled_jobs SET status = ?, started_at = ?, attempts = attempts + 1 WHERE id = ?
    `, [JOB_STATUS.RUNNING, startTime, job.id]);
    
    // Executa com timeout
    const result = await Promise.race([
      handler(job, db),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), job.timeout || CONFIG.DEFAULT_TIMEOUT)
      )
    ]);
    
    // Marca como completed
    await db.run(`
      UPDATE scheduled_jobs SET status = ?, completed_at = ?, result = ? WHERE id = ?
    `, [JOB_STATUS.COMPLETED, Date.now(), JSON.stringify(result), job.id]);
    
    // Log
    await db.run(`
      INSERT INTO job_logs (id, job_id, action, details, created_at)
      VALUES (?, ?, 'completed', ?, ?)
    `, [uuidv4(), job.id, JSON.stringify(result), Date.now()]);
    
    state.stats.totalProcessed++;
    
    return { success: true, result, duration: Date.now() - startTime };
    
  } catch (error) {
    // Verifica se deve tentar novamente
    const maxRetries = job.max_retries || CONFIG.MAX_RETRIES;
    
    if (job.attempts < maxRetries) {
      // Agenda retry
      const nextRun = Date.now() + (CONFIG.RETRY_DELAY * Math.pow(2, job.attempts));
      
      await db.run(`
        UPDATE scheduled_jobs SET status = ?, next_run_at = ?, last_error = ? WHERE id = ?
      `, [JOB_STATUS.PENDING, nextRun, error.message, job.id]);
      
    } else {
      // Marca como failed
      await db.run(`
        UPDATE scheduled_jobs SET status = ?, failed_at = ?, last_error = ? WHERE id = ?
      `, [JOB_STATUS.FAILED, Date.now(), error.message, job.id]);
      
      state.stats.totalFailed++;
    }
    
    // Log de erro
    await db.run(`
      INSERT INTO job_logs (id, job_id, action, details, created_at)
      VALUES (?, ?, 'failed', ?, ?)
    `, [uuidv4(), job.id, JSON.stringify({ error: error.message, attempt: job.attempts }), Date.now()]);
    
    return { success: false, error: error.message, duration: Date.now() - startTime };
  }
}

// ═══════════════════════════════════════════════════════════════════
// PROCESSAMENTO
// ═══════════════════════════════════════════════════════════════════
async function processJobs(db) {
  const now = Date.now();
  
  // Busca jobs prontos para execução
  const jobs = await db.all(`
    SELECT * FROM scheduled_jobs
    WHERE status = ? AND (next_run_at IS NULL OR next_run_at <= ?)
    ORDER BY priority DESC, created_at ASC
    LIMIT ?
  `, [JOB_STATUS.PENDING, now, CONFIG.BATCH_SIZE]);
  
  if (jobs.length === 0) {
    return { processed: 0 };
  }
  
  logger.info(`[JobsRunner] Processando ${jobs.length} jobs...`);
  
  const results = [];
  
  for (const job of jobs) {
    // Verifica limite de concorrência
    if (state.currentJobs.size >= CONFIG.MAX_CONCURRENT_JOBS) {
      break;
    }
    
    state.currentJobs.set(job.id, job);
    
    try {
      const result = await executeJob(job, db);
      results.push({ jobId: job.id, ...result });
    } finally {
      state.currentJobs.delete(job.id);
    }
  }
  
  state.stats.lastRun = Date.now();
  
  return { processed: results.length, results };
}

// ═══════════════════════════════════════════════════════════════════
// CRIAÇÃO DE JOBS
// ═══════════════════════════════════════════════════════════════════
async function createJob(db, jobData) {
  const job = {
    id: jobData.id || uuidv4(),
    type: jobData.type,
    payload: JSON.stringify(jobData.payload || {}),
    priority: jobData.priority || 0,
    max_retries: jobData.maxRetries || CONFIG.MAX_RETRIES,
    timeout: jobData.timeout || CONFIG.DEFAULT_TIMEOUT,
    next_run_at: jobData.scheduledAt || null,
    status: JOB_STATUS.PENDING,
    attempts: 0,
    created_at: Date.now()
  };
  
  await db.run(`
    INSERT INTO scheduled_jobs (id, type, payload, priority, max_retries, timeout, next_run_at, status, attempts, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [job.id, job.type, job.payload, job.priority, job.max_retries, job.timeout, job.next_run_at, job.status, job.attempts, job.created_at]);
  
  return job;
}

// ═══════════════════════════════════════════════════════════════════
// INICIALIZAÇÃO E CONTROLE
// ═══════════════════════════════════════════════════════════════════
async function start(db) {
  if (state.isRunning) {
    logger.info('[JobsRunner] Já está rodando');
    return false;
  }
  
  if (!acquireLock()) {
    return false;
  }
  
  state.isRunning = true;
  
  // Processa imediatamente
  await processJobs(db);
  
  // Configura intervalo
  state.checkInterval = setInterval(() => processJobs(db), CONFIG.CHECK_INTERVAL);
  if (state.checkInterval.unref) state.checkInterval.unref();
  
  logger.info('[JobsRunner] ▶️ Iniciado');
  return true;
}

function stop() {
  if (!state.isRunning) {
    return;
  }
  
  if (state.checkInterval) {
    clearInterval(state.checkInterval);
    state.checkInterval = null;
  }
  
  releaseLock();
  state.isRunning = false;
  
  logger.info('[JobsRunner] ⏹️ Parado');
}

/**
 * Graceful shutdown - aguarda jobs em execução antes de encerrar
 * @param {number} timeoutMs - Timeout máximo de espera (padrão: 30s)
 * @returns {Promise<boolean>} - true se shutdown foi graceful
 */
async function gracefulShutdown(timeoutMs = 30000) {
  logger.info('[JobsRunner] 🛑 Iniciando graceful shutdown...');
  
  // Para de aceitar novos jobs
  state.isRunning = false;
  
  if (state.checkInterval) {
    clearInterval(state.checkInterval);
    state.checkInterval = null;
  }
  
  // Aguarda jobs em execução
  const startTime = Date.now();
  
  while (state.currentJobs.size > 0) {
    const elapsed = Date.now() - startTime;
    
    if (elapsed >= timeoutMs) {
      logger.warn(`[JobsRunner] ⚠️ Timeout alcançado. ${state.currentJobs.size} jobs ainda em execução.`);
      releaseLock();
      return false;
    }
    
    logger.info(`[JobsRunner] ⏳ Aguardando ${state.currentJobs.size} jobs... (${Math.round(elapsed / 1000)}s)`);
    await new Promise(r => setTimeout(r, 1000));
  }
  
  releaseLock();
  logger.info('[JobsRunner] ✅ Graceful shutdown concluído');
  return true;
}

// Registrar handlers de sinais para graceful shutdown
if (typeof process !== 'undefined') {
  const shutdownHandler = async (signal) => {
    logger.info(`[JobsRunner] 📡 Recebido sinal ${signal}`);
    await gracefulShutdown();
    process.exit(0);
  };
  
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));
}

async function runOnce(db) {
  if (!acquireLock()) {
    return { success: false, error: 'Outra instância rodando' };
  }
  
  try {
    const result = await processJobs(db);
    return { success: true, ...result };
  } finally {
    releaseLock();
  }
}

// ═══════════════════════════════════════════════════════════════════
// SCHEMA DO BANCO
// ═══════════════════════════════════════════════════════════════════
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT,
    priority INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    timeout INTEGER DEFAULT 60000,
    next_run_at INTEGER,
    status TEXT DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    started_at INTEGER,
    completed_at INTEGER,
    failed_at INTEGER,
    result TEXT,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );
  
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON scheduled_jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON scheduled_jobs(next_run_at);
  CREATE INDEX IF NOT EXISTS idx_jobs_type ON scheduled_jobs(type);
  
  CREATE TABLE IF NOT EXISTS job_logs (
    id TEXT PRIMARY KEY,
    job_id TEXT,
    action TEXT,
    details TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (job_id) REFERENCES scheduled_jobs(id)
  );
  
  CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id);
`;

async function initSchema(db) {
  await db.exec(SCHEMA);
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════
module.exports = {
  // Constantes
  JOB_TYPES,
  JOB_STATUS,
  CONFIG,
  
  // Controle
  start,
  stop,
  runOnce,
  gracefulShutdown, // NOVO: Shutdown graceful
  
  // Jobs
  createJob,
  
  // Schema
  initSchema,
  SCHEMA,
  
  // Status
  getStats: () => ({ ...state.stats }),
  isRunning: () => state.isRunning,
  getCurrentJobs: () => [...state.currentJobs.values()],
  
  // Handlers (para extensão)
  registerHandler: (type, handler) => {
    jobHandlers[type] = handler;
  }
};
