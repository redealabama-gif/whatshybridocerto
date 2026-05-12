/**
 * 🔄 Restore Storage - Script de Restauração de Backup
 * WhatsHybrid v7.9.12
 * 
 * Restaura dados do chrome.storage.local a partir de backups
 * 
 * Uso no Console:
 *   WHLRestore.listBackups()       // Lista backups disponíveis
 *   WHLRestore.restore('backup-id') // Restaura um backup
 *   WHLRestore.restoreFromFile()   // Restaura de arquivo JSON exportado
 */

(function() {
  'use strict';

  const BACKUP_PREFIX = 'whl_backup_';

  /**
   * Lista todos os backups disponíveis
   * @returns {Promise<Array>}
   */
  async function listBackups() {
    try {
      const allData = await chrome.storage.local.get(null);
      const backups = [];

      Object.entries(allData).forEach(([key, value]) => {
        if (key.startsWith(BACKUP_PREFIX)) {
          const backup = typeof value === 'string' ? JSON.parse(value) : value;
          backups.push({
            id: key,
            timestamp: backup.timestamp,
            date: new Date(backup.timestamp).toLocaleString(),
            version: backup.version,
            reason: backup.reason || 'manual',
            keysCount: Object.keys(backup.data || {}).length,
            size: JSON.stringify(value).length
          });
        }
      });

      // Ordenar por timestamp (mais recente primeiro)
      backups.sort((a, b) => b.timestamp - a.timestamp);

      console.log('📦 Backups disponíveis:');
      console.table(backups.map(b => ({
        ID: b.id.replace(BACKUP_PREFIX, ''),
        Data: b.date,
        Versão: b.version,
        Motivo: b.reason,
        Chaves: b.keysCount,
        Tamanho: formatBytes(b.size)
      })));

      return backups;
    } catch (error) {
      console.error('[Restore] Erro ao listar backups:', error);
      return [];
    }
  }

  /**
   * Formata bytes para leitura humana
   */
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  /**
   * Restaura um backup específico
   * @param {string} backupId - ID do backup (com ou sem prefixo)
   * @returns {Promise<Object>}
   */
  async function restore(backupId) {
    try {
      // Normalizar ID
      const fullId = backupId.startsWith(BACKUP_PREFIX) ? backupId : BACKUP_PREFIX + backupId;
      
      // Buscar backup
      const result = await chrome.storage.local.get(fullId);
      if (!result[fullId]) {
        throw new Error(`Backup não encontrado: ${backupId}`);
      }

      const backup = typeof result[fullId] === 'string' 
        ? JSON.parse(result[fullId]) 
        : result[fullId];

      if (!backup.data || typeof backup.data !== 'object') {
        throw new Error('Backup corrompido ou sem dados');
      }

      // Confirmar restauração
      const keysCount = Object.keys(backup.data).length;
      console.log(`\n⚠️ ATENÇÃO: Restaurar backup sobrescreverá ${keysCount} chaves!`);
      console.log(`📅 Backup de: ${new Date(backup.timestamp).toLocaleString()}`);
      console.log(`📦 Versão: ${backup.version}`);
      console.log('\n🔑 Para confirmar, execute:');
      console.log(`   WHLRestore.confirmRestore('${backupId}')`);

      // Salvar dados temporariamente para confirmação
      window._pendingRestore = { id: fullId, backup };

      return { 
        status: 'pending_confirmation',
        backupId,
        keysCount,
        timestamp: backup.timestamp
      };
    } catch (error) {
      console.error('[Restore] Erro ao restaurar:', error);
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Confirma e executa a restauração
   * @param {string} backupId - ID do backup
   * @returns {Promise<Object>}
   */
  async function confirmRestore(backupId) {
    try {
      const fullId = backupId.startsWith(BACKUP_PREFIX) ? backupId : BACKUP_PREFIX + backupId;

      // Verificar se há restauração pendente
      if (!window._pendingRestore || window._pendingRestore.id !== fullId) {
        throw new Error('Nenhuma restauração pendente para este backup. Execute restore() primeiro.');
      }

      const { backup } = window._pendingRestore;

      // Criar backup atual antes de restaurar
      console.log('💾 Criando backup de segurança antes da restauração...');
      if (window.WHLBackup?.create) {
        await window.WHLBackup.create('pre-restore');
      }

      // Restaurar dados
      console.log('🔄 Restaurando dados...');
      await chrome.storage.local.set(backup.data);

      // Limpar restauração pendente
      delete window._pendingRestore;

      console.log('✅ Backup restaurado com sucesso!');
      console.log('⚠️ Recarregue a página para aplicar as alterações.');

      return {
        status: 'success',
        restoredKeys: Object.keys(backup.data).length,
        timestamp: backup.timestamp
      };
    } catch (error) {
      console.error('[Restore] Erro ao confirmar restauração:', error);
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Restaura a partir de um arquivo JSON exportado
   * @returns {Promise<Object>}
   */
  async function restoreFromFile() {
    return new Promise((resolve) => {
      // Criar input de arquivo
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.style.display = 'none';

      input.onchange = async (e) => {
        try {
          const file = e.target.files[0];
          if (!file) {
            resolve({ status: 'cancelled' });
            return;
          }

          const text = await file.text();
          const backup = JSON.parse(text);

          if (!backup.data || typeof backup.data !== 'object') {
            throw new Error('Arquivo de backup inválido');
          }

          // Verificar se é um backup válido
          if (!backup.timestamp || !backup.version) {
            console.warn('⚠️ Arquivo não parece ser um backup do WhatsHybrid');
          }

          const keysCount = Object.keys(backup.data).length;
          console.log(`\n📄 Arquivo carregado: ${file.name}`);
          console.log(`📦 ${keysCount} chaves encontradas`);
          console.log(`📅 Data: ${backup.timestamp ? new Date(backup.timestamp).toLocaleString() : 'Desconhecida'}`);
          console.log(`🏷️ Versão: ${backup.version || 'Desconhecida'}`);

          // Criar backup antes de restaurar
          console.log('\n💾 Criando backup de segurança...');
          if (window.WHLBackup?.create) {
            await window.WHLBackup.create('pre-file-restore');
          }

          // Restaurar
          console.log('🔄 Restaurando dados...');
          await chrome.storage.local.set(backup.data);

          console.log('✅ Arquivo restaurado com sucesso!');
          console.log('⚠️ Recarregue a página para aplicar as alterações.');

          resolve({
            status: 'success',
            filename: file.name,
            restoredKeys: keysCount
          });
        } catch (error) {
          console.error('[Restore] Erro ao restaurar arquivo:', error);
          resolve({ status: 'error', error: error.message });
        } finally {
          input.remove();
        }
      };

      document.body.appendChild(input);
      input.click();
    });
  }

  /**
   * Remove um backup específico
   * @param {string} backupId - ID do backup
   * @returns {Promise<Object>}
   */
  async function deleteBackup(backupId) {
    try {
      const fullId = backupId.startsWith(BACKUP_PREFIX) ? backupId : BACKUP_PREFIX + backupId;
      await chrome.storage.local.remove(fullId);
      console.log(`🗑️ Backup ${backupId} removido`);
      return { status: 'success', deleted: fullId };
    } catch (error) {
      console.error('[Restore] Erro ao remover backup:', error);
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Remove todos os backups (exceto os N mais recentes)
   * @param {number} keep - Quantos backups manter (default: 3)
   * @returns {Promise<Object>}
   */
  async function cleanupBackups(keep = 3) {
    try {
      const backups = await listBackups();
      
      if (backups.length <= keep) {
        console.log(`✅ Apenas ${backups.length} backups existem. Nada a limpar.`);
        return { status: 'success', deleted: 0 };
      }

      const toDelete = backups.slice(keep);
      
      for (const backup of toDelete) {
        await chrome.storage.local.remove(backup.id);
      }

      console.log(`🗑️ ${toDelete.length} backups antigos removidos`);
      return { status: 'success', deleted: toDelete.length, kept: keep };
    } catch (error) {
      console.error('[Restore] Erro ao limpar backups:', error);
      return { status: 'error', error: error.message };
    }
  }

  // API Global
  const WHLRestore = {
    listBackups,
    restore,
    confirmRestore,
    restoreFromFile,
    deleteBackup,
    cleanupBackups
  };

  // Expor globalmente
  window.WHLRestore = WHLRestore;

  console.log('[Restore] 🔄 Script de restauração carregado');
  console.log('   WHLRestore.listBackups()    - Lista backups');
  console.log('   WHLRestore.restore(id)      - Restaura backup');
  console.log('   WHLRestore.restoreFromFile() - Restaura de arquivo');

})();
