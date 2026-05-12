/**
 * AI Safety Filter Module - Validates AI responses for safety and quality
 * @module ai-safety-filter
 */

(function() {
  'use strict';

  // Initialize logger
  const logger = (typeof window !== 'undefined' && window.WHLogger) ? window.WHLogger.child('SafetyFilter') : null;

  /**
   * Safety filter for AI responses
   */
  class ResponseSafetyFilter {
    constructor(config = {}) {
      this.config = {
        maxLength: 2000,
        minLength: 10,
        blockedPatterns: [
          /ignore (previous|all) instructions?/i,
          /you are now/i,
          /pretend (you are|to be)/i,
          /roleplay as/i
        ],
        piiPatterns: [
          { pattern: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, type: 'CPF' },
          { pattern: /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dXx]\b/, type: 'RG' },
          { pattern: /\b\d{4}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b/, type: 'credit_card' },
          { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, type: 'email' },
          { pattern: /\b(?:\+55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}-?\d{4}\b/, type: 'phone_br' },
          // v9.5.4: Brazilian-specific PII patterns added.
          { pattern: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/, type: 'CNPJ' },
          { pattern: /\b\d{5}-?\d{3}\b(?!\d)/, type: 'CEP' },
          { pattern: /\bag(?:ência|encia|\.)?\s*\d{3,5}[\s,.-]+\s*c(?:onta|c|\/)\.?\s*\d{4,12}/i, type: 'bank_account_br' },
          // PIX random key (UUIDv4 format)
          { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, type: 'pix_random_key' },
        ],
        sensitiveTopics: [
          'medical advice',
          'legal advice',
          'financial advice',
          'emergency'
        ],
        requiredLanguage: 'pt',
        hallucinationThreshold: 0.3,
        ...config
      };
    }

    /**
     * Validate response for safety and quality
     * @param {string} response - AI response to validate
     * @param {Object} context - Conversation context
     * @returns {Object} Validation result
     */
    validate(response, context = {}) {
      // Type validation
      if (typeof response !== 'string') {
        return {
          safe: false,
          issues: [{ type: 'invalid_input', severity: 'high', message: 'Response must be a string' }],
          modifiedResponse: null,
          originalResponse: response,
          checkedAt: new Date()
        };
      }
      
      const issues = [];
      let modifiedResponse = response;
      let safe = true;

      const blockedPatternCheck = this._checkBlockedPatterns(response);
      if (!blockedPatternCheck.safe) {
        issues.push({
          type: 'blocked_pattern',
          severity: 'high',
          message: 'Response contains blocked pattern',
          details: blockedPatternCheck.matches
        });
      }

      const lengthCheck = this._checkLength(response);
      if (!lengthCheck.valid) {
        issues.push({
          type: 'invalid_length',
          severity: 'medium',
          message: lengthCheck.message,
          actual: response.length
        });
      }

      const hallucinationCheck = this._detectHallucination(response, context);
      if (hallucinationCheck.detected) {
        issues.push({
          type: 'potential_hallucination',
          severity: 'medium',
          message: 'Response may contain hallucinated information',
          confidence: hallucinationCheck.confidence,
          indicators: hallucinationCheck.indicators
        });
        modifiedResponse = this._addHallucinationDisclaimer(modifiedResponse);
      }

      const empathyCheck = this._checkEmpathy(response, context);
      if (!empathyCheck.appropriate) {
        issues.push({
          type: 'inappropriate_tone',
          severity: 'low',
          message: empathyCheck.message,
          suggestion: empathyCheck.suggestion
        });
        modifiedResponse = this._improveEmpathy(modifiedResponse, context);
      }

      const languageCheck = this._checkLanguage(response);
      if (!languageCheck.valid) {
        issues.push({
          type: 'language_mismatch',
          severity: 'low',
          message: `Expected ${this.config.requiredLanguage} but detected ${languageCheck.detected}`,
          detected: languageCheck.detected
        });
      }

      const sensitiveCheck = this._checkSensitiveTopics(response, context);
      if (sensitiveCheck.detected) {
        issues.push({
          type: 'sensitive_topic',
          severity: 'medium',
          message: 'Response involves sensitive topic',
          topic: sensitiveCheck.topic
        });
        modifiedResponse = this._addSensitiveTopicDisclaimer(modifiedResponse, sensitiveCheck.topic);
      }

      // Check 7: PII leak detection
      const piiCheck = this._checkPII(response);
      if (piiCheck.detected) {
        issues.push({
          type: 'pii_leak',
          severity: 'high',
          message: 'Response may contain personally identifiable information',
          piiTypes: piiCheck.types
        });
      }

      const highSeverityIssues = issues.filter(i => i.severity === 'high');
      if (highSeverityIssues.length > 0) {
        safe = false;
      }

      const result = {
        safe,
        issues,
        modifiedResponse: safe ? modifiedResponse : null,
        originalResponse: response,
        checkedAt: new Date()
      };

      if (!safe && logger) {
        logger.warn('Unsafe response detected', { issueCount: issues.length, issues: issues.map(i => i.type) });
      }

      return result;
    }

    _checkBlockedPatterns(response) {
      const matches = [];
      for (const pattern of this.config.blockedPatterns) {
        if (pattern.test(response)) {
          matches.push(pattern.toString());
        }
      }
      return { safe: matches.length === 0, matches };
    }

    /**
     * Check for PII (Personally Identifiable Information) leak
     * @private
     */
    _checkPII(response) {
      const matches = [];
      for (const { pattern, type } of this.config.piiPatterns) {
        if (pattern.test(response)) {
          matches.push(type);
        }
      }

      return {
        detected: matches.length > 0,
        types: matches
      };
    }

    _checkLength(response) {
      if (response.length < this.config.minLength) {
        return {
          valid: false,
          message: `Response too short (${response.length} chars, min ${this.config.minLength})`
        };
      }
      if (response.length > this.config.maxLength) {
        return {
          valid: false,
          message: `Response too long (${response.length} chars, max ${this.config.maxLength})`
        };
      }
      return { valid: true };
    }

    _detectHallucination(response, context) {
      const indicators = [];
      let confidence = 0;

      if (/(\d{10,}|exactly \d+|precisely \d+)/i.test(response) && !context.expectsSpecificData) {
        indicators.push('overly_specific_numbers');
        confidence += 0.15;
      }

      if (/(always|never|guaranteed|100%|absolutely)/i.test(response)) {
        indicators.push('absolute_statements');
        confidence += 0.1;
      }

      if (context.knownEntities) {
        const entities = this._extractEntities(response);
        const unknownEntities = entities.filter(e => !context.knownEntities.includes(e));
        if (unknownEntities.length > 2) {
          indicators.push('unknown_entities');
          confidence += 0.15;
        }
      }

      return {
        detected: confidence >= this.config.hallucinationThreshold,
        confidence,
        indicators
      };
    }

    _checkEmpathy(response, context) {
      if (!context.emotionalContext) {
        return { appropriate: true };
      }

      const isNegativeEmotion = ['angry', 'sad', 'frustrated', 'worried'].includes(
        context.emotionalContext
      );

      if (isNegativeEmotion) {
        const hasEmpathy = /(entendo|compreendo|lamento|desculpe|como posso ajudar)/i.test(response);
        if (!hasEmpathy) {
          return {
            appropriate: false,
            message: 'Response lacks empathy for negative emotional context',
            suggestion: 'Add empathetic acknowledgment'
          };
        }
      }

      return { appropriate: true };
    }

    _checkLanguage(response) {
      const ptIndicators = ['é', 'ã', 'ç', 'õ', 'você', 'por favor', 'obrigado'];
      const enIndicators = ['the', 'you', 'please', 'thank you', 'is', 'are'];
      
      const ptScore = ptIndicators.filter(ind => response.toLowerCase().includes(ind)).length;
      const enScore = enIndicators.filter(ind => response.toLowerCase().includes(ind)).length;
      
      let detected = 'unknown';
      if (ptScore > enScore) detected = 'pt';
      else if (enScore > ptScore) detected = 'en';

      return {
        valid: detected === this.config.requiredLanguage || detected === 'unknown',
        detected
      };
    }

    _checkSensitiveTopics(response, context) {
      for (const topic of this.config.sensitiveTopics) {
        if (context.intent === topic || response.toLowerCase().includes(topic)) {
          return { detected: true, topic };
        }
      }
      return { detected: false };
    }

    _addHallucinationDisclaimer(response) {
      return response + '\n\n⚠️ *Nota: Recomendo verificar essas informações.*';
    }

    _addSensitiveTopicDisclaimer(response, topic) {
      const disclaimers = {
        'medical advice': '⚠️ *Importante: Esta não é orientação médica profissional. Consulte um médico.*',
        'legal advice': '⚠️ *Importante: Esta não é orientação jurídica. Consulte um advogado.*',
        'financial advice': '⚠️ *Importante: Esta não é orientação financeira profissional.*',
        'emergency': '🚨 *Em caso de emergência, ligue 190 (polícia) ou 192 (ambulância).*'
      };
      const disclaimer = disclaimers[topic] || '⚠️ *Importante: Consulte um profissional qualificado.*';
      return response + '\n\n' + disclaimer;
    }

    _improveEmpathy(response, context) {
      const empathyPrefixes = {
        angry: 'Entendo sua frustração. ',
        sad: 'Lamento que esteja passando por isso. ',
        frustrated: 'Compreendo que isso seja frustrante. ',
        worried: 'Entendo sua preocupação. '
      };
      const prefix = empathyPrefixes[context.emotionalContext] || 'Entendo. ';
      return prefix + response;
    }

    _extractEntities(text) {
      const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
      return matches || [];
    }
  }

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ResponseSafetyFilter;
  } else {
    window.ResponseSafetyFilter = ResponseSafetyFilter;
    // v9.5.3: Auto-instantiate a default singleton so callers can use window.aiSafetyFilter.validate()
    // without each one having to construct one. Config can still be overridden via window.aiSafetyFilter.config.
    if (!window.aiSafetyFilter) {
      window.aiSafetyFilter = new ResponseSafetyFilter();
    }
  }
})();
