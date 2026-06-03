/**
 * WhatsHybrid Lite - DOM Selector Helpers
 * Robust, configurable selector helpers to future-proof against WhatsApp UI changes
 */

(function() {
  'use strict';

/**
 * Try multiple selectors until one works
 * @param {string[]} selectors - Array of selector strings to try
 * @param {Element} root - Root element to search from (default: document)
 * @returns {Element|null} - Found element or null
 */
function findElement(selectors, root = document) {
  if (!Array.isArray(selectors)) {
    selectors = [selectors];
  }
  
  for (const selector of selectors) {
    try {
      const element = root.querySelector(selector);
      if (element) {
        if (window.whlLog) {
          window.whlLog.debug(`Found element with selector: ${selector}`);
        }
        return element;
      }
    } catch (e) {
      if (window.whlLog) {
        window.whlLog.caught('findElement', e, { selector });
      }
    }
  }
  
  return null;
}

/**
 * Find all elements matching any of the selectors
 * @param {string[]} selectors - Array of selector strings to try
 * @param {Element} root - Root element to search from (default: document)
 * @returns {Element[]} - Array of found elements
 */
function findAllElements(selectors, root = document) {
  if (!Array.isArray(selectors)) {
    selectors = [selectors];
  }
  
  const elements = [];
  
  for (const selector of selectors) {
    try {
      const found = root.querySelectorAll(selector);
      elements.push(...found);
    } catch (e) {
      if (window.whlLog) {
        window.whlLog.caught('findAllElements', e, { selector });
      }
    }
  }
  
  return elements;
}

/**
 * Wait for element to appear in DOM
 * @param {string|string[]} selectors - Selector(s) to wait for
 * @param {number} timeout - Timeout in milliseconds
 * @param {Element} root - Root element to search from
 * @returns {Promise<Element|null>} - Found element or null if timeout
 */
async function waitForElement(selectors, timeout, root = document) {
  timeout = timeout || (window.WHL_CONSTANTS?.TIMEOUTS?.WAIT_FOR_ELEMENT || 10000);
  const startTime = Date.now();
  
  if (!Array.isArray(selectors)) {
    selectors = [selectors];
  }
  
  while (Date.now() - startTime < timeout) {
    const element = findElement(selectors, root);
    if (element) {
      return element;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  if (window.whlLog) {
    window.whlLog.warn('waitForElement timeout:', selectors);
  }
  return null;
}

/**
 * Get message input field
 * @returns {Element|null}
 */
function getMessageInputField() {
  const WHL_SELECTORS = window.WHL_CONSTANTS?.WHL_SELECTORS || {};
  return findElement(WHL_SELECTORS.MESSAGE_INPUT || []);
}

/**
 * Get send button
 * @returns {Element|null}
 */
function getSendButton() {
  const WHL_SELECTORS = window.WHL_CONSTANTS?.WHL_SELECTORS || {};
  return findElement(WHL_SELECTORS.SEND_BUTTON || []);
}

/**
 * Get attach button
 * @returns {Element|null}
 */
function getAttachButton() {
  const WHL_SELECTORS = window.WHL_CONSTANTS?.WHL_SELECTORS || {};
  return findElement(WHL_SELECTORS.ATTACH_BUTTON || []);
}

/**
 * Get image attach button
 * @returns {Element|null}
 */
function getAttachImageButton() {
  const WHL_SELECTORS = window.WHL_CONSTANTS?.WHL_SELECTORS || {};
  return findElement(WHL_SELECTORS.ATTACH_IMAGE || []);
}

/**
 * Get caption input field (for media)
 * @returns {Element|null}
 */
function getCaptionInput() {
  const WHL_SELECTORS = window.WHL_CONSTANTS?.WHL_SELECTORS || {};
  return findElement(WHL_SELECTORS.CAPTION_INPUT || []);
}

/**
 * Check if element is visible
 * @param {Element} element - Element to check
 * @returns {boolean}
 */
function isElementVisible(element) {
  if (!element) return false;
  
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && 
         style.visibility !== 'hidden' && 
         style.opacity !== '0';
}

/**
 * Wait for element to become visible
 * @param {Element} element - Element to wait for
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>}
 */
async function waitForVisible(element, timeout) {
  if (!element) return false;
  
  timeout = timeout || (window.WHL_CONSTANTS?.TIMEOUTS?.WAIT_FOR_ELEMENT || 10000);
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (isElementVisible(element)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return false;
}

/**
 * Safe element click with error handling
 * @param {Element} element - Element to click
 * @returns {boolean} - Success status
 */
function safeClick(element) {
  if (!element) {
    if (window.whlLog) {
      window.whlLog.warn('safeClick: element is null');
    }
    return false;
  }
  
  try {
    element.click();
    return true;
  } catch (e) {
    if (window.whlLog) {
      window.whlLog.caught('safeClick', e);
    }
    return false;
  }
}

/**
 * Safe element focus with error handling
 * @param {Element} element - Element to focus
 * @returns {boolean} - Success status
 */
function safeFocus(element) {
  if (!element) {
    if (window.whlLog) {
      window.whlLog.warn('safeFocus: element is null');
    }
    return false;
  }
  
  try {
    element.focus();
    return true;
  } catch (e) {
    if (window.whlLog) {
      window.whlLog.caught('safeFocus', e);
    }
    return false;
  }
}

// Expose selector helpers globally
window.WHL_Selectors = {
  findElement,
  findAllElements,
  waitForElement,
  getMessageInputField,
  getSendButton,
  getAttachButton,
  getAttachImageButton,
  getCaptionInput,
  isElementVisible,
  waitForVisible,
  safeClick,
  safeFocus
};

})(); // End IIFE
