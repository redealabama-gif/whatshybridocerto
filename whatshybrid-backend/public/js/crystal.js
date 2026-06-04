/**
 * Vórtex Pro — Neural Core
 * Acabamento do vídeo do cristal: garante loop, parallax no mouse, parallax no
 * scroll e partículas flutuando ao redor. Sem WebGL. Respeita reduced-motion/touch.
 */
(function () {
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const el = document.getElementById('neural-core-crystal');
  const section = document.getElementById('neural-core');
  const stage = section && section.querySelector('.ncore-stage');
  const video = el && el.querySelector('.ncore-video');

  // Garante autoplay/loop
  if (video) {
    const play = () => { const p = video.play(); if (p && p.catch) p.catch(() => {}); };
    video.addEventListener('loadeddata', play);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) play(); });
    play();
  }

  // ── Partículas flutuando ao redor do cristal ──
  if (stage && !reduce) {
    const cv = document.createElement('canvas');
    cv.className = 'ncore-particles';
    cv.setAttribute('aria-hidden', 'true');
    stage.appendChild(cv);
    const ctx = cv.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, parts = [];
    const COLS = [[150, 200, 255], [120, 150, 255], [255, 180, 120]];
    function resize() {
      const r = stage.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(46, Math.round(W * H / 9000));
      parts = new Array(n).fill(0).map(() => ({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.5 + Math.random() * 1.6,
        vy: -(0.06 + Math.random() * 0.22), vx: (Math.random() - 0.5) * 0.12,
        a: 0.2 + Math.random() * 0.5, tw: Math.random() * 6.28,
        c: COLS[(Math.random() * COLS.length) | 0],
      }));
    }
    resize();
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stage);
    let onScreen = true, vis = true;
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => es.forEach((e) => { onScreen = e.isIntersecting; }), { threshold: 0 }).observe(stage);
    document.addEventListener('visibilitychange', () => { vis = !document.hidden; });
    let tt = 0;
    function draw() {
      requestAnimationFrame(draw);
      if (!onScreen || !vis) return;
      tt += 0.016;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of parts) {
        p.y += p.vy; p.x += p.vx;
        if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; }
        if (p.x < -4) p.x = W + 4; else if (p.x > W + 4) p.x = -4;
        const tw = 0.6 + 0.4 * Math.sin(tt * 1.5 + p.tw);
        ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${(p.a * tw).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    draw();
  }

  // ── Parallax (mouse) + parallax (scroll) ──
  if (el && section && !reduce && !coarse) {
    const st = { mx: 0, my: 0, tmx: 0, tmy: 0, sc: 0 };
    let raf = null;
    section.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      st.tmx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2))) * 16;
      st.tmy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2))) * 11;
      kick();
    });
    section.addEventListener('pointerleave', () => { st.tmx = 0; st.tmy = 0; kick(); });
    window.addEventListener('scroll', () => {
      const r = section.getBoundingClientRect();
      // -1 (entrando por baixo) → +1 (saindo por cima)
      st.sc = Math.max(-1, Math.min(1, 1 - (r.top + r.height / 2) / (window.innerHeight / 2 + r.height / 2)));
      kick();
    }, { passive: true });
    function kick() { if (!raf) raf = requestAnimationFrame(tick); }
    function tick() {
      st.mx += (st.tmx - st.mx) * 0.07;
      st.my += (st.tmy - st.my) * 0.07;
      const sy = st.sc * -26;          // parallax vertical pelo scroll
      // v9.7.x: sem rotação. O `rotate(rot)` deixava o container do vídeo em
      // diagonal quando saía da viewport — visualmente confunde com "vídeo
      // desalinhado da página". Mantemos só o parallax linear.
      el.style.transform = `translate3d(${st.mx.toFixed(1)}px, ${(st.my + sy).toFixed(1)}px, 0)`;
      if (Math.abs(st.mx - st.tmx) > 0.1 || Math.abs(st.my - st.tmy) > 0.1) raf = requestAnimationFrame(tick);
      else raf = null;
    }
    tick();
  }
})();
