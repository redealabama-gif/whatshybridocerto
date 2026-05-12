/**
 * WhatsHybrid - Sistema de Onboarding Premium v4.0
 * Tutorial interativo com spotlight real, setas animadas e destaque de elementos
 */

class OnboardingSystem {
    constructor() {
        this.currentStep = 0;
        this.overlay = null;
        this.isAnimating = false;
        
        // Todos os passos do tutorial
        this.steps = [
            // ========== BOAS-VINDAS ==========
            {
                id: 'welcome',
                type: 'welcome',
                title: 'Bem-vindo ao WhatsHybrid! 🎉',
                subtitle: 'A extensão mais completa para WhatsApp Web',
                description: 'Vamos fazer um tour rápido pelas principais funcionalidades. Este tutorial levará apenas 2 minutos.',
                icon: '👋',
                features: [
                    { icon: '📨', name: 'Disparo em Massa', desc: 'Envie para múltiplos contatos' },
                    { icon: '📥', name: 'Extrator', desc: 'Exporte seus contatos' },
                    { icon: '👥', name: 'Grupos', desc: 'Extraia membros' },
                    { icon: '🔄', name: 'Recover', desc: 'Msgs apagadas' },
                    { icon: '💼', name: 'CRM', desc: 'Gestão de clientes' },
                    { icon: '🤖', name: 'IA', desc: 'Respostas inteligentes' }
                ]
            },
            
            // ========== TOP PANEL ==========
            {
                id: 'toppanel',
                type: 'toppanel',
                title: '🎛️ Painel de Navegação',
                subtitle: 'No WhatsApp Web você verá este painel',
                description: 'Clique em qualquer botão para acessar a funcionalidade desejada. Vamos conhecer cada um deles:',
                buttons: [
                    { icon: '📨', label: 'Disparo', color: '#8b5cf6' },
                    { icon: '📥', label: 'Extrator', color: '#3b82f6' },
                    { icon: '👥', label: 'Grupos', color: '#10b981' },
                    { icon: '🔄', label: 'Recover', color: '#f59e0b' },
                    { icon: '💼', label: 'CRM', color: '#ec4899' },
                    { icon: '📊', label: 'Analytics', color: '#6366f1' },
                    { icon: '📋', label: 'Tarefas', color: '#14b8a6' },
                    { icon: '🤖', label: 'IA', color: '#8b5cf6' },
                    { icon: '⚙️', label: 'Config', color: '#6b7280' },
                    { icon: '💾', label: 'Backup', color: '#0ea5e9' }
                ]
            },
            
            // ========== DISPARO ==========
            {
                id: 'disparo',
                type: 'feature',
                buttonIndex: 0,
                title: '📨 Disparo de Mensagens',
                subtitle: 'Envio em massa personalizado',
                description: 'Envie mensagens para centenas de contatos de uma vez. Suporta texto, emojis, imagens e variáveis.',
                icon: '📨',
                color: '#8b5cf6',
                howTo: [
                    { step: '1', text: 'Cole os números (um por linha) ou importe CSV/Excel' },
                    { step: '2', text: 'Escreva sua mensagem (use {nome} para personalizar)' },
                    { step: '3', text: 'Anexe uma imagem se desejar' },
                    { step: '4', text: 'Clique em "Gerar Tabela" para preparar' },
                    { step: '5', text: 'Clique em "Iniciar" para começar o envio' }
                ],
                tips: [
                    { icon: '⏱️', text: 'Ajuste delays em Config para evitar bloqueios' },
                    { icon: '📊', text: 'Importe contatos de planilhas CSV ou Excel' },
                    { icon: '💡', text: 'Use variáveis como {nome} para personalizar' }
                ],
                targetElement: '#whlViewPrincipal'
            },
            
            // ========== EXTRATOR ==========
            {
                id: 'extrator',
                type: 'feature',
                buttonIndex: 1,
                title: '📥 Extrator de Contatos',
                subtitle: 'Exporte todos os seus contatos',
                description: 'Extraia contatos normais, arquivados e bloqueados do WhatsApp. Exporte para CSV, Excel ou Google Sheets.',
                icon: '📥',
                color: '#3b82f6',
                howTo: [
                    { step: '1', text: 'Clique no botão "Extrair"' },
                    { step: '2', text: 'Aguarde a extração completar' },
                    { step: '3', text: 'Visualize contatos separados por categoria' },
                    { step: '4', text: 'Exporte ou copie os resultados' }
                ],
                tips: [
                    { icon: '📋', text: 'Separa automaticamente normais, arquivados e bloqueados' },
                    { icon: '📊', text: 'Exporta direto para Google Sheets' },
                    { icon: '💾', text: 'Ideal para backup dos seus contatos' }
                ],
                targetElement: '#whlViewExtrator'
            },
            
            // ========== GRUPOS ==========
            {
                id: 'grupos',
                type: 'feature',
                buttonIndex: 2,
                title: '👥 Extrator de Grupos',
                subtitle: 'Extraia membros de qualquer grupo',
                description: 'Selecione um grupo e extraia todos os membros com nome e número. Funciona até com grupos de 1000+ membros.',
                icon: '👥',
                color: '#10b981',
                howTo: [
                    { step: '1', text: 'Clique em "Carregar Grupos"' },
                    { step: '2', text: 'Selecione o grupo desejado' },
                    { step: '3', text: 'Clique em "Extrair Membros"' },
                    { step: '4', text: 'Exporte para CSV ou Google Sheets' }
                ],
                tips: [
                    { icon: '🔍', text: 'Filtre entre grupos ativos e arquivados' },
                    { icon: '⚡', text: 'Funciona com grupos muito grandes' },
                    { icon: '📊', text: 'Exporta com nome e número formatados' }
                ],
                targetElement: '#whlViewGroups'
            },
            
            // ========== RECOVER ==========
            {
                id: 'recover',
                type: 'feature',
                buttonIndex: 3,
                title: '🔄 Recover',
                subtitle: 'Mensagens apagadas e editadas',
                description: 'Visualize mensagens que foram apagadas ou editadas pelos seus contatos em tempo real. Nunca mais perca uma mensagem!',
                icon: '🔄',
                color: '#f59e0b',
                howTo: [
                    { step: '1', text: 'Mantenha o WhatsApp Web aberto' },
                    { step: '2', text: 'Quando alguém apagar uma mensagem...' },
                    { step: '3', text: 'Ela aparece automaticamente aqui!' },
                    { step: '4', text: 'Veja o conteúdo original da mensagem' }
                ],
                tips: [
                    { icon: '⚡', text: 'Funciona em tempo real automaticamente' },
                    { icon: '📝', text: 'Mostra texto original de msgs editadas' },
                    { icon: '💾', text: 'Baixe todas as mensagens recuperadas' }
                ],
                targetElement: '#whlViewRecover'
            },
            
            // ========== CRM ==========
            {
                id: 'crm',
                type: 'feature',
                buttonIndex: 4,
                title: '💼 CRM Integrado',
                subtitle: 'Gestão visual de clientes',
                description: 'Gerencie seus leads e contatos em um Kanban visual. Arraste cards entre colunas, adicione etiquetas coloridas e acompanhe negociações.',
                icon: '💼',
                color: '#ec4899',
                howTo: [
                    { step: '1', text: 'Adicione contatos ao CRM' },
                    { step: '2', text: 'Arraste entre colunas (Novo → Lead → Ganho)' },
                    { step: '3', text: 'Adicione etiquetas para organizar' },
                    { step: '4', text: 'Clique no 📊 para abrir em tela cheia' }
                ],
                tips: [
                    { icon: '🏷️', text: 'Use etiquetas coloridas para categorizar' },
                    { icon: '💰', text: 'Registre valores de negócios' },
                    { icon: '📱', text: 'Abra WhatsApp direto do card' }
                ],
                targetElement: '#whlViewCrm'
            },
            
            // ========== ANALYTICS ==========
            {
                id: 'analytics',
                type: 'feature',
                buttonIndex: 5,
                title: '📊 Analytics',
                subtitle: 'Métricas e estatísticas',
                description: 'Acompanhe o desempenho das suas campanhas com gráficos interativos. Veja taxas de entrega, horários de pico e muito mais.',
                icon: '📊',
                color: '#6366f1',
                howTo: [
                    { step: '1', text: 'Envie campanhas normalmente' },
                    { step: '2', text: 'Acesse a aba Analytics' },
                    { step: '3', text: 'Visualize gráficos e métricas' },
                    { step: '4', text: 'Otimize suas estratégias' }
                ],
                tips: [
                    { icon: '📈', text: 'Gráficos interativos de desempenho' },
                    { icon: '⏰', text: 'Análise de melhores horários' },
                    { icon: '📉', text: 'Taxa de sucesso vs falha' }
                ],
                targetElement: '#whlViewAnalytics'
            },
            
            // ========== TAREFAS ==========
            {
                id: 'tasks',
                type: 'feature',
                buttonIndex: 6,
                title: '📋 Tarefas',
                subtitle: 'Follow-ups e lembretes',
                description: 'Crie tarefas e lembretes vinculados aos seus contatos. Defina prazos, prioridades e nunca mais esqueça um follow-up!',
                icon: '📋',
                color: '#14b8a6',
                howTo: [
                    { step: '1', text: 'Clique em "Nova Tarefa"' },
                    { step: '2', text: 'Defina título, prazo e prioridade' },
                    { step: '3', text: 'Vincule a um contato (opcional)' },
                    { step: '4', text: 'Marque como concluída quando feito' }
                ],
                tips: [
                    { icon: '🔔', text: 'Receba notificações de prazos' },
                    { icon: '🎯', text: 'Defina prioridades (Alta/Média/Baixa)' },
                    { icon: '👤', text: 'Vincule tarefas a contatos do CRM' }
                ],
                targetElement: '#whlViewTasks'
            },
            
            // ========== IA ==========
            {
                id: 'ia',
                type: 'feature',
                buttonIndex: 7,
                title: '🤖 Inteligência Artificial',
                subtitle: 'Respostas inteligentes com IA',
                description: 'Use IA para gerar respostas contextuais, corrigir gramática, traduzir textos e criar mensagens personalizadas automaticamente.',
                icon: '🤖',
                color: '#8b5cf6',
                howTo: [
                    { step: '1', text: 'Configure sua API Key (OpenAI)' },
                    { step: '2', text: 'Escreva um prompt ou pergunta' },
                    { step: '3', text: 'Gere respostas automáticas' },
                    { step: '4', text: 'Copie e use nas conversas' }
                ],
                tips: [
                    { icon: '🔑', text: 'Suporta OpenAI GPT-4 e outros' },
                    { icon: '✏️', text: 'Correção automática de gramática' },
                    { icon: '🌐', text: 'Tradução instantânea de textos' }
                ],
                targetElement: '#whlViewAi'
            },
            
            // ========== CONFIG ==========
            {
                id: 'config',
                type: 'feature',
                buttonIndex: 8,
                title: '⚙️ Configurações',
                subtitle: 'Personalize a extensão',
                description: 'Ajuste delays de envio para evitar bloqueios, configure agendamentos, salve mensagens prontas e muito mais.',
                icon: '⚙️',
                color: '#6b7280',
                howTo: [
                    { step: '1', text: 'Ajuste o delay entre mensagens (anti-ban)' },
                    { step: '2', text: 'Configure agendamentos de envio' },
                    { step: '3', text: 'Salve mensagens prontas como templates' },
                    { step: '4', text: 'Personalize outras preferências' }
                ],
                tips: [
                    { icon: '⏱️', text: 'Delays maiores = menos risco de bloqueio' },
                    { icon: '📅', text: 'Agende disparos para horários específicos' },
                    { icon: '📝', text: 'Templates economizam tempo' }
                ],
                targetElement: '#whlViewConfig'
            },
            
            // ========== BACKUP ==========
            {
                id: 'backup',
                type: 'feature',
                buttonIndex: 9,
                title: '💾 Backup',
                subtitle: 'Salve suas conversas',
                description: 'Faça backup completo das suas conversas importantes. Exporte em HTML ou TXT, incluindo mídias se desejar.',
                icon: '💾',
                color: '#0ea5e9',
                howTo: [
                    { step: '1', text: 'Selecione uma conversa no WhatsApp' },
                    { step: '2', text: 'Escolha o período desejado' },
                    { step: '3', text: 'Inicie o backup' },
                    { step: '4', text: 'Baixe o arquivo gerado' }
                ],
                tips: [
                    { icon: '📁', text: 'Exporta em HTML ou TXT' },
                    { icon: '📷', text: 'Inclui mídias opcionalmente' },
                    { icon: '💼', text: 'Ideal para compliance e registros' }
                ],
                targetElement: '#whlViewBackup'
            },
            
            // ========== HEADER BUTTONS ==========
            {
                id: 'header',
                type: 'header',
                title: '🔝 Botões do Header',
                subtitle: 'Ações rápidas sempre visíveis',
                description: 'No topo do painel lateral você encontra botões de acesso rápido:',
                buttons: [
                    { icon: '📊', name: 'CRM Fullscreen', desc: 'Abre o CRM em uma nova aba com mais espaço' },
                    { icon: '📜', name: 'Histórico', desc: 'Veja o histórico de extrações (Ctrl+H)' }
                ],
                targetElement: '.header-actions'
            },
            
            // ========== CONCLUSÃO ==========
            {
                id: 'conclusion',
                type: 'conclusion',
                title: 'Pronto para começar! 🚀',
                subtitle: 'Você completou o tutorial',
                description: 'Agora você conhece todas as funcionalidades do WhatsHybrid. Explore e potencialize seu WhatsApp!',
                icon: '🎯',
                shortcuts: [
                    { keys: ['Ctrl', 'H'], action: 'Ver histórico de extrações' },
                    { keys: ['📊'], action: 'Abrir CRM em nova aba' },
                    { keys: ['🗕'], action: 'Minimizar painéis no WhatsApp' },
                    { keys: ['ESC'], action: 'Fechar modais' }
                ],
                finalTips: [
                    '💡 Ajuste os delays em Config para evitar bloqueios',
                    '💡 Use etiquetas coloridas para organizar contatos',
                    '💡 Salve mensagens frequentes como templates',
                    '💡 Faça backup periodicamente das conversas importantes'
                ]
            }
        ];
    }
    
    // ==================== INIT ====================
    
    shouldShow() {
        return !localStorage.getItem('whl_onboarding_v4_complete');
    }
    
    start() {
        if (!this.shouldShow()) return;
        console.log('[Onboarding] 🚀 Iniciando tutorial v4...');
        this.currentStep = 0;
        this.createOverlay();
        this.render();
        this.setupKeyboard();
    }
    
    // ==================== OVERLAY ====================
    
    createOverlay() {
        this.destroy();
        
        this.overlay = document.createElement('div');
        this.overlay.id = 'whl-tour';
        this.overlay.className = 'whl-tour';
        this.overlay.innerHTML = `
            <div class="whl-tour-backdrop"></div>
            <div class="whl-tour-card"></div>
        `;
        
        document.body.appendChild(this.overlay);
        document.body.style.overflow = 'hidden';
    }
    
    setupKeyboard() {
        this.keyHandler = (e) => {
            if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.next();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.prev();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.complete();
            }
        };
        document.addEventListener('keydown', this.keyHandler);
    }
    
    // ==================== RENDER ====================
    
    render() {
        if (this.isAnimating) return;
        this.isAnimating = true;
        
        const step = this.steps[this.currentStep];
        const card = this.overlay.querySelector('.whl-tour-card');
        
        // Enviar highlight para o WhatsApp Web (content script)
        this.sendHighlightToWhatsApp(step);
        
        // Fade out
        card.classList.add('exit');
        
        setTimeout(() => {
            // Render content
            card.innerHTML = this.renderStep(step);
            card.classList.remove('exit');
            card.classList.add('enter');
            
            // Setup events
            this.setupEvents();
            
            setTimeout(() => {
                card.classList.remove('enter');
                this.isAnimating = false;
            }, 500);
        }, 300);
    }
    
    // Envia mensagem para o content script no WhatsApp Web
    sendHighlightToWhatsApp(step) {
        try {
            // Se é um step de feature, enviar o índice do botão
            if (step.type === 'feature' && step.buttonIndex !== undefined) {
                chrome.runtime.sendMessage({
                    action: 'WHL_ONBOARDING_HIGHLIGHT',
                    buttonIndex: step.buttonIndex,
                    show: true
                });
            } else {
                // Outros steps - remover highlight
                chrome.runtime.sendMessage({
                    action: 'WHL_ONBOARDING_HIGHLIGHT',
                    buttonIndex: null,
                    show: false
                });
            }
        } catch (e) {
            console.log('[Onboarding] Não foi possível enviar highlight:', e);
        }
    }
    
    // Remove highlight do WhatsApp Web
    removeHighlightFromWhatsApp() {
        try {
            chrome.runtime.sendMessage({
                action: 'WHL_ONBOARDING_HIGHLIGHT',
                buttonIndex: null,
                show: false
            });
        } catch (e) {
            // Silencioso
        }
    }
    
    renderStep(step) {
        const progress = ((this.currentStep + 1) / this.steps.length) * 100;
        
        let html = `
            <div class="whl-tour-header">
                <div class="whl-tour-progress">
                    <div class="whl-tour-progress-fill" style="width: ${progress}%"></div>
                </div>
                <span class="whl-tour-counter">${this.currentStep + 1}/${this.steps.length}</span>
                <button class="whl-tour-skip" data-action="skip">Pular tutorial ✕</button>
            </div>
        `;
        
        // Conteúdo específico por tipo
        switch (step.type) {
            case 'welcome':
                html += this.renderWelcome(step);
                break;
            case 'toppanel':
                html += this.renderTopPanel(step);
                break;
            case 'feature':
                html += this.renderFeature(step);
                break;
            case 'header':
                html += this.renderHeader(step);
                break;
            case 'conclusion':
                html += this.renderConclusion(step);
                break;
        }
        
        // Navegação
        html += this.renderNavigation();
        
        return html;
    }
    
    // ==================== RENDER TYPES ====================
    
    renderWelcome(step) {
        return `
            <div class="whl-tour-icon bounce">${step.icon}</div>
            <h2 class="whl-tour-title">${step.title}</h2>
            <p class="whl-tour-subtitle">${step.subtitle}</p>
            <p class="whl-tour-desc">${step.description}</p>
            
            <div class="whl-tour-features">
                ${step.features.map(f => `
                    <div class="whl-tour-feature">
                        <div class="feature-icon">${f.icon}</div>
                        <div class="feature-info">
                            <div class="feature-name">${f.name}</div>
                            <div class="feature-desc">${f.desc}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    renderTopPanel(step) {
        return `
            <div class="whl-tour-icon">${'🎛️'}</div>
            <h2 class="whl-tour-title">${step.title}</h2>
            <p class="whl-tour-subtitle">${step.subtitle}</p>
            <p class="whl-tour-desc">${step.description}</p>
            
            <div class="whl-tour-panel-mock">
                <div class="panel-mock-header">
                    <span class="panel-mock-logo">🟢 WhatsHybrid</span>
                </div>
                <div class="panel-mock-buttons">
                    ${step.buttons.map((btn, i) => `
                        <div class="panel-mock-btn" style="--btn-color: ${btn.color}" data-index="${i}">
                            <span class="btn-icon">${btn.icon}</span>
                            <span class="btn-label">${btn.label}</span>
                            <div class="btn-pulse"></div>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="whl-tour-hint">
                <span class="hint-arrow">👆</span>
                <span>Clique em cada botão para acessar as funcionalidades</span>
            </div>
        `;
    }
    
    renderFeature(step) {
        // Lista de todos os botões do Top Panel
        const allButtons = [
            { icon: '📨', label: 'Disparo', color: '#8b5cf6' },
            { icon: '📥', label: 'Extrator', color: '#3b82f6' },
            { icon: '👥', label: 'Grupos', color: '#10b981' },
            { icon: '🔄', label: 'Recover', color: '#f59e0b' },
            { icon: '💼', label: 'CRM', color: '#ec4899' },
            { icon: '📊', label: 'Analytics', color: '#6366f1' },
            { icon: '📋', label: 'Tarefas', color: '#14b8a6' },
            { icon: '🤖', label: 'IA', color: '#8b5cf6' },
            { icon: '⚙️', label: 'Config', color: '#6b7280' },
            { icon: '💾', label: 'Backup', color: '#0ea5e9' }
        ];
        
        const highlightIndex = step.buttonIndex;
        
        return `
            <div class="whl-tour-icon">${step.icon}</div>
            <h2 class="whl-tour-title">${step.title}</h2>
            <p class="whl-tour-subtitle">${step.subtitle}</p>
            
            <!-- Mock do Top Panel com botão destacado -->
            <div class="whl-tour-toppanel-indicator">
                <div class="toppanel-label">
                    <span class="label-icon">🎛️</span>
                    <span>No WhatsApp Web, clique neste botão:</span>
                </div>
                <div class="toppanel-mock-mini">
                    ${allButtons.map((btn, i) => `
                        <div class="toppanel-btn-mini ${i === highlightIndex ? 'highlighted' : ''}" 
                             style="--btn-color: ${btn.color}">
                            <span class="btn-icon">${btn.icon}</span>
                            <span class="btn-label">${btn.label}</span>
                            ${i === highlightIndex ? `
                                <div class="btn-highlight-ring"></div>
                                <div class="btn-arrow-indicator">
                                    <span class="arrow-pointer">⬆️</span>
                                    <span class="arrow-text">Clique aqui!</span>
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <p class="whl-tour-desc">${step.description}</p>
            
            <div class="whl-tour-howto">
                <div class="howto-title">📝 Como usar:</div>
                ${step.howTo.map(h => `
                    <div class="howto-step">
                        <span class="step-num">${h.step}</span>
                        <span class="step-text">${h.text}</span>
                    </div>
                `).join('')}
            </div>
            
            <div class="whl-tour-tips">
                ${step.tips.map(t => `
                    <div class="tour-tip">
                        <span class="tip-icon">${t.icon}</span>
                        <span class="tip-text">${t.text}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    renderHeader(step) {
        return `
            <div class="whl-tour-icon">${'🔝'}</div>
            <h2 class="whl-tour-title">${step.title}</h2>
            <p class="whl-tour-subtitle">${step.subtitle}</p>
            <p class="whl-tour-desc">${step.description}</p>
            
            <!-- Mock do Header do Sidepanel -->
            <div class="whl-tour-header-mock">
                <div class="header-mock-left">
                    <span class="header-mock-logo">🟢</span>
                    <span class="header-mock-title">WhatsHybrid</span>
                </div>
                <div class="header-mock-right">
                    ${step.buttons.map(btn => `
                        <div class="header-mock-btn highlighted">
                            <span>${btn.icon}</span>
                            <div class="header-btn-tooltip">${btn.name}</div>
                        </div>
                    `).join('')}
                    <span class="header-mock-version">v6.9</span>
                </div>
            </div>
            
            <div class="whl-tour-header-btns">
                ${step.buttons.map(btn => `
                    <div class="header-btn-item">
                        <div class="header-btn-icon">${btn.icon}</div>
                        <div class="header-btn-info">
                            <div class="header-btn-name">${btn.name}</div>
                            <div class="header-btn-desc">${btn.desc}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    renderConclusion(step) {
        return `
            <div class="whl-tour-icon celebration">${step.icon}</div>
            <h2 class="whl-tour-title">${step.title}</h2>
            <p class="whl-tour-subtitle">${step.subtitle}</p>
            <p class="whl-tour-desc">${step.description}</p>
            
            <div class="whl-tour-shortcuts">
                <div class="shortcuts-title">⌨️ Atalhos úteis:</div>
                ${step.shortcuts.map(s => `
                    <div class="shortcut-item">
                        <div class="shortcut-keys">
                            ${s.keys.map(k => `<kbd>${k}</kbd>`).join(' + ')}
                        </div>
                        <div class="shortcut-action">${s.action}</div>
                    </div>
                `).join('')}
            </div>
            
            <div class="whl-tour-final-tips">
                ${step.finalTips.map(t => `
                    <div class="final-tip">${t}</div>
                `).join('')}
            </div>
            
            <div class="whl-tour-confetti">🎉</div>
        `;
    }
    
    // ==================== NAVIGATION ====================
    
    renderNavigation() {
        return `
            <div class="whl-tour-dots">
                ${this.steps.map((_, i) => `
                    <span class="whl-tour-dot ${i === this.currentStep ? 'active' : ''} ${i < this.currentStep ? 'done' : ''}" data-step="${i}"></span>
                `).join('')}
            </div>
            
            <div class="whl-tour-buttons">
                ${this.currentStep > 0 ? `
                    <button class="whl-tour-btn secondary" data-action="prev">
                        ← Anterior
                    </button>
                ` : '<div></div>'}
                <button class="whl-tour-btn primary" data-action="next">
                    ${this.currentStep === this.steps.length - 1 ? '🚀 Começar!' : 'Próximo →'}
                </button>
            </div>
            
            <div class="whl-tour-keyboard">
                Use <kbd>←</kbd> <kbd>→</kbd> ou <kbd>Enter</kbd> para navegar • <kbd>ESC</kbd> para sair
            </div>
        `;
    }
    
    // ==================== EVENTS ====================
    
    setupEvents() {
        // Skip
        this.overlay.querySelector('[data-action="skip"]')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.complete();
        });
        
        // Prev/Next
        this.overlay.querySelectorAll('[data-action]').forEach(btn => {
            if (btn.dataset.action === 'prev') {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.prev();
                });
            } else if (btn.dataset.action === 'next') {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.next();
                });
            }
        });
        
        // Dots
        this.overlay.querySelectorAll('.whl-tour-dot').forEach(dot => {
            dot.addEventListener('click', (e) => {
                e.preventDefault();
                const step = parseInt(dot.dataset.step);
                if (!isNaN(step)) {
                    this.currentStep = step;
                    this.render();
                }
            });
        });
        
        // Panel buttons hover effect
        this.overlay.querySelectorAll('.panel-mock-btn').forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.classList.add('highlight');
            });
            btn.addEventListener('mouseleave', () => {
                btn.classList.remove('highlight');
            });
        });
    }
    
    // ==================== NAVIGATION ACTIONS ====================
    
    next() {
        if (this.currentStep < this.steps.length - 1) {
            this.currentStep++;
            this.render();
        } else {
            this.complete();
        }
    }
    
    prev() {
        if (this.currentStep > 0) {
            this.currentStep--;
            this.render();
        }
    }
    
    complete() {
        console.log('[Onboarding] ✅ Tutorial concluído!');
        localStorage.setItem('whl_onboarding_v4_complete', 'true');
        localStorage.setItem('whl_onboarding_v4_date', new Date().toISOString());
        
        // Remover highlight do WhatsApp Web
        this.removeHighlightFromWhatsApp();
        
        // Animação de saída
        this.overlay.classList.add('exit');
        
        setTimeout(() => {
            this.destroy();
            this.showCompletionToast();
        }, 500);
    }
    
    destroy() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
        }
        document.body.style.overflow = '';
    }
    
    showCompletionToast() {
        const toast = document.createElement('div');
        toast.className = 'whl-tour-toast';
        toast.innerHTML = `
            <div class="toast-icon">🎉</div>
            <div class="toast-content">
                <strong>Tutorial concluído!</strong>
                <p>Você está pronto para usar o WhatsHybrid.</p>
            </div>
            <button class="toast-close">✕</button>
        `;
        
        document.body.appendChild(toast);
        
        requestAnimationFrame(() => {
            toast.classList.add('visible');
        });
        
        const close = () => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 300);
        };
        
        toast.querySelector('.toast-close').addEventListener('click', close);
        setTimeout(close, 5000);
    }
    
    // ==================== RESET ====================
    
    reset() {
        localStorage.removeItem('whl_onboarding_v4_complete');
        localStorage.removeItem('whl_onboarding_v4_date');
        console.log('[Onboarding] Reset realizado. Recarregue a página.');
    }
}

// Exportar globalmente
if (typeof window !== 'undefined') {
    window.OnboardingSystem = OnboardingSystem;
    window.resetOnboarding = () => {
        const ob = new OnboardingSystem();
        ob.reset();
    };
}
