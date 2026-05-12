/**
 * UI Helpers - Utilitários de Interface
 * WhatsHybrid v7.9.12
 */
(function() {
  'use strict';

  /**
   * Wrapper para botões com loading automático
   */
  function withLoading(button, asyncFn) {
    return async (...args) => {
      if (button.disabled) return;
      
      const originalContent = button.innerHTML;
      const originalWidth = button.offsetWidth;
      
      // Desabilitar e mostrar spinner
      button.disabled = true;
      button.style.minWidth = `${originalWidth}px`;
      button.innerHTML = '<span class="whl-spinner"></span>';
      
      try {
        const result = await asyncFn(...args);
        return result;
      } finally {
        // Restaurar estado
        button.disabled = false;
        button.innerHTML = originalContent;
        button.style.minWidth = '';
      }
    };
  }

  /**
   * Debounce para prevenir cliques múltiplos ou chamadas excessivas
   */
  function debounce(fn, delay = 300) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), delay);
    };
  }

  /**
   * Click único (previne duplo clique)
   */
  function singleClick(button, handler) {
    let processing = false;
    
    button.addEventListener('click', async (e) => {
      if (processing) {
        e.preventDefault();
        return;
      }
      
      processing = true;
      
      try {
        await handler(e);
      } finally {
        setTimeout(() => { processing = false; }, 500);
      }
    });
  }

  /**
   * Configura toggle com persistência imediata
   */
  function setupToggle(toggleElement, storageKey, onChange) {
    if (!toggleElement) return;

    // Carregar estado inicial
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(storageKey, (result) => {
        toggleElement.checked = result[storageKey] === true;
      });
    }

    // Salvar IMEDIATAMENTE ao mudar
    toggleElement.addEventListener('change', async (e) => {
      const newValue = e.target.checked;
      
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.set({ [storageKey]: newValue });
      }
      
      if (typeof onChange === 'function') {
        try {
          await onChange(newValue);
        } catch (err) {
          console.error('[UIHelper] Toggle change error:', err);
          // Reverter em caso de erro
          toggleElement.checked = !newValue;
          if (typeof chrome !== 'undefined' && chrome.storage) {
            await chrome.storage.local.set({ [storageKey]: !newValue });
          }
        }
      }
    });
  }

  window.WHLUIHelpers = {
    withLoading,
    debounce,
    singleClick,
    setupToggle
  };
})();