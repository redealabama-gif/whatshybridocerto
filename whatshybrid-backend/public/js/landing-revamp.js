/**
 * Axion — Landing Revamp
 * Comportamentos específicos da landing. Não toca no futuristic.js base.
 * Carregar APÓS futuristic.js.
 */
(function () {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────────
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function $(sel, root) { return (root || document).querySelector(sel); }

  // ── Scroll-reveal via IntersectionObserver ─────────────────────
  function setupReveal() {
    const els = $$('.reveal');
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) {
      // No observer support → content stays visible (default state)
      return;
    }

    // Arm synchronously so first paint shows the hidden state — no flash.
    els.forEach(el => el.classList.add('armed'));

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    els.forEach(el => io.observe(el));

    // Safety fallback: strip 'armed' from everything after 1.5s and cancel any
    // pending CSS transitions stuck at currentTime 0 (happens in iframe previews
    // where animations are paused). Real browsers complete normally well before
    // this fallback runs.
    setTimeout(() => {
      els.forEach(el => {
        el.classList.remove('armed');
        // Cancel any pending transitions so opacity isn't held at start state.
        try {
          el.getAnimations().forEach(a => {
            if (a.constructor.name === 'CSSTransition' && a.currentTime === 0) {
              a.cancel();
            }
          });
        } catch (e) {}
      });
    }, 1500);
  }

  // ── Counter-up animation for hero stats ────────────────────────
  function animateCounter(el) {
    const target = el.getAttribute('data-target');
    if (target == null) return;
    const suffix = el.getAttribute('data-suffix') || '';
    const prefix = el.getAttribute('data-prefix') || '';
    const duration = parseInt(el.getAttribute('data-duration') || '1400', 10);
    const isFloat = target.includes('.');
    const targetNum = parseFloat(target);
    if (isNaN(targetNum)) return;

    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      // easeOutQuart
      const eased = 1 - Math.pow(1 - t, 4);
      const current = targetNum * eased;
      const formatted = isFloat
        ? current.toFixed(1)
        : Math.floor(current).toLocaleString('pt-BR');
      el.textContent = prefix + formatted + suffix;
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = prefix + (isFloat ? targetNum.toFixed(1) : targetNum.toLocaleString('pt-BR')) + suffix;
    }
    requestAnimationFrame(tick);
  }

  function setupCounters() {
    const els = $$('[data-target]');
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) {
      els.forEach(animateCounter);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    els.forEach(el => io.observe(el));
  }

  // ── Sticky scroll CTA (appears past 30% scroll) ────────────────
  function setupStickyCTA() {
    const sticky = $('.sticky-cta');
    if (!sticky) return;
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        const pct = max > 0 ? window.scrollY / max : 0;
        const pastHero = window.scrollY > Math.max(400, window.innerHeight * 0.6);
        // Hide near the end so it doesn't overlap with the bottom CTA banner
        const nearEnd = pct > 0.9;
        sticky.classList.toggle('show', pastHero && !nearEnd);
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ── ROI Calculator ─────────────────────────────────────────────
  function setupROI() {
    const slider = $('#roi-slider');
    const numEl = $('#roi-input-num');
    if (!slider || !numEl) return;

    const out = {
      hours: $('#roi-hours'),
      cost: $('#roi-cost'),
      annual: $('#roi-annual'),
    };

    // Assumptions (deliberately conservative for credibility)
    const SECONDS_PER_MSG = 90;     // 1.5 min médio para responder bem
    const HOURLY_COST = 18;         // R$/h (atendente PJ junior)
    const WORK_DAYS_MONTH = 22;

    function fmtBRL(value) {
      return value.toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL', maximumFractionDigits: 0
      });
    }
    function fmtNum(value) {
      return value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    }

    function update() {
      const msgs = parseInt(slider.value, 10);
      numEl.textContent = msgs.toLocaleString('pt-BR');

      // Visual fill (--p var for track gradient)
      const pct = ((msgs - slider.min) / (slider.max - slider.min)) * 100;
      slider.style.setProperty('--p', pct + '%');

      const hoursMonth = (msgs * WORK_DAYS_MONTH * SECONDS_PER_MSG) / 3600;
      // We claim automation saves ~70% of time (conservative)
      const hoursSaved = hoursMonth * 0.7;
      const moneySaved = hoursSaved * HOURLY_COST;
      const annual = moneySaved * 12;

      if (out.hours) out.hours.textContent = fmtNum(hoursSaved) + ' h/mês';
      if (out.cost)  out.cost.textContent  = fmtBRL(moneySaved);
      if (out.annual) out.annual.textContent = fmtBRL(annual);
    }

    slider.addEventListener('input', update);
    update();
  }

  // ── Countdown (pseudo: dias até fim do mês) ─────────────────────
  function setupCountdown() {
    const root = $('#trial-countdown');
    if (!root) return;
    const d = $('.cd-days', root);
    const h = $('.cd-hours', root);
    const m = $('.cd-mins', root);
    const s = $('.cd-secs', root);

    function tick() {
      const now = new Date();
      // Last day of current month at 23:59:59 BRT
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      let diff = Math.max(0, Math.floor((end - now) / 1000));
      const days = Math.floor(diff / 86400); diff -= days * 86400;
      const hours = Math.floor(diff / 3600); diff -= hours * 3600;
      const mins = Math.floor(diff / 60); diff -= mins * 60;
      if (d) d.textContent = String(days).padStart(2, '0');
      if (h) h.textContent = String(hours).padStart(2, '0');
      if (m) m.textContent = String(mins).padStart(2, '0');
      if (s) s.textContent = String(diff).padStart(2, '0');
    }
    tick();
    setInterval(tick, 1000);
  }

  // ── AI chat typing animation (loop) ────────────────────────────
  function setupChatTyping() {
    const el = $('#chat-ai-typing');
    if (!el) return;

    const cursorHTML = '<span class="cursor-blink"></span>';
    const messages = [
      'Oi, Maria! Obrigado pelo interesse no plano Premium 🚀\nO valor é R$ 297/mês e já inclui suporte 24h. Posso te enviar o link de pagamento?',
      'Boa tarde! O nosso horário de entrega para a sua região é até quinta-feira. Quer que eu reserve a peça em seu nome agora?',
      'Olá! Esse modelo está com 15% de desconto até amanhã. Posso garantir a sua na cor preta tamanho M?',
    ];

    let idx = 0;
    function typeMessage(text, done) {
      let i = 0;
      el.innerHTML = cursorHTML;
      const cursor = el.firstChild;
      const speed = 18; // ms per char
      function tick() {
        if (i >= text.length) {
          setTimeout(done, 2500);
          return;
        }
        const ch = text[i++];
        const node = ch === '\n' ? document.createElement('br') : document.createTextNode(ch);
        el.insertBefore(node, cursor);
        setTimeout(tick, speed + (Math.random() * 30));
      }
      tick();
    }

    function loop() {
      typeMessage(messages[idx], () => {
        idx = (idx + 1) % messages.length;
        setTimeout(loop, 600);
      });
    }

    // Start when visible
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            io.disconnect();
            loop();
          }
        });
      }, { threshold: 0.3 });
      io.observe(el);
    } else {
      loop();
    }
  }

  // ── Pricing toggle: track period on root for [data-period-current] ──
  function setupPricingObserver() {
    const toggle = $('#pricing-toggle-wrapper');
    if (!toggle) return;
    function updateRoot() {
      const active = toggle.querySelector('button.active');
      if (!active) return;
      document.documentElement.setAttribute('data-period-current', active.dataset.period);
    }
    toggle.addEventListener('click', () => setTimeout(updateRoot, 0));
    updateRoot();
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    // Lucide CDN is loaded with defer, so it isn't ready when the inline
    // <script> at the bottom of index.html runs. That guarded call no-ops
    // and every <i data-lucide="..."> stays empty (card icons, FAQ chevrons,
    // pricing checks, etc). This script is also deferred and runs after
    // lucide, so we re-create icons here.
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
      lucide.createIcons();
    }
    setupReveal();
    setupCounters();
    setupStickyCTA();
    setupROI();
    setupCountdown();
    setupChatTyping();
    setupPricingObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
