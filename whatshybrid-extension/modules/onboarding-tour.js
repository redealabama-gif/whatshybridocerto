/**
 * 🎓 Onboarding Tour v2.0
 * Tour de inicialização do WhatsHybrid
 * 
 * @version 2.0.0
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'whl_onboarding_completed';
  const VERSION = '2.0.0';

  // ============================================
  // SLIDES DO TOUR
  // ============================================

  const TOUR_SLIDES = [
    {
      id: 'welcome',
      title: '🚀 Bem-vindo ao WhatsHybrid!',
      content: `
        <p>O sistema mais completo para <strong>automatizar e potencializar</strong> seu WhatsApp.</p>
        <p style="margin-top: 16px;">Vamos conhecer todas as funcionalidades?</p>
      `,
      icon: '🎉'
    },
    {
      id: 'subscription',
      title: '🔑 Ativação',
      content: `
        <p>Insira seu <strong>código de assinatura</strong> no campo "Assinatura" no topo da tela.</p>
        <ul style="margin-top: 12px; text-align: left;">
          <li>✅ Plano Starter: 100 créditos/mês</li>
          <li>✅ Plano Pro: 500 créditos/mês</li>
          <li>✅ Plano Enterprise: 2000 créditos/mês</li>
        </ul>
        <p style="margin-top: 12px; color: #10b981;">Sem código? Você tem 7 dias de teste grátis!</p>
      `,
      icon: '🔐'
    },
    {
      id: 'ai-copilot',
      title: '🤖 IA Copilot',
      content: `
        <p><strong>Inteligência Artificial</strong> que aprende com seu estilo de atendimento.</p>
        <ul style="margin-top: 12px; text-align: left;">
          <li>💬 <strong>Sugestões inteligentes</strong> - Respostas baseadas no contexto</li>
          <li>🎯 <strong>Copilot automático</strong> - Responde sozinho (quando ativado)</li>
          <li>📚 <strong>Aprendizado contínuo</strong> - Melhora a cada conversa</li>
          <li>🧠 <strong>Memória de clientes</strong> - Lembra preferências e histórico</li>
        </ul>
      `,
      icon: '🤖'
    },
    {
      id: 'ai-training',
      title: '🎓 Treinamento da IA',
      content: `
        <p>Ensine a IA a responder como <strong>você</strong> responderia.</p>
        <ul style="margin-top: 12px; text-align: left;">
          <li>📝 <strong>Exemplos de perguntas/respostas</strong></li>
          <li>❓ <strong>FAQs do seu negócio</strong></li>
          <li>📦 <strong>Catálogo de produtos</strong></li>
          <li>🏢 <strong>Informações da empresa</strong></li>
          <li>🧪 <strong>Simulação neural</strong> - Teste a IA antes de usar</li>
        </ul>
        <p style="margin-top: 12px;">Clique no botão "🎓 Treinamento IA" para acessar.</p>
      `,
      icon: '📚'
    },
    {
      id: 'quick-replies',
      title: '⚡ Resposta Rápida',
      content: `
        <p>Configure <strong>atalhos</strong> para suas respostas mais usadas.</p>
        <ul style="margin-top: 12px; text-align: left;">
          <li>Digite <code>/saudacao</code> → "Olá! Como posso ajudar?"</li>
          <li>Digite <code>/preco</code> → Lista de preços</li>
          <li>Digite <code>/horario</code> → Horário de funcionamento</li>
        </ul>
        <p style="margin-top: 12px;">Acesse pelo painel lateral ou pelo botão no topo.</p>
      `,
      icon: '⚡'
    },
    {
      id: 'campaigns',
      title: '📢 Campanhas & Disparos',
      content: `
        <p>Envie mensagens em massa com <strong>proteção anti-ban</strong>.</p>
        <ul style="margin-top: 12px; text-align: left;">
          <li>📊 <strong>Importar contatos</strong> via CSV ou Excel</li>
          <li>⏱️ <strong>Agendamento</strong> de envios</li>
          <li>🎲 <strong>Variações</strong> de mensagem (anti-detecção)</li>
          <li>📈 <strong>Relatórios</strong> de entrega</li>
          <li>🛡️ <strong>Delay inteligente</strong> entre mensagens</li>
        </ul>
      `,
      icon: '📢'
    },
    {
      id: 'crm',
      title: '👥 CRM Integrado',
      content: `
        <p>Gerencie seus <strong>contatos e negócios</strong> diretamente no WhatsApp.</p>
        <ul style="margin-top: 12px; text-align: left;">
          <li>📇 <strong>Contatos</strong> com notas e etiquetas</li>
          <li>💼 <strong>Pipeline de vendas</strong> (Kanban)</li>
          <li>📝 <strong>Tarefas</strong> e lembretes</li>
          <li>🏷️ <strong>Etiquetas</strong> personalizadas</li>
        </ul>
        <p style="margin-top: 12px;">Clique no botão "📊 CRM" para acessar.</p>
      `,
      icon: '👥'
    },
    {
      id: 'recover',
      title: '🔄 Recover',
      content: `
        <p>Recupere mensagens <strong>apagadas ou editadas</strong> automaticamente.</p>
        <ul style="margin-top: 12px; text-align: left;">
          <li>👁️ Ver mensagens que foram apagadas</li>
          <li>📝 Ver versão original de mensagens editadas</li>
          <li>📥 Baixar mídia (fotos, vídeos, áudios)</li>
          <li>🔔 Notificações quando alguém apaga mensagem</li>
        </ul>
      `,
      icon: '🔄'
    },
    {
      id: 'team',
      title: '👨‍👩‍👧‍👦 Sistema de Equipe',
      content: `
        <p>Gerencie sua <strong>equipe</strong> e envie mensagens em grupo.</p>
        <ul style="margin-top: 12px; text-align: left;">
          <li>👥 Adicionar membros da equipe</li>
          <li>📨 Enviar mensagem para selecionados</li>
          <li>📢 Broadcast para toda equipe</li>
        </ul>
      `,
      icon: '👨‍👩‍👧‍👦'
    },
    {
      id: 'analytics',
      title: '📊 Analytics',
      content: `
        <p>Acompanhe <strong>métricas e estatísticas</strong> do seu atendimento.</p>
        <ul style="margin-top: 12px; text-align: left;">
          <li>📈 Mensagens enviadas/recebidas</li>
          <li>⏱️ Tempo médio de resposta</li>
          <li>🏆 Melhores horários de engajamento</li>
          <li>📊 Performance de campanhas</li>
        </ul>
      `,
      icon: '📊'
    },
    {
      id: 'shortcuts',
      title: '⌨️ Atalhos Úteis',
      content: `
        <p>Use o <strong>painel lateral</strong> para acessar tudo rapidamente.</p>
        <table style="width: 100%; margin-top: 12px; text-align: left;">
          <tr><td>📊 CRM</td><td>Clique no botão CRM</td></tr>
          <tr><td>🎓 Treinamento</td><td>Clique no botão Treinamento IA</td></tr>
          <tr><td>⚡ Respostas</td><td>Digite / no chat</td></tr>
          <tr><td>🤖 Sugestão IA</td><td>Clique no ícone de IA</td></tr>
        </table>
      `,
      icon: '⌨️'
    },
    {
      id: 'support',
      title: '❓ Suporte',
      content: `
        <p>Precisa de ajuda? Estamos aqui!</p>
        <ul style="margin-top: 12px; text-align: left;">
          <li>📧 suporte@whatshybrid.com</li>
          <li>💬 WhatsApp: (XX) XXXXX-XXXX</li>
          <li>📖 Documentação online</li>
        </ul>
        <p style="margin-top: 16px; color: #8b5cf6; font-weight: 600;">
          Aproveite o WhatsHybrid! 🚀
        </p>
      `,
      icon: '❓'
    }
  ];

  // ============================================
  // ESTADO
  // ============================================

  let state = {
    currentSlide: 0,
    isOpen: false
  };

  // ============================================
  // UI
  // ============================================

  function createTourUI() {
    // Verificar se já existe
    if (document.getElementById('whl-tour-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'whl-tour-overlay';
    overlay.innerHTML = `
      <style>
        #whl-tour-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.85);
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          visibility: hidden;
          transition: all 0.3s ease;
        }
        
        #whl-tour-overlay.active {
          opacity: 1;
          visibility: visible;
        }
        
        .whl-tour-modal {
          background: linear-gradient(145deg, #1a1a2e, #16213e);
          border: 1px solid rgba(139, 92, 246, 0.3);
          border-radius: 24px;
          width: 90%;
          max-width: 520px;
          padding: 40px;
          text-align: center;
          box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
          transform: translateY(20px);
          transition: all 0.3s ease;
        }
        
        #whl-tour-overlay.active .whl-tour-modal {
          transform: translateY(0);
        }
        
        .whl-tour-icon {
          font-size: 64px;
          margin-bottom: 20px;
        }
        
        .whl-tour-title {
          font-size: 24px;
          font-weight: 700;
          color: #fff;
          margin-bottom: 16px;
        }
        
        .whl-tour-content {
          color: rgba(255, 255, 255, 0.8);
          font-size: 15px;
          line-height: 1.6;
          margin-bottom: 32px;
        }
        
        .whl-tour-content ul {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        
        .whl-tour-content li {
          padding: 6px 0;
        }
        
        .whl-tour-content code {
          background: rgba(139, 92, 246, 0.2);
          padding: 2px 8px;
          border-radius: 4px;
          font-family: monospace;
        }
        
        .whl-tour-content table {
          border-collapse: collapse;
        }
        
        .whl-tour-content td {
          padding: 8px 12px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        
        .whl-tour-dots {
          display: flex;
          justify-content: center;
          gap: 8px;
          margin-bottom: 24px;
        }
        
        .whl-tour-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.3);
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .whl-tour-dot.active {
          background: #8b5cf6;
          width: 24px;
          border-radius: 4px;
        }
        
        .whl-tour-buttons {
          display: flex;
          gap: 12px;
          justify-content: center;
        }
        
        .whl-tour-btn {
          padding: 12px 28px;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }
        
        .whl-tour-btn-secondary {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }
        
        .whl-tour-btn-secondary:hover {
          background: rgba(255, 255, 255, 0.15);
        }
        
        .whl-tour-btn-primary {
          background: linear-gradient(135deg, #8b5cf6, #3b82f6);
          color: #fff;
        }
        
        .whl-tour-btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(139, 92, 246, 0.3);
        }
        
        .whl-tour-skip {
          position: absolute;
          top: 20px;
          right: 20px;
          color: rgba(255, 255, 255, 0.5);
          font-size: 13px;
          cursor: pointer;
          transition: color 0.2s;
        }
        
        .whl-tour-skip:hover {
          color: #fff;
        }
        
        .whl-tour-progress {
          position: absolute;
          bottom: 0;
          left: 0;
          height: 4px;
          background: linear-gradient(90deg, #8b5cf6, #3b82f6);
          border-radius: 0 0 24px 24px;
          transition: width 0.3s ease;
        }
      </style>
      
      <div class="whl-tour-modal" style="position: relative;">
        <span class="whl-tour-skip" onclick="window.OnboardingTour.close()">Pular tour ✕</span>
        
        <div class="whl-tour-icon" id="whl-tour-icon">🚀</div>
        <h2 class="whl-tour-title" id="whl-tour-title">Bem-vindo!</h2>
        <div class="whl-tour-content" id="whl-tour-content">Conteúdo aqui</div>
        
        <div class="whl-tour-dots" id="whl-tour-dots"></div>
        
        <div class="whl-tour-buttons">
          <button class="whl-tour-btn whl-tour-btn-secondary" id="whl-tour-prev" onclick="window.OnboardingTour.prev()">← Anterior</button>
          <button class="whl-tour-btn whl-tour-btn-primary" id="whl-tour-next" onclick="window.OnboardingTour.next()">Próximo →</button>
        </div>
        
        <div class="whl-tour-progress" id="whl-tour-progress" style="width: 0%;"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    
    // Criar dots
    const dotsContainer = document.getElementById('whl-tour-dots');
    TOUR_SLIDES.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = 'whl-tour-dot' + (i === 0 ? ' active' : '');
      dot.onclick = () => goToSlide(i);
      dotsContainer.appendChild(dot);
    });
  }

  function updateUI() {
    const slide = TOUR_SLIDES[state.currentSlide];
    
    document.getElementById('whl-tour-icon').textContent = slide.icon;
    document.getElementById('whl-tour-title').textContent = slide.title;
    document.getElementById('whl-tour-content').innerHTML = slide.content;
    
    // Atualizar dots
    document.querySelectorAll('.whl-tour-dot').forEach((dot, i) => {
      dot.className = 'whl-tour-dot' + (i === state.currentSlide ? ' active' : '');
    });
    
    // Atualizar botões
    const prevBtn = document.getElementById('whl-tour-prev');
    const nextBtn = document.getElementById('whl-tour-next');
    
    prevBtn.style.visibility = state.currentSlide === 0 ? 'hidden' : 'visible';
    
    if (state.currentSlide === TOUR_SLIDES.length - 1) {
      nextBtn.textContent = 'Começar! 🚀';
      nextBtn.onclick = () => complete();
    } else {
      nextBtn.textContent = 'Próximo →';
      nextBtn.onclick = () => next();
    }
    
    // Atualizar progresso
    const progress = ((state.currentSlide + 1) / TOUR_SLIDES.length) * 100;
    document.getElementById('whl-tour-progress').style.width = `${progress}%`;
  }

  // ============================================
  // NAVEGAÇÃO
  // ============================================

  function next() {
    if (state.currentSlide < TOUR_SLIDES.length - 1) {
      state.currentSlide++;
      updateUI();
    }
  }

  function prev() {
    if (state.currentSlide > 0) {
      state.currentSlide--;
      updateUI();
    }
  }

  function goToSlide(index) {
    state.currentSlide = index;
    updateUI();
  }

  function open() {
    createTourUI();
    state.currentSlide = 0;
    state.isOpen = true;
    updateUI();
    
    setTimeout(() => {
      document.getElementById('whl-tour-overlay').classList.add('active');
    }, 10);
  }

  function close() {
    const overlay = document.getElementById('whl-tour-overlay');
    if (overlay) {
      overlay.classList.remove('active');
      setTimeout(() => {
        overlay.remove();
      }, 300);
    }
    state.isOpen = false;
  }

  function complete() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      completed: true,
      version: VERSION,
      completedAt: Date.now()
    }));
    close();
    
    // Mostrar notificação
    if (window.EventBus) {
      window.EventBus.emit(window.WHL_EVENTS.UI_NOTIFICATION, {
        type: 'success',
        title: 'Pronto!',
        message: 'Você está pronto para usar o WhatsHybrid!'
      });
    }
  }

  // ============================================
  // CHECK SE DEVE MOSTRAR
  // ============================================

  function shouldShowTour() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return true;
      
      const data = JSON.parse(saved);
      
      // Mostrar novamente se versão diferente (novas features)
      if (data.version !== VERSION) return true;
      
      return false;
    } catch {
      return true;
    }
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  function init() {
    // Aguardar um pouco para o WhatsApp carregar
    setTimeout(() => {
      if (shouldShowTour()) {
        open();
      }
    }, 3000);
  }

  // ============================================
  // EXPORT
  // ============================================

  window.OnboardingTour = {
    open,
    close,
    next,
    prev,
    goToSlide,
    complete,
    reset,
    init,
    shouldShowTour,
    VERSION
  };

  console.log('[Onboarding] 🎓 Tour carregado');

})();
