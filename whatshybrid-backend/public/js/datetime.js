/**
 * WhatsHybrid Datetime Helper — v9.2.0
 *
 * Converte timestamps UTC do backend pra timezone local do usuário.
 *
 * Backend SEMPRE retorna UTC (CURRENT_TIMESTAMP). Frontend converte
 * usando Intl.DateTimeFormat (sem deps).
 *
 * Uso:
 *   WHL_DateTime.format('2026-05-07T22:00:00Z')
 *   → "07/05/2026 19:00" (se user está em UTC-3)
 *
 *   WHL_DateTime.relative('2026-05-07T22:00:00Z')
 *   → "há 3 minutos"
 *
 *   WHL_DateTime.applyAll()
 *   → procura elementos com data-utc="..." e formata textContent
 */

(function() {
  'use strict';

  const detectLocale = () => {
    try { return localStorage.getItem('whl_lang') || navigator.language || 'pt-BR'; }
    catch (_) { return 'pt-BR'; }
  };

  function format(utcString, options = {}) {
    if (!utcString) return '';
    try {
      const d = new Date(utcString);
      if (isNaN(d.getTime())) return utcString;

      const locale = detectLocale();
      const fmt = new Intl.DateTimeFormat(locale, {
        dateStyle: options.dateStyle || 'short',
        timeStyle: options.timeStyle || 'short',
        timeZone: options.timeZone || undefined, // undefined = browser default
        ...options,
      });
      return fmt.format(d);
    } catch (e) {
      return utcString;
    }
  }

  function formatDate(utcString) {
    return format(utcString, { dateStyle: 'short', timeStyle: undefined });
  }

  function formatTime(utcString) {
    return format(utcString, { dateStyle: undefined, timeStyle: 'short' });
  }

  function formatLong(utcString) {
    return format(utcString, { dateStyle: 'long', timeStyle: 'medium' });
  }

  /**
   * Tempo relativo: "há 3 minutos", "ontem", "em 2 horas"
   */
  function relative(utcString) {
    if (!utcString) return '';
    try {
      const d = new Date(utcString);
      if (isNaN(d.getTime())) return utcString;
      const diffMs = d.getTime() - Date.now();
      const absSeconds = Math.abs(diffMs / 1000);
      const locale = detectLocale();
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

      if (absSeconds < 60) return rtf.format(Math.round(diffMs / 1000), 'second');
      if (absSeconds < 3600) return rtf.format(Math.round(diffMs / 60000), 'minute');
      if (absSeconds < 86400) return rtf.format(Math.round(diffMs / 3600000), 'hour');
      if (absSeconds < 86400 * 7) return rtf.format(Math.round(diffMs / 86400000), 'day');
      if (absSeconds < 86400 * 30) return rtf.format(Math.round(diffMs / (86400000 * 7)), 'week');
      if (absSeconds < 86400 * 365) return rtf.format(Math.round(diffMs / (86400000 * 30)), 'month');
      return rtf.format(Math.round(diffMs / (86400000 * 365)), 'year');
    } catch (_) {
      return utcString;
    }
  }

  /**
   * Formata moeda BRL/USD/EUR (usa locale do user)
   */
  function currency(amount, ccy = 'BRL') {
    try {
      const locale = detectLocale();
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: ccy,
      }).format(amount);
    } catch (_) {
      return `${ccy} ${amount}`;
    }
  }

  /**
   * Formata número com separadores locais
   */
  function number(n, opts = {}) {
    try {
      const locale = detectLocale();
      return new Intl.NumberFormat(locale, opts).format(n);
    } catch (_) {
      return String(n);
    }
  }

  /**
   * Aplica formatação em todos elementos com data-utc atributo
   *
   * Ex: <span data-utc="2026-05-07T22:00:00Z" data-utc-format="relative">
   *     → "há 3 minutos"
   */
  function applyAll(root = document) {
    root.querySelectorAll('[data-utc]').forEach(el => {
      const utc = el.getAttribute('data-utc');
      const formatType = el.getAttribute('data-utc-format') || 'datetime';
      let formatted;

      switch (formatType) {
        case 'relative': formatted = relative(utc); break;
        case 'date':     formatted = formatDate(utc); break;
        case 'time':     formatted = formatTime(utc); break;
        case 'long':     formatted = formatLong(utc); break;
        default:         formatted = format(utc);
      }

      el.textContent = formatted;
      // Atributo title pra mostrar UTC no hover
      if (!el.hasAttribute('title')) {
        el.setAttribute('title', new Date(utc).toLocaleString());
      }
    });
  }

  // Auto-aplica quando DOM pronto + a cada minuto pra atualizar relativos
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      applyAll();
      setInterval(applyAll, 60_000);
    });
  } else {
    applyAll();
    setInterval(applyAll, 60_000);
  }

  window.WHL_DateTime = {
    format, formatDate, formatTime, formatLong,
    relative, currency, number, applyAll,
  };
})();
