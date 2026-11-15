/**
 * 🌐 WHL Endpoints - Defaults centralizados
 *
 * Objetivo:
 * - Evitar URLs hardcoded espalhadas pelo código
 * - Facilitar override por storage/config (sem quebrar dev)
 *
 * Compatível com content scripts (window) e service worker (globalThis).
 */
(function() {
  'use strict';

  const ROOT = (typeof window !== 'undefined') ? window : globalThis;

  // Pode ser sobrescrito em runtime via storage/config.
  //
  // BACKEND_FALLBACKS: contém SÓ a URL canônica. Antes incluía
  // 'http://localhost:3001' como fallback — porta fantasma que ninguém
  // roda em dev. Resultado: falha transiente em :3000 disparava failover
  // pra :3001, ERR_CONNECTION_REFUSED em loop, e a extensão ficava presa
  // numa URL morta. Pra setup com hosts redundantes em produção, sobrescreva
  // WHL_ENDPOINTS.BACKEND_FALLBACKS antes deste módulo carregar.
  // LGP-01: o padrão era SEMPRE http://localhost:3000 (com um "TODO: trocar
  // antes de publicar"). Instalada pela Chrome Web Store sem configurar nada, a
  // extensão apontava para a máquina do PRÓPRIO cliente — onde não há servidor
  // nenhum — e tudo (login, IA, sincronização) falhava em silêncio.
  //
  // Agora o padrão depende de COMO a extensão foi instalada:
  //   - pela Chrome Web Store (o manifesto ganha `update_url`) → servidor de
  //     produção, que o dono pode trocar com WHL_BACKEND_PRODUCTION antes de
  //     publicar, ou o cliente nas Configurações → Servidor;
  //   - carregada sem compactar (desenvolvimento) → localhost, como antes.
  const PRODUCTION_BACKEND = ROOT.WHL_BACKEND_PRODUCTION || 'https://api.whatshybrid.com.br';
  const DEV_BACKEND = 'http://localhost:3000';

  function instaladaPelaLoja() {
    try {
      return !!(typeof chrome !== 'undefined' && chrome.runtime
        && typeof chrome.runtime.getManifest === 'function'
        && chrome.runtime.getManifest().update_url);
    } catch (_) {
      return false;
    }
  }

  const BASE = instaladaPelaLoja() ? PRODUCTION_BACKEND : DEV_BACKEND;

  const DEFAULTS = {
    BACKEND_DEFAULT: BASE,
    BACKEND_FALLBACKS: [BASE],
    OLLAMA_CHAT: 'http://localhost:11434/api/chat'
  };

  ROOT.WHL_ENDPOINTS = ROOT.WHL_ENDPOINTS || DEFAULTS;

  // Merge não destrutivo (mantém overrides já presentes)
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (ROOT.WHL_ENDPOINTS[k] === undefined) ROOT.WHL_ENDPOINTS[k] = v;
  }
})();
