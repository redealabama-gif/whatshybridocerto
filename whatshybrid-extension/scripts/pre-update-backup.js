/**
 * 💾 Pre-Update Backup - Backup antes de atualizações
 * Axion v7.9.12
 * 
 * Cria backup completo de todos os dados da extensão
 * antes de uma atualização.
 * 
 * Uso: await WHLBackup.create()
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const BACKUP_PREFIX = 'whl_backup_';
  const MAX_BACKUPS = 5;

  /**
   * Cria backup completo dos dados
   * @returns {Object} - Resultado do backup
   */
  async function createPreUpdateBackup() {
    console.log('[Backup] 💾 Iniciando backup pré-atualização...');

    const timestamp = Date.now();
    const backupKey = `${BACKUP_PREFIX}${timestamp}`;

    try {
      // Obter todos os dados com prefixo whl_
      const allData = await chrome.storage.local.get(null);
      const whlData = {};
      
      for (const [key, value] of Object.entries(allData)) {
        if (key.startsWith('whl_') && !key.startsWith(BACKUP_PREFIX)) {
          whlData[key] = value;
        }
      }

      const backup = {
        version: window.WHLVersion?.get?.() || 'unknown',
        createdAt: new Date().toISOString(),
        timestamp,
        dataCount: Object.keys(whlData).length,
        data: whlData
      };

      // Salvar backup
      await chrome.storage.local.set({ [backupKey]: JSON.stringify(backup) });

      // Limpar backups antigos
      await cleanupOldBackups();

      console.log(`[Backup] ✅ Backup criado: ${backupKey}`);
      console.log(`[Backup] 📊 ${backup.dataCount} chaves salvas`);

      // Emitir evento
      if (window.EventBus) {
        window.EventBus.emit('backup:created', { key: backupKey, count: backup.dataCount });
      }

      return {
        success: true,
        key: backupKey,
        count: backup.dataCount,
        timestamp
      };

    } catch (error) {
      console.error('[Backup] ❌ Erro ao criar backup:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Lista todos os backups disponíveis
   * @returns {Array} - Lista de backups
   */
  async function listBackups() {
    const allData = await chrome.storage.local.get(null);
    const backups = [];

    for (const [key, value] of Object.entries(allData)) {
      if (key.startsWith(BACKUP_PREFIX)) {
        try {
          const backup = typeof value === 'string' ? JSON.parse(value) : value;
          backups.push({
            key,
            version: backup.version,
            createdAt: backup.createdAt,
            timestamp: backup.timestamp,
            dataCount: backup.dataCount
          });
        } catch (e) {
          console.warn(`[Backup] Backup inválido: ${key}`);
        }
      }
    }

    return backups.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Restaura um backup específico
   * @param {string} backupKey - Chave do backup
   * @param {boolean} confirm - Confirmar restauração
   * @returns {Object} - Resultado
   */
  async function restoreBackup(backupKey, confirm = false) {
    if (!confirm) {
      return {
        success: false,
        message: 'Confirme a restauração passando confirm=true',
        warning: 'Isso irá sobrescrever todos os dados atuais!'
      };
    }

    console.log(`[Backup] 🔄 Restaurando backup: ${backupKey}`);

    try {
      const data = await chrome.storage.local.get(backupKey);
      if (!data[backupKey]) {
        throw new Error('Backup não encontrado');
      }

      const backup = typeof data[backupKey] === 'string' 
        ? JSON.parse(data[backupKey]) 
        : data[backupKey];

      if (!backup.data || typeof backup.data !== 'object') {
        throw new Error('Dados do backup inválidos');
      }

      // Criar backup do estado atual antes de restaurar
      await createPreUpdateBackup();

      // Restaurar dados
      await chrome.storage.local.set(backup.data);

      console.log(`[Backup] ✅ Restaurado: ${Object.keys(backup.data).length} chaves`);
      console.log('[Backup] ⚠️ Recarregue a página para aplicar as mudanças');

      return {
        success: true,
        restoredCount: Object.keys(backup.data).length,
        fromVersion: backup.version,
        fromDate: backup.createdAt
      };

    } catch (error) {
      console.error('[Backup] ❌ Erro ao restaurar:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Limpa backups antigos
   */
  async function cleanupOldBackups() {
    const backups = await listBackups();
    
    if (backups.length > MAX_BACKUPS) {
      const toRemove = backups.slice(MAX_BACKUPS);
      
      for (const backup of toRemove) {
        await chrome.storage.local.remove(backup.key);
        console.log(`[Backup] 🗑️ Backup antigo removido: ${backup.key}`);
      }
    }
  }

  /**
   * Exporta backup para arquivo JSON
   * @param {string} backupKey - Chave do backup (opcional, usa mais recente)
   * @returns {Object} - Dados para download
   */
  async function exportBackup(backupKey = null) {
    let key = backupKey;
    
    if (!key) {
      const backups = await listBackups();
      if (backups.length === 0) {
        // Criar backup primeiro
        const result = await createPreUpdateBackup();
        key = result.key;
      } else {
        key = backups[0].key;
      }
    }

    const data = await chrome.storage.local.get(key);
    const backup = typeof data[key] === 'string' ? JSON.parse(data[key]) : data[key];

    const exportData = {
      ...backup,
      exportedAt: new Date().toISOString()
    };

    // Criar blob para download
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = `whatshybrid-backup-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('[Backup] 📥 Backup exportado para arquivo');
    
    return exportData;
  }

  /**
   * Importa backup de arquivo JSON
   * @param {File|Object} fileOrData - Arquivo ou dados do backup
   * @returns {Object} - Resultado
   */
  async function importBackup(fileOrData) {
    try {
      let backup;
      
      if (fileOrData instanceof File) {
        const text = await fileOrData.text();
        backup = JSON.parse(text);
      } else {
        backup = fileOrData;
      }

      if (!backup.data || typeof backup.data !== 'object') {
        throw new Error('Formato de backup inválido');
      }

      // Salvar como novo backup
      const timestamp = Date.now();
      const backupKey = `${BACKUP_PREFIX}imported_${timestamp}`;
      
      await chrome.storage.local.set({ [backupKey]: JSON.stringify(backup) });

      console.log(`[Backup] ✅ Backup importado: ${backupKey}`);
      
      return {
        success: true,
        key: backupKey,
        count: Object.keys(backup.data).length,
        message: `Use WHLBackup.restore('${backupKey}', true) para restaurar`
      };

    } catch (error) {
      console.error('[Backup] ❌ Erro ao importar:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Remove um backup específico
   * @param {string} backupKey - Chave do backup
   */
  async function deleteBackup(backupKey) {
    await chrome.storage.local.remove(backupKey);
    console.log(`[Backup] 🗑️ Backup removido: ${backupKey}`);
  }

  // Exportar globalmente
  window.WHLBackup = {
    create: createPreUpdateBackup,
    list: listBackups,
    restore: restoreBackup,
    export: exportBackup,
    import: importBackup,
    delete: deleteBackup,
    cleanup: cleanupOldBackups
  };

  console.log('[Backup] ✅ Sistema de backup carregado');
})();
