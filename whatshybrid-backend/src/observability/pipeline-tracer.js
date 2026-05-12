/**
 * PipelineTracer — Observabilidade real integrada ao fluxo de IA
 *
 * CORREÇÃO P2: O módulo observability/ existia mas não estava integrado ao pipeline.
 * Este tracer adiciona:
 *  — Traces de latência por etapa do pipeline (intent, search, llm, quality, safety)
 *  — Métricas de tokens consumidos por tenant
 *  — Alertas de rate limit por provider
 *  — Persistência no banco (tabela ai_requests)
 */

'use strict';

const logger = require('../utils/logger');

class PipelineTracer {
  constructor({ tenantId = 'default', requestId = null } = {}) {
    this.tenantId  = tenantId;
    this.requestId = requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.startTime = Date.now();
    this.stages    = {};  // stage → { start, end, durationMs, meta }
    this.tokens    = { input: 0, output: 0, total: 0 };
    this.provider  = null;
    this.model     = null;
    this.errors    = [];
  }

  /** Marca o início de uma etapa do pipeline */
  startStage(stage) {
    this.stages[stage] = { start: Date.now(), end: null, durationMs: null, meta: {} };
  }

  /** Marca o fim de uma etapa e registra metadados opcionais */
  endStage(stage, meta = {}) {
    if (!this.stages[stage]) this.stages[stage] = { start: Date.now() };
    const s = this.stages[stage];
    s.end       = Date.now();
    s.durationMs = s.end - s.start;
    s.meta      = meta;
    logger.debug(`[Tracer:${this.tenantId}] ${stage}: ${s.durationMs}ms`, meta);
  }

  /** Registra tokens consumidos por uma chamada ao LLM */
  recordTokens({ input = 0, output = 0, provider = null, model = null } = {}) {
    this.tokens.input  += input;
    this.tokens.output += output;
    this.tokens.total  += input + output;
    if (provider) this.provider = provider;
    if (model)    this.model    = model;
  }

  /** Registra um alerta de rate limit por provider */
  recordRateLimit(provider, details = {}) {
    const msg = `[Tracer] Rate limit: provider=${provider}`;
    logger.warn(msg, details);
    this.errors.push({ type: 'rate_limit', provider, details, ts: Date.now() });
  }

  /** Registra um erro em uma etapa */
  recordError(stage, error) {
    this.errors.push({ stage, message: error?.message || String(error), ts: Date.now() });
    logger.warn(`[Tracer:${this.tenantId}] Error in ${stage}:`, error?.message);
  }

  /** Finaliza o trace e persiste no banco */
  async finish(status = 'success') {
    const totalMs = Date.now() - this.startTime;

    // Persistir métricas no banco
    try {
      const db = require('../utils/database');
      db.run(
        `INSERT INTO ai_requests
         (workspace_id, model, tokens_used, response_time, pipeline_stage, status, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          this.tenantId,
          this.model || 'unknown',
          this.tokens.total,
          totalMs,
          'pipeline',
          status,
          this.errors.length > 0 ? JSON.stringify(this.errors[0]) : null,
        ]
      );
    } catch (dbErr) {
      logger.warn('[Tracer] Failed to persist metrics:', dbErr.message);
    }

    logger.info(`[Tracer:${this.tenantId}] Pipeline completo em ${totalMs}ms | tokens=${this.tokens.total} | status=${status}`);

    return {
      requestId:  this.requestId,
      tenantId:   this.tenantId,
      totalMs,
      stages:     this.stages,
      tokens:     this.tokens,
      provider:   this.provider,
      model:      this.model,
      errors:     this.errors,
      status,
    };
  }

  /** Snapshot das métricas atuais (para streaming ou debug) */
  snapshot() {
    return {
      requestId: this.requestId,
      elapsedMs: Date.now() - this.startTime,
      stages: Object.fromEntries(
        Object.entries(this.stages).map(([k, v]) => [k, v.durationMs])
      ),
      tokens: this.tokens,
    };
  }
}

module.exports = PipelineTracer;
