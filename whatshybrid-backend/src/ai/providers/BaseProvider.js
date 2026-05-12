/**
 * 🤖 BaseProvider - Interface base para providers de IA
 * WhatsHybrid Pro v7.1.0
 * 
 * Todos os providers devem estender esta classe
 */

class BaseProvider {
  constructor(config = {}) {
    this.name = 'base';
    this.displayName = 'Base Provider';
    this.config = config;
    this.apiKey = config.apiKey || process.env[`${this.name.toUpperCase()}_API_KEY`];
    this.baseUrl = config.baseUrl || null;
    this.models = [];
    this.defaultModel = null;
    this.maxRetries = config.maxRetries || 3;
    this.timeout = config.timeout || 60000;
    
    // Circuit breaker state
    this.circuitState = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.failureThreshold = 5;
    this.resetTimeout = 30000; // 30 seconds
    this.lastFailureTime = null;
    
    // Metrics
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalTokens: 0,
      totalCost: 0,
      avgLatency: 0,
      latencies: []
    };
  }

  /**
   * Verifica se o provider está configurado
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Verifica se o provider está disponível (circuit breaker)
   */
  isAvailable() {
    if (this.circuitState === 'OPEN') {
      // Check if we should try half-open
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.circuitState = 'HALF_OPEN';
        return true;
      }
      return false;
    }
    return true;
  }

  /**
   * Registra sucesso (fecha circuit breaker)
   */
  recordSuccess() {
    this.failureCount = 0;
    this.circuitState = 'CLOSED';
    this.metrics.successfulRequests++;
  }

  /**
   * Registra falha (abre circuit breaker se necessário)
   */
  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.metrics.failedRequests++;
    
    if (this.failureCount >= this.failureThreshold) {
      this.circuitState = 'OPEN';
      logger.warn(`[${this.name}] Circuit breaker OPEN after ${this.failureCount} failures`);
    }
  }

  /**
   * Registra latência
   */
  recordLatency(latencyMs) {
    this.metrics.latencies.push(latencyMs);
    // Keep only last 100 latencies
    if (this.metrics.latencies.length > 100) {
      this.metrics.latencies.shift();
    }
    this.metrics.avgLatency = 
      this.metrics.latencies.reduce((a, b) => a + b, 0) / this.metrics.latencies.length;
  }

  /**
   * Retorna lista de modelos disponíveis
   */
  getModels() {
    return this.models;
  }

  /**
   * Retorna modelo padrão
   */
  getDefaultModel() {
    return this.defaultModel;
  }

  /**
   * Valida se um modelo está disponível
   */
  hasModel(model) {
    return this.models.some(m => m.id === model || m.name === model);
  }

  /**
   * Calcula custo estimado baseado em tokens
   */
  calculateCost(promptTokens, completionTokens, model) {
    // Override in each provider with actual pricing
    return 0;
  }

  /**
   * Método principal de completion - DEVE ser implementado por cada provider
   */
  async complete(messages, options = {}) {
    throw new Error(`${this.name}: complete() not implemented`);
  }

  /**
   * Gera embeddings - opcional
   */
  async embed(text, options = {}) {
    throw new Error(`${this.name}: embed() not implemented`);
  }

  /**
   * Streaming completion - opcional
   */
  async *stream(messages, options = {}) {
    throw new Error(`${this.name}: stream() not implemented`);
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const start = Date.now();
      await this.complete([{ role: 'user', content: 'Hi' }], { maxTokens: 5 });
      const latency = Date.now() - start;
      return { healthy: true, latency };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  /**
   * Retorna métricas do provider
   */
  getMetrics() {
    return {
      ...this.metrics,
      circuitState: this.circuitState,
      failureCount: this.failureCount,
      isAvailable: this.isAvailable(),
      isConfigured: this.isConfigured()
    };
  }

  /**
   * Formata mensagens para o formato esperado pelo provider
   */
  formatMessages(messages) {
    // Override if provider needs different format
    return messages.map(m => ({
      role: m.role,
      content: m.content
    }));
  }

  /**
   * Parseia resposta do provider para formato padronizado
   */
  parseResponse(response) {
    // Override in each provider
    return {
      content: '',
      model: '',
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      },
      finishReason: 'stop'
    };
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Retry com exponential backoff
   */
  async withRetry(fn, maxRetries = this.maxRetries) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        // Don't retry on auth errors or invalid requests
        if (error.status === 401 || error.status === 400) {
          throw error;
        }
        
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s, 8s
          logger.warn(`[${this.name}] Retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
          await this.sleep(delay);
        }
      }
    }
    
    throw lastError;
  }
}

module.exports = BaseProvider;
