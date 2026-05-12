/**
 * 🎓 Examples API - Sistema de Aprendizado Contínuo
 * 
 * Rotas para gerenciar exemplos de treinamento (few-shot learning):
 * - POST /add - Adiciona novo exemplo
 * - GET /list - Lista todos exemplos do usuário
 * - DELETE /:id - Remove exemplo
 * - PUT /:id - Atualiza exemplo
 * - POST /sync - Sincroniza exemplos
 * 
 * @version 1.0.0
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const db = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

// Aplicar autenticação a todas as rotas
router.use(authenticate);

/**
 * POST /add - Adiciona novo exemplo de treinamento
 */
router.post('/add', async (req, res) => {
  try {
    const userId = req.user.id;
    const workspaceId = req.user.workspace_id;
    const { example, type, timestamp } = req.body;
    
    if (!example || !example.input || !example.output) {
      return res.status(400).json({ 
        success: false, 
        error: 'Exemplo inválido: input e output são obrigatórios' 
      });
    }
    
    const exampleId = example.id || uuidv4();
    
    // Inserir ou atualizar exemplo
    db.run(`
      INSERT OR REPLACE INTO training_examples 
      (id, workspace_id, user_id, input, output, context, category, tags, usage_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `, [
      exampleId,
      workspaceId,
      userId,
      example.input,
      example.output,
      example.context || '',
      example.category || 'Geral',
      JSON.stringify(example.tags || []),
      example.usageCount || 0
    ]);
    
    logger.info('[Examples] Exemplo adicionado:', exampleId);
    
    res.json({ 
      success: true, 
      id: exampleId,
      message: 'Exemplo adicionado com sucesso'
    });
    
  } catch (error) {
    logger.error('[Examples] Erro ao adicionar:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /list - Lista todos exemplos do workspace
 */
router.get('/list', async (req, res) => {
  try {
    const workspaceId = req.user.workspace_id;
    const { category, limit = 100 } = req.query;
    
    let query = `
      SELECT id, input, output, context, category, tags, usage_count, created_at, updated_at
      FROM training_examples 
      WHERE workspace_id = ?
    `;
    const params = [workspaceId];
    
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    
    query += ' ORDER BY usage_count DESC, updated_at DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const examples = db.all(query, params);
    
    // Converter tags de JSON string para array
    const formattedExamples = examples.map(ex => ({
      ...ex,
      tags: ex.tags ? JSON.parse(ex.tags) : [],
      usageCount: ex.usage_count
    }));
    
    res.json({ 
      success: true, 
      examples: formattedExamples,
      total: formattedExamples.length
    });
    
  } catch (error) {
    logger.error('[Examples] Erro ao listar:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /:id - Remove exemplo
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const workspaceId = req.user.workspace_id;
    
    const result = db.run(
      'DELETE FROM training_examples WHERE id = ? AND workspace_id = ?',
      [id, workspaceId]
    );
    
    if (result.changes > 0) {
      res.json({ success: true, message: 'Exemplo removido' });
    } else {
      res.status(404).json({ success: false, error: 'Exemplo não encontrado' });
    }
    
  } catch (error) {
    logger.error('[Examples] Erro ao remover:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /:id - Atualiza exemplo
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const workspaceId = req.user.workspace_id;
    const { input, output, context, category, tags } = req.body;
    
    const result = db.run(`
      UPDATE training_examples 
      SET input = COALESCE(?, input),
          output = COALESCE(?, output),
          context = COALESCE(?, context),
          category = COALESCE(?, category),
          tags = COALESCE(?, tags),
          updated_at = datetime('now')
      WHERE id = ? AND workspace_id = ?
    `, [input, output, context, category, tags ? JSON.stringify(tags) : null, id, workspaceId]);
    
    if (result.changes > 0) {
      res.json({ success: true, message: 'Exemplo atualizado' });
    } else {
      res.status(404).json({ success: false, error: 'Exemplo não encontrado' });
    }
    
  } catch (error) {
    logger.error('[Examples] Erro ao atualizar:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /increment-usage/:id - Incrementa contador de uso
 */
router.post('/increment-usage/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const workspaceId = req.user.workspace_id;
    
    db.run(`
      UPDATE training_examples 
      SET usage_count = usage_count + 1, updated_at = datetime('now')
      WHERE id = ? AND workspace_id = ?
    `, [id, workspaceId]);
    
    res.json({ success: true });
    
  } catch (error) {
    logger.error('[Examples] Erro ao incrementar uso:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /sync - Sincroniza exemplos (recebe batch e retorna todos)
 */
router.post('/sync', async (req, res) => {
  try {
    const workspaceId = req.user.workspace_id;
    const userId = req.user.id;
    const { examples: clientExamples = [] } = req.body;
    
    // Inserir exemplos do cliente que não existem
    for (const ex of clientExamples) {
      const existing = db.get(
        'SELECT id FROM training_examples WHERE id = ? AND workspace_id = ?',
        [ex.id, workspaceId]
      );
      
      if (!existing) {
        db.run(`
          INSERT INTO training_examples 
          (id, workspace_id, user_id, input, output, context, category, tags, usage_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `, [
          ex.id,
          workspaceId,
          userId,
          ex.input,
          ex.output,
          ex.context || '',
          ex.category || 'Geral',
          JSON.stringify(ex.tags || []),
          ex.usageCount || 0
        ]);
      }
    }
    
    // Retornar todos os exemplos do servidor
    const serverExamples = db.all(`
      SELECT id, input, output, context, category, tags, usage_count, created_at, updated_at
      FROM training_examples 
      WHERE workspace_id = ?
      ORDER BY usage_count DESC
      LIMIT 100
    `, [workspaceId]);
    
    const formattedExamples = serverExamples.map(ex => ({
      ...ex,
      tags: ex.tags ? JSON.parse(ex.tags) : [],
      usageCount: ex.usage_count
    }));
    
    res.json({ 
      success: true, 
      examples: formattedExamples,
      synced: clientExamples.length,
      total: formattedExamples.length
    });
    
  } catch (error) {
    logger.error('[Examples] Erro ao sincronizar:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /stats - Estatísticas de aprendizado
 */
router.get('/stats', async (req, res) => {
  try {
    const workspaceId = req.user.workspace_id;
    
    const totalExamples = db.get(
      'SELECT COUNT(*) as count FROM training_examples WHERE workspace_id = ?',
      [workspaceId]
    )?.count || 0;
    
    const totalUsage = db.get(
      'SELECT SUM(usage_count) as total FROM training_examples WHERE workspace_id = ?',
      [workspaceId]
    )?.total || 0;
    
    const categories = db.all(`
      SELECT category, COUNT(*) as count 
      FROM training_examples 
      WHERE workspace_id = ?
      GROUP BY category
    `, [workspaceId]);
    
    const topExamples = db.all(`
      SELECT id, input, output, usage_count
      FROM training_examples 
      WHERE workspace_id = ?
      ORDER BY usage_count DESC
      LIMIT 5
    `, [workspaceId]);
    
    res.json({
      success: true,
      stats: {
        totalExamples,
        totalUsage,
        categories,
        topExamples
      }
    });
    
  } catch (error) {
    logger.error('[Examples] Erro ao obter stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
