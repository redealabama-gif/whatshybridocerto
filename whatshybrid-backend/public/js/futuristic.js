/**
 * WhatsHybrid Pro — Shared utilities
 * Cursor customizado + toast + helper de API
 */

// ── Custom Cursor (ativado via .has-cursor no body) ────────────────
(function setupCursor() {
  if (!document.body.classList.contains('has-cursor')) return;
  if (window.matchMedia('(pointer: coarse)').matches) return; // mobile/touch

  const cursor = document.createElement('div');
  cursor.id = 'cursor';
  document.body.appendChild(cursor);

  const dot = document.createElement('div');
  dot.id = 'cursor-dot';
  document.body.appendChild(dot);

  document.addEventListener('mousemove', (e) => {
    cursor.style.left = e.clientX + 'px';
    cursor.style.top = e.clientY + 'px';
    dot.style.left = e.clientX + 'px';
    dot.style.top = e.clientY + 'px';
  });

  // Hover state on interactive elements
  document.addEventListener('mouseover', (e) => {
    if (e.target.closest('a, button, input, select, textarea, [data-cursor="hover"]')) {
      document.body.classList.add('hovering');
    }
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('a, button, input, select, textarea, [data-cursor="hover"]')) {
      document.body.classList.remove('hovering');
    }
  });
})();

// ── Toast simples ──────────────────────────────────────────────────
window.toast = function(message, type = 'info', duration = 4000) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.className = 'toast ' + type;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), duration);
};

// ── API helper com auth automática ─────────────────────────────────
window.api = {
  baseUrl: window.location.origin,

  getToken() {
    return localStorage.getItem('wh_jwt') || '';
  },

  setToken(token) {
    if (token) localStorage.setItem('wh_jwt', token);
    else localStorage.removeItem('wh_jwt');
  },

  setUser(user) {
    if (user) localStorage.setItem('wh_user', JSON.stringify(user));
    else localStorage.removeItem('wh_user');
  },

  getUser() {
    try { return JSON.parse(localStorage.getItem('wh_user') || 'null'); }
    catch { return null; }
  },

  isAuthenticated() {
    return !!this.getToken();
  },

  logout() {
    this.setToken(null);
    this.setUser(null);
    window.location.href = '/login.html';
  },

  async request(method, path, body) {
    const headers = { 'Accept': 'application/json' };
    const token = this.getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (body) headers['Content-Type'] = 'application/json';

    const r = await fetch(this.baseUrl + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (r.status === 401) {
      this.logout();
      throw new Error('Sessão expirada — faça login de novo');
    }

    let data;
    try { data = await r.json(); } catch { data = null; }

    if (!r.ok) {
      const msg = data?.error || data?.message || `${r.status} ${r.statusText}`;
      throw new Error(msg);
    }
    return data;
  },

  get(path)         { return this.request('GET', path); },
  post(path, body)  { return this.request('POST', path, body); },
  put(path, body)   { return this.request('PUT', path, body); },
  patch(path, body) { return this.request('PATCH', path, body); },
  delete(path)      { return this.request('DELETE', path); },
};

// ── Form helpers ───────────────────────────────────────────────────
window.formError = function(formEl, fieldName, message) {
  const group = formEl.querySelector(`[data-field="${fieldName}"]`);
  if (!group) return;
  group.classList.add('has-error');
  const errEl = group.querySelector('.input-error-text');
  if (errEl) errEl.textContent = message;
};

window.clearFormErrors = function(formEl) {
  formEl.querySelectorAll('.has-error').forEach(g => g.classList.remove('has-error'));
};

window.setLoading = function(buttonEl, loading) {
  if (loading) {
    buttonEl.dataset.originalText = buttonEl.innerHTML;
    buttonEl.innerHTML = '<span class="spinner"></span> Carregando...';
    buttonEl.disabled = true;
  } else {
    buttonEl.innerHTML = buttonEl.dataset.originalText || buttonEl.innerHTML;
    buttonEl.disabled = false;
  }
};

// ── v8.5.0: Helpers de DOM seguro ────────────────────────────────
window.escapeHtml = function(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// Substitui innerHTML por textContent quando possível (sanitização automática)
window.safeText = function(elem, text) {
  if (elem) elem.textContent = text == null ? '' : String(text);
};
