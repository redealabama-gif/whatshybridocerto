/**
 * 🔍 WhatsHybrid - Tracing Distribuído
 * Sistema de rastreamento de requisições com propagação de contexto
 * 
 * @version 7.9.13
 */

const crypto = require('crypto');
const logger = require('../utils/logger');
const { EventEmitter } = require('events');

/**
 * Gera ID único para trace/span
 */
function generateId(length = 16) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Span representa uma unidade de trabalho
 */
class Span {
  constructor(name, traceId, parentSpanId = null, options = {}) {
    this.traceId = traceId;
    this.spanId = generateId(8);
    this.parentSpanId = parentSpanId;
    this.name = name;
    this.kind = options.kind || 'internal'; // client, server, producer, consumer, internal
    this.startTime = Date.now();
    this.endTime = null;
    this.status = 'ok'; // ok, error
    this.attributes = options.attributes || {};
    this.events = [];
    this.links = [];
    this._ended = false;
  }

  /**
   * Define atributo do span
   */
  setAttribute(key, value) {
    if (this._ended) return this;
    this.attributes[key] = value;
    return this;
  }

  /**
   * Define múltiplos atributos
   */
  setAttributes(attrs) {
    if (this._ended) return this;
    Object.assign(this.attributes, attrs);
    return this;
  }

  /**
   * Adiciona evento ao span
   */
  addEvent(name, attributes = {}) {
    if (this._ended) return this;
    this.events.push({
      name,
      timestamp: Date.now(),
      attributes
    });
    return this;
  }

  /**
   * Define status de erro
   */
  setError(error) {
    if (this._ended) return this;
    this.status = 'error';
    this.setAttribute('error', true);
    this.setAttribute('error.message', error.message || String(error));
    if (error.stack) {
      this.setAttribute('error.stack', error.stack);
    }
    return this;
  }

  /**
   * Finaliza o span
   */
  end() {
    if (this._ended) return;
    this._ended = true;
    this.endTime = Date.now();
    this.duration = this.endTime - this.startTime;
    return this;
  }

  /**
   * Verifica se span está finalizado
   */
  isEnded() {
    return this._ended;
  }

  /**
   * Exporta span para JSON
   */
  toJSON() {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.duration,
      status: this.status,
      attributes: this.attributes,
      events: this.events,
      links: this.links
    };
  }

  /**
   * Contexto para propagação
   */
  getContext() {
    return {
      traceId: this.traceId,
      spanId: this.spanId
    };
  }
}

/**
 * Tracer gerencia spans e traces
 */
class Tracer extends EventEmitter {
  constructor(serviceName = 'whatshybrid-backend') {
    super();
    this.serviceName = serviceName;
    this.activeSpans = new Map();
    this.completedSpans = [];
    this.maxCompletedSpans = 1000;
    this.samplingRate = 1.0; // 100% por padrão
    this.exporters = [];
  }

  /**
   * Define taxa de amostragem (0.0 - 1.0)
   */
  setSamplingRate(rate) {
    this.samplingRate = Math.max(0, Math.min(1, rate));
    return this;
  }

  /**
   * Adiciona exportador
   */
  addExporter(exporter) {
    this.exporters.push(exporter);
    return this;
  }

  /**
   * Decide se deve amostrar
   */
  shouldSample() {
    return Math.random() < this.samplingRate;
  }

  /**
   * Inicia um novo span
   */
  startSpan(name, options = {}) {
    if (!this.shouldSample() && !options.force) {
      return new NoopSpan();
    }

    const traceId = options.traceId || generateId(16);
    const parentSpanId = options.parentSpanId || null;

    const span = new Span(name, traceId, parentSpanId, {
      kind: options.kind,
      attributes: {
        'service.name': this.serviceName,
        ...options.attributes
      }
    });

    this.activeSpans.set(span.spanId, span);
    this.emit('span:start', span);

    return span;
  }

  /**
   * Finaliza e registra um span
   */
  endSpan(span) {
    if (!span || span instanceof NoopSpan) return;
    
    span.end();
    this.activeSpans.delete(span.spanId);
    
    // Armazenar span completado
    this.completedSpans.push(span.toJSON());
    if (this.completedSpans.length > this.maxCompletedSpans) {
      this.completedSpans.shift();
    }

    // Exportar
    for (const exporter of this.exporters) {
      try {
        exporter.export(span);
      } catch (e) {
        logger.error('[Tracing] Erro ao exportar span:', e);
      }
    }

    this.emit('span:end', span);
    return span;
  }

  /**
   * Wrapper para executar função dentro de span
   */
  async withSpan(name, fn, options = {}) {
    const span = this.startSpan(name, options);
    
    try {
      const result = await fn(span);
      this.endSpan(span);
      return result;
    } catch (error) {
      span.setError(error);
      this.endSpan(span);
      throw error;
    }
  }

  /**
   * Extrai contexto de headers HTTP
   */
  extractContext(headers) {
    // Suporta W3C Trace Context e formato proprietário
    const traceParent = headers['traceparent'] || headers['x-trace-id'];
    const traceState = headers['tracestate'] || headers['x-trace-state'];

    if (traceParent) {
      // W3C: 00-traceId-spanId-flags
      const parts = traceParent.split('-');
      if (parts.length >= 3) {
        return {
          traceId: parts[1] || parts[0],
          spanId: parts[2] || parts[1],
          sampled: parts[3] !== '00'
        };
      }
      // Formato simples
      return { traceId: traceParent, spanId: null, sampled: true };
    }

    return null;
  }

  /**
   * Injeta contexto em headers HTTP
   */
  injectContext(span, headers = {}) {
    if (!span || span instanceof NoopSpan) return headers;

    // W3C Trace Context
    headers['traceparent'] = `00-${span.traceId}-${span.spanId}-01`;
    
    // Formato proprietário (para compatibilidade)
    headers['x-trace-id'] = span.traceId;
    headers['x-span-id'] = span.spanId;

    return headers;
  }

  /**
   * Obtém spans completados
   */
  getCompletedSpans(limit = 100) {
    return this.completedSpans.slice(-limit);
  }

  /**
   * Obtém trace completo
   */
  getTrace(traceId) {
    return this.completedSpans.filter(s => s.traceId === traceId);
  }

  /**
   * Limpa spans completados
   */
  clear() {
    this.completedSpans = [];
  }

  /**
   * Estatísticas
   */
  getStats() {
    const spans = this.completedSpans;
    const errors = spans.filter(s => s.status === 'error');
    
    const durations = spans.map(s => s.duration).filter(d => d !== undefined);
    const avgDuration = durations.length > 0 
      ? durations.reduce((a, b) => a + b, 0) / durations.length 
      : 0;

    return {
      totalSpans: spans.length,
      activeSpans: this.activeSpans.size,
      errorCount: errors.length,
      errorRate: spans.length > 0 ? (errors.length / spans.length * 100).toFixed(2) + '%' : '0%',
      avgDurationMs: avgDuration.toFixed(2),
      samplingRate: (this.samplingRate * 100) + '%'
    };
  }
}

/**
 * Span noop para quando não está amostrando
 */
class NoopSpan {
  setAttribute() { return this; }
  setAttributes() { return this; }
  addEvent() { return this; }
  setError() { return this; }
  end() { return this; }
  isEnded() { return true; }
  toJSON() { return null; }
  getContext() { return { traceId: null, spanId: null }; }
}

/**
 * Exportador para console (desenvolvimento)
 */
class ConsoleExporter {
  export(span) {
    const data = span.toJSON();
    const status = data.status === 'error' ? '❌' : '✅';
    logger.info(`[Trace] ${status} ${data.name} (${data.duration}ms) [${data.traceId.slice(0, 8)}]`);
  }
}

/**
 * Exportador para arquivo
 */
class FileExporter {
  constructor(filePath) {
    this.filePath = filePath;
    this.fs = require('fs');
  }

  export(span) {
    const data = span.toJSON();
    const line = JSON.stringify(data) + '\n';
    this.fs.appendFileSync(this.filePath, line);
  }
}

/**
 * Exportador para backend (HTTP)
 */
class HTTPExporter {
  constructor(endpoint, options = {}) {
    this.endpoint = endpoint;
    this.batchSize = options.batchSize || 10;
    this.flushInterval = options.flushInterval || 5000;
    this.batch = [];
    this.headers = options.headers || {};
    
    // Auto-flush
    // FIX: storing handle + .unref() para shutdown limpo
    this._flushTimer = setInterval(() => this.flush(), this.flushInterval);
    if (this._flushTimer.unref) this._flushTimer.unref();
  }

  export(span) {
    this.batch.push(span.toJSON());
    if (this.batch.length >= this.batchSize) {
      this.flush();
    }
  }

  async flush() {
    if (this.batch.length === 0) return;

    const spans = [...this.batch];
    this.batch = [];

    try {
      const fetch = require('node-fetch');
      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers
        },
        body: JSON.stringify({ spans })
      });
    } catch (e) {
      logger.error('[Tracing] Erro ao enviar spans:', e.message);
      // Re-adicionar spans para retry
      this.batch.unshift(...spans);
    }
  }
}

// Singleton
const tracer = new Tracer();

// Middleware Express para tracing
function tracingMiddleware(req, res, next) {
  // Extrair contexto do request
  const parentContext = tracer.extractContext(req.headers);
  
  // Iniciar span
  const span = tracer.startSpan(`HTTP ${req.method} ${req.path}`, {
    kind: 'server',
    traceId: parentContext?.traceId,
    parentSpanId: parentContext?.spanId,
    attributes: {
      'http.method': req.method,
      'http.url': req.originalUrl,
      'http.host': req.hostname,
      'http.user_agent': req.get('user-agent'),
      'http.request_content_length': req.get('content-length')
    }
  });

  // Anexar span ao request
  req.span = span;
  req.traceId = span.traceId;

  // Capturar resposta
  res.on('finish', () => {
    span.setAttributes({
      'http.status_code': res.statusCode,
      'http.response_content_length': res.get('content-length')
    });

    if (res.statusCode >= 400) {
      span.setError(new Error(`HTTP ${res.statusCode}`));
    }

    tracer.endSpan(span);
  });

  next();
}

module.exports = {
  tracer,
  Tracer,
  Span,
  NoopSpan,
  ConsoleExporter,
  FileExporter,
  HTTPExporter,
  tracingMiddleware,
  generateId
};
