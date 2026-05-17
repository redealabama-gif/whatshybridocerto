/**
 * 🚀 Modules Initializer v2.1 - Inicializa e conecta todos os módulos
 * Integrado com EventBus v2.0 e StateManager v1.0
 * CORRIGIDO: Adiciona módulos corrigidos
 * 
 * @version 2.1.0
 */

(function() {
  'use strict';

  const MODULES = [
    { name: 'EventBus', global: 'EventBus', required: true, priority: 1 },
    { name: 'StateManager', global: 'StateManager', required: true, priority: 2 },
    { name: 'SubscriptionManager', global: 'SubscriptionManager', required: true, priority: 3 },
    { name: 'FeatureGate', global: 'FeatureGate', priority: 4 },
    { name: 'AIService', global: 'AIService', priority: 5 },
    { name: 'CopilotEngine', global: 'CopilotEngine', priority: 6 },
    { name: 'BackendClient', global: 'BackendClient', priority: 7 },
    { name: 'ChartEngine', global: 'ChartEngine', priority: 10 },
    { name: 'NotificationsModule', global: 'NotificationsModule', priority: 20 },
    { name: 'AnalyticsModule', global: 'AnalyticsModule', priority: 30 },
    { name: 'ContactManager', global: 'ContactManager', priority: 35 },
    // LabelsModule precisa inicializar ANTES de CRMModule. O CRM no init
    // chama syncWithBackend que mexe em whl_labels_v2 (mesmo store das
    // etiquetas). Se o Labels ainda não terminou de hidratar o state em
    // memória a partir do storage, qualquer write subsequente do CRM
    // dispara o chrome.storage.onChanged listener do labels — recarrega
    // state — e o que era state válido vira state estale. Sintoma:
    // F5 → etiquetas somem (close+reopen não dispara porque o boot é
    // mais lento e os módulos têm tempo de hidratar antes do sync).
    { name: 'LabelsModule', global: 'LabelsModule', priority: 38 },
    { name: 'CRMModule', global: 'CRMModule', priority: 40 },
    { name: 'TasksModule', global: 'TasksModule', priority: 50 },
    { name: 'CampaignManager', global: 'CampaignManager', priority: 55 },
    { name: 'SmartRepliesModule', global: 'SmartRepliesModule', priority: 60 },
    { name: 'SubscriptionModule', global: 'SubscriptionModule', priority: 70 },
    { name: 'BusinessIntelligence', global: 'BusinessIntelligence', priority: 85 },
    { name: 'TrainingDebugTools', global: 'TrainingDebugTools', priority: 90 },
    // Módulos originais v7.8.0
    { name: 'TrustSystem', global: 'TrustSystem', priority: 91 },
    { name: 'TeamSystem', global: 'TeamSystem', priority: 93 },
    // MÓDULOS CORRIGIDOS v7.8.1 - têm prioridade
    { name: 'SmartSuggestions', global: 'SmartSuggestions', priority: 93 },
    { name: 'QuickRepliesFixed', global: 'QuickRepliesFixed', priority: 94 },
    { name: 'AISuggestionFixed', global: 'AISuggestionFixed', priority: 95 },
    { name: 'TeamSystemUI', global: 'TeamSystemUI', priority: 96 },
    { name: 'MediaSenderFixed', global: 'MediaSenderFixed', priority: 97 },
    { name: 'RecoverDOM', global: 'RecoverDOM', priority: 98 }
  ].sort((a, b) => (a.priority || 99) - (b.priority || 99));

  const initState = {
    initialized: false,
    modulesLoaded: [],
    modulesFailed: [],
    startTime: null
  };

  /**
   * Mostra overlay visual para erro crítico de inicialização
   * @param {string} moduleName - Nome do módulo que falhou
   * @param {Error} error - Erro ocorrido
   */
  function showCriticalError(moduleName, error) {
    // Remover overlay anterior se existir
    const existing = document.getElementById('whl-critical-error');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.id = 'whl-critical-error';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.9);
      z-index: 9999999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, sans-serif;
    `;
    
    const safeModuleName = String(moduleName || 'Desconhecido').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeErrorMsg = String(error?.message || 'Erro desconhecido').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    overlay.innerHTML = `
      <div style="background: #1F2937; padding: 32px; border-radius: 16px; max-width: 500px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
        <div style="font-size: 64px; margin-bottom: 16px;">⚠️</div>
        <h2 style="color: #EF4444; margin: 0 0 16px; font-size: 24px;">Erro Crítico de Inicialização</h2>
        <p style="color: #D1D5DB; margin: 0 0 16px; font-size: 16px; line-height: 1.5;">
          O módulo <strong style="color: white;">${safeModuleName}</strong> falhou ao inicializar.
          O WhatsHybrid não pode funcionar corretamente sem este módulo.
        </p>
        <p style="color: #9CA3AF; font-size: 13px; margin: 0 0 24px; background: #111827; padding: 12px; border-radius: 8px; text-align: left; font-family: monospace; word-break: break-all;">
          ${safeErrorMsg}
        </p>
        <div style="display: flex; gap: 12px; justify-content: center;">
          <button id="whl-error-reload" style="
            background: #3B82F6;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            font-weight: 500;
          ">🔄 Recarregar Página</button>
          <button id="whl-error-dismiss" style="
            background: #374151;
            color: #D1D5DB;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
          ">Continuar Assim</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    document.getElementById('whl-error-reload')?.addEventListener('click', () => {
      location.reload();
    });
    
    document.getElementById('whl-error-dismiss')?.addEventListener('click', () => {
      overlay.remove();
    });
  }

  /**
   * Inicializa todos os módulos
   */
  async function initializeModules() {
    if (initState.initialized) {
      console.warn('[ModulesInit] Já inicializado');
      return;
    }

    initState.startTime = Date.now();
    console.log('[ModulesInit] 🚀 Iniciando módulos v2.0...');

    let criticalFailure = false;
    let criticalFailureModule = null;

    for (const mod of MODULES) {
      // Se já houve falha crítica, não continuar
      if (criticalFailure) {
        console.warn(`[ModulesInit] ⏭️ Pulando ${mod.name} devido a falha crítica anterior`);
        continue;
      }

      try {
        if (window[mod.global]) {
          if (typeof window[mod.global].init === 'function') {
            await window[mod.global].init();
          }
          initState.modulesLoaded.push(mod.name);
          console.log(`[ModulesInit] ✅ ${mod.name} inicializado`);
          
          if (window.EventBus) {
            window.EventBus.emit(window.WHL_EVENTS?.MODULE_LOADED || 'system:module_loaded', { name: mod.name });
          }
        } else if (mod.required) {
          throw new Error(`Módulo obrigatório não encontrado: ${mod.name}`);
        }
      } catch (error) {
        initState.modulesFailed.push({ name: mod.name, error: error.message });
        console.error(`[ModulesInit] ❌ Erro ao inicializar ${mod.name}:`, error);
        
        // CRÍTICO: Se módulo obrigatório falhar, interromper inicialização
        if (mod.required) {
          criticalFailure = true;
          criticalFailureModule = mod.name;
          console.error(`[ModulesInit] 🚨 FALHA CRÍTICA: Módulo obrigatório ${mod.name} falhou. Interrompendo inicialização.`);
          
          // Notificar usuário
          if (window.NotificationsModule?.toast) {
            window.NotificationsModule.toast(`❌ Erro crítico: ${mod.name} não carregou`, 'error', 5000);
          }
          
          // CORREÇÃO: Mostrar overlay visual de erro crítico
          showCriticalError(mod.name, error);
          
          // Emitir evento de falha crítica
          if (window.EventBus) {
            window.EventBus.emit('system:critical_failure', { module: mod.name, error: error.message });
          }
        }
      }
    }

    // Se houve falha crítica, não marcar como inicializado
    if (criticalFailure) {
      console.error(`[ModulesInit] 🚫 Inicialização incompleta devido a falha em: ${criticalFailureModule}`);
      initState.criticalFailure = { module: criticalFailureModule, timestamp: Date.now() };
      return; // Não continua com conexões e registros
    }

    // Conectar módulos aos eventos
    connectCampaignEvents();
    
    // Registrar estado dos módulos
    registerModulesState();

    initState.initialized = true;
    const duration = Date.now() - initState.startTime;
    console.log(`[ModulesInit] ✅ Inicialização completa em ${duration}ms`);
    console.log(`[ModulesInit] 📦 Módulos: ${initState.modulesLoaded.join(', ')}`);

    if (window.EventBus) {
      window.EventBus.emit(window.WHL_EVENTS?.SYSTEM_READY || 'system:ready', {
        modules: initState.modulesLoaded,
        duration
      });
    }
  }

  /**
   * Registra estado dos módulos no StateManager
   */
  function registerModulesState() {
    if (!window.StateManager) return;
    
    window.StateManager.set('modules.loaded', initState.modulesLoaded.reduce((acc, name) => {
      acc[name] = true;
      return acc;
    }, {}));
    
    if (initState.modulesFailed.length > 0) {
      window.StateManager.set('modules.errors', initState.modulesFailed);
    }
    
    window.StateManager.set('system.initTime', initState.startTime);
    window.StateManager.set('system.version', '7.0.0');
  }

  /**
   * Conecta eventos de campanha ao Analytics e StateManager
   */
  function connectCampaignEvents() {
    const bus = window.EventBus;
    const state = window.StateManager;
    // Hook no sidepanel.js existente para capturar eventos
    
    // Interceptar envio de mensagens
    const originalSendMessage = window.whlSendMessage;
    if (originalSendMessage) {
      window.whlSendMessage = async function(...args) {
        const [phone, message, options] = args;
        
        // Emitir evento antes
        if (bus) bus.emit('message:sending', { phone, message, options });
        
        const result = await originalSendMessage.apply(this, args);
        
        // Rastrear no Analytics
        if (result && result.success) {
          if (window.AnalyticsModule) window.AnalyticsModule.trackMessage(args[0], true);
          
          // Atualizar StateManager
          if (state) {
            state.increment('metrics.messagesSentToday');
            state.set('metrics.lastActivity', Date.now());
          }
          
          // Emitir evento via EventBus
          if (bus) bus.emit(bus.EVENTS?.MESSAGE_SENT || 'message:sent', { phone, message, timestamp: Date.now() });
        } else {
          if (window.AnalyticsModule) window.AnalyticsModule.trackMessage(args[0], false);
          if (bus) bus.emit(bus.EVENTS?.MESSAGE_FAILED || 'message:failed', { phone, message, error: result?.error });
        }

        // Criar/atualizar contato no CRM
        if (result && result.success && window.CRMModule) {
          window.CRMModule.upsertContact({ 
            phone: args[0], 
            source: 'campaign',
            lastContact: Date.now()
          });
        }

        return result;
      };
    }

    // Eventos de campanha
    if (bus) {
      bus.on(bus.EVENTS?.CAMPAIGN_STARTED || 'campaign:started', (data) => {
        if (state) {
          state.push('data.campaigns', {
            id: data.id || Date.now(),
            status: 'running',
            startedAt: Date.now(),
            ...data
          });
        }
        if (window.NotificationsModule) {
          window.NotificationsModule.info('Campanha Iniciada', `Enviando para ${data.total || '?'} contatos`);
        }
      });

      bus.on(bus.EVENTS?.CAMPAIGN_COMPLETED || 'campaign:completed', (data) => {
        if (window.NotificationsModule) {
          window.NotificationsModule.success('Campanha Concluída!', `${data.sent || 0} mensagens enviadas`);
        }
      });

      bus.on(bus.EVENTS?.TASK_REMINDER || 'task:reminder', (data) => {
        if (window.NotificationsModule) {
          window.NotificationsModule.warning('Lembrete de Tarefa', data.title || 'Tarefa pendente');
        }
      });

      bus.on(bus.EVENTS?.CREDITS_LOW || 'credits:low', (data) => {
        if (window.NotificationsModule) {
          window.NotificationsModule.warning('Créditos Baixos', `Você tem ${data.remaining || 0} créditos restantes`);
        }
      });

      // Criar proxy para eventos de mensagem
      const emitMessageEvent = (phone, success) => {
        bus.emit(
          success ? bus.EVENTS?.MESSAGE_SENT || 'message:sent' : bus.EVENTS?.MESSAGE_FAILED || 'message:failed',
          { phone, timestamp: Date.now() }
        );
      };

      // Expor função global para uso no sidepanel.js
      window.whlEmitMessageEvent = emitMessageEvent;
    }
  }

  /**
   * Renderiza views dos módulos
   */
  function renderModuleViews() {
    // Analytics Dashboard
    const analyticsContainer = document.getElementById('analytics_dashboard_container');
    if (analyticsContainer && window.AnalyticsModule) {
      window.AnalyticsModule.renderDashboard(analyticsContainer);
    }

    // CRM Kanban
    const crmContainer = document.getElementById('crm_kanban_container');
    if (crmContainer && window.CRMModule) {
      window.CRMModule.renderKanban(crmContainer);
    }

    // CRM Activities
    const activitiesContainer = document.getElementById('crm_activities_container');
    if (activitiesContainer && window.CRMModule) {
      window.CRMModule.renderActivities(activitiesContainer);
    }

    // Labels Manager
    const labelsContainer = document.getElementById('labels_manager_container');
    if (labelsContainer && window.LabelsModule) {
      window.LabelsModule.renderLabelManager(labelsContainer);
    }

    // Tasks
    const tasksContainer = document.getElementById('tasks_container');
    if (tasksContainer && window.TasksModule) {
      renderTasksWithFilters(tasksContainer);
    }

    // Smart Replies Settings
    const smartRepliesContainer = document.getElementById('smart_replies_settings_container');
    if (smartRepliesContainer && window.SmartRepliesModule) {
      window.SmartRepliesModule.renderSettings(smartRepliesContainer);
    }

    // Quick Replies
    const quickRepliesContainer = document.getElementById('quick_replies_container');
    if (quickRepliesContainer && window.SmartRepliesModule) {
      window.SmartRepliesModule.renderQuickReplies(quickRepliesContainer);
    }

    // Subscription Widget
    const subscriptionContainer = document.getElementById('subscription_widget_container');
    if (subscriptionContainer && window.SubscriptionModule) {
      window.SubscriptionModule.renderStatusWidget(subscriptionContainer);
    }
  }

  /**
   * Setup botões das views
   */
  function setupViewButtons() {
    // Analytics (com proteção contra duplicação)
    const analyticsRefresh = document.getElementById('analytics_refresh');
    if (analyticsRefresh && !analyticsRefresh.dataset.initBound) {
      analyticsRefresh.dataset.initBound = 'true';
      analyticsRefresh.addEventListener('click', () => {
        renderModuleViews();
        if (window.NotificationsModule) {
          window.NotificationsModule.success('Dashboard atualizado!');
        }
      });
    }

    const analyticsReset = document.getElementById('analytics_reset');
    if (analyticsReset && !analyticsReset.dataset.initBound) {
      analyticsReset.dataset.initBound = 'true';
      analyticsReset.addEventListener('click', async () => {
        if (confirm('Tem certeza que deseja resetar todas as métricas? Esta ação não pode ser desfeita.')) {
          if (window.AnalyticsModule) {
            await window.AnalyticsModule.resetAll();
            renderModuleViews();
            if (window.NotificationsModule) {
              window.NotificationsModule.success('Métricas resetadas!');
            }
          }
        }
      });
    }

    // CRM
    document.getElementById('crm_new_deal')?.addEventListener('click', () => {
      showNewDealModal();
    });

    document.getElementById('crm_new_contact')?.addEventListener('click', () => {
      showNewContactModal();
    });

    document.getElementById('crm_refresh')?.addEventListener('click', () => {
      renderModuleViews();
    });
  }

  /**
   * Modal novo negócio - CORRIGIDO: sem onclick inline
   */
  function showNewDealModal() {
    // Remover modal existente
    const existing = document.getElementById('new-deal-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'new-deal-modal';
    modal.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;
      background:rgba(0,0,0,0.85);
      display:flex;align-items:center;justify-content:center;
      z-index:10001;
    `;

    const contacts = window.CRMModule?.getContacts() || [];
    const stages = window.CRMModule?.getPipeline()?.stages || [];

    modal.innerHTML = `
      <div style="background:#1a1a2e;border-radius:16px;padding:24px;width:90%;max-width:400px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;font-size:18px;color:white;">🎯 Novo Negócio</h3>
          <button class="modal-close-btn" style="background:none;border:none;font-size:24px;cursor:pointer;color:rgba(255,255,255,0.6);line-height:1;">×</button>
        </div>

        <form id="new-deal-form" style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="font-size:12px;color:rgba(255,255,255,0.6);">Título *</label>
            <input type="text" id="deal-title" placeholder="Ex: Venda de produto X" required style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;margin-top:4px;">
          </div>

          <div>
            <label style="font-size:12px;color:rgba(255,255,255,0.6);">Contato</label>
            <select id="deal-contact" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;margin-top:4px;">
              <option value="">Selecione...</option>
              ${contacts.map(c => `<option value="${c.id}">${escapeHtml(c.name || c.phone)}</option>`).join('')}
            </select>
          </div>

          <div style="display:flex;gap:12px;">
            <div style="flex:1;">
              <label style="font-size:12px;color:rgba(255,255,255,0.6);">Valor (R$)</label>
              <input type="number" id="deal-value" placeholder="0" min="0" step="0.01" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;margin-top:4px;">
            </div>
            <div style="flex:1;">
              <label style="font-size:12px;color:rgba(255,255,255,0.6);">Estágio</label>
              <select id="deal-stage" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;margin-top:4px;">
                ${stages.map(s => `<option value="${s.id}">${s.icon} ${s.name}</option>`).join('')}
              </select>
            </div>
          </div>

          <div style="display:flex;gap:8px;margin-top:8px;">
            <button type="button" class="modal-cancel-btn" style="flex:1;padding:12px;background:rgba(255,255,255,0.1);border:none;border-radius:8px;color:white;cursor:pointer;">Cancelar</button>
            <button type="submit" style="flex:1;padding:12px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);border:none;border-radius:8px;color:white;font-weight:600;cursor:pointer;">➕ Criar Negócio</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    // Event: Fechar (X)
    modal.querySelector('.modal-close-btn').addEventListener('click', () => modal.remove());

    // Event: Cancelar
    modal.querySelector('.modal-cancel-btn').addEventListener('click', () => modal.remove());

    // Event: Clicar fora
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.remove();
    });

    // Event: Submit
    modal.querySelector('#new-deal-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      const data = {
        title: modal.querySelector('#deal-title').value,
        contactId: modal.querySelector('#deal-contact').value || null,
        value: parseFloat(modal.querySelector('#deal-value').value) || 0,
        stageId: modal.querySelector('#deal-stage').value || 'lead'
      };

      if (!data.title) {
        alert('Título é obrigatório');
        return;
      }

      if (window.CRMModule) {
        await window.CRMModule.createDeal(data);
        modal.remove();
        renderModuleViews();

        if (window.NotificationsModule) {
          window.NotificationsModule.success('Negócio criado com sucesso!');
        }
      }
    });
  }

  /**
   * Modal novo contato - CORRIGIDO: sem onclick inline
   */
  function showNewContactModal() {
    // Remover modal existente
    const existing = document.getElementById('new-contact-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'new-contact-modal';
    modal.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;
      background:rgba(0,0,0,0.85);
      display:flex;align-items:center;justify-content:center;
      z-index:10001;
    `;

    modal.innerHTML = `
      <div style="background:#1a1a2e;border-radius:16px;padding:24px;width:90%;max-width:400px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;font-size:18px;color:white;">👤 Novo Contato</h3>
          <button class="modal-close-btn" style="background:none;border:none;font-size:24px;cursor:pointer;color:rgba(255,255,255,0.6);line-height:1;">×</button>
        </div>

        <form id="new-contact-form" style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="font-size:12px;color:rgba(255,255,255,0.6);">Telefone *</label>
            <input type="text" id="contact-phone" placeholder="5511999999999" required style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;margin-top:4px;">
          </div>

          <div>
            <label style="font-size:12px;color:rgba(255,255,255,0.6);">Nome</label>
            <input type="text" id="contact-name" placeholder="Nome do contato" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;margin-top:4px;">
          </div>

          <div>
            <label style="font-size:12px;color:rgba(255,255,255,0.6);">E-mail</label>
            <input type="email" id="contact-email" placeholder="email@exemplo.com" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;margin-top:4px;">
          </div>

          <div>
            <label style="font-size:12px;color:rgba(255,255,255,0.6);">Empresa</label>
            <input type="text" id="contact-company" placeholder="Nome da empresa" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;margin-top:4px;">
          </div>

          <div style="display:flex;gap:8px;margin-top:8px;">
            <button type="button" class="modal-cancel-btn" style="flex:1;padding:12px;background:rgba(255,255,255,0.1);border:none;border-radius:8px;color:white;cursor:pointer;">Cancelar</button>
            <button type="submit" style="flex:1;padding:12px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);border:none;border-radius:8px;color:white;font-weight:600;cursor:pointer;">👤 Criar Contato</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    // Event: Fechar (X)
    modal.querySelector('.modal-close-btn').addEventListener('click', () => modal.remove());

    // Event: Cancelar
    modal.querySelector('.modal-cancel-btn').addEventListener('click', () => modal.remove());

    // Event: Clicar fora
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.remove();
    });

    // Event: Submit
    modal.querySelector('#new-contact-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      const data = {
        phone: modal.querySelector('#contact-phone').value,
        name: modal.querySelector('#contact-name').value,
        email: modal.querySelector('#contact-email').value,
        company: modal.querySelector('#contact-company').value
      };

      if (!data.phone) {
        alert('Telefone é obrigatório');
        return;
      }

      if (window.CRMModule) {
        const contact = await window.CRMModule.upsertContact(data);
        modal.remove();
        renderModuleViews();
        showContactCreatedPopup(contact);
      }
    });
  }

  /**
   * Popup após criação de contato - CORRIGIDO: sem onclick inline
   */
  function showContactCreatedPopup(contact) {
    // Remover popup existente
    const existing = document.getElementById('contact-created-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = 'contact-created-popup';
    popup.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;
      background:rgba(0,0,0,0.85);
      display:flex;align-items:center;justify-content:center;
      z-index:10002;
    `;

    popup.innerHTML = `
      <div style="background:#1a1a2e;border-radius:16px;padding:24px;width:90%;max-width:350px;text-align:center;">
        <div style="width:80px;height:80px;background:linear-gradient(135deg,#10b981,#059669);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:36px;">✅</div>
        <h3 style="margin:0 0 8px;font-size:18px;color:white;">Contato Criado!</h3>
        <div style="font-size:16px;font-weight:600;margin-bottom:4px;color:white;">${escapeHtml(contact.name || 'Novo Contato')}</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.6);margin-bottom:20px;">${contact.phone}</div>
        
        <div style="display:flex;gap:8px;">
          <button class="popup-view-btn" style="flex:1;padding:12px;background:rgba(139,92,246,0.2);border:1px solid rgba(139,92,246,0.3);border-radius:8px;cursor:pointer;color:#a78bfa;font-weight:600;">👁️ Ver Detalhes</button>
          <button class="popup-whatsapp-btn" style="flex:1;padding:12px;background:linear-gradient(135deg,#25D366,#128C7E);border:none;border-radius:8px;cursor:pointer;color:white;font-weight:600;">💬 WhatsApp</button>
        </div>
        
        <button class="popup-close-btn" style="margin-top:12px;background:none;border:none;color:rgba(255,255,255,0.5);cursor:pointer;font-size:13px;">Fechar</button>
      </div>
    `;

    document.body.appendChild(popup);

    // Event: Ver Detalhes
    popup.querySelector('.popup-view-btn').addEventListener('click', () => {
      popup.remove();
      if (window.CRMModule) {
        window.CRMModule.showContactModal(contact);
      }
    });

    // Event: WhatsApp
    popup.querySelector('.popup-whatsapp-btn').addEventListener('click', () => {
      const phone = contact.phone.replace(/\D/g, '');
      window.open(`https://web.whatsapp.com/send?phone=${phone}`, '_blank');
      popup.remove();
    });

    // Event: Fechar
    popup.querySelector('.popup-close-btn').addEventListener('click', () => popup.remove());

    // Event: Clicar fora
    popup.addEventListener('click', e => {
      if (e.target === popup) popup.remove();
    });
  }

  function escapeHtml(str) {
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(str);
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Expor funções globais
  window.renderModuleViews = renderModuleViews;
  window.initializeModules = initializeModules;
  window.showNewDealModal = showNewDealModal;
  window.showNewContactModal = showNewContactModal;

  // Estado do filtro de tarefas
  let currentTaskFilter = 'all';

  /**
   * Renderiza tarefas com filtros funcionais
   */
  function renderTasksWithFilters(container) {
    if (!window.TasksModule) return;

    const stats = window.TasksModule.getStats();

    // Atualizar stats no header
    const statTotal = document.getElementById('stat_total');
    const statPending = document.getElementById('stat_pending');
    const statOverdue = document.getElementById('stat_overdue');
    const statCompleted = document.getElementById('stat_completed');

    if (statTotal) statTotal.textContent = stats.total || 0;
    if (statPending) statPending.textContent = stats.pending || 0;
    if (statOverdue) statOverdue.textContent = stats.overdue || 0;
    if (statCompleted) statCompleted.textContent = stats.completed || 0;

    container.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
        <button class="mod-btn ${currentTaskFilter === 'all' ? 'mod-btn-primary' : 'mod-btn-secondary'} mod-btn-sm task-filter-btn" data-filter="all">
          📋 Todas (${stats.total})
        </button>
        <button class="mod-btn ${currentTaskFilter === 'pending' ? 'mod-btn-primary' : 'mod-btn-secondary'} mod-btn-sm task-filter-btn" data-filter="pending">
          ⏳ Pendentes (${stats.pending})
        </button>
        <button class="mod-btn ${currentTaskFilter === 'overdue' ? 'mod-btn-primary' : 'mod-btn-secondary'} mod-btn-sm task-filter-btn" data-filter="overdue" style="${stats.overdue > 0 ? 'color:#ef4444;border-color:#ef4444' : ''}">
          🔴 Atrasadas (${stats.overdue})
        </button>
        <button class="mod-btn ${currentTaskFilter === 'completed' ? 'mod-btn-primary' : 'mod-btn-secondary'} mod-btn-sm task-filter-btn" data-filter="completed">
          ✅ Concluídas (${stats.completed})
        </button>
      </div>
      
      <button class="mod-btn mod-btn-primary" id="new-task-btn" style="width:100%;margin-bottom:16px">
        ➕ Nova Tarefa
      </button>
      
      <div id="tasks-list-inner"></div>
    `;

    // Setup filter buttons
    container.querySelectorAll('.task-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentTaskFilter = btn.dataset.filter;
        renderTasksWithFilters(container);
      });
    });

    // Setup new task button
    document.getElementById('new-task-btn')?.addEventListener('click', () => {
      if (window.TasksModule) {
        window.TasksModule.openTaskModal();
      }
    });

    // Renderizar lista
    renderTasksList();
  }

  function renderTasksList() {
    const listContainer = document.getElementById('tasks-list-inner');
    if (!listContainer || !window.TasksModule) return;

    let tasks = [];

    if (currentTaskFilter === 'overdue') {
      tasks = window.TasksModule.getOverdueTasks();
    } else if (currentTaskFilter === 'pending') {
      tasks = window.TasksModule.getTasks({ status: 'pending' });
    } else if (currentTaskFilter === 'completed') {
      tasks = window.TasksModule.getTasks({ status: 'completed' });
    } else {
      tasks = window.TasksModule.getTasks();
    }

    if (tasks.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align:center;padding:32px;color:rgba(255,255,255,0.5)">
          <div style="font-size:48px;margin-bottom:12px">📭</div>
          <div>Nenhuma tarefa ${currentTaskFilter === 'overdue' ? 'atrasada' : currentTaskFilter === 'pending' ? 'pendente' : currentTaskFilter === 'completed' ? 'concluída' : ''}</div>
        </div>
      `;
      return;
    }

    const priorityInfo = window.TasksModule.TASK_PRIORITY;
    const typeInfo = window.TasksModule.TASK_TYPES;

    function hexToRgba(hex, alpha) {
      if (!hex || hex[0] !== '#') return 'rgba(139,92,246,' + alpha + ')';
      let r, g, b;
      if (hex.length === 7) { r = parseInt(hex.slice(1, 3), 16); g = parseInt(hex.slice(3, 5), 16); b = parseInt(hex.slice(5, 7), 16); }
      else if (hex.length === 4) { r = parseInt(hex[1] + hex[1], 16); g = parseInt(hex[2] + hex[2], 16); b = parseInt(hex[3] + hex[3], 16); }
      else return 'rgba(139,92,246,' + alpha + ')';
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    function formatTaskDate(dateStr) {
      const date = new Date(dateStr);
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const tomorrow = new Date(now.setDate(now.getDate() + 1)).toISOString().split('T')[0];
      const dateOnly = dateStr.split('T')[0];
      if (dateOnly === today) return 'Hoje ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      if (dateOnly === tomorrow) return 'Amanhã ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    }

    function escapeHtml(str) {
      const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
      if (typeof fn === 'function' && fn !== escapeHtml) return fn(str);
      return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    listContainer.innerHTML = tasks.map(task => {
      const priority = Object.values(priorityInfo).find(p => p.id === task.priority) || priorityInfo.MEDIUM;
      const taskType = Object.values(typeInfo).find(t => t.id === task.type) || typeInfo.OTHER;
      const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed';
      const isCompleted = task.status === 'completed';

      return `
        <div class="whl-task-item" data-task-id="${task.id}" style="
          display:flex;
          align-items:flex-start;
          gap:12px;
          padding:14px;
          background:${isCompleted ? 'rgba(16,185,129,0.05)' : isOverdue ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.03)'};
          border-radius:10px;
          margin-bottom:10px;
          border-left:3px solid ${isCompleted ? '#10b981' : isOverdue ? '#ef4444' : priority.color};
        ">
          <button class="task-toggle-complete" data-task-id="${task.id}" style="
            width:24px;height:24px;border-radius:50%;
            border:2px solid ${isCompleted ? '#10b981' : priority.color};
            background:${isCompleted ? '#10b981' : 'transparent'};
            cursor:pointer;display:flex;align-items:center;justify-content:center;
            flex-shrink:0;margin-top:2px;color:white;font-size:12px;
          ">${isCompleted ? '✓' : ''}</button>
          
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-size:14px">${taskType.icon}</span>
              <span style="font-size:14px;font-weight:600;${isCompleted ? 'text-decoration:line-through;opacity:0.6' : ''}">${escapeHtml(task.title)}</span>
              <span style="font-size:10px;padding:2px 6px;border-radius:8px;background:${hexToRgba(priority.color, 0.2)};color:${priority.color}">${priority.icon}</span>
            </div>
            
            ${task.description ? '<div style="font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:6px;' + (isCompleted ? 'opacity:0.5' : '') + '">' + escapeHtml(task.description) + '</div>' : ''}
            
            <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:11px;color:rgba(255,255,255,0.5)">
              ${task.dueDate ? '<span style="' + (isOverdue && !isCompleted ? 'color:#ef4444' : '') + '">📅 ' + formatTaskDate(task.dueDate) + '</span>' : ''}
              ${task.contactName || task.contactPhone ? '<span>👤 ' + escapeHtml(task.contactName || task.contactPhone) + '</span>' : ''}
            </div>
          </div>
          
          <div style="display:flex;gap:4px">
            <button class="task-edit-btn" data-task-id="${escapeHtml(task.id)}" style="padding:6px;background:rgba(255,255,255,0.05);border:none;border-radius:6px;cursor:pointer;color:rgba(255,255,255,0.7)">✏️</button>
            <button class="task-delete-btn" data-task-id="${escapeHtml(task.id)}" style="padding:6px;background:rgba(255,255,255,0.05);border:none;border-radius:6px;cursor:pointer;color:rgba(255,255,255,0.7)">🗑️</button>
          </div>
        </div>
      `;
    }).join('');

    // Setup event handlers
    listContainer.querySelectorAll('.task-toggle-complete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const taskId = btn.dataset.taskId;
        const task = window.TasksModule.getTask(taskId);
        if (task) {
          if (task.status === 'completed') {
            await window.TasksModule.updateTask(taskId, { status: 'pending' });
          } else {
            await window.TasksModule.completeTask(taskId);
          }
          const tasksContainer = document.getElementById('tasks_container');
          if (tasksContainer) renderTasksWithFilters(tasksContainer);
        }
      });
    });

    listContainer.querySelectorAll('.task-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        window.TasksModule.openTaskModal(btn.dataset.taskId);
      });
    });

    listContainer.querySelectorAll('.task-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const taskId = btn.dataset.taskId;
        const task = window.TasksModule.getTask(taskId);
        if (task && confirm('Excluir tarefa "' + task.title + '"?')) {
          await window.TasksModule.deleteTask(taskId);
          const tasksContainer = document.getElementById('tasks_container');
          if (tasksContainer) renderTasksWithFilters(tasksContainer);
          if (window.NotificationsModule) window.NotificationsModule.success('Tarefa excluída');
        }
      });
    });
  }

  window.renderTasksWithFilters = renderTasksWithFilters;

  // Exportar funções para uso externo (sidepanel-handlers.js)
  window.renderModuleViews = renderModuleViews;
  window.showNewDealModal = showNewDealModal;
  window.showNewContactModal = showNewContactModal;

  // Auto-inicializar quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
      await initializeModules();
      setupViewButtons();
      
      // Aguardar um pouco para garantir que as views existam
      setTimeout(renderModuleViews, 500);
    });
  } else {
    (async () => {
      await initializeModules();
      setupViewButtons();
      setTimeout(renderModuleViews, 500);
    })();
  }

})();
