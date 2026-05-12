/**
 * contact-importer.js - Importador Avançado de Contatos
 * 
 * Importa contatos de arquivos Excel com validação automática,
 * remoção de duplicados e preview antes de importar.
 */

class ContactImporter {
  constructor() {
    this.validatedNumbers = [];
    this.invalidNumbers = [];
    this.duplicates = 0;
  }

  /**
   * Valida e formata um número de telefone
   * @param {string|number} number - Número para validar
   * @returns {string|null} - Número formatado ou null se inválido
   */
  static validatePhoneNumber(number) {
    if (!number) return null;
    
    // Converte para string e remove todos os caracteres não numéricos
    const clean = String(number).replace(/\D/g, '');
    
    // Número muito curto
    if (clean.length < 10) return null;
    
    // Número brasileiro sem código país (11 dígitos com 9 no terceiro dígito)
    if (clean.length === 11 && clean[2] === '9') {
      return '55' + clean;
    }
    
    // Número brasileiro com código país (13 dígitos começando com 55)
    if (clean.length === 13 && clean.startsWith('55')) {
      return clean;
    }
    
    // Número internacional (entre 10 e 15 dígitos)
    if (clean.length >= 10 && clean.length <= 15) {
      return clean;
    }
    
    // Número inválido
    return null;
  }

  /**
   * Remove duplicados de uma lista de números
   * @param {Array} numbers - Lista de números
   * @returns {Array} - Lista sem duplicados
   */
  static removeDuplicates(numbers) {
    const validated = numbers
      .map(n => this.validatePhoneNumber(n))
      .filter(Boolean);
    
    return [...new Set(validated)];
  }

  /**
   * Processa arquivo Excel (requer SheetJS/XLSX)
   * @param {File} file - Arquivo Excel
   * @returns {Promise<Object>} - Resultado com números validados
   */
  static async parseExcel(file) {
    try {
      // Verificar se SheetJS está disponível
      if (typeof XLSX === 'undefined') {
        throw new Error('Biblioteca XLSX não está carregada. Adicione o script SheetJS na página.');
      }

      // Ler arquivo como ArrayBuffer
      const data = await file.arrayBuffer();
      
      // Parsear workbook
      const workbook = XLSX.read(data, { type: 'array' });
      
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('O arquivo Excel não contém nenhuma planilha');
      }

      // Pegar a primeira planilha
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      
      // Converter para JSON (array de arrays)
      const rows = XLSX.utils.sheet_to_json(sheet, { 
        header: 1,
        defval: '',
        blankrows: false
      });

      if (!rows || rows.length === 0) {
        throw new Error('A planilha está vazia');
      }

      // Extrair todos os números (de todas as colunas e linhas)
      const allCells = [];
      rows.forEach(row => {
        if (Array.isArray(row)) {
          row.forEach(cell => {
            if (cell !== null && cell !== undefined && cell !== '') {
              allCells.push(cell);
            }
          });
        }
      });

      // Filtrar apenas células que parecem números de telefone
      const possibleNumbers = allCells.filter(cell => {
        const str = String(cell).replace(/\D/g, '');
        return str.length >= 10 && str.length <= 15;
      });

      if (possibleNumbers.length === 0) {
        throw new Error('Nenhum número de telefone encontrado no arquivo');
      }

      // Validar e remover duplicados
      const uniqueNumbers = this.removeDuplicates(possibleNumbers);

      // Separar válidos e inválidos
      const valid = [];
      const invalid = [];
      
      possibleNumbers.forEach(num => {
        const validated = this.validatePhoneNumber(num);
        if (validated) {
          valid.push(validated);
        } else {
          invalid.push(String(num));
        }
      });

      const duplicates = valid.length - uniqueNumbers.length;

      return {
        success: true,
        numbers: uniqueNumbers,
        stats: {
          total: possibleNumbers.length,
          valid: valid.length,
          invalid: invalid.length,
          duplicates: duplicates,
          unique: uniqueNumbers.length
        },
        invalidNumbers: invalid.slice(0, 10) // Primeiros 10 inválidos para debug
      };
    } catch (error) {
      console.error('[ContactImporter] Erro ao processar Excel:', error);
      return {
        success: false,
        error: error.message || 'Erro ao processar arquivo Excel',
        numbers: []
      };
    }
  }

  /**
   * Processa arquivo CSV
   * @param {File} file - Arquivo CSV
   * @returns {Promise<Object>} - Resultado com números validados
   */
  static async parseCSV(file) {
    try {
      const text = await file.text();
      
      // Separar linhas
      const lines = text.split(/\r?\n/).filter(line => line.trim());
      
      if (lines.length === 0) {
        throw new Error('O arquivo CSV está vazio');
      }

      // Extrair todos os valores (separados por vírgula, ponto-e-vírgula ou tab)
      const allValues = [];
      lines.forEach(line => {
        const values = line.split(/[,;\t]/).map(v => v.trim());
        allValues.push(...values);
      });

      // Filtrar apenas valores que parecem números de telefone
      const possibleNumbers = allValues.filter(val => {
        const str = String(val).replace(/\D/g, '');
        return str.length >= 10 && str.length <= 15;
      });

      if (possibleNumbers.length === 0) {
        throw new Error('Nenhum número de telefone encontrado no arquivo');
      }

      // Validar e remover duplicados
      const uniqueNumbers = this.removeDuplicates(possibleNumbers);

      // Separar válidos e inválidos
      const valid = [];
      const invalid = [];
      
      possibleNumbers.forEach(num => {
        const validated = this.validatePhoneNumber(num);
        if (validated) {
          valid.push(validated);
        } else {
          invalid.push(String(num));
        }
      });

      const duplicates = valid.length - uniqueNumbers.length;

      return {
        success: true,
        numbers: uniqueNumbers,
        stats: {
          total: possibleNumbers.length,
          valid: valid.length,
          invalid: invalid.length,
          duplicates: duplicates,
          unique: uniqueNumbers.length
        },
        invalidNumbers: invalid.slice(0, 10)
      };
    } catch (error) {
      console.error('[ContactImporter] Erro ao processar CSV:', error);
      return {
        success: false,
        error: error.message || 'Erro ao processar arquivo CSV',
        numbers: []
      };
    }
  }

  /**
   * Detecta o tipo de arquivo e processa adequadamente
   * @param {File} file - Arquivo para processar
   * @returns {Promise<Object>} - Resultado com números validados
   */
  static async importFile(file) {
    if (!file) {
      return {
        success: false,
        error: 'Nenhum arquivo selecionado',
        numbers: []
      };
    }

    const fileName = file.name.toLowerCase();
    
    // Verificar extensão
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      return await this.parseExcel(file);
    } else if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
      return await this.parseCSV(file);
    } else {
      return {
        success: false,
        error: 'Formato de arquivo não suportado. Use .xlsx, .xls, .csv ou .txt',
        numbers: []
      };
    }
  }

  /**
   * Formata estatísticas para exibição
   * @param {Object} stats - Estatísticas da importação
   * @returns {string} - Texto formatado
   */
  static formatStats(stats) {
    if (!stats) return '';
    
    const parts = [];
    
    parts.push(`Total: ${stats.total}`);
    parts.push(`Válidos: ${stats.valid}`);
    
    if (stats.invalid > 0) {
      parts.push(`Inválidos: ${stats.invalid}`);
    }
    
    if (stats.duplicates > 0) {
      parts.push(`Duplicados: ${stats.duplicates}`);
    }
    
    parts.push(`✅ Únicos: ${stats.unique}`);
    
    return parts.join(' | ');
  }
}

// Exportar para uso global
if (typeof window !== 'undefined') {
  window.ContactImporter = ContactImporter;
}
