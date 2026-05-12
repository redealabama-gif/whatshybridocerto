/**
 * Logger Module - Structured logging with levels for extension
 * @module logger
 */

(function() {
  'use strict';

  /**
   * Logger configuration and instance
   */
  const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  /**
   * Get log level from environment or default
   */
  function getLogLevel() {
    // Default to 'info' in production, 'debug' in dev
    try {
      const isDev = typeof chrome !== 'undefined' && 
                    chrome.runtime && 
                    chrome.runtime.getManifest && 
                    chrome.runtime.getManifest().version.includes('dev');
      return isDev ? 'debug' : 'info';
    } catch (error) {
      // Fallback to info if we can't determine environment
      return 'info';
    }
  }

  class Logger {
    constructor() {
      this.logLevel = LOG_LEVELS[getLogLevel()] || LOG_LEVELS.info;
      this.moduleName = null;
    }

    /**
     * Set the current log level
     * @param {string} level - Log level (debug, info, warn, error)
     */
    setLevel(level) {
      if (LOG_LEVELS.hasOwnProperty(level)) {
        this.logLevel = LOG_LEVELS[level];
      }
    }

    /**
     * Set module name for contextual logging
     * @param {string} name - Module name
     */
    setModule(name) {
      this.moduleName = name;
    }

    /**
     * Format log message with timestamp and metadata
     * @private
     */
    _format(level, module, message, metadata) {
      const timestamp = new Date().toISOString();
      const moduleStr = module || this.moduleName || 'UNKNOWN';
      let formatted = `[${level.toUpperCase()}] [${moduleStr}] ${timestamp} - ${message}`;
      
      if (metadata && Object.keys(metadata).length > 0) {
        formatted += ' ' + JSON.stringify(metadata);
      }
      
      return formatted;
    }

    /**
     * Log debug message
     * @param {string} message - Log message
     * @param {Object} metadata - Optional metadata
     * @param {string} module - Optional module override
     */
    debug(message, metadata = {}, module = null) {
      if (this.logLevel <= LOG_LEVELS.debug) {
        console.log(this._format('debug', module, message, metadata));
      }
    }

    /**
     * Log info message
     * @param {string} message - Log message
     * @param {Object} metadata - Optional metadata
     * @param {string} module - Optional module override
     */
    info(message, metadata = {}, module = null) {
      if (this.logLevel <= LOG_LEVELS.info) {
        console.info(this._format('info', module, message, metadata));
      }
    }

    /**
     * Log warning message
     * @param {string} message - Log message
     * @param {Object} metadata - Optional metadata
     * @param {string} module - Optional module override
     */
    warn(message, metadata = {}, module = null) {
      if (this.logLevel <= LOG_LEVELS.warn) {
        console.warn(this._format('warn', module, message, metadata));
      }
    }

    /**
     * Log error message
     * @param {string} message - Log message
     * @param {Object} metadata - Optional metadata (should include error.message, not full stack)
     * @param {string} module - Optional module override
     */
    error(message, metadata = {}, module = null) {
      if (this.logLevel <= LOG_LEVELS.error) {
        console.error(this._format('error', module, message, metadata));
      }
    }

    /**
     * Create a child logger with a specific module name
     * @param {string} moduleName - Module name for child logger
     * @returns {Logger} Child logger instance
     */
    child(moduleName) {
      const childLogger = new Logger();
      childLogger.logLevel = this.logLevel;
      childLogger.setModule(moduleName);
      return childLogger;
    }
  }

  // Create singleton instance
  const logger = new Logger();

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = logger;
  } else {
    window.WHLogger = logger;
    // Also expose globally for backward compatibility
    if (typeof globalThis !== 'undefined') {
      globalThis.WHLogger = logger;
    }
  }
})();
