/**
 * 🎯 Sistema de Escalonamento e SLA - WhatsHybrid
 * 
 * Sistema completo de escalonamento para atendimento humano com:
 * - Fila de tickets priorizada
 * - Tracking de SLA com alertas
 * - Regras configuráveis
 * - Gerenciamento de agentes
 * - Notificações via webhooks
 * - Métricas e relatórios
 * 
 * @version 1.0.0
 * @author WhatsHybrid Team
 */

(function() {
  'use strict';

  class EscalationSystem {
    constructor() {
      this.queue = new Map(); // ticketId -> ticket
      this.agents = new Map(); // agentId -> agent info
      this.rules = [];
      this.slaConfig = {
        urgent: { responseTime: 5, resolutionTime: 30 }, // minutos
        high: { responseTime: 15, resolutionTime: 60 },
        medium: { responseTime: 30, resolutionTime: 120 },
        low: { responseTime: 60, resolutionTime: 240 }
      };
      this.metrics = {
        totalEscalated: 0,
        totalResolved: 0,
        avgResponseTime: 0,
        avgResolutionTime: 0,
        slaBreaches: 0
      };
      this.webhooks = [];
      this.slaMonitorInterval = null;
    }

    async initialize() {
      await this.loadQueue();
      await this.loadRules();
      await this.loadAgents();
      await this.loadWebhooks();
      this.startSLAMonitor();
      console.log('[Escalation] ✅ Sistema inicializado');
    }

    /**
     * SECURITY FIX P0-005: Check permissions for privileged operations
     * Validates that current user has required permission before executing sensitive actions
     */
    _checkPermission(requiredPermission) {
      // Check if RBAC system is available
      if (typeof window.SecurityRBAC === 'undefined') {
        console.error('[Escalation Security] RBAC system not available. Operation denied for safety.');
        return false;
      }

      // Verify user has required permission
      if (!window.SecurityRBAC.hasPermission(requiredPermission)) {
        console.error(`[Escalation Security] Permission denied: ${requiredPermission} required`);
        return false;
      }

      return true;
    }

    // ============================================================
    // CRIAÇÃO E GERENCIAMENTO DE TICKETS
    // ============================================================

    /**
     * Criar ticket de escalonamento
     */
    createTicket(data) {
      const ticket = {
        id: this.generateTicketId(),
        chatId: data.chatId,
        phone: data.phone,
        customerName: data.customerName || 'Cliente',
        reason: data.reason || 'Escalonamento automático',
        priority: data.priority || 'medium',
        status: 'open', // open, assigned, in_progress, resolved, closed
        createdAt: Date.now(),
        updatedAt: Date.now(),
        assignedTo: null,
        assignedAt: null,
        firstResponseAt: null,
        resolvedAt: null,
        closedAt: null,
        messages: data.messages || [],
        context: data.context || {},
        tags: data.tags || [],
        sla: {
          responseDeadline: Date.now() + (this.slaConfig[data.priority || 'medium'].responseTime * 60000),
          resolutionDeadline: Date.now() + (this.slaConfig[data.priority || 'medium'].resolutionTime * 60000),
          responseBreached: false,
          resolutionBreached: false
        },
        notes: [],
        history: [{
          action: 'created',
          timestamp: Date.now(),
          by: 'system'
        }]
      };

      this.queue.set(ticket.id, ticket);
      this.metrics.totalEscalated++;
      this.saveQueue();
      this.notifyNewTicket(ticket);
      
      console.log(`[Escalation] 🎫 Ticket criado: ${ticket.id} - ${ticket.reason}`);
      return ticket;
    }

    /**
     * Escalar mensagem automaticamente
     */
    async escalateMessage(message, analysis) {
      const ticket = this.createTicket({
        chatId: message.chatId,
        phone: message.phone,
        customerName: message.senderName,
        reason: analysis.escalationReason || 'Requer intervenção humana',
        priority: this.determinePriority(analysis),
        messages: [message],
        context: {
          sentiment: analysis.sentiment,
          intent: analysis.intent,
          urgency: analysis.urgency,
          confidence: analysis.confidence
        },
        tags: this.extractTags(analysis)
      });

      return ticket;
    }

    /**
     * Determinar prioridade baseado na análise
     */
    determinePriority(analysis) {
      if (analysis.urgency?.level === 'high') return 'urgent';
      if (analysis.sentiment?.sentiment === 'negative' && analysis.urgency?.level === 'medium') return 'high';
      if (analysis.intent?.primaryIntent === 'complaint') return 'high';
      if (analysis.sentiment?.sentiment === 'negative') return 'medium';
      return 'low';
    }

    /**
     * Extrair tags da análise
     */
    extractTags(analysis) {
      const tags = [];
      
      if (analysis.sentiment?.sentiment) {
        tags.push(`sentiment:${analysis.sentiment.sentiment}`);
      }
      if (analysis.intent?.primaryIntent) {
        tags.push(`intent:${analysis.intent.primaryIntent}`);
      }
      if (analysis.urgency?.level) {
        tags.push(`urgency:${analysis.urgency.level}`);
      }
      
      return tags;
    }

    /**
     * Atribuir ticket a um agente
     */
    assignTicket(ticketId, agentId) {
      // SECURITY FIX P0-005: Require TEAM_MANAGE permission to assign tickets
      if (!this._checkPermission('team:manage')) {
        throw new Error('Permission denied: team:manage required to assign tickets');
      }

      const ticket = this.queue.get(ticketId);
      if (!ticket) return null;

      ticket.assignedTo = agentId;
      ticket.assignedAt = Date.now();
      ticket.status = 'assigned';
      ticket.updatedAt = Date.now();
      ticket.history.push({
        action: 'assigned',
        timestamp: Date.now(),
        by: 'system',
        agentId
      });

      this.saveQueue();
      this.notifyAgent(agentId, ticket);

      console.log(`[Escalation] 👤 Ticket ${ticketId} atribuído a ${agentId}`);
      return ticket;
    }

    /**
     * Auto-atribuir baseado em regras
     */
    autoAssign(ticket) {
      const availableAgents = Array.from(this.agents.values())
        .filter(a => a.status === 'available')
        .sort((a, b) => a.currentLoad - b.currentLoad);

      if (availableAgents.length > 0) {
        const agent = availableAgents[0];
        return this.assignTicket(ticket.id, agent.id);
      }

      return null;
    }

    /**
     * Registrar primeira resposta
     */
    recordFirstResponse(ticketId, agentId) {
      const ticket = this.queue.get(ticketId);
      if (!ticket || ticket.firstResponseAt) return;

      ticket.firstResponseAt = Date.now();
      ticket.status = 'in_progress';
      ticket.updatedAt = Date.now();
      
      const responseTime = ticket.firstResponseAt - ticket.createdAt;
      ticket.sla.actualResponseTime = responseTime;
      
      if (ticket.firstResponseAt > ticket.sla.responseDeadline) {
        ticket.sla.responseBreached = true;
        this.metrics.slaBreaches++;
      }

      ticket.history.push({
        action: 'first_response',
        timestamp: Date.now(),
        by: agentId,
        responseTime
      });

      this.updateMetrics();
      this.saveQueue();
    }

    /**
     * Resolver ticket
     */
    resolveTicket(ticketId, resolution, agentId) {
      // SECURITY FIX P0-006: Require TEAM_MANAGE permission to resolve tickets
      if (!this._checkPermission('team:manage')) {
        throw new Error('Permission denied: team:manage required to resolve tickets');
      }

      const ticket = this.queue.get(ticketId);
      if (!ticket) return null;

      ticket.resolvedAt = Date.now();
      ticket.status = 'resolved';
      ticket.resolution = resolution;
      ticket.updatedAt = Date.now();

      const resolutionTime = ticket.resolvedAt - ticket.createdAt;
      ticket.sla.actualResolutionTime = resolutionTime;

      if (ticket.resolvedAt > ticket.sla.resolutionDeadline) {
        ticket.sla.resolutionBreached = true;
        this.metrics.slaBreaches++;
      }

      ticket.history.push({
        action: 'resolved',
        timestamp: Date.now(),
        by: agentId,
        resolution,
        resolutionTime
      });

      this.metrics.totalResolved++;
      this.updateMetrics();
      this.saveQueue();

      console.log(`[Escalation] ✅ Ticket ${ticketId} resolvido`);
      return ticket;
    }

    /**
     * Fechar ticket
     */
    closeTicket(ticketId, feedback = null) {
      // SECURITY FIX P0-007: Require TEAM_MANAGE permission to close tickets
      if (!this._checkPermission('team:manage')) {
        throw new Error('Permission denied: team:manage required to close tickets');
      }

      const ticket = this.queue.get(ticketId);
      if (!ticket) return null;

      ticket.closedAt = Date.now();
      ticket.status = 'closed';
      ticket.feedback = feedback;
      ticket.updatedAt = Date.now();

      ticket.history.push({
        action: 'closed',
        timestamp: Date.now(),
        feedback
      });

      this.saveQueue();
      return ticket;
    }

    /**
     * Reabrir ticket
     */
    reopenTicket(ticketId, reason) {
      // SECURITY FIX P0-008: Require TEAM_MANAGE permission to reopen tickets
      if (!this._checkPermission('team:manage')) {
        throw new Error('Permission denied: team:manage required to reopen tickets');
      }

      const ticket = this.queue.get(ticketId);
      if (!ticket) return null;

      ticket.status = 'open';
      ticket.resolvedAt = null;
      ticket.closedAt = null;
      ticket.updatedAt = Date.now();

      ticket.history.push({
        action: 'reopened',
        timestamp: Date.now(),
        reason
      });

      this.saveQueue();
      return ticket;
    }

    // ============================================================
    // REGRAS DE ESCALONAMENTO
    // ============================================================

    /**
     * Adicionar regra de escalonamento
     */
    addRule(rule) {
      // SECURITY FIX P0-009: Require SYSTEM_ADMIN permission to add escalation rules
      if (!this._checkPermission('system:admin')) {
        throw new Error('Permission denied: system:admin required to add escalation rules');
      }

      const newRule = {
        id: this.generateRuleId(),
        name: rule.name,
        conditions: rule.conditions || [],
        actions: rule.actions || [],
        priority: rule.priority || 0,
        enabled: rule.enabled !== false,
        createdAt: Date.now()
      };

      this.rules.push(newRule);
      this.rules.sort((a, b) => b.priority - a.priority);
      this.saveRules();

      return newRule;
    }

    /**
     * Avaliar regras para uma mensagem
     */
    evaluateRules(message, analysis) {
      for (const rule of this.rules) {
        if (!rule.enabled) continue;

        const matches = this.checkConditions(rule.conditions, message, analysis);
        if (matches) {
          return this.executeActions(rule.actions, message, analysis);
        }
      }

      return null;
    }

    /**
     * Verificar condições
     */
    checkConditions(conditions, message, analysis) {
      for (const condition of conditions) {
        switch (condition.type) {
          case 'sentiment':
            if (analysis.sentiment?.sentiment !== condition.value) return false;
            break;
          case 'intent':
            if (analysis.intent?.primaryIntent !== condition.value) return false;
            break;
          case 'urgency':
            if (analysis.urgency?.level !== condition.value) return false;
            break;
          case 'confidence_below':
            if (analysis.confidence >= condition.value) return false;
            break;
          case 'keyword':
            if (!message.text || !message.text.toLowerCase().includes(condition.value.toLowerCase())) return false;
            break;
          case 'time_range':
            const hour = new Date().getHours();
            if (hour < condition.start || hour >= condition.end) return false;
            break;
        }
      }
      return true;
    }

    /**
     * Executar ações
     */
    executeActions(actions, message, analysis) {
      const results = [];

      for (const action of actions) {
        switch (action.type) {
          case 'escalate':
            const ticket = this.escalateMessage(message, {
              ...analysis,
              escalationReason: action.reason || 'Regra de escalonamento'
            });
            results.push({ action: 'escalate', ticket });
            break;
          case 'assign':
            results.push({ action: 'assign', agentId: action.agentId });
            break;
          case 'tag':
            results.push({ action: 'tag', tags: action.tags });
            break;
          case 'notify':
            this.sendNotification(action.channel, action.message, { message, analysis });
            results.push({ action: 'notify', channel: action.channel });
            break;
          case 'priority':
            results.push({ action: 'priority', priority: action.priority });
            break;
        }
      }

      return results;
    }

    /**
     * Regras padrão
     */
    setupDefaultRules() {
      this.addRule({
        name: 'Reclamação urgente',
        conditions: [
          { type: 'intent', value: 'complaint' },
          { type: 'urgency', value: 'high' }
        ],
        actions: [
          { type: 'escalate', reason: 'Reclamação urgente detectada' },
          { type: 'priority', priority: 'urgent' }
        ],
        priority: 100
      });

      this.addRule({
        name: 'Sentimento muito negativo',
        conditions: [
          { type: 'sentiment', value: 'negative' },
          { type: 'confidence_below', value: 50 }
        ],
        actions: [
          { type: 'escalate', reason: 'Cliente insatisfeito' },
          { type: 'priority', priority: 'high' }
        ],
        priority: 90
      });

      this.addRule({
        name: 'Fora do horário comercial',
        conditions: [
          { type: 'time_range', start: 20, end: 8 }
        ],
        actions: [
          { type: 'escalate', reason: 'Mensagem fora do horário' },
          { type: 'priority', priority: 'low' }
        ],
        priority: 50
      });
    }

    // ============================================================
    // GERENCIAMENTO DE AGENTES
    // ============================================================

    /**
     * Registrar agente
     */
    registerAgent(agentData) {
      // SECURITY FIX P0-010: Require TEAM_MANAGE permission to register agents
      if (!this._checkPermission('team:manage')) {
        throw new Error('Permission denied: team:manage required to register agents');
      }

      const agent = {
        id: agentData.id || this.generateAgentId(),
        name: agentData.name,
        email: agentData.email,
        status: 'available', // available, busy, away, offline
        currentLoad: 0,
        maxLoad: agentData.maxLoad || 10,
        skills: agentData.skills || [],
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        stats: {
          ticketsHandled: 0,
          avgResponseTime: 0,
          avgResolutionTime: 0,
          satisfaction: 0
        }
      };

      this.agents.set(agent.id, agent);
      this.saveAgents();
      return agent;
    }

    /**
     * Atualizar status do agente
     */
    updateAgentStatus(agentId, status) {
      // SECURITY FIX P0-011: Require TEAM_MANAGE permission to update agent status
      if (!this._checkPermission('team:manage')) {
        throw new Error('Permission denied: team:manage required to update agent status');
      }

      const agent = this.agents.get(agentId);
      if (!agent) return null;

      agent.status = status;
      agent.lastActiveAt = Date.now();
      this.saveAgents();

      return agent;
    }

    /**
     * Listar agentes disponíveis
     */
    getAvailableAgents() {
      return Array.from(this.agents.values())
        .filter(a => a.status === 'available' && a.currentLoad < a.maxLoad);
    }

    /**
     * Obter carga do agente
     */
    getAgentLoad(agentId) {
      const openTickets = Array.from(this.queue.values())
        .filter(t => t.assignedTo === agentId && ['assigned', 'in_progress'].includes(t.status));
      return openTickets.length;
    }

    // ============================================================
    // MONITORAMENTO DE SLA
    // ============================================================

    /**
     * Iniciar monitor de SLA
     */
    startSLAMonitor() {
      if (this.slaMonitorInterval) {
        clearInterval(this.slaMonitorInterval);
      }
      
      this.slaMonitorInterval = setInterval(() => {
        this.checkSLABreaches();
      }, 60000); // Verificar a cada minuto
    }

    /**
     * Verificar violações de SLA
     */
    checkSLABreaches() {
      const now = Date.now();

      for (const ticket of this.queue.values()) {
        if (['resolved', 'closed'].includes(ticket.status)) continue;

        // Verificar SLA de resposta
        if (!ticket.firstResponseAt && now > ticket.sla.responseDeadline && !ticket.sla.responseBreached) {
          ticket.sla.responseBreached = true;
          this.metrics.slaBreaches++;
          this.notifySLABreach(ticket, 'response');
          console.warn(`[Escalation] ⚠️ SLA de resposta violado: ${ticket.id}`);
        }

        // Verificar SLA de resolução
        if (!ticket.resolvedAt && now > ticket.sla.resolutionDeadline && !ticket.sla.resolutionBreached) {
          ticket.sla.resolutionBreached = true;
          this.metrics.slaBreaches++;
          this.notifySLABreach(ticket, 'resolution');
          console.warn(`[Escalation] ⚠️ SLA de resolução violado: ${ticket.id}`);
        }
      }

      this.saveQueue();
    }

    /**
     * Notificar violação de SLA
     */
    notifySLABreach(ticket, type) {
      const message = type === 'response'
        ? `⚠️ SLA de resposta violado para ticket ${ticket.id} (${ticket.customerName})`
        : `⚠️ SLA de resolução violado para ticket ${ticket.id} (${ticket.customerName})`;

      this.sendNotification('sla_breach', message, { ticket, type });
    }

    // ============================================================
    // NOTIFICAÇÕES E WEBHOOKS
    // ============================================================

    /**
     * Configurar webhook
     */
    addWebhook(url, events = ['all']) {
      const webhook = {
        id: this.generateWebhookId(),
        url,
        events,
        createdAt: Date.now(),
        enabled: true
      };

      this.webhooks.push(webhook);
      this.saveWebhooks();
      return webhook;
    }

    /**
     * Enviar notificação
     */
    async sendNotification(event, message, data = {}) {
      // Notificação local
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('WhatsHybrid Escalation', {
          body: message,
          icon: '/icons/icon48.png'
        });
      }

      // Webhooks
      for (const webhook of this.webhooks) {
        if (!webhook.enabled) continue;
        if (webhook.events.includes('all') || webhook.events.includes(event)) {
          try {
            // Add timeout to prevent hanging
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
            
            await fetch(webhook.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event,
                message,
                data,
                timestamp: Date.now()
              }),
              signal: controller.signal
            });
            
            clearTimeout(timeoutId);
          } catch (error) {
            if (error.name === 'AbortError') {
              console.error('[Escalation] Timeout no webhook:', webhook.url);
            } else {
              console.error('[Escalation] Erro no webhook:', error);
            }
          }
        }
      }
    }

    /**
     * Notificar novo ticket
     */
    notifyNewTicket(ticket) {
      this.sendNotification('new_ticket', `🎫 Novo ticket: ${ticket.reason}`, { ticket });
    }

    /**
     * Notificar agente
     */
    notifyAgent(agentId, ticket) {
      this.sendNotification('ticket_assigned', `📋 Ticket atribuído: ${ticket.id}`, { agentId, ticket });
    }

    // ============================================================
    // MÉTRICAS E RELATÓRIOS
    // ============================================================

    /**
     * Atualizar métricas
     */
    updateMetrics() {
      const resolved = Array.from(this.queue.values()).filter(t => t.resolvedAt);
      
      if (resolved.length > 0) {
        const totalResponseTime = resolved
          .filter(t => t.sla.actualResponseTime)
          .reduce((sum, t) => sum + t.sla.actualResponseTime, 0);
        
        const totalResolutionTime = resolved
          .filter(t => t.sla.actualResolutionTime)
          .reduce((sum, t) => sum + t.sla.actualResolutionTime, 0);
        
        const resolvedWithResponseTime = resolved.filter(t => t.sla.actualResponseTime);
        this.metrics.avgResponseTime = resolvedWithResponseTime.length > 0 
          ? totalResponseTime / resolvedWithResponseTime.length 
          : 0;
        this.metrics.avgResolutionTime = resolved.length > 0 
          ? totalResolutionTime / resolved.length 
          : 0;
      }
    }

    /**
     * Obter estatísticas
     */
    getStats(period = 'day') {
      const now = Date.now();
      const periodMs = {
        hour: 3600000,
        day: 86400000,
        week: 604800000,
        month: 2592000000
      }[period] || 86400000;

      const tickets = Array.from(this.queue.values())
        .filter(t => t.createdAt > now - periodMs);

      return {
        total: tickets.length,
        open: tickets.filter(t => t.status === 'open').length,
        assigned: tickets.filter(t => t.status === 'assigned').length,
        inProgress: tickets.filter(t => t.status === 'in_progress').length,
        resolved: tickets.filter(t => t.status === 'resolved').length,
        closed: tickets.filter(t => t.status === 'closed').length,
        byPriority: {
          urgent: tickets.filter(t => t.priority === 'urgent').length,
          high: tickets.filter(t => t.priority === 'high').length,
          medium: tickets.filter(t => t.priority === 'medium').length,
          low: tickets.filter(t => t.priority === 'low').length
        },
        slaBreaches: tickets.filter(t => t.sla.responseBreached || t.sla.resolutionBreached).length,
        avgResponseTime: this.metrics.avgResponseTime,
        avgResolutionTime: this.metrics.avgResolutionTime
      };
    }

    /**
     * Listar tickets por status
     */
    listTickets(filter = {}) {
      let tickets = Array.from(this.queue.values());

      if (filter.status) {
        tickets = tickets.filter(t => t.status === filter.status);
      }
      if (filter.priority) {
        tickets = tickets.filter(t => t.priority === filter.priority);
      }
      if (filter.assignedTo) {
        tickets = tickets.filter(t => t.assignedTo === filter.assignedTo);
      }
      if (filter.slaBreached) {
        tickets = tickets.filter(t => t.sla.responseBreached || t.sla.resolutionBreached);
      }

      return tickets.sort((a, b) => {
        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority] || b.createdAt - a.createdAt;
      });
    }

    // ============================================================
    // PERSISTÊNCIA
    // ============================================================

    /**
     * Salvar fila
     */
    async saveQueue() {
      const data = Object.fromEntries(this.queue);
      await chrome.storage.local.set({ 
        escalation_queue: data,
        escalation_metrics: this.metrics
      });
    }

    /**
     * Carregar fila
     */
    async loadQueue() {
      return new Promise((resolve, reject) => {
        try {
          chrome.storage.local.get(['escalation_queue', 'escalation_metrics'], result => {
            if (chrome.runtime.lastError) {
              console.error('[Escalation] Erro ao carregar fila:', chrome.runtime.lastError);
              resolve(); // Resolve anyway to continue initialization
              return;
            }
            if (result.escalation_queue) {
              this.queue = new Map(Object.entries(result.escalation_queue));
            }
            if (result.escalation_metrics) {
              this.metrics = { ...this.metrics, ...result.escalation_metrics };
            }
            resolve();
          });
        } catch (error) {
          console.error('[Escalation] Erro inesperado ao carregar fila:', error);
          resolve(); // Resolve anyway to continue initialization
        }
      });
    }

    /**
     * Salvar regras
     */
    async saveRules() {
      await chrome.storage.local.set({ escalation_rules: this.rules });
    }

    /**
     * Carregar regras
     */
    async loadRules() {
      return new Promise(resolve => {
        chrome.storage.local.get(['escalation_rules'], result => {
          if (result.escalation_rules) {
            this.rules = result.escalation_rules;
          } else {
            this.setupDefaultRules();
          }
          resolve();
        });
      });
    }

    /**
     * Salvar agentes
     */
    async saveAgents() {
      const data = Object.fromEntries(this.agents);
      await chrome.storage.local.set({ escalation_agents: data });
    }

    /**
     * Carregar agentes
     */
    async loadAgents() {
      return new Promise(resolve => {
        chrome.storage.local.get(['escalation_agents'], result => {
          if (result.escalation_agents) {
            this.agents = new Map(Object.entries(result.escalation_agents));
          }
          resolve();
        });
      });
    }

    /**
     * Salvar webhooks
     */
    async saveWebhooks() {
      await chrome.storage.local.set({ escalation_webhooks: this.webhooks });
    }

    /**
     * Carregar webhooks
     */
    async loadWebhooks() {
      return new Promise(resolve => {
        chrome.storage.local.get(['escalation_webhooks'], result => {
          if (result.escalation_webhooks) {
            this.webhooks = result.escalation_webhooks;
          }
          resolve();
        });
      });
    }

    // ============================================================
    // HELPERS
    // ============================================================

    generateTicketId() { 
      return `TKT-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`; 
    }
    
    generateRuleId() { 
      return `RULE-${Date.now()}`; 
    }
    
    generateAgentId() { 
      return `AGT-${Date.now()}`; 
    }
    
    generateWebhookId() { 
      return `WH-${Date.now()}`; 
    }
  }

  // Exportar para uso global
  window.EscalationSystem = EscalationSystem;

  // Auto-inicializar se chrome.storage estiver disponível
  if (typeof chrome !== 'undefined' && chrome.storage) {
    window.escalationSystem = new EscalationSystem();
    window.escalationSystem.initialize().catch(err => {
      console.error('[Escalation] Erro na inicialização:', err);
    });
  }

  // Cleanup ao descarregar
  window.addEventListener('beforeunload', () => {
    if (window.escalationSystem?.slaMonitorInterval) {
      clearInterval(window.escalationSystem.slaMonitorInterval);
    }
  });

  console.log('[Escalation] 📦 Módulo carregado');
})();
