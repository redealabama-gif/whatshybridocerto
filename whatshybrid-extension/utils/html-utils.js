/**
 * Utilitários HTML Centralizados
 * WhatsHybrid v7.9.12
 */
(function() {
  'use strict';

  const HTML_ESCAPE_MAP = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;', '/': '&#x2F;'
  };

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"'\/]/g, char => HTML_ESCAPE_MAP[char]);
  }

  function stripHtml(str) {
    if (!str) return '';
    return String(str).replace(/<[^>]*>/g, '');
  }

  function sanitizeHtml(str) {
    // Implementação básica de sanitização
    return escapeHtml(str);
  }

  function nl2br(str) {
    if (!str) return '';
    return escapeHtml(str).replace(/\n/g, '<br>');
  }

  window.WHLHtmlUtils = { escapeHtml, stripHtml, sanitizeHtml, nl2br };
  window.escapeHtml = escapeHtml; // Alias para compatibilidade
})();