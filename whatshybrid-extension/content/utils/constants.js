/**
 * WhatsHybrid Lite - Global Constants
 * Centralized configuration to avoid magic numbers scattered throughout codebase
 */

// Wrap in IIFE to avoid global pollution while still exposing what's needed
(function() {
  'use strict';

// Configuration flags
window.WHL_CONSTANTS = window.WHL_CONSTANTS || {};

window.WHL_CONSTANTS.WHL_CONFIG = {
  USE_DIRECT_API: true,              // Use validated direct API methods (enviarMensagemAPI, enviarImagemDOM)
  API_RETRY_ON_FAIL: true,           // Retry with URL mode if API fails
  USE_WORKER_FOR_SENDING: false,     // Worker tab disabled - doesn't work reliably
  USE_INPUT_ENTER_METHOD: false,     // Disabled - causes page reloads
  DEBUG: false                        // Debug mode (can be overridden by localStorage)
};

// Performance and resource limits
window.WHL_CONSTANTS.PERFORMANCE_LIMITS = {
  MAX_RESPONSE_SIZE: 100 * 1024,          // 100KB - Skip network extraction for large responses
  MAX_WEBSOCKET_SIZE: 50 * 1024,          // 50KB - Skip WebSocket extraction for large messages
  NETWORK_EXTRACT_THROTTLE: 1000          // 1 second - Throttle network extraction interval
};

// Timeout values (in milliseconds)
window.WHL_CONSTANTS.TIMEOUTS = {
  SEND_MESSAGE: 45000,                // 45 seconds timeout for message sending
  WAIT_FOR_ELEMENT: 10000,            // 10 seconds to wait for DOM elements
  CHAT_OPEN: 30000,                   // 30 seconds to wait for chat to open
  MESSAGE_TYPE_DELAY: 300,            // Delay after typing message
  AFTER_SEND_DELAY: 1000,             // Delay after sending message
  BETWEEN_CHARS_MIN: 50,              // Minimum delay between characters when typing
  BETWEEN_CHARS_MAX: 150,             // Maximum delay between characters when typing
  PERIODIC_SAVE: 12000                // 12 seconds - periodic save interval
};

// Campaign defaults
window.WHL_CONSTANTS.CAMPAIGN_DEFAULTS = {
  DELAY_MIN: 5,                       // Minimum delay between messages (seconds)
  DELAY_MAX: 10,                      // Maximum delay between messages (seconds)
  RETRY_MAX: 3,                       // Maximum retry attempts
  TYPING_EFFECT: true,                // Enable human-like typing effect
  CONTINUE_ON_ERROR: true             // Continue campaign even if messages fail
};

// Phone number validation patterns
window.WHL_CONSTANTS.PHONE_PATTERNS = {
  BR_MOBILE: /\b(?:\+?55)?\s?\(?[1-9][0-9]\)?\s?9[0-9]{4}-?[0-9]{4}\b/g,
  BR_LAND: /\b(?:\+?55)?\s?\(?[1-9][0-9]\)?\s?[2-8][0-9]{3}-?[0-9]{4}\b/g,
  RAW: /\b\d{8,15}\b/g,
  MIN_LENGTH: 8,
  MAX_LENGTH: 15
};

// Phone number extraction origins
window.WHL_CONSTANTS.EXTRACTION_ORIGINS = {
  DOM: 'dom',
  STORE: 'store',
  GROUP: 'group',
  WEBSOCKET: 'websocket',
  NETWORK: 'network',
  LOCAL_STORAGE: 'local_storage'
};

// Confidence score weights for phone validation
window.WHL_CONSTANTS.CONFIDENCE_SCORES = {
  BASE: 10,
  MULTIPLE_ORIGINS: 30,
  FROM_STORE: 30,
  FROM_GROUP: 10,
  HAS_NAME: 15,
  IS_GROUP: 5,
  IS_ACTIVE: 10,
  VALIDATION_THRESHOLD: 60           // Minimum score to consider valid
};

// DOM Selector sets (fallback options for resilience) - ATUALIZADO DEZ 2025
// Baseado em: Mapa de Seletores WhatsHybrid Lite Fusion v1.4.0
window.WHL_CONSTANTS.WHL_SELECTORS = {
  MESSAGE_INPUT: [
    '[data-testid="conversation-compose-box-input"]',
    'footer div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[data-tab="10"][contenteditable="true"]',
    'div[aria-label="Digitar na conversa"][contenteditable="true"]',
    'footer [contenteditable="true"]',
    'footer div[contenteditable="true"]',
    'div[contenteditable="true"][data-lexical-editor="true"]'
  ],
  SEND_BUTTON: [
    '[data-testid="send"]',
    '[data-testid="compose-btn-send"]',
    'span[data-icon="send"]',
    'span[data-icon="send-light"]',
    '[aria-label="Enviar"]',
    '[aria-label="Send"]',
    'button[aria-label*="Enviar"]',
    'button[aria-label*="Send"]',
    'footer [aria-label="Enviar"]',
    'footer button:not([disabled])'
  ],
  ATTACH_BUTTON: [
    '[data-testid="attach-clip"]',
    '[data-testid="clip"]',
    'span[data-icon="attach-menu-plus"]',
    'span[data-icon="clip"]',
    '[aria-label="Anexar"]',
    '[title="Anexar"]',
    'button[aria-label*="Anexar"]'
  ],
  ATTACH_IMAGE: [
    '[data-testid="attach-image"]',
    '[data-testid="mi-attach-media"]',
    '[data-testid="attach-photo"]',
    'input[type="file"][accept*="image"]',
    'input[accept*="image"]'
  ],
  CAPTION_INPUT: [
    '[data-testid="media-caption-input"]',
    '[data-testid="media-caption-input-container"] [contenteditable="true"]',
    '[data-testid="media-caption-input"] [contenteditable="true"]',
    'div[aria-label*="legenda"][contenteditable="true"]',
    'div[aria-label*="Legenda"][contenteditable="true"]',
    'div[aria-label*="caption"][contenteditable="true"]',
    'div[contenteditable="true"][data-lexical-editor="true"]'
  ],
  CHAT_LIST: [
    '#pane-side',
    '[data-testid="chat-list"]',
    '[role="listbox"]',
    '[role="application"] > div > div'
  ],
  CHAT_ITEM: [
    '[data-testid="cell-frame-container"]',
    '[role="listitem"]',
    '[data-id]',
    '[data-id*="@c.us"]',
    '[data-id*="@g.us"]'
  ],
  CONVERSATION_HEADER: [
    'header[data-testid="conversation-header"]',
    '#main header',
    'header.pane-header',
    'div[data-testid="conversation-info-header"]'
  ],
  SEARCH_INPUT: [
    '[data-testid="chat-list-search"]',
    '[data-testid="search"]',
    '[data-icon="search"]'
  ],
  CLOSE_BUTTON: [
    '[data-icon="x"]',
    '[data-testid="x"]',
    '[data-icon="x-alt"]',
    '[aria-label*="Fechar"]',
    '[aria-label*="Close"]'
  ],
  BACK_BUTTON: [
    '[data-testid="back"]',
    '[data-icon="back"]',
    '[aria-label*="Voltar"]',
    '[aria-label*="Back"]'
  ]
};

// Storage keys
window.WHL_CONSTANTS.STORAGE_KEYS = {
  STATE: 'whl_state',
  STATS: 'whl_stats',
  CONTACTS: 'contacts',
  VALID: 'valid',
  META: 'meta',
  WORKER_TAB_ID: 'workerTabId',
  CAMPAIGN_QUEUE: 'campaignQueue',
  CAMPAIGN_STATE: 'campaignState',
  DEBUG: 'whl_debug'
};

})(); // End IIFE
