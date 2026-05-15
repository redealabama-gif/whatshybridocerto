// filepicker.js — janela auxiliar de seleção de arquivos.
//
// O painel lateral do Chrome (chrome.sidePanel) não abre o seletor de arquivos
// nativo do sistema. Esta página é aberta numa janela popup normal — onde o
// <input type=file> funciona — escolhe o arquivo, lê o conteúdo e devolve o
// resultado ao painel lateral via chrome.runtime.sendMessage.

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const requestId = params.get('requestId') || '';
  const accept = params.get('accept') || '';
  const kind = params.get('kind') || 'file';

  const MAX_BYTES = 32 * 1024 * 1024; // teto de sanidade; limites por tipo ficam no painel

  const LABELS = {
    image: 'Selecionar imagem',
    audio: 'Selecionar áudio',
    csv: 'Selecionar arquivo CSV',
    file: 'Selecionar arquivo',
  };

  const input = document.getElementById('fp_input');
  const btn = document.getElementById('fp_btn');
  const statusEl = document.getElementById('fp_status');
  const titleEl = document.getElementById('fp_title');

  if (accept) input.accept = accept;
  const label = LABELS[kind] || LABELS.file;
  btn.textContent = label;
  titleEl.textContent = label;

  let done = false;

  function send(payload) {
    try {
      chrome.runtime.sendMessage(Object.assign({ action: 'WHL_FILEPICKER_RESULT', requestId }, payload));
    } catch (e) {
      // O painel lateral pode ter sido fechado — nada a fazer aqui.
    }
    // Limpeza de janela órfã. O painel normalmente fecha esta janela bem antes.
    setTimeout(function () { try { window.close(); } catch (_) {} }, 1500);
  }

  btn.addEventListener('click', function () {
    if (done) return;
    input.click();
  });

  input.addEventListener('change', function () {
    const file = input.files && input.files[0];
    if (!file || done) return;

    if (file.size > MAX_BYTES) {
      statusEl.textContent = '❌ Arquivo muito grande (' + (file.size / 1024 / 1024).toFixed(1) + 'MB). Máximo: 32MB.';
      input.value = '';
      return;
    }

    done = true;
    btn.disabled = true;
    statusEl.textContent = '⏳ Lendo arquivo...';

    const reader = new FileReader();
    reader.onload = function () {
      statusEl.textContent = '✅ Pronto! Voltando ao painel...';
      send({
        ok: true,
        name: file.name,
        type: file.type || '',
        size: file.size,
        dataUrl: String(reader.result || ''),
      });
    };
    reader.onerror = function () {
      done = false;
      btn.disabled = false;
      statusEl.textContent = '❌ Erro ao ler o arquivo.';
      send({ ok: false, error: 'Falha ao ler o arquivo.' });
    };
    reader.readAsDataURL(file);
  });
})();
