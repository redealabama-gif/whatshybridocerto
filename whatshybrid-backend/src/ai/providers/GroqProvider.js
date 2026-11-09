/**
 * ⚡ Groq Provider - Ultra-fast inference
 * Vórtex Pro v7.1.0
 */

const BaseProvider = require('./BaseProvider');

// IA-41: modelos de raciocínio da Groq (precisam de reasoning_effort e de folga de tokens).
const REASONING_MODEL_RE = /^(openai\/gpt-oss|qwen\/)/;

class GroqProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'groq';
    this.displayName = 'Groq';
    this.baseUrl = config.baseUrl || 'https://api.groq.com/openai/v1';
    this.apiKey = config.apiKey || process.env.GROQ_API_KEY;
    
    // IA-41: a Groq desativou os Llama/Mixtral/Gemma que estavam aqui (404
    // model_not_found). Modelos de chat da conta em 2026-11-09; preços
    // aproximados, por 1k tokens (só para métricas de custo).
    this.models = [
      {
        id: 'openai/gpt-oss-120b',
        name: 'GPT-OSS 120B',
        contextWindow: 131072,
        inputPrice: 0.00015,
        outputPrice: 0.0006,
        description: 'Modelo de raciocínio, o mais capaz da Groq'
      },
      {
        id: 'openai/gpt-oss-20b',
        name: 'GPT-OSS 20B',
        contextWindow: 131072,
        inputPrice: 0.000075,
        outputPrice: 0.0003,
        description: 'Modelo de raciocínio menor e mais barato'
      },
      {
        id: 'qwen/qwen3.8-27b',
        name: 'Qwen3.8 27B',
        contextWindow: 131072,
        inputPrice: 0.00029,
        outputPrice: 0.00059,
        description: 'Qwen 3.8'
      }
    ];

    this.defaultModel = config.defaultModel || process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  }

  calculateCost(promptTokens, completionTokens, modelId) {
    const model = this.models.find(m => m.id === modelId) || this.models[0];
    const inputCost = (promptTokens / 1000) * model.inputPrice;
    const outputCost = (completionTokens / 1000) * model.outputPrice;
    return inputCost + outputCost;
  }

  async complete(messages, options = {}) {
    if (!this.isAvailable()) {
      throw new Error(`${this.name}: Circuit breaker is OPEN`);
    }
    
    if (!this.apiKey) {
      throw new Error(`${this.name}: API key not configured`);
    }

    const model = options.model || this.defaultModel;
    const reasoning = REASONING_MODEL_RE.test(model); // IA-41
    const startTime = Date.now();

    try {
      const response = await this.withRetry(async () => {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: this.formatMessages(messages),
            // IA-41: nos modelos de raciocínio o limite inclui o raciocínio;
            // abaixo de ~512 o texto volta vazio (finish_reason=length).
            max_tokens: reasoning ? Math.max(options.maxTokens || 2048, 512) : (options.maxTokens || 2048),
            temperature: options.temperature ?? 0.7,
            top_p: options.topP ?? 1,
            ...(reasoning && { reasoning_effort: 'low' }),
            ...(options.stop && { stop: options.stop })
          }),
          signal: AbortSignal.timeout(this.attemptTimeout(options.deadline)) // IA-11
        });

        if (!res.ok) {
          const error = await res.json().catch(() => ({}));
          const err = new Error(error.error?.message || `HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }

        return res.json();
      }, Number.isInteger(options.maxRetries) ? options.maxRetries : this.maxRetries, options.deadline); // IA-11

      // IA-41: texto vazio (o raciocínio consumiu o limite) é falha, para o
      // roteador tentar o próximo provedor — não uma "resposta" em branco.
      const text = response?.choices?.[0]?.message?.content;
      if (!text || !String(text).trim()) {
        const err = new Error(`${this.name}: resposta vazia do modelo ${model} (finish_reason=${response?.choices?.[0]?.finish_reason || '?'})`);
        err.code = 'EMPTY_COMPLETION';
        throw err;
      }

      const latency = Date.now() - startTime;
      this.recordLatency(latency);
      this.recordSuccess();
      this.metrics.totalRequests++;

      const result = this.parseResponse(response);
      result.latency = latency;
      result.provider = this.name;
      result.cost = this.calculateCost(result.usage.promptTokens, result.usage.completionTokens, model);
      
      this.metrics.totalTokens += result.usage.totalTokens;
      this.metrics.totalCost += result.cost;

      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  parseResponse(response) {
    const choice = response.choices?.[0];
    return {
      content: choice?.message?.content || '',
      model: response.model,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0
      },
      finishReason: choice?.finish_reason || 'stop'
    };
  }

  async *stream(messages, options = {}) {
    if (!this.apiKey) {
      throw new Error(`${this.name}: API key not configured`);
    }

    const model = options.model || this.defaultModel;
    const reasoning = REASONING_MODEL_RE.test(model); // IA-41

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: this.formatMessages(messages),
        max_tokens: reasoning ? Math.max(options.maxTokens || 2048, 512) : (options.maxTokens || 2048),
        temperature: options.temperature ?? 0.7,
        ...(reasoning && { reasoning_effort: 'low' }),
        stream: true
      }),
      signal: AbortSignal.timeout(this.timeout * 2)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;
            
            try {
              const json = JSON.parse(data);
              const content = json.choices?.[0]?.delta?.content;
              if (content) {
                yield { content, provider: this.name, model };
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

module.exports = GroqProvider;
