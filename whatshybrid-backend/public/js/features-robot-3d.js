// Robô 3D self-hosted da seção "Recursos que vendem".
//
// 100% local: usa o Three.js vendorado em /assets/three (sem CDN, sem cena
// externa, sem .wasm, sem Draco). A geometria é toda procedural — montada com
// primitivas — então não há nenhum asset remoto para falhar.
//
// Carregado sob demanda por um pequeno loader inline no index.html, que só
// chama init() em desktop com WebGL. Em qualquer falha aqui, init() lança e o
// loader mantém o robô SVG embutido (.feature-robot-fallback) visível.
//
// Three.js r184 — MIT (ver /assets/three/LICENSE).

import * as THREE from '/assets/three/three.module.min.js';

const CYAN   = 0x22d3ee;
const PURPLE = 0x6f00ff;
const FOV    = 35;

export function init(host) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let width  = host.clientWidth;
  let height = host.clientHeight;
  // Se a moldura ainda não tem tamanho (escondida/0), não faz sentido renderizar.
  if (width < 50 || height < 50) {
    throw new Error('host sem dimensões — abortando robô 3D');
  }

  // —— Renderer (pode lançar se não houver contexto WebGL; o loader trata) ——
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.setClearColor(0x000000, 0); // transparente: o gradiente da moldura aparece
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 100);

  // —— Luzes ——
  scene.add(new THREE.AmbientLight(0x4a5a80, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(PURPLE, 1.3);
  rim.position.set(-4, 2, -3);
  scene.add(rim);
  const coreLight = new THREE.PointLight(CYAN, 2.2, 9, 2);
  coreLight.position.set(0, 0.5, 1.2);
  scene.add(coreLight);

  // —— Materiais ——
  const matBody = new THREE.MeshStandardMaterial({ color: 0x2a3358, metalness: 0.65, roughness: 0.35 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x0a0e1c, metalness: 0.4,  roughness: 0.6 });
  const matAccent = new THREE.MeshStandardMaterial({
    color: 0x0a2a33, emissive: CYAN, emissiveIntensity: 1.1, metalness: 0.3, roughness: 0.4,
  });

  // —— Robô (procedural) ——
  const robot = new THREE.Group();

  const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    robot.add(m);
    return m;
  };
  const sphere = (r, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 24), mat);
    m.position.set(x, y, z);
    robot.add(m);
    return m;
  };
  const capsule = (r, len, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat);
    m.position.set(x, y, z);
    robot.add(m);
    return m;
  };

  // Cabeça + visor + olhos + antena
  box(1.5, 1.15, 1.05, matBody, 0, 1.85, 0);
  box(1.18, 0.5, 0.14, matDark, 0, 1.88, 0.52);
  const eyeL = sphere(0.12, matAccent, -0.28, 1.9, 0.62);
  const eyeR = sphere(0.12, matAccent,  0.28, 1.9, 0.62);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 12), matBody);
  antenna.position.set(0, 2.62, 0);
  robot.add(antenna);
  const spark = sphere(0.1, matAccent, 0, 2.92, 0);

  // Pescoço
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.2, 16), matDark);
  neck.position.set(0, 1.18, 0);
  robot.add(neck);

  // Tronco + núcleo do peito + anel
  box(1.7, 1.7, 1.05, matBody, 0, 0.35, 0);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), matAccent);
  core.position.set(0, 0.5, 0.55);
  robot.add(core);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.045, 12, 36), matAccent);
  ring.position.set(0, 0.5, 0.5);
  robot.add(ring);

  // Ombros + braços + mãos
  sphere(0.3, matBody, -1.05, 0.92, 0);
  sphere(0.3, matBody,  1.05, 0.92, 0);
  capsule(0.18, 0.95, matBody, -1.18, 0.3, 0);
  capsule(0.18, 0.95, matBody,  1.18, 0.3, 0);
  sphere(0.22, matAccent, -1.2, -0.42, 0);
  sphere(0.22, matAccent,  1.2, -0.42, 0);

  // Quadril + pernas + pés
  box(1.05, 0.4, 0.85, matDark, 0, -0.62, 0);
  capsule(0.22, 0.7, matBody, -0.4, -1.2, 0);
  capsule(0.22, 0.7, matBody,  0.4, -1.2, 0);
  box(0.55, 0.22, 0.75, matBody, -0.4, -1.72, 0.12);
  box(0.55, 0.22, 0.75, matBody,  0.4, -1.72, 0.12);

  scene.add(robot);

  // —— Enquadramento automático (à prova de corte, independente do aspect) ——
  const fit = () => {
    const aspect = width / height;
    camera.aspect = aspect;
    const bbox = new THREE.Box3().setFromObject(robot);
    const size = bbox.getSize(new THREE.Vector3());
    const center = bbox.getCenter(new THREE.Vector3());
    const vFov = (FOV * Math.PI) / 180;
    const distH = (size.y / 2) / Math.tan(vFov / 2);
    const distW = (size.x / 2) / Math.tan(vFov / 2) / aspect;
    const dist = Math.max(distH, distW) * 1.35; // respiro nas bordas
    camera.position.set(0, center.y, dist);
    camera.lookAt(0, center.y, 0);
    camera.updateProjectionMatrix();
    baseY = robot.position.y;
  };
  let baseY = 0;
  fit();

  // —— Interação: leve parallax seguindo o mouse ——
  let targetX = 0, targetY = 0, curX = 0, curY = 0;
  const onMove = (e) => {
    const r = host.getBoundingClientRect();
    targetX = ((e.clientX - r.left) / r.width - 0.5) * 0.6;
    targetY = ((e.clientY - r.top) / r.height - 0.5) * 0.35;
  };
  if (!reduce) host.addEventListener('mousemove', onMove);

  // —— Loop ——
  const clock = new THREE.Clock();
  let rafId = 0, running = false, disposed = false;

  const renderFrame = () => {
    const t = clock.getElapsedTime();
    curX += (targetX - curX) * 0.06;
    curY += (targetY - curY) * 0.06;
    robot.rotation.y = Math.sin(t * 0.4) * 0.4 + curX;
    robot.rotation.x = curY * 0.5;
    robot.position.y = baseY + Math.sin(t * 1.1) * 0.07;
    const pulse = 0.9 + Math.sin(t * 2.2) * 0.5;
    matAccent.emissiveIntensity = pulse;
    coreLight.intensity = 1.6 + pulse;
    const s = 0.95 + Math.sin(t * 2.2) * 0.06;
    core.scale.setScalar(s);
    ring.rotation.z = t * 0.6;
    renderer.render(scene, camera);
  };

  const loop = () => {
    if (!running || disposed) return;
    rafId = requestAnimationFrame(loop);
    renderFrame();
  };
  const startLoop = () => {
    if (running || disposed || reduce) return;
    running = true;
    clock.start();
    loop();
  };
  const stopLoop = () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  // Primeiro frame -> revela o 3D e some com o robô SVG embutido.
  renderFrame();
  host.classList.add('is-loaded');

  if (reduce) {
    // Sem animação: deixa um frame estático bonito.
    robot.rotation.y = -0.3;
    renderFrame();
  } else {
    startLoop();
  }

  // —— Pausa fora da tela / aba escondida (economiza GPU) ——
  let visObs = null;
  if ('IntersectionObserver' in window) {
    visObs = new IntersectionObserver((entries) => {
      entries.forEach((e) => { e.isIntersecting ? startLoop() : stopLoop(); });
    }, { threshold: 0 });
    visObs.observe(host);
  }
  const onVisibility = () => { document.hidden ? stopLoop() : startLoop(); };
  document.addEventListener('visibilitychange', onVisibility);

  // —— Resize ——
  let resizeObs = null;
  const doResize = () => {
    width = host.clientWidth;
    height = host.clientHeight;
    if (width < 50 || height < 50) return;
    renderer.setSize(width, height);
    fit();
    if (!running) renderFrame();
  };
  if ('ResizeObserver' in window) {
    resizeObs = new ResizeObserver(doResize);
    resizeObs.observe(host);
  } else {
    window.addEventListener('resize', doResize);
  }

  // —— Se o contexto WebGL cair, volta o robô SVG ——
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stopLoop();
    host.classList.remove('is-loaded');
  });

  // —— Limpeza (caso algum dia seja desmontado) ——
  function dispose() {
    if (disposed) return;
    disposed = true;
    stopLoop();
    if (visObs) visObs.disconnect();
    if (resizeObs) resizeObs.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    host.removeEventListener('mousemove', onMove);
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    renderer.dispose();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  return { dispose };
}
