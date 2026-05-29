/**
 * Groups Manager — Controller enxuto da view "Grupos" no Side Panel.
 *
 * Restaura a feature de extrair membros de grupos do WhatsApp. Em vez de portar
 * as ~2614 linhas do sidepanel.js v6 do projeto antigo, reaproveita o motor
 * que já existe no content script (WhatsAppExtractor v4.0 + extractGroupMembersUltra)
 * acessado via dois comandos novos no bridge motor():
 *   - LIST_GROUPS                          → lista grupos disponíveis
 *   - EXTRACT_GROUP_MEMBERS { groupId }    → extrai membros do grupo escolhido
 *
 * Progresso da extração chega via chrome.runtime.onMessage com type
 * 'WHL_GROUPS_PROGRESS' (re-emitido por content/content-parts/07-message-listeners.js).
 *
 * Export disponível: CSV (.csv com BOM), XLSX (lib/xlsx.mini.min.js já bundlada
 * no painel), TSV pra Google Sheets (via clipboard), e cópia simples de telefones.
 */
(function () {
  'use strict';

  if (window.__WHL_GROUPS_MANAGER__) return;
  window.__WHL_GROUPS_MANAGER__ = true;

  const state = {
    groups: [],
    filter: '',
    selectedGroupId: null,
    members: [],
    lastGroupName: '',
    isExtracting: false,
  };

  let progressListenerBound = false;

  function escapeHtml(str) {
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(str);
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function $(id) { return document.getElementById(id); }
  function setStatus(text, type) {
    const el = $('grp-status');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = type === 'error' ? '#f87171' : type === 'ok' ? '#10b981' : '';
  }
  function setProgress(percent, message) {
    const fill = $('grp-progress-fill');
    const txt = $('grp-progress-text');
    if (fill) fill.style.width = Math.max(0, Math.min(100, percent || 0)) + '%';
    if (txt) txt.textContent = message || '';
  }
  async function sendMotor(cmd, data) {
    // Reutiliza o motor() global se disponível (definido no sidepanel-router.js).
    if (typeof window.motor === 'function') return window.motor(cmd, data);
    // Fallback: chamada direta. Mantém compat caso o router carregue depois.
    return new Promise((resolve, reject) => {
      const payload = { type: 'WHL_SIDE_PANEL', cmd, ...data };
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const tab = (tabs || []).find(t => (t.url || '').includes('web.whatsapp.com'));
        if (!tab?.id) return reject(new Error('Abra o WhatsApp Web (web.whatsapp.com) e tente novamente.'));
        chrome.tabs.sendMessage(tab.id, payload, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message || String(err)));
          resolve(resp);
        });
      });
    });
  }

  function bindProgressListener() {
    if (progressListenerBound) return;
    progressListenerBound = true;
    if (!chrome?.runtime?.onMessage) return;
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type !== 'WHL_GROUPS_PROGRESS') return;
      if (!state.isExtracting) return;
      const phase = msg.phase || '';
      const text = msg.message || '...';
      const pct = typeof msg.progress === 'number' ? msg.progress : 0;
      const count = typeof msg.currentCount === 'number' ? msg.currentCount : null;
      setProgress(pct, count !== null ? `${text} — ${count} membros` : text);
      if (phase === 'complete' || phase === 'error') {
        setTimeout(() => setProgress(0, ''), 1500);
      }
    });
  }

  async function loadGroups() {
    setStatus('⏳ Carregando grupos...', '');
    try {
      const resp = await sendMotor('LIST_GROUPS', {});
      if (!resp?.success) throw new Error(resp?.error || 'Falha desconhecida');
      state.groups = Array.isArray(resp.groups) ? resp.groups : [];
      state.groups.sort((a, b) => (b.participants || 0) - (a.participants || 0));
      setStatus(`✅ ${state.groups.length} grupo(s) carregados`, 'ok');
      renderList();
    } catch (e) {
      setStatus(`❌ ${e.message}`, 'error');
      state.groups = [];
      renderList();
    }
  }

  function renderList() {
    const container = $('grp-list');
    if (!container) return;
    const term = state.filter.trim().toLowerCase();
    const filtered = term
      ? state.groups.filter(g => (g.name || '').toLowerCase().includes(term))
      : state.groups;

    if (!filtered.length) {
      container.innerHTML = '<div class="sp-muted" style="padding:14px;text-align:center;">Nenhum grupo encontrado. Clique em "Carregar Grupos".</div>';
      return;
    }

    const html = filtered.map(g => {
      const selected = g.id === state.selectedGroupId;
      return `
        <div class="grp-item ${selected ? 'selected' : ''}" data-gid="${escapeHtml(g.id)}"
             style="display:flex;align-items:center;gap:8px;padding:10px;border-radius:8px;cursor:pointer;
                    background:${selected ? 'rgba(139,92,246,0.18)' : 'transparent'};
                    border:1px solid ${selected ? 'rgba(139,92,246,0.45)' : 'transparent'};
                    margin-bottom:6px;">
          <div style="font-size:20px;">👥</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(g.name || '(sem nome)')}</div>
            <div class="sp-muted" style="font-size:11px;">${g.participants || 0} participante(s)</div>
          </div>
        </div>`;
    }).join('');
    container.innerHTML = html;

    container.querySelectorAll('.grp-item').forEach(el => {
      el.addEventListener('click', () => selectGroup(el.dataset.gid));
    });
  }

  function selectGroup(id) {
    state.selectedGroupId = id;
    state.members = [];
    state.lastGroupName = state.groups.find(g => g.id === id)?.name || '';
    renderList();
    renderMembers();
    const btn = $('grp-extract-btn');
    if (btn) btn.disabled = false;
  }

  function renderMembers() {
    const box = $('grp-members');
    const count = $('grp-members-count');
    if (count) count.textContent = state.members.length;
    if (!box) return;
    if (!state.members.length) {
      box.innerHTML = '<div class="sp-muted" style="padding:14px;text-align:center;">Selecione um grupo e clique em "Extrair Membros".</div>';
      return;
    }
    const previewItems = state.members.slice(0, 200).map(p =>
      `<div style="padding:4px 8px;font-family:ui-monospace,Menlo,monospace;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.05);">${escapeHtml(p)}</div>`
    ).join('');
    const more = state.members.length > 200
      ? `<div class="sp-muted" style="padding:8px;text-align:center;font-size:11px;">... e mais ${state.members.length - 200} membros (exporte para ver todos)</div>`
      : '';
    box.innerHTML = previewItems + more;
  }

  async function extractMembers() {
    if (!state.selectedGroupId) {
      setStatus('Selecione um grupo primeiro', 'error');
      return;
    }
    if (state.isExtracting) return;

    state.isExtracting = true;
    state.members = [];
    setStatus('⏳ Extraindo membros... isso pode levar até 2 minutos para grupos grandes.', '');
    setProgress(2, 'Iniciando...');
    const btn = $('grp-extract-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Extraindo...'; }

    try {
      const resp = await sendMotor('EXTRACT_GROUP_MEMBERS', { groupId: state.selectedGroupId });
      if (!resp?.success) throw new Error(resp?.error || 'Falha desconhecida na extração');
      state.members = Array.isArray(resp.members) ? resp.members : [];
      if (resp.groupName) state.lastGroupName = resp.groupName;
      setStatus(`✅ ${state.members.length} membros extraídos`, 'ok');
      setProgress(100, 'Concluído');
      setTimeout(() => setProgress(0, ''), 1500);
      renderMembers();
    } catch (e) {
      setStatus(`❌ ${e.message}`, 'error');
      setProgress(0, '');
    } finally {
      state.isExtracting = false;
      if (btn) { btn.disabled = false; btn.textContent = '📥 Extrair Membros'; }
    }
  }

  // ===== Export =====
  // O exporter google-sheets-export.js (utils/) espera objetos com
  // {name, phone, isAdmin, extractedAt}. Como WhatsAppExtractor v4.0 só
  // devolve strings de telefone, normalizamos aqui antes de exportar.
  function normalizedForExport() {
    const now = Date.now();
    return {
      groupName: state.lastGroupName || 'Grupo',
      isArchived: false,
      members: state.members.map(phone => ({
        name: phone,
        phone,
        isAdmin: false,
        extractedAt: now,
      })),
    };
  }

  function safeFilename(name) {
    const slug = String(name || 'grupo').replace(/[^\w\-]+/g, '_').slice(0, 60);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    return `membros_${slug}_${stamp}`;
  }

  function exportCSV() {
    if (!state.members.length) return setStatus('Nada a exportar', 'error');
    if (typeof window.downloadAsCSV !== 'function') return setStatus('Exporter CSV não carregado', 'error');
    try {
      window.downloadAsCSV(normalizedForExport(), safeFilename(state.lastGroupName) + '.csv');
      setStatus('✅ CSV baixado', 'ok');
    } catch (e) { setStatus('❌ ' + e.message, 'error'); }
  }

  function exportXLSX() {
    if (!state.members.length) return setStatus('Nada a exportar', 'error');
    if (typeof window.XLSX === 'undefined') return setStatus('Biblioteca XLSX não carregada', 'error');
    try {
      const data = normalizedForExport();
      const headers = ['Nome', 'Telefone', 'Admin', 'Grupo', 'Status', 'Data'];
      const rows = data.members.map(m => [
        m.name, m.phone, m.isAdmin ? 'Sim' : 'Não',
        data.groupName, data.isArchived ? 'Arquivado' : 'Ativo',
        new Date(m.extractedAt).toLocaleString('pt-BR'),
      ]);
      const wb = window.XLSX.utils.book_new();
      const ws = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);
      window.XLSX.utils.book_append_sheet(wb, ws, 'Membros');
      window.XLSX.writeFile(wb, safeFilename(state.lastGroupName) + '.xlsx');
      setStatus('✅ XLSX baixado', 'ok');
    } catch (e) { setStatus('❌ ' + e.message, 'error'); }
  }

  async function exportSheets() {
    if (!state.members.length) return setStatus('Nada a exportar', 'error');
    if (!window.GoogleSheetsExporter) return setStatus('Exporter Sheets não carregado', 'error');
    try {
      const exporter = new window.GoogleSheetsExporter();
      const result = await exporter.copyForSheets(normalizedForExport());
      if (result?.success === false) throw new Error(result.error || 'Falha ao copiar TSV');
      // Abre o Google Sheets em nova aba pra colagem manual (clipboard já foi setado)
      window.open('https://docs.google.com/spreadsheets/create', '_blank');
      setStatus('✅ Dados copiados — cole (Ctrl+V) na planilha que abriu', 'ok');
    } catch (e) { setStatus('❌ ' + e.message, 'error'); }
  }

  async function copyPhones() {
    if (!state.members.length) return setStatus('Nada a copiar', 'error');
    try {
      await navigator.clipboard.writeText(state.members.join('\n'));
      setStatus(`✅ ${state.members.length} telefones copiados`, 'ok');
    } catch (e) { setStatus('❌ ' + e.message, 'error'); }
  }

  // ===== Lifecycle =====
  function bindOnce() {
    bindProgressListener();
    $('grp-load-btn')?.addEventListener('click', loadGroups);
    $('grp-extract-btn')?.addEventListener('click', extractMembers);
    $('grp-export-csv')?.addEventListener('click', exportCSV);
    $('grp-export-xlsx')?.addEventListener('click', exportXLSX);
    $('grp-export-sheets')?.addEventListener('click', exportSheets);
    $('grp-copy-phones')?.addEventListener('click', copyPhones);
    const search = $('grp-search');
    if (search) {
      search.addEventListener('input', (e) => {
        state.filter = e.target.value || '';
        renderList();
      });
    }
  }
  let bound = false;
  function init() {
    if (!bound) { bindOnce(); bound = true; }
    renderList();
    renderMembers();
    // Carrega grupos automaticamente na primeira abertura da view
    if (!state.groups.length) loadGroups();
  }

  window.GroupsManager = { init, loadGroups, extractMembers, getState: () => state };
})();
