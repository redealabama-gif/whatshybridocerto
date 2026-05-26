/**
 * Subscription UI — banner persistente no side panel + notificação one-shot
 * de trial expirado.
 *
 * Mostra o estado atual da assinatura em três variantes:
 *   1. Chip discreto pra planos pagos / master key (não distrai)
 *   2. Banner trial com countdown + créditos
 *   3. Banner Free Lite com cap diário "X/3 IA hoje" + CTAs de upgrade
 *      e referral ("Ganhar +3 dias indicando")
 *
 * Escuta eventos do SubscriptionManager pra renderizar em tempo real
 * (consumo de IA, reset diário, trial vence). O banner de trial expirado
 * usa NotificationsModule.persistent + flag em chrome.storage pra só
 * aparecer uma única vez por device.
 */
(function() {
  'use strict';

  const STORAGE_KEY_EXPIRED_SEEN = 'whl_trial_expired_seen';

  let bannerEl = null;
  let initialized = false;

  async function init() {
    if (initialized) return;
    if (!window.SubscriptionManager) {
      console.warn('[SubscriptionUI] SubscriptionManager indisponível — abortando');
      return;
    }

    createBanner();
    attachListeners();
    render();

    // Se o init() do SubscriptionManager já emitiu trial_expired antes da
    // gente assinar (race condition em recargas pós-trial), checa flag.
    const sub = window.SubscriptionManager.getSubscription();
    if (sub?.trialExpired) {
      await showTrialExpiredOnce();
    }

    initialized = true;
    console.log('[SubscriptionUI] ✅ Inicializado');
  }

  function createBanner() {
    if (document.getElementById('whl_status_banner')) {
      bannerEl = document.getElementById('whl_status_banner');
      return;
    }
    const header = document.querySelector('.container > .header');
    if (!header) {
      console.warn('[SubscriptionUI] .container > .header não encontrado — banner não anexado');
      return;
    }
    bannerEl = document.createElement('div');
    bannerEl.id = 'whl_status_banner';
    bannerEl.className = 'whl-status-banner';
    bannerEl.style.display = 'none';
    header.insertAdjacentElement('afterend', bannerEl);
  }

  function attachListeners() {
    const SM = window.SubscriptionManager;
    SM.on('initialized', render);
    SM.on('trial_started', () => { render(); showTrialStartedToast(false); });
    SM.on('trial_auto_started', () => { render(); showTrialStartedToast(true); });
    SM.on('trial_expired', async () => { render(); await showTrialExpiredOnce(); });
    SM.on('subscription_activated', render);
    SM.on('subscription_deactivated', render);
    SM.on('subscription_revoked', render);
    SM.on('credits_consumed', render);
    SM.on('credits_depleted', render);
    SM.on('credits_low', render);
    SM.on('credits_added', render);
    SM.on('daily_reset', render);
    SM.on('synced', render);
  }

  function render() {
    if (!bannerEl) return;
    const SM = window.SubscriptionManager;
    if (!SM) { bannerEl.style.display = 'none'; return; }

    const planId = SM.getPlanId();

    if (SM.isMasterKey()) {
      renderChip('👑 Master Key', 'Acesso total');
      return;
    }

    if (SM.isTrial()) {
      const days = SM.getTrialDaysRemaining();
      const credits = SM.getCredits();
      renderTrial(days, credits.remaining, credits.total);
      return;
    }

    if (['starter', 'pro', 'enterprise'].includes(planId) && SM.isActive()) {
      const credits = SM.getCredits();
      const plan = SM.getPlan();
      renderChip(`${plan.icon} ${plan.name}`, `${credits.remaining} créditos`);
      return;
    }

    renderFreeLite();
  }

  function renderChip(label, sublabel) {
    bannerEl.className = 'whl-status-banner whl-banner-chip';
    bannerEl.innerHTML = `
      <span class="whl-banner-label">${escapeHtml(label)}</span>
      ${sublabel ? `<span class="whl-banner-sub">${escapeHtml(sublabel)}</span>` : ''}
    `;
    bannerEl.style.display = '';
  }

  function renderTrial(days, remaining, total) {
    const lowCredits = total > 0 && (remaining / total) < 0.2;
    const klass = lowCredits ? 'whl-banner-trial whl-banner-warn' : 'whl-banner-trial';
    bannerEl.className = `whl-status-banner ${klass}`;
    bannerEl.innerHTML = `
      <div class="whl-banner-text">
        <span class="whl-banner-label">🎁 Trial Pro — ${days} dia${days === 1 ? '' : 's'} restante${days === 1 ? '' : 's'}</span>
        <span class="whl-banner-sub">${remaining}/${total} créditos IA${lowCredits ? ' • acabando' : ''}</span>
      </div>
      <button class="whl-banner-cta" data-action="upgrade">Ver planos</button>
    `;
    bannerEl.style.display = '';
    bannerEl.querySelector('[data-action="upgrade"]')?.addEventListener('click', openUpgrade);
  }

  function renderFreeLite() {
    const SM = window.SubscriptionManager;
    const limit = SM.getLimit('aiRepliesPerDay') || 0;
    const used = (SM.getUsage().aiRepliesToday || 0);
    const exhausted = limit > 0 && used >= limit;
    const klass = exhausted ? 'whl-banner-free whl-banner-warn' : 'whl-banner-free';

    bannerEl.className = `whl-status-banner ${klass}`;
    bannerEl.innerHTML = `
      <div class="whl-banner-text">
        <span class="whl-banner-label">💡 Free Lite</span>
        <span class="whl-banner-sub">${used}/${limit} IA hoje${exhausted ? ' • esgotado' : ''}</span>
      </div>
      <div class="whl-banner-actions">
        <button class="whl-banner-cta-secondary" data-action="referral" title="Indique a extensão e ganhe +3 dias de trial Pro">🎁 +3d</button>
        <button class="whl-banner-cta" data-action="upgrade">Ver planos</button>
      </div>
    `;
    bannerEl.style.display = '';
    bannerEl.querySelector('[data-action="upgrade"]')?.addEventListener('click', openUpgrade);
    bannerEl.querySelector('[data-action="referral"]')?.addEventListener('click', openReferral);
  }

  function openUpgrade() {
    const SM = window.SubscriptionManager;
    if (!SM) return;
    window.open(SM.getUpgradeUrl('starter'), '_blank');
  }

  function openReferral() {
    const SM = window.SubscriptionManager;
    if (!SM) return;
    // Referral usa o dashboard pra renderizar o link único — a página
    // resolve auth + emite/exibe o código. Backend de grant +3d ainda
    // não existe; a página atual mostra "em breve" enquanto o fluxo
    // não está pronto. Quando estiver, basta a página listar o link
    // e o callback do signup creditar trialDays += 3.
    const manage = SM.getManageUrl() || '';
    const base = manage.replace(/#.*$/, '');
    window.open(`${base}#referral`, '_blank');
  }

  function showTrialStartedToast(isAuto) {
    if (!window.NotificationsModule) return;
    window.NotificationsModule.show({
      title: '🎁 Trial Pro ativado!',
      message: isAuto
        ? 'Boas-vindas! Você tem 7 dias com Smart Replies, Copilot, Autopilot e 50 créditos de IA.'
        : 'Você tem 7 dias com Smart Replies, Copilot, Autopilot e 50 créditos de IA.',
      type: 'success',
      duration: 9000
    });
  }

  async function showTrialExpiredOnce() {
    try {
      const got = await new Promise(r => chrome.storage.local.get([STORAGE_KEY_EXPIRED_SEEN], r));
      if (got?.[STORAGE_KEY_EXPIRED_SEEN]) return;
    } catch (_) { /* segue */ }

    if (!window.NotificationsModule) return;

    window.NotificationsModule.show({
      title: '⏰ Seu trial Pro acabou',
      message: 'Você continua usando a extensão no plano Free Lite: 3 IA/dia, 5 contatos em massa/dia, CRM básico e templates. Faça upgrade para liberar Copilot, Autopilot e Smart Replies sem limite.',
      type: 'info',
      persistent: true,
      actions: [
        { label: 'Ver planos', action: openUpgrade },
        { label: 'Continuar grátis', action: () => {} }
      ]
    });

    try {
      await new Promise(r => chrome.storage.local.set({ [STORAGE_KEY_EXPIRED_SEEN]: true }, r));
    } catch (_) { /* idempotente */ }
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  window.SubscriptionUI = { init, render };
  console.log('[SubscriptionUI] Módulo carregado');
})();
