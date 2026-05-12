/**
 * Version Utility
 * WhatsHybrid v7.9.12
 */
(function() {
  'use strict';

  const WHLVersion = {
    /**
     * Obtém versão atual do manifesto
     */
    get() {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        return chrome.runtime.getManifest().version;
      }
      return '8.0.1'; // Fallback
    },

    /**
     * Obtém manifesto completo
     */
    getManifest() {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        return chrome.runtime.getManifest();
      }
      return { version: '8.0.1' };
    },

    /**
     * Compara versões (v1 >= v2)
     */
    isAtLeast(v1, v2) {
      const p1 = v1.split('.').map(Number);
      const p2 = v2.split('.').map(Number);
      
      for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        const n1 = p1[i] || 0;
        const n2 = p2[i] || 0;
        if (n1 > n2) return true;
        if (n1 < n2) return false;
      }
      return true;
    }
  };

  window.WHLVersion = WHLVersion;
})();