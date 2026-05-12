/**
 * WhatsHybrid Lite - Unified Logging Framework
 * Replaces empty catch blocks and provides meaningful output
 */

(function() {
  'use strict';

class Logger {
  constructor(context = 'WHL') {
    this.context = context;
    this.isDebugEnabled = false;
    
    // Check localStorage for debug flag
    try {
      this.isDebugEnabled = localStorage.getItem('whl_debug') === 'true';
    } catch (e) {
      // localStorage might not be available
    }
  }

  /**
   * Enable debug mode
   */
  enableDebug() {
    this.isDebugEnabled = true;
    try {
      localStorage.setItem('whl_debug', 'true');
    } catch (e) {
      // Ignore if can't save
    }
  }

  /**
   * Disable debug mode
   */
  disableDebug() {
    this.isDebugEnabled = false;
    try {
      localStorage.setItem('whl_debug', 'false');
    } catch (e) {
      // Ignore if can't save
    }
  }

  /**
   * Format log message with context
   */
  _format(level, ...args) {
    return [`[${this.context}${level ? ' ' + level : ''}]`, ...args];
  }

  /**
   * Debug logging - only when debug mode enabled
   */
  debug(...args) {
    if (this.isDebugEnabled) {
      console.log(...this._format('DEBUG', ...args));
    }
  }

  /**
   * Info logging - always shown
   */
  info(...args) {
    console.log(...this._format('', ...args));
  }

  /**
   * Warning logging
   */
  warn(...args) {
    console.warn(...this._format('⚠️', ...args));
  }

  /**
   * Error logging with optional error object
   */
  error(...args) {
    const lastArg = args[args.length - 1];
    
    // If last argument is an Error object, extract stack trace
    if (lastArg instanceof Error) {
      console.error(...this._format('❌', ...args.slice(0, -1)));
      console.error(`  Error: ${lastArg.message}`);
      if (lastArg.stack && this.isDebugEnabled) {
        console.error(`  Stack: ${lastArg.stack}`);
      }
    } else {
      console.error(...this._format('❌', ...args));
    }
  }

  /**
   * Log caught exceptions with context
   * Use this to replace empty catch blocks
   */
  caught(operation, error, additionalContext = {}) {
    if (this.isDebugEnabled) {
      console.error(...this._format('CAUGHT', `Error during ${operation}:`));
      console.error('  Error:', error);
      if (error?.stack) {
        console.error('  Stack:', error.stack);
      }
      if (Object.keys(additionalContext).length > 0) {
        console.error('  Context:', additionalContext);
      }
    } else {
      // In production, just log basic info
      console.warn(...this._format('', `Error during ${operation}:`, error?.message || error));
    }
  }

  /**
   * Performance timing helper
   */
  time(label) {
    if (this.isDebugEnabled) {
      console.time(`[${this.context}] ${label}`);
    }
  }

  /**
   * End performance timing
   */
  timeEnd(label) {
    if (this.isDebugEnabled) {
      console.timeEnd(`[${this.context}] ${label}`);
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(subContext) {
    const childLogger = new Logger(`${this.context}:${subContext}`);
    childLogger.isDebugEnabled = this.isDebugEnabled;
    return childLogger;
  }
}

// Create and export default logger instance
const logger = new Logger('WHL');

// Expose globally
window.WHL_Logger = Logger;
window.whlLogger = logger;

// Export convenience functions
window.whlLog = {
  debug: (...args) => logger.debug(...args),
  info: (...args) => logger.info(...args),
  warn: (...args) => logger.warn(...args),
  error: (...args) => logger.error(...args),
  caught: (operation, error, context) => logger.caught(operation, error, context),
  time: (label) => logger.time(label),
  timeEnd: (label) => logger.timeEnd(label)
};

})(); // End IIFE
