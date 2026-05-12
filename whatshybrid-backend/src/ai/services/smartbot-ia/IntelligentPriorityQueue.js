/**
 * IntelligentPriorityQueue
 * @file Extraído de SmartBotIAService.js (refactor v9)
 */

const EventEmitter = require('events');

class IntelligentPriorityQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.queue = [];
    this.processing = false;
    this.maxRetries = options.maxRetries || 3;
    this.processDelay = options.processDelay || 1000;
  }

  enqueue(item, context = {}) {
    const priority = this.calculatePriority(item, context);
    
    const queueItem = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      item,
      priority,
      retries: 0,
      addedAt: new Date().toISOString(),
      context
    };

    const insertIndex = this.queue.findIndex(q => q.priority < priority);
    if (insertIndex === -1) {
      this.queue.push(queueItem);
    } else {
      this.queue.splice(insertIndex, 0, queueItem);
    }

    this.emit('enqueue', queueItem);
    
    if (!this.processing) {
      this.startProcessing();
    }

    return queueItem.id;
  }

  calculatePriority(item, context) {
    let priority = 50;

    if (context.sentiment !== undefined) {
      if (context.sentiment < 0.3) priority += 30;
      else if (context.sentiment < 0.5) priority += 15;
    }

    const intent = context.intent || item.intent;
    if (intent === 'complaint') priority += 25;
    else if (intent === 'urgent') priority += 35;
    else if (intent === 'question') priority += 10;

    if (context.urgency !== undefined) {
      priority += context.urgency * 30;
    }

    const text = (item.body || item.text || item.content || '').toLowerCase();
    const urgentWords = ['urgente', 'emergência', 'imediato', 'agora', 'crítico'];
    urgentWords.forEach(word => {
      if (text.includes(word)) priority += 10;
    });

    if (context.isVIP) priority += 20;
    if (context.messageCount > 20) priority += 5;

    if (item.waitTime > 60000) priority += 10;
    if (item.waitTime > 300000) priority += 15;

    return Math.min(100, Math.max(0, priority));
  }

  async startProcessing() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      
      try {
        this.emit('process', item);
        await this.processItem(item);
        this.emit('processed', item);
      } catch (error) {
        item.retries++;
        
        if (item.retries < this.maxRetries) {
          item.priority = Math.max(0, item.priority - 10);
          this.queue.push(item);
          this.emit('retry', item);
        } else {
          this.emit('failed', { item, error });
        }
      }

      if (this.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.processDelay));
      }
    }

    this.processing = false;
  }

  async processItem(item) {
    // Override in subclass or set handler
    return item;
  }

  setHandler(handler) {
    this.processItem = handler;
  }

  getStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      items: this.queue.map(q => ({
        id: q.id,
        priority: q.priority,
        retries: q.retries,
        addedAt: q.addedAt
      }))
    };
  }

  clear() {
    this.queue = [];
    this.processing = false;
  }

  remove(id) {
    const index = this.queue.findIndex(q => q.id === id);
    if (index !== -1) {
      this.queue.splice(index, 1);
      return true;
    }
    return false;
  }
}

// ============================================================
// CONTINUOUS LEARNING SYSTEM
// ============================================================

module.exports = IntelligentPriorityQueue;
