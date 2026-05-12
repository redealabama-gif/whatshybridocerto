/**
 * 🔗 Integração EscalationSystem + SmartBot IA
 * 
 * Conecta o novo sistema de escalonamento com SLA ao SmartBot IA existente,
 * permitindo escalonamento automático baseado em análise de contexto.
 * 
 * @version 1.0.0
 * @author WhatsHybrid Team
 */

(function() {
  'use strict';

  // Aguarda ambos os sistemas estarem disponíveis
  let initAttempts = 0;
  const maxAttempts = 50;
  let syncMetricsInterval = null;

  function waitForDependencies() {
    initAttempts++;
    
    if (window.escalationSystem && window.smartBot) {
      initializeIntegration();
    } else if (initAttempts < maxAttempts) {
      setTimeout(waitForDependencies, 100);
    } else {
      console.warn('[Escalation Integration] Sistemas não encontrados após', maxAttempts, 'tentativas');
      console.warn('[Escalation Integration] escalationSystem:', !!window.escalationSystem);
      console.warn('[Escalation Integration] smartBot:', !!window.smartBot);
    }
  }

  function initializeIntegration() {
    console.log('[Escalation Integration] 🔗 Iniciando integração...');

    const escalation = window.escalationSystem;
    const smartBot = window.smartBot;

    // ============================================================
    // AUTO-ESCALATION BASEADO EM ANÁLISE
    // ============================================================

    /**
     * Avalia se uma mensagem deve ser escalada automaticamente
     */
    function shouldAutoEscalate(analysis) {
      // Verifica regras do sistema de escalation
      if (!analysis) return false;

      // Alta urgência
      if (analysis.urgency?.level === 'high') return true;

      // Sentimento muito negativo
      if (analysis.sentiment?.sentiment === 'negative' && 
          analysis.sentiment?.score < 0.3) return true;

      // Intenção de reclamação urgente
      if (analysis.intent?.primaryIntent === 'complaint' && 
          analysis.urgency?.level === 'medium') return true;

      // Confiança muito baixa do bot
      if (analysis.confidence && analysis.confidence < 30) return true;

      return false;
    }

    /**
     * Processa análise e decide sobre escalation
     */
    async function processAnalysisForEscalation(message, analysis) {
      // Primeiro, verifica regras customizadas
      const ruleResult = escalation.evaluateRules(message, analysis);
      if (ruleResult && ruleResult.some(r => r.action === 'escalate')) {
        console.log('[Escalation Integration] ✅ Escalonamento por regra');
        return ruleResult.find(r => r.action === 'escalate').ticket;
      }

      // Se não houver regra, verifica critérios automáticos
      if (shouldAutoEscalate(analysis)) {
        console.log('[Escalation Integration] ⚡ Auto-escalation ativado');
        const ticket = await escalation.escalateMessage(message, analysis);
        
        // Tenta auto-assign
        if (ticket) {
          escalation.autoAssign(ticket);
        }
        
        return ticket;
      }

      return null;
    }

    // ============================================================
    // INTEGRAÇÃO COM MÉTRICAS
    // ============================================================

    /**
     * Sincroniza métricas entre sistemas
     */
    function syncMetrics() {
      if (smartBot.metricsSystem) {
        // Atualiza métricas do smartBot com dados do escalation
        const escalationStats = escalation.getStats('day');
        
        // Registra escalações no SmartBot
        if (escalationStats.total > 0) {
          // O SmartBot já tem seu próprio sistema de métricas de escalação
          console.log('[Escalation Integration] 📊 Métricas sincronizadas:', escalationStats);
        }
      }
    }

    // Sincroniza métricas a cada 5 minutos
    if (syncMetricsInterval) clearInterval(syncMetricsInterval);
    syncMetricsInterval = setInterval(syncMetrics, 300000);

    // ============================================================
    // HOOKS NO SMARTBOT
    // ============================================================

    // Intercepta análise de mensagens do SmartBot para adicionar escalation
    const originalAnalyzeMessage = smartBot.analyzeMessage;
    smartBot.analyzeMessage = async function(chatId, currentMessage, messages) {
      // Chama análise original
      const analysis = await originalAnalyzeMessage.call(this, chatId, currentMessage, messages);
      
      // Adiciona informações de escalation
      if (analysis) {
        const message = {
          chatId,
          phone: analysis.phone || chatId,
          text: currentMessage,
          senderName: analysis.customerName || 'Cliente',
          timestamp: Date.now()
        };

        // Processa para possível escalation
        const escalationTicket = await processAnalysisForEscalation(message, analysis);
        
        if (escalationTicket) {
          analysis.escalated = true;
          analysis.escalationTicket = escalationTicket;
        }

        // Adiciona sugestão de escalation se próximo ao threshold
        if (!escalationTicket && (
          (analysis.urgency?.level === 'medium' && analysis.sentiment?.sentiment === 'negative') ||
          (analysis.confidence && analysis.confidence < 40)
        )) {
          analysis.shouldConsiderEscalation = true;
          analysis.escalationReason = 'Situação potencialmente crítica';
        }
      }
      
      return analysis;
    };

    // ============================================================
    // NOTIFICAÇÕES INTEGRADAS
    // ============================================================

    /**
     * Notifica smartBot sobre mudanças no escalation
     */
    function notifySmartBot(event, data) {
      if (window.StateManager) {
        window.StateManager.emit('escalation:' + event, data);
      }
    }

    // Hook para notificações de novos tickets
    const originalNotifyNewTicket = escalation.notifyNewTicket;
    escalation.notifyNewTicket = function(ticket) {
      originalNotifyNewTicket.call(this, ticket);
      notifySmartBot('new_ticket', ticket);
    };

    // Hook para tickets atribuídos
    const originalAssignTicket = escalation.assignTicket;
    escalation.assignTicket = function(ticketId, agentId) {
      const result = originalAssignTicket.call(this, ticketId, agentId);
      if (result) {
        notifySmartBot('ticket_assigned', { ticketId, agentId, ticket: result });
      }
      return result;
    };

    // Hook para tickets resolvidos
    const originalResolveTicket = escalation.resolveTicket;
    escalation.resolveTicket = function(ticketId, resolution, agentId) {
      const result = originalResolveTicket.call(this, ticketId, resolution, agentId);
      if (result) {
        notifySmartBot('ticket_resolved', { ticketId, resolution, ticket: result });
        
        // Atualiza métricas do SmartBot
        if (smartBot.metricsSystem) {
          smartBot.metricsSystem.recordEscalation();
        }
      }
      return result;
    };

    // ============================================================
    // API PÚBLICA INTEGRADA
    // ============================================================

    window.escalationIntegration = {
      /**
       * Verifica se mensagem deve ser escalada
       */
      async checkEscalation(message, analysis) {
        return await processAnalysisForEscalation(message, analysis);
      },

      /**
       * Força escalação de uma conversa
       */
      async forceEscalate(chatId, reason = 'Escalonamento manual') {
        const message = {
          chatId,
          phone: chatId,
          text: '',
          senderName: 'Cliente',
          timestamp: Date.now()
        };

        const analysis = {
          escalationReason: reason,
          urgency: { level: 'high' },
          sentiment: { sentiment: 'neutral' },
          confidence: 100
        };

        const ticket = await escalation.escalateMessage(message, analysis);
        
        if (ticket) {
          escalation.autoAssign(ticket);
        }

        return ticket;
      },

      /**
       * Obtém status de escalation para um chat
       */
      getEscalationStatus(chatId) {
        // Procura ticket ativo para o chat
        const allTickets = escalation.listTickets();
        const activeStatuses = ['open', 'assigned', 'in_progress'];
        const tickets = allTickets.filter(t => activeStatuses.includes(t.status));
        
        const chatTickets = tickets.filter(t => t.chatId === chatId);
        
        if (chatTickets.length > 0) {
          const ticket = chatTickets[0];
          return {
            hasActiveTicket: true,
            ticket,
            status: ticket.status,
            priority: ticket.priority,
            assignedTo: ticket.assignedTo,
            slaStatus: {
              responseBreached: ticket.sla.responseBreached,
              resolutionBreached: ticket.sla.resolutionBreached,
              responseTimeRemaining: Math.max(0, ticket.sla.responseDeadline - Date.now()),
              resolutionTimeRemaining: Math.max(0, ticket.sla.resolutionDeadline - Date.now())
            }
          };
        }

        return {
          hasActiveTicket: false,
          ticket: null
        };
      },

      /**
       * Obtém estatísticas gerais
       */
      getStats(period = 'day') {
        const escalationStats = escalation.getStats(period);
        const smartBotMetrics = smartBot.metricsSystem ? 
          smartBot.metricsSystem.getMetrics() : null;

        return {
          escalation: escalationStats,
          smartBot: smartBotMetrics,
          integrated: {
            timestamp: Date.now(),
            period
          }
        };
      }
    };

    console.log('[Escalation Integration] ✅ Integração completa');
    console.log('[Escalation Integration] API disponível em window.escalationIntegration');

    // Sincroniza métricas inicialmente
    syncMetrics();
  }

  window.addEventListener('beforeunload', () => {
    if (syncMetricsInterval) {
      clearInterval(syncMetricsInterval);
      syncMetricsInterval = null;
    }
  });

  // Inicia verificação de dependências
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForDependencies);
  } else {
    waitForDependencies();
  }

  console.log('[Escalation Integration] 📦 Módulo carregado');
})();
