/**
 * Logger wrapper for backward compatibility
 * Exports the logger instance from utils/logger
 */
const { logger } = require('../utils/logger');
module.exports = logger;
