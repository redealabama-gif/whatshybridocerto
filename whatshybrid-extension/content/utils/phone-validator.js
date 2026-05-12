/**
 * WhatsHybrid Lite - Phone Number Validator
 * Centralized phone validation logic to eliminate redundancy
 */

(function() {
  'use strict';

/**
 * Sanitize phone number - remove non-numeric characters
 * @param {string} phone - Raw phone number
 * @returns {string} - Sanitized phone number (digits only)
 */
function sanitizePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return '';
  }
  return phone.replace(/\D/g, '');
}

/**
 * Normalize Brazilian phone number
 * @param {string} phone - Sanitized phone number (digits only)
 * @returns {string|null} - Normalized phone with country code, or null if invalid
 */
function normalizePhone(phone) {
  if (!phone) return null;
  
  let normalized = sanitizePhone(phone);
  
  const PHONE_PATTERNS = window.WHL_CONSTANTS?.PHONE_PATTERNS || { MIN_LENGTH: 8, MAX_LENGTH: 15 };
  
  // Check length constraints
  if (normalized.length < PHONE_PATTERNS.MIN_LENGTH || 
      normalized.length > PHONE_PATTERNS.MAX_LENGTH) {
    return null;
  }
  
  // Brazilian phone normalization logic
  // Already has country code (55) and reasonable length
  if (normalized.startsWith('55') && normalized.length >= 12 && normalized.length <= 13) {
    return normalized;
  }
  
  // 11 digits with 9 as 3rd digit = mobile with DDD (e.g., 11987654321)
  // Format: DD 9XXXX-XXXX where DD is area code (DDD)
  if (normalized.length === 11 && normalized[2] === '9') {
    return '55' + normalized;
  }
  
  // 10 digits = landline with DDD (e.g., 1133334444)
  // Format: DD XXXX-XXXX where DD is area code
  if (normalized.length === 10) {
    return '55' + normalized;
  }
  
  // 11 digits without 9 as 3rd digit = could be old mobile format
  // Add country code
  if (normalized.length === 11) {
    return '55' + normalized;
  }
  
  // 8 or 9 digits = local number without area code
  // Cannot normalize without area code, return null
  if (normalized.length === 8 || normalized.length === 9) {
    return null;
  }
  
  // Already correct length with country code (other countries)
  return normalized;
}

/**
 * Validate phone number format
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if valid
 */
function isValidPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  
  const PHONE_PATTERNS = window.WHL_CONSTANTS?.PHONE_PATTERNS || { MIN_LENGTH: 8, MAX_LENGTH: 15 };
  
  // Check final length after normalization
  return normalized.length >= PHONE_PATTERNS.MIN_LENGTH && 
         normalized.length <= PHONE_PATTERNS.MAX_LENGTH;
}

/**
 * Extract phone numbers from text using patterns
 * @param {string} text - Text to extract from
 * @param {RegExp} pattern - Pattern to use (default: RAW)
 * @returns {string[]} - Array of extracted phone numbers
 */
function extractPhonesFromText(text, pattern) {
  if (!text) return [];
  
  const PHONE_PATTERNS = window.WHL_CONSTANTS?.PHONE_PATTERNS || {};
  pattern = pattern || PHONE_PATTERNS.RAW || /\b\d{8,15}\b/g;
  
  const matches = text.matchAll(pattern);
  const phones = [];
  
  for (const match of matches) {
    const phone = sanitizePhone(match[0]);
    if (isValidPhone(phone)) {
      phones.push(normalizePhone(phone));
    }
  }
  
  return [...new Set(phones)]; // Remove duplicates
}

/**
 * Format phone number for WhatsApp URL
 * @param {string} phone - Phone number
 * @returns {string} - Formatted for WhatsApp (e.g., "5511987654321")
 */
function formatForWhatsApp(phone) {
  return normalizePhone(phone) || '';
}

/**
 * Parse phone number from WhatsApp ID format (@c.us)
 * @param {string} id - WhatsApp ID (e.g., "5511987654321@c.us")
 * @returns {string|null} - Extracted phone number
 */
function parseWhatsAppId(id) {
  if (!id || typeof id !== 'string') return null;
  
  // Remove @c.us suffix
  const phone = id.replace('@c.us', '').replace('@g.us', '');
  
  if (isValidPhone(phone)) {
    return normalizePhone(phone);
  }
  
  return null;
}

/**
 * Batch validate and normalize phone numbers
 * @param {string[]} phones - Array of phone numbers
 * @returns {Object} - { valid: string[], invalid: string[] }
 */
function batchValidatePhones(phones) {
  const result = {
    valid: [],
    invalid: []
  };
  
  if (!Array.isArray(phones)) {
    return result;
  }
  
  phones.forEach(phone => {
    const normalized = normalizePhone(phone);
    if (normalized && isValidPhone(normalized)) {
      result.valid.push(normalized);
    } else {
      result.invalid.push(phone);
    }
  });
  
  // Remove duplicates from valid
  result.valid = [...new Set(result.valid)];
  
  return result;
}

/**
 * Parse phone numbers from textarea input (one per line)
 * @param {string} text - Textarea content
 * @returns {Object} - { valid: string[], invalid: string[] }
 */
function parsePhoneList(text) {
  if (!text || typeof text !== 'string') {
    return { valid: [], invalid: [] };
  }
  
  const lines = text.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  return batchValidatePhones(lines);
}

// Expose phone validator globally
window.WHL_PhoneValidator = {
  sanitizePhone,
  normalizePhone,
  isValidPhone,
  extractPhonesFromText,
  formatForWhatsApp,
  parseWhatsAppId,
  batchValidatePhones,
  parsePhoneList
};

})(); // End IIFE
