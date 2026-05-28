/**
 * marketing-attribution.js — captura de atribuição de marketing (first-touch).
 *
 * Roda automaticamente no carregamento. Salva UTMs + click IDs + referrer +
 * URL de chegada em localStorage['whl_attribution'] na PRIMEIRA visita.
 *
 * Estratégia first-touch: visitas seguintes preservam o registro original.
 * Útil em SaaS onde o ciclo decisão → signup costuma ter múltiplas visitas
 * e quem traz o usuário é a primeira fonte (não a última).
 *
 * Uso:
 *   window.WHLAttribution.get()    // retorna o objeto guardado (ou null)
 *   window.WHLAttribution.clear()  // limpa (depois de signup confirmado, p.ex.)
 *
 * Para alternar para last-touch, basta remover o `if (existing) return existing;`
 * dentro de captureIfFirstTouch.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'whl_attribution';
  var MARKETING_PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'fbclid', 'gclid', 'ttclid', 'msclkid', 'ref'
  ];

  function readQueryParams() {
    var out = {};
    try {
      var qs = new URLSearchParams(window.location.search);
      MARKETING_PARAMS.forEach(function (key) {
        var val = qs.get(key);
        if (val) out[key] = val;
      });
    } catch (_) {}
    return out;
  }

  // Extrai client_id do GA4 a partir do cookie _ga. Formato típico:
  //   _ga = "GA1.1.<random>.<creation_ts>"
  // GA4 MP espera o client_id como "<random>.<creation_ts>".
  // Se o cookie ainda não foi setado (gtag.js não rodou), retorna null.
  function readGaClientId() {
    try {
      var match = document.cookie.match(/(?:^|;\s*)_ga=([^;]+)/);
      if (!match) return null;
      var raw = decodeURIComponent(match[1]);
      var m = raw.match(/^GA\d+\.\d+\.(.+)$/);
      return m ? m[1] : raw;
    } catch (_) { return null; }
  }

  function loadStored() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function saveStored(obj) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); }
    catch (_) {}
  }

  function hasExternalReferrer() {
    if (!document.referrer) return false;
    try {
      var ref = new URL(document.referrer);
      return ref.hostname !== window.location.hostname;
    } catch (_) { return false; }
  }

  function captureIfFirstTouch() {
    var existing = loadStored();
    if (existing) {
      // Mesmo em visita repetida, atualiza o ga_client_id se ainda não tem
      // (o cookie _ga só existe depois que o gtag.js carregar, então pode
      // estar ausente no first-touch). Isso preserva first-touch dos UTMs
      // mas garante que o client_id do GA esteja sempre presente.
      if (!existing.ga_client_id) {
        var cid = readGaClientId();
        if (cid) {
          existing.ga_client_id = cid;
          saveStored(existing);
        }
      }
      return existing;
    }

    var params = readQueryParams();
    var hasMarketingParams = Object.keys(params).length > 0;

    // Sem UTMs e sem referrer externo: não vale guardar registro vazio.
    if (!hasMarketingParams && !hasExternalReferrer()) return null;

    var record = Object.assign({}, params, {
      landing_url: window.location.href,
      landing_path: window.location.pathname,
      referrer: document.referrer || null,
      ga_client_id: readGaClientId(),
      captured_at: new Date().toISOString()
    });
    saveStored(record);
    return record;
  }

  window.WHLAttribution = {
    get: function () { return loadStored(); },
    clear: function () { try { localStorage.removeItem(STORAGE_KEY); } catch (_) {} },
    _captured: captureIfFirstTouch()
  };

  // _ga é setado de forma assíncrona pelo gtag.js (depois do load). Tentamos
  // capturar novamente em ~2s para registros criados antes do cookie existir.
  setTimeout(function () {
    var existing = loadStored();
    if (existing && !existing.ga_client_id) {
      var cid = readGaClientId();
      if (cid) {
        existing.ga_client_id = cid;
        saveStored(existing);
      }
    }
  }, 2000);
})();
