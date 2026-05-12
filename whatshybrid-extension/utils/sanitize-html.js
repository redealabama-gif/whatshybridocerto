/**
 * sanitize-html.js
 * WhatsHybrid Pro — Utilitário de sanitização de HTML
 *
 * Expõe window.WHL_SanitizeHtml com métodos de sanitização seguros.
 * Compatível com CSP da extensão (sem eval, sem Function constructor).
 */
(function() {
  'use strict';

  // Tags permitidas para renderização segura
  const ALLOWED_TAGS = new Set([
    'b', 'i', 'em', 'strong', 'u', 's', 'br', 'p', 'span',
    'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote', 'hr', 'small'
  ]);

  // Atributos permitidos por tag
  const ALLOWED_ATTRS = {
    'a': ['href', 'title', 'target'],
    '*': ['class', 'style', 'id', 'title']
  };

  // Protocolos seguros para href
  const SAFE_PROTOCOLS = /^(https?|mailto|tel):/i;

  /**
   * Sanitiza uma string HTML, removendo tags e atributos perigosos.
   * @param {string} html - HTML a ser sanitizado
   * @param {Object} [opts] - Opções
   * @param {Set} [opts.allowedTags] - Tags permitidas
   * @returns {string} HTML seguro
   */
  function sanitize(html, opts = {}) {
    if (!html || typeof html !== 'string') return '';

    const allowed = opts.allowedTags || ALLOWED_TAGS;

    // Usar DOMParser de forma segura para parsear
    const parser = new DOMParser();
    let doc;
    try {
      doc = parser.parseFromString(html, 'text/html');
    } catch (e) {
      // Fallback: só escapar
      return escapeHtml(html);
    }

    function cleanNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return document.createTextNode(node.textContent);
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return null;

      const tagName = node.tagName.toLowerCase();

      // Tag não permitida → só manter conteúdo de texto
      if (!allowed.has(tagName)) {
        const frag = document.createDocumentFragment();
        for (const child of Array.from(node.childNodes)) {
          const cleaned = cleanNode(child);
          if (cleaned) frag.appendChild(cleaned);
        }
        return frag;
      }

      const el = document.createElement(tagName);

      // Copiar atributos permitidos
      const tagAttrs = ALLOWED_ATTRS[tagName] || [];
      const globalAttrs = ALLOWED_ATTRS['*'] || [];
      const permittedAttrs = new Set([...tagAttrs, ...globalAttrs]);

      for (const attr of Array.from(node.attributes)) {
        if (!permittedAttrs.has(attr.name)) continue;

        // Validar href para links
        if (attr.name === 'href') {
          if (!SAFE_PROTOCOLS.test(attr.value.trim())) continue;
        }

        // Bloquear event handlers inline
        if (attr.name.startsWith('on')) continue;

        // Bloquear javascript: em qualquer atributo
        if (typeof attr.value === 'string' && /javascript:/i.test(attr.value)) continue;

        el.setAttribute(attr.name, attr.value);
      }

      // Para links externos, adicionar rel e target seguros
      if (tagName === 'a') {
        el.setAttribute('rel', 'noopener noreferrer');
        if (!el.getAttribute('target')) el.setAttribute('target', '_blank');
      }

      // Processar filhos recursivamente
      for (const child of Array.from(node.childNodes)) {
        const cleaned = cleanNode(child);
        if (cleaned) el.appendChild(cleaned);
      }

      return el;
    }

    const result = document.createElement('div');
    for (const child of Array.from(doc.body.childNodes)) {
      const cleaned = cleanNode(child);
      if (cleaned) result.appendChild(cleaned);
    }

    return result.innerHTML;
  }

  /**
   * Escapa caracteres HTML especiais (sem parsing).
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Remove todas as tags HTML, retornando só texto.
   * @param {string} html
   * @returns {string}
   */
  function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }

  /**
   * Sanitiza e converte quebras de linha em <br>.
   * @param {string} text
   * @returns {string}
   */
  function textToSafeHtml(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  // Exportar como window global
  window.WHL_SanitizeHtml = {
    sanitize,
    escapeHtml,
    stripHtml,
    textToSafeHtml,
  };

  // Compat: reexportar via WHLHtmlUtils se já existir (merge seguro)
  if (window.WHLHtmlUtils) {
    window.WHLHtmlUtils.sanitizeHtml = sanitize;
    window.WHLHtmlUtils.stripHtml = window.WHLHtmlUtils.stripHtml || stripHtml;
  }

  // Log de inicialização
  if (typeof console !== 'undefined') {
    console.log('[WHL] ✅ sanitize-html.js carregado');
  }
})();
