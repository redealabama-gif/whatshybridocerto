/**
 * 🔄 Migrate Storage Keys - Migração de chaves de storage
 * WhatsHybrid v7.9.12
 * 
 * Script para migrar chaves de storage antigas para o novo formato
 * padronizado (whl_* e whl_*_v2 quando aplicável).
 * 
 * Uso: await WHLMigrate.run()
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  // Mapa de migrações: chave antiga -> chave nova
  const KEY_MIGRATIONS = {
    // Memory System (canônico: whl_memory_system)
    'memory_system': 'whl_memory_system',
    'memorySystem': 'whl_memory_system',
    'whl_memory': 'whl_memory_system',
    
    // Confidence System (canônico: whl_confidence_system)
    'confidence_system': 'whl_confidence_system',
    'confidenceSystem': 'whl_confidence_system',
    'whl_confidence': 'whl_confidence_system',
    
    // Knowledge Base (canônico atual: whl_knowledge_base)
    'knowledge_base': 'whl_knowledge_base',
    'knowledgeBase': 'whl_knowledge_base',
    
    // Few-Shot Examples (canônico atual: whl_few_shot_examples)
    'few_shot_examples': 'whl_few_shot_examples',
    'fewShotExamples': 'whl_few_shot_examples',
    
    // Autopilot
    'autopilot_processed': 'whl_autopilot_processed',
    'autopilotProcessed': 'whl_autopilot_processed',
    'autopilot_blacklist': 'whl_autopilot_blacklist',
    'autopilotBlacklist': 'whl_autopilot_blacklist',
    
    // CRM
    'crm_data': 'whl_crm_v2',
    'crmData': 'whl_crm_v2',
    'whl_crm': 'whl_crm_v2',
    
    // Tasks
    'tasks_data': 'whl_tasks_v2',
    'tasksData': 'whl_tasks_v2',
    'whl_tasks': 'whl_tasks_v2',
    
    // Analytics
    'analytics_data': 'whl_analytics_v2',
    'analyticsData': 'whl_analytics_v2',
    'whl_analytics': 'whl_analytics_v2',
    
    // Settings (canônico: whl_settings)
    'settings': 'whl_settings',
    'user_settings': 'whl_settings',
    'userSettings': 'whl_settings',
    
    // Recover
    'recover_data': 'whl_recover_data',
    'recoverData': 'whl_recover_data',
    
    // Labels
    'labels': 'whl_labels',
    'chat_labels': 'whl_chat_labels',
    
    // Quick Replies
    'quick_replies': 'whl_quick_replies',
    'quickReplies': 'whl_quick_replies'
  };

  // Status da migração
  const MIGRATION_STATUS_KEY = 'whl_migration_status';

  /**
   * Verifica se a migração já foi executada
   */
  async function getMigrationStatus() {
    try {
      const data = await chrome.storage.local.get(MIGRATION_STATUS_KEY);
      return data[MIGRATION_STATUS_KEY] || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Salva status da migração
   */
  async function saveMigrationStatus(status) {
    await chrome.storage.local.set({ [MIGRATION_STATUS_KEY]: status });
  }

  /**
   * Executa migração de chaves
   * @param {boolean} dryRun - Se true, apenas simula a migração
   * @returns {Object} - Resultado da migração
   */
  async function migrateStorageKeys(dryRun = false) {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║         🔄 WhatsHybrid Storage Key Migration               ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    if (dryRun) {
      console.log('⚠️ MODO DRY-RUN: Nenhuma alteração será feita\n');
    }

    const results = {
      timestamp: new Date().toISOString(),
      dryRun,
      migrated: [],
      skipped: [],
      errors: []
    };

    try {
      // Obter todos os dados
      const allData = await chrome.storage.local.get(null);
      
      for (const [oldKey, newKey] of Object.entries(KEY_MIGRATIONS)) {
        // Pular se chave antiga não existe
        if (!(oldKey in allData)) {
          continue;
        }

        // Pular se chave nova já existe com dados
        if (newKey in allData && allData[newKey]) {
          results.skipped.push({
            oldKey,
            newKey,
            reason: 'Nova chave já existe com dados'
          });
          console.log(`⏭️ ${oldKey} -> ${newKey} (já existe)`);
          continue;
        }

        // Migrar dados
        if (!dryRun) {
          try {
            // Copiar para nova chave
            await chrome.storage.local.set({ [newKey]: allData[oldKey] });
            
            // Remover chave antiga (opcional, pode manter para segurança)
            // await chrome.storage.local.remove(oldKey);
            
            results.migrated.push({ oldKey, newKey });
            console.log(`✅ ${oldKey} -> ${newKey}`);

          } catch (error) {
            results.errors.push({ oldKey, newKey, error: error.message });
            console.error(`❌ ${oldKey} -> ${newKey}: ${error.message}`);
          }
        } else {
          results.migrated.push({ oldKey, newKey, dryRun: true });
          console.log(`📋 ${oldKey} -> ${newKey} (dry-run)`);
        }
      }

      // Salvar status
      if (!dryRun && results.errors.length === 0) {
        await saveMigrationStatus({
          completedAt: new Date().toISOString(),
          migrated: results.migrated.length,
          version: window.WHLVersion?.get?.() || 'unknown'
        });
      }

      // Resumo
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log(`📊 RESUMO:`);
      console.log(`   ✅ Migradas: ${results.migrated.length}`);
      console.log(`   ⏭️ Ignoradas: ${results.skipped.length}`);
      console.log(`   ❌ Erros: ${results.errors.length}`);
      console.log('═══════════════════════════════════════════════════════════\n');

      return results;

    } catch (error) {
      console.error('[Migration] Erro fatal:', error);
      results.errors.push({ fatal: true, error: error.message });
      return results;
    }
  }

  /**
   * Verifica quais migrações são necessárias
   */
  async function checkPendingMigrations() {
    const allData = await chrome.storage.local.get(null);
    const pending = [];

    for (const [oldKey, newKey] of Object.entries(KEY_MIGRATIONS)) {
      if (oldKey in allData && !(newKey in allData)) {
        pending.push({ oldKey, newKey });
      }
    }

    if (pending.length === 0) {
      console.log('[Migration] ✅ Nenhuma migração pendente');
    } else {
      console.log(`[Migration] ⚠️ ${pending.length} migração(ões) pendente(s)`);
      pending.forEach(({ oldKey, newKey }) => {
        console.log(`   ${oldKey} -> ${newKey}`);
      });
    }

    return pending;
  }

  /**
   * Rollback de migração (restaura chaves antigas)
   * @param {Array} migrations - Lista de migrações para reverter
   */
  async function rollbackMigration(migrations) {
    console.log('[Migration] 🔙 Iniciando rollback...');

    for (const { oldKey, newKey } of migrations) {
      try {
        const data = await chrome.storage.local.get(newKey);
        if (data[newKey]) {
          await chrome.storage.local.set({ [oldKey]: data[newKey] });
          console.log(`✅ Restaurado: ${newKey} -> ${oldKey}`);
        }
      } catch (error) {
        console.error(`❌ Erro ao restaurar ${oldKey}:`, error.message);
      }
    }

    console.log('[Migration] Rollback concluído');
  }

  // Exportar globalmente
  window.WHLMigrate = {
    run: migrateStorageKeys,
    dryRun: () => migrateStorageKeys(true),
    check: checkPendingMigrations,
    rollback: rollbackMigration,
    getStatus: getMigrationStatus,
    KEY_MIGRATIONS
  };

  console.log('[Migration] ✅ Script de migração carregado');
})();
