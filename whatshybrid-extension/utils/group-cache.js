/**
 * group-cache.js - Sistema de Cache para Grupos
 * 
 * Armazena grupos em cache local por 5 minutos para carregamento instantâneo
 * e reduzir consultas ao WhatsApp Web.
 */

class GroupCache {
  static CACHE_KEY = 'whl_groups_cache';
  static CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

  /**
   * Obtém grupos do cache (se válido)
   * @returns {Promise<Object|null>} - Cache ou null se expirado
   */
  static async get() {
    try {
      const data = await chrome.storage.local.get(this.CACHE_KEY);
      const cache = data[this.CACHE_KEY];
      
      if (!cache) {
        console.log('[GroupCache] Cache não encontrado');
        return null;
      }
      
      // Verificar se o cache ainda é válido
      const age = Date.now() - cache.timestamp;
      
      if (age < this.CACHE_DURATION) {
        console.log('[GroupCache] Cache válido -', Math.round(age / 1000), 'segundos de idade');
        return { 
          groups: cache.groups,
          stats: cache.stats,
          fromCache: true,
          age: age,
          expiresIn: this.CACHE_DURATION - age
        };
      }
      
      console.log('[GroupCache] Cache expirado -', Math.round(age / 1000), 'segundos');
      return null;
    } catch (error) {
      console.error('[GroupCache] Erro ao obter cache:', error);
      return null;
    }
  }

  /**
   * Salva grupos no cache
   * @param {Array} groups - Lista de grupos
   * @param {Object} stats - Estatísticas dos grupos
   * @returns {Promise<boolean>} - Sucesso ou falha
   */
  static async set(groups, stats = null) {
    try {
      if (!Array.isArray(groups)) {
        throw new Error('Groups deve ser um array');
      }
      
      const cache = {
        groups: groups,
        stats: stats || {
          total: groups.length,
          active: groups.filter(g => !g.isArchived).length,
          archived: groups.filter(g => g.isArchived).length
        },
        timestamp: Date.now()
      };
      
      await chrome.storage.local.set({
        [this.CACHE_KEY]: cache
      });
      
      console.log('[GroupCache] Cache salvo -', groups.length, 'grupos');
      return true;
    } catch (error) {
      console.error('[GroupCache] Erro ao salvar cache:', error);
      return false;
    }
  }

  /**
   * Limpa o cache
   * @returns {Promise<boolean>} - Sucesso ou falha
   */
  static async clear() {
    try {
      await chrome.storage.local.remove(this.CACHE_KEY);
      console.log('[GroupCache] Cache limpo');
      return true;
    } catch (error) {
      console.error('[GroupCache] Erro ao limpar cache:', error);
      return false;
    }
  }

  /**
   * Verifica se o cache existe e é válido
   * @returns {Promise<boolean>} - true se válido
   */
  static async isValid() {
    const cache = await this.get();
    return cache !== null && cache.fromCache === true;
  }

  /**
   * Obtém informações sobre o cache
   * @returns {Promise<Object>} - Informações do cache
   */
  static async getInfo() {
    try {
      const data = await chrome.storage.local.get(this.CACHE_KEY);
      const cache = data[this.CACHE_KEY];
      
      if (!cache) {
        return {
          exists: false,
          isValid: false
        };
      }
      
      const age = Date.now() - cache.timestamp;
      const isValid = age < this.CACHE_DURATION;
      
      return {
        exists: true,
        isValid: isValid,
        groupCount: cache.groups?.length || 0,
        timestamp: cache.timestamp,
        age: age,
        ageFormatted: this.formatDuration(age),
        expiresIn: isValid ? this.CACHE_DURATION - age : 0,
        expiresInFormatted: isValid ? this.formatDuration(this.CACHE_DURATION - age) : 'Expirado'
      };
    } catch (error) {
      console.error('[GroupCache] Erro ao obter info:', error);
      return {
        exists: false,
        isValid: false,
        error: error.message
      };
    }
  }

  /**
   * Formata duração em milissegundos para texto legível
   * @param {number} ms - Milissegundos
   * @returns {string} - Duração formatada
   */
  static formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}min`;
    } else if (minutes > 0) {
      return `${minutes}min ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Atualiza apenas as estatísticas do cache (sem atualizar grupos)
   * @param {Object} stats - Novas estatísticas
   * @returns {Promise<boolean>} - Sucesso ou falha
   */
  static async updateStats(stats) {
    try {
      const data = await chrome.storage.local.get(this.CACHE_KEY);
      const cache = data[this.CACHE_KEY];
      
      if (!cache) {
        return false;
      }
      
      cache.stats = stats;
      
      await chrome.storage.local.set({
        [this.CACHE_KEY]: cache
      });
      
      console.log('[GroupCache] Estatísticas atualizadas');
      return true;
    } catch (error) {
      console.error('[GroupCache] Erro ao atualizar stats:', error);
      return false;
    }
  }

  /**
   * Configura a duração do cache (em minutos)
   * @param {number} minutes - Duração em minutos
   */
  static setCacheDuration(minutes) {
    if (minutes < 1 || minutes > 60) {
      throw new Error('Duração deve estar entre 1 e 60 minutos');
    }
    
    this.CACHE_DURATION = minutes * 60 * 1000;
    console.log('[GroupCache] Duração do cache configurada para', minutes, 'minutos');
  }
}

// Exportar para uso global
if (typeof window !== 'undefined') {
  window.GroupCache = GroupCache;
}
