/**
 * I18n Service — v9.0.0
 *
 * Sistema simples de internacionalização sem dependências externas.
 * Carrega traduções de /locales/{locale}/common.json e expõe API:
 *   t('key.path') → string traduzida
 *   t('key', { var: 'value' }) → interpolação
 *
 * Detecta locale via:
 *   1. ?lang= query param
 *   2. user.preferred_language (se logado)
 *   3. Accept-Language header
 *   4. Fallback: pt-BR
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const LOCALES_DIR = path.join(__dirname, '../../locales');
const FALLBACK_LOCALE = 'pt-BR';
const SUPPORTED_LOCALES = ['pt-BR', 'en-US', 'es-ES'];

const translations = {};

function load() {
  for (const locale of SUPPORTED_LOCALES) {
    const dir = path.join(LOCALES_DIR, locale);
    if (!fs.existsSync(dir)) continue;
    translations[locale] = {};
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.json')) {
        const ns = path.basename(file, '.json');
        try {
          translations[locale][ns] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        } catch (e) {
          logger.warn(`[i18n] Failed loading ${locale}/${file}: ${e.message}`);
        }
      }
    }
  }
  logger.info(`[i18n] Loaded ${SUPPORTED_LOCALES.length} locales`);
}

function getValue(obj, keyPath) {
  return keyPath.split('.').reduce((acc, k) => acc?.[k], obj);
}

function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

/**
 * Traduz uma chave (formato 'namespace.path.to.key' ou 'common.path' implícito)
 */
function translate(key, locale = FALLBACK_LOCALE, vars = null) {
  const [maybeNs, ...rest] = key.split('.');
  const ns = translations[locale]?.[maybeNs] ? maybeNs : 'common';
  const realKey = ns === maybeNs ? rest.join('.') : key;

  let value = getValue(translations[locale]?.[ns], realKey);

  // Fallback se não encontrar
  if (value === undefined && locale !== FALLBACK_LOCALE) {
    value = getValue(translations[FALLBACK_LOCALE]?.[ns], realKey);
  }

  if (value === undefined) return key;
  return interpolate(value, vars);
}

/**
 * Detecta locale da request
 */
function detectLocale(req) {
  // 1. ?lang query
  if (req.query?.lang && SUPPORTED_LOCALES.includes(req.query.lang)) {
    return req.query.lang;
  }

  // 2. user preferred (se autenticado)
  if (req.user?.preferred_language && SUPPORTED_LOCALES.includes(req.user.preferred_language)) {
    return req.user.preferred_language;
  }

  // 3. Accept-Language header
  const accept = req.headers?.['accept-language'];
  if (accept) {
    const wanted = accept.split(',').map(s => s.split(';')[0].trim());
    for (const w of wanted) {
      // Match exato primeiro
      if (SUPPORTED_LOCALES.includes(w)) return w;
      // Match por prefixo (pt → pt-BR, en → en-US)
      const prefixMatch = SUPPORTED_LOCALES.find(s => s.startsWith(w.split('-')[0]));
      if (prefixMatch) return prefixMatch;
    }
  }

  return FALLBACK_LOCALE;
}

/**
 * Express middleware que injeta req.t() e req.locale
 */
function middleware() {
  return (req, _res, next) => {
    req.locale = detectLocale(req);
    req.t = (key, vars) => translate(key, req.locale, vars);
    next();
  };
}

// Auto-load no require
load();

module.exports = {
  translate, t: translate, detectLocale, middleware, load,
  SUPPORTED_LOCALES, FALLBACK_LOCALE,
};
