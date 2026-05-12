/**
 * RISK-002: Global XSS Prevention Utility
 * Sistema centralizado de sanitização para prevenir XSS
 *
 * ✅ Hardening adicional (Jan/2026):
 * - Sanitização de HTML (innerHTML / insertAdjacentHTML)
 * - Patch opcional de JSON.parse para evitar crash e prototype pollution
 *
 * @version 1.1.0
 */
(function() {
  'use strict';

  const ROOT = (typeof window !== 'undefined') ? window : globalThis;

  /**
   * Sanitizador global
   */
  class Sanitizer {
    /**
     * Escapa HTML para prevenir XSS
     * @param {string} str
     * @returns {string}
     */
    static escapeHtml(str) {
      if (str === null || str === undefined) return '';
      if (typeof str !== 'string') str = String(str);

      const htmlEscapeMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;'
      };

      return str.replace(/[&<>"'\/]/g, (char) => htmlEscapeMap[char]);
    }

    /**
     * Sanitiza atributos HTML (remove aspas e caracteres perigosos)
     * @param {string} attr
     * @returns {string}
     */
    static sanitizeAttribute(attr) {
      if (attr === null || attr === undefined) return '';
      return String(attr).replace(/['"<>]/g, '');
    }

    /**
     * Valida e sanitiza URL para prevenir javascript: e data:text/html
     * @param {string} url
     * @returns {string|null}
     */
    static sanitizeUrl(url) {
      if (!url || typeof url !== 'string') return null;

      const raw = url.trim();
      const low = raw.toLowerCase();

      // Bloquear URIs perigosas
      if (low.startsWith('javascript:') ||
          low.startsWith('vbscript:') ||
          low.startsWith('data:text/html')) {
        ROOT.WHLLogger?.warn?.('[Sanitizer] URL potencialmente maliciosa bloqueada:', url);
        return null;
      }

      try {
        const parsed = new URL(raw, (typeof window !== 'undefined' ? window.location.origin : 'http://localhost'));

        // Permitir apenas protocolos seguros
        const safeProtocols = ['http:', 'https:', 'blob:', 'data:', 'chrome-extension:'];
        if (!safeProtocols.includes(parsed.protocol)) {
          ROOT.WHLLogger?.warn?.('[Sanitizer] URL com protocolo não seguro bloqueada:', url);
          return null;
        }

        return raw;
      } catch (e) {
        ROOT.WHLLogger?.warn?.('[Sanitizer] URL inválida:', url);
        return null;
      }
    }

    /**
     * Sanitiza ID para uso em DOM
     * @param {any} id
     * @returns {string|number}
     */
    static sanitizeId(id) {
      if (typeof id === 'number') return id;

      const parsed = parseInt(id, 10);
      if (!Number.isNaN(parsed)) return parsed;

      return String(id).replace(/[^a-zA-Z0-9_-]/g, '');
    }

    /**
     * Sanitiza JSON parseado para prevenir prototype pollution
     * (corrigido: não usar data.__proto__ diretamente, pois sempre é truthy)
     * @param {any} data
     * @returns {any}
     */
    static sanitizeJson(data) {
      if (data === null || typeof data !== 'object') return data;

      // Arrays: sanitizar cada item
      if (Array.isArray(data)) {
        return data.map(item => this.sanitizeJson(item));
      }

      // Permitir apenas objetos "plain" (prototype Object.prototype ou null)
      const proto = Object.getPrototypeOf(data);
      if (proto !== Object.prototype && proto !== null) {
        throw new Error('Unexpected prototype in parsed JSON');
      }

      const hasOwn = Object.prototype.hasOwnProperty;

      // Bloquear chaves perigosas (apenas se forem próprias)
      if (hasOwn.call(data, '__proto__') || hasOwn.call(data, 'constructor') || hasOwn.call(data, 'prototype')) {
        throw new Error('Prototype pollution attempt detected');
      }

      const sanitized = {};
      for (const key of Object.keys(data)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        sanitized[key] = this.sanitizeJson(data[key]);
      }

      return sanitized;
    }

    /**
     * Remove scripts inline de string HTML (regex básica)
     * @param {string} html
     * @returns {string}
     */
    static stripScripts(html) {
      if (!html || typeof html !== 'string') return '';

      // Remover tags script
      let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

      // Remover event handlers inline
      clean = clean.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
      clean = clean.replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '');

      // Remover javascript: em hrefs/src
      clean = clean.replace(/(href|src)\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, '$1="#"');

      return clean;
    }

    /**
     * Sanitiza HTML usando DOM (mais robusto que apenas regex)
     * - remove tags perigosas
     * - remove atributos on*
     * - valida href/src
     * - remove style (evita vetores antigos)
     *
     * @param {string} html
     * @returns {string}
     */
    static sanitizeHTML(html) {
      if (html === null || html === undefined) return '';
      const raw = (typeof html === 'string') ? html : String(html);
      const pre = this.stripScripts(raw);

      // Sem DOM disponível (ex: ambiente não-browser)
      if (typeof document === 'undefined' || !document.createElement) {
        return pre;
      }

      try {
        const tpl = document.createElement('template');
        tpl.innerHTML = pre;

        const forbiddenTags = new Set(['script', 'iframe', 'object', 'embed', 'link', 'meta']);

        const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT, null);
        let node;
        while ((node = walker.nextNode())) {
          const tag = (node.tagName || '').toLowerCase();
          if (forbiddenTags.has(tag)) {
            node.remove();
            continue;
          }

          // Remover atributos perigosos
          const attrs = Array.from(node.attributes || []);
          for (const attr of attrs) {
            const name = (attr.name || '').toLowerCase();
            const value = attr.value;

            if (name.startsWith('on')) {
              node.removeAttribute(attr.name);
              continue;
            }

            if (name === 'style') {
              // Hardening: remover estilos inline (reduz vetores antigos e evita injeção)
              node.removeAttribute('style');
              continue;
            }

            if (name === 'href' || name === 'src' || name === 'xlink:href') {
              const safe = this.sanitizeUrl(value);
              if (!safe) {
                node.removeAttribute(attr.name);
              }
            }
          }
        }

        return tpl.innerHTML;
      } catch (e) {
        ROOT.WHLLogger?.warn?.('[Sanitizer] sanitizeHTML falhou; aplicando stripScripts():', e?.message || e);
        return pre;
      }
    }

    /**
     * Cria um node de texto seguro
     * @param {string} text
     * @returns {Text}
     */
    static createTextNode(text) {
      return document.createTextNode(text || '');
    }

    /**
     * Define atributo de forma segura
     * @param {HTMLElement} element
     * @param {string} attr
     * @param {string} value
     */
    static setAttribute(element, attr, value) {
      if (!element || !attr) return;

      const safeAttrs = ['id', 'class', 'data-id', 'title', 'aria-label', 'role', 'tabindex'];
      if (!safeAttrs.includes(String(attr).toLowerCase())) {
        ROOT.WHLLogger?.warn?.('[Sanitizer] Atributo não seguro bloqueado:', attr);
        return;
      }

      element.setAttribute(attr, this.sanitizeAttribute(value));
    }

    /**
     * Define textContent de forma segura
     * @param {HTMLElement} element
     * @param {string} text
     */
    static setTextContent(element, text) {
      if (!element) return;
      element.textContent = text || '';
    }

    /**
     * Helper: seta innerHTML sempre sanitizando
     * @param {HTMLElement} element
     * @param {string} html
     */
    static safeSetInnerHTML(element, html) {
      if (!element) return;
      element.innerHTML = this.sanitizeHTML(html);
    }

    /**
     * Valida e sanitiza mensagem do WhatsApp
     * @param {string} message
     * @returns {string}
     */
    static sanitizeWhatsAppMessage(message) {
      if (!message || typeof message !== 'string') return '';

      let sanitized = message
        .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '')
        .replace(/\u200B/g, '')
        .replace(/\uFEFF/g, '');

      if (sanitized.length > 65536) {
        sanitized = sanitized.substring(0, 65536);
      }

      return sanitized;
    }

    /**
     * Valida número de telefone
     * @param {string} phone
     * @returns {string|null}
     */
    static sanitizePhone(phone) {
      if (!phone) return null;

      const clean = String(phone).replace(/[^\d+]/g, '');
      if (clean.length < 10 || clean.length > 15) return null;
      return clean;
    }

    /**
     * Instala patches de DOM para reduzir risco de XSS em usos de innerHTML/insertAdjacentHTML
     *
     * FIX v1.1.1: Guarda de re-entrância (__WHL_SANITIZING) para evitar loop infinito.
     * sanitizeHTML() internamente faz `tpl.innerHTML = ...`, que acionaria o
     * próprio setter novamente → Maximum call stack size exceeded → painel não aparece.
     */
    static installDomPatches() {
      if (ROOT.__WHL_SANITIZER_DOM_PATCHED) return;

      if (typeof Element !== 'undefined') {
        // Patch innerHTML
        try {
          const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
          if (desc?.set && desc?.get) {
            Object.defineProperty(Element.prototype, 'innerHTML', {
              configurable: true,
              enumerable: desc.enumerable,
              get: function() { return desc.get.call(this); },
              set: function(value) {
                // Guarda de re-entrância: evita recursão infinita quando
                // sanitizeHTML() faz tpl.innerHTML = ... internamente
                if (ROOT.__WHL_SANITIZING) {
                  return desc.set.call(this, value);
                }
                try {
                  const str = (value === null || value === undefined) ? '' : String(value);
                  ROOT.__WHL_SANITIZING = true;
                  const sanitized = Sanitizer.sanitizeHTML(str);
                  ROOT.__WHL_SANITIZING = false;
                  return desc.set.call(this, sanitized);
                } catch (e) {
                  ROOT.__WHL_SANITIZING = false;
                  // Fallback: não bloquear o app por falha de sanitização
                  ROOT.WHLLogger?.warn?.('[Sanitizer] Falha ao sanitizar innerHTML; aplicando valor original.', e?.message || e);
                  return desc.set.call(this, value);
                }
              }
            });
          }
        } catch (e) {
          ROOT.WHLLogger?.warn?.('[Sanitizer] Não foi possível patchar innerHTML:', e?.message || e);
        }

        // Patch insertAdjacentHTML
        try {
          const nativeInsert = Element.prototype.insertAdjacentHTML;
          if (typeof nativeInsert === 'function') {
            Element.prototype.insertAdjacentHTML = function(position, text) {
              if (ROOT.__WHL_SANITIZING) {
                return nativeInsert.call(this, position, text);
              }
              try {
                const str = (text === null || text === undefined) ? '' : String(text);
                ROOT.__WHL_SANITIZING = true;
                const sanitized = Sanitizer.sanitizeHTML(str);
                ROOT.__WHL_SANITIZING = false;
                return nativeInsert.call(this, position, sanitized);
              } catch (e) {
                ROOT.__WHL_SANITIZING = false;
                ROOT.WHLLogger?.warn?.('[Sanitizer] Falha ao sanitizar insertAdjacentHTML; aplicando texto original.', e?.message || e);
                return nativeInsert.call(this, position, text);
              }
            };
          }
        } catch (e) {
          ROOT.WHLLogger?.warn?.('[Sanitizer] Não foi possível patchar insertAdjacentHTML:', e?.message || e);
        }
      }

      ROOT.__WHL_SANITIZER_DOM_PATCHED = true;
    }

    /**
     * Instala patch de JSON.parse (evita crash e reduz risco de prototype pollution)
     */
    static installJsonParsePatch() {
      if (ROOT.__WHL_JSON_PARSE_PATCHED) return;

      const nativeParse = JSON.parse.bind(JSON);
      ROOT.__WHL_NATIVE_JSON_PARSE = nativeParse;

      JSON.parse = function(text, reviver) {
        try {
          const parsed = nativeParse(text, reviver);
          return Sanitizer.sanitizeJson(parsed);
        } catch (e) {
          // Não crashar a extensão por dados malformados
          ROOT.WHLLogger?.warn?.('[Sanitizer] JSON.parse falhou:', e?.message || e);
          return null;
        }
      };

      ROOT.__WHL_JSON_PARSE_PATCHED = true;
    }
  }

  // Exportar
  ROOT.Sanitizer = Sanitizer;

  // Compat
  if (!ROOT.escapeHtml) {
    ROOT.escapeHtml = (str) => Sanitizer.escapeHtml(str);
  }

  // Instalar patches
  try { Sanitizer.installDomPatches(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
  try { Sanitizer.installJsonParsePatch(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

  ROOT.WHLLogger?.info?.('[Sanitizer] ✅ Sistema global de sanitização XSS inicializado (v1.1.0)');
})();
