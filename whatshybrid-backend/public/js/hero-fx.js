/**
 * WhatsHybrid Pro — Hero FX engine
 * Camada de movimento "viva/tecnológica" para a landing.
 *
 *  • Constelação de partículas interativa (hero) — liga ao cursor, repele.
 *  • Campo ambiente global sutil (fixo, atrás de tudo).
 *  • Parallax 3D do palco de dispositivos (iMac + iPhone) seguindo o mouse.
 *  • Tilt 3D + sheen reativo em frames grandes (vídeo, mock de chat/dash).
 *  • HUD brackets, sweep de boot, halo do cursor, brilho dos contadores.
 *
 * Carregar com `defer`, DEPOIS de landing-revamp.js. Não toca nos scripts base.
 * Respeita prefers-reduced-motion e ponteiros coarse (mobile/touch).
 */
(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // Ponteiro global (compartilhado por todos os módulos)
  const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, has: false };
  if (!coarse) {
    window.addEventListener('pointermove', (e) => {
      pointer.x = e.clientX; pointer.y = e.clientY; pointer.has = true;
    }, { passive: true });
  }

  // Paleta de marca em RGB
  const C_CYAN = [0, 255, 255];
  const C_PURPLE = [150, 80, 255];
  const C_WHITE = [210, 230, 255];

  // ════════════════════════════════════════════════════════
  //  CAMPO DE PARTÍCULAS (reutilizável: hero + ambiente)
  // ════════════════════════════════════════════════════════
  function createField(canvas, opts) {
    const ctx = canvas.getContext('2d', { alpha: true });
    const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr || 1.5);
    let W = 0, H = 0, particles = [];

    function rect() {
      // hero usa o tamanho do próprio elemento; ambiente usa a viewport
      return opts.host
        ? opts.host.getBoundingClientRect()
        : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    }

    function resize() {
      const r = rect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }

    function build() {
      const area = W * H;
      const n = Math.max(opts.min || 8, Math.min(opts.max, Math.round(area / opts.density)));
      particles = new Array(n).fill(0).map(() => {
        const palette = opts.palette;
        const col = palette[(Math.random() * palette.length) | 0];
        return {
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * opts.speed,
          vy: (Math.random() - 0.5) * opts.speed,
          r: opts.minR + Math.random() * (opts.maxR - opts.minR),
          col,
        };
      });
    }

    function step() {
      const r = rect();
      const link2 = opts.link * opts.link;
      // posição do ponteiro relativa ao campo
      let mx = -9999, my = -9999, mouseIn = false;
      if (opts.interactive && pointer.has) {
        mx = pointer.x - r.left;
        my = pointer.y - r.top;
        mouseIn = mx >= -80 && mx <= W + 80 && my >= -80 && my <= H + 80;
      }

      // atualizar posições
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;
        // leve repulsão do cursor
        if (mouseIn) {
          const dx = p.x - mx, dy = p.y - my;
          const d2 = dx * dx + dy * dy;
          const R = opts.repel;
          if (d2 < R * R && d2 > 0.01) {
            const f = (1 - Math.sqrt(d2) / R) * opts.repelForce;
            const inv = 1 / Math.sqrt(d2);
            p.vx += dx * inv * f;
            p.vy += dy * inv * f;
          }
        }
        // amortecimento + clamp
        p.vx *= 0.985; p.vy *= 0.985;
        const sp = Math.hypot(p.vx, p.vy);
        const maxSp = opts.speed * 2.4;
        if (sp > maxSp) { p.vx = p.vx / sp * maxSp; p.vy = p.vy / sp * maxSp; }
        // pequena agitação para nunca "morrer"
        p.vx += (Math.random() - 0.5) * opts.speed * 0.06;
        p.vy += (Math.random() - 0.5) * opts.speed * 0.06;
        // bounce nas bordas
        if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx); }
        else if (p.x > W) { p.x = W; p.vx = -Math.abs(p.vx); }
        if (p.y < 0) { p.y = 0; p.vy = Math.abs(p.vy); }
        else if (p.y > H) { p.y = H; p.vy = -Math.abs(p.vy); }
      }

      // desenhar
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      // links partícula↔partícula
      ctx.lineWidth = 1;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < link2) {
            const t = 1 - d2 / link2;
            ctx.strokeStyle = `rgba(${C_CYAN[0]},${C_CYAN[1]},${C_CYAN[2]},${(t * opts.linkAlpha).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // links ao cursor (mais brilhantes, em roxo)
      if (mouseIn) {
        const ml2 = opts.mouseLink * opts.mouseLink;
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          const dx = p.x - mx, dy = p.y - my;
          const d2 = dx * dx + dy * dy;
          if (d2 < ml2) {
            const t = 1 - d2 / ml2;
            ctx.strokeStyle = `rgba(${C_PURPLE[0]},${C_PURPLE[1]},${C_PURPLE[2]},${(t * 0.5).toFixed(3)})`;
            ctx.lineWidth = 1 + t;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(mx, my);
            ctx.stroke();
          }
        }
        ctx.lineWidth = 1;
      }

      // nós (núcleo + halo aditivo barato p/ leitura "neon")
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (opts.glow) {
          ctx.fillStyle = `rgba(${p.col[0]},${p.col[1]},${p.col[2]},${(opts.nodeAlpha * 0.16).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgba(${p.col[0]},${p.col[1]},${p.col[2]},${opts.nodeAlpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
    }

    resize();
    return { step, resize, get count() { return particles.length; } };
  }

  // ════════════════════════════════════════════════════════
  //  TILT 3D + sheen (frames grandes, não-magnéticos)
  // ════════════════════════════════════════════════════════
  function makeTilt(el, max) {
    if (!el || coarse || reduceMotion) return;
    max = max || 7;
    el.classList.add('fx-tilt');
    const edge = document.createElement('div'); edge.className = 'fx-edge';
    const sheen = document.createElement('div'); sheen.className = 'fx-sheen';
    el.appendChild(edge); el.appendChild(sheen);
    let frame = null;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--ry', ((px - 0.5) * 2 * max).toFixed(2) + 'deg');
        el.style.setProperty('--rx', (-(py - 0.5) * 2 * max).toFixed(2) + 'deg');
        el.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
        el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
        el.classList.add('is-tilting');
      });
    });
    el.addEventListener('pointerleave', () => {
      el.classList.remove('is-tilting');
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    });
  }

  // ════════════════════════════════════════════════════════
  //  HUD brackets nos cantos
  // ════════════════════════════════════════════════════════
  function addHud(el) {
    if (!el) return;
    el.classList.add('hud-frame');
    ['tl', 'tr', 'bl', 'br'].forEach((c) => {
      const d = document.createElement('div');
      d.className = 'hud-corner ' + c;
      el.appendChild(d);
    });
  }

  // ════════════════════════════════════════════════════════
  //  INIT
  // ════════════════════════════════════════════════════════
  function init() {
    const hero = $('.hero');

    // —— Canvases ————————————————————————————————————————————
    let heroField = null, ambientField = null;
    let heroVisible = true;

    if (!reduceMotion && hero) {
      // Partículas do hero substituídas pela nebulosa WebGL2 em js/hero-shader.js
      // (mesmo slot z-index 1, paleta cyan/purple). Halo do cursor e sweep de
      // boot abaixo continuam aqui — funcionam por cima da nebulosa.

      // halo do cursor dentro do hero
      const glow = document.createElement('div');
      glow.className = 'hero-cursor-glow';
      glow.setAttribute('aria-hidden', 'true');
      hero.appendChild(glow);
      if (!coarse) {
        hero.addEventListener('pointermove', (e) => {
          const r = hero.getBoundingClientRect();
          glow.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
        });
      }

      // sweep de boot
      hero.classList.add('fx-boot');
    }

    if (!reduceMotion) {
      const ambCanvas = document.createElement('canvas');
      ambCanvas.className = 'ambient-fx';
      ambCanvas.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(ambCanvas, document.body.firstChild);
      ambientField = createField(ambCanvas, {
        host: null, maxDpr: 1,
        density: 46000, max: 60, min: 14,
        speed: 0.16, minR: 0.6, maxR: 1.7,
        link: 150, linkAlpha: 0.16, mouseLink: 0,
        nodeAlpha: 0.55,
        palette: [C_CYAN, C_PURPLE],
        interactive: false, repel: 0, repelForce: 0,
      });
      requestAnimationFrame(() => ambCanvas.classList.add('is-live'));
    }

    // —— Loop único ——————————————————————————————————————————
    let visible = true;
    document.addEventListener('visibilitychange', () => { visible = !document.hidden; });
    function loop() {
      if (visible) {
        if (ambientField) ambientField.step();
        if (heroField && heroVisible) heroField.step();
      }
      requestAnimationFrame(loop);
    }
    if (heroField || ambientField) requestAnimationFrame(loop);

    // resize (debounced)
    let rt = null;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        if (heroField) heroField.resize();
        if (ambientField) ambientField.resize();
      }, 200);
    }, { passive: true });

    // —— Parallax 3D do palco de dispositivos ————————————————
    const stage = $('.hv-stage');
    const hvFrame = $('.hv-frame');
    if (hvFrame && stage && !coarse && !reduceMotion && hero) {
      let pf = null;
      hero.addEventListener('pointermove', (e) => {
        const r = hero.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        if (pf) cancelAnimationFrame(pf);
        pf = requestAnimationFrame(() => {
          hvFrame.style.transform =
            `rotateY(${(px * 11).toFixed(2)}deg) rotateX(${(-py * 7).toFixed(2)}deg) ` +
            `translate3d(${(px * 16).toFixed(1)}px, ${(py * 12).toFixed(1)}px, 0)`;
          stage.classList.add('is-tilting');
        });
      });
      hero.addEventListener('pointerleave', () => {
        hvFrame.style.transform = '';
        stage.classList.remove('is-tilting');
      });
    }

    // —— Decode de texto: REMOVIDO ——————————————————————————
    // O efeito de "scramble" embaralhava h1 do hero e .section-eyebrow
    // ao carregar/scrollar — confundia a leitura, foi desligado.

    // —— Tilt em frames grandes não-magnéticos ———————————————
    // .laptop-frame ficou de fora: o contexto 3D (perspective + preserve-3d)
    // pode bloquear o render do <video> de demo dentro de .laptop-screen.
    makeTilt($('.chat-mock'), 5);
    makeTilt($('.dash-mock'), 5);

    // —— HUD brackets —————————————————————————————————————————
    addHud($('.hero-visual'));
    addHud($('.hero-media-wrap'));

    // —— Brilho ao concluir contadores ———————————————————————
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((ents) => {
        ents.forEach((e) => {
          if (e.isIntersecting) {
            const dur = parseInt(e.target.getAttribute('data-duration') || '1400', 10);
            setTimeout(() => e.target.classList.add('counted'), dur + 120);
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.5 });
      $$('.stat-value[data-target]').forEach((el) => io.observe(el));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
