/**
 * EntityManager
 * @file Extraído de SmartBotExtendedService.js (refactor v9)
 */


class EntityManager {
  constructor() {
    this.extractors = new Map();
    this.customEntities = new Map();
    this.synonyms = new Map();
    this._registerDefaultExtractors();
  }

  _registerDefaultExtractors() {
    this.registerExtractor('email', {
      type: 'regex',
      pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
      normalize: (match) => match.toLowerCase()
    });

    this.registerExtractor('phone', {
      type: 'regex',
      pattern: /(?:\+?55\s?)?(?:\(?\d{2}\)?[\s.-]?)?\d{4,5}[\s.-]?\d{4}/g,
      normalize: (match) => match.replace(/\D/g, '')
    });

    this.registerExtractor('cpf', {
      type: 'regex',
      pattern: /\d{3}[\s.-]?\d{3}[\s.-]?\d{3}[\s.-]?\d{2}/g,
      normalize: (match) => match.replace(/\D/g, ''),
      validate: (value) => this._validateCPF(value)
    });

    this.registerExtractor('cnpj', {
      type: 'regex',
      pattern: /\d{2}[\s.]?\d{3}[\s.]?\d{3}[\s/]?\d{4}[\s-]?\d{2}/g,
      normalize: (match) => match.replace(/\D/g, '')
    });

    this.registerExtractor('cep', {
      type: 'regex',
      pattern: /\d{5}[\s-]?\d{3}/g,
      normalize: (match) => match.replace(/\D/g, '')
    });

    this.registerExtractor('date', {
      type: 'regex',
      pattern: /\d{1,2}[\s/.-]\d{1,2}[\s/.-]\d{2,4}/g,
      normalize: (match) => {
        const parts = match.split(/[\s/.-]/);
        if (parts.length === 3) {
          const [d, m, y] = parts;
          const year = y.length === 2 ? '20' + y : y;
          return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
        return match;
      }
    });

    this.registerExtractor('money', {
      type: 'regex',
      pattern: /R\$\s*[\d.,]+|\d+(?:[.,]\d{3})*(?:[.,]\d{2})?(?:\s*(?:reais|real|R\$))/gi,
      normalize: (match) => parseFloat(match.replace(/[^\d,]/g, '').replace(',', '.'))
    });

    this.registerExtractor('url', {
      type: 'regex',
      pattern: /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi
    });

    this.registerExtractor('order_number', {
      type: 'regex',
      pattern: /(?:pedido|protocolo|ordem|ticket|#)\s*(?:n[°º]?\s*)?(\d{4,})/gi,
      normalize: (match, groups) => groups?.[1] || match.replace(/\D/g, '')
    });
  }

  _validateCPF(cpf) {
    if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
    let d1 = (sum * 10) % 11;
    if (d1 === 10) d1 = 0;
    if (d1 !== parseInt(cpf[9])) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
    let d2 = (sum * 10) % 11;
    if (d2 === 10) d2 = 0;
    return d2 === parseInt(cpf[10]);
  }

  registerExtractor(entityType, config) {
    this.extractors.set(entityType, {
      type: config.type || 'regex',
      pattern: config.pattern,
      extract: config.extract,
      normalize: config.normalize || ((v) => v),
      validate: config.validate || (() => true),
      priority: config.priority || 0
    });
  }

  registerEntityList(entityType, values, options = {}) {
    this.customEntities.set(entityType, {
      values: values.map(v => typeof v === 'string' ? { value: v, canonical: v } : v),
      caseSensitive: options.caseSensitive || false,
      fuzzyMatch: options.fuzzyMatch !== false,
      threshold: options.threshold || 0.8
    });
  }

  addSynonyms(entityType, canonical, synonyms) {
    if (!this.synonyms.has(entityType)) this.synonyms.set(entityType, new Map());
    const entitySynonyms = this.synonyms.get(entityType);
    synonyms.forEach(syn => entitySynonyms.set(syn.toLowerCase(), canonical));
  }

  extractAll(text, options = {}) {
    const entities = [];
    const types = options.types || Array.from(this.extractors.keys());

    types.forEach(type => {
      const extractor = this.extractors.get(type);
      if (extractor) {
        const extracted = this._extractWithExtractor(text, type, extractor);
        entities.push(...extracted);
      }
    });

    this.customEntities.forEach((config, type) => {
      if (!options.types || options.types.includes(type)) {
        const extracted = this._extractFromList(text, type, config);
        entities.push(...extracted);
      }
    });

    return this._deduplicateEntities(entities);
  }

  _extractWithExtractor(text, type, extractor) {
    const results = [];
    if (extractor.type === 'regex' && extractor.pattern) {
      const pattern = new RegExp(extractor.pattern.source, extractor.pattern.flags);
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const rawValue = match[0];
        const normalizedValue = extractor.normalize(rawValue, match.slice(1));
        if (extractor.validate(normalizedValue)) {
          results.push({
            type, value: normalizedValue, raw: rawValue,
            start: match.index, end: match.index + rawValue.length, confidence: 1.0
          });
        }
      }
    } else if (extractor.type === 'function' && extractor.extract) {
      const extracted = extractor.extract(text);
      extracted.forEach(e => {
        results.push({
          type, value: extractor.normalize(e.value), raw: e.raw || e.value,
          start: e.start, end: e.end, confidence: e.confidence || 0.9
        });
      });
    }
    return results;
  }

  _extractFromList(text, type, config) {
    const results = [];
    const lowerText = config.caseSensitive ? text : text.toLowerCase();

    config.values.forEach(item => {
      const searchValue = config.caseSensitive ? item.value : item.value.toLowerCase();
      let index = lowerText.indexOf(searchValue);
      while (index !== -1) {
        results.push({
          type, value: item.canonical || item.value,
          raw: text.substring(index, index + item.value.length),
          start: index, end: index + item.value.length, confidence: 1.0
        });
        index = lowerText.indexOf(searchValue, index + 1);
      }

      if (config.fuzzyMatch && results.length === 0) {
        const words = text.split(/\s+/);
        words.forEach((word) => {
          const similarity = this._calculateSimilarity(
            config.caseSensitive ? word : word.toLowerCase(), searchValue
          );
          if (similarity >= config.threshold) {
            const start = text.indexOf(word);
            results.push({
              type, value: item.canonical || item.value, raw: word,
              start, end: start + word.length, confidence: similarity, fuzzyMatch: true
            });
          }
        });
      }
    });

    return results;
  }

  _calculateSimilarity(a, b) {
    if (a === b) return 1;
    if (!a || !b) return 0;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b[i - 1] === a[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
        }
      }
    }

    const distance = matrix[b.length][a.length];
    return 1 - distance / Math.max(a.length, b.length);
  }

  _deduplicateEntities(entities) {
    entities.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return b.confidence - a.confidence;
    });

    const result = [];
    let lastEnd = -1;

    entities.forEach(entity => {
      if (entity.start >= lastEnd) {
        result.push(entity);
        lastEnd = entity.end;
      } else if (entity.confidence > result[result.length - 1]?.confidence) {
        result[result.length - 1] = entity;
        lastEnd = entity.end;
      }
    });

    return result;
  }

  extract(text, entityType) {
    return this.extractAll(text, { types: [entityType] });
  }

  resolveSynonym(entityType, value) {
    const synonymMap = this.synonyms.get(entityType);
    return synonymMap ? (synonymMap.get(value.toLowerCase()) || value) : value;
  }
}

// ============================================================
// 🎯 INTENT MANAGER
// ============================================================

module.exports = EntityManager;
