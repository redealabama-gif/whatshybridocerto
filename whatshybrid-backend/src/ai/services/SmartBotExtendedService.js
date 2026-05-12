/**
 * SmartBotExtendedService — aggregator v9.0.0
 * Original (1634 linhas) refatorado em smartbot-extended/*.js
 * Backup em SmartBotExtendedService.js.bak
 */

const DialogManager = require('./smartbot-extended/DialogManager');
const EntityManager = require('./smartbot-extended/EntityManager');
const IntentManager = require('./smartbot-extended/IntentManager');
const HumanAssistanceSystem = require('./smartbot-extended/HumanAssistanceSystem');
const CacheManager = require('./smartbot-extended/CacheManager');
const RateLimitManager = require('./smartbot-extended/RateLimitManager');
const ContextManager = require('./smartbot-extended/ContextManager');
const SessionManager = require('./smartbot-extended/SessionManager');
const FeedbackAnalyzer = require('./smartbot-extended/FeedbackAnalyzer');
const SmartBotExtendedService = require('./smartbot-extended/SmartBotExtendedService');

module.exports = {
  DialogManager, EntityManager, IntentManager, HumanAssistanceSystem,
  CacheManager, RateLimitManager, ContextManager, SessionManager,
  FeedbackAnalyzer, SmartBotExtendedService,
};
