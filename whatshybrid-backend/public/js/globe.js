/**
 * WhatsHybrid Pro — Globe interativo (cobe, vanilla)
 * Globo arrastável com marcadores concentrados no Brasil/América do Sul + hubs
 * globais. Os marcadores "quentes" (Brasil) pulsam. Sem React. Carrega o cobe
 * via ESM (CDN); se falhar, mostra um fallback estático e não quebra a página.
 *
 * O <script> que chama este arquivo é type="module".
 */
const canvas = document.getElementById('globe-canvas');
const stage = canvas && canvas.closest('.globe-stage');

if (canvas) {
  init().catch((e) => {
    console.warn('[globe] não foi possível iniciar o cobe, usando fallback:', e);
    if (stage) stage.classList.add('globe-failed');
  });
}

async function init() {
  // Import dinâmico do cobe (com fallback de CDN)
  let createGlobe;
  try {
    ({ default: createGlobe } = await import('https://esm.sh/cobe@0.6.3'));
  } catch (e) {
    ({ default: createGlobe } = await import('https://cdn.jsdelivr.net/npm/cobe@0.6.3/+esm'));
  }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // —— Marcadores ——————————————————————————————————————————————
  // hot = Brasil (pulsa, maior). warm = resto da América do Sul. cold = global.
  const HOT = [
    [-23.55, -46.63], // São Paulo
    [-22.91, -43.17], // Rio de Janeiro
    [-15.79, -47.88], // Brasília
    [-19.92, -43.94], // Belo Horizonte
    [-12.97, -38.50], // Salvador
    [-8.05, -34.88],  // Recife
    [-3.73, -38.52],  // Fortaleza
    [-30.03, -51.23], // Porto Alegre
    [-25.43, -49.27], // Curitiba
    [-3.12, -60.02],  // Manaus
    [-16.69, -49.26], // Goiânia
    [-1.46, -48.50],  // Belém
  ];
  const WARM = [
    [-34.60, -58.38], // Buenos Aires
    [-34.90, -56.16], // Montevidéu
    [-25.28, -57.64], // Assunção
    [-33.45, -70.67], // Santiago
    [-12.05, -77.04], // Lima
    [4.71, -74.07],   // Bogotá
    [10.49, -66.88],  // Caracas
    [-17.78, -63.18], // Santa Cruz (BO)
  ];
  const COLD = [
    [38.72, -9.13],   // Lisboa
    [40.42, -3.70],   // Madri
    [25.76, -80.19],  // Miami
    [40.71, -74.01],  // Nova York
    [51.51, -0.13],   // Londres
    [19.43, -99.13],  // Cidade do México
    [48.85, 2.35],    // Paris
  ];

  const markers = [
    ...HOT.map((location) => ({ location, baseSize: 0.07, hot: true })),
    ...WARM.map((location) => ({ location, baseSize: 0.05, hot: false })),
    ...COLD.map((location) => ({ location, baseSize: 0.04, hot: false })),
  ];

  // —— Estado de interação (arrastar p/ girar) ——————————————————
  let phi = -1.0;            // começa mostrando a América do Sul de frente
  const theta = 0.18;
  let phiManual = 0, thetaManual = 0;
  let dragging = null;       // {x, y} enquanto arrasta
  let dPhi = 0, dTheta = 0;

  function onDown(e) {
    dragging = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
  }
  function onMove(e) {
    if (!dragging) return;
    dPhi = (e.clientX - dragging.x) / 280;
    dTheta = (e.clientY - dragging.y) / 360;
  }
  function onUp() {
    if (dragging) {
      phiManual += dPhi;
      thetaManual = Math.max(-0.55, Math.min(0.55, thetaManual + dTheta));
      dPhi = 0; dTheta = 0;
    }
    dragging = null;
    canvas.style.cursor = 'grab';
  }
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });

  // —— Tamanho ————————————————————————————————————————————————
  let size = canvas.offsetWidth || 480;
  function readSize() { size = (stage ? stage.clientWidth : canvas.offsetWidth) || 480; }

  // —— Cria o globo ——————————————————————————————————————————
  let t0 = performance.now();
  const globe = createGlobe(canvas, {
    devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    width: size * 2,
    height: size * 2,
    phi: 0,
    theta,
    dark: 1,
    diffuse: 1.3,
    mapSamples: 17000,
    mapBrightness: 7,
    baseColor: [0.34, 0.30, 0.52],     // continentes em roxo-acinzentado
    markerColor: [0.0, 0.95, 1.0],     // ciano da marca
    glowColor: [0.18, 0.06, 0.42],     // halo roxo sutil
    markers: markers.map((m) => ({ location: m.location, size: m.baseSize })),
    onRender: (state) => {
      const now = performance.now();
      const t = (now - t0) / 1000;
      // rotação automática (pausa enquanto arrasta)
      if (!dragging && !reduce) phi += 0.0035;
      state.phi = phi + phiManual + dPhi;
      state.theta = theta + thetaManual + dTheta;
      // pulsação dos marcadores quentes (Brasil)
      const pulse = 0.78 + 0.32 * (0.5 + 0.5 * Math.sin(t * 2.6));
      state.markers = markers.map((m) => ({
        location: m.location,
        size: m.hot ? m.baseSize * pulse : m.baseSize,
      }));
      // mantém resolução acompanhando o tamanho do palco
      state.width = size * 2;
      state.height = size * 2;
    },
  });

  // fade-in
  requestAnimationFrame(() => { canvas.style.opacity = '1'; });

  // resize
  function onResize() { readSize(); }
  if ('ResizeObserver' in window && stage) new ResizeObserver(onResize).observe(stage);
  else window.addEventListener('resize', onResize);
}
