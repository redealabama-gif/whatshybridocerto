/**
 * 🎯 WhatsHybrid Campaign Manager v2.0
 * Sistema completo de campanhas de marketing e envio em massa
 * Integrado com Backend API e HumanTyping para envio seguro e anti-ban
 * Funciona online (com backend) e offline (storage local)
 * 
 * @version 2.0.0
 * 
 * FUNCIONALIDADES:
 * ✅ Criação e gerenciamento de campanhas
 * ✅ Importação de contatos via CSV
 * ✅ Templates com variáveis dinâmicas ({nome}, {telefone}, {custom})
 * ✅ Envio em massa com rate limiting (30/hora, 200/dia)
 * ✅ Proteção anti-spam e anti-ban
 * ✅ Agendamento de campanhas
 * ✅ Pausa/retomada/cancelamento
 * ✅ Estatísticas e relatórios
 * ✅ Exportação de resultados (JSON/CSV)
 * ✅ Modo híbrido: Backend API + Storage Local
 * 
 * MODO HÍBRIDO:
 * - Online: Usa BackendClient.campaigns API quando conectado
 * - Offline: Usa chrome.storage.local como fallback
 * - Auto-sync: Sincroniza automaticamente quando backend conecta
 * 
 * USO BÁSICO:
 * ```javascript
 * // Criar campanha
 * const campaign = await CampaignManager.createCampaign('Black Friday', {
 *   template: 'Olá {nome}! Temos uma oferta especial para você...',
 *   delay: { min: 30000, max: 60000 }
 * });
 * 
 * // Importar contatos CSV
 * const csv = 'nome,telefone\nJoão,11999999999\nMaria,11888888888';
 * await CampaignManager.importContactsFromCSV(campaign.id, csv);
 * 
 * // Iniciar campanha
 * await CampaignManager.executeCampaign(campaign);
 * 
 * // Pausar/Retomar
 * CampaignManager.pauseCampaign(campaign.id);
 * CampaignManager.resumeCampaign(campaign.id);
 * ```
 */
(function() {
  'use strict';

  class CampaignManager {
    constructor() {
      this.campaigns = new Map();
      this.activeQueue = [];
      this.stats = {
        totalSent: 0,
        totalFailed: 0,
        totalPending: 0
      };
      this.config = {
        minDelay: 30000,      // 30 segundos mínimo entre mensagens
        maxDelay: 120000,     // 2 minutos máximo
        maxPerHour: 30,       // Máximo 30 mensagens por hora
        maxPerDay: 200,       // Máximo 200 por dia
        pauseOnError: true,   // Pausar se erro
        antiSpamEnabled: true
      };
      this.scheduledTimers = new Map();
      this.useBackend = false; // Flag para usar backend ou local storage
    }

    /**
     * Verificar se deve usar backend
     * FIX CRÍTICO: verifica também se .campaigns existe antes de usar —
     * BackendSingleton pode estar conectado mas ainda não ter inicializado
     * o sub-módulo campaigns, causando uncaught exception.
     */
    shouldUseBackend() {
      return (
        this.useBackend &&
        window.BackendClient != null &&
        typeof window.BackendClient.isConnected === 'function' &&
        window.BackendClient.isConnected() &&
        window.BackendClient.campaigns != null &&
        typeof window.BackendClient.campaigns.create === 'function'
      );
    }

    /**
     * Criar nova campanha
     */
    async createCampaign(name, options = {}) {
      // Se conectado ao backend, usar API
      if (this.shouldUseBackend()) {
        try {
          const backendCampaign = await window.BackendClient.campaigns.create({
            name,
            description: options.description || '',
            message: options.template || '',
            settings: {
              delay: options.delay || { min: 30000, max: 120000 },
              stopOnReply: options.stopOnReply !== false,
              trackResponses: options.trackResponses !== false
            },
            scheduled_at: options.scheduledFor || null
          });
          
          // Converter formato backend para formato local
          const campaign = this.backendToLocal(backendCampaign);
          this.campaigns.set(campaign.id, campaign);
          console.log('[CampaignManager] ✅ Campanha criada (backend):', campaign.name);
          return campaign;
        } catch (error) {
          console.error('[CampaignManager] Erro ao criar no backend, usando local:', error);
          // Fallback para local
        }
      }
      
      // Modo local/offline
      const campaign = {
        id: this.generateCampaignId(),
        name,
        status: 'draft', // draft, scheduled, running, paused, completed, failed, cancelled
        createdAt: Date.now(),
        scheduledFor: options.scheduledFor || null,
        template: options.template || '',
        variables: options.variables || [],
        contacts: [],
        results: {
          sent: 0,
          failed: 0,
          pending: 0,
          responses: 0
        },
        settings: {
          delay: options.delay || { min: 30000, max: 120000 },
          stopOnReply: options.stopOnReply !== false,
          trackResponses: options.trackResponses !== false
        }
      };
      this.campaigns.set(campaign.id, campaign);
      this.saveCampaigns();
      console.log('[CampaignManager] ✅ Campanha criada (local):', campaign.name);
      return campaign;
    }

    /**
     * Converter campanha do formato backend para local
     */
    backendToLocal(backendCampaign) {
      return {
        id: backendCampaign.id,
        name: backendCampaign.name,
        status: backendCampaign.status,
        createdAt: new Date(backendCampaign.created_at).getTime(),
        scheduledFor: backendCampaign.scheduled_at ? new Date(backendCampaign.scheduled_at).getTime() : null,
        template: backendCampaign.message || '',
        variables: [],
        contacts: [],
        results: {
          sent: backendCampaign.sent_count || 0,
          failed: backendCampaign.failed_count || 0,
          pending: backendCampaign.total_contacts - (backendCampaign.sent_count || 0) - (backendCampaign.failed_count || 0),
          responses: 0
        },
        settings: backendCampaign.settings || { delay: { min: 30000, max: 120000 } }
      };
    }

    /**
     * Agendar campanha
     */
    scheduleCampaign(campaignId, scheduledTime) {
      const campaign = this.campaigns.get(campaignId);
      if (!campaign) throw new Error('Campanha não encontrada');
      
      campaign.scheduledFor = scheduledTime;
      campaign.status = 'scheduled';
      this.saveCampaigns();
      this.scheduleExecution(campaign);
      
      console.log('[CampaignManager] 📅 Campanha agendada:', campaign.name, new Date(scheduledTime));
      return campaign;
    }

    /**
     * Agendar execução da campanha
     * FIX CRÍTICO: scheduledTimers Map persiste só em memória.
     * Reload/SW sleep zera todos os timers sem notificação — campanhas agendadas
     * eram silenciosamente perdidas. Agora usa chrome.alarms (persistido pelo browser)
     * com fallback para setTimeout quando alarms não está disponível (ex: content script).
     */
    scheduleExecution(campaign) {
      if (!campaign.scheduledFor) return;

      const delay = campaign.scheduledFor - Date.now();
      if (delay <= 0) {
        this.executeCampaign(campaign);
        return;
      }

      // Tenta usar chrome.alarms (sobrevive ao SW sleep)
      if (typeof chrome !== 'undefined' && chrome.alarms?.create) {
        const alarmName = `whl_campaign_${campaign.id}`;
        chrome.alarms.create(alarmName, { when: campaign.scheduledFor });
        // Persiste mapeamento alarmName→campaignId no storage para o handler recuperar
        chrome.storage.local.get('whl_campaign_alarms', (result) => {
          const map = result.whl_campaign_alarms || {};
          map[alarmName] = campaign.id;
          chrome.storage.local.set({ whl_campaign_alarms: map });
        });
        console.log(`[CampaignManager] ⏰ Campanha ${campaign.name} agendada via chrome.alarm em ${new Date(campaign.scheduledFor).toLocaleString()}`);
        return;
      }

      // Fallback: setTimeout (perdido no SW sleep — loga aviso claro)
      console.warn(`[CampaignManager] ⚠️ chrome.alarms indisponível — usando setTimeout. Timer SERÁ PERDIDO se o SW dormir antes de ${new Date(campaign.scheduledFor).toLocaleString()}`);
      const timer = setTimeout(() => {
        this.executeCampaign(campaign);
        this.scheduledTimers.delete(campaign.id);
      }, delay);

      this.scheduledTimers.set(campaign.id, timer);
    }

    /**
     * Pausar campanha
     */
    pauseCampaign(campaignId) {
      const campaign = this.campaigns.get(campaignId);
      if (!campaign || campaign.status !== 'running') return false;
      
      campaign.status = 'paused';
      campaign.pausedAt = Date.now();
      this.saveCampaigns();
      
      console.log('[CampaignManager] ⏸️ Campanha pausada:', campaign.name);
      return true;
    }

    /**
     * Retomar campanha
     */
    resumeCampaign(campaignId) {
      const campaign = this.campaigns.get(campaignId);
      if (!campaign || campaign.status !== 'paused') return false;
      
      campaign.status = 'running';
      campaign.resumedAt = Date.now();
      this.saveCampaigns();
      this.executeCampaign(campaign);
      
      console.log('[CampaignManager] ▶️ Campanha retomada:', campaign.name);
      return true;
    }

    /**
     * Cancelar campanha
     */
    cancelCampaign(campaignId) {
      const campaign = this.campaigns.get(campaignId);
      if (!campaign) return false;
      
      campaign.status = 'cancelled';
      campaign.cancelledAt = Date.now();
      this.saveCampaigns();
      
      // Cancelar timer se agendado
      if (this.scheduledTimers.has(campaignId)) {
        clearTimeout(this.scheduledTimers.get(campaignId));
        this.scheduledTimers.delete(campaignId);
      }
      
      console.log('[CampaignManager] ⏹️ Campanha cancelada:', campaign.name);
      return true;
    }

    /**
     * Importar contatos de CSV
     */
    async importContactsFromCSV(campaignId, csvContent) {
      const campaign = this.campaigns.get(campaignId);
      if (!campaign) throw new Error('Campanha não encontrada');
      
      const lines = csvContent.split('\n').filter(l => l.trim());
      if (lines.length === 0) {
        throw new Error('CSV vazio');
      }
      
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      
      const contacts = [];
      for (let i = 1; i < lines.length; i++) {
        const values = this.parseCSVLine(lines[i]);
        const contact = {};
        headers.forEach((header, idx) => {
          contact[header] = values[idx] || '';
        });
        
        // Validar telefone
        if (contact.phone || contact.telefone || contact.numero) {
          const phone = this.normalizePhone(contact.phone || contact.telefone || contact.numero);
          if (phone) {
            contacts.push({
              phone,
              name: contact.name || contact.nome || '',
              variables: contact,
              status: 'pending'
            });
          }
        }
      }
      
      campaign.contacts = contacts;
      campaign.results.pending = contacts.length;
      this.saveCampaigns();
      
      console.log(`[CampaignManager] 📥 ${contacts.length} contatos importados para "${campaign.name}"`);
      return contacts.length;
    }

    /**
     * Parse CSV line (handles quoted fields)
     */
    parseCSVLine(line) {
      const values = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());
      
      return values;
    }

    /**
     * Normalizar número de telefone
     */
    normalizePhone(phone) {
      if (!phone) return null;
      
      let normalized = phone.toString().replace(/\D/g, '');
      
      // 55 + 11 dígitos (com 9) = 13 dígitos total
      if (normalized.length === 13 && normalized.startsWith('55')) {
        return normalized;
      }
      
      // 11 dígitos (com 9) ou 10 dígitos - adicionar código do país
      if (normalized.length === 11 || normalized.length === 10) {
        return '55' + normalized;
      }
      
      return null;
    }

    /**
     * Definir template da mensagem
     */
    setMessageTemplate(campaignId, template, variables = []) {
      const campaign = this.campaigns.get(campaignId);
      if (!campaign) throw new Error('Campanha não encontrada');
      
      campaign.template = template;
      campaign.variables = variables;
      this.saveCampaigns();
      
      console.log('[CampaignManager] 📝 Template definido para:', campaign.name);
      return campaign;
    }

    /**
     * Processar template com variáveis
     */
    processTemplate(template, contact) {
      let message = template;
      
      // Substituir variáveis padrão
      message = message.replace(/\{nome\}/gi, contact.name || 'Cliente');
      message = message.replace(/\{primeiro_nome\}/gi, (contact.name || 'Cliente').split(' ')[0]);
      message = message.replace(/\{telefone\}/gi, contact.phone || '');
      
      // Substituir variáveis customizadas
      if (contact.variables) {
        for (const [key, value] of Object.entries(contact.variables)) {
          const regex = new RegExp(`\\{${key}\\}`, 'gi');
          message = message.replace(regex, value || '');
        }
      }
      
      // Adicionar variação para anti-spam
      if (this.config.antiSpamEnabled) {
        message = this.addMessageVariation(message);
      }
      
      return message;
    }

    /**
     * Adicionar variação para evitar detecção de spam
     */
    addMessageVariation(message) {
      const variations = [
        () => message + ' ',
        () => message + '\u200B', // Zero-width space
        () => message.replace(/\./g, () => Math.random() > 0.5 ? '.' : '．'),
        () => message + '\n',
      ];
      return variations[Math.floor(Math.random() * variations.length)]();
    }

    /**
     * Executar campanha
     */
    async executeCampaign(campaign) {
      if (campaign.status !== 'running' && campaign.status !== 'scheduled') {
        campaign.status = 'running';
      }
      
      console.log(`[CampaignManager] 🚀 Iniciando campanha: ${campaign.name}`);
      
      const pendingContacts = campaign.contacts.filter(c => c.status === 'pending');
      
      // FIX CRÍTICO: itera com índice numérico para poder salvar o ponto de pausa.
      // Antes, pauseOnError pausava mas não salvava o índice → ao retomar,
      // recomeçava do início mesmo com contatos já enviados.
      for (let i = 0; i < pendingContacts.length; i++) {
        const contact = pendingContacts[i];

        // Verificar se foi pausada ou cancelada
        if (campaign.status === 'paused' || campaign.status === 'cancelled') {
          console.log('[CampaignManager] ⏹️ Campanha interrompida');
          break;
        }
        
        // Verificar horário seguro
        if (!this.isSafeHour()) {
          console.log('[CampaignManager] ⏰ Fora do horário seguro (8h-20h), aguardando...');
          await this.sleep(60000);
          continue;
        }
        
        // Rate limiting
        if (!this.checkRateLimit()) {
          console.log('[CampaignManager] ⏳ Rate limit atingido, aguardando...');
          await this.sleep(60000);
          continue;
        }
        
        try {
          const message = this.processTemplate(campaign.template, contact);
          const success = await this.sendMessage(contact.phone, message);
          
          if (success) {
            contact.status = 'sent';
            contact.sentAt = Date.now();
            campaign.results.sent++;
            this.stats.totalSent++;
            console.log(`[CampaignManager] ✅ Enviado para ${contact.name || contact.phone}`);
          } else {
            contact.status = 'failed';
            contact.failedAt = Date.now();
            campaign.results.failed++;
            this.stats.totalFailed++;
            console.log(`[CampaignManager] ❌ Falha ao enviar para ${contact.name || contact.phone}`);
          }
          
          campaign.results.pending--;
          this.saveCampaigns();
          
          const delay = this.getRandomDelay(campaign.settings.delay);
          console.log(`[CampaignManager] ⏱️ Aguardando ${Math.round(delay/1000)}s até próxima mensagem`);
          await this.sleep(delay);
          
        } catch (error) {
          console.error('[CampaignManager] ❌ Erro:', error);
          contact.status = 'failed';
          contact.error = error.message;
          campaign.results.failed++;
          
          if (this.config.pauseOnError) {
            campaign.status = 'paused';
            // FIX CRÍTICO: salva o índice do último contato para retomar de onde parou
            // sem isso, ao retomar a campanha recomeçava do início
            campaign.pausedAtContactIndex = campaign.contacts.indexOf(contact);
            this.saveCampaigns();
            console.log(`[CampaignManager] ⏸️ Campanha pausada no contato índice ${campaign.pausedAtContactIndex}`);
            break;
          }
        }
      }
      
      // Verificar se completou
      if (campaign.results.pending === 0) {
        campaign.status = 'completed';
        campaign.completedAt = Date.now();
        console.log(`[CampaignManager] ✅ Campanha completada: ${campaign.name}`);
        
        // Emitir evento
        if (window.EventBus) {
          window.EventBus.emit('campaign:completed', {
            id: campaign.id,
            name: campaign.name,
            sent: campaign.results.sent,
            failed: campaign.results.failed
          });
        }
      }
      
      this.saveCampaigns();
    }

    /**
     * Enviar mensagem individual
     */
    async sendMessage(phone, message) {
      try {
        // Integrar com HumanTyping para envio seguro
        if (window.HumanTyping) {
          await window.HumanTyping.maybeRandomLongPause();
          await window.HumanTyping.beforeSendDelay();
        }
        
        // Navegar para o chat
        const chatOpened = await this.openChat(phone);
        if (!chatOpened) {
          console.error('[CampaignManager] Falha ao abrir chat');
          return false;
        }
        
        await this.sleep(2000);
        
        // Digitar e enviar
        if (window.HumanTyping) {
          await window.HumanTyping.typeInWhatsApp(message);
          window.HumanTyping.recordMessageSent();
        } else {
          // Fallback: digitar manualmente
          const input = document.querySelector('[data-testid="conversation-compose-box-input"]');
          if (input) {
            input.focus();
            document.execCommand('insertText', false, message);
            await this.sleep(500);
            
            // Pressionar Enter
            const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13 });
            input.dispatchEvent(event);
          }
        }
        
        // Registrar timestamp para rate limiting
        this.recordMessageSent();
        
        return true;
      } catch (error) {
        console.error('[CampaignManager] Erro ao enviar mensagem:', error);
        return false;
      }
    }

    /**
     * Abrir chat pelo número
     */
    async openChat(phone) {
      try {
        // Tentar usar o roteador interno do WhatsApp Web primeiro
        // Se não funcionar, usar o método tradicional
        const waLink = `https://web.whatsapp.com/send?phone=${phone}`;
        
        // Método 1: Tentar abrir via interno (se disponível)
        if (window.WWebJS && typeof window.WWebJS.openChat === 'function') {
          await window.WWebJS.openChat(phone);
        } else {
          // Método 2: Navegação padrão
          // Nota: Isso causa um reload da página, mas é necessário para abrir novos chats
          window.location.href = waLink;
        }
        
        // Aguardar carregamento do chat
        await this.sleep(5000);
        
        // Verificar se chat abriu
        const input = document.querySelector('[data-testid="conversation-compose-box-input"]');
        return !!input;
      } catch (error) {
        console.error('[CampaignManager] Erro ao abrir chat:', error);
        return false;
      }
    }

    /**
     * Obter estatísticas da campanha
     */
    getCampaignStats(campaignId) {
      const campaign = this.campaigns.get(campaignId);
      if (!campaign) return null;
      
      const duration = campaign.completedAt 
        ? campaign.completedAt - campaign.createdAt 
        : Date.now() - campaign.createdAt;
      
      const totalProcessed = campaign.results.sent + campaign.results.failed;
      
      return {
        ...campaign.results,
        status: campaign.status,
        successRate: totalProcessed > 0 ? (campaign.results.sent / totalProcessed * 100) : 0,
        duration: duration,
        avgTimePerMessage: campaign.results.sent > 0 ? (duration / campaign.results.sent) : 0,
        estimatedTimeRemaining: campaign.results.pending > 0 && campaign.results.sent > 0 
          ? (campaign.results.pending * (duration / campaign.results.sent)) 
          : 0
      };
    }

    /**
     * Listar todas as campanhas
     */
    async listCampaigns(filter = {}) {
      // Se conectado ao backend, buscar de lá
      if (this.shouldUseBackend()) {
        try {
          const response = await window.BackendClient.campaigns.list(filter);
          const campaigns = response.campaigns || [];
          
          // Atualizar cache local
          campaigns.forEach(c => {
            this.campaigns.set(c.id, this.backendToLocal(c));
          });
          
          return campaigns.map(c => this.backendToLocal(c));
        } catch (error) {
          console.error('[CampaignManager] Erro ao listar do backend:', error);
          // Fallback para local
        }
      }
      
      // Modo local
      let campaigns = Array.from(this.campaigns.values());
      
      if (filter.status) {
        campaigns = campaigns.filter(c => c.status === filter.status);
      }
      
      return campaigns.sort((a, b) => b.createdAt - a.createdAt);
    }

    /**
     * Exportar resultados
     */
    exportResults(campaignId, format = 'json') {
      const campaign = this.campaigns.get(campaignId);
      if (!campaign) return null;
      
      if (format === 'csv') {
        const headers = ['phone', 'name', 'status', 'sentAt', 'error'];
        const rows = campaign.contacts.map(c => [
          c.phone,
          c.name || '',
          c.status,
          c.sentAt ? new Date(c.sentAt).toISOString() : '',
          c.error || ''
        ]);
        return [headers.join(','), ...rows.map(r => r.map(cell => `"${cell}"`).join(','))].join('\n');
      }
      
      return JSON.stringify(campaign, null, 2);
    }

    /**
     * Salvar campanhas no storage
     */
    saveCampaigns() {
      try {
        const data = {};
        this.campaigns.forEach((campaign, id) => {
          data[id] = campaign;
        });
        
        chrome.storage.local.set({ 
          campaigns: data,
          campaignStats: this.stats
        }, () => {
          if (chrome.runtime.lastError) {
            console.error('[CampaignManager] Erro ao salvar:', chrome.runtime.lastError);
          }
        });
      } catch (error) {
        console.error('[CampaignManager] Erro ao salvar campanhas:', error);
      }
    }

    /**
     * Carregar campanhas do storage
     */
    async loadCampaigns() {
      return new Promise(resolve => {
        chrome.storage.local.get(['campaigns', 'campaignStats'], result => {
          if (result.campaigns) {
            this.campaigns = new Map(Object.entries(result.campaigns));
            console.log(`[CampaignManager] 📂 ${this.campaigns.size} campanhas carregadas`);
          }
          
          if (result.campaignStats) {
            this.stats = result.campaignStats;
          }
          
          // Reagendar campanhas agendadas
          this.campaigns.forEach(campaign => {
            if (campaign.status === 'scheduled' && campaign.scheduledFor) {
              this.scheduleExecution(campaign);
            }
          });
          
          resolve();
        });
      });
    }

    /**
     * Rate limiting - verificar se pode enviar
     */
    checkRateLimit() {
      const now = Date.now();
      const hourAgo = now - 3600000;
      const dayAgo = now - 86400000;
      
      const sentLastHour = this.getSentInPeriod(hourAgo);
      const sentLastDay = this.getSentInPeriod(dayAgo);
      
      return sentLastHour < this.config.maxPerHour && sentLastDay < this.config.maxPerDay;
    }

    /**
     * Contar mensagens enviadas em um período
     */
    getSentInPeriod(since) {
      let count = 0;
      this.campaigns.forEach(campaign => {
        campaign.contacts.forEach(contact => {
          if (contact.sentAt && contact.sentAt >= since) {
            count++;
          }
        });
      });
      return count;
    }

    /**
     * Registrar mensagem enviada (para rate limiting)
     */
    recordMessageSent() {
      // Implementação simples usando eventos
      if (window.EventBus) {
        window.EventBus.emit('message:sent', { timestamp: Date.now() });
      }
    }

    /**
     * Verificar se é horário seguro para envio
     */
    isSafeHour() {
      const hour = new Date().getHours();
      return hour >= 8 && hour <= 20; // 8h às 20h
    }

    /**
     * Verificar se contato já recebeu recentemente
     */
    hasRecentMessage(phone, hours = 24) {
      const threshold = Date.now() - (hours * 3600000);
      
      for (const campaign of this.campaigns.values()) {
        const contact = campaign.contacts.find(c => c.phone === phone);
        if (contact && contact.sentAt && contact.sentAt >= threshold) {
          return true;
        }
      }
      return false;
    }

    /**
     * Anti-spam: obter variação de caractere invisível
     */
    getAntiSpamVariation() {
      const invisibleChars = ['\u200B', '\u200C', '\u200D', '\uFEFF'];
      return invisibleChars[Math.floor(Math.random() * invisibleChars.length)];
    }

    /**
     * Delay aleatório
     */
    getRandomDelay(delayConfig) {
      const min = delayConfig.min || 30000;
      const max = delayConfig.max || 120000;
      return min + Math.random() * (max - min);
    }

    /**
     * Sleep helper
     */
    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Gerar ID único
     */
    generateCampaignId() {
      return `camp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Inicialização do módulo
     */
    async init() {
      console.log('[CampaignManager] 🚀 Inicializando...');
      
      // Carregar campanhas locais
      await this.loadCampaigns();
      
      // Verificar conexão com backend
      if (window.BackendClient && window.BackendClient.isConnected()) {
        this.useBackend = true;
        console.log('[CampaignManager] 🌐 Modo online (backend conectado)');
        
        // Sincronizar campanhas do backend
        try {
          await this.syncFromBackend();
        } catch (error) {
          console.warn('[CampaignManager] Falha ao sincronizar:', error);
        }
      } else {
        this.useBackend = false;
        console.log('[CampaignManager] 💾 Modo offline (storage local)');
      }
      
      // Escutar eventos de conexão do backend
      if (window.EventBus) {
        window.EventBus.on('backend:connected', () => {
          this.useBackend = true;
          console.log('[CampaignManager] 🌐 Backend conectado, mudando para modo online');
          this.syncFromBackend().catch(e => console.warn('[CampaignManager] Erro ao sincronizar:', e));
        });
        
        window.EventBus.on('backend:disconnected', () => {
          this.useBackend = false;
          console.log('[CampaignManager] 💾 Backend desconectado, mudando para modo offline');
        });
      }
      
      console.log('[CampaignManager] ✅ Pronto');
    }

    /**
     * Sincronizar campanhas do backend
     */
    async syncFromBackend() {
      if (!this.shouldUseBackend()) return;
      
      try {
        const campaigns = await this.listCampaigns();
        console.log(`[CampaignManager] 🔄 ${campaigns.length} campanhas sincronizadas do backend`);
      } catch (error) {
        console.error('[CampaignManager] Erro ao sincronizar:', error);
        throw error;
      }
    }

    /**
     * Alternar uso do backend
     */
    setBackendMode(enabled) {
      this.useBackend = enabled;
      console.log(`[CampaignManager] Modo backend: ${enabled ? 'online' : 'offline'}`);
    }
  }

  // Expor globalmente
  window.CampaignManager = new CampaignManager();
  
  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.CampaignManager.init();
    });
  } else {
    window.CampaignManager.init();
  }

})();
