/**
 * HumanAssistanceSystem
 * @file Extraído de SmartBotExtendedService.js (refactor v9)
 */

const EventEmitter = require('events');

class HumanAssistanceSystem extends EventEmitter {
  constructor() {
    super();
    this.escalationQueue = [];
    this.agents = new Map();
    this.activeChats = new Map();
    this.config = {
      maxChatsPerAgent: 5,
      escalationTimeout: 300000,
      autoAssign: true,
      priorityFactors: { sentiment: 0.3, waitTime: 0.3, urgency: 0.2, vip: 0.2 }
    };
    this.stats = { totalEscalations: 0, resolved: 0, avgWaitTime: 0, avgHandleTime: 0 };
  }

  registerAgent(agentId, info = {}) {
    this.agents.set(agentId, {
      id: agentId,
      name: info.name || agentId,
      status: 'offline',
      skills: info.skills || [],
      maxChats: info.maxChats || this.config.maxChatsPerAgent,
      activeChats: [],
      stats: { handled: 0, avgHandleTime: 0, satisfaction: 0 },
      lastActivity: Date.now()
    });
    return this.agents.get(agentId);
  }

  setAgentStatus(agentId, status) {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      agent.lastActivity = Date.now();
      if (status === 'online' && this.config.autoAssign) this._processQueue();
      this.emit('agentStatusChanged', { agentId, status });
      return true;
    }
    return false;
  }

  requestEscalation(chatId, context = {}) {
    if (this.activeChats.has(chatId)) {
      return { success: false, reason: 'already_assigned', agentId: this.activeChats.get(chatId) };
    }
    if (this.escalationQueue.some(e => e.chatId === chatId)) {
      return { success: false, reason: 'already_in_queue' };
    }

    const priority = this._calculatePriority(context);
    const escalation = {
      id: `esc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      chatId, priority,
      context: {
        reason: context.reason || 'user_request',
        sentiment: context.sentiment,
        intent: context.intent,
        urgency: context.urgency || 0,
        isVIP: context.isVIP || false,
        customerName: context.customerName,
        summary: context.summary
      },
      requestedAt: Date.now(),
      status: 'pending'
    };

    const insertIndex = this.escalationQueue.findIndex(e => e.priority < priority);
    if (insertIndex === -1) this.escalationQueue.push(escalation);
    else this.escalationQueue.splice(insertIndex, 0, escalation);

    this.stats.totalEscalations++;
    this.emit('escalationRequested', escalation);

    if (this.config.autoAssign) {
      const assigned = this._processQueue();
      if (assigned.includes(chatId)) {
        return { success: true, status: 'assigned', agentId: this.activeChats.get(chatId), position: 0 };
      }
    }

    return {
      success: true, status: 'queued',
      position: this.escalationQueue.findIndex(e => e.chatId === chatId) + 1,
      estimatedWait: this._estimateWaitTime(escalation)
    };
  }

  _calculatePriority(context) {
    let priority = 50;
    const factors = this.config.priorityFactors;
    if (context.sentiment !== undefined) priority += (1 - context.sentiment) * 100 * factors.sentiment;
    if (context.urgency) priority += context.urgency * 100 * factors.urgency;
    if (context.isVIP) priority += 100 * factors.vip;
    return Math.min(100, Math.max(0, priority));
  }

  _estimateWaitTime(escalation) {
    const position = this.escalationQueue.indexOf(escalation);
    const availableAgents = this._getAvailableAgents().length;
    if (availableAgents === 0) return -1;
    const avgHandleTime = this.stats.avgHandleTime || 300000;
    return Math.round((position / availableAgents) * avgHandleTime);
  }

  _getAvailableAgents() {
    return Array.from(this.agents.values()).filter(a => a.status === 'online' && a.activeChats.length < a.maxChats);
  }

  _processQueue() {
    const assignedChats = [];
    const availableAgents = this._getAvailableAgents();

    while (this.escalationQueue.length > 0 && availableAgents.length > 0) {
      const escalation = this.escalationQueue[0];
      const bestAgent = this._findBestAgent(escalation, availableAgents);
      if (!bestAgent) break;

      this._assignChat(escalation.chatId, bestAgent.id);
      this.escalationQueue.shift();
      escalation.status = 'assigned';
      escalation.assignedAt = Date.now();
      escalation.agentId = bestAgent.id;

      assignedChats.push(escalation.chatId);
      this.emit('chatAssigned', { chatId: escalation.chatId, agentId: bestAgent.id });

      if (bestAgent.activeChats.length >= bestAgent.maxChats) {
        const idx = availableAgents.indexOf(bestAgent);
        if (idx > -1) availableAgents.splice(idx, 1);
      }
    }

    return assignedChats;
  }

  _findBestAgent(escalation, availableAgents) {
    if (availableAgents.length === 0) return null;
    if (availableAgents.length === 1) return availableAgents[0];

    let bestAgent = null, bestScore = -1;
    availableAgents.forEach(agent => {
      let score = (1 - agent.activeChats.length / agent.maxChats) * 50;
      if (escalation.context.intent && agent.skills.includes(escalation.context.intent)) score += 30;
      score += (agent.stats.satisfaction || 0.5) * 20;
      if (score > bestScore) { bestScore = score; bestAgent = agent; }
    });
    return bestAgent;
  }

  _assignChat(chatId, agentId) {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.activeChats.push({ chatId, assignedAt: Date.now() });
      this.activeChats.set(chatId, agentId);
    }
  }

  endChat(chatId, resolution = {}) {
    const agentId = this.activeChats.get(chatId);
    if (!agentId) return false;

    const agent = this.agents.get(agentId);
    if (agent) {
      const chatInfo = agent.activeChats.find(c => c.chatId === chatId);
      if (chatInfo) {
        const handleTime = Date.now() - chatInfo.assignedAt;
        agent.stats.handled++;
        agent.stats.avgHandleTime = (agent.stats.avgHandleTime * (agent.stats.handled - 1) + handleTime) / agent.stats.handled;
        if (resolution.satisfaction !== undefined) {
          agent.stats.satisfaction = (agent.stats.satisfaction * (agent.stats.handled - 1) + resolution.satisfaction) / agent.stats.handled;
        }
        agent.activeChats = agent.activeChats.filter(c => c.chatId !== chatId);
      }
    }

    this.activeChats.delete(chatId);
    this.stats.resolved++;
    this.emit('chatEnded', { chatId, agentId, resolution });
    if (this.config.autoAssign) this._processQueue();
    return true;
  }

  transferChat(chatId, newAgentId) {
    const currentAgentId = this.activeChats.get(chatId);
    if (!currentAgentId) return { success: false, reason: 'chat_not_found' };
    const newAgent = this.agents.get(newAgentId);
    if (!newAgent) return { success: false, reason: 'agent_not_found' };
    if (newAgent.status !== 'online') return { success: false, reason: 'agent_not_available' };
    if (newAgent.activeChats.length >= newAgent.maxChats) return { success: false, reason: 'agent_full' };

    const currentAgent = this.agents.get(currentAgentId);
    if (currentAgent) currentAgent.activeChats = currentAgent.activeChats.filter(c => c.chatId !== chatId);
    this._assignChat(chatId, newAgentId);
    this.emit('chatTransferred', { chatId, from: currentAgentId, to: newAgentId });
    return { success: true, previousAgent: currentAgentId, newAgent: newAgentId };
  }

  getQueuePosition(chatId) {
    const index = this.escalationQueue.findIndex(e => e.chatId === chatId);
    if (index === -1) {
      if (this.activeChats.has(chatId)) return { position: 0, status: 'assigned', agentId: this.activeChats.get(chatId) };
      return { position: -1, status: 'not_found' };
    }
    const escalation = this.escalationQueue[index];
    return { position: index + 1, status: 'queued', estimatedWait: this._estimateWaitTime(escalation), priority: escalation.priority };
  }

  getQueueStatus() {
    return {
      queueLength: this.escalationQueue.length,
      activeChats: this.activeChats.size,
      availableAgents: this._getAvailableAgents().length,
      totalAgents: this.agents.size,
      onlineAgents: Array.from(this.agents.values()).filter(a => a.status === 'online').length,
      stats: this.stats
    };
  }

  getAgents() {
    return Array.from(this.agents.values()).map(a => ({
      id: a.id, name: a.name, status: a.status, activeChats: a.activeChats.length, maxChats: a.maxChats, stats: a.stats
    }));
  }

  cancelEscalation(chatId) {
    const index = this.escalationQueue.findIndex(e => e.chatId === chatId);
    if (index > -1) { this.escalationQueue.splice(index, 1); return true; }
    return false;
  }
}

// ============================================================
// 💾 CACHE MANAGER
// ============================================================

module.exports = HumanAssistanceSystem;
