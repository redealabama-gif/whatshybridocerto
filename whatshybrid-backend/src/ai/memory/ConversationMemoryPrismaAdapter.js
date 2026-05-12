/**
 * ConversationMemorySQLiteAdapter
 *
 * CORREÇÃO: Reescrito para usar better-sqlite3 (database.js) em vez de Prisma.
 * O nome "PrismaAdapter" é mantido para não quebrar imports existentes.
 *
 * Mapeia para a tabela chat_memories (criada em database.js SCHEMA).
 * Garante isolamento por tenant via workspace_id em todas as queries.
 */

'use strict';

const db = require('../../utils/database');

class ConversationMemoryPrismaAdapter {
  /**
   * @param {*} _prisma  — ignorado (compatibilidade com assinatura antiga)
   * @param {string} tenantId
   */
  constructor(_prisma, tenantId) {
    this.tenantId = tenantId || 'default';
  }

  /** Chave composta: tenantId:chatId */
  _key(chatId) {
    return `${this.tenantId}:${chatId}`;
  }

  /**
   * Carrega memória de conversa de um chat.
   * @param {string} chatId
   * @returns {Object|null}
   */
  load(chatId) {
    const row = db.get(
      'SELECT * FROM chat_memories WHERE chat_id = ? AND workspace_id = ?',
      [chatId, this.tenantId]
    );
    if (!row) return null;

    return {
      chatId:      row.chat_id,
      workspaceId: row.workspace_id,
      chatTitle:   row.chat_title,
      phoneNumber: row.phone_number,
      summary:     row.summary,
      facts:       this._parseJSON(row.facts, []),
      interactions: this._parseJSON(row.interactions, []),
      context:     this._parseJSON(row.context, {}),
      metrics:     this._parseJSON(row.metrics, {}),
      version:     row.version,
      createdAt:   row.created_at,
      updatedAt:   row.updated_at,
    };
  }

  /**
   * Persiste memória de conversa.
   * @param {string} chatId
   * @param {Object} memory
   */
  save(chatId, memory) {
    db.run(
      `INSERT INTO chat_memories
       (id, chat_id, workspace_id, chat_title, phone_number, summary,
        facts, interactions, context, metrics, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(chat_id, workspace_id) DO UPDATE SET
         chat_title=excluded.chat_title,
         phone_number=excluded.phone_number,
         summary=excluded.summary,
         facts=excluded.facts,
         interactions=excluded.interactions,
         context=excluded.context,
         metrics=excluded.metrics,
         version=version + 1,
         updated_at=CURRENT_TIMESTAMP`,
      [
        this._key(chatId),
        chatId,
        this.tenantId,
        memory.chatTitle   || null,
        memory.phoneNumber || null,
        memory.summary     || null,
        JSON.stringify(memory.facts        || []),
        JSON.stringify(memory.interactions || []),
        JSON.stringify(memory.context      || {}),
        JSON.stringify(memory.metrics      || {}),
        memory.version || 1,
      ]
    );
  }

  /**
   * Deleta memória de um chat.
   */
  delete(chatId) {
    db.run(
      'DELETE FROM chat_memories WHERE chat_id = ? AND workspace_id = ?',
      [chatId, this.tenantId]
    );
  }

  /**
   * Carrega todas as memórias do tenant.
   * @returns {Map<chatId, memoryObject>}
   */
  loadAll() {
    const rows = db.all(
      'SELECT * FROM chat_memories WHERE workspace_id = ? ORDER BY updated_at DESC',
      [this.tenantId]
    );
    const map = new Map();
    for (const row of rows) {
      map.set(row.chat_id, this.load(row.chat_id));
    }
    return map;
  }

  /**
   * Adiciona uma interação ao histórico da conversa.
   * Mantém limite máximo de 100 interações para evitar crescimento indefinido.
   */
  addInteraction(chatId, interaction, maxHistory = 100) {
    const memory = this.load(chatId) || {
      chatId, facts: [], interactions: [], context: {}, metrics: {},
    };

    memory.interactions = memory.interactions || [];
    memory.interactions.push({ ...interaction, ts: Date.now() });

    // CORREÇÃO: Sem limite de histórico → crescimento indefinido (auditoria: "sem limite de histórico")
    if (memory.interactions.length > maxHistory) {
      memory.interactions = memory.interactions.slice(-maxHistory);
    }

    this.save(chatId, memory);
    return memory;
  }

  _parseJSON(str, fallback) {
    if (!str) return fallback;
    if (typeof str === 'object') return str;
    try { return JSON.parse(str); } catch (_) { return fallback; }
  }
}

module.exports = ConversationMemoryPrismaAdapter;
