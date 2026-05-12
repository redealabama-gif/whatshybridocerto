/**
 * 🔘 Toggle Helper - Gerenciamento simplificado de toggles
 * WhatsHybrid v7.9.12
 * 
 * Simplifica a configuração de toggles de UI com persistência
 * automática em chrome.storage.local.
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  /**
   * Configura um toggle com persistência automática
   * @param {string} toggleId - ID do elemento toggle
   * @param {string} storageKey - Chave do chrome.storage
   * @param {Object} options - Opções
   * @param {boolean} options.defaultValue - Valor padrão
   * @param {Function} options.onChange - Callback ao mudar
   * @param {boolean} options.inverted - Inverter lógica do toggle
   */
  async function setupToggle(toggleId, storageKey, options = {}) {
    const {
      defaultValue = false,
      onChange = null,
      inverted = false
    } = options;

    const toggle = document.getElementById(toggleId);
    if (!toggle) {
      console.warn(`[ToggleHelper] Toggle não encontrado: ${toggleId}`);
      return null;
    }

    // Carregar valor salvo
    let savedValue = defaultValue;
    try {
      const data = await chrome.storage.local.get(storageKey);
      if (data[storageKey] !== undefined) {
        savedValue = data[storageKey];
      }
    } catch (error) {
      console.warn(`[ToggleHelper] Erro ao carregar ${storageKey}:`, error);
    }

    // Aplicar valor inicial
    const checkValue = inverted ? !savedValue : savedValue;
    toggle.checked = checkValue;

    // Listener para mudanças
    toggle.addEventListener('change', async (e) => {
      const isChecked = e.target.checked;
      const valueToSave = inverted ? !isChecked : isChecked;

      // Salvar no storage
      try {
        await chrome.storage.local.set({ [storageKey]: valueToSave });
      } catch (error) {
        console.error(`[ToggleHelper] Erro ao salvar ${storageKey}:`, error);
      }

      // Callback se fornecido
      if (typeof onChange === 'function') {
        try {
          onChange(valueToSave, e);
        } catch (error) {
          console.error(`[ToggleHelper] Erro no callback de ${toggleId}:`, error);
        }
      }

      // Emitir evento
      if (window.EventBus) {
        window.EventBus.emit('toggle:changed', {
          toggleId,
          storageKey,
          value: valueToSave
        });
      }
    });

    return {
      toggle,
      getValue: () => {
        const checked = toggle.checked;
        return inverted ? !checked : checked;
      },
      setValue: async (value) => {
        toggle.checked = inverted ? !value : value;
        try {
          await chrome.storage.local.set({ [storageKey]: value });
        } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      }
    };
  }

  /**
   * Configura múltiplos toggles de uma vez
   * @param {Array<Object>} configs - Array de configurações
   * @returns {Promise<Map>} - Map de toggleId -> controller
   */
  async function setupToggles(configs) {
    const controllers = new Map();

    for (const config of configs) {
      const controller = await setupToggle(
        config.id,
        config.key,
        {
          defaultValue: config.default,
          onChange: config.onChange,
          inverted: config.inverted
        }
      );

      if (controller) {
        controllers.set(config.id, controller);
      }
    }

    return controllers;
  }

  /**
   * Cria um toggle HTML programaticamente
   * @param {Object} options - Opções do toggle
   * @returns {HTMLElement} - Elemento do toggle
   */
  function createToggle(options = {}) {
    const {
      id = `toggle_${Date.now()}`,
      label = '',
      checked = false,
      disabled = false,
      className = ''
    } = options;

    const wrapper = document.createElement('label');
    wrapper.className = `whl-toggle-wrapper ${className}`;
    wrapper.setAttribute('for', id);

    wrapper.innerHTML = `
      <span class="whl-toggle-label">${label}</span>
      <div class="whl-toggle">
        <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span class="whl-toggle-slider"></span>
      </div>
    `;

    return wrapper;
  }

  /**
   * Injeta estilos padrão para toggles
   */
  function injectToggleStyles() {
    if (document.getElementById('whl-toggle-styles')) return;

    const style = document.createElement('style');
    style.id = 'whl-toggle-styles';
    style.textContent = `
      .whl-toggle-wrapper {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        cursor: pointer;
      }

      .whl-toggle-label {
        font-size: 13px;
        color: #e5e7eb;
      }

      .whl-toggle {
        position: relative;
        width: 42px;
        height: 24px;
      }

      .whl-toggle input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .whl-toggle-slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: #4b5563;
        transition: 0.3s;
        border-radius: 24px;
      }

      .whl-toggle-slider:before {
        position: absolute;
        content: "";
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: 0.3s;
        border-radius: 50%;
      }

      .whl-toggle input:checked + .whl-toggle-slider {
        background-color: #8b5cf6;
      }

      .whl-toggle input:checked + .whl-toggle-slider:before {
        transform: translateX(18px);
      }

      .whl-toggle input:disabled + .whl-toggle-slider {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `;

    document.head.appendChild(style);
  }

  // Exportar globalmente
  window.WHLToggleHelper = {
    setupToggle,
    setupToggles,
    createToggle,
    injectToggleStyles
  };

  console.log('[ToggleHelper] ✅ Helper de toggles carregado');
})();
