/**
 * 🟢 OpenAI Provider - GPT-4o, GPT-4, GPT-3.5
 * WhatsHybrid Pro v7.1.0
 */

const BaseProvider = require('./BaseProvider');

class OpenAIProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'openai';
    this.displayName = 'OpenAI';
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    
    this.models = [
      { 
        id: 'gpt-4o', 
        name: 'GPT-4o', 
        contextWindow: 128000,
        inputPrice: 0.0025, // per 1K tokens
        outputPrice: 0.01,
        description: 'Most advanced model, multimodal'
      },
      { 
        id: 'gpt-4o-mini', 
        name: 'GPT-4o Mini', 
        contextWindow: 128000,
        inputPrice: 0.00015,
        outputPrice: 0.0006,
        description: 'Fast and affordable'
      },
      { 
        id: 'gpt-4-turbo', 
        name: 'GPT-4 Turbo', 
        contextWindow: 128000,
        inputPrice: 0.01,
        outputPrice: 0.03,
        description: '128K context window'
      },
      { 
        id: 'gpt-4', 
        name: 'GPT-4', 
        contextWindow: 8192,
        inputPrice: 0.03,
        outputPrice: 0.06,
        description: 'Original GPT-4'
      },
      { 
        id: 'gpt-3.5-turbo', 
        name: 'GPT-3.5 Turbo', 
        contextWindow: 16385,
        inputPrice: 0.0005,
        outputPrice: 0.0015,
        description: 'Fast and cheap'
      }
    ];
    
    this.defaultModel = 'gpt-4o-mini';
  }

  calculateCost(promptTokens, completionTokens, modelId) {
    const model = this.models.find(m => m.id === modelId) || this.models[1];
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
            presence_penalty: options.presencePenalty ?? 0,
            frequency_penalty: options.frequencyPenalty ?? 0,
            ...(options.stop && { stop: options.stop }),
            ...(options.responseFormat && { response_format: options.responseFormat })
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

  async embed(text, options = {}) {
    if (!this.apiKey) {
      throw new Error(`${this.name}: API key not configured`);
    }

    const model = options.model || 'text-embedding-3-small';
    
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model,
        input: Array.isArray(text) ? text : [text]
      }),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return {
      embeddings: data.data.map(d => d.embedding),
      model: data.model,
      usage: {
        totalTokens: data.usage?.total_tokens || 0
      }
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

module.exports = OpenAIProvider;
