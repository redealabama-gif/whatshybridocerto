/**
 * Plan gate for the training page.
 *
 * Antes este código estava inline em training.html, mas inline scripts violam
 * a CSP da extensão (MV3 — script-src 'self'). O console mostrava:
 *   "Executing inline script violates Content Security Policy directive"
 * e o gate nunca rodava, deixando o app inicializar mesmo pra plano free.
 * Extraído pra arquivo dedicado pra obedecer a CSP.
 *
 * Função: lê snapshot de assinatura do chrome.storage.local. Se plano = free
 * ou trial expirado, esconde o app e mostra tela de upsell. Roda ANTES do
 * training.js inicializar pra evitar flash da UI.
 */
(function gateTrainingByPlan() {
  const STORAGE_KEY = 'whl_subscription';

  function renderUpsell(reason) {
    const container = document.querySelector('.training-app') ||
                      document.getElementById('app') ||
                      document.body.firstElementChild;
    if (container) container.style.display = 'none';

    const upsell = document.createElement('div');
    upsell.id = 'whl-training-upsell';
    upsell.style.cssText = [
      'position: fixed; inset: 0;',
      'display: flex; align-items: center; justify-content: center;',
      'background: linear-gradient(135deg, #0f0c29 0%, #1a1142 100%);',
      'color: #fff; font-family: \'Inter\', system-ui, sans-serif;',
      'z-index: 99999; padding: 24px;'
    ].join(' ');

    const isTrialExpired = reason === 'trial_expired';
    const title = isTrialExpired
      ? '⏰ Seu trial terminou'
      : '🎓 Treinamento de IA requer plano pago';
    const msg = isTrialExpired
      ? 'O período de avaliação acabou. Pra continuar treinando a IA com seus FAQs, produtos e exemplos, ative um plano.'
      : 'No plano gratuito você não tem acesso ao Treinamento de IA. Faça upgrade pra um plano pago e libere FAQs, catálogo de produtos, exemplos e personalização da IA.';

    const footerNote = isTrialExpired
      ? 'Seu trabalho continua salvo. Ao assinar, tudo volta a funcionar.'
      : 'Plano Starter a partir de R$ 97/mês — sem fidelidade.';

    // Monta DOM via createElement em vez de innerHTML pra evitar qualquer
    // futura discussão com CSP/XSS (mesmo que as strings sejam estáticas).
    const card = document.createElement('div');
    card.style.cssText = [
      'max-width: 560px; text-align: center;',
      'background: rgba(15,12,41,0.7); border: 1px solid rgba(139,92,246,0.4);',
      'border-radius: 16px; padding: 40px 32px;',
      'box-shadow: 0 20px 60px rgba(0,0,0,0.4);'
    ].join(' ');

    const icon = document.createElement('div');
    icon.style.cssText = 'font-size: 64px; line-height: 1; margin-bottom: 16px;';
    icon.textContent = '🎓';

    const h1 = document.createElement('h1');
    h1.style.cssText = 'font-size: 1.8rem; margin: 0 0 12px; font-weight: 700;';
    h1.textContent = title;

    const p = document.createElement('p');
    p.style.cssText = 'color: #c4b5fd; line-height: 1.6; margin: 0 0 28px;';
    p.textContent = msg;

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:12px; justify-content:center; flex-wrap:wrap;';

    const ctaBtn = document.createElement('button');
    ctaBtn.id = 'whl-upsell-cta';
    ctaBtn.style.cssText = [
      'background: linear-gradient(135deg, #8b5cf6, #6366f1);',
      'color: white; border: 0; padding: 14px 28px;',
      'border-radius: 10px; font-size: 1rem; font-weight: 600;',
      'cursor: pointer; box-shadow: 0 8px 24px rgba(139,92,246,0.3);'
    ].join(' ');
    ctaBtn.textContent = 'Ver planos e fazer upgrade';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'whl-upsell-close';
    closeBtn.style.cssText = [
      'background: transparent; color: #c4b5fd;',
      'border: 1px solid rgba(196,181,253,0.3); padding: 14px 24px;',
      'border-radius: 10px; font-size: 1rem; cursor: pointer;'
    ].join(' ');
    closeBtn.textContent = 'Fechar';

    actions.appendChild(ctaBtn);
    actions.appendChild(closeBtn);

    const footer = document.createElement('p');
    footer.style.cssText = 'color: #6b7280; font-size: 0.8rem; margin-top: 20px;';
    footer.textContent = footerNote;

    card.appendChild(icon);
    card.appendChild(h1);
    card.appendChild(p);
    card.appendChild(actions);
    card.appendChild(footer);
    upsell.appendChild(card);
    document.body.appendChild(upsell);

    ctaBtn.addEventListener('click', () => {
      const SM = window.SubscriptionManager;
      if (SM && typeof SM.getUpgradeUrl === 'function') {
        window.open(SM.getUpgradeUrl('starter'), '_blank');
      } else {
        chrome.storage.local.get(['whl_backend_url'], (r) => {
          const base = r?.whl_backend_url || 'https://app.whatshybrid.com.br';
          window.open(`${base}/dashboard.html#billing`, '_blank');
        });
      }
    });
    closeBtn.addEventListener('click', () => {
      window.close();
    });
  }

  function applyGate(sub) {
    const planId = sub?.planId || 'free';
    const status = sub?.status;
    const trialEndsAt = sub?.trialEndsAt;
    const now = Date.now();

    const trialExpired = status === 'trial' &&
                         trialEndsAt &&
                         new Date(trialEndsAt).getTime() < now;
    const isFree = planId === 'free' || status === 'inactive';

    if (isFree || trialExpired) {
      renderUpsell(trialExpired ? 'trial_expired' : 'free_plan');
      window.__WHL_TRAINING_BLOCKED = true;
    }
  }

  try {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      applyGate(result?.[STORAGE_KEY] || null);
    });
  } catch (e) {
    console.warn('[Training Gate] storage.local indisponível:', e?.message);
  }
})();
