/**
 * WhatsHybrid Pro — ROI light beam shader (WebGL)
 *
 * Adapted from the React/Three.js "WebGLShader" component into vanilla WebGL
 * to match the project convention (see js/hero-shader.js). Renders an animated
 * RGB-displaced light beam as background behind the ROI calculator card on the
 * "Quanto a IA economiza no seu mês" section.
 *
 * Skips on prefers-reduced-motion, when WebGL is unavailable, or if the
 * target section is missing. Pauses when the section leaves the viewport or
 * the tab goes inactive.
 */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  var section = document.getElementById('roi');
  if (!section) return;

  var host = section.querySelector('.roi-shader-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'roi-shader-host';
    host.setAttribute('aria-hidden', 'true');
    section.insertBefore(host, section.firstChild);
  }

  var canvas = document.createElement('canvas');
  canvas.className = 'roi-shader-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  var gl = canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: false }) ||
           canvas.getContext('experimental-webgl', { antialias: false, alpha: true, premultipliedAlpha: false });
  if (!gl) { host.remove(); return; }

  var vsSrc =
    'attribute vec3 position;\n' +
    'void main() {\n' +
    '  gl_Position = vec4(position, 1.0);\n' +
    '}';

  var fsSrc =
    'precision highp float;\n' +
    'uniform vec2 resolution;\n' +
    'uniform float time;\n' +
    'uniform float xScale;\n' +
    'uniform float yScale;\n' +
    'uniform float distortion;\n' +
    'void main() {\n' +
    '  vec2 p = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);\n' +
    '  float d = length(p) * distortion;\n' +
    '  float rx = p.x * (1.0 + d);\n' +
    '  float gx = p.x;\n' +
    '  float bx = p.x * (1.0 - d);\n' +
    '  float r = 0.05 / abs(p.y + sin((rx + time) * xScale) * yScale);\n' +
    '  float g = 0.05 / abs(p.y + sin((gx + time) * xScale) * yScale);\n' +
    '  float b = 0.05 / abs(p.y + sin((bx + time) * xScale) * yScale);\n' +
    '  gl_FragColor = vec4(r, g, b, 1.0);\n' +
    '}';

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('roi-shader compile:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  var vs = compile(gl.VERTEX_SHADER, vsSrc);
  var fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) { host.remove(); return; }

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('roi-shader link:', gl.getProgramInfoLog(prog));
    host.remove(); return;
  }

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1.0, -1.0, 0.0,
     1.0, -1.0, 0.0,
    -1.0,  1.0, 0.0,
     1.0, -1.0, 0.0,
    -1.0,  1.0, 0.0,
     1.0,  1.0, 0.0
  ]), gl.STATIC_DRAW);

  var pos = gl.getAttribLocation(prog, 'position');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 0, 0);

  var uRes = gl.getUniformLocation(prog, 'resolution');
  var uTime = gl.getUniformLocation(prog, 'time');
  var uXScale = gl.getUniformLocation(prog, 'xScale');
  var uYScale = gl.getUniformLocation(prog, 'yScale');
  var uDist = gl.getUniformLocation(prog, 'distortion');

  var dpr = Math.max(1, 0.5 * (window.devicePixelRatio || 1));

  function resize() {
    var r = host.getBoundingClientRect();
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
    }, { threshold: 0 }).observe(section);
  }

  var t0 = performance.now();
  function render(now) {
    requestAnimationFrame(render);
    if (!tabVisible || !onScreen) return;
    resize();
    gl.useProgram(prog);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (now - t0) * 1e-3);
    gl.uniform1f(uXScale, 1.0);
    gl.uniform1f(uYScale, 0.5);
    gl.uniform1f(uDist, 0.05);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  requestAnimationFrame(render);

  var rt = null;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(resize, 150);
  }, { passive: true });
})();
