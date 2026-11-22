/**
 * Vórtex Pro — Landing FX
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
     FUNDOS DE SEÇÃO — formato moderno e carga sob demanda

     Antes: dez <div class="pfx-bg" style="background-image:url(...jpg)">.
     O navegador baixava os dez JPEG na abertura — 17,9 MB — mesmo os de
     seções a doze mil pixels de distância. E eram 1376 px de largura
     esticados numa tela de 1440 ou mais: pesados demais e pequenos
     demais ao mesmo tempo.

     Agora o HTML traz só data-fundo="bg-xxx". Aqui escolhemos o formato
     (WebP quando o navegador aceita) e a largura (1600 ou 900, conforme
     a tela), e só pedimos a imagem quando a seção chega perto. Os JPEG
     originais seguem no repositório: são o fallback e a fonte para
     regerar, por scripts/otimizar-imagens.js.
     ════════════════════════════════════════════════════════ */
  function aceitaWebp() {
    try {
      var c = document.createElement('canvas');
      return c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (_) { return false; }
  }

  function setupFundos() {
    var todos = $$('[data-fundo]');
    if (!todos.length) return;
    var pendentes = todos.slice();

    var webp = aceitaWebp();
    // A largura da JANELA, não a do elemento: o fundo é de tela cheia.
    // devicePixelRatio entra porque numa retina de 800 px lógicos a
    // imagem de 900 px ainda chega pobre.
    var largura = window.innerWidth * (window.devicePixelRatio || 1);
    var degrau = largura > 1000 ? 1600 : 900;

    function carregar(el) {
      if (!el || el.dataset.fundoPronto) return;
      el.dataset.fundoPronto = '1';
      var nome = el.getAttribute('data-fundo');
      var moderno = 'assets/' + nome + '-' + degrau + 'w.webp';
      var original = 'assets/' + nome + '.jpg';
      var src = webp ? moderno : original;
      // Carrega fora da tela primeiro, para o fundo não surgir pela metade.
      var img = new Image();
      img.onload = function () {
        el.style.backgroundImage = 'url("' + src + '")';
        el.classList.add('pfx-bg-pronto');
      };
      img.onerror = function () {
        // WebP ausente (a geração não rodou): cai no JPEG em vez de
        // deixar a seção sem fundo nenhum.
        el.style.backgroundImage = 'url("' + original + '")';
        el.classList.add('pfx-bg-pronto');
      };
      img.src = src;
    }

    /* Varredura por posição — é ela que manda.
     *
     * Por que não confiar só no IntersectionObserver: medido neste
     * projeto, com a página crescendo enquanto Spline e vídeo carregam,
     * o IO disparou para 6 de 11 numa execução, 8 em outra, 9 em outra.
     * Os callbacks são amostrados por quadro; numa rolagem rápida, ou
     * num arrasto de barra que atravessa a página, a seção entra e sai
     * entre duas amostras e nunca é notificada. O visitante veria a
     * seção sem fundo. O observador fica, mas só para ANTECIPAR. */
    var MARGEM = 800;
    function varrer() {
      if (!pendentes.length) return;
      var alturaJanela = window.innerHeight;
      pendentes = pendentes.filter(function (el) {
        if (el.dataset.fundoPronto) return false;
        var r = el.getBoundingClientRect();
        if (r.top < alturaJanela + MARGEM && r.bottom > -MARGEM) { carregar(el); return false; }
        return true;
      });
    }

    var agendado = false;
    function aoRolar() {
      if (agendado) return;
      agendado = true;
      requestAnimationFrame(function () { agendado = false; varrer(); });
    }

    window.addEventListener('scroll', aoRolar, { passive: true });
    window.addEventListener('resize', aoRolar, { passive: true });
    // A página cresce depois do load (Spline, vídeo, fontes): o que
    // estava longe pode ficar perto sem ninguém rolar.
    window.addEventListener('load', varrer);
    setTimeout(varrer, 1500);
    setTimeout(varrer, 4000);

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entradas) {
        entradas.forEach(function (e) {
          if (e.isIntersecting) carregar(e.target.__fundo);
        });
      }, { rootMargin: '600px 0px 600px 0px' });
      // Observa a SEÇÃO, não o .pfx-bg. O filho é recortado pelo
      // overflow:hidden do pai e recebe transform do parallax — duas
      // coisas que atrapalham o cálculo de interseção. A seção é uma
      // caixa grande e estável.
      todos.forEach(function (el) {
        var alvo = el.closest('.pfx-section') || el;
        alvo.__fundo = el;
        io.observe(alvo);
      });
    }

    varrer();
  }

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
    // Primeiro os fundos: é a única destas que roda SEMPRE, inclusive em
    // celular e com prefers-reduced-motion, porque não é efeito — é o
    // carregamento das imagens da página.
    setupFundos();
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
