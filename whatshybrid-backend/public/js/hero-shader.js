/**
 * WhatsHybrid Pro — Hero nebula shader (WebGL2)
 *
 * Substitui as partículas que existiam no hero (canvas 2D ".hero-particles")
 * por uma nebulosa procedural com raios passando, na paleta cyan/purple da
 * marca. Shader adaptado de Matthias Hurrle (@atzedent) — só as cores foram
 * trocadas pra casar com --brand-cyan / --brand-purple.
 *
 * Pula em prefers-reduced-motion, em navegadores sem WebGL2 ou se .hero não
 * estiver no DOM. Pausa quando o hero sai da viewport ou a aba fica inativa.
 */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  var hero = document.querySelector('.hero');
  if (!hero) return;

  var canvas = document.createElement('canvas');
  canvas.className = 'hero-nebula';
  canvas.setAttribute('aria-hidden', 'true');
  hero.insertBefore(canvas, hero.firstChild);

  var gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
  if (!gl) { canvas.remove(); return; }

  var vsSrc = '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec4 position;\n' +
    'void main() { gl_Position = position; }';

  var fsSrc = '#version 300 es\n' +
    'precision highp float;\n' +
    'out vec4 O;\n' +
    'uniform vec2 resolution;\n' +
    'uniform float time;\n' +
    '#define FC gl_FragCoord.xy\n' +
    '#define T time\n' +
    '#define R resolution\n' +
    '#define MN min(R.x, R.y)\n' +
    'float rnd(vec2 p) {\n' +
    '  p = fract(p * vec2(12.9898, 78.233));\n' +
    '  p += dot(p, p + 34.56);\n' +
    '  return fract(p.x * p.y);\n' +
    '}\n' +
    'float noise(in vec2 p) {\n' +
    '  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);\n' +
    '  float a = rnd(i), b = rnd(i + vec2(1, 0));\n' +
    '  float c = rnd(i + vec2(0, 1)), d = rnd(i + 1.0);\n' +
    '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n' +
    '}\n' +
    'float fbm(vec2 p) {\n' +
    '  float t = 0.0, a = 1.0;\n' +
    '  mat2 m = mat2(1.0, -0.5, 0.2, 1.2);\n' +
    '  for (int i = 0; i < 5; i++) {\n' +
    '    t += a * noise(p);\n' +
    '    p *= 2.0 * m;\n' +
    '    a *= 0.5;\n' +
    '  }\n' +
    '  return t;\n' +
    '}\n' +
    'float clouds(vec2 p) {\n' +
    '  float d = 1.0, t = 0.0;\n' +
    '  for (float i = 0.0; i < 3.0; i++) {\n' +
    '    float a = d * fbm(i * 10.0 + p.x * 0.2 + 0.2 * (1.0 + i) * p.y + d + i * i + p);\n' +
    '    t = mix(t, d, a);\n' +
    '    d = a;\n' +
    '    p *= 2.0 / (i + 1.0);\n' +
    '  }\n' +
    '  return t;\n' +
    '}\n' +
    'void main(void) {\n' +
    '  vec2 uv = (FC - 0.5 * R) / MN;\n' +
    '  vec2 st = uv * vec2(2, 1);\n' +
    '  vec3 col = vec3(0.0);\n' +
    '  float bg = clouds(vec2(st.x + T * 0.5, -st.y));\n' +
    '  uv *= 1.0 - 0.3 * (sin(T * 0.2) * 0.5 + 0.5);\n' +
    '  for (float i = 1.0; i < 12.0; i++) {\n' +
    '    uv += 0.1 * cos(i * vec2(0.1 + 0.01 * i, 0.8) + i * i + T * 0.5 + 0.1 * uv.x);\n' +
    '    // Sobe o foco dos raios (em FC.y o sentido cresce pra cima, entao subtraindo aqui o ponto de convergencia desloca-se pra cima da tela, cobrindo o headline do hero).\n' +
    '    vec2 p = uv - vec2(0.0, 0.22);\n' +
    '    float d = length(p);\n' +
    '    // Raios na paleta da marca: cyan (0,255,255) <-> purple (~111,0,255)\n' +
    '    vec3 rayCol = mix(vec3(0.0, 0.85, 1.0), vec3(0.55, 0.10, 1.0), 0.5 + 0.5 * sin(i * 0.7));\n' +
    '    col += 0.00125 / d * rayCol;\n' +
    '    // Brilho central branco-azulado pra contrastar com a nebulosa\n' +
    '    float b = noise(i + p + bg * 1.731);\n' +
    '    col += 0.002 * b / length(max(p, vec2(b * p.x * 0.02, p.y)));\n' +
    '    // Nebulosa de fundo: blend cyan <-> purple guiado por tempo + posicao\n' +
    '    vec3 cyanShade   = vec3(bg * 0.04, bg * 0.18, bg * 0.28);\n' +
    '    vec3 purpleShade = vec3(bg * 0.18, bg * 0.06, bg * 0.30);\n' +
    '    vec3 cloudCol = mix(cyanShade, purpleShade, 0.5 + 0.5 * sin(T * 0.18 + st.x * 1.5));\n' +
    '    col = mix(col, cloudCol, d);\n' +
    '  }\n' +
    '  O = vec4(col, 1.0);\n' +
    '}';

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('hero-shader compile:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  var vs = compile(gl.VERTEX_SHADER, vsSrc);
  var fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) { canvas.remove(); return; }

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('hero-shader link:', gl.getProgramInfoLog(prog));
    canvas.remove(); return;
  }

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1]), gl.STATIC_DRAW);

  var pos = gl.getAttribLocation(prog, 'position');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

  var uRes  = gl.getUniformLocation(prog, 'resolution');
  var uTime = gl.getUniformLocation(prog, 'time');

  var dpr = Math.max(1, 0.5 * (window.devicePixelRatio || 1));

  function resize() {
    var r = hero.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width * dpr));
    var h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }
  resize();
  requestAnimationFrame(function () { canvas.classList.add('is-live'); });

  var tabVisible = true, onScreen = true;
  document.addEventListener('visibilitychange', function () { tabVisible = !document.hidden; });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      es.forEach(function (e) { onScreen = e.isIntersecting; });
    }, { threshold: 0 }).observe(hero);
  }

  function render(now) {
    requestAnimationFrame(render);
    if (!tabVisible || !onScreen) return;
    resize();
    gl.useProgram(prog);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, now * 1e-3);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  requestAnimationFrame(render);

  var rt = null;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(resize, 150);
  }, { passive: true });
})();
