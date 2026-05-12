/**
 * Jobs Routes - API para gerenciamento de jobs em background
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const database = require('../utils/database');
const JobsRunner = require('../jobs/JobsRunner');
const logger = require('../utils/logger');

/**
 * POST /api/v1/jobs
 * Cria um novo job
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { type, payload, priority, scheduledAt, maxRetries, timeout } = req.body;
    
    if (!type || !JobsRunner.JOB_TYPES[type.toUpperCase()]) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Tipo de job inválido. Tipos válidos: ${Object.keys(JobsRunner.JOB_TYPES).join(', ')}`
      });
    }
    
    const db = database;
    const job = await JobsRunner.createJob(db, {
      type: JobsRunner.JOB_TYPES[type.toUpperCase()],
      payload: payload || {},
      priority: priority || 0,
      scheduledAt: scheduledAt ? new Date(scheduledAt).getTime() : null,
      maxRetries: maxRetries || 3,
      timeout: timeout || 60000
    });
    
    res.status(201).json({
      success: true,
      job
    });
    
  } catch (error) {
    logger.error('Error creating job:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/jobs
 * Lista jobs com filtros
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, type, limit = 50, offset = 0 } = req.query;
    const db = database;
    
    let query = 'SELECT * FROM scheduled_jobs WHERE 1=1';
    const params = [];
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const jobs = await db.all(query, params);
    const total = await db.get('SELECT COUNT(*) as count FROM scheduled_jobs');
    
    res.json({
      success: true,
      jobs: jobs.map(j => ({
        ...j,
        payload: JSON.parse(j.payload || '{}'),
        result: j.result ? JSON.parse(j.result) : null
      })),
      total: total.count
    });
    
  } catch (error) {
    logger.error('Error listing jobs:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/jobs/:id
 * Obtém detalhes de um job específico
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const db = database;
    
    const job = await db.get('SELECT * FROM scheduled_jobs WHERE id = ?', [id]);
    
    if (!job) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Job não encontrado'
      });
    }
    
    // Busca logs do job
    const logs = await db.all(
      'SELECT * FROM job_logs WHERE job_id = ? ORDER BY created_at DESC LIMIT 50',
      [id]
    );
    
    res.json({
      success: true,
      job: {
        ...job,
        payload: JSON.parse(job.payload || '{}'),
        result: job.result ? JSON.parse(job.result) : null
      },
      logs: logs.map(l => ({
        ...l,
        details: JSON.parse(l.details || '{}')
      }))
    });
    
  } catch (error) {
    logger.error('Error getting job:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * DELETE /api/v1/jobs/:id
 * Cancela/deleta um job
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const db = database;
    
    const job = await db.get('SELECT * FROM scheduled_jobs WHERE id = ?', [id]);
    
    if (!job) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Job não encontrado'
      });
    }
    
    // Só pode cancelar jobs pendentes
    if (job.status === 'running') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Não é possível cancelar um job em execução'
      });
    }
    
    await db.run('UPDATE scheduled_jobs SET status = ? WHERE id = ?', ['cancelled', id]);
    
    res.json({
      success: true,
      message: 'Job cancelado'
    });
    
  } catch (error) {
    logger.error('Error cancelling job:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/jobs/run
 * Executa jobs pendentes manualmente (admin only)
 */
router.post('/run', authenticate, requireAdmin, async (req, res) => {
  try {
    const db = database;
    const result = await JobsRunner.runOnce(db);
    
    res.json({
      success: true,
      ...result
    });
    
  } catch (error) {
    logger.error('Error running jobs:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/jobs/stats
 * Obtém estatísticas dos jobs
 */
router.get('/stats/summary', authenticate, async (req, res) => {
  try {
    const db = database;
    
    const stats = await db.get(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM scheduled_jobs
    `);
    
    const recentJobs = await db.all(`
      SELECT type, status, created_at, completed_at
      FROM scheduled_jobs
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    res.json({
      success: true,
      stats,
      recentJobs,
      runner: JobsRunner.getStats()
    });
    
  } catch (error) {
    logger.error('Error getting job stats:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/jobs/types
 * Lista tipos de jobs disponíveis
 */
router.get('/types/list', authenticate, async (req, res) => {
  res.json({
    success: true,
    types: Object.keys(JobsRunner.JOB_TYPES).map(key => ({
      key,
      value: JobsRunner.JOB_TYPES[key]
    }))
  });
});

module.exports = router;
