/**
 * templates.js - Sistema de Templates de Mensagens
 * 
 * Gerencia templates reutilizáveis com variáveis dinâmicas para o WhatsHybrid.
 */

class TemplateManager {
  constructor() {
    this.templates = [];
    this.loadTemplates();
  }

  /**
   * Carrega templates do chrome.storage.local
   * @returns {Promise<Array>} Lista de templates
   */
  async loadTemplates() {
    try {
      const data = await chrome.storage.local.get('whl_templates');
      this.templates = data.whl_templates || [];
      return this.templates;
    } catch (error) {
      console.error('[TemplateManager] Erro ao carregar templates:', error);
      this.templates = [];
      return [];
    }
  }

  /**
   * Salva um novo template
   * @param {Object} template - {name, category, content}
   * @returns {Promise<Object>} Template salvo com id e createdAt
   */
  async saveTemplate(template) {
    try {
      if (!template.name || !template.content) {
        throw new Error('Nome e conteúdo do template são obrigatórios');
      }

      const newTemplate = {
        id: Date.now(),
        name: template.name,
        category: template.category || 'outros',
        content: template.content,
        createdAt: new Date().toISOString(),
      };

      this.templates.push(newTemplate);
      await chrome.storage.local.set({ whl_templates: this.templates });
      return newTemplate;
    } catch (error) {
      console.error('[TemplateManager] Erro ao salvar template:', error);
      throw error;
    }
  }

  /**
   * Deleta um template por id
   * @param {number} id - ID do template
   * @returns {Promise<void>}
   */
  async deleteTemplate(id) {
    try {
      this.templates = this.templates.filter(t => t.id !== id);
      await chrome.storage.local.set({ whl_templates: this.templates });
    } catch (error) {
      console.error('[TemplateManager] Erro ao deletar template:', error);
      throw error;
    }
  }

  /**
   * Atualiza um template existente
   * @param {number} id - ID do template
   * @param {Object} updates - Campos a atualizar
   * @returns {Promise<void>}
   */
  async updateTemplate(id, updates) {
    try {
      const index = this.templates.findIndex(t => t.id === id);
      if (index !== -1) {
        this.templates[index] = { 
          ...this.templates[index], 
          ...updates,
          updatedAt: new Date().toISOString(),
        };
        await chrome.storage.local.set({ whl_templates: this.templates });
      } else {
        throw new Error('Template não encontrado');
      }
    } catch (error) {
      console.error('[TemplateManager] Erro ao atualizar template:', error);
      throw error;
    }
  }

  /**
   * Retorna templates de uma categoria específica
   * @param {string} category - Categoria do template
   * @returns {Array} Lista de templates da categoria
   */
  getByCategory(category) {
    return this.templates.filter(t => t.category === category);
  }

  /**
   * Retorna todos os templates
   * @returns {Array} Lista de todos os templates
   */
  getAllTemplates() {
    return this.templates;
  }

  /**
   * Retorna um template por id
   * @param {number} id - ID do template
   * @returns {Object|null} Template ou null se não encontrado
   */
  getById(id) {
    return this.templates.find(t => t.id === id) || null;
  }

  /**
   * Processa variáveis dinâmicas no template
   * @param {string} template - Conteúdo do template
   * @param {Object} contact - Dados do contato (opcional)
   * @returns {string} Template com variáveis substituídas
   */
  processVariables(template, contact = {}) {
    if (!template) return '';

    const now = new Date();
    const hour = now.getHours();
    
    // Determina saudação baseada na hora
    let saudacao = 'Olá';
    if (hour >= 5 && hour < 12) {
      saudacao = 'Bom dia';
    } else if (hour >= 12 && hour < 18) {
      saudacao = 'Boa tarde';
    } else {
      saudacao = 'Boa noite';
    }

    // Extrair dados do contato
    const nome = contact.nome || contact.name || '';
    const phone = contact.numero || contact.phone || '';
    const empresa = contact.empresa || contact.company || '';
    const email = contact.email || '';
    
    // Nome e sobrenome
    let firstName = '';
    let lastName = '';
    if (nome) {
      const partes = nome.split(' ').filter(p => p.length > 0);
      firstName = partes[0] || '';
      lastName = partes.slice(1).join(' ') || '';
    }

    // Função para substituir variáveis (aceita {var} e {{var}})
    const replaceVar = (str, varName, value) => {
      const regex1 = new RegExp(`\\{\\{${varName}\\}\\}`, 'gi');
      const regex2 = new RegExp(`\\{${varName}\\}`, 'gi');
      return str.replace(regex1, value).replace(regex2, value);
    };

    // Substitui todas as variáveis
    let processed = template;
    processed = replaceVar(processed, 'nome', nome);
    processed = replaceVar(processed, 'name', nome);
    processed = replaceVar(processed, 'first_name', firstName);
    processed = replaceVar(processed, 'primeiro_nome', firstName);
    processed = replaceVar(processed, 'last_name', lastName);
    processed = replaceVar(processed, 'sobrenome', lastName);
    processed = replaceVar(processed, 'empresa', empresa);
    processed = replaceVar(processed, 'company', empresa);
    processed = replaceVar(processed, 'data', now.toLocaleDateString('pt-BR'));
    processed = replaceVar(processed, 'date', now.toLocaleDateString('pt-BR'));
    processed = replaceVar(processed, 'hora', now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    processed = replaceVar(processed, 'time', now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    processed = replaceVar(processed, 'numero', phone);
    processed = replaceVar(processed, 'phone', phone);
    processed = replaceVar(processed, 'telefone', phone);
    processed = replaceVar(processed, 'email', email);
    processed = replaceVar(processed, 'saudacao', saudacao);
    processed = replaceVar(processed, 'greeting', saudacao);
    
    return processed;
  }
}

// Instância global do TemplateManager
if (typeof window !== 'undefined') {
  window.templateManager = new TemplateManager();
}
