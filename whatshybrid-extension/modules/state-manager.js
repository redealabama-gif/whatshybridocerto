/**
 * 🗄️ StateManager v1.0 - Gerenciador de Estado Global
 * Estado reativo com persistência automática
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const CONFIG = {
    STORAGE_KEY: 'whl_state',
    PERSIST_DEBOUNCE: 1000,
    MAX_HISTORY: 50
  };

  const INITIAL_STATE = {
    user: { id: null, name: null, email: null, phone: null, avatar: null, plan: 'free', credits: 0 },
    connection: { status: 'disconnected', phone: null, lastSync: null, version: null },
    navigation: { currentView: 'dashboard', previousView: null, history: [], breadcrumb: [] },
    modules: { loaded: {}, cache: {}, errors: {} },
    data: { contacts: [], chats: [], groups: [], labels: [], campaigns: [], flows: [], tasks: [], deals: [], messages: [] },
    ui: { sidebarCollapsed: false, theme: 'dark', contextPanelOpen: false, searchOpen: false, searchQuery: '', activeModal: null, loading: false, notifications: [] },
    metrics: { messagesSentToday: 0, messagesReceivedToday: 0, activeChats: 0, sessionStart: null, lastActivity: null },
    settings: { language: 'pt-BR', autoSync: true, syncInterval: 300000, notificationsEnabled: true, soundsEnabled: true, antiBanEnabled: true, antiBanDelay: { min: 3, max: 8 } },
    subscription: { plan: 'free', status: 'active', expiresAt: null, features: {}, limits: {} }
  };

  class StateManager {
    constructor() {
      this.state = this._deepClone(INITIAL_STATE);
      this.subscribers = new Map();
      this.middlewares = [];
      this.history = [];
      this.historyIndex = -1;
      this._persistTimer = null;
      this._initialized = false;
    }

    async init() {
      if (this._initialized) return this;
      try {
        await this._loadPersistedState();
        this._connectEventBus();
        this._initialized = true;
        console.log('[StateManager] ✅ Inicializado');
        if (window.EventBus) {
          window.EventBus.emit(window.WHL_EVENTS?.SYSTEM_READY || 'system:ready', { state: this.getState() });
        }
        return this;
      } catch (error) {
        console.error('[StateManager] ❌ Erro:', error);
        throw error;
      }
    }

    /**
     * Obtém valor do estado por path (ex: 'user.plan', 'data.contacts')
     */
    get(path, defaultValue = undefined) {
      if (!path) return this.state;
      const keys = path.split('.');
      let value = this.state;
      for (const key of keys) {
        if (value === undefined || value === null) return defaultValue;
        value = value[key];
      }
      return value !== undefined ? value : defaultValue;
    }

    /**
     * Retorna cópia do estado completo
     */
    getState() { return this._deepClone(this.state); }

    /**
     * Define valor no estado
     */
    set(path, value, options = {}) {
      const { persist = true, silent = false, source = 'unknown' } = options;
      const oldValue = this.get(path);
      const finalValue = this._runMiddlewares(path, value, oldValue);
      if (finalValue === undefined && value !== undefined) return this;
      
      this._setNestedValue(path, finalValue);
      this._addToHistory({ path, oldValue, newValue: finalValue, source, timestamp: Date.now() });
      if (!silent) this._notifySubscribers(path, finalValue, oldValue);
      if (persist) this._schedulePersist();
      return this;
    }

    /**
     * Define múltiplos valores de uma vez
     */
    setMultiple(updates, options = {}) {
      for (const [path, value] of Object.entries(updates)) {
        this.set(path, value, { ...options, persist: false });
      }
      if (options.persist !== false) this._schedulePersist();
      return this;
    }

    /**
     * Atualiza parcialmente um objeto
     */
    update(path, partialValue, options = {}) {
      const currentValue = this.get(path, {});
      return this.set(path, { ...currentValue, ...partialValue }, options);
    }

    /**
     * Adiciona item a um array
     */
    push(path, item, options = {}) {
      const array = this.get(path, []);
      return this.set(path, [...array, item], options);
    }

    /**
     * Remove item de um array
     */
    remove(path, predicate, options = {}) {
      const array = this.get(path, []);
      const filtered = array.filter((item, index) => typeof predicate === 'function' ? !predicate(item, index) : item !== predicate);
      return this.set(path, filtered, options);
    }

    /**
     * Incrementa valor numérico
     */
    increment(path, amount = 1, options = {}) {
      return this.set(path, this.get(path, 0) + amount, options);
    }

    /**
     * Toggle valor booleano
     */
    toggle(path, options = {}) {
      return this.set(path, !this.get(path, false), options);
    }

    /**
     * Reset estado para inicial
     */
    reset(path = null) {
      if (path) {
        this.set(path, this._getInitialValue(path));
      } else {
        this.state = this._deepClone(INITIAL_STATE);
        this._notifySubscribers('', this.state, {});
        this._schedulePersist();
      }
      return this;
    }

    /**
     * Inscreve-se para mudanças em um path
     */
    subscribe(path, callback) {
      if (typeof callback !== 'function') return () => {};
      if (!this.subscribers.has(path)) this.subscribers.set(path, new Set());
      this.subscribers.get(path).add(callback);
      return () => {
        const subs = this.subscribers.get(path);
        if (subs) {
          subs.delete(callback);
          if (subs.size === 0) this.subscribers.delete(path);
        }
      };
    }

    /**
     * Observa mudanças (alias para subscribe)
     */
    watch(path, callback) { return this.subscribe(path, callback); }

    /**
     * Inscreve-se em múltiplos paths
     */
    subscribeMultiple(paths, callback) {
      const unsubscribes = paths.map(path => this.subscribe(path, callback));
      return () => unsubscribes.forEach(unsub => unsub());
    }

    _notifySubscribers(changedPath, newValue, oldValue) {
      // Notificar path específico
      const subscribers = this.subscribers.get(changedPath);
      if (subscribers) {
        subscribers.forEach(cb => { try { cb(newValue, oldValue, changedPath); } catch (e) { console.error('[StateManager] Subscriber error:', e); } });
      }
      
      // Notificar paths pais
      const parts = changedPath.split('.');
      for (let i = parts.length - 1; i >= 0; i--) {
        const parentPath = parts.slice(0, i).join('.');
        const parentSubs = this.subscribers.get(parentPath);
        if (parentSubs) {
          const parentValue = this.get(parentPath);
          parentSubs.forEach(cb => { try { cb(parentValue, null, changedPath); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} } });
        }
      }
      
      // Notificar wildcard
      const wildcardSubs = this.subscribers.get('*');
      if (wildcardSubs) {
        wildcardSubs.forEach(cb => { try { cb(newValue, oldValue, changedPath); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} } });
      }
      
      // Emitir evento via EventBus
      if (window.EventBus) {
        window.EventBus.emit(window.WHL_EVENTS?.STATE_CHANGED || 'state:changed', { path: changedPath, newValue, oldValue });
      }
    }

    /**
     * Adiciona middleware
     */
    use(middleware) {
      if (typeof middleware === 'function') this.middlewares.push(middleware);
      return this;
    }

    _runMiddlewares(path, value, oldValue) {
      let result = value;
      for (const middleware of this.middlewares) {
        try {
          const transformed = middleware(path, result, oldValue);
          if (transformed !== undefined) result = transformed;
        } catch (e) { console.error('[StateManager] Middleware error:', e); }
      }
      return result;
    }

    _getDefaultState() {
      return this._deepClone(INITIAL_STATE);
    }

    _validateState(state) {
      if (!state || typeof state !== 'object') {
        return this._getDefaultState();
      }
      // Merge com defaults para garantir campos obrigatórios
      return this._mergeDeep(this._getDefaultState(), state);
    }

    async _loadPersistedState() {
      try {
        const stored = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
        if (stored[CONFIG.STORAGE_KEY]) {
          const persistedState = JSON.parse(stored[CONFIG.STORAGE_KEY]);
          this.state = this._validateState(persistedState);
          console.log('[StateManager] Estado carregado do storage');
        }
      } catch (e) { console.warn('[StateManager] Falha ao carregar:', e); }
    }

    _schedulePersist() {
      if (this._persistTimer) clearTimeout(this._persistTimer);
      this._persistTimer = setTimeout(() => this._persist(), CONFIG.PERSIST_DEBOUNCE);
    }

    async _persist() {
      try {
        const stateToPersist = this._deepClone(this.state);
        delete stateToPersist.ui.loading;
        delete stateToPersist.ui.activeModal;
        delete stateToPersist.modules.errors;
        if (stateToPersist.data.messages?.length > 100) {
          stateToPersist.data.messages = stateToPersist.data.messages.slice(-100);
        }
        await chrome.storage.local.set({ [CONFIG.STORAGE_KEY]: JSON.stringify(stateToPersist) });
      } catch (e) { console.error('[StateManager] Persist error:', e); }
    }

    _addToHistory(entry) {
      if (this.historyIndex < this.history.length - 1) {
        this.history = this.history.slice(0, this.historyIndex + 1);
      }
      this.history.push(entry);
      this.historyIndex = this.history.length - 1;
      if (this.history.length > CONFIG.MAX_HISTORY) {
        this.history.shift();
        this.historyIndex--;
      }
    }

    /**
     * Desfaz última mudança
     */
    undo() {
      if (this.historyIndex < 0) return false;
      const entry = this.history[this.historyIndex];
      this._setNestedValue(entry.path, entry.oldValue);
      this._notifySubscribers(entry.path, entry.oldValue, entry.newValue);
      this.historyIndex--;
      return true;
    }

    /**
     * Refaz última mudança desfeita
     */
    redo() {
      if (this.historyIndex >= this.history.length - 1) return false;
      this.historyIndex++;
      const entry = this.history[this.historyIndex];
      this._setNestedValue(entry.path, entry.newValue);
      this._notifySubscribers(entry.path, entry.newValue, entry.oldValue);
      return true;
    }

    getHistory(limit = 20) { return this.history.slice(-limit); }

    /**
     * Cria valor computado
     */
    computed(name, dependencies, compute) {
      const update = () => {
        const values = dependencies.map(dep => this.get(dep));
        const result = compute(...values);
        this.set(`computed.${name}`, result, { persist: false, silent: true });
      };
      update();
      dependencies.forEach(dep => this.subscribe(dep, update));
      return () => this.get(`computed.${name}`);
    }

    _connectEventBus() {
      if (!window.EventBus) return;
      const bus = window.EventBus;
      
      bus.on(bus.EVENTS?.MESSAGE_SENT || 'message:sent', () => {
        this.increment('metrics.messagesSentToday');
        this.set('metrics.lastActivity', Date.now());
      });
      
      bus.on(bus.EVENTS?.MESSAGE_RECEIVED || 'message:received', () => {
        this.increment('metrics.messagesReceivedToday');
        this.set('metrics.lastActivity', Date.now());
      });
      
      bus.on(bus.EVENTS?.SUBSCRIPTION_UPDATED || 'subscription:updated', (data) => {
        this.update('subscription', data);
        if (data.plan) this.set('user.plan', data.plan);
      });
      
      bus.on(bus.EVENTS?.CREDITS_UPDATED || 'credits:updated', (data) => {
        this.set('user.credits', data.credits);
      });
    }

    _setNestedValue(path, value) {
      const keys = path.split('.');
      let obj = this.state;
      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!(key in obj) || typeof obj[key] !== 'object') obj[key] = {};
        obj = obj[key];
      }
      obj[keys[keys.length - 1]] = value;
    }

    _getInitialValue(path) {
      const keys = path.split('.');
      let value = INITIAL_STATE;
      for (const key of keys) {
        if (value === undefined) return undefined;
        value = value[key];
      }
      return this._deepClone(value);
    }

    _deepClone(obj) {
      if (obj === null || typeof obj !== 'object') return obj;
      if (obj instanceof Date) return new Date(obj);
      if (obj instanceof Array) return obj.map(item => this._deepClone(item));
      const cloned = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          cloned[key] = this._deepClone(obj[key]);
        }
      }
      return cloned;
    }

    _mergeDeep(target, source) {
      const result = { ...target };
      for (const key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          if (source[key] instanceof Object && key in target && target[key] instanceof Object) {
            result[key] = this._mergeDeep(target[key], source[key]);
          } else {
            result[key] = source[key];
          }
        }
      }
      return result;
    }

    debug() {
      return {
        state: this.getState(),
        subscriberCount: this.subscribers.size,
        subscribers: Array.from(this.subscribers.keys()),
        historyLength: this.history.length,
        historyIndex: this.historyIndex,
        middlewareCount: this.middlewares.length,
        initialized: this._initialized
      };
    }

    export() { return JSON.stringify(this.state, null, 2); }

    import(json) {
      try {
        const imported = JSON.parse(json);
        this.state = this._mergeDeep(this._deepClone(INITIAL_STATE), imported);
        this._notifySubscribers('', this.state, {});
        this._schedulePersist();
        return true;
      } catch (e) {
        console.error('[StateManager] Import error:', e);
        return false;
      }
    }
  }

  const stateManager = new StateManager();
  window.StateManager = stateManager;
  window.AppState = stateManager;

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => stateManager.init());
  } else {
    stateManager.init();
  }

  console.log('[StateManager] ✅ Gerenciador de estado v1.0 carregado');
})();
