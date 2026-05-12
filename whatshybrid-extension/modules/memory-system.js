/**
 * 🧠 Memory System - Sistema de Memória por Chat (Estilo Leão)
 * WhatsHybrid v9.0.0
 *
 * P6 FIX: Storage migrated from chrome.storage.local (10MB limit) to
 * IndexedDB via window.IDBStorage (loaded by idb-storage.js, no practical limit).
 * A transparent shim (_storage) is used so all existing read/write paths work
 * without further changes. idb-storage.js must be listed before this file in
 * manifest.json content_scripts.
 */

(function() {
  'use strict';

  // P6: shim — prefer IDBStorage, fall back to chrome.storage.local if not ready yet
  const _storage = {
    async get(key) {
      if (window.IDBStorage) return window.IDBStorage.get(key);
      return new Promise(r => chrome.storage.local.get(key, result => r(result[key])));
    },
    async set(key, value) {
      if (window.IDBStorage) return window.IDBStorage.set(key, value);
      return new Promise(r => chrome.storage.local.set({ [key]: value }, r));
    },
    async remove(key) {
      if (window.IDBStorage) return window.IDBStorage.remove(key);
      return new Promise(r => chrome.storage.local.remove(key, r));
    },
    async getBytesInUse() {
      if (window.IDBStorage) return window.IDBStorage.getBytesInUse();
      return new Promise(r => chrome.storage.local.getBytesInUse(null, r));
    },
  };

  const STORAGE_KEY = 'whl_memory_system';
  const MAX_MEMORIES = 200;
  const MAX_SUMMARY_LENGTH = 2000;
  const MAX_FACTS_PER_CHAT = 50;
  const MAX_INTERACTIONS = 100;
  const MEMORY_MAX_AGE_DAYS = 90;
  const MEMORY_SYNC_QUEUE_KEY = 'whl_memory_sync_queue';
  const WHL_DEBUG = (typeof localStorage !== 'undefined' && localStorage.getItem('whl_debug') === 'true');

  // SECURITY FIX P0-036: Prevent Prototype Pollution from storage
  function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return {};

    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const sanitized = {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key) && !dangerousKeys.includes(key)) {
        const value = obj[key];
        // Recursively sanitize nested objects
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          sanitized[key] = sanitizeObject(value);
        } else {
          sanitized[key] = value;
        }
      }
    }

    return sanitized;
  }

  function isValidName(name) {
    if (!name) return false;
    const trimmed = String(name).trim();
    if (trimmed.length < 2 || trimmed.length > 50) return false;
    const invalid = ['eu','você','voce','ele','ela','nós','nos','eles','elas'];
    return !invalid.includes(trimmed.toLowerCase());
  }

  function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  function isValidPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15;
  }

  function isValidBudget(value) {
    if (value === undefined || value === null) return false;
    const normalized = String(value).replace(/\./g, '').replace(',', '.');
    const num = Number(normalized);
    return Number.isFinite(num) && num >= 0;
  }

  // ═══════════════════════════════════════════════════════════════════
  // TIPOS DE FATOS PARA EXTRAÇÃO AUTOMÁTICA
  // ═══════════════════════════════════════════════════════════════════
  const FACT_TYPES = {
    NAME: 'name',
    EMAIL: 'email',
    PHONE: 'phone',
    COMPANY: 'company',
    PREFERENCE: 'preference',
    INTEREST: 'interest',
    BUDGET: 'budget',
    TIMELINE: 'timeline',
    OBJECTION: 'objection',
    LOCATION: 'location',
    CUSTOM: 'custom'
  };

  class MemorySystem {
    constructor() {
      this.memories = new Map();
      this.initialized = false;
    }

    /**
     * Inicializa e carrega memórias do storage
     */
    async init() {
      if (this.initialized) return;

      try {
        const data = await _storage.get(STORAGE_KEY); // P6: IDBStorage
        if (data) {
          const stored = JSON.parse(typeof data === 'string' ? data : JSON.stringify(data));
          // SECURITY FIX P0-036: Sanitize each memory to prevent Prototype Pollution
          Object.entries(stored).forEach(([key, value]) => {
            const sanitizedValue = sanitizeObject(value);
            this.memories.set(key, sanitizedValue);
          });
          if (WHL_DEBUG) console.log('[MemorySystem] Memórias carregadas:', this.memories.size);
        }
        this.initialized = true;
        // Limpeza inicial e agendada de memórias antigas
        await this.cleanupOldMemories();
        if (!this._cleanupInterval) {
          this._cleanupInterval = setInterval(() => {
            this.cleanupOldMemories().catch(() => {});
          }, 24 * 60 * 60 * 1000); // diário
        }

        // Tenta reenviar eventos de sync pendentes (sem bloquear UI)
        this._flushSyncQueue?.().catch(() => {});
        if (!this._syncFlushInterval) {
          this._syncFlushInterval = setInterval(() => {
            this._flushSyncQueue?.().catch(() => {});
          }, 60 * 1000); // a cada 1 minuto
        }

        // Cleanup ao descarregar
        if (!this._beforeUnloadBound) {
          this._beforeUnloadBound = true;
          window.addEventListener('beforeunload', () => {
            if (this._cleanupInterval) {
              clearInterval(this._cleanupInterval);
              this._cleanupInterval = null;
            }
            if (this._syncFlushInterval) {
              clearInterval(this._syncFlushInterval);
              this._syncFlushInterval = null;
            }
          });
        }
      } catch (error) {
        console.error('[MemorySystem] Erro ao inicializar:', error);
      }
    }

    /**
     * Salva memórias no storage
     * FIX CRÍTICO: 142 módulos escrevem no chrome.storage.local sem coordenação
     * de quota. Quando o storage excede 5MB, chrome.runtime.lastError é disparado
     * silenciosamente em ~60% dos callbacks. Agora verificamos o uso antes de salvar
     * e fazemos cleanup/compressão preventiva quando próximo do limite.
     */
    async save() {
      try {
        const data = Object.fromEntries(this.memories);
        const payload = JSON.stringify(data);

        // P6: IDBStorage has no practical quota limit, so quota checks are for monitoring only
        const bytesInUse = await _storage.getBytesInUse();
        const QUOTA_BYTES    = 50 * 1024 * 1024; // 50MB soft-warn for IDB
        const WARN_THRESHOLD  = QUOTA_BYTES * 0.75;
        const EVICT_THRESHOLD = QUOTA_BYTES * 0.90;

        if (bytesInUse > EVICT_THRESHOLD) {
          console.warn(`[MemorySystem] ⚠️ IDB em ${Math.round(bytesInUse / 1024)}KB — evictando memórias antigas`);
          await this._evictOldestMemories(0.3);
        } else if (bytesInUse > WARN_THRESHOLD) {
          console.warn(`[MemorySystem] IDB em ${Math.round(bytesInUse / 1024)}KB — monitorando uso`);
        }

        const payloadBytes = new Blob([payload]).size;
        if (payloadBytes > 4 * 1024 * 1024) { // compress if single key > 4MB
          console.warn('[MemorySystem] Payload muito grande — comprimindo antes de salvar');
          await this._compressMemories();
          const compressed = JSON.stringify(Object.fromEntries(this.memories));
          await _storage.set(STORAGE_KEY, compressed); // P6
        } else {
          await _storage.set(STORAGE_KEY, payload);    // P6
        }

        if (WHL_DEBUG) console.log('[MemorySystem] Memórias salvas');
        return true;
      } catch (error) {
        if (error.message?.includes('QUOTA_BYTES')) {
          console.error('[MemorySystem] ❌ Quota excedida — limpando storage de emergência');
          await this._emergencyCleanup();
        } else {
          console.error('[MemorySystem] Erro ao salvar:', error);
        }
        return false;
      }
    }

    /** Remove os N% de memórias mais antigas por timestamp */
    async _evictOldestMemories(fraction = 0.3) {
      const entries = Array.from(this.memories.entries())
        .sort(([, a], [, b]) => (a.lastUpdated || 0) - (b.lastUpdated || 0));
      const removeCount = Math.ceil(entries.length * fraction);
      for (let i = 0; i < removeCount; i++) {
        this.memories.delete(entries[i][0]);
      }
      console.log(`[MemorySystem] Evictadas ${removeCount} memórias antigas`);
    }

    /** Comprime memórias removendo summaries de IA muito longos */
    async _compressMemories() {
      const MAX_SUMMARY_CHARS = 500;
      for (const [key, mem] of this.memories.entries()) {
        if (mem.summary && mem.summary.length > MAX_SUMMARY_CHARS) {
          this.memories.set(key, {
            ...mem,
            summary: mem.summary.slice(0, MAX_SUMMARY_CHARS) + '…'
          });
        }
        // Remove histórico bruto — mantém apenas o resumo
        if (mem.rawHistory) {
          const { rawHistory, ...compressed } = mem;
          this.memories.set(key, compressed);
        }
      }
    }

    /** Limpeza de emergência quando quota foi excedida */
    async _emergencyCleanup() {
      // Mantém apenas as 50 memórias mais recentes
      const entries = Array.from(this.memories.entries())
        .sort(([, a], [, b]) => (b.lastUpdated || 0) - (a.lastUpdated || 0))
        .slice(0, 50);
      this.memories = new Map(entries);
      try {
        await _storage.set(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.memories))); // P6
        console.log('[MemorySystem] ✅ Limpeza de emergência concluída — 50 memórias mantidas');
      } catch (e) {
        console.error('[MemorySystem] ❌ Falha até na limpeza de emergência:', e);
      }
    }

    /**
     * Obtém chave do chat
     * @param {string} chatId - ID do chat
     * @returns {string} - Chave formatada
     */
    getChatKey(chatId) {
      return `chat_${chatId}`;
    }

    /**
     * Obtém memória de um chat
     * @param {string} chatKey - Chave do chat
     * @returns {Object|null} - Memória do chat
     */
    getMemory(chatKey) {
      return this.memories.get(chatKey) || null;
    }

    /**
     * Define memória de um chat
     * @param {string} chatKey - Chave do chat
     * @param {Object} memoryObj - Objeto de memória
     */
    async setMemory(chatKey, memoryObj) {
      const existing = this.memories.get(chatKey) || {};
      const mergeUnique = (prev, next) => {
        const a = Array.isArray(prev) ? prev : [];
        const b = Array.isArray(next) ? next : [];
        const out = [];
        const seen = new Set();
        for (const v of [...a, ...b]) {
          const s = String(v ?? '').trim();
          if (!s) continue;
          if (seen.has(s)) continue;
          seen.add(s);
          out.push(s);
        }
        return out;
      };

      // Valida estrutura (inclui novos campos)
      const memory = {
        profile: (memoryObj.profile ?? existing.profile ?? ''),
        preferences: mergeUnique(existing.preferences, memoryObj.preferences),
        context: mergeUnique(existing.context, memoryObj.context),
        open_loops: mergeUnique(existing.open_loops, memoryObj.open_loops),
        next_actions: mergeUnique(existing.next_actions, memoryObj.next_actions),
        tone: (memoryObj.tone ?? existing.tone ?? 'neutral'),
        // ✨ Novos campos v2.0
        facts: mergeUnique(existing.facts, memoryObj.facts),
        interactions: (Array.isArray(existing.interactions) ? existing.interactions : [])
          .concat(Array.isArray(memoryObj.interactions) ? memoryObj.interactions : [])
          .slice(-300),
        metrics: {
          totalMessages: 0,
          avgResponseTime: 0,
          lastInteraction: null,
          engagementScore: 0,
          ...(existing.metrics || {}),
          ...(memoryObj.metrics || {}),
          firstInteraction: existing.metrics?.firstInteraction || memoryObj.metrics?.firstInteraction || Date.now()
        },
        businessContext: {
          stage: 'initial',
          sentiment: 'neutral',
          lastTopic: null,
          agreements: [],
          ...(existing.businessContext || {}),
          ...(memoryObj.businessContext || {}),
          agreements: mergeUnique(existing.businessContext?.agreements, memoryObj.businessContext?.agreements)
        },
        pinned: Boolean(memoryObj.pinned ?? existing.pinned ?? false),
        vip: Boolean(memoryObj.vip ?? existing.vip ?? false),
        lastUpdated: Date.now(),
        version: '2.0.0'
      };

      // Limita tamanho do resumo
      if (memory.profile.length > MAX_SUMMARY_LENGTH) {
        memory.profile = memory.profile.substring(0, MAX_SUMMARY_LENGTH) + '...';
      }

      this.memories.set(chatKey, memory);

      // Limita número de memórias (remove mais antigas)
      if (this.memories.size > MAX_MEMORIES) {
        const sorted = Array.from(this.memories.entries())
          .sort((a, b) => (b[1].lastUpdated || 0) - (a[1].lastUpdated || 0));
        
        this.memories.clear();
        sorted.slice(0, MAX_MEMORIES).forEach(([key, value]) => {
          this.memories.set(key, value);
        });
        
        if (WHL_DEBUG) console.log('[MemorySystem] Limite de memórias atingido, removendo antigas');
      }

      await this.save();

      // Emite evento
      if (window.EventBus) {
        window.EventBus.emit('memory-system:updated', { chatKey, memory });
      }

      // Envia para backend se disponível
      // Fire-and-forget intencional para não bloquear UI
      this.pushToBackend(chatKey, memory);

      return memory;
    }

    /**
     * Remove memória de um chat
     * @param {string} chatKey - Chave do chat
     */
    async removeMemory(chatKey) {
      this.memories.delete(chatKey);
      await this.save();
        if (WHL_DEBUG) console.log('[MemorySystem] Memória removida:', chatKey);
    }

    /**
     * Limpa memórias antigas baseado em TTL
     */
    async cleanupOldMemories() {
      const cutoff = Date.now() - (MEMORY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
      let removed = 0;
      for (const [key, memory] of this.memories.entries()) {
        // Não remover memórias fixadas (VIP/pinned)
        if (memory?.pinned || memory?.vip) continue;
        if (memory.lastUpdated && memory.lastUpdated < cutoff) {
          this.memories.delete(key);
          removed++;
        }
      }
      if (removed > 0) {
        if (WHL_DEBUG) console.log(`[MemorySystem] ${removed} memórias removidas por TTL`);
        await this.save();
      }
    }

    /**
     * Gera memória a partir de transcrição usando IA
     * @param {string} transcript - Transcrição da conversa
     * @param {Object} options - Opções { chatKey, provider, model }
     * @returns {Object|null} - Memória gerada
     */
    async aiMemoryFromTranscript(transcript, options = {}) {
      if (!transcript || transcript.length < 50) {
        console.warn('[MemorySystem] Transcrição muito curta para gerar memória');
        return null;
      }

      try {
        const prompt = `Analise a seguinte conversa e gere um resumo estruturado em JSON com os seguintes campos:

{
  "profile": "resumo breve do contato (quem é, o que faz, contexto geral)",
  "preferences": ["lista de preferências detectadas"],
  "context": ["fatos confirmados e informações importantes"],
  "open_loops": ["pendências, coisas não resolvidas"],
  "next_actions": ["próximos passos sugeridos"],
  "tone": "tom recomendado para próximas interações (formal, casual, técnico, etc)"
}

Conversa:
${transcript}

Retorne APENAS o JSON, sem explicações adicionais.`;

        if (WHL_DEBUG) console.log('[MemorySystem] Gerando memória com IA...');

        // Usa AIService se disponível
        let response = null;
        if (window.AIService) {
          response = await window.AIService.generateCompletion(prompt, {
            provider: options.provider || 'openai',
            model: options.model || 'gpt-4o',
            temperature: 0.3,
            maxTokens: 800
          });
        } else {
          console.warn('[MemorySystem] AIService não disponível');
          return null;
        }

        if (!response || !response.text) {
          throw new Error('Resposta vazia da IA');
        }

        // Parse JSON da resposta
        let memory = null;
        const jsonMatch = response.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          memory = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Não foi possível extrair JSON da resposta');
        }

        if (WHL_DEBUG) console.log('[MemorySystem] Memória gerada:', memory);

        // Salva se chatKey fornecido
        if (options.chatKey) {
          await this.setMemory(options.chatKey, memory);
        }

        return memory;

      } catch (error) {
        console.error('[MemorySystem] Erro ao gerar memória:', error);
        return null;
      }
    }

    /**
     * Atualiza memória incrementalmente
     * @param {string} chatKey - Chave do chat
     * @param {Object} updates - Atualizações parciais
     */
    async updateMemory(chatKey, updates) {
      const current = this.getMemory(chatKey) || {
        profile: '',
        preferences: [],
        context: [],
        open_loops: [],
        next_actions: [],
        tone: 'neutral'
      };

      const updated = {
        profile: updates.profile !== undefined ? updates.profile : current.profile,
        preferences: updates.preferences || current.preferences,
        context: updates.context || current.context,
        open_loops: updates.open_loops || current.open_loops,
        next_actions: updates.next_actions || current.next_actions,
        tone: updates.tone || current.tone
      };

      return this.setMemory(chatKey, updated);
    }

    /**
     * Adiciona item a uma lista na memória
     * @param {string} chatKey - Chave do chat
     * @param {string} field - Campo (preferences, context, open_loops, next_actions)
     * @param {string} item - Item a adicionar
     */
    async addToMemoryList(chatKey, field, item) {
      const memory = this.getMemory(chatKey);
      if (!memory) {
        console.warn('[MemorySystem] Memória não encontrada:', chatKey);
        return;
      }

      if (!Array.isArray(memory[field])) {
        console.warn('[MemorySystem] Campo não é array:', field);
        return;
      }

      if (!memory[field].includes(item)) {
        memory[field].push(item);
        await this.setMemory(chatKey, memory);
      }
    }

    /**
     * Remove item de uma lista na memória
     * @param {string} chatKey - Chave do chat
     * @param {string} field - Campo
     * @param {string} item - Item a remover
     */
    async removeFromMemoryList(chatKey, field, item) {
      const memory = this.getMemory(chatKey);
      if (!memory) return;

      if (Array.isArray(memory[field])) {
        memory[field] = memory[field].filter(i => i !== item);
        await this.setMemory(chatKey, memory);
      }
    }

    /**
     * Envia memória para backend via MEMORY_PUSH
     * @param {string} chatKey - Chave do chat
     * @param {Object} memory - Memória
     */
    async pushToBackend(chatKey, memory) {
      try {
        const event = {
          type: 'memory_update',
          chatKey,
          memory,
          timestamp: Date.now()
        };

        // Envia via runtime message
        await chrome.runtime.sendMessage({
          action: 'MEMORY_PUSH',
          event
        });

      } catch (error) {
        console.warn('[MemorySystem] Erro ao enviar para backend (fila ativada):', error);
        try {
          this._enqueueSyncEvent?.({
            type: 'memory_update',
            chatKey,
            memory,
            timestamp: Date.now()
          });
        } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      }
    }

    async _enqueueSyncEvent(event) {
      if (!event) return;
      const queue = (await _storage.get(MEMORY_SYNC_QUEUE_KEY)) || [];
      const trimmed = (Array.isArray(queue) ? queue : []).concat(event).slice(-500);
      await _storage.set(MEMORY_SYNC_QUEUE_KEY, trimmed);
    }

    async _flushSyncQueue() {
      const queue = (await _storage.get(MEMORY_SYNC_QUEUE_KEY)) || [];
      if (!Array.isArray(queue) || queue.length === 0) return;

      const remaining = [];
      for (const ev of queue) {
        try {
          await chrome.runtime.sendMessage({ action: 'MEMORY_PUSH', event: ev });
        } catch (e) {
          remaining.push(ev);
        }
      }
      await _storage.set(MEMORY_SYNC_QUEUE_KEY, remaining.slice(-500));
    }

    /**
     * Consulta memória do servidor
     * @param {string} chatKey - Chave do chat
     * @returns {Object|null} - Memória do servidor
     */
    async queryFromBackend(chatKey) {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'MEMORY_QUERY',
          chatKey
        });

        if (response && response.success && response.memory) {
          // Atualiza memória local
          await this.setMemory(chatKey, response.memory);
          return response.memory;
        }

        return null;
      } catch (error) {
        console.error('[MemorySystem] Erro ao consultar backend:', error);
        return null;
      }
    }

    /**
     * Formata memória para exibição
     * @param {Object} memory - Memória
     * @returns {string} - Texto formatado
     */
    formatMemory(memory) {
      if (!memory) return 'Nenhuma memória disponível';

      let text = '';

      if (memory.profile) {
        text += `👤 Perfil: ${memory.profile}\n\n`;
      }

      if (memory.preferences && memory.preferences.length > 0) {
        text += `⭐ Preferências:\n`;
        memory.preferences.forEach(pref => {
          text += `  • ${pref}\n`;
        });
        text += '\n';
      }

      if (memory.context && memory.context.length > 0) {
        text += `📝 Contexto:\n`;
        memory.context.forEach(ctx => {
          text += `  • ${ctx}\n`;
        });
        text += '\n';
      }

      if (memory.open_loops && memory.open_loops.length > 0) {
        text += `⏳ Pendências:\n`;
        memory.open_loops.forEach(loop => {
          text += `  • ${loop}\n`;
        });
        text += '\n';
      }

      if (memory.next_actions && memory.next_actions.length > 0) {
        text += `🎯 Próximas Ações:\n`;
        memory.next_actions.forEach(action => {
          text += `  • ${action}\n`;
        });
        text += '\n';
      }

      if (memory.tone) {
        text += `💬 Tom Recomendado: ${memory.tone}\n`;
      }

      return text.trim();
    }

    /**
     * Obtém todas as memórias
     * @returns {Array} - Lista de memórias
     */
    getAllMemories() {
      return Array.from(this.memories.entries()).map(([key, value]) => ({
        chatKey: key,
        ...value
      }));
    }

    /**
     * Limpa memórias antigas (mais de X dias)
     * @param {number} days - Número de dias
     */
    async cleanOldMemories(days = 30) {
      const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
      let removed = 0;

      for (const [key, memory] of this.memories.entries()) {
        if (memory.lastUpdated && memory.lastUpdated < cutoff) {
          this.memories.delete(key);
          removed++;
        }
      }

      if (removed > 0) {
        await this.save();
        if (WHL_DEBUG) console.log(`[MemorySystem] ${removed} memórias antigas removidas`);
      }
    }

    /**
     * Obtém estatísticas
     * @returns {Object} - Estatísticas
     */
    getStats() {
      return {
        totalMemories: this.memories.size,
        maxMemories: MAX_MEMORIES,
        maxSummaryLength: MAX_SUMMARY_LENGTH
      };
    }

    // ═══════════════════════════════════════════════════════════════════
    // ✨ NOVOS MÉTODOS v2.0 - Extração de Fatos
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Adiciona um fato à memória
     * @param {string} chatKey - Chave do chat
     * @param {string} factType - Tipo do fato (FACT_TYPES)
     * @param {string} value - Valor do fato
     * @param {number} confidence - Confiança (0-1)
     */
    async addFact(chatKey, factType, value, confidence = 0.8) {
      const memory = this.getMemory(chatKey);
      if (!memory) {
        console.warn('[MemorySystem] Memória não encontrada para adicionar fato');
        return null;
      }

      if (!memory.facts) memory.facts = [];

      // Verifica se já existe fato similar
      const existingIndex = memory.facts.findIndex(f => 
        f.type === factType && f.value.toLowerCase() === value.toLowerCase()
      );

      if (existingIndex !== -1) {
        // Atualiza confiança se maior
        if (confidence > memory.facts[existingIndex].confidence) {
          memory.facts[existingIndex].confidence = confidence;
          memory.facts[existingIndex].updatedAt = Date.now();
        }
      } else {
        // Adiciona novo fato
        memory.facts.push({
          id: `fact_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          type: factType,
          value,
          confidence,
          extractedAt: Date.now(),
          updatedAt: Date.now()
        });

        // Limita quantidade de fatos
        if (memory.facts.length > MAX_FACTS_PER_CHAT) {
          memory.facts.sort((a, b) => b.confidence - a.confidence);
          memory.facts = memory.facts.slice(0, MAX_FACTS_PER_CHAT);
        }
      }

      await this.setMemory(chatKey, memory);
      
      if (window.EventBus) {
        window.EventBus.emit('memory:fact_added', { chatKey, factType, value, confidence });
      }

      return memory.facts;
    }

    /**
     * Extrai fatos automaticamente de uma mensagem
     * @param {string} chatKey - Chave do chat
     * @param {string} messageContent - Conteúdo da mensagem
     */
    async extractFactsFromMessage(chatKey, messageContent) {
      if (!messageContent || messageContent.length < 10) return [];
      
      const extractedFacts = [];
      const content = messageContent.toLowerCase();

      // Extrai nomes
      const namePatterns = [
        /(?:meu nome é|me chamo|sou o|sou a)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)?)/gi,
        /^(?:olá|oi|bom dia|boa tarde|boa noite)[,!]?\s*(?:aqui é|sou)\s+([A-ZÀ-Ú][a-zà-ú]+)/gi
      ];

      namePatterns.forEach(pattern => {
        const match = messageContent.match(pattern);
        if (match && match[1]) {
          const name = match[1].trim();
          if (isValidName(name)) {
            extractedFacts.push({ type: FACT_TYPES.NAME, value: name, confidence: 0.85 });
          }
        }
      });

      // Extrai emails
      const emailPattern = /[\w.-]+@[\w.-]+\.\w+/gi;
      const emails = messageContent.match(emailPattern);
      if (emails) {
        emails.forEach(email => {
          if (isValidEmail(email)) {
            extractedFacts.push({ type: FACT_TYPES.EMAIL, value: email, confidence: 0.95 });
          }
        });
      }

      // Extrai telefones
      const phonePattern = /(?:\+55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-.\s]?\d{4}/g;
      const phones = messageContent.match(phonePattern);
      if (phones) {
        phones.forEach(phone => {
          const digits = phone.replace(/\D/g, '');
          if (isValidPhone(digits)) {
            extractedFacts.push({ type: FACT_TYPES.PHONE, value: digits, confidence: 0.9 });
          }
        });
      }

      // Extrai valores/orçamento
      const budgetPattern = /(?:orçamento|budget|valor|preço).*?(?:R\$|BRL)?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/gi;
      const budgets = [...messageContent.matchAll(budgetPattern)];
      budgets.forEach(match => {
        const val = match[1];
        if (isValidBudget(val)) {
          extractedFacts.push({ type: FACT_TYPES.BUDGET, value: val, confidence: 0.8 });
        }
      });

      // Extrai preferências
      if (content.includes('prefiro') || content.includes('gosto de') || content.includes('quero')) {
        const prefMatch = messageContent.match(/(?:prefiro|gosto de|quero)\s+(.{10,50})/i);
        if (prefMatch) {
          extractedFacts.push({ type: FACT_TYPES.PREFERENCE, value: prefMatch[1].trim(), confidence: 0.7 });
        }
      }

      // Extrai timeline/urgência
      if (content.includes('urgente') || content.includes('urgência') || content.includes('prazo')) {
        extractedFacts.push({ type: FACT_TYPES.TIMELINE, value: 'urgente', confidence: 0.8 });
      }

      // Adiciona fatos extraídos à memória
      for (const fact of extractedFacts) {
        await this.addFact(chatKey, fact.type, fact.value, fact.confidence);
      }

      return extractedFacts;
    }

    /**
     * Obtém fatos de um chat
     * @param {string} chatKey - Chave do chat
     * @param {string} factType - Tipo opcional para filtrar
     */
    getFacts(chatKey, factType = null) {
      const memory = this.getMemory(chatKey);
      if (!memory || !memory.facts) return [];

      if (factType) {
        return memory.facts.filter(f => f.type === factType);
      }
      return memory.facts;
    }

    // ═══════════════════════════════════════════════════════════════════
    // ✨ NOVOS MÉTODOS v2.0 - Interações e Métricas
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Registra uma interação no histórico
     * @param {string} chatKey - Chave do chat
     * @param {Object} interaction - Dados da interação
     */
    async addInteraction(chatKey, interaction) {
      const memory = this.getMemory(chatKey);
      if (!memory) return null;

      if (!memory.interactions) memory.interactions = [];
      if (!memory.metrics) memory.metrics = { totalMessages: 0, avgResponseTime: 0, engagementScore: 0 };

      const interactionRecord = {
        id: `int_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        type: interaction.type || 'message',
        direction: interaction.direction, // 'in' ou 'out'
        preview: interaction.preview?.substring(0, 200),
        metadata: interaction.metadata || {},
        at: interaction.at || Date.now()
      };

      memory.interactions.push(interactionRecord);

      // Limita histórico
      if (memory.interactions.length > MAX_INTERACTIONS) {
        memory.interactions = memory.interactions.slice(-MAX_INTERACTIONS);
      }

      // Atualiza métricas
      memory.metrics.totalMessages++;
      memory.metrics.lastInteraction = interactionRecord.at;

      // Calcula tempo médio de resposta
      if (interaction.direction === 'out' && memory.interactions.length > 1) {
        const lastIn = [...memory.interactions].reverse().find(i => i.direction === 'in');
        if (lastIn) {
          const responseTime = interactionRecord.at - lastIn.at;
          const count = memory.metrics.totalMessages / 2;
          memory.metrics.avgResponseTime = 
            (memory.metrics.avgResponseTime * (count - 1) + responseTime) / count;
        }
      }

      // Calcula engagement score
      memory.metrics.engagementScore = this.calculateEngagement(memory);

      await this.setMemory(chatKey, memory);

      // Extrai fatos automaticamente
      if (interaction.type === 'message' && interaction.content) {
        await this.extractFactsFromMessage(chatKey, interaction.content);
      }

      return interactionRecord;
    }

    /**
     * Calcula score de engagement
     * @param {Object} memory - Memória do chat
     */
    calculateEngagement(memory) {
      if (!memory.metrics) return 0;

      const factors = {
        messageCount: Math.min((memory.metrics.totalMessages || 0) / 100, 1) * 0.3,
        responseTime: Math.max(0, 1 - ((memory.metrics.avgResponseTime || 0) / 3600000)) * 0.2,
        recency: Math.max(0, 1 - ((Date.now() - (memory.metrics.lastInteraction || Date.now())) / (7 * 86400000))) * 0.3,
        factsCount: Math.min((memory.facts?.length || 0) / 10, 1) * 0.2
      };

      return Object.values(factors).reduce((sum, v) => sum + v, 0);
    }

    /**
     * Atualiza contexto de negócios
     * @param {string} chatKey - Chave do chat
     * @param {Object} updates - Atualizações de contexto
     */
    async updateBusinessContext(chatKey, updates) {
      const memory = this.getMemory(chatKey);
      if (!memory) return null;

      memory.businessContext = {
        ...memory.businessContext,
        ...updates
      };

      await this.setMemory(chatKey, memory);
      return memory.businessContext;
    }

    /**
     * Obtém contexto formatado para IA
     * @param {string} chatKey - Chave do chat
     */
    getContextForAI(chatKey) {
      const memory = this.getMemory(chatKey);
      if (!memory) return null;

      return {
        summary: memory.profile,
        clientInfo: (memory.facts || [])
          .filter(f => [FACT_TYPES.NAME, FACT_TYPES.EMAIL, FACT_TYPES.COMPANY].includes(f.type))
          .map(f => `${f.type}: ${f.value}`)
          .join('\n'),
        preferences: (memory.facts || [])
          .filter(f => [FACT_TYPES.PREFERENCE, FACT_TYPES.INTEREST].includes(f.type))
          .map(f => f.value)
          .join(', '),
        businessContext: memory.businessContext,
        recentMessages: (memory.interactions || [])
          .filter(i => i.type === 'message')
          .slice(-10)
          .map(i => ({
            role: i.direction === 'in' ? 'user' : 'assistant',
            content: i.preview
          })),
        metrics: {
          engagement: memory.metrics?.engagementScore || 0,
          totalInteractions: memory.metrics?.totalMessages || 0,
          avgResponseTime: memory.metrics?.avgResponseTime || 0
        }
      };
    }

    /**
     * Obtém contexto híbrido (local + servidor)
     * Baseado em CERTO-WHATSAPPLITE-main-21/05chromeextensionwhatsapp/content/content.js getHybridContext()
     * 
     * @param {string} chatTitle - Título do chat
     * @param {string} transcript - Transcrição
     * @returns {Object} - { memory, examples, context, source }
     */
    async getHybridContext(chatTitle, transcript = '') {
      const localMemory = await this.getMemory(chatTitle);
      
      let localExamples = [];
      if (window.fewShotLearning) {
        localExamples = window.fewShotLearning.getAll();
      }
      
      // Tenta buscar do servidor se configurado
      try {
        const settings = await this.getSettings();
        
        if (settings?.memorySyncEnabled && settings?.memoryServerUrl) {
          const response = await chrome.runtime.sendMessage({
            action: 'MEMORY_QUERY',
            payload: { 
              chatTitle, 
              transcript, 
              topK: 4 
            }
          });
          
          if (response?.ok && response?.data) {
            return {
              memory: response.data.memory || localMemory,
              examples: Array.isArray(response.data.examples) ? response.data.examples : localExamples,
              context: response.data.context || null,
              source: 'server'
            };
          }
        }
      } catch (error) {
        console.warn('[MemorySystem] Fallback para memória local:', error.message);
      }
      
      return {
        memory: localMemory,
        examples: localExamples,
        context: null,
        source: 'local'
      };
    }

    async getSettings() {
      try {
        const data = await _storage.get('whl_settings');
        return data || {};
      } catch (e) {
        console.warn('[MemorySystem] Erro ao carregar settings:', e.message);
        return {};
      }
    }

    /**
     * Limpa todas as memórias
     */
    async clearAll() {
      this.memories.clear();
      await this.save();
      if (WHL_DEBUG) console.log('[MemorySystem] Todas as memórias limpas');
    }
  }

  // Debounce timer para auto-update
  // v9.5.4: Per-chat debounce — was a single global timer, so switching chats faster than the
  // debounce window dropped pending memory updates. Now keyed by chatKey so each chat owns its own.
  const autoUpdateTimers = new Map();

  /**
   * Atualiza memória automaticamente com debounce
   * @param {string} transcript - Transcrição da conversa
   * @param {string} chatTitle - Título do chat
   * @param {number} debounceMs - Tempo de debounce em ms (padrão: 5000)
   * @returns {Promise<boolean>} - true se atualizado
   */
  function safeText(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/\u0000/g, '').trim();
  }

  function getActiveChatIdOrTitle() {
    // 1) Prefer WhatsApp internal Store active chat id (stable)
    try {
      const activeChat = window.Store?.Chat?.getActive?.();
      const serializedId = activeChat?.id?._serialized || activeChat?.id?.toString?.();
      if (serializedId) return serializedId;
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

    // 2) Fallback: derive chat id from message rows data-id (stable across header/status changes)
    try {
      const row = document.querySelector('#main [data-id^="true_"], #main [data-id^="false_"]');
      const dataId = row?.getAttribute?.('data-id') || '';
      const m = dataId.match(/^(?:true|false)_([^_]+)_/);
      if (m && m[1]) return m[1];
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

    // 3) Last-resort: header title/text, but ignore transient status strings (online, visto por último, etc.)
    try {
      const headerSpan = document.querySelector('#main header span[title]');
      const headerDiv = document.querySelector('#main [data-testid="conversation-info-header"] span');
      const mainHeader = document.querySelector('#main header');

      const candidate =
        (headerSpan && (headerSpan.getAttribute('title') || headerSpan.textContent)) ||
        (headerDiv && headerDiv.textContent) ||
        (mainHeader && mainHeader.querySelector('span[dir="auto"]')?.textContent) ||
        '';

      const t = String(candidate || '').trim();
      if (!t) return '';

      // Ignore common transient strings
      const lower = t.toLowerCase();
      const transient =
        lower === 'online' ||
        lower.includes('visto por último') ||
        lower.includes('visto por ultimo') ||
        lower.includes('digitando') ||
        lower.includes('clique para mostrar') ||
        lower.includes('toque para ver') ||
        lower.includes('dados do contato');

      // If it's transient, don't use it as a chat key
      if (transient) return '';

      return t;
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

    return '';
  }

  function extractTranscriptFromDOM(max = 35) {
    try {
      const main = document.querySelector('#main');
      if (!main) return '';

      const nodes = Array.from(main.querySelectorAll('[data-testid="msg-container"], [data-testid="message"]'));
      const rows = [];

      for (const node of nodes.slice(-max)) {
        const textEl = node.querySelector('.selectable-text') || node.querySelector('[data-testid="msg-text"]') || node;
        const text = safeText(textEl?.innerText || textEl?.textContent);
        if (!text) continue;

        // tentativa simples de identificar se a mensagem é enviada (atendente) ou recebida (cliente)
        const isFromMe = !!node.querySelector('[data-testid="msg-dblcheck"], [data-testid="msg-check"], [data-testid="status-dblcheck"]');
        rows.push(`${isFromMe ? 'Atendente' : 'Cliente'}: ${text}`);
      }

      return rows.join('\n');
    } catch (_) {
      return '';
    }
  }

  async function autoUpdateMemory(transcript, chatIdOrTitle, debounceMs = 5000) {
    // Permite chamada sem parâmetros (ex.: UI panel)
    const finalTranscript = safeText(transcript) || extractTranscriptFromDOM();
    let chatKey = safeText(chatIdOrTitle) || getActiveChatIdOrTitle();

    // Normalize: avoid using transient header/status strings as chat key
    const t = String(chatKey || '').trim();
    const needsRecompute =
      !t ||
      (!t.includes('@') && (t.includes(' ') || t.length < 6)) ||
      /online|visto por|digitando|clique para mostrar|dados do contato/i.test(t);

    if (needsRecompute) {
      chatKey = getActiveChatIdOrTitle() || chatKey;
    }

    // Valida entrada
    if (!finalTranscript || finalTranscript.length < 60) {
      if (WHL_DEBUG) console.log('[MemorySystem] Transcript muito curto para auto-update (<60 chars)');
      return false;
    }

    if (!chatKey) {
      console.warn('[MemorySystem] chatId/chatTitle inválido para auto-update');
      return false;
    }

    // Cancela timer anterior
    // v9.5.4: cancel only the timer for this chatKey, not all timers globally.
    if (autoUpdateTimers.has(chatKey)) {
      clearTimeout(autoUpdateTimers.get(chatKey));
    }

    // Retorna promise que resolve após debounce
    return new Promise((resolve) => {
      const timerId = setTimeout(async () => {
        autoUpdateTimers.delete(chatKey);
        try {
          if (WHL_DEBUG) console.log('[MemorySystem] Auto-update iniciado após debounce de', debounceMs, 'ms');
          
          // Gera summary estruturado
          const summary = {
            profile: extractProfile(finalTranscript),
            tone: detectTone(finalTranscript),
            preferences: extractPreferences(finalTranscript),
            context: extractContext(finalTranscript),
            open_loops: extractOpenLoops(finalTranscript),
            next_actions: suggestNextActions(finalTranscript)
          };

          // Salva memória
          if (window.memorySystem) {
            const finalChatKey = window.memorySystem.getChatKey(chatKey);
            await window.memorySystem.setMemory(finalChatKey, summary);
            if (WHL_DEBUG) console.log('[MemorySystem] Memória auto-atualizada para:', finalChatKey);
            resolve(true);
          } else {
            console.warn('[MemorySystem] memorySystem não disponível');
            resolve(false);
          }
        } catch (error) {
          console.error('[MemorySystem] Erro no auto-update:', error);
          resolve(false);
        }
      }, debounceMs);
      autoUpdateTimers.set(chatKey, timerId);
    });
  }

  /**
   * Extrai perfil do cliente do transcript
   */
  function extractProfile(transcript) {
    const lowerText = transcript.toLowerCase();
    let profile = [];
    
    // Detecta tipo de cliente
    if (lowerText.includes('empresa') || lowerText.includes('cnpj')) {
      profile.push('Cliente corporativo');
    } else if (lowerText.includes('pessoal') || lowerText.includes('cpf')) {
      profile.push('Cliente individual');
    }
    
    // Detecta frequência
    if (lowerText.includes('primeira vez') || lowerText.includes('novo')) {
      profile.push('Primeiro contato');
    } else if (lowerText.includes('sempre') || lowerText.includes('costum')) {
      profile.push('Cliente recorrente');
    }

    return profile.length > 0 ? profile.join(', ') : 'Cliente padrão';
  }

  /**
   * Detecta tom da conversa
   */
  function detectTone(transcript) {
    const lowerText = transcript.toLowerCase();
    
    const formalWords = ['senhor', 'senhora', 'prezado', 'cordialmente', 'atenciosamente'];
    const casualWords = ['oi', 'tudo bem', 'valeu', 'vlw', 'blz', 'tmj'];
    
    let formalCount = 0;
    let casualCount = 0;
    
    formalWords.forEach(word => {
      if (lowerText.includes(word)) formalCount++;
    });
    
    casualWords.forEach(word => {
      if (lowerText.includes(word)) casualCount++;
    });
    
    if (formalCount > casualCount) return 'formal';
    if (casualCount > formalCount) return 'casual';
    return 'neutral';
  }

  /**
   * Extrai preferências do cliente
   */
  function extractPreferences(transcript) {
    const preferences = [];
    const lowerText = transcript.toLowerCase();
    
    if (lowerText.includes('email') || lowerText.includes('e-mail')) {
      preferences.push('Prefere contato por email');
    }
    if (lowerText.includes('whatsapp') || lowerText.includes('mensagem')) {
      preferences.push('Prefere contato por WhatsApp');
    }
    if (lowerText.includes('ligar') || lowerText.includes('telefone')) {
      preferences.push('Prefere contato por telefone');
    }
    if (lowerText.includes('rápid') || lowerText.includes('urgente')) {
      preferences.push('Valoriza velocidade no atendimento');
    }
    
    return preferences;
  }

  /**
   * Extrai contexto relevante
   */
  function extractContext(transcript) {
    const context = [];
    const sentences = transcript.split(/[.!?]/).filter(s => s.trim().length > 20);
    
    // Pega até 3 sentenças mais relevantes
    return sentences.slice(0, 3).map(s => s.trim());
  }

  /**
   * Extrai pendências (open loops)
   */
  function extractOpenLoops(transcript) {
    const loops = [];
    const lowerText = transcript.toLowerCase();
    
    if (lowerText.includes('aguardan') || lowerText.includes('esperan')) {
      loops.push('Aguardando resposta/ação');
    }
    if (lowerText.includes('enviar') || lowerText.includes('mandar')) {
      loops.push('Envio de material/informação pendente');
    }
    if (lowerText.includes('confirma') || lowerText.includes('verifica')) {
      loops.push('Confirmação pendente');
    }
    if (lowerText.includes('orçamento') || lowerText.includes('proposta')) {
      loops.push('Orçamento/proposta em análise');
    }
    
    return loops;
  }

  /**
   * Sugere próximas ações
   */
  function suggestNextActions(transcript) {
    const actions = [];
    const lowerText = transcript.toLowerCase();
    
    if (lowerText.includes('dúvida') || lowerText.includes('?')) {
      actions.push('Responder dúvidas pendentes');
    }
    if (lowerText.includes('preço') || lowerText.includes('quanto')) {
      actions.push('Enviar informações de preço');
    }
    if (lowerText.includes('reunião') || lowerText.includes('conversar')) {
      actions.push('Agendar reunião/call');
    }
    if (lowerText.includes('comprar') || lowerText.includes('adquirir')) {
      actions.push('Enviar link de pagamento/contrato');
    }
    
    return actions;
  }

  // Exporta globalmente
  window.MemorySystem = MemorySystem;
  window.MemorySystem.FACT_TYPES = FACT_TYPES;
  window.autoUpdateMemory = autoUpdateMemory;

  // Compatibilidade: alguns módulos chamam como MemorySystem.autoUpdateMemory()
  try {
    window.MemorySystem.autoUpdateMemory = autoUpdateMemory;
    window.MemorySystem.FACT_TYPES = FACT_TYPES;
  } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

  // Cria instância global
  if (!window.memorySystem) {
    window.memorySystem = new MemorySystem();
    window.memorySystem.init().then(() => {
      if (WHL_DEBUG) console.log('[MemorySystem] ✅ Módulo carregado e inicializado');
    });
  }

})();
