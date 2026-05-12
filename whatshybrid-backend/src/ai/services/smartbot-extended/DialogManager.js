/**
 * DialogManager
 * @file Extraído de SmartBotExtendedService.js (refactor v9)
 */

const EventEmitter = require('events');

class DialogManager extends EventEmitter {
  constructor(storage = null) {
    super();
    this.storage = storage;
    this.dialogs = new Map();
    this.activeDialogs = new Map();
    this.transitions = new Map();
    this.hooks = {
      onEnter: new Map(),
      onExit: new Map(),
      onTransition: []
    };
  }

  registerDialog(dialogId, config) {
    const dialog = {
      id: dialogId,
      name: config.name || dialogId,
      initialState: config.initialState || 'start',
      states: config.states || {},
      transitions: config.transitions || [],
      timeout: config.timeout || 300000,
      metadata: config.metadata || {},
      createdAt: new Date().toISOString()
    };

    this.dialogs.set(dialogId, dialog);
    
    dialog.transitions.forEach(t => {
      const key = `${dialogId}:${t.from}:${t.trigger}`;
      this.transitions.set(key, t);
    });

    return dialog;
  }

  startDialog(chatId, dialogId, initialData = {}) {
    const dialog = this.dialogs.get(dialogId);
    if (!dialog) throw new Error(`Dialog not found: ${dialogId}`);

    const session = {
      chatId,
      dialogId,
      currentState: dialog.initialState,
      data: initialData,
      history: [{ state: dialog.initialState, timestamp: Date.now(), action: 'start' }],
      startedAt: Date.now(),
      lastActivity: Date.now()
    };

    this.activeDialogs.set(chatId, session);
    this._executeHook('onEnter', dialogId, dialog.initialState, session);
    this.emit('dialogStarted', { chatId, dialogId, session });
    
    return session;
  }

  processInput(chatId, input, context = {}) {
    const session = this.activeDialogs.get(chatId);
    if (!session) return { handled: false, reason: 'no_active_dialog' };

    const dialog = this.dialogs.get(session.dialogId);
    if (!dialog) return { handled: false, reason: 'dialog_not_found' };

    if (Date.now() - session.lastActivity > dialog.timeout) {
      this.endDialog(chatId, 'timeout');
      return { handled: false, reason: 'timeout' };
    }

    const currentState = dialog.states[session.currentState];
    let matchedTransition = null;

    for (const transition of dialog.transitions) {
      if (transition.from !== session.currentState && transition.from !== '*') continue;
      if (this._matchesTrigger(transition.trigger, input, context)) {
        if (!transition.condition || this._evaluateCondition(transition.condition, session, context)) {
          matchedTransition = transition;
          break;
        }
      }
    }

    if (!matchedTransition) {
      if (currentState?.fallback) {
        return { handled: true, response: currentState.fallback, state: session.currentState, transitioned: false };
      }
      return { handled: false, reason: 'no_matching_transition' };
    }

    const previousState = session.currentState;
    this._executeHook('onExit', session.dialogId, previousState, session);

    session.currentState = matchedTransition.to;
    session.lastActivity = Date.now();
    session.history.push({
      state: matchedTransition.to,
      from: previousState,
      trigger: matchedTransition.trigger,
      timestamp: Date.now()
    });

    if (matchedTransition.action) {
      this._executeAction(matchedTransition.action, session, context);
    }

    this._executeHook('onEnter', session.dialogId, matchedTransition.to, session);
    this.hooks.onTransition.forEach(hook => {
      try { hook(session, previousState, matchedTransition.to); } catch (e) {}
    });

    const newState = dialog.states[matchedTransition.to];
    if (newState?.final) {
      this.endDialog(chatId, 'completed');
    }

    this.emit('stateChanged', { chatId, from: previousState, to: matchedTransition.to });

    return {
      handled: true,
      response: newState?.response || matchedTransition.response,
      state: matchedTransition.to,
      transitioned: true,
      previousState,
      data: session.data
    };
  }

  _matchesTrigger(trigger, input, context) {
    if (typeof trigger === 'string') return input.toLowerCase().includes(trigger.toLowerCase());
    if (trigger instanceof RegExp) return trigger.test(input);
    if (typeof trigger === 'object') {
      if (trigger.type === 'intent' && context.intent) return context.intent === trigger.value;
      if (trigger.type === 'entity' && context.entities) return context.entities.some(e => e.type === trigger.value);
      if (trigger.type === 'keyword') {
        const keywords = Array.isArray(trigger.value) ? trigger.value : [trigger.value];
        return keywords.some(k => input.toLowerCase().includes(k.toLowerCase()));
      }
      if (trigger.type === 'any') return true;
    }
    if (typeof trigger === 'function') return trigger(input, context);
    return false;
  }

  _evaluateCondition(condition, session, context) {
    if (typeof condition === 'function') return condition(session, context);
    if (typeof condition === 'object') {
      const { field, operator, value } = condition;
      const fieldValue = field.split('.').reduce((o, k) => o?.[k], session.data);
      return this._compare(fieldValue, value, operator);
    }
    return true;
  }

  _compare(a, b, operator = 'eq') {
    switch (operator) {
      case 'eq': return a === b;
      case 'neq': return a !== b;
      case 'gt': return a > b;
      case 'gte': return a >= b;
      case 'lt': return a < b;
      case 'lte': return a <= b;
      case 'contains': return String(a).includes(b);
      case 'exists': return a !== undefined && a !== null;
      default: return a === b;
    }
  }

  _executeAction(action, session, context) {
    if (typeof action === 'function') {
      action(session, context);
    } else if (typeof action === 'object') {
      if (action.set) {
        Object.entries(action.set).forEach(([key, value]) => {
          session.data[key] = typeof value === 'function' ? value(session, context) : value;
        });
      }
      if (action.increment) {
        Object.entries(action.increment).forEach(([key, value]) => {
          session.data[key] = (session.data[key] || 0) + value;
        });
      }
    }
  }

  _executeHook(hookType, dialogId, state, session) {
    const key = `${dialogId}:${state}`;
    const hooks = this.hooks[hookType].get(key) || [];
    hooks.forEach(hook => { try { hook(session); } catch (e) {} });
  }

  onEnterState(dialogId, state, callback) {
    const key = `${dialogId}:${state}`;
    if (!this.hooks.onEnter.has(key)) this.hooks.onEnter.set(key, []);
    this.hooks.onEnter.get(key).push(callback);
  }

  onExitState(dialogId, state, callback) {
    const key = `${dialogId}:${state}`;
    if (!this.hooks.onExit.has(key)) this.hooks.onExit.set(key, []);
    this.hooks.onExit.get(key).push(callback);
  }

  onTransition(callback) {
    this.hooks.onTransition.push(callback);
  }

  endDialog(chatId, reason = 'manual') {
    const session = this.activeDialogs.get(chatId);
    if (session) {
      session.endedAt = Date.now();
      session.endReason = reason;
      this.activeDialogs.delete(chatId);
      this.emit('dialogEnded', { chatId, reason, session });
      return session;
    }
    return null;
  }

  getCurrentState(chatId) {
    const session = this.activeDialogs.get(chatId);
    return session ? session.currentState : null;
  }

  getActiveSession(chatId) {
    return this.activeDialogs.get(chatId) || null;
  }

  getActiveDialogs() {
    return Array.from(this.activeDialogs.entries()).map(([chatId, session]) => ({
      chatId, dialogId: session.dialogId, currentState: session.currentState,
      startedAt: session.startedAt, lastActivity: session.lastActivity
    }));
  }

  forceState(chatId, newState) {
    const session = this.activeDialogs.get(chatId);
    if (!session) return false;
    const dialog = this.dialogs.get(session.dialogId);
    if (!dialog.states[newState]) return false;

    const previousState = session.currentState;
    this._executeHook('onExit', session.dialogId, previousState, session);
    session.currentState = newState;
    session.history.push({ state: newState, from: previousState, trigger: 'force', timestamp: Date.now() });
    this._executeHook('onEnter', session.dialogId, newState, session);
    return true;
  }

  updateSessionData(chatId, data) {
    const session = this.activeDialogs.get(chatId);
    if (session) {
      session.data = { ...session.data, ...data };
      return true;
    }
    return false;
  }
}

// ============================================================
// 🏷️ ENTITY MANAGER
// ============================================================

module.exports = DialogManager;
