/**
 * 🗄️ DossierStore — persistência ISOLADA do dossiê do cliente (Camada 3 — evolução)
 *
 * Torna a memória de relacionamento PERSISTENTE entre conversas (cross-sessão):
 * mesmo numa conversa nova, a IA lembra do que o cliente já contou antes.
 *
 * Decisões de segurança ("não quebrar nada" + LGPD):
 *  - ISOLADO: tabela própria `customer_dossiers`, autocriada (CREATE TABLE IF NOT
 *    EXISTS). NÃO toca no ConversationMemory (que é frágil e sobrescreveria facts).
 *  - DESLIGADO POR PADRÃO: o AIOrchestrator só usa este store quando
 *    WHL_PERSISTENT_DOSSIER='1'. Sem a flag, a memória continua stateless (atual).
 *  - LGPD: dados pessoais. `purge()` remove por idade/chat e o script
 *    lgpd-retention-purge.js já inclui esta tabela (RETENTION_DOSSIER_DAYS).
 *
 * À prova de falha: qualquer erro de DB é engolido (a geração segue sem persistir).
 */

'use strict';

const db = require('../../utils/database');
const logger = require('../../utils/logger');

let _tableReady = false;
function ensureTable() {
  if (_tableReady) return;
  try {
    db.run(`CREATE TABLE IF NOT EXISTS customer_dossiers (
      workspace_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      name TEXT,
      facts TEXT DEFAULT '[]',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, chat_id)
    )`);
    _tableReady = true;
  } catch (e) {
    logger.warn?.(`[DossierStore] ensureTable falhou: ${e.message}`);
  }
}

class DossierStore {
  constructor(tenantId) {
    this.tenantId = tenantId || 'default';
  }

  /** @returns {{ name: string|null, facts: string[] } | null} */
  load(chatId) {
    if (!chatId) return null;
    ensureTable();
    try {
      const row = db.get(
        'SELECT name, facts FROM customer_dossiers WHERE workspace_id = ? AND chat_id = ?',
        [this.tenantId, chatId]
      );
      if (!row) return null;
      let facts = [];
      try { const a = JSON.parse(row.facts || '[]'); if (Array.isArray(a)) facts = a; } catch (_) { /* facts malformado */ }
      return { name: row.name || null, facts };
    } catch (e) {
      logger.debug?.(`[DossierStore] load: ${e.message}`);
      return null;
    }
  }

  /** Upsert do dossiê. Mantém o nome anterior se o novo vier vazio. */
  save(chatId, { name = null, facts = [] } = {}, cap = 8) {
    if (!chatId) return;
    ensureTable();
    try {
      const safeFacts = JSON.stringify((Array.isArray(facts) ? facts : []).slice(-cap));
      db.run(
        `INSERT INTO customer_dossiers (workspace_id, chat_id, name, facts, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(workspace_id, chat_id) DO UPDATE SET
           name = COALESCE(excluded.name, customer_dossiers.name),
           facts = excluded.facts,
           updated_at = CURRENT_TIMESTAMP`,
        [this.tenantId, chatId, name || null, safeFacts]
      );
    } catch (e) {
      logger.debug?.(`[DossierStore] save: ${e.message}`);
    }
  }

  /**
   * LGPD: remove dossiês. Por chat (direito ao esquecimento) ou por idade.
   * @param {{ chatId?: string, olderThanDays?: number }} opts
   */
  purge({ chatId = null, olderThanDays = null } = {}) {
    ensureTable();
    try {
      if (chatId) {
        db.run('DELETE FROM customer_dossiers WHERE workspace_id = ? AND chat_id = ?', [this.tenantId, chatId]);
      } else if (olderThanDays) {
        db.run(
          `DELETE FROM customer_dossiers WHERE workspace_id = ? AND updated_at < datetime('now', ?)`,
          [this.tenantId, `-${parseInt(olderThanDays, 10)} days`]
        );
      }
    } catch (e) {
      logger.debug?.(`[DossierStore] purge: ${e.message}`);
    }
  }
}

module.exports = DossierStore;
