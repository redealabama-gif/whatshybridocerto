/**
 * WhatsHybrid Pro — Neural Core
 * Parallax leve do vídeo do cristal seguindo o cursor (translação suave — o
 * próprio vídeo já gira). Sem WebGL. Respeita prefers-reduced-motion / touch.
 */
(function () {
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const el = document.getElementById('neural-core-crystal');
  const section = document.getElementById('neural-core');
  const video = el && el.querySelector('.ncore-video');

  // Garante o autoplay/loop mesmo se o navegador adiar
  if (video) {
    const tryPlay = () => { const p = video.play(); if (p && p.catch) p.catch(() => {}); };
    video.addEventListener('loadeddata', tryPlay);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tryPlay(); });
    tryPlay();
  }

  if (!el || !section || reduce || coarse) return;

  const st = { x: 0, y: 0, tx: 0, ty: 0 };
  let raf = null;
  section.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    st.tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2))) * 14;
    st.ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2))) * 10;
    if (!raf) raf = requestAnimationFrame(tick);
  });
  section.addEventListener('pointerleave', () => { st.tx = 0; st.ty = 0; if (!raf) raf = requestAnimationFrame(tick); });

  function tick() {
    st.x += (st.tx - st.x) * 0.07;
    st.y += (st.ty - st.y) * 0.07;
    el.style.transform = `translate3d(${st.x.toFixed(1)}px, ${st.y.toFixed(1)}px, 0)`;
    if (Math.abs(st.x - st.tx) > 0.1 || Math.abs(st.y - st.ty) > 0.1) raf = requestAnimationFrame(tick);
    else raf = null;
  }
})();
