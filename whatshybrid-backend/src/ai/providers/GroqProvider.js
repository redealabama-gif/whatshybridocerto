/**
 * ⚡ Groq Provider - Ultra-fast inference
 * WhatsHybrid Pro v7.1.0
 */

const BaseProvider = require('./BaseProvider');

class GroqProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'groq';
    this.displayName = 'Groq';
    this.baseUrl = config.baseUrl || 'https://api.groq.com/openai/v1';
    this.apiKey = config.apiKey || process.env.GROQ_API_KEY;
    
    this.models = [
      { 
        id: 'llama-3.3-70b-versatile', 
        name: 'Llama 3.3 70B', 
        contextWindow: 128000,
        inputPrice: 0.00059,
        outputPrice: 0.00079,
        description: 'Most capable Llama model'
      },
      { 
        id: 'llama-3.1-70b-versatile', 
        name: 'Llama 3.1 70B', 
        contextWindow: 128000,
        inputPrice: 0.00059,
        outputPrice: 0.00079,
        description: 'Previous generation 70B'
      },
      { 
        id: 'llama-3.1-8b-instant', 
        name: 'Llama 3.1 8B', 
        contextWindow: 128000,
        inputPrice: 0.00005,
        outputPrice: 0.00008,
        description: 'Fastest model'
      },
      { 
        id: 'mixtral-8x7b-32768', 
        name: 'Mixtral 8x7B', 
        contextWindow: 32768,
        inputPrice: 0.00024,
        outputPrice: 0.00024,
        description: 'Mixture of Experts'
      },
      { 
        id: 'gemma2-9b-it', 
        name: 'Gemma 2 9B', 
        contextWindow: 8192,
        inputPrice: 0.0002,
        outputPrice: 0.0002,
        description: 'Google Gemma 2'
      }
    ];
    
    this.defaultModel = 'llama-3.3-70b-versatile';
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
            max_tokens: options.maxTokens || 2048,
            temperature: options.temperature ?? 0.7,
            top_p: options.topP ?? 1,
            ...(options.stop && { stop: options.stop })
          }),
          signal: AbortSignal.timeout(this.timeout)
        });

        if (!res.ok) {
          const error = await res.json().catch(() => ({}));
          const err = new Error(error.error?.message || `HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }

        return res.json();
      });

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

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: this.formatMessages(messages),
        max_tokens: options.maxTokens || 2048,
        temperature: options.temperature ?? 0.7,
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
