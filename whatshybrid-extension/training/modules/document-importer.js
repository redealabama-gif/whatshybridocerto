/**
 * 📄 Document Importer - Importação de Documentos
 * Processa CSV, TXT, JSON, XLSX, ODS, PDF e extrai conhecimento automaticamente
 *
 * @version 9.5.8
 */

class DocumentImporter {
  constructor() {
    // v9.5.8: XLSX (Excel/LibreOffice Calc), ODS (LibreOffice nativo) e PDF agora suportados.
    this.supportedFormats = ['csv', 'txt', 'json', 'xlsx', 'xls', 'ods', 'pdf'];
    this.processingQueue = [];
    this.results = [];
  }

  // ============================================
  // PROCESSAMENTO DE ARQUIVOS
  // ============================================

  /**
   * Processa um arquivo e extrai conhecimento
   * @param {File} file - Arquivo a ser processado
   * @returns {Promise<Object>} Resultado do processamento
   */
  async processFile(file) {
    const extension = file.name.split('.').pop().toLowerCase();

    if (!this.supportedFormats.includes(extension)) {
      throw new Error(`Formato não suportado: ${extension}`);
    }

    console.log(`[DocumentImporter] Processando: ${file.name}`);

    let result;
    switch (extension) {
      case 'csv':
        result = await this.processCSV(file);
        break;
      case 'txt':
        result = await this.processTXT(file);
        break;
      case 'json':
        result = await this.processJSON(file);
        break;
      case 'xlsx':
      case 'xls':
      case 'ods':
        result = await this.processSpreadsheet(file, extension);
        break;
      case 'pdf':
        result = await this.processPDF(file);
        break;
      default:
        throw new Error(`Processador não implementado para: ${extension}`);
    }

    this.results.push({
      filename: file.name,
      ...result,
      processedAt: Date.now()
    });

    return result;
  }

  // ============================================
  // v9.5.8: XLSX / XLS / ODS via SheetJS
  // ============================================
  /**
   * Processa planilhas (Excel/LibreOffice Calc/ODS).
   * Lê a primeira aba, converte em array de objetos, detecta tipo
   * (produtos/FAQs) pelo cabeçalho e reusa o mesmo pipeline do CSV.
   */
  async processSpreadsheet(file, extension) {
    if (typeof XLSX === 'undefined' || typeof XLSX.read !== 'function') {
      throw new Error('Biblioteca SheetJS (XLSX) não carregada. Recarregue a página de treinamento.');
    }

    const buffer = await file.arrayBuffer();
    let workbook;
    try {
      workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    } catch (e) {
      throw new Error(`Falha ao ler planilha (${extension}): ${e?.message || 'arquivo inválido'}`);
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return { type: 'empty', items: [], count: 0 };
    }

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Convert to array-of-objects with first row as keys (lowercased & trimmed
    // to match the CSV detection logic exactly).
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, blankrows: false });
    if (rawRows.length === 0) {
      return { type: 'empty', items: [], count: 0, sheetName };
    }

    // Normalize header keys to match CSV logic (lowercase, trim).
    const rows = rawRows.map(row => {
      const normalized = {};
      for (const [k, v] of Object.entries(row)) {
        const key = String(k).trim().toLowerCase();
        normalized[key] = typeof v === 'string' ? v.trim() : v;
      }
      return normalized;
    });

    const headerKeys = Object.keys(rows[0] || {});
    const isProducts = headerKeys.some(h => ['produto', 'product', 'nome', 'name', 'preco', 'preço', 'price'].includes(h));
    const isFaqs = headerKeys.some(h => ['pergunta', 'question', 'resposta', 'answer'].includes(h));

    const items = rows.map(item => {
      if (isProducts) return this.normalizeProduct(item);
      if (isFaqs) return this.normalizeFaq(item);
      return item;
    });

    return {
      type: isProducts ? 'products' : (isFaqs ? 'faqs' : 'data'),
      items,
      count: items.length,
      sheetName,
      sheetCount: workbook.SheetNames.length,
    };
  }

  // ============================================
  // v9.5.8: PDF via PDF.js
  // ============================================
  /**
   * Extrai texto de PDF e tenta detectar Q&A pairs (FAQs) ou parágrafos
   * estruturados. Texto bruto vai para 'cannedReplies' do KB se nada
   * estruturado for detectado, alimentando o RAG.
   */
  async processPDF(file) {
    const pdfjsLib = window.pdfjsLib || (window.WHL_PDFJS && window.WHL_PDFJS.lib);
    if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
      throw new Error('Biblioteca PDF.js não carregada. Recarregue a página de treinamento.');
    }

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // PDF.js text items don't carry line breaks reliably; we rebuild text using
      // the y-coordinate to approximate lines (items on the same y belong to same line).
      const lines = [];
      let currentY = null;
      let currentLine = [];
      for (const item of content.items) {
        const y = item.transform ? Math.round(item.transform[5]) : 0;
        if (currentY === null || Math.abs(y - currentY) < 2) {
          currentLine.push(item.str);
          currentY = y;
        } else {
          if (currentLine.length) lines.push(currentLine.join(' ').trim());
          currentLine = [item.str];
          currentY = y;
        }
      }
      if (currentLine.length) lines.push(currentLine.join(' ').trim());
      pages.push(lines.filter(l => l.length > 0).join('\n'));
    }

    const fullText = pages.join('\n\n').replace(/[ \t]+/g, ' ').trim();

    // Try to detect Q&A pairs first (very common in business FAQ PDFs).
    const faqs = this._extractFaqPairs(fullText);
    if (faqs.length >= 2) {
      return { type: 'faqs', items: faqs, count: faqs.length, pages: pdf.numPages };
    }

    // Fallback: split into chunks (paragraphs >= 30 chars) and store as
    // "knowledge documents". The training UI will add them to the KB and the
    // RAG indexing happens automatically on save.
    const chunks = fullText
      .split(/\n\s*\n/)
      .map(c => c.replace(/\s+/g, ' ').trim())
      .filter(c => c.length >= 30);

    const items = chunks.map((chunk, idx) => ({
      id: Date.now() + idx,
      title: `${file.name} — trecho ${idx + 1}`,
      content: chunk,
      source: 'pdf',
      sourceFile: file.name,
    }));

    return { type: 'documents', items, count: items.length, pages: pdf.numPages };
  }

  /**
   * Tenta extrair pares Pergunta/Resposta de texto livre.
   * Suporta padrões em PT/EN: "Pergunta:"/"Resposta:", "P:"/"R:", "Q:"/"A:"
   */
  _extractFaqPairs(text) {
    const pairs = [];
    // Capture "Q:..." until next "A:..." then until next Q or end.
    const regex = /(?:^|\n)\s*(?:pergunta|p|q|question)\s*[:\-]\s*([\s\S]+?)(?:\n|^)\s*(?:resposta|r|a|answer)\s*[:\-]\s*([\s\S]+?)(?=(?:\n\s*(?:pergunta|p|q|question)\s*[:\-])|$)/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const question = match[1].replace(/\s+/g, ' ').trim();
      const answer = match[2].replace(/\s+/g, ' ').trim();
      if (question.length >= 5 && answer.length >= 5 && question.length <= 500 && answer.length <= 2000) {
        pairs.push(this.normalizeFaq({ pergunta: question, resposta: answer }));
      }
    }
    return pairs;
  }

  /**
   * Processa arquivo CSV (produtos, preços, FAQs)
   */
  async processCSV(file) {
    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    
    if (lines.length < 2) {
      return { type: 'empty', items: [] };
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const items = [];

    // Detectar tipo de CSV
    const isProducts = headers.some(h => ['produto', 'product', 'nome', 'name', 'preco', 'price'].includes(h));
    const isFaqs = headers.some(h => ['pergunta', 'question', 'resposta', 'answer'].includes(h));

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length < headers.length) continue;

      const item = {};
      headers.forEach((h, idx) => {
        item[h] = values[idx]?.trim() || '';
      });

      if (isProducts) {
        items.push(this.normalizeProduct(item));
      } else if (isFaqs) {
        items.push(this.normalizeFaq(item));
      } else {
        items.push(item);
      }
    }

    return {
      type: isProducts ? 'products' : (isFaqs ? 'faqs' : 'data'),
      items,
      count: items.length
    };
  }

  /**
   * Parse de linha CSV considerando aspas
   */
  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);

    return result;
  }

  /**
   * Normaliza produto extraído
   */
  normalizeProduct(item) {
    return {
      id: Date.now() + Math.random(),
      name: item.nome || item.name || item.produto || item.product || '',
      description: item.descricao || item.description || item.desc || '',
      price: parseFloat(item.preco || item.price || item.valor || 0),
      promoPrice: parseFloat(item.promo || item.promocao || item.promo_price || 0) || null,
      category: item.categoria || item.category || item.cat || '',
      sku: item.sku || item.codigo || item.code || '',
      availability: item.disponibilidade || item.availability || 'available',
      info: item.info || item.observacao || item.obs || ''
    };
  }

  /**
   * Normaliza FAQ extraída
   */
  normalizeFaq(item) {
    return {
      id: Date.now() + Math.random(),
      q: item.pergunta || item.question || item.q || '',
      a: item.resposta || item.answer || item.a || '',
      keywords: (item.keywords || item.tags || '').split(',').map(k => k.trim()).filter(k => k)
    };
  }

  /**
   * Processa arquivo TXT (FAQ, documentação)
   */
  async processTXT(file) {
    const text = await file.text();
    const items = [];

    // Detectar formato Q&A (pergunta: resposta)
    const qaPattern = /(?:^|\n)(?:P:|Q:|Pergunta:|Question:)\s*(.+?)(?:\n)(?:R:|A:|Resposta:|Answer:)\s*(.+?)(?=\n(?:P:|Q:|Pergunta:|Question:)|\n\n|$)/gis;
    
    let match;
    while ((match = qaPattern.exec(text)) !== null) {
      items.push({
        id: Date.now() + Math.random(),
        q: match[1].trim(),
        a: match[2].trim(),
        keywords: []
      });
    }

    // Se não encontrou Q&A, extrair parágrafos como conhecimento
    if (items.length === 0) {
      const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 50);
      
      return {
        type: 'knowledge',
        items: paragraphs.map(p => ({
          id: Date.now() + Math.random(),
          content: p.trim(),
          type: 'paragraph'
        })),
        count: paragraphs.length
      };
    }

    return {
      type: 'faqs',
      items,
      count: items.length
    };
  }

  /**
   * Processa arquivo JSON
   */
  async processJSON(file) {
    const text = await file.text();
    const data = JSON.parse(text);

    // Detectar estrutura
    if (Array.isArray(data)) {
      const sample = data[0] || {};
      
      if (sample.name || sample.nome || sample.product) {
        return {
          type: 'products',
          items: data.map(item => this.normalizeProduct(item)),
          count: data.length
        };
      }
      
      if (sample.q || sample.question || sample.pergunta) {
        return {
          type: 'faqs',
          items: data.map(item => this.normalizeFaq(item)),
          count: data.length
        };
      }

      if (sample.input || sample.user) {
        return {
          type: 'examples',
          items: data.map(item => ({
            id: Date.now() + Math.random(),
            input: item.input || item.user || '',
            output: item.output || item.response || item.assistant || '',
            category: item.category || 'geral',
            quality: item.quality || 8,
            tags: item.tags || []
          })),
          count: data.length
        };
      }
    }

    // Estrutura de objeto único
    if (data.products) {
      return { type: 'products', items: data.products, count: data.products.length };
    }
    if (data.faqs) {
      return { type: 'faqs', items: data.faqs, count: data.faqs.length };
    }
    if (data.examples) {
      return { type: 'examples', items: data.examples, count: data.examples.length };
    }

    return { type: 'unknown', items: [data], count: 1 };
  }

  // ============================================
  // EXTRAÇÃO INTELIGENTE
  // ============================================

  /**
   * Extrai entidades de texto (preços, datas, emails, telefones)
   */
  extractEntities(text) {
    const entities = {
      prices: [],
      emails: [],
      phones: [],
      dates: [],
      urls: []
    };

    // Preços
    const pricePattern = /R\$\s*[\d.,]+|[\d.,]+\s*reais/gi;
    entities.prices = (text.match(pricePattern) || []).map(p => p.trim());

    // Emails
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    entities.emails = text.match(emailPattern) || [];

    // Telefones
    const phonePattern = /(?:\+55\s?)?(?:\(?\d{2}\)?[\s.-]?)?\d{4,5}[\s.-]?\d{4}/g;
    entities.phones = text.match(phonePattern) || [];

    // URLs
    const urlPattern = /https?:\/\/[^\s]+/g;
    entities.urls = text.match(urlPattern) || [];

    return entities;
  }

  /**
   * Gera sugestões de FAQs a partir de texto
   */
  suggestFaqsFromText(text) {
    const suggestions = [];
    
    // Padrões comuns de FAQ
    const patterns = [
      { regex: /(?:como|how)\s+(?:fazer|posso|to)\s+(.+?)\?/gi, type: 'how_to' },
      { regex: /(?:qual|what)\s+(?:é|is)\s+(.+?)\?/gi, type: 'what_is' },
      { regex: /(?:quanto|how much)\s+(?:custa|costs?)\s+(.+?)\?/gi, type: 'price' },
      { regex: /(?:onde|where)\s+(?:fica|está|is)\s+(.+?)\?/gi, type: 'location' },
      { regex: /(?:quando|when)\s+(.+?)\?/gi, type: 'time' }
    ];

    patterns.forEach(({ regex, type }) => {
      let match;
      while ((match = regex.exec(text)) !== null) {
        suggestions.push({
          question: match[0],
          topic: match[1].trim(),
          type
        });
      }
    });

    return suggestions;
  }

  // ============================================
  // RESULTADOS
  // ============================================

  getResults() {
    return [...this.results];
  }

  clearResults() {
    this.results = [];
  }

  /**
   * Obtém estatísticas do processamento
   */
  getStats() {
    const stats = {
      totalFiles: this.results.length,
      products: 0,
      faqs: 0,
      examples: 0,
      knowledge: 0
    };

    this.results.forEach(r => {
      if (r.type === 'products') stats.products += r.count;
      if (r.type === 'faqs') stats.faqs += r.count;
      if (r.type === 'examples') stats.examples += r.count;
      if (r.type === 'knowledge') stats.knowledge += r.count;
    });

    return stats;
  }
}

// Exportar
window.DocumentImporter = DocumentImporter;
window.documentImporter = new DocumentImporter();
console.log('[DocumentImporter] ✅ Módulo de importação de documentos carregado');
