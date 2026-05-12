/**
 * 🏥 WhatsHybrid - Health Checks
 * Sistema de verificação de saúde dos componentes
 * 
 * @version 7.9.13
 */

const { EventEmitter } = require('events');
const logger = require('../utils/logger');

/**
 * Status possíveis de saúde
 */
const HealthStatus = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy'
};

/**
 * Check de saúde individual
 */
class HealthCheck {
  constructor(name, checkFn, options = {}) {
    this.name = name;
    this.checkFn = checkFn;
    this.timeout = options.timeout || 5000;
    this.critical = options.critical !== false; // true por padrão
    this.lastCheck = null;
    this.lastStatus = null;
    this.lastError = null;
    this.consecutiveFailures = 0;
    this.maxConsecutiveFailures = options.maxConsecutiveFailures || 3;
  }

  /**
   * Executa o check
   */
  async run() {
    const startTime = Date.now();
    
    try {
      // Timeout wrapper
      const result = await Promise.race([
        this.checkFn(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), this.timeout)
        )
      ]);

      this.lastCheck = new Date().toISOString();
      this.lastStatus = HealthStatus.HEALTHY;
      this.lastError = null;
      this.consecutiveFailures = 0;

      return {
        name: this.name,
        status: HealthStatus.HEALTHY,
        duration: Date.now() - startTime,
        details: result || {},
        lastCheck: this.lastCheck
      };

    } catch (error) {
      this.lastCheck = new Date().toISOString();
      this.lastError = error.message;
      this.consecutiveFailures++;

      // Degraded se ainda não atingiu limite, unhealthy se atingiu
      this.lastStatus = this.consecutiveFailures >= this.maxConsecutiveFailures
        ? HealthStatus.UNHEALTHY
        : HealthStatus.DEGRADED;

      return {
        name: this.name,
        status: this.lastStatus,
        duration: Date.now() - startTime,
        error: error.message,
        consecutiveFailures: this.consecutiveFailures,
        lastCheck: this.lastCheck
      };
    }
  }
}

/**
 * Gerenciador de Health Checks
 */
class HealthManager extends EventEmitter {
  constructor() {
    super();
    this.checks = new Map();
    this.intervalId = null;
    this.checkInterval = 30000; // 30 segundos
    this.lastFullCheck = null;
    this.overallStatus = HealthStatus.HEALTHY;
  }

  /**
   * Registra um check de saúde
   */
  register(name, checkFn, options = {}) {
    const check = new HealthCheck(name, checkFn, options);
    this.checks.set(name, check);
    return this;
  }

  /**
   * Remove um check
   */
  unregister(name) {
    this.checks.delete(name);
    return this;
  }

  /**
   * Executa todos os checks
   */
  async runAll() {
    const results = [];
    let hasUnhealthy = false;
    let hasDegraded = false;
    let hasCriticalFailure = false;

    for (const check of this.checks.values()) {
      const result = await check.run();
      results.push(result);

      if (result.status === HealthStatus.UNHEALTHY) {
        hasUnhealthy = true;
        if (check.critical) {
          hasCriticalFailure = true;
        }
      } else if (result.status === HealthStatus.DEGRADED) {
        hasDegraded = true;
      }
    }

    // Determinar status geral
    if (hasCriticalFailure) {
      this.overallStatus = HealthStatus.UNHEALTHY;
    } else if (hasUnhealthy || hasDegraded) {
      this.overallStatus = HealthStatus.DEGRADED;
    } else {
      this.overallStatus = HealthStatus.HEALTHY;
    }

    this.lastFullCheck = new Date().toISOString();

    const summary = {
      status: this.overallStatus,
      timestamp: this.lastFullCheck,
      checks: results,
      summary: {
        total: results.length,
        healthy: results.filter(r => r.status === HealthStatus.HEALTHY).length,
        degraded: results.filter(r => r.status === HealthStatus.DEGRADED).length,
        unhealthy: results.filter(r => r.status === HealthStatus.UNHEALTHY).length
      }
    };

    this.emit('health:checked', summary);
    
    if (this.overallStatus !== HealthStatus.HEALTHY) {
      this.emit('health:degraded', summary);
    }

    return summary;
  }

  /**
   * Executa um check específico
   */
  async runOne(name) {
    const check = this.checks.get(name);
    if (!check) {
      throw new Error(`Health check não encontrado: ${name}`);
    }
    return check.run();
  }

  /**
   * Inicia verificações periódicas
   */
  startPeriodicChecks(interval = 30000) {
    this.stopPeriodicChecks();
    this.checkInterval = interval;
    
    // Executar imediatamente
    this.runAll().catch(console.error);
    
    // Agendar próximas
    this.intervalId = setInterval(() => {
      this.runAll().catch(console.error);
    }, interval);
    if (this.intervalId.unref) this.intervalId.unref();

    return this;
  }

  /**
   * Para verificações periódicas
   */
  stopPeriodicChecks() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    return this;
  }

  /**
   * Retorna status atual (sem executar checks)
   */
  getCurrentStatus() {
    const checks = [];
    for (const check of this.checks.values()) {
      checks.push({
        name: check.name,
        status: check.lastStatus,
        lastCheck: check.lastCheck,
        lastError: check.lastError,
        critical: check.critical
      });
    }

    return {
      status: this.overallStatus,
      lastFullCheck: this.lastFullCheck,
      checks
    };
  }
}

// Singleton
const healthManager = new HealthManager();

// Checks padrão
function registerDefaultChecks(db, redis, ai) {
  // Database check
  if (db) {
    healthManager.register('database', async () => {
      const start = Date.now();
      await db.get('SELECT 1');
      return { responseTime: Date.now() - start };
    }, { critical: true });
  }

  // Redis check (se existir)
  if (redis) {
    healthManager.register('redis', async () => {
      const start = Date.now();
      await redis.ping();
      return { responseTime: Date.now() - start };
    }, { critical: false });
  }

  // AI providers check
  if (ai) {
    healthManager.register('ai_providers', async () => {
      const providers = ai.getAvailableProviders?.() || [];
      return {
        availableProviders: providers.length,
        providers: providers.map(p => p.name || p)
      };
    }, { critical: false });
  }

  // Memory check
  healthManager.register('memory', async () => {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
    const percentUsed = Math.round((usage.heapUsed / usage.heapTotal) * 100);
    
    if (percentUsed > 90) {
      throw new Error(`Uso de memória alto: ${percentUsed}%`);
    }
    
    return {
      heapUsedMB,
      heapTotalMB,
      percentUsed
    };
  }, { critical: true });

  // Event loop check
  healthManager.register('event_loop', async () => {
    const start = Date.now();
    await new Promise(resolve => setImmediate(resolve));
    const lag = Date.now() - start;
    
    if (lag > 100) {
      throw new Error(`Event loop lag alto: ${lag}ms`);
    }
    
    return { lagMs: lag };
  }, { critical: false });

  return healthManager;
}

// Endpoints Express
function healthEndpoint(req, res) {
  const status = healthManager.getCurrentStatus();
  const httpCode = status.status === HealthStatus.HEALTHY ? 200 : 
                   status.status === HealthStatus.DEGRADED ? 200 : 503;
  res.status(httpCode).json(status);
}

async function healthDetailedEndpoint(req, res) {
  try {
    const result = await healthManager.runAll();
    const httpCode = result.status === HealthStatus.HEALTHY ? 200 : 
                     result.status === HealthStatus.DEGRADED ? 200 : 503;
    res.status(httpCode).json(result);
  } catch (error) {
    res.status(503).json({
      status: HealthStatus.UNHEALTHY,
      error: error.message
    });
  }
}

// Liveness probe (está vivo?)
function livenessEndpoint(req, res) {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
}

// Readiness probe (está pronto para receber tráfego?)
async function readinessEndpoint(req, res) {
  const status = healthManager.getCurrentStatus();
  if (status.status === HealthStatus.UNHEALTHY) {
    res.status(503).json({ ready: false, reason: 'Critical checks failed' });
  } else {
    res.status(200).json({ ready: true });
  }
}

module.exports = {
  healthManager,
  HealthManager,
  HealthCheck,
  HealthStatus,
  registerDefaultChecks,
  healthEndpoint,
  healthDetailedEndpoint,
  livenessEndpoint,
  readinessEndpoint
};
