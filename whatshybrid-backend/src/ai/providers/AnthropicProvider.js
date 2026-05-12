/**
 * 🟠 Anthropic Provider - Claude 3.5, Claude 3
 * WhatsHybrid Pro v7.1.0
 */

const BaseProvider = require('./BaseProvider');

class AnthropicProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'anthropic';
    this.displayName = 'Anthropic (Claude)';
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.apiVersion = '2023-06-01';
    
    this.models = [
      { 
        id: 'claude-3-5-sonnet-20241022', 
        name: 'Claude 3.5 Sonnet', 
        contextWindow: 200000,
        inputPrice: 0.003, // per 1K tokens
        outputPrice: 0.015,
        description: 'Best balance of intelligence and speed'
      },
      { 
        id: 'claude-3-5-haiku-20241022', 
        name: 'Claude 3.5 Haiku', 
        contextWindow: 200000,
        inputPrice: 0.001,
        outputPrice: 0.005,
        description: 'Fastest Claude model'
      },
      { 
        id: 'claude-3-opus-20240229', 
        name: 'Claude 3 Opus', 
        contextWindow: 200000,
        inputPrice: 0.015,
        outputPrice: 0.075,
        description: 'Most capable Claude model'
      },
      { 
        id: 'claude-3-sonnet-20240229', 
        name: 'Claude 3 Sonnet', 
        contextWindow: 200000,
        inputPrice: 0.003,
        outputPrice: 0.015,
        description: 'Previous generation Sonnet'
      },
      { 
        id: 'claude-3-haiku-20240307', 
        name: 'Claude 3 Haiku', 
        contextWindow: 200000,
        inputPrice: 0.00025,
        outputPrice: 0.00125,
        description: 'Previous generation Haiku'
      }
    ];
    
    this.defaultModel = 'claude-3-5-sonnet-20241022';
  }

  calculateCost(promptTokens, completionTokens, modelId) {
    const model = this.models.find(m => m.id === modelId) || this.models[0];
    const inputCost = (promptTokens / 1000) * model.inputPrice;
    const outputCost = (completionTokens / 1000) * model.outputPrice;
    return inputCost + outputCost;
  }

  formatMessages(messages) {
    // Claude uses a different format - extract system message
    const systemMessage = messages.find(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');
    
    return {
      system: systemMessage?.content || undefined,
      messages: otherMessages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))
    };
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
    const formatted = this.formatMessages(messages);

    try {
      const response = await this.withRetry(async () => {
        const res = await fetch(`${this.baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': this.apiVersion
          },
          body: JSON.stringify({
            model,
            max_tokens: options.maxTokens || 2048,
            temperature: options.temperature ?? 0.7,
            top_p: options.topP ?? 1,
            ...(formatted.system && { system: formatted.system }),
            messages: formatted.messages,
            ...(options.stop && { stop_sequences: options.stop })
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
    const content = response.content?.[0]?.text || '';
    return {
      content,
      model: response.model,
      usage: {
        promptTokens: response.usage?.input_tokens || 0,
        completionTokens: response.usage?.output_tokens || 0,
        totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
      },
      finishReason: response.stop_reason || 'end_turn'
    };
  }

  async *stream(messages, options = {}) {
    if (!this.apiKey) {
      throw new Error(`${this.name}: API key not configured`);
    }

    const model = options.model || this.defaultModel;
    const formatted = this.formatMessages(messages);

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion
      },
      body: JSON.stringify({
        model,
        max_tokens: options.maxTokens || 2048,
        temperature: options.temperature ?? 0.7,
        ...(formatted.system && { system: formatted.system }),
        messages: formatted.messages,
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
            
            try {
              const json = JSON.parse(data);
              if (json.type === 'content_block_delta') {
                const content = json.delta?.text;
                if (content) {
                  yield { content, provider: this.name, model };
                }
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

module.exports = AnthropicProvider;
