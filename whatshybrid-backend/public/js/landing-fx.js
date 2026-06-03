/**
 * Axion — Landing FX
 * Comportamentos premium da landing: parallax, magnetic hover,
 * coordenação do botão flutuante WhatsApp.
 * Carrega DEPOIS de landing-revamp.js.
 */
(function () {
  'use strict';

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isCoarse = window.matchMedia('(hover: none), (max-width: 720px)').matches;

  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function $(sel, root) { return (root || document).querySelector(sel); }

  /* ════════════════════════════════════════════════════════
     PARALLAX
     Apenas seções visíveis recebem update. Usa rAF + transform
     3D para evitar repaint. Desliga em mobile / reduced-motion.
     ════════════════════════════════════════════════════════ */
  function setupParallax() {
    if (prefersReduced || isCoarse) return;
    const sections = $$('.pfx-section');
    if (!sections.length) return;

    const tracked = [];
    sections.forEach(section => {
      const bg = $('.pfx-bg', section);
      if (!bg) return;
      const speed = parseFloat(section.getAttribute('data-pfx-speed')) || 0.18;
      tracked.push({ section, bg, speed, visible: false });
    });

    if (!tracked.length) return;

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          const t = tracked.find(x => x.section === entry.target);
          if (t) t.visible = entry.isIntersecting;
        });
      }, { rootMargin: '120px 0px 120px 0px' });
      tracked.forEach(t => io.observe(t.section));
    } else {
      tracked.forEach(t => { t.visible = true; });
    }

    let ticking = false;
    function update() {
      const viewportH = window.innerHeight;
      tracked.forEach(t => {
        if (!t.visible) return;
        const rect = t.section.getBoundingClientRect();
        const sectionCenter = rect.top + rect.height / 2;
        const offset = (viewportH / 2 - sectionCenter) * t.speed;
        t.bg.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;
      });
      ticking = false;
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  /* ════════════════════════════════════════════════════════
     MAGNETIC HOVER
     Para cada [data-magnetic] aplica translate proporcional à
     distância do cursor até o centro, escalado pelo
     atributo data-magnetic-strength (padrão 0.35).
     ════════════════════════════════════════════════════════ */
  function setupMagnetic() {
    if (prefersReduced || isCoarse) return;
    const els = $$('[data-magnetic]');
    if (!els.length) return;

    els.forEach(el => {
      const strength = parseFloat(el.getAttribute('data-magnetic-strength')) || 0.35;
      const maxOffset = parseFloat(el.getAttribute('data-magnetic-max')) || 14;
      let rect = null;

      function refreshRect() {
        rect = el.getBoundingClientRect();
      }

      function onMove(e) {
        if (!rect) refreshRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = (e.clientX - cx) * strength;
        const dy = (e.clientY - cy) * strength;
        const clamp = (v) => Math.max(-maxOffset, Math.min(maxOffset, v));
        el.style.setProperty('--mx', clamp(dx).toFixed(2) + 'px');
        el.style.setProperty('--my', clamp(dy).toFixed(2) + 'px');
      }

      function onEnter() {
        refreshRect();
        el.classList.add('is-magnetizing');
      }

      function onLeave() {
        el.classList.remove('is-magnetizing');
        el.style.setProperty('--mx', '0px');
        el.style.setProperty('--my', '0px');
      }

      el.addEventListener('pointerenter', onEnter);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerleave', onLeave);
      window.addEventListener('scroll', () => { if (rect) rect = null; }, { passive: true });
      window.addEventListener('resize', () => { rect = null; }, { passive: true });
    });
  }

  /* ════════════════════════════════════════════════════════
     WHATSAPP FLOAT — sobe quando sticky-cta aparece
     ════════════════════════════════════════════════════════ */
  function setupWppShift() {
    const sticky = $('.sticky-cta');
    const wpp = $('.wpp-float');
    if (!sticky || !wpp) return;
    const mo = new MutationObserver(() => {
      wpp.classList.toggle('shift-up', sticky.classList.contains('show'));
    });
    mo.observe(sticky, { attributes: true, attributeFilter: ['class'] });
  }

  /* ════════════════════════════════════════════════════════
     INIT
     ════════════════════════════════════════════════════════ */
  function init() {
    setupParallax();
    setupMagnetic();
    setupWppShift();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
