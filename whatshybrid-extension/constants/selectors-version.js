/**
 * WhatsApp Web Selector Version
 * 
 * AUDIT-NEW-015: Document the WhatsApp Web version these selectors target
 * 
 * This constant tracks which version of WhatsApp Web the current selectors
 * are designed for. WhatsApp frequently updates their DOM structure, which
 * can break our selectors.
 * 
 * When selectors break:
 * 1. Update this version number
 * 2. Update affected selectors in content/utils/selectors.js
 * 3. Add fallback selectors where possible
 * 4. Document any breaking changes in CHANGELOG
 * 
 * Last updated: 2024-02-17
 * Target WhatsApp Web version: 2.3000.x (approximate)
 * 
 * Note: WhatsApp does not officially document their versions or provide
 * stable selectors. These are reverse-engineered and may need frequent updates.
 */

const WHATSAPP_SELECTOR_VERSION = {
  version: '2.3000.x',
  lastUpdated: '2024-02-17',
  notes: 'Selectors verified working as of this date. May require updates as WhatsApp changes their DOM structure.'
};

// Make available to other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WHATSAPP_SELECTOR_VERSION };
}
