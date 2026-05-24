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
  const DEFAULTS = {
    BACKEND_DEFAULT: 'http://localhost:3000',
    BACKEND_FALLBACKS: ['http://localhost:3000'],
    OLLAMA_CHAT: 'http://localhost:11434/api/chat'
  };

  ROOT.WHL_ENDPOINTS = ROOT.WHL_ENDPOINTS || DEFAULTS;

  // Merge não destrutivo (mantém overrides já presentes)
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (ROOT.WHL_ENDPOINTS[k] === undefined) ROOT.WHL_ENDPOINTS[k] = v;
  }
})();
