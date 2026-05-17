/**
 * Training IA - WhatsHybrid
 * Interface para treinamento da IA
 *
 * @version 9.5.1
 */

class TrainingApp {
  constructor() {
    this.examples = [];
    this.faqs = [];
    this.products = [];
    this.businessInfo = {};
    this.currentEditId = null;

    // Simulação
    this.simulation = null;
    this.isSimulationRunning = false;

    this.init();
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  async init() {
    console.log('[TrainingApp] Inicializando...');

    await this.loadAllData();
    this.setupEventListeners();
    this.renderAll();
    this.updateConnectionStatus();
    this.initSimulation();

    console.log('[TrainingApp] ✅ Inicializado');
  }

  // ============================================
  // CARREGAR DADOS
  // ============================================

  async loadAllData() {
    try {
      // Carregar exemplos (few-shot)
      const examplesData = await chrome.storage.local.get('whl_few_shot_examples');
      const rawExamples = examplesData.whl_few_shot_examples;
      if (typeof rawExamples === 'string') {
        try {
          this.examples = JSON.parse(rawExamples);
        } catch (e) {
          console.warn('Failed to parse examples string:', e);
          this.examples = [];
        }
      } else if (Array.isArray(rawExamples)) {
        this.examples = rawExamples;
      } else {
        this.examples = [];
      }

      // Carregar knowledge base (FAQs, produtos, business)
      const kbData = await chrome.storage.local.get('whl_knowledge_base');
      const kb = kbData.whl_knowledge_base || {};

      this.faqs = kb.faqs || kb.faq || [];
      this.products = kb.products || [];
      this.businessInfo = kb.businessInfo || kb.business || {};

      this.updateStats();

      console.log('[TrainingApp] Dados carregados:', {
        examples: this.examples.length,
        faqs: this.faqs.length,
        products: this.products.length
      });

    } catch (error) {
      console.error('[TrainingApp] Erro ao carregar dados:', error);
      this.showToast('Erro ao carregar dados', 'error');
    }
  }

  // ============================================
  // SALVAR DADOS
  // ============================================

  async saveExamples() {
    try {
      await chrome.storage.local.set({ whl_few_shot_examples: JSON.stringify(this.examples) });
    } catch (error) {
      console.error('[TrainingApp] Erro ao salvar exemplos:', error);
    }
  }

  async saveKnowledgeBase() {
    try {
      const existing = await chrome.storage.local.get('whl_knowledge_base');
      let currentKB = existing.whl_knowledge_base || {};

      if (typeof currentKB === 'string') {
        try {
          currentKB = JSON.parse(currentKB);
        } catch (e) {
          currentKB = {};
        }
      }

      const kb = {
        ...currentKB,
        faq: this.faqs,
        products: this.products,
        business: this.businessInfo,
        lastUpdated: Date.now(),
        updatedAt: Date.now()
      };

      await chrome.storage.local.set({ whl_knowledge_base: kb });
    } catch (error) {
      console.error('[TrainingApp] Erro ao salvar KB:', error);
    }
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================

  setupEventListeners() {
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // Search
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.handleSearch(e.target.value);
    });

    // Header buttons
    document.getElementById('btnSync')?.addEventListener('click', () => this.syncWithBackend());
    document.getElementById('btnImport')?.addEventListener('click', () => this.importData());
    document.getElementById('btnExport')?.addEventListener('click', () => this.exportData());

    // Exemplos
    document.getElementById('btnAddExample')?.addEventListener('click', () => this.openExampleModal());
    document.getElementById('btnSaveExample')?.addEventListener('click', () => this.saveExample());
    document.getElementById('btnDeleteExample')?.addEventListener('click', () => this.deleteExample());
    document.getElementById('btnCancelExample')?.addEventListener('click', () => this.closeModal('exampleModal'));
    document.getElementById('closeExampleModal')?.addEventListener('click', () => this.closeModal('exampleModal'));

    // FAQs
    document.getElementById('btnAddFaq')?.addEventListener('click', () => this.openFaqModal());
    document.getElementById('btnSaveFaq')?.addEventListener('click', () => this.saveFaq());
    document.getElementById('btnDeleteFaq')?.addEventListener('click', () => this.deleteFaq());
    document.getElementById('btnCancelFaq')?.addEventListener('click', () => this.closeModal('faqModal'));
    document.getElementById('closeFaqModal')?.addEventListener('click', () => this.closeModal('faqModal'));

    // Produtos
    document.getElementById('btnAddProduct')?.addEventListener('click', () => this.openProductModal());
    document.getElementById('btnSaveProduct')?.addEventListener('click', () => this.saveProduct());
    document.getElementById('btnDeleteProduct')?.addEventListener('click', () => this.deleteProduct());
    document.getElementById('btnCancelProduct')?.addEventListener('click', () => this.closeModal('productModal'));
    document.getElementById('closeProductModal')?.addEventListener('click', () => this.closeModal('productModal'));

    // Business Info
    document.getElementById('btnSaveBusiness')?.addEventListener('click', () => this.saveBusinessInfo());

    // Close modals on backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('active');
        }
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
      }
    });

    // ===== IMPORT TAB =====
    this.setupImportListeners();
  }

  // ============================================
  // IMPORT LISTENERS
  // ============================================

  setupImportListeners() {
    // File upload zone
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');

    if (uploadZone && fileInput) {
      uploadZone.addEventListener('click', () => fileInput.click());
      uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
      });
      uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
      });
      uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        this.handleFileUpload(e.dataTransfer.files);
      });
      fileInput.addEventListener('change', (e) => {
        this.handleFileUpload(e.target.files);
      });
    }

  }

  // ============================================
  // TABS
  // ============================================

  switchTab(tabId) {
    // Update buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Update content
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === `tab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`);
    });

    // Refresh content
    switch (tabId) {
      case 'simulation':
        // Simulação - já inicializada no constructor
        break;
      case 'examples':
        this.renderExamples();
        break;
      case 'faqs':
        this.renderFaqs();
        break;
      case 'products':
        this.renderProducts();
        break;
      case 'business':
        this.loadBusinessForm();
        break;
      case 'import':
        this.renderImportTab();
        break;
    }
  }

  // ============================================
  // RENDER
  // ============================================

  renderAll() {
    this.renderExamples();
    this.renderFaqs();
    this.renderProducts();
    this.loadBusinessForm();
    this.updateStats();
  }

  renderExamples() {
    const grid = document.getElementById('examplesGrid');
    const empty = document.getElementById('emptyExamples');

    if (!grid) return;

    if (this.examples.length === 0) {
      grid.innerHTML = '';
      if (empty) empty.style.display = 'flex';
      return;
    }

    if (empty) empty.style.display = 'none';

    grid.innerHTML = this.examples.map(ex => {
      const quality = Number(ex.quality) || 8;
      const isEdited = ex.edited === true || quality >= 10;
      const qualityBadge = isEdited
        ? '<span class="quality-badge quality-edited" title="Editado pelo curador (qualidade máxima)">✏️ Editado</span>'
        : `<span class="quality-badge quality-approved" title="Aprovado sem edição">${quality}/10</span>`;
      const ageLabel = this.formatRelativeAge(ex.createdAt || ex.id);
      return `
      <div class="example-card" data-id="${parseInt(ex.id) || 0}">
        <div class="example-header">
          <span class="example-category">${this.escapeHtml(ex.category || 'Geral')}</span>
          <div class="example-quality">
            ${qualityBadge}
          </div>
        </div>
        <div class="example-input">${this.escapeHtml(ex.input || ex.user || '').substring(0, 150)}${(ex.input || ex.user || '').length > 150 ? '...' : ''}</div>
        <div class="example-output">${this.escapeHtml(ex.output || ex.response || '').substring(0, 200)}${(ex.output || ex.response || '').length > 200 ? '...' : ''}</div>
        <div class="example-footer">
          <div class="example-tags">
            ${(ex.tags || []).slice(0, 4).map(tag => `<span class="example-tag">${this.escapeHtml(tag)}</span>`).join('')}
          </div>
          <div class="example-stats">
            <span title="Vezes que este exemplo foi escolhido pela IA">📊 ${ex.usageCount || 0}x</span>
            <span title="Quando foi criado">🕒 ${ageLabel}</span>
          </div>
        </div>
      </div>`;
    }).join('');

    grid.removeEventListener('click', this._handleExampleClick);
    this._handleExampleClick = (e) => {
      const card = e.target.closest('.example-card');
      if (card) {
        const id = parseInt(card.dataset.id);
        if (!isNaN(id)) this.openExampleModal(id);
      }
    };
    grid.addEventListener('click', this._handleExampleClick);
  }

  renderFaqs() {
    const list = document.getElementById('faqsList');
    const empty = document.getElementById('emptyFaqs');

    if (!list) return;

    if (this.faqs.length === 0) {
      list.innerHTML = '';
      if (empty) empty.style.display = 'flex';
      return;
    }

    if (empty) empty.style.display = 'none';

    list.innerHTML = this.faqs.map(faq => `
      <div class="faq-card" data-id="${parseInt(faq.id) || 0}">
        <div class="faq-question">${this.escapeHtml(faq.q || faq.question || '')}</div>
        <div class="faq-answer">${this.escapeHtml(faq.a || faq.answer || '')}</div>
        ${faq.keywords?.length ? `
          <div class="faq-keywords">
            ${faq.keywords.map(k => `<span class="faq-keyword">${this.escapeHtml(k)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `).join('');

    list.removeEventListener('click', this._handleFaqClick);
    this._handleFaqClick = (e) => {
      const card = e.target.closest('.faq-card');
      if (card) {
        const id = parseInt(card.dataset.id);
        if (!isNaN(id)) this.openFaqModal(id);
      }
    };
    list.addEventListener('click', this._handleFaqClick);
  }

  renderProducts() {
    const grid = document.getElementById('productsGrid');
    const empty = document.getElementById('emptyProducts');

    if (!grid) return;

    if (this.products.length === 0) {
      grid.innerHTML = '';
      if (empty) empty.style.display = 'flex';
      return;
    }

    if (empty) empty.style.display = 'none';

    grid.innerHTML = this.products.map(p => {
      const availabilityLabels = {
        available: 'Disponível',
        low_stock: 'Estoque Baixo',
        out_of_stock: 'Esgotado',
        pre_order: 'Pré-venda'
      };

      return `
        <div class="product-card" data-id="${parseInt(p.id) || 0}">
          <div class="product-header">
            <div>
              <div class="product-name">${this.escapeHtml(p.name || '')}</div>
              ${p.sku ? `<div class="product-sku">SKU: ${this.escapeHtml(p.sku)}</div>` : ''}
            </div>
            <span class="product-availability ${p.availability || 'available'}">
              ${availabilityLabels[p.availability] || 'Disponível'}
            </span>
          </div>
          <div class="product-description">${this.escapeHtml((p.description || '').substring(0, 100))}${(p.description || '').length > 100 ? '...' : ''}</div>
          <div class="product-price">
            <span class="current">R$ ${(p.promoPrice || p.price || 0).toFixed(2)}</span>
            ${p.promoPrice && p.price ? `<span class="original">R$ ${p.price.toFixed(2)}</span>` : ''}
          </div>
          ${p.category ? `<div class="product-category">📁 ${this.escapeHtml(p.category)}</div>` : ''}
        </div>
      `;
    }).join('');

    grid.removeEventListener('click', this._handleProductClick);
    this._handleProductClick = (e) => {
      const card = e.target.closest('.product-card');
      if (card) {
        const id = parseInt(card.dataset.id);
        if (!isNaN(id)) this.openProductModal(id);
      }
    };
    grid.addEventListener('click', this._handleProductClick);
  }

  loadBusinessForm() {
    const bi = this.businessInfo;

    document.getElementById('businessName')?.setAttribute('value', bi.name || '');
    document.getElementById('businessSegment')?.setAttribute('value', bi.segment || '');

    const descEl = document.getElementById('businessDescription');
    if (descEl) descEl.value = bi.description || '';

    document.getElementById('businessHours')?.setAttribute('value', bi.hours || '');
    document.getElementById('businessResponseTime')?.setAttribute('value', bi.responseTime || '');
    document.getElementById('businessPhone')?.setAttribute('value', bi.phone || '');
    document.getElementById('businessEmail')?.setAttribute('value', bi.email || '');

    const deliveryEl = document.getElementById('deliveryPolicy');
    if (deliveryEl) deliveryEl.value = bi.deliveryPolicy || '';

    document.getElementById('freeShipping')?.setAttribute('value', bi.freeShipping || '');

    const returnEl = document.getElementById('returnPolicy');
    if (returnEl) returnEl.value = bi.returnPolicy || '';

    const customEl = document.getElementById('customInstructions');
    if (customEl) customEl.value = bi.customInstructions || '';

    const payments = bi.paymentMethods || [];
    document.querySelectorAll('#paymentMethods input').forEach(input => {
      input.checked = payments.includes(input.value);
    });
  }

  // ============================================
  // MODALS - EXEMPLOS
  // ============================================

  openExampleModal(id = null) {
    const modal = document.getElementById('exampleModal');
    const titleEl = document.getElementById('exampleModalTitle');
    const deleteBtn = document.getElementById('btnDeleteExample');

    if (id) {
      const example = this.examples.find(e => e.id === id);
      if (!example) return;

      this.currentEditId = id;
      titleEl.textContent = 'Editar Exemplo';
      deleteBtn.style.display = 'block';

      document.getElementById('exampleId').value = id;
      document.getElementById('exampleCategory').value = example.category || 'geral';
      document.getElementById('exampleInput').value = example.input || example.user || '';
      document.getElementById('exampleOutput').value = example.output || example.response || '';
      document.getElementById('exampleIntent').value = example.intent || '';
      document.getElementById('exampleQuality').value = example.quality || 8;
      document.getElementById('exampleTags').value = (example.tags || []).join(', ');
    } else {
      this.currentEditId = null;
      titleEl.textContent = 'Novo Exemplo';
      deleteBtn.style.display = 'none';

      document.getElementById('exampleForm').reset();
      document.getElementById('exampleQuality').value = 8;
    }

    modal.classList.add('active');
  }

  async saveExample() {
    const input = document.getElementById('exampleInput').value.trim();
    const output = document.getElementById('exampleOutput').value.trim();

    if (!input || !output) {
      this.showToast('Preencha a mensagem e a resposta', 'warning');
      return;
    }

    const example = {
      id: this.currentEditId || Date.now(),
      category: document.getElementById('exampleCategory').value,
      input: input,
      user: input,
      output: output,
      response: output,
      intent: document.getElementById('exampleIntent').value || null,
      quality: parseInt(document.getElementById('exampleQuality').value) || 8,
      tags: document.getElementById('exampleTags').value.split(',').map(t => t.trim()).filter(t => t),
      createdAt: this.currentEditId ? (this.examples.find(e => e.id === this.currentEditId)?.createdAt || Date.now()) : Date.now(),
      updatedAt: Date.now(),
      usageCount: this.currentEditId ? (this.examples.find(e => e.id === this.currentEditId)?.usageCount || 0) : 0,
      score: (parseInt(document.getElementById('exampleQuality').value) || 8) / 10
    };

    if (this.currentEditId) {
      const index = this.examples.findIndex(e => e.id === this.currentEditId);
      if (index !== -1) {
        this.examples[index] = example;
      }
    } else {
      this.examples.push(example);
    }

    await this.saveExamples();
    this.renderExamples();
    this.updateStats();
    this.closeModal('exampleModal');
    this.showToast(this.currentEditId ? 'Exemplo atualizado!' : 'Exemplo adicionado!', 'success');
  }

  async deleteExample() {
    if (!this.currentEditId) return;

    if (!confirm('Tem certeza que deseja excluir este exemplo?')) return;

    this.examples = this.examples.filter(e => e.id !== this.currentEditId);
    await this.saveExamples();
    this.renderExamples();
    this.updateStats();
    this.closeModal('exampleModal');
    this.showToast('Exemplo excluído', 'success');
  }

  // ============================================
  // MODALS - FAQs
  // ============================================

  openFaqModal(id = null) {
    const modal = document.getElementById('faqModal');
    const titleEl = document.getElementById('faqModalTitle');
    const deleteBtn = document.getElementById('btnDeleteFaq');

    if (id) {
      const faq = this.faqs.find(f => f.id === id);
      if (!faq) return;

      this.currentEditId = id;
      titleEl.textContent = 'Editar FAQ';
      deleteBtn.style.display = 'block';

      document.getElementById('faqId').value = id;
      document.getElementById('faqQuestion').value = faq.q || faq.question || '';
      document.getElementById('faqAnswer').value = faq.a || faq.answer || '';
      document.getElementById('faqKeywords').value = (faq.keywords || []).join(', ');
    } else {
      this.currentEditId = null;
      titleEl.textContent = 'Nova FAQ';
      deleteBtn.style.display = 'none';
      document.getElementById('faqForm').reset();
    }

    modal.classList.add('active');
  }

  async saveFaq() {
    const question = document.getElementById('faqQuestion').value.trim();
    const answer = document.getElementById('faqAnswer').value.trim();

    if (!question || !answer) {
      this.showToast('Preencha a pergunta e a resposta', 'warning');
      return;
    }

    const faq = {
      id: this.currentEditId || Date.now(),
      q: question,
      question: question,
      a: answer,
      answer: answer,
      keywords: document.getElementById('faqKeywords').value.split(',').map(k => k.trim().toLowerCase()).filter(k => k),
      createdAt: this.currentEditId ? (this.faqs.find(f => f.id === this.currentEditId)?.createdAt || Date.now()) : Date.now(),
      updatedAt: Date.now()
    };

    if (this.currentEditId) {
      const index = this.faqs.findIndex(f => f.id === this.currentEditId);
      if (index !== -1) {
        this.faqs[index] = faq;
      }
    } else {
      this.faqs.push(faq);
    }

    await this.saveKnowledgeBase();
    this.renderFaqs();
    this.updateStats();
    this.closeModal('faqModal');
    this.showToast(this.currentEditId ? 'FAQ atualizada!' : 'FAQ adicionada!', 'success');
  }

  async deleteFaq() {
    if (!this.currentEditId) return;

    if (!confirm('Tem certeza que deseja excluir esta FAQ?')) return;

    this.faqs = this.faqs.filter(f => f.id !== this.currentEditId);
    await this.saveKnowledgeBase();
    this.renderFaqs();
    this.updateStats();
    this.closeModal('faqModal');
    this.showToast('FAQ excluída', 'success');
  }

  // ============================================
  // MODALS - PRODUTOS
  // ============================================

  openProductModal(id = null) {
    const modal = document.getElementById('productModal');
    const titleEl = document.getElementById('productModalTitle');
    const deleteBtn = document.getElementById('btnDeleteProduct');

    if (id) {
      const product = this.products.find(p => p.id === id);
      if (!product) return;

      this.currentEditId = id;
      titleEl.textContent = 'Editar Produto';
      deleteBtn.style.display = 'block';

      document.getElementById('productId').value = id;
      document.getElementById('productName').value = product.name || '';
      document.getElementById('productSku').value = product.sku || '';
      document.getElementById('productDescription').value = product.description || '';
      document.getElementById('productPrice').value = product.price || '';
      document.getElementById('productPromoPrice').value = product.promoPrice || '';
      document.getElementById('productCategory').value = product.category || '';
      document.getElementById('productAvailability').value = product.availability || 'available';
      document.getElementById('productInfo').value = product.info || '';
    } else {
      this.currentEditId = null;
      titleEl.textContent = 'Novo Produto';
      deleteBtn.style.display = 'none';
      document.getElementById('productForm').reset();
    }

    modal.classList.add('active');
  }

  async saveProduct() {
    const name = document.getElementById('productName').value.trim();

    if (!name) {
      this.showToast('Preencha o nome do produto', 'warning');
      return;
    }

    const product = {
      id: this.currentEditId || Date.now(),
      name: name,
      sku: document.getElementById('productSku').value.trim(),
      description: document.getElementById('productDescription').value.trim(),
      price: parseFloat(document.getElementById('productPrice').value) || 0,
      promoPrice: parseFloat(document.getElementById('productPromoPrice').value) || null,
      category: document.getElementById('productCategory').value.trim(),
      availability: document.getElementById('productAvailability').value,
      info: document.getElementById('productInfo').value.trim(),
      createdAt: this.currentEditId ? (this.products.find(p => p.id === this.currentEditId)?.createdAt || Date.now()) : Date.now(),
      updatedAt: Date.now()
    };

    if (this.currentEditId) {
      const index = this.products.findIndex(p => p.id === this.currentEditId);
      if (index !== -1) {
        this.products[index] = product;
      }
    } else {
      this.products.push(product);
    }

    await this.saveKnowledgeBase();
    this.renderProducts();
    this.updateStats();
    this.closeModal('productModal');
    this.showToast(this.currentEditId ? 'Produto atualizado!' : 'Produto adicionado!', 'success');
  }

  async deleteProduct() {
    if (!this.currentEditId) return;

    if (!confirm('Tem certeza que deseja excluir este produto?')) return;

    this.products = this.products.filter(p => p.id !== this.currentEditId);
    await this.saveKnowledgeBase();
    this.renderProducts();
    this.updateStats();
    this.closeModal('productModal');
    this.showToast('Produto excluído', 'success');
  }

  // ============================================
  // BUSINESS INFO
  // ============================================

  async saveBusinessInfo() {
    const paymentMethods = [];
    document.querySelectorAll('#paymentMethods input:checked').forEach(input => {
      paymentMethods.push(input.value);
    });

    this.businessInfo = {
      name: document.getElementById('businessName').value.trim(),
      segment: document.getElementById('businessSegment').value.trim(),
      description: document.getElementById('businessDescription').value.trim(),
      hours: document.getElementById('businessHours').value.trim(),
      responseTime: document.getElementById('businessResponseTime').value.trim(),
      phone: document.getElementById('businessPhone').value.trim(),
      email: document.getElementById('businessEmail').value.trim(),
      paymentMethods: paymentMethods,
      deliveryPolicy: document.getElementById('deliveryPolicy').value.trim(),
      freeShipping: document.getElementById('freeShipping').value.trim(),
      returnPolicy: document.getElementById('returnPolicy').value.trim(),
      customInstructions: document.getElementById('customInstructions').value.trim(),
      updatedAt: Date.now()
    };

    await this.saveKnowledgeBase();
    this.showToast('Configurações salvas!', 'success');
  }

  // ============================================
  // ESTATÍSTICAS
  // ============================================

  updateStats() {
    document.getElementById('statExamples').textContent = this.examples.length;
    document.getElementById('statFaqs').textContent = this.faqs.length;
    document.getElementById('statProducts').textContent = this.products.length;

    if (this.examples.length > 0) {
      const avgQuality = this.examples.reduce((sum, ex) => sum + (ex.quality || 8), 0) / this.examples.length;
      document.getElementById('statAccuracy').textContent = `${Math.round(avgQuality * 10)}%`;
    }

    chrome.storage.local.get('whl_ai_auto_learner').then(data => {
      const autoLearner = data.whl_ai_auto_learner ? JSON.parse(data.whl_ai_auto_learner) : {};
      document.getElementById('statAutoLearn').textContent = (autoLearner.metrics?.examplesAdded || 0).toString();
    });
  }

  // ============================================
  // SEARCH
  // ============================================

  handleSearch(query) {
    const q = query.toLowerCase().trim();

    const filteredExamples = this.examples.filter(ex =>
      (ex.input || '').toLowerCase().includes(q) ||
      (ex.output || '').toLowerCase().includes(q) ||
      (ex.category || '').toLowerCase().includes(q) ||
      (ex.tags || []).some(t => t.toLowerCase().includes(q))
    );

    const filteredFaqs = this.faqs.filter(faq =>
      (faq.q || faq.question || '').toLowerCase().includes(q) ||
      (faq.a || faq.answer || '').toLowerCase().includes(q) ||
      (faq.keywords || []).some(k => k.includes(q))
    );

    const filteredProducts = this.products.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    );

    this.renderFilteredExamples(filteredExamples);
    this.renderFilteredFaqs(filteredFaqs);
    this.renderFilteredProducts(filteredProducts);
  }

  renderFilteredExamples(examples) {
    const grid = document.getElementById('examplesGrid');
    const empty = document.getElementById('emptyExamples');
    if (!grid) return;

    if (examples.length === 0 && this.examples.length > 0) {
      grid.innerHTML = '<p style="padding: 20px; color: var(--text-muted);">Nenhum exemplo encontrado para esta busca</p>';
      if (empty) empty.style.display = 'none';
      return;
    }

    const original = this.examples;
    this.examples = examples;
    this.renderExamples();
    this.examples = original;
  }

  renderFilteredFaqs(faqs) {
    const list = document.getElementById('faqsList');
    if (!list) return;

    if (faqs.length === 0 && this.faqs.length > 0) {
      list.innerHTML = '<p style="padding: 20px; color: var(--text-muted);">Nenhuma FAQ encontrada para esta busca</p>';
      return;
    }

    const original = this.faqs;
    this.faqs = faqs;
    this.renderFaqs();
    this.faqs = original;
  }

  renderFilteredProducts(products) {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;

    if (products.length === 0 && this.products.length > 0) {
      grid.innerHTML = '<p style="padding: 20px; color: var(--text-muted);">Nenhum produto encontrado para esta busca</p>';
      return;
    }

    const original = this.products;
    this.products = products;
    this.renderProducts();
    this.products = original;
  }

  // ============================================
  // IMPORT / EXPORT
  // ============================================

  async importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (data.__proto__ || data.constructor || data.prototype) {
          throw new Error('Invalid data structure: prototype pollution attempt detected');
        }

        if (data.examples && Array.isArray(data.examples)) {
          const validExamples = data.examples.filter(ex => this._validateExample(ex));
          this.examples = [...this.examples, ...validExamples];
          await this.saveExamples();
        }

        if (data.faqs && Array.isArray(data.faqs)) {
          const validFaqs = data.faqs.filter(faq => this._validateFaq(faq));
          this.faqs = [...this.faqs, ...validFaqs];
        }

        if (data.products && Array.isArray(data.products)) {
          const validProducts = data.products.filter(p => this._validateProduct(p));
          this.products = [...this.products, ...validProducts];
        }

        if (data.businessInfo && typeof data.businessInfo === 'object') {
          const safeBusinessInfo = this._sanitizeBusinessInfo(data.businessInfo);
          this.businessInfo = { ...this.businessInfo, ...safeBusinessInfo };
        }

        await this.saveKnowledgeBase();
        this.renderAll();
        this.showToast('Dados importados com sucesso!', 'success');

      } catch (error) {
        console.error('[TrainingApp] Erro ao importar:', error);
        this.showToast('Erro ao importar arquivo: ' + error.message, 'error');
      }
    };

    input.click();
  }

  _validateExample(ex) {
    return ex &&
           typeof ex === 'object' &&
           !ex.__proto__ &&
           (ex.input || ex.user) &&
           (ex.output || ex.response) &&
           (!ex.id || typeof ex.id === 'number' || typeof ex.id === 'string');
  }

  _validateFaq(faq) {
    return faq &&
           typeof faq === 'object' &&
           !faq.__proto__ &&
           (faq.q || faq.question) &&
           (faq.a || faq.answer) &&
           (!faq.id || typeof faq.id === 'number' || typeof faq.id === 'string');
  }

  _validateProduct(p) {
    return p &&
           typeof p === 'object' &&
           !p.__proto__ &&
           p.name &&
           typeof p.name === 'string' &&
           (!p.price || typeof p.price === 'number') &&
           (!p.id || typeof p.id === 'number' || typeof p.id === 'string');
  }

  _sanitizeBusinessInfo(data) {
    const allowed = ['name', 'segment', 'description', 'hours', 'responseTime', 'phone', 'email',
                     'deliveryPolicy', 'freeShipping', 'returnPolicy', 'customInstructions', 'paymentMethods'];
    const safe = {};

    for (const key of allowed) {
      if (data[key] !== undefined && data[key] !== null) {
        if (typeof data[key] === 'string' || typeof data[key] === 'number' || typeof data[key] === 'boolean') {
          safe[key] = data[key];
        } else if (Array.isArray(data[key])) {
          safe[key] = data[key].filter(v => typeof v === 'string');
        }
      }
    }

    return safe;
  }

  exportData() {
    const data = {
      examples: this.examples,
      faqs: this.faqs,
      products: this.products,
      businessInfo: this.businessInfo,
      exportedAt: new Date().toISOString(),
      version: '9.5.1'
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `whatshybrid-training-${new Date().toISOString().split('T')[0]}.json`;
    a.click();

    URL.revokeObjectURL(url);
    this.showToast('Dados exportados!', 'success');
  }

  // ============================================
  // SYNC COM BACKEND
  // ============================================

  async syncWithBackend() {
    try {
      this.showToast('Sincronizando...', 'info');

      const response = await chrome.runtime.sendMessage({
        type: 'SYNC_TRAINING_DATA',
        data: {
          examples: this.examples,
          faqs: this.faqs,
          products: this.products,
          businessInfo: this.businessInfo
        }
      });

      if (response?.success) {
        this.showToast('Sincronizado com sucesso!', 'success');
        this.updateConnectionStatus(true);
      } else {
        this.showToast('Falha na sincronização', 'warning');
      }

    } catch (error) {
      console.error('[TrainingApp] Erro ao sincronizar:', error);
      this.showToast('Erro ao sincronizar', 'error');
    }
  }

  // ============================================
  // UTILS
  // ============================================

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
    }
    this.currentEditId = null;
  }

  updateConnectionStatus(connected = false) {
    const status = document.getElementById('connectionStatus');
    const statusText = status?.querySelector('.status-text');

    if (status) {
      status.classList.toggle('connected', connected);
      if (statusText) {
        statusText.textContent = connected ? 'Conectado' : 'Offline';
      }
    }
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };

    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${this.escapeHtml(message)}`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastIn 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // v9.5.2: Format a Unix timestamp as a Portuguese relative-age label for the Curadoria cards.
  formatRelativeAge(timestamp) {
    const ts = Number(timestamp);
    if (!ts || !Number.isFinite(ts)) return 'agora';
    const diffMs = Date.now() - ts;
    if (diffMs < 0) return 'agora';
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'agora';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} ${months === 1 ? 'mês' : 'meses'}`;
    const years = Math.floor(days / 365);
    return `${years} ${years === 1 ? 'ano' : 'anos'}`;
  }

  // ============================================
  // SIMULAÇÃO
  // ============================================

  initSimulation() {
    if (typeof SimulationEngine === 'undefined') {
      console.warn('[TrainingApp] SimulationEngine não disponível');
      return;
    }

    this.simulation = new SimulationEngine();

    this.simulation.on('simulation:started', (data) => this.onSimulationStarted(data));
    this.simulation.on('simulation:paused', (data) => this.onSimulationPaused(data));
    this.simulation.on('simulation:resumed', (data) => this.onSimulationResumed(data));
    this.simulation.on('simulation:stopped', (data) => this.onSimulationStopped(data));

    this.simulation.on('message:simulator', (message) => {
      this.addChatMessage(message, 'simulator');
    });

    this.simulation.on('message:executor', (message) => {
      this.addChatMessage(message, 'executor');
      this.updateCurationSection();
    });

    this.simulation.on('response:approved', (data) => {
      this.updateMessageStatus(data.message.id, 'approved');
      this.updateCurationStats();
    });

    this.simulation.on('response:rejected', (data) => {
      this.updateMessageStatus(data.message.id, 'rejected');
      this.updateCurationStats();
    });

    this.setupSimulationButtons();

    console.log('[TrainingApp] ✅ Simulação inicializada');
  }

  // Treinamento por voz removido — a aba dependia de um endpoint de
  // transcrição (`/api/v1/speech/transcribe`) instável e duplicava a entrada
  // de texto da aba de Simulação. Veja git log para histórico.

  // ── Simulação Usuário↔IA ─────────────────────────────────────────────────
  // Versão anterior: dois robôs conversando entre si por tema selecionável
  // ("venda_abordagem", etc). Gerava diálogos genéricos e sem valor prático.
  // Versão atual: usuário escreve livremente como se fosse um cliente real,
  // a IA responde via CopilotEngine.generateResponse(), e cada resposta
  // recebe os 3 botões já existentes (Aprovar / Editar / Rejeitar) que
  // alimentam o aprendizado supervisionado (fewShotLearning + feedback bus).
  setupSimulationButtons() {
    const input = document.getElementById('simUserInput');
    const sendBtn = document.getElementById('btnSendUserMsg');
    const clearBtn = document.getElementById('btnClearChat');

    if (sendBtn) sendBtn.addEventListener('click', () => this.sendUserMessage());
    if (clearBtn) clearBtn.addEventListener('click', () => this.resetUserSimulation());

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendUserMessage();
        }
      });
    }

    document.getElementById('btnSaveApproved')?.addEventListener('click', () => this.saveApprovedResponses());
    document.getElementById('btnQuickTest')?.addEventListener('click', () => this.runQuickTest());

    document.getElementById('quickTestInput')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.runQuickTest();
      }
    });
  }

  resetUserSimulation() {
    this._userSimHistory = [];
    if (this.simulation?.state) {
      this.simulation.state.conversation = [];
      this.simulation.state.approvedResponses = [];
      this.simulation.state.rejectedResponses = [];
    }
    this.clearChat();
    this.updateCurationStats();
  }

  async sendUserMessage() {
    const input = document.getElementById('simUserInput');
    const sendBtn = document.getElementById('btnSendUserMsg');
    if (!input) return;

    const userText = input.value.trim();
    if (!userText) return;

    // Limpa o estado vazio e adiciona bolha do usuário.
    const userMsgId = `user_${Date.now()}`;
    this.addChatMessage({ id: userMsgId, content: userText }, 'simulator');
    input.value = '';

    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '⏳ Pensando...'; }

    const t0 = performance.now();
    let aiText = '';
    let providerInfo = null;
    try {
      aiText = await this._generateAiReply(userText);
    } catch (err) {
      console.warn('[TrainingApp] Falha gerando resposta:', err);
      aiText = '⚠️ Não foi possível gerar resposta. Verifique se há provedor de IA configurado em Configurações.';
    } finally {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '📤 Enviar'; }
    }

    const latency = performance.now() - t0;
    const aiMsgId = `ai_${Date.now()}`;
    const aiMsg = {
      id: aiMsgId,
      role: 'executor',
      content: aiText,
      latency,
      userInput: userText,
      providerInfo
    };

    // Mantém um histórico local + alimenta o state.conversation que o
    // saveApprovedResponses/edit/reject já espera.
    this._userSimHistory = this._userSimHistory || [];
    this._userSimHistory.push({ id: userMsgId, role: 'user', content: userText });
    this._userSimHistory.push(aiMsg);
    if (this.simulation?.state) {
      this.simulation.state.conversation = this._userSimHistory.slice();
    }

    this.addChatMessage(aiMsg, 'executor');
    this.updateLatencyDisplay(latency);
  }

  async _generateAiReply(userText) {
    // training/modules/ai-client.js expõe window.AIService (complete),
    // window.CopilotEngine (generateResponse) e window.TrainingAIClient
    // (generateResponse). NÃO existe window.WHLAiClient — bater nesse nome
    // disparava "Nenhum provedor de IA disponível" mesmo com tudo configurado.
    const buildContext = (extra = {}) => ({
      systemPrompt: 'Você é um assistente de atendimento. Responda em pt-BR, curto e útil.',
      examples: Array.isArray(this.examples) ? this.examples.slice(0, 20) : [],
      faqs: Array.isArray(this.faqs) ? this.faqs.slice(0, 20) : [],
      products: Array.isArray(this.products) ? this.products.slice(0, 20) : [],
      business: this.businessInfo || null,
      history: Array.isArray(this._userSimHistory) ? this._userSimHistory.slice(-8) : [],
      ...extra
    });

    // Histórico recente para dar contexto ao provider (últimas 8 trocas).
    const history = Array.isArray(this._userSimHistory) ? this._userSimHistory.slice(-8) : [];
    const messages = history
      .filter(m => m && m.content)
      .map(m => ({ role: m.role === 'executor' ? 'assistant' : 'user', content: m.content }));

    // 1ª opção: AIService.complete (caminho oficial do backend / provider configurado).
    // O wrapper em training/modules/ai-client.js espera { messages, lastMessage, temperature }.
    // Sem `lastMessage` setado, o _callBackend manda content vazio.
    if (window.AIService?.complete) {
      try {
        const r = await window.AIService.complete({
          messages,
          lastMessage: userText,
          temperature: 0.7,
          maxTokens: 350,
          context: buildContext()
        });
        const content = r?.content || r?.text || r?.reply || (typeof r === 'string' ? r : null);
        if (content) return content;
      } catch (err) {
        console.warn('[TrainingApp] AIService falhou, tentando CopilotEngine:', err);
      }
    }

    // 2ª opção: CopilotEngine (autopilot/copilot que vive na página WhatsApp).
    if (window.CopilotEngine?.generateResponse) {
      try {
        let analysis = null;
        if (typeof window.CopilotEngine.analyzeMessage === 'function') {
          analysis = await window.CopilotEngine.analyzeMessage(userText, 'training-sim');
        }
        const r = await window.CopilotEngine.generateResponse('training-sim', analysis || { text: userText }, {
          skipCache: true,
          maxTokens: 350,
          context: buildContext({ userText })
        });
        const content = r?.content || r?.text || r?.reply;
        if (content) return content;
      } catch (err) {
        console.warn('[TrainingApp] CopilotEngine falhou, tentando TrainingAIClient:', err);
      }
    }

    // 3ª opção: TrainingAIClient (cliente embarcado no training).
    if (window.TrainingAIClient?.generateResponse) {
      try {
        const r = await window.TrainingAIClient.generateResponse({
          messages,
          lastMessage: userText,
          temperature: 0.7
        });
        const content = typeof r === 'string' ? r : (r?.content || r?.text || r?.reply);
        if (content) return content;
      } catch (err) {
        console.warn('[TrainingApp] TrainingAIClient falhou:', err);
      }
    }

    throw new Error('Nenhum provedor de IA disponível');
  }

  onSimulationStarted(data) {
    const curationSection = document.getElementById('curationSection');
    if (curationSection) curationSection.style.display = 'block';
  }

  onSimulationPaused(data) {}
  onSimulationResumed(data) {}

  onSimulationStopped(data) {
    this.updateLatencyDisplay(data.metrics?.avgLatency || 0);
  }

  addChatMessage(message, type) {
    const chatContainer = document.getElementById('simChatMessages');
    if (!chatContainer) return;

    const emptyMsg = chatContainer.querySelector('.chat-empty');
    if (emptyMsg) emptyMsg.remove();

    const safeIdRaw = String(message.id || '');
    const safeId = safeIdRaw.replace(/[^A-Za-z0-9_\-]/g, '_').substring(0, 80);

    const msgEl = document.createElement('div');
    msgEl.className = `chat-message ${type}`;
    msgEl.id = `msg-${safeId}`;
    msgEl.dataset.messageId = safeIdRaw;

    let content = `<div class="message-content">${this.escapeHtml(message.content)}</div>`;

    if (type === 'executor') {
      msgEl.classList.add('pending');
      content += `
        <div class="message-approval">
          <button class="btn-approve btn-approve-msg">✅ Aprovar</button>
          <button class="btn-edit btn-edit-msg">✏️ Editar</button>
          <button class="btn-reject btn-reject-msg">❌ Rejeitar</button>
        </div>
      `;
    }

    msgEl.innerHTML = content;

    if (type === 'executor') {
      const approveBtn = msgEl.querySelector('.btn-approve-msg');
      const rejectBtn = msgEl.querySelector('.btn-reject-msg');
      const editBtn = msgEl.querySelector('.btn-edit-msg');
      if (approveBtn) approveBtn.addEventListener('click', () => this.approveMessage(safeIdRaw));
      if (rejectBtn) rejectBtn.addEventListener('click', () => this.rejectMessage(safeIdRaw));
      if (editBtn) editBtn.addEventListener('click', () => this.editMessage(safeIdRaw));
    }

    chatContainer.appendChild(msgEl);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    if (message.latency) {
      this.updateLatencyDisplay(message.latency);
    }
  }

  updateLatencyDisplay(latency) {
    const latencyEl = document.querySelector('.latency-value');
    if (latencyEl) {
      latencyEl.textContent = `${Math.round(latency)}MS`;
    }
  }

  clearChat() {
    const chatContainer = document.getElementById('simChatMessages');
    if (!chatContainer) return;

    chatContainer.innerHTML = `
      <div class="chat-empty">
        <span>🚀</span>
        <p>Selecione um tema e inicie a simulação</p>
      </div>
    `;

    const curationList = document.getElementById('curationList');
    if (curationList) curationList.innerHTML = '';
  }

  approveMessage(messageId) {
    if (!this.simulation) return;
    this.simulation.approve(messageId);
    const msg = this.simulation.state.conversation.find(m => m.id === messageId);
    if (msg) this._recordSupervisedSample(msg, 'approved');
    this.showToast('Resposta aprovada!', 'success');
  }

  rejectMessage(messageId) {
    if (!this.simulation) return;
    const reason = prompt('Motivo da rejeição (opcional):');
    this.simulation.reject(messageId, reason || '');
    const msg = this.simulation.state.conversation.find(m => m.id === messageId);
    if (msg) this._recordSupervisedSample(msg, 'rejected', reason);
    this.showToast('Resposta rejeitada', 'info');
  }

  // Envia o par (input do usuário, resposta da IA) imediatamente aos sistemas
  // de aprendizado em vez de esperar o botão "Salvar". Garante que confidence
  // / few-shot / backend sync acompanhem cada interação.
  _recordSupervisedSample(message, kind, reason = '') {
    try {
      const userInput = message.userInput || this._previousUserContent(message.id) || '';
      if (!userInput) return;

      // 1) Few-shot learning local (e sincroniza pro backend via knowledge-sync-manager).
      if (kind !== 'rejected' && window.fewShotLearning?.addExample) {
        window.fewShotLearning.addExample({
          input: userInput,
          output: message.content,
          category: 'training',
          intent: 'user_simulation',
          quality: message.edited ? 10 : 9,
          edited: !!message.edited,
          source: message.edited ? 'training_edited' : 'training_approved',
          tags: ['training', 'user_sim', kind, ...(message.edited ? ['edited'] : [])]
        }).catch(() => {});
      }

      // 2) Event bus → ConfidenceSystem + ai-feedback-system.
      if (window.EventBus) {
        const type = kind === 'approved' ? 'positive'
                   : kind === 'rejected' ? 'negative'
                   : 'correction';
        window.EventBus.emit('feedback:received', {
          type,
          input: userInput,
          response: message.content,
          rating: kind === 'approved' ? 5 : kind === 'rejected' ? 1 : 4,
          context: { source: 'training', edited: !!message.edited },
          correction: message.edited ? message.content : undefined,
          reason
        });
        if (kind === 'approved') {
          window.EventBus.emit('successfulInteraction', { input: userInput, response: message.content });
        }
      }
    } catch (e) {
      console.warn('[TrainingApp] Falha ao registrar amostra supervisionada:', e);
    }
  }

  _previousUserContent(messageId) {
    const conv = this.simulation?.state?.conversation || [];
    const idx = conv.findIndex(m => m.id === messageId);
    if (idx <= 0) return null;
    return conv[idx - 1]?.content || null;
  }

  editMessage(messageId) {
    if (!this.simulation) return;

    const message = this.simulation.state.conversation.find(m => m.id === messageId);
    if (!message || message.role !== 'executor') return;

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:600px;">
        <h3>✏️ Editar Resposta</h3>
        <p style="color:#9CA3AF;font-size:14px;margin-bottom:8px;">
          Resposta original (gerada pela IA):
        </p>
        <div style="background:rgba(0,0,0,0.2);padding:12px;border-radius:6px;margin-bottom:16px;font-size:13px;color:#9CA3AF;">
          ${this.escapeHtml(message.content)}
        </div>
        <p style="margin-bottom:8px;">Sua versão ajustada:</p>
        <textarea id="editMessageText" style="width:100%;min-height:120px;padding:12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-family:inherit;resize:vertical;" placeholder="Edite a resposta aqui...">${this.escapeHtml(message.content)}</textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
          <button class="btn btn-secondary" id="btnCancelEdit">Cancelar</button>
          <button class="btn btn-primary" id="btnSaveEdit">✅ Salvar como Aprovada</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const cleanup = () => {
      modal.remove();
      document.removeEventListener('keydown', escHandler);
    };

    const escHandler = (e) => {
      if (e.key === 'Escape') cleanup();
    };

    modal.querySelector('#btnCancelEdit').addEventListener('click', cleanup);

    modal.querySelector('#btnSaveEdit').addEventListener('click', () => {
      const newText = modal.querySelector('#editMessageText').value.trim();
      if (!newText) {
        this.showToast('Texto não pode estar vazio', 'warning');
        return;
      }

      message.content = newText;
      message.edited = true;
      message.editedAt = Date.now();

      const safeId = String(messageId).replace(/[^A-Za-z0-9_\-]/g, '_').substring(0, 80);
      const msgEl = document.getElementById(`msg-${safeId}`);
      if (msgEl) {
        const contentEl = msgEl.querySelector('.message-content');
        if (contentEl) contentEl.textContent = newText;
      }

      this.simulation.approve(messageId);
      // Aprendizado supervisionado: versão editada vira a resposta IDEAL.
      this._recordSupervisedSample(message, 'edited');

      cleanup();
      this.showToast('Resposta editada e aprovada!', 'success');
    });

    document.addEventListener('keydown', escHandler);
  }

  updateMessageStatus(messageId, status) {
    const safeId = String(messageId).replace(/[^A-Za-z0-9_\-]/g, '_').substring(0, 80);
    const msgEl = document.getElementById(`msg-${safeId}`);
    if (!msgEl) return;

    msgEl.classList.remove('pending', 'approved', 'rejected');
    msgEl.classList.add(status);

    const approvalDiv = msgEl.querySelector('.message-approval');
    if (approvalDiv) {
      approvalDiv.innerHTML = status === 'approved'
        ? '<span style="color: var(--success);">✅ Aprovada</span>'
        : '<span style="color: var(--danger);">❌ Rejeitada</span>';
    }
  }

  updateCurationSection() {
    if (!this.simulation) return;

    const state = this.simulation.getState();

    const btnSave = document.getElementById('btnSaveApproved');
    if (btnSave) {
      btnSave.disabled = state.approvedResponses.length === 0;
    }

    this.updateCurationStats();
  }

  updateCurationStats() {
    if (!this.simulation) return;

    const state = this.simulation.getState();

    const approvedEl = document.getElementById('approvedCount');
    const rejectedEl = document.getElementById('rejectedCount');

    if (approvedEl) approvedEl.textContent = state.approvedResponses?.length || 0;
    if (rejectedEl) rejectedEl.textContent = state.rejectedResponses?.length || 0;
  }

  async saveApprovedResponses() {
    if (!this.simulation) return;

    try {
      const result = await this.simulation.saveForLearning();
      this.showToast(result.message, result.saved > 0 ? 'success' : 'warning');
      this.updateStats();
    } catch (error) {
      console.error('[TrainingApp] Erro ao salvar:', error);
      this.showToast('Erro ao salvar respostas', 'error');
    }
  }

  async runQuickTest() {
    const input = document.getElementById('quickTestInput');
    const resultDiv = document.getElementById('quickTestResult');
    const contentDiv = document.getElementById('quickTestContent');

    if (!input || !resultDiv || !contentDiv) return;

    const question = input.value.trim();
    if (!question) {
      this.showToast('Digite uma pergunta para testar', 'warning');
      return;
    }

    contentDiv.innerHTML = '<span style="color: var(--text-muted);">Processando...</span>';
    resultDiv.style.display = 'block';

    try {
      if (window.CopilotEngine) {
        let out = '';
        const gen = window.CopilotEngine.generateResponse;
        if (typeof gen === 'function' && gen.length <= 1) {
          const resp = await gen({ messages: [], lastMessage: question, temperature: 0.7 });
          out = resp?.text || resp?.content || (typeof resp === 'string' ? resp : '');
        } else {
          const analysis = {
            originalMessage: question,
            intent: { id: 'test', confidence: 0.9 },
            sentiment: { score: 0, label: 'neutral' },
            entities: []
          };
          const resp = await gen('quick_test', analysis);
          out = resp?.content || resp?.text || (typeof resp === 'string' ? resp : '');
        }
        contentDiv.textContent = out || 'Sem resposta';
      } else if (window.AIService) {
        let out = '';
        const complete = window.AIService.complete;
        if (typeof complete === 'function' && complete.length <= 1) {
          const resp = await complete({ messages: [], lastMessage: question, temperature: 0.7 });
          out = resp?.text || resp?.content || (typeof resp === 'string' ? resp : '');
        } else {
          const resp = await complete([
            { role: 'system', content: 'Você é um assistente prestativo. Responda de forma clara e profissional.' },
            { role: 'user', content: question }
          ], { temperature: 0.7 });
          out = resp?.content || resp?.text || (typeof resp === 'string' ? resp : '');
        }
        contentDiv.textContent = out || 'Sem resposta';
      } else {
        contentDiv.innerHTML = '<span style="color: var(--danger);">Serviço de IA temporariamente indisponível. Verifique sua conexão e tente novamente.</span>';
      }
    } catch (error) {
      console.error('[TrainingApp] Erro no teste rápido:', error);
      contentDiv.innerHTML = `<span style="color: var(--danger);">Erro: ${this.escapeHtml(error.message)}</span>`;
    }
  }

  // ============================================
  // IMPORT TAB METHODS
  // ============================================

  renderImportTab() {
    // Placeholder — não há mais stats de exportação para atualizar
  }

  async handleFileUpload(files) {
    if (!files || files.length === 0) return;

    const queue = document.getElementById('uploadQueue');
    const resultsDiv = document.getElementById('importResults');
    const resultsGrid = document.getElementById('resultsGrid');

    for (const file of files) {
      if (queue) {
        const safeFileName = this.escapeHtml(file.name);
        queue.innerHTML += `
          <div class="upload-item" id="upload-${file.name.replace(/\W/g, '_')}">
            <div class="upload-item-info">
              <span class="upload-item-icon">📄</span>
              <div>
                <div class="upload-item-name">${safeFileName}</div>
                <div class="upload-item-size">${(file.size / 1024).toFixed(1)} KB</div>
              </div>
            </div>
            <span class="upload-item-status">⏳</span>
          </div>
        `;
      }

      try {
        if (window.documentImporter) {
          const result = await window.documentImporter.processFile(file);

          const itemEl = document.getElementById(`upload-${file.name.replace(/\W/g, '_')}`);
          if (itemEl) {
            itemEl.querySelector('.upload-item-status').textContent = '✅';
          }

          if (result.type === 'products' && result.items.length > 0) {
            this.products.push(...result.items);
            await this.saveKnowledgeBase();
            this.showToast(`${result.items.length} produtos importados!`, 'success');
          } else if (result.type === 'faqs' && result.items.length > 0) {
            this.faqs.push(...result.items);
            await this.saveKnowledgeBase();
            this.showToast(`${result.items.length} FAQs importadas!`, 'success');
          } else if (result.type === 'examples' && result.items.length > 0) {
            this.examples.push(...result.items);
            await this.saveExamples();
            this.showToast(`${result.items.length} exemplos importados!`, 'success');
          }

          if (resultsDiv && resultsGrid) {
            resultsDiv.style.display = 'block';
            const safeFileName = this.escapeHtml(file.name);
            resultsGrid.innerHTML += `
              <div class="result-card">
                <h4>${safeFileName}</h4>
                <p>Tipo: ${result.type} | Itens: ${result.count}</p>
              </div>
            `;
          }
        }
      } catch (error) {
        console.error('[TrainingApp] Erro ao processar arquivo:', error);
        const itemEl = document.getElementById(`upload-${file.name.replace(/\W/g, '_')}`);
        if (itemEl) {
          itemEl.querySelector('.upload-item-status').textContent = '❌';
        }
        this.showToast(`Erro ao processar ${file.name}`, 'error');
      }
    }

    this.updateStats();
    this.renderAll();
  }

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
  }
}

// Inicializar app
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new TrainingApp();
});
