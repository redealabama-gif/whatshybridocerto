/**
 * WhatsHybrid Onboarding Tour — v9.0.0
 *
 * Tour interativo de 5 steps no dashboard pra novos usuários.
 * Sem dependências externas — implementação manual leve.
 *
 * Trigger: aparece se onboarding_completed = false na conta do user.
 * Skip: usuário pode pular a qualquer momento (salva como completo).
 */

(function() {
  'use strict';

  const STEPS = [
    {
      title: '👋 Bem-vindo ao WhatsHybrid Pro!',
      content: 'Vamos configurar sua IA em 3 minutos. Pula só se você já é veterano.',
      target: null,
      placement: 'center',
      cta: 'Começar tour',
    },
    {
      title: '1. Instale a extensão Chrome',
      content: 'A extensão é o que conecta a IA ao seu WhatsApp Web. Clique em "Extensão Chrome" no menu.',
      target: '[data-tab="extension"]',
      placement: 'right',
      action: () => switchTab('extension'),
      cta: 'Próximo',
    },
    {
      title: '2. Configure tom e setor',
      content: 'A IA precisa saber como falar. Define tom de voz e o nicho do seu negócio na aba "Inteligência Artificial".',
      target: '[data-tab="ai"]',
      placement: 'right',
      action: () => switchTab('ai'),
      cta: 'Próximo',
    },
    {
      title: '3. Adicione FAQ na base de conhecimento',
      content: 'Cole horário, endereço, regras de troca, FAQ. A IA usa isso pra responder com precisão. Quanto mais info, melhor.',
      target: '#ai-knowledge-base',
      placement: 'top',
      cta: 'Próximo',
    },
    {
      title: '4. Teste antes de ativar',
      content: 'Sempre teste com 5-10 mensagens reais antes de ativar a resposta automática. Use o botão "Testar IA".',
      target: '#ai-test-btn',
      placement: 'top',
      cta: 'Próximo',
    },
    {
      title: '🎉 Pronto!',
      content: 'Você está configurado. Agora abra web.whatsapp.com (com a extensão instalada) e teste com mensagens reais.',
      target: null,
      placement: 'center',
      cta: 'Concluir',
    },
  ];

  function switchTab(tabName) {
    const btn = document.querySelector(`[data-tab="${tabName}"]`);
    if (btn) btn.click();
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  let currentStep = 0;

  function renderStep() {
    const step = STEPS[currentStep];
    if (!step) return cleanup();

    const overlay = document.getElementById('whl-onboarding-overlay') ||
      createOverlay();
    const popover = document.getElementById('whl-onboarding-popover') ||
      createPopover();

    // Spotlight
    const spotlight = document.getElementById('whl-onboarding-spotlight');
    if (step.target) {
      const target = document.querySelector(step.target);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const r = target.getBoundingClientRect();
        spotlight.style.cssText = `
          position: fixed; pointer-events: none; z-index: 99998;
          left: ${r.left - 8}px; top: ${r.top - 8}px;
          width: ${r.width + 16}px; height: ${r.height + 16}px;
          border: 3px solid #00ffff; border-radius: 12px;
          box-shadow: 0 0 0 9999px rgba(0,0,0,0.7),
                      0 0 30px rgba(0,255,255,0.6);
          animation: pulseGlow 2s infinite;
        `;
      }
    } else {
      spotlight.style.cssText = 'display: none;';
    }

    // Popover content (textContent / sanitizado)
    popover.innerHTML = `
      <div class="whl-onb-header">
        <div class="whl-onb-progress">${currentStep + 1} / ${STEPS.length}</div>
        <button class="whl-onb-close" type="button" aria-label="Fechar">×</button>
      </div>
      <h3 class="whl-onb-title"></h3>
      <p class="whl-onb-content"></p>
      <div class="whl-onb-buttons">
        <button class="whl-onb-skip" type="button">Pular tour</button>
        <button class="whl-onb-next" type="button"></button>
      </div>
    `;

    popover.querySelector('.whl-onb-title').textContent = step.title;
    popover.querySelector('.whl-onb-content').textContent = step.content;
    popover.querySelector('.whl-onb-next').textContent = step.cta;

    popover.querySelector('.whl-onb-close').onclick = skip;
    popover.querySelector('.whl-onb-skip').onclick = skip;
    popover.querySelector('.whl-onb-next').onclick = next;
  }

  function createOverlay() {
    const o = document.createElement('div');
    o.id = 'whl-onboarding-overlay';
    o.innerHTML = `<div id="whl-onboarding-spotlight"></div>`;
    document.body.appendChild(o);

    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulseGlow {
        0%, 100% { box-shadow: 0 0 0 9999px rgba(0,0,0,0.7), 0 0 30px rgba(0,255,255,0.6); }
        50%      { box-shadow: 0 0 0 9999px rgba(0,0,0,0.75), 0 0 50px rgba(0,255,255,0.9); }
      }
      #whl-onboarding-popover {
        position: fixed; bottom: 32px; right: 32px;
        z-index: 99999; max-width: 420px; padding: 24px;
        background: linear-gradient(135deg, #0f0c29, #131129);
        border: 1px solid rgba(111,0,255,0.4);
        border-radius: 12px; color: #fff;
        font-family: 'Inter', -apple-system, sans-serif;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      }
      .whl-onb-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .whl-onb-progress { font-size: 0.75rem; color: #00ffff; font-weight: 600; }
      .whl-onb-close { background: none; border: 0; color: #fff; font-size: 24px; cursor: pointer; padding: 0; line-height: 1; }
      .whl-onb-title { font-size: 1.15rem; margin: 0 0 8px; color: #fff; font-weight: 700; }
      .whl-onb-content { font-size: 0.95rem; line-height: 1.5; color: #cbd5e1; margin-bottom: 16px; }
      .whl-onb-buttons { display: flex; gap: 8px; justify-content: flex-end; }
      .whl-onb-skip {
        background: transparent; color: #94a3b8;
        border: 1px solid rgba(255,255,255,0.1);
        padding: 8px 16px; border-radius: 8px;
        cursor: pointer; font-size: 0.85rem;
      }
      .whl-onb-next {
        background: linear-gradient(135deg, #6f00ff, #00ffff);
        color: #000; border: 0;
        padding: 8px 18px; border-radius: 8px;
        cursor: pointer; font-weight: 600; font-size: 0.9rem;
      }
      @media (max-width: 600px) {
        #whl-onboarding-popover { left: 16px; right: 16px; max-width: none; bottom: 16px; }
      }
    `;
    document.head.appendChild(style);
    return o;
  }

  function createPopover() {
    const p = document.createElement('div');
    p.id = 'whl-onboarding-popover';
    document.body.appendChild(p);
    return p;
  }

  function next() {
    const step = STEPS[currentStep];
    if (step.action) {
      try { step.action(); } catch(_) {}
    }
    currentStep++;
    if (currentStep < STEPS.length) {
      setTimeout(renderStep, 300); // dá tempo pra tab trocar antes de scroll
    } else {
      complete();
    }
  }

  async function skip() { complete(); }

  async function complete() {
    cleanup();
    try {
      if (window.api && typeof window.api.post === 'function') {
        await window.api.post('/api/v1/me/onboarding-complete');
      }
    } catch(_) {}
  }

  function cleanup() {
    document.getElementById('whl-onboarding-overlay')?.remove();
    document.getElementById('whl-onboarding-popover')?.remove();
  }

  // Bootstrap: roda só se usuário não completou
  async function init() {
    try {
      if (!window.api || typeof window.api.get !== 'function') return;
      const r = await window.api.get('/api/v1/me/onboarding-status');
      if (r && !r.completed) {
        // Espera 1.5s pro dashboard carregar
        setTimeout(renderStep, 1500);
      }
    } catch(_) { /* não autenticado, ou erro — segue sem onboarding */ }
  }

  // Auto-start quando DOM está pronto e api disponível
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 500));
  } else {
    setTimeout(init, 500);
  }

  // Expose pra debugging / re-trigger manual
  window.WHL_Onboarding = { start: () => { currentStep = 0; renderStep(); } };
})();
