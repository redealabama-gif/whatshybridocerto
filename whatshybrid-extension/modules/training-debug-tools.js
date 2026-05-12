/**
 * TrainingDebugTools - Ferramentas de treinamento e debug
 * Paridade com CERTO-WHATSAPPLITE
 */
class TrainingDebugTools {
  constructor() {
    // Training
    this.examples = [];
    this.exampleCategories = new Set();
    
    // Debug
    this.logs = [];
    this.maxLogs = 1000;
    this.debugMode = false;
  }

  async initialize() {
    await this.loadExamples();
    await this.loadLogs();
    await this.loadSettings();
    console.log('[TrainingDebug] ✅ Inicializado com', this.examples.length, 'exemplos');
  }

  async init() {
    await this.initialize();
  }

  // ============================================================
  // GERENCIAMENTO DE EXEMPLOS
  // ============================================================
  
  addExample(input, output, metadata = {}) {
    const example = {
      id: `ex_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      input: input.trim(),
      output: output.trim(),
      category: metadata.category || 'general',
      tags: metadata.tags || [],
      quality: metadata.quality || 'good',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0
    };
    
    this.examples.push(example);
    this.exampleCategories.add(example.category);
    this.saveExamples();
    this.log(`Exemplo adicionado: ${example.id}`, { category: example.category }, 'info', 'training');
    return example;
  }
  
  editExample(id, updates) {
    const idx = this.examples.findIndex(e => e.id === id);
    if (idx === -1) return null;
    
    const example = this.examples[idx];
    if (updates.input !== undefined) example.input = updates.input.trim();
    if (updates.output !== undefined) example.output = updates.output.trim();
    if (updates.category !== undefined) {
      example.category = updates.category;
      this.exampleCategories.add(updates.category);
    }
    if (updates.tags !== undefined) example.tags = updates.tags;
    if (updates.quality !== undefined) example.quality = updates.quality;
    example.updatedAt = Date.now();
    
    this.saveExamples();
    this.log(`Exemplo editado: ${id}`, updates, 'info', 'training');
    return example;
  }
  
  deleteExample(id) {
    const idx = this.examples.findIndex(e => e.id === id);
    if (idx === -1) return false;
    this.examples.splice(idx, 1);
    this.saveExamples();
    this.log(`Exemplo deletado: ${id}`, {}, 'info', 'training');
    return true;
  }
  
  listExamples(filter = {}) {
    let examples = [...this.examples];
    
    if (filter.category) examples = examples.filter(e => e.category === filter.category);
    if (filter.quality) examples = examples.filter(e => e.quality === filter.quality);
    if (filter.search) {
      const query = filter.search.toLowerCase();
      examples = examples.filter(e => 
        e.input.toLowerCase().includes(query) || e.output.toLowerCase().includes(query)
      );
    }
    
    return examples.sort((a, b) => b.createdAt - a.createdAt);
  }
  
  recordExampleUsage(id) {
    const example = this.examples.find(e => e.id === id);
    if (example) {
      example.usageCount++;
      example.lastUsedAt = Date.now();
      this.saveExamples();
    }
  }

  // ============================================================
  // EXPORTAR/IMPORTAR EXEMPLOS
  // ============================================================
  
  exportExamples(format = 'json', filter = {}) {
    const examples = this.listExamples(filter);
    
    if (format === 'json') {
      return JSON.stringify(examples, null, 2);
    }
    
    if (format === 'csv') {
      const headers = ['id', 'input', 'output', 'category', 'quality', 'usageCount', 'createdAt'];
      const rows = examples.map(e => [
        e.id,
        `"${e.input.replace(/"/g, '""')}"`,
        `"${e.output.replace(/"/g, '""')}"`,
        e.category,
        e.quality,
        e.usageCount,
        new Date(e.createdAt).toISOString()
      ]);
      return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    }
    
    if (format === 'jsonl') {
      return examples.map(e => JSON.stringify({
        messages: [
          { role: 'user', content: e.input },
          { role: 'assistant', content: e.output }
        ]
      })).join('\n');
    }
    
    return JSON.stringify(examples);
  }
  
  importExamples(content, format = 'json') {
    try {
      let data;
      
      if (format === 'json') {
        data = typeof content === 'string' ? JSON.parse(content) : content;
      } else if (format === 'jsonl') {
        data = content.split('\n').filter(line => line.trim()).map(line => {
          const parsed = JSON.parse(line);
          if (parsed.messages) {
            return {
              input: parsed.messages.find(m => m.role === 'user')?.content || '',
              output: parsed.messages.find(m => m.role === 'assistant')?.content || ''
            };
          }
          return parsed;
        });
      } else {
        throw new Error('Formato não suportado');
      }
      
      let imported = 0, skipped = 0;
      
      for (const item of data) {
        if (!item.input || !item.output) { skipped++; continue; }
        
        const isDuplicate = this.examples.some(e => e.input === item.input && e.output === item.output);
        if (isDuplicate) { skipped++; continue; }
        
        this.examples.push({
          id: item.id || `ex_${Date.now()}_${imported}`,
          input: item.input,
          output: item.output,
          category: item.category || 'imported',
          tags: item.tags || [],
          quality: item.quality || 'good',
          createdAt: item.createdAt || Date.now(),
          updatedAt: Date.now(),
          usageCount: item.usageCount || 0,
          createdBy: 'import'
        });
        imported++;
      }
      
      this.saveExamples();
      this.log(`Importação: ${imported} importados, ${skipped} ignorados`, {}, 'info', 'training');
      return { imported, skipped, total: this.examples.length };
    } catch (error) {
      this.log(`Erro na importação: ${error.message}`, { error }, 'error', 'training');
      return { imported: 0, skipped: 0, error: error.message };
    }
  }

  // ============================================================
  // SISTEMA DE LOGS
  // ============================================================
  
  log(message, data = {}, level = 'info', category = 'general') {
    const entry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
      stack: level === 'error' ? new Error().stack : null
    };
    
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs = this.logs.slice(-800);
    
    // Console output
    if (this.debugMode || level === 'error' || level === 'warn') {
      const colors = { debug: '#888', info: '#25D366', warn: '#FFA500', error: '#FF4444' };
      console.log(`%c[${level.toUpperCase()}] [${category}] ${message}`, `color: ${colors[level]}`);
      if (Object.keys(data).length > 0) console.log('  Data:', data);
    }
    
    return entry;
  }
  
  debug(message, data, category) { return this.log(message, data, 'debug', category); }
  info(message, data, category) { return this.log(message, data, 'info', category); }
  warn(message, data, category) { return this.log(message, data, 'warn', category); }
  error(message, data, category) { return this.log(message, data, 'error', category); }
  
  filterLogs(filters = {}) {
    let logs = [...this.logs];
    if (filters.level && filters.level !== 'all') logs = logs.filter(l => l.level === filters.level);
    if (filters.category && filters.category !== 'all') logs = logs.filter(l => l.category === filters.category);
    if (filters.since) logs = logs.filter(l => l.timestamp >= filters.since);
    if (filters.search) {
      const query = filters.search.toLowerCase();
      logs = logs.filter(l => l.message.toLowerCase().includes(query));
    }
    return logs.sort((a, b) => b.timestamp - a.timestamp);
  }
  
  exportLogs(format = 'json', filters = {}) {
    const logs = this.filterLogs(filters);
    
    if (format === 'json') return JSON.stringify(logs, null, 2);
    
    if (format === 'csv') {
      const headers = ['timestamp', 'level', 'category', 'message'];
      const rows = logs.map(l => [
        new Date(l.timestamp).toISOString(),
        l.level,
        l.category,
        `"${l.message.replace(/"/g, '""')}"`
      ]);
      return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    }
    
    if (format === 'txt') {
      return logs.map(l => 
        `[${new Date(l.timestamp).toISOString()}] [${l.level.toUpperCase()}] [${l.category}] ${l.message}`
      ).join('\n');
    }
    
    return JSON.stringify(logs);
  }
  
  clearLogs(filters = {}) {
    if (Object.keys(filters).length === 0) {
      const count = this.logs.length;
      this.logs = [];
      this.log('Logs limpos', { count }, 'info', 'system');
      return count;
    }
    
    const toKeep = this.logs.filter(l => {
      if (filters.level && l.level === filters.level) return false;
      if (filters.category && l.category === filters.category) return false;
      return true;
    });
    
    const removed = this.logs.length - toKeep.length;
    this.logs = toKeep;
    return removed;
  }

  // ============================================================
  // DEBUG MODE
  // ============================================================
  
  setDebugMode(enabled) {
    this.debugMode = enabled;
    this.saveSettings();
    this.log(`Debug mode: ${enabled ? 'ATIVADO' : 'DESATIVADO'}`, {}, 'info', 'system');
    if (enabled) {
      console.log('%c[DEBUG MODE ATIVADO]', 'background: #25D366; color: white; padding: 4px 8px; border-radius: 4px;');
    }
    return enabled;
  }
  
  toggleDebugMode() { return this.setDebugMode(!this.debugMode); }
  isDebugMode() { return this.debugMode; }

  // ============================================================
  // ESTATÍSTICAS
  // ============================================================
  
  getTrainingStats() {
    const categories = {};
    const qualities = { good: 0, excellent: 0, needs_review: 0 };
    
    for (const example of this.examples) {
      categories[example.category] = (categories[example.category] || 0) + 1;
      if (qualities[example.quality] !== undefined) qualities[example.quality]++;
    }
    
    return {
      totalExamples: this.examples.length,
      categories: Object.entries(categories).map(([name, count]) => ({ name, count })),
      qualities,
      avgUsage: this.examples.length > 0 
        ? Math.round(this.examples.reduce((sum, e) => sum + e.usageCount, 0) / this.examples.length)
        : 0,
      mostUsed: [...this.examples].sort((a, b) => b.usageCount - a.usageCount).slice(0, 5)
    };
  }
  
  getDebugStats() {
    const levels = { debug: 0, info: 0, warn: 0, error: 0 };
    const categories = {};
    
    for (const log of this.logs) {
      levels[log.level] = (levels[log.level] || 0) + 1;
      categories[log.category] = (categories[log.category] || 0) + 1;
    }
    
    const last24h = this.logs.filter(l => l.timestamp > Date.now() - 86400000);
    
    return {
      totalLogs: this.logs.length,
      levels,
      categories: Object.entries(categories).map(([name, count]) => ({ name, count })),
      last24h: last24h.length,
      errorsLast24h: last24h.filter(l => l.level === 'error').length,
      debugMode: this.debugMode
    };
  }

  // ============================================================
  // PERSISTÊNCIA
  // ============================================================
  
  async saveExamples() {
    await chrome.storage.local.set({ training_examples: this.examples });
  }
  
  async loadExamples() {
    return new Promise(r => {
      chrome.storage.local.get(['training_examples'], res => {
        if (res.training_examples) {
          this.examples = res.training_examples;
          this.examples.forEach(e => this.exampleCategories.add(e.category));
        }
        r();
      });
    });
  }
  
  async saveLogs() {
    await chrome.storage.local.set({ debug_logs: this.logs.slice(-500) });
  }
  
  async loadLogs() {
    return new Promise(r => {
      chrome.storage.local.get(['debug_logs'], res => {
        if (res.debug_logs) this.logs = res.debug_logs;
        r();
      });
    });
  }
  
  async saveSettings() {
    await chrome.storage.local.set({ debug_settings: { debugMode: this.debugMode } });
  }
  
  async loadSettings() {
    return new Promise(r => {
      chrome.storage.local.get(['debug_settings'], res => {
        if (res.debug_settings) this.debugMode = res.debug_settings.debugMode || false;
        r();
      });
    });
  }
}

window.TrainingDebugTools = new TrainingDebugTools();
