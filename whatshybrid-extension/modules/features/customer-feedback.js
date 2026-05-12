/**
 * FEAT-004: Customer Feedback System - Thumbs up/down com learning automático
 * 
 * Benefícios:
 * - Coleta feedback direto dos usuários finais
 * - Auto-melhoria contínua da IA
 * - Métricas de satisfação em tempo real
 * 
 * @version 1.0.0
 * @since 7.9.14
 */

(function() {
  'use strict';

  // =============================================
  // CONFIGURAÇÃO
  // =============================================
  
  const CONFIG = {
    STORAGE_KEY: 'whl_customer_feedback',
    FEEDBACK_EXPIRY_DAYS: 90,
    
    // Thresholds para ações automáticas
    AUTO_LEARN_THRESHOLD: 0.8,    // Mínimo de positivos para auto-aprender
    ALERT_THRESHOLD: 0.3,          // Abaixo disso, alerta o operador
    MIN_SAMPLES_FOR_LEARNING: 3,   // Mínimo de amostras para tomar ação
    
    // Tipos de feedback
    FEEDBACK_TYPES: {
      POSITIVE: 'positive',
      NEGATIVE: 'negative',
      NEUTRAL: 'neutral',
      EDITED: 'edited'
    },
    
    // Categorias de problema (para feedback negativo)
    PROBLEM_CATEGORIES: {
      INCORRECT: 'Informação incorreta',
      INCOMPLETE: 'Resposta incompleta',
      IRRELEVANT: 'Não relevante',
      TONE: 'Tom inadequado',
      SLOW: 'Muito demorado',
      OTHER: 'Outro'
    },
    
    // UI Config
    UI: {
      FEEDBACK_DELAY_MS: 2000,     // Delay para mostrar botões
      TOAST_DURATION_MS: 3000
    }
  };

  // =============================================
  // ESTILOS CSS
  // =============================================
  
  const STYLES = `
    .whl-feedback-container {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-left: 8px;
      opacity: 0;
      transform: translateY(5px);
      transition: all 0.3s ease;
    }
    
    .whl-feedback-container.visible {
      opacity: 1;
      transform: translateY(0);
    }
    
    .whl-feedback-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.1);
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 14px;
    }
    
    .whl-feedback-btn:hover {
      background: rgba(255, 255, 255, 0.2);
      transform: scale(1.1);
    }
    
    .whl-feedback-btn.positive:hover {
      background: rgba(37, 211, 102, 0.3);
    }
    
    .whl-feedback-btn.negative:hover {
      background: rgba(255, 82, 82, 0.3);
    }
    
    .whl-feedback-btn.selected {
      transform: scale(1.15);
    }
    
    .whl-feedback-btn.selected.positive {
      background: rgba(37, 211, 102, 0.5);
      color: #25D366;
    }
    
    .whl-feedback-btn.selected.negative {
      background: rgba(255, 82, 82, 0.5);
      color: #FF5252;
    }
    
    .whl-feedback-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      opacity: 0;
      visibility: hidden;
      transition: all 0.3s ease;
    }
    
    .whl-feedback-modal.visible {
      opacity: 1;
      visibility: visible;
    }
    
    .whl-feedback-modal-content {
      background: #1F2C34;
      border-radius: 12px;
      padding: 24px;
      width: 90%;
      max-width: 400px;
      transform: translateY(20px);
      transition: transform 0.3s ease;
    }
    
    .whl-feedback-modal.visible .whl-feedback-modal-content {
      transform: translateY(0);
    }
    
    .whl-feedback-modal h3 {
      margin: 0 0 16px 0;
      color: #E9EDEF;
      font-size: 18px;
    }
    
    .whl-feedback-modal p {
      margin: 0 0 16px 0;
      color: #8696A0;
      font-size: 14px;
    }
    
    .whl-feedback-categories {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }
    
    .whl-feedback-category {
      padding: 8px 12px;
      border: 1px solid #3B4A54;
      border-radius: 16px;
      background: transparent;
      color: #E9EDEF;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.2s ease;
    }
    
    .whl-feedback-category:hover {
      border-color: #00A884;
    }
    
    .whl-feedback-category.selected {
      background: #00A884;
      border-color: #00A884;
    }
    
    .whl-feedback-textarea {
      width: 100%;
      min-height: 80px;
      padding: 12px;
      border: 1px solid #3B4A54;
      border-radius: 8px;
      background: #2A3942;
      color: #E9EDEF;
      resize: vertical;
      font-size: 14px;
      margin-bottom: 16px;
    }
    
    .whl-feedback-textarea:focus {
      outline: none;
      border-color: #00A884;
    }
    
    .whl-feedback-actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }
    
    .whl-feedback-btn-action {
      padding: 10px 20px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s ease;
    }
    
    .whl-feedback-btn-cancel {
      background: transparent;
      color: #8696A0;
    }
    
    .whl-feedback-btn-cancel:hover {
      color: #E9EDEF;
    }
    
    .whl-feedback-btn-submit {
      background: #00A884;
      color: white;
    }
    
    .whl-feedback-btn-submit:hover {
      background: #008069;
    }
    
    .whl-feedback-stats {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #1F2C34;
      border-radius: 12px;
      padding: 16px;
      min-width: 200px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      z-index: 9999;
    }
    
    .whl-feedback-stats h4 {
      margin: 0 0 12px 0;
      color: #E9EDEF;
      font-size: 14px;
    }
    
    .whl-feedback-stat-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 13px;
    }
    
    .whl-feedback-stat-label {
      color: #8696A0;
    }
    
    .whl-feedback-stat-value {
      color: #E9EDEF;
      font-weight: 500;
    }
    
    .whl-feedback-stat-value.positive {
      color: #25D366;
    }
    
    .whl-feedback-stat-value.negative {
      color: #FF5252;
    }
  `;

  // =============================================
  // CUSTOMER FEEDBACK SYSTEM
  // =============================================

  class CustomerFeedbackSystem {
    constructor() {
      this.feedbackData = {
        responses: {},        // Por responseId
        aggregate: {
          total: 0,
          positive: 0,
          negative: 0,
          edited: 0
        },
        byCategory: {},       // Estatísticas por categoria de problema
        learningQueue: []     // Fila para auto-aprendizado
      };
      this.pendingFeedback = new Map();
      this.initialized = false;
      
      this._init();
    }

    async _init() {
      this._injectStyles();
      await this._loadData();
      this._setupEventListeners();
      this.initialized = true;
      console.log('[CustomerFeedback] Initialized');
    }

    _injectStyles() {
      if (document.getElementById('whl-feedback-styles')) return;
      
      const style = document.createElement('style');
      style.id = 'whl-feedback-styles';
      style.textContent = STYLES;
      document.head.appendChild(style);
    }

    async _loadData() {
      try {
        const data = await this._getStorage(CONFIG.STORAGE_KEY);
        if (data) {
          this.feedbackData = { ...this.feedbackData, ...data };
        }
      } catch (e) {
        console.warn('[CustomerFeedback] Failed to load data:', e);
      }
    }

    async _saveData() {
      try {
        await this._setStorage(CONFIG.STORAGE_KEY, this.feedbackData);
      } catch (e) {
        console.warn('[CustomerFeedback] Failed to save data:', e);
      }
    }

    _getStorage(key) {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.get([key], (result) => resolve(result[key]));
        } else {
          resolve(null);
        }
      });
    }

    _setStorage(key, value) {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.set({ [key]: value }, resolve);
        } else {
          resolve();
        }
      });
    }

    _setupEventListeners() {
      // Escutar eventos de resposta da IA
      if (window.WHLEventBus) {
        window.WHLEventBus.on('aiResponseSent', (data) => {
          this._handleAIResponse(data);
        });
        
        window.WHLEventBus.on('messageEdited', (data) => {
          this._handleMessageEdit(data);
        });
      }
      
      // Escutar cliques nos botões de feedback
      document.addEventListener('click', (e) => {
        if (e.target.closest('.whl-feedback-btn')) {
          this._handleFeedbackClick(e);
        }
      });
    }

    _handleAIResponse(data) {
      const { responseId, message, contactId, timestamp } = data;
      
      if (!responseId) return;
      
      // Agendar injeção dos botões de feedback
      setTimeout(() => {
        this._injectFeedbackButtons(responseId, data);
      }, CONFIG.UI.FEEDBACK_DELAY_MS);
    }

    _handleMessageEdit(data) {
      const { responseId, originalMessage, editedMessage } = data;
      
      if (!responseId) return;
      
      // Registrar como feedback de edição
      this.recordFeedback(responseId, CONFIG.FEEDBACK_TYPES.EDITED, {
        originalMessage,
        editedMessage,
        automatic: true
      });
    }

    /**
     * Injeta botões de feedback em uma mensagem
     * @param {string} responseId - ID da resposta
     * @param {Object} data - Dados da resposta
     */
    _injectFeedbackButtons(responseId, data) {
      // Encontrar o elemento da mensagem
      const messageElement = this._findMessageElement(responseId, data);
      if (!messageElement) return;
      
      // Verificar se já tem botões
      if (messageElement.querySelector('.whl-feedback-container')) return;
      
      // Criar container de feedback
      const container = document.createElement('div');
      container.className = 'whl-feedback-container';
      container.dataset.responseId = responseId;
      
      container.innerHTML = `
        <button class="whl-feedback-btn positive" data-type="positive" title="Boa resposta">
          👍
        </button>
        <button class="whl-feedback-btn negative" data-type="negative" title="Resposta pode melhorar">
          👎
        </button>
      `;
      
      // Armazenar dados pendentes
      this.pendingFeedback.set(responseId, {
        ...data,
        injectedAt: Date.now()
      });
      
      // Inserir no DOM
      const footerElement = messageElement.querySelector('[data-pre-plain-text]') || 
                           messageElement.querySelector('.copyable-text');
      if (footerElement) {
        footerElement.appendChild(container);
      } else {
        messageElement.appendChild(container);
      }
      
      // Animar entrada
      requestAnimationFrame(() => {
        container.classList.add('visible');
      });
    }

    _findMessageElement(responseId, data) {
      // Tentar encontrar pelo data attribute
      let element = document.querySelector(`[data-response-id="${responseId}"]`);
      if (element) return element;
      
      // Fallback: encontrar pela mensagem
      if (data.message) {
        const allMessages = document.querySelectorAll('.message-out');
        for (const msg of allMessages) {
          const textElement = msg.querySelector('.copyable-text [class*="selectable-text"]');
          if (textElement && textElement.textContent.includes(data.message.substring(0, 50))) {
            msg.dataset.responseId = responseId;
            return msg;
          }
        }
      }
      
      return null;
    }

    _handleFeedbackClick(event) {
      const button = event.target.closest('.whl-feedback-btn');
      if (!button) return;
      
      const container = button.closest('.whl-feedback-container');
      const responseId = container?.dataset.responseId;
      const feedbackType = button.dataset.type;
      
      if (!responseId || !feedbackType) return;
      
      // Marcar como selecionado
      container.querySelectorAll('.whl-feedback-btn').forEach(btn => {
        btn.classList.remove('selected');
      });
      button.classList.add('selected');
      
      if (feedbackType === CONFIG.FEEDBACK_TYPES.NEGATIVE) {
        // Mostrar modal para detalhes
        this._showFeedbackModal(responseId);
      } else {
        // Feedback positivo direto
        this.recordFeedback(responseId, feedbackType);
        this._showThankYou();
      }
    }

    _showFeedbackModal(responseId) {
      const pendingData = this.pendingFeedback.get(responseId);
      
      // Remover modal existente
      const existingModal = document.querySelector('.whl-feedback-modal');
      if (existingModal) existingModal.remove();
      
      const modal = document.createElement('div');
      modal.className = 'whl-feedback-modal';
      modal.innerHTML = `
        <div class="whl-feedback-modal-content">
          <h3>O que poderia ser melhor?</h3>
          <p>Seu feedback ajuda a IA a melhorar.</p>
          
          <div class="whl-feedback-categories">
            ${Object.entries(CONFIG.PROBLEM_CATEGORIES).map(([key, label]) => `
              <button class="whl-feedback-category" data-category="${key}">
                ${label}
              </button>
            `).join('')}
          </div>
          
          <textarea 
            class="whl-feedback-textarea" 
            placeholder="Detalhes adicionais (opcional)..."
          ></textarea>
          
          <div class="whl-feedback-actions">
            <button class="whl-feedback-btn-action whl-feedback-btn-cancel">
              Cancelar
            </button>
            <button class="whl-feedback-btn-action whl-feedback-btn-submit">
              Enviar
            </button>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      
      // Animar entrada
      requestAnimationFrame(() => {
        modal.classList.add('visible');
      });
      
      // Event listeners
      let selectedCategory = null;
      
      modal.querySelectorAll('.whl-feedback-category').forEach(btn => {
        btn.addEventListener('click', () => {
          modal.querySelectorAll('.whl-feedback-category').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          selectedCategory = btn.dataset.category;
        });
      });
      
      modal.querySelector('.whl-feedback-btn-cancel').addEventListener('click', () => {
        this._closeModal(modal);
      });
      
      modal.querySelector('.whl-feedback-btn-submit').addEventListener('click', () => {
        const comment = modal.querySelector('.whl-feedback-textarea').value;
        
        this.recordFeedback(responseId, CONFIG.FEEDBACK_TYPES.NEGATIVE, {
          category: selectedCategory,
          comment,
          originalMessage: pendingData?.message
        });
        
        this._closeModal(modal);
        this._showThankYou();
      });
      
      // Fechar ao clicar fora
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this._closeModal(modal);
        }
      });
    }

    _closeModal(modal) {
      modal.classList.remove('visible');
      setTimeout(() => modal.remove(), 300);
    }

    _showThankYou() {
      if (window.WHLToast) {
        window.WHLToast.showToast('Obrigado pelo feedback! 🙏', 'success', CONFIG.UI.TOAST_DURATION_MS);
      }
    }

    /**
     * Registra feedback para uma resposta
     * @param {string} responseId - ID da resposta
     * @param {string} type - Tipo de feedback
     * @param {Object} details - Detalhes adicionais
     */
    async recordFeedback(responseId, type, details = {}) {
      const pendingData = this.pendingFeedback.get(responseId) || {};
      
      const feedback = {
        responseId,
        type,
        details,
        timestamp: Date.now(),
        message: pendingData.message,
        contactId: pendingData.contactId,
        question: pendingData.question,
        confidence: pendingData.confidence
      };
      
      // Armazenar feedback
      this.feedbackData.responses[responseId] = feedback;
      
      // Atualizar agregados
      this.feedbackData.aggregate.total++;
      if (type === CONFIG.FEEDBACK_TYPES.POSITIVE) {
        this.feedbackData.aggregate.positive++;
      } else if (type === CONFIG.FEEDBACK_TYPES.NEGATIVE) {
        this.feedbackData.aggregate.negative++;
        
        // Atualizar por categoria
        if (details.category) {
          this.feedbackData.byCategory[details.category] = 
            (this.feedbackData.byCategory[details.category] || 0) + 1;
        }
      } else if (type === CONFIG.FEEDBACK_TYPES.EDITED) {
        this.feedbackData.aggregate.edited++;
      }
      
      // Limpar do pending
      this.pendingFeedback.delete(responseId);
      
      // Salvar
      await this._saveData();
      
      // Processar para learning
      await this._processForLearning(feedback);
      
      // Emitir evento
      if (window.WHLEventBus) {
        window.WHLEventBus.emit('customerFeedback', feedback);
      }
      
      console.log('[CustomerFeedback] Recorded:', type, responseId);
    }

    async _processForLearning(feedback) {
      // Se positivo e alta confiança, adicionar à base de conhecimento
      if (feedback.type === CONFIG.FEEDBACK_TYPES.POSITIVE && 
          feedback.confidence >= CONFIG.AUTO_LEARN_THRESHOLD) {
        
        this.feedbackData.learningQueue.push({
          question: feedback.question,
          answer: feedback.message,
          category: 'customer_approved',
          source: 'feedback_positive',
          timestamp: Date.now()
        });
        
        // Auto-aprender se tiver sistema disponível
        if (window.FewShotLearning && feedback.question && feedback.message) {
          try {
            await window.FewShotLearning.addExample(
              feedback.question,
              feedback.message,
              'customer_approved'
            );
            console.log('[CustomerFeedback] Auto-learned from positive feedback');
          } catch (e) {
            console.warn('[CustomerFeedback] Failed to auto-learn:', e);
          }
        }
      }
      
      // Se muito negativo, alertar operador
      if (feedback.type === CONFIG.FEEDBACK_TYPES.NEGATIVE) {
        const recentNegative = this._getRecentNegativeRate();
        if (recentNegative > (1 - CONFIG.ALERT_THRESHOLD)) {
          this._alertOperator(feedback);
        }
      }
    }

    _getRecentNegativeRate() {
      const recentFeedback = Object.values(this.feedbackData.responses)
        .filter(f => Date.now() - f.timestamp < 3600000) // Última hora
        .filter(f => [CONFIG.FEEDBACK_TYPES.POSITIVE, CONFIG.FEEDBACK_TYPES.NEGATIVE].includes(f.type));
      
      if (recentFeedback.length < CONFIG.MIN_SAMPLES_FOR_LEARNING) return 0;
      
      const negative = recentFeedback.filter(f => f.type === CONFIG.FEEDBACK_TYPES.NEGATIVE).length;
      return negative / recentFeedback.length;
    }

    _alertOperator(feedback) {
      if (window.WHLEventBus) {
        window.WHLEventBus.emit('feedbackAlert', {
          type: 'high_negative_rate',
          feedback,
          rate: this._getRecentNegativeRate()
        });
      }
      
      console.warn('[CustomerFeedback] High negative rate alert!');
    }

    /**
     * Obtém estatísticas de feedback
     */
    getStats() {
      const { aggregate, byCategory } = this.feedbackData;
      
      const positiveRate = aggregate.total > 0 
        ? (aggregate.positive / aggregate.total * 100).toFixed(1)
        : 0;
      
      const negativeRate = aggregate.total > 0
        ? (aggregate.negative / aggregate.total * 100).toFixed(1)
        : 0;
      
      return {
        total: aggregate.total,
        positive: aggregate.positive,
        negative: aggregate.negative,
        edited: aggregate.edited,
        positiveRate: positiveRate + '%',
        negativeRate: negativeRate + '%',
        satisfactionScore: positiveRate,
        topProblems: Object.entries(byCategory)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([category, count]) => ({
            category,
            label: CONFIG.PROBLEM_CATEGORIES[category],
            count
          })),
        learningQueueSize: this.feedbackData.learningQueue.length
      };
    }

    /**
     * Mostra widget de estatísticas
     */
    showStatsWidget() {
      // Remover existente
      const existing = document.querySelector('.whl-feedback-stats');
      if (existing) {
        existing.remove();
        return;
      }
      
      const stats = this.getStats();
      
      const widget = document.createElement('div');
      widget.className = 'whl-feedback-stats';
      widget.innerHTML = `
        <h4>📊 Feedback dos Clientes</h4>
        <div class="whl-feedback-stat-row">
          <span class="whl-feedback-stat-label">Total de feedbacks:</span>
          <span class="whl-feedback-stat-value">${stats.total}</span>
        </div>
        <div class="whl-feedback-stat-row">
          <span class="whl-feedback-stat-label">👍 Positivos:</span>
          <span class="whl-feedback-stat-value positive">${stats.positive} (${stats.positiveRate})</span>
        </div>
        <div class="whl-feedback-stat-row">
          <span class="whl-feedback-stat-label">👎 Negativos:</span>
          <span class="whl-feedback-stat-value negative">${stats.negative} (${stats.negativeRate})</span>
        </div>
        <div class="whl-feedback-stat-row">
          <span class="whl-feedback-stat-label">✏️ Editados:</span>
          <span class="whl-feedback-stat-value">${stats.edited}</span>
        </div>
        <div class="whl-feedback-stat-row">
          <span class="whl-feedback-stat-label">⭐ Satisfação:</span>
          <span class="whl-feedback-stat-value positive">${stats.satisfactionScore}%</span>
        </div>
      `;
      
      document.body.appendChild(widget);
      
      // Fechar ao clicar fora
      setTimeout(() => {
        document.addEventListener('click', function closeWidget(e) {
          if (!widget.contains(e.target)) {
            widget.remove();
            document.removeEventListener('click', closeWidget);
          }
        });
      }, 100);
    }

    /**
     * Exporta dados de feedback
     */
    exportData() {
      return {
        ...this.feedbackData,
        stats: this.getStats(),
        exportedAt: new Date().toISOString()
      };
    }

    /**
     * Limpa dados antigos
     */
    async cleanup() {
      const expiryTime = Date.now() - (CONFIG.FEEDBACK_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      
      let cleaned = 0;
      for (const [id, feedback] of Object.entries(this.feedbackData.responses)) {
        if (feedback.timestamp < expiryTime) {
          delete this.feedbackData.responses[id];
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        await this._saveData();
        console.log(`[CustomerFeedback] Cleaned ${cleaned} old feedbacks`);
      }
      
      return cleaned;
    }
  }

  // =============================================
  // INICIALIZAÇÃO
  // =============================================

  const feedbackSystem = new CustomerFeedbackSystem();

  // Expor globalmente
  window.WHLCustomerFeedback = feedbackSystem;
  window.WHLFeedbackConfig = CONFIG;

  console.log('[FEAT-004] Customer Feedback System initialized');

})();
