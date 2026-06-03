/**
 * 🌍 WhatsHybrid - Seletor de Idioma
 * Componente UI para seleção de idioma
 * 
 * @version 7.9.13
 */

(function() {
  'use strict';

  /**
   * Cria o componente de seleção de idioma
   */
  class LanguageSelector {
    constructor(options = {}) {
      this.containerId = options.containerId || 'whl-language-selector';
      this.showFlags = options.showFlags !== false;
      this.showNativeName = options.showNativeName !== false;
      this.compact = options.compact || false;
      this.onSelect = options.onSelect || null;
      this.element = null;
    }

    /**
     * Renderiza o seletor
     */
    render(container) {
      if (!window.WHLi18n) {
        console.error('[LanguageSelector] WHLi18n não inicializado');
        return;
      }

      const i18n = window.WHLi18n;
      const languages = i18n.getAvailableLanguages();
      const currentLang = i18n.getLanguage();

      // Criar container
      this.element = document.createElement('div');
      this.element.id = this.containerId;
      this.element.className = 'whl-language-selector';

      if (this.compact) {
        this._renderCompact(languages, currentLang);
      } else {
        this._renderFull(languages, currentLang);
      }

      // Anexar ao container
      if (typeof container === 'string') {
        container = document.querySelector(container);
      }
      
      if (container) {
        container.appendChild(this.element);
      }

      return this.element;
    }

    /**
     * Renderiza versão compacta (dropdown)
     */
    _renderCompact(languages, currentLang) {
      const current = languages.find(l => l.code === currentLang);
      
      this.element.innerHTML = `
        <div class="whl-lang-compact">
          <button class="whl-lang-trigger" id="whl-lang-trigger">
            <span class="whl-lang-flag">${current?.flag || '🌐'}</span>
            <span class="whl-lang-code">${currentLang.toUpperCase()}</span>
            <svg class="whl-lang-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <div class="whl-lang-dropdown" id="whl-lang-dropdown" style="display: none;">
            ${languages.map(lang => `
              <button class="whl-lang-option ${lang.current ? 'active' : ''}" data-lang="${lang.code}">
                <span class="whl-lang-flag">${lang.flag}</span>
                <span class="whl-lang-name">${this.showNativeName ? lang.nativeName : lang.name}</span>
                ${lang.current ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
              </button>
            `).join('')}
          </div>
        </div>
      `;

      // Event listeners
      const trigger = this.element.querySelector('#whl-lang-trigger');
      const dropdown = this.element.querySelector('#whl-lang-dropdown');

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
      });

      document.addEventListener('click', () => {
        dropdown.style.display = 'none';
      });

      this.element.querySelectorAll('.whl-lang-option').forEach(btn => {
        btn.addEventListener('click', async () => {
          const lang = btn.dataset.lang;
          await this._selectLanguage(lang);
          dropdown.style.display = 'none';
        });
      });
    }

    /**
     * Renderiza versão completa (lista)
     */
    _renderFull(languages, currentLang) {
      this.element.innerHTML = `
        <div class="whl-lang-full">
          <h3 class="whl-lang-title" data-i18n="settings.language">Idioma</h3>
          <div class="whl-lang-list">
            ${languages.map(lang => `
              <button class="whl-lang-item ${lang.current ? 'active' : ''}" data-lang="${lang.code}">
                ${this.showFlags ? `<span class="whl-lang-flag">${lang.flag}</span>` : ''}
                <div class="whl-lang-info">
                  <span class="whl-lang-name">${lang.name}</span>
                  ${this.showNativeName && lang.name !== lang.nativeName ? 
                    `<span class="whl-lang-native">${lang.nativeName}</span>` : ''}
                </div>
                ${lang.current ? `
                  <svg class="whl-lang-check" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                ` : ''}
              </button>
            `).join('')}
          </div>
        </div>
      `;

      // Event listeners
      this.element.querySelectorAll('.whl-lang-item').forEach(btn => {
        btn.addEventListener('click', async () => {
          const lang = btn.dataset.lang;
          await this._selectLanguage(lang);
        });
      });
    }

    /**
     * Seleciona um idioma
     */
    async _selectLanguage(lang) {
      if (!window.WHLi18n) return;

      const success = await window.WHLi18n.setLanguage(lang);
      
      if (success) {
        // Re-renderizar
        const parent = this.element.parentNode;
        this.element.remove();
        this.render(parent);

        // Callback
        if (typeof this.onSelect === 'function') {
          this.onSelect(lang);
        }

        // Toast
        if (window.WHLToast?.showToast) {
          window.WHLToast.showToast(window.t('messages.saved'), 'success');
        }
      }
    }

    /**
     * Destrói o componente
     */
    destroy() {
      if (this.element) {
        this.element.remove();
        this.element = null;
      }
    }
  }

  /**
   * Injeta estilos CSS
   */
  function injectStyles() {
    if (document.getElementById('whl-language-selector-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'whl-language-selector-styles';
    styles.textContent = `
      .whl-language-selector {
        font-family: system-ui, -apple-system, sans-serif;
      }

      /* Versão compacta */
      .whl-lang-compact {
        position: relative;
        display: inline-block;
      }

      .whl-lang-trigger {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: var(--whl-bg-secondary, #374151);
        border: 1px solid var(--whl-border, #4B5563);
        border-radius: 8px;
        color: var(--whl-text, #F3F4F6);
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
      }

      .whl-lang-trigger:hover {
        background: var(--whl-bg-hover, #4B5563);
      }

      .whl-lang-flag {
        font-size: 18px;
        line-height: 1;
      }

      .whl-lang-code {
        font-weight: 500;
      }

      .whl-lang-arrow {
        opacity: 0.7;
        transition: transform 0.2s;
      }

      .whl-lang-dropdown {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        min-width: 200px;
        margin-top: 4px;
        padding: 8px;
        background: var(--whl-bg-primary, #1F2937);
        border: 1px solid var(--whl-border, #374151);
        border-radius: 12px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
        z-index: 1000;
        max-height: 300px;
        overflow-y: auto;
      }

      .whl-lang-option {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 10px 12px;
        background: transparent;
        border: none;
        border-radius: 8px;
        color: var(--whl-text, #F3F4F6);
        cursor: pointer;
        font-size: 14px;
        text-align: left;
        transition: background 0.15s;
      }

      .whl-lang-option:hover {
        background: var(--whl-bg-hover, #374151);
      }

      .whl-lang-option.active {
        background: var(--whl-primary, #3B82F6);
      }

      .whl-lang-option .whl-lang-name {
        flex: 1;
      }

      /* Versão completa */
      .whl-lang-full {
        padding: 16px;
      }

      .whl-lang-title {
        margin: 0 0 16px 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--whl-text, #F3F4F6);
      }

      .whl-lang-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .whl-lang-item {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 12px 16px;
        background: var(--whl-bg-secondary, #374151);
        border: 1px solid transparent;
        border-radius: 10px;
        color: var(--whl-text, #F3F4F6);
        cursor: pointer;
        font-size: 14px;
        text-align: left;
        transition: all 0.2s;
      }

      .whl-lang-item:hover {
        background: var(--whl-bg-hover, #4B5563);
        border-color: var(--whl-primary, #3B82F6);
      }

      .whl-lang-item.active {
        background: rgba(59, 130, 246, 0.15);
        border-color: var(--whl-primary, #3B82F6);
      }

      .whl-lang-info {
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .whl-lang-name {
        font-weight: 500;
      }

      .whl-lang-native {
        font-size: 12px;
        opacity: 0.7;
        margin-top: 2px;
      }

      .whl-lang-check {
        color: var(--whl-primary, #3B82F6);
      }

      /* RTL support */
      [dir="rtl"] .whl-lang-dropdown {
        left: auto;
        right: 0;
      }

      [dir="rtl"] .whl-lang-option,
      [dir="rtl"] .whl-lang-item {
        text-align: right;
        flex-direction: row-reverse;
      }
    `;

    document.head.appendChild(styles);
  }

  // Injetar estilos
  injectStyles();

  // Expor globalmente
  window.WHLLanguageSelector = LanguageSelector;

  /**
   * Helper para criar seletor rapidamente
   */
  window.createLanguageSelector = (container, options = {}) => {
    const selector = new LanguageSelector(options);
    return selector.render(container);
  };
})();
