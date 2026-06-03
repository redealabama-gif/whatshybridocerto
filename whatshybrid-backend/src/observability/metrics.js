/**
 * 📊 WhatsHybrid - Sistema de Métricas
 * Observabilidade formal com Prometheus-compatible metrics
 * 
 * @version 7.9.13
 */

const { EventEmitter } = require('events');
const logger = require('../utils/logger');

class MetricsCollector extends EventEmitter {
  constructor() {
    super();
    this.metrics = new Map();
    this.histograms = new Map();
    this.gauges = new Map();
    this.counters = new Map();
    this.startTime = Date.now();
    
    // Métricas padrão
    this._initDefaultMetrics();
  }

  _initDefaultMetrics() {
    // Contadores
    this.counter('http_requests_total', 'Total de requisições HTTP');
    this.counter('ai_completions_total', 'Total de completions de IA');
    this.counter('ai_errors_total', 'Total de erros de IA');
    this.counter('autopilot_messages_sent', 'Mensagens enviadas pelo Autopilot');
    this.counter('autopilot_messages_failed', 'Mensagens falhadas pelo Autopilot');
    this.counter('memory_sync_success', 'Sincronizações de memória bem-sucedidas');
    this.counter('memory_sync_failed', 'Sincronizações de memória falhadas');
    this.counter('auth_success', 'Autenticações bem-sucedidas');
    this.counter('auth_failed', 'Autenticações falhadas');

    // Gauges
    this.gauge('active_sessions', 'Sessões ativas');
    this.gauge('autopilot_queue_size', 'Tamanho da fila do Autopilot');
    this.gauge('memory_cache_size', 'Tamanho do cache de memória');
    this.gauge('websocket_connections', 'Conexões WebSocket ativas');

    // Histogramas
    this.histogram('http_request_duration_seconds', 'Duração das requisições HTTP', [0.01, 0.05, 0.1, 0.5, 1, 2, 5]);
    this.histogram('ai_completion_duration_seconds', 'Duração das completions de IA', [0.5, 1, 2, 5, 10, 30]);
    this.histogram('db_query_duration_seconds', 'Duração das queries de banco', [0.001, 0.01, 0.05, 0.1, 0.5, 1]);
  }

  /**
   * Cria um contador
   */
  counter(name, help, labels = []) {
    if (!this.counters.has(name)) {
      this.counters.set(name, {
        name,
        help,
        type: 'counter',
        labels,
        values: new Map(),
        total: 0
      });
    }
    return this;
  }

  /**
   * Incrementa um contador
   */
  inc(name, labels = {}, value = 1) {
    const counter = this.counters.get(name);
    if (!counter) {
      logger.warn(`[Metrics] Contador não encontrado: ${name}`);
      return;
    }

    const labelKey = this._serializeLabels(labels);
    const current = counter.values.get(labelKey) || 0;
    counter.values.set(labelKey, current + value);
    counter.total += value;

    this.emit('metric:updated', { name, type: 'counter', labels, value: current + value });
  }

  /**
   * Cria um gauge
   */
  gauge(name, help, labels = []) {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, {
        name,
        help,
        type: 'gauge',
        labels,
        values: new Map()
      });
    }
    return this;
  }

  /**
   * Define valor de um gauge
   */
  set(name, labels = {}, value) {
    const gauge = this.gauges.get(name);
    if (!gauge) {
      logger.warn(`[Metrics] Gauge não encontrado: ${name}`);
      return;
    }

    const labelKey = this._serializeLabels(labels);
    gauge.values.set(labelKey, value);

    this.emit('metric:updated', { name, type: 'gauge', labels, value });
  }

  /**
   * Incrementa/decrementa um gauge
   */
  incGauge(name, labels = {}, value = 1) {
    const gauge = this.gauges.get(name);
    if (!gauge) return;

    const labelKey = this._serializeLabels(labels);
    const current = gauge.values.get(labelKey) || 0;
    gauge.values.set(labelKey, current + value);
  }

  decGauge(name, labels = {}, value = 1) {
    this.incGauge(name, labels, -value);
  }

  /**
   * Cria um histograma
   */
  histogram(name, help, buckets = [0.1, 0.5, 1, 2, 5, 10]) {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, {
        name,
        help,
        type: 'histogram',
        buckets: buckets.sort((a, b) => a - b),
        values: new Map(),
        sum: 0,
        count: 0
      });
    }
    return this;
  }

  /**
   * Observa um valor no histograma
   */
  observe(name, labels = {}, value) {
    const histogram = this.histograms.get(name);
    if (!histogram) {
      logger.warn(`[Metrics] Histograma não encontrado: ${name}`);
      return;
    }

    const labelKey = this._serializeLabels(labels);
    
    if (!histogram.values.has(labelKey)) {
      histogram.values.set(labelKey, {
        buckets: histogram.buckets.map(b => ({ le: b, count: 0 })),
        sum: 0,
        count: 0
      });
    }

    const data = histogram.values.get(labelKey);
    data.sum += value;
    data.count++;
    histogram.sum += value;
    histogram.count++;

    // Atualizar buckets
    for (const bucket of data.buckets) {
      if (value <= bucket.le) {
        bucket.count++;
      }
    }

    this.emit('metric:updated', { name, type: 'histogram', labels, value });
  }

  /**
   * Timer helper para medir duração
   */
  startTimer(histogramName, labels = {}) {
    const start = process.hrtime.bigint();
    return () => {
      const end = process.hrtime.bigint();
      const durationSeconds = Number(end - start) / 1e9;
      this.observe(histogramName, labels, durationSeconds);
      return durationSeconds;
    };
  }

  /**
   * Serializa labels para chave única
   */
  _serializeLabels(labels) {
    if (!labels || Object.keys(labels).length === 0) return '';
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  /**
   * Exporta métricas no formato Prometheus
   */
  toPrometheus() {
    const lines = [];

    // Uptime
    lines.push('# HELP process_uptime_seconds Tempo de atividade do processo');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${(Date.now() - this.startTime) / 1000}`);
    lines.push('');

    // Counters
    for (const [name, counter] of this.counters) {
      lines.push(`# HELP ${name} ${counter.help}`);
      lines.push(`# TYPE ${name} counter`);
      
      if (counter.values.size === 0) {
        lines.push(`${name} ${counter.total}`);
      } else {
        for (const [labelKey, value] of counter.values) {
          const labelStr = labelKey ? `{${labelKey}}` : '';
          lines.push(`${name}${labelStr} ${value}`);
        }
      }
      lines.push('');
    }

    // Gauges
    for (const [name, gauge] of this.gauges) {
      lines.push(`# HELP ${name} ${gauge.help}`);
      lines.push(`# TYPE ${name} gauge`);
      
      if (gauge.values.size === 0) {
        lines.push(`${name} 0`);
      } else {
        for (const [labelKey, value] of gauge.values) {
          const labelStr = labelKey ? `{${labelKey}}` : '';
          lines.push(`${name}${labelStr} ${value}`);
        }
      }
      lines.push('');
    }

    // Histograms
    for (const [name, histogram] of this.histograms) {
      lines.push(`# HELP ${name} ${histogram.help}`);
      lines.push(`# TYPE ${name} histogram`);
      
      for (const [labelKey, data] of histogram.values) {
        const baseLabel = labelKey ? `${labelKey},` : '';
        
        for (const bucket of data.buckets) {
          lines.push(`${name}_bucket{${baseLabel}le="${bucket.le}"} ${bucket.count}`);
        }
        lines.push(`${name}_bucket{${baseLabel}le="+Inf"} ${data.count}`);
        lines.push(`${name}_sum{${labelKey || ''}} ${data.sum}`);
        lines.push(`${name}_count{${labelKey || ''}} ${data.count}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Exporta métricas em JSON
   */
  toJSON() {
    return {
      timestamp: new Date().toISOString(),
      uptime: (Date.now() - this.startTime) / 1000,
      counters: Object.fromEntries(
        Array.from(this.counters).map(([name, c]) => [name, {
          help: c.help,
          total: c.total,
          values: Object.fromEntries(c.values)
        }])
      ),
      gauges: Object.fromEntries(
        Array.from(this.gauges).map(([name, g]) => [name, {
          help: g.help,
          values: Object.fromEntries(g.values)
        }])
      ),
      histograms: Object.fromEntries(
        Array.from(this.histograms).map(([name, h]) => [name, {
          help: h.help,
          sum: h.sum,
          count: h.count,
          buckets: h.buckets
        }])
      )
    };
  }

  /**
   * Reset todas as métricas
   */
  reset() {
    for (const counter of this.counters.values()) {
      counter.values.clear();
      counter.total = 0;
    }
    for (const gauge of this.gauges.values()) {
      gauge.values.clear();
    }
    for (const histogram of this.histograms.values()) {
      histogram.values.clear();
      histogram.sum = 0;
      histogram.count = 0;
    }
  }
}

// Singleton
const metrics = new MetricsCollector();

// Middleware Express para métricas HTTP
function metricsMiddleware(req, res, next) {
  const startTime = process.hrtime.bigint();
  
  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const durationSeconds = Number(endTime - startTime) / 1e9;
    
    const labels = {
      method: req.method,
      path: req.route?.path || req.path,
      status: res.statusCode.toString()
    };
    
    metrics.inc('http_requests_total', labels);
    metrics.observe('http_request_duration_seconds', labels, durationSeconds);
  });
  
  next();
}

// Endpoint /metrics
function metricsEndpoint(req, res) {
  const format = req.query.format || 'prometheus';
  
  if (format === 'json') {
    res.json(metrics.toJSON());
  } else {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(metrics.toPrometheus());
  }
}

module.exports = {
  metrics,
  metricsMiddleware,
  metricsEndpoint,
  MetricsCollector
};
