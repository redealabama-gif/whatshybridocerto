/**
 * WhatsHybrid Frontend i18n — v9.0.0
 *
 * Aplica traduções nos elementos com data-i18n="key" e data-i18n-placeholder="key".
 *
 * Uso no HTML:
 *   <h1 data-i18n="auth.welcome_back">Bem-vindo de volta</h1>
 *   <input data-i18n-placeholder="form.email" placeholder="Email">
 *
 * Idioma:
 *   1. ?lang=en-US no URL
 *   2. localStorage 'whl_lang'
 *   3. navigator.language
 *   4. fallback pt-BR
 *
 * APIs:
 *   window.WHL_I18n.t('key.path')           → traduz
 *   window.WHL_I18n.setLocale('en-US')       → muda idioma + persiste
 *   window.WHL_I18n.applyAll()               → re-aplica em toda página
 *   window.WHL_I18n.locale                   → idioma atual
 */

(function() {
  'use strict';

  const FALLBACK = 'pt-BR';
  const SUPPORTED = ['pt-BR', 'en-US', 'es-ES'];

  let translations = {};
  let currentLocale = FALLBACK;

  function detectLocale() {
    // 1. URL query param
    const urlParam = new URLSearchParams(window.location.search).get('lang');
    if (urlParam && SUPPORTED.includes(urlParam)) return urlParam;

    // 2. localStorage
    try {
      const stored = localStorage.getItem('whl_lang');
      if (stored && SUPPORTED.includes(stored)) return stored;
    } catch(_) {}

    // 3. navigator.language
    const nav = navigator.language || navigator.userLanguage || '';
    if (SUPPORTED.includes(nav)) return nav;

    // Match prefixo (pt → pt-BR)
    const prefix = nav.split('-')[0];
    const match = SUPPORTED.find(s => s.startsWith(prefix));
    if (match) return match;

    return FALLBACK;
  }

  async function loadTranslations(locale) {
    try {
      const response = await fetch(`/locales/${locale}/common.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      console.warn(`[i18n] Failed to load ${locale}:`, err.message);
      return null;
    }
  }

  function getValue(obj, path) {
    return path.split('.').reduce((acc, k) => acc?.[k], obj);
  }

  function interpolate(str, vars) {
    if (!vars || typeof str !== 'string') return str;
    return str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
  }

  function t(key, vars) {
    const [maybeNs, ...rest] = key.split('.');
    const ns = translations[maybeNs] ? maybeNs : 'common';
    const realKey = ns === maybeNs ? rest.join('.') : key;
    const value = getValue(translations[ns], realKey);
    if (value === undefined) return key;
    return interpolate(value, vars);
  }

  function applyAll() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const translated = t(key);
      if (translated && translated !== key) {
        el.textContent = translated;
      }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const translated = t(key);
      if (translated && translated !== key) {
        el.setAttribute('placeholder', translated);
      }
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      const translated = t(key);
      if (translated && translated !== key) {
        el.setAttribute('title', translated);
      }
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
      const key = el.getAttribute('data-i18n-aria-label');
      const translated = t(key);
      if (translated && translated !== key) {
        el.setAttribute('aria-label', translated);
      }
    });
  }

  async function setLocale(locale) {
    if (!SUPPORTED.includes(locale)) {
      console.warn(`[i18n] Unsupported locale: ${locale}`);
      return false;
    }
    const data = await loadTranslations(locale);
    if (!data) return false;
    translations = data;
    currentLocale = locale;
    document.documentElement.lang = locale;
    try { localStorage.setItem('whl_lang', locale); } catch(_) {}
    applyAll();

    // Notifica componentes
    window.dispatchEvent(new CustomEvent('whl:locale-changed', { detail: { locale } }));
    return true;
  }

  async function init() {
    const initial = detectLocale();
    await setLocale(initial);
  }

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose API
  window.WHL_I18n = {
    t,
    setLocale,
    applyAll,
    get locale() { return currentLocale; },
    get supported() { return [...SUPPORTED]; },
  };
})();
