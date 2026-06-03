/**
 * Adapter para compatibilidade com SmartBot legado
 * WhatsHybrid v7.9.12
 */
(function() {
  'use strict';

  // Adapter para código legado que usa SmartBot
  window.SmartBot = {
    // Redirecionar para CopilotEngine se disponível
    analyze: async (message) => {
      console.warn('[SmartBot] Deprecated: use CopilotEngine.analyzeMessage()');
      return window.CopilotEngine?.analyzeMessage?.(message);
    },
    
    generateResponse: async (context) => {
      console.warn('[SmartBot] Deprecated: use CopilotEngine.generateResponse()');
      return window.CopilotEngine?.generateResponse?.(context);
    },

    // Marcar como deprecated
    _deprecated: true,
    _migratedTo: 'CopilotEngine'
  };

  // Alias para outros módulos legados
  window.SmartBotIA = window.SmartBot;
  window.SmartBotExtended = window.SmartBot;
  window.SmartBotAIPlus = window.SmartBot;
})();