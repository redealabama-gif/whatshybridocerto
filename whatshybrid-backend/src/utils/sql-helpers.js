/**
 * SQL Search Helpers — v9.3.7
 *
 * Sanitiza inputs de busca (LIKE) pra evitar:
 *   1. DoS via wildcards: `?search=%_%` faz scan completo da tabela
 *   2. Latência absurda: `?search=` com 100KB
 *   3. Falsos positivos: `?search=10%` (cliente quer "10%" literal, mas vira wildcard)
 *
 * Uso:
 *   const term = makeLikeTerm(req.query.search); // → '%foo%' escapado, ou null se inválido
 *   if (term) { sql += ' AND name LIKE ? ESCAPE ?'; params.push(term, '\\'); }
 */

const MAX_SEARCH_LENGTH = 100;

/**
 * Escapa wildcards `%` e `_` que são especiais em LIKE.
 * Retorna string com `\` antes desses caracteres.
 */
function escapeLikeWildcards(str) {
  return String(str).replace(/[\\%_]/g, '\\$&');
}

/**
 * Cria termo seguro pra LIKE %term%.
 * Retorna null se inválido (vazio, longo demais, não-string).
 *
 * Lembre de usar `LIKE ? ESCAPE '\\'` no SQL pra honrar o escape.
 */
function makeLikeTerm(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_SEARCH_LENGTH) return null;
  return `%${escapeLikeWildcards(trimmed)}%`;
}

/**
 * Valida e retorna number positivo (default fallback).
 * Pra ?page=, ?limit= que vão direto pro SQL.
 */
function safeInt(input, defaultValue, max = Infinity) {
  const n = parseInt(input, 10);
  if (!Number.isFinite(n) || n < 0) return defaultValue;
  return Math.min(n, max);
}

/**
 * v9.4.2: Valida string de input do user com limites razoáveis.
 * Retorna a string saneada (trim) ou throw AppError com 400.
 *
 * Uso comum:
 *   const title = safeString(req.body.title, { field: 'title', max: 200, required: true });
 *   const desc  = safeString(req.body.description, { field: 'description', max: 5000 });
 *
 * Por que isso importa: body parser global aceita 10MB. Sem validação no
 * endpoint, cliente manda título/descrição de 9MB → DB grava → response
 * gigante volta pro frontend → DoS lento + storage waste.
 */
function safeString(input, { field = 'field', max = 1000, min = 0, required = false } = {}) {
  if (input === undefined || input === null || input === '') {
    if (required) {
      const e = new Error(`${field} é obrigatório`);
      e.statusCode = 400;
      e.code = 'VALIDATION_ERROR';
      throw e;
    }
    return null;
  }
  if (typeof input !== 'string') {
    const e = new Error(`${field} deve ser string`);
    e.statusCode = 400;
    e.code = 'VALIDATION_ERROR';
    throw e;
  }
  const trimmed = input.trim();
  if (trimmed.length < min) {
    const e = new Error(`${field} muito curto (min ${min} chars)`);
    e.statusCode = 400;
    e.code = 'VALIDATION_ERROR';
    throw e;
  }
  if (trimmed.length > max) {
    const e = new Error(`${field} muito longo (max ${max} chars)`);
    e.statusCode = 400;
    e.code = 'VALIDATION_ERROR';
    throw e;
  }
  return trimmed;
}

/**
 * Valida que value está numa whitelist. Retorna value se OK ou default.
 */
function safeEnum(input, allowed, defaultValue = null) {
  if (input === undefined || input === null) return defaultValue;
  return allowed.includes(input) ? input : defaultValue;
}

module.exports = {
  escapeLikeWildcards,
  makeLikeTerm,
  safeInt,
  safeString,
  safeEnum,
  MAX_SEARCH_LENGTH,
};
