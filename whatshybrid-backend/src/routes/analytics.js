/**
 * Analytics Routes
 */

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');

const db = require('../utils/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');

router.get('/dashboard', authenticate, asyncHandler(async (req, res) => {
  const { period = '7d' } = req.query;
  
  const days = period === '30d' ? 30 : period === '90d' ? 90 : 7;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const stats = {
    contacts: db.get('SELECT COUNT(*) as total FROM contacts WHERE workspace_id = ?', [req.workspaceId]).total,
    conversations: db.get('SELECT COUNT(*) as total FROM conversations WHERE workspace_id = ?', [req.workspaceId]).total,
    messages: db.get('SELECT COUNT(*) as total FROM messages m JOIN conversations c ON m.conversation_id = c.id WHERE c.workspace_id = ?', [req.workspaceId]).total,
    campaigns: db.get('SELECT COUNT(*) as total FROM campaigns WHERE workspace_id = ?', [req.workspaceId]).total,
    deals: db.get('SELECT COUNT(*) as total, SUM(value) as total_value FROM deals WHERE workspace_id = ?', [req.workspaceId]),
    tasks: db.get('SELECT COUNT(*) as total, SUM(CASE WHEN status = "completed" THEN 1 ELSE 0 END) as completed FROM tasks WHERE workspace_id = ?', [req.workspaceId])
  };

  const messagesByDay = db.all(`
    SELECT DATE(m.created_at) as date, COUNT(*) as count, m.sender_type
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    WHERE c.workspace_id = ? AND m.created_at >= ?
    GROUP BY DATE(m.created_at), m.sender_type
    ORDER BY date
  `, [req.workspaceId, startDate.toISOString()]);

  const dealsByStage = db.all(`
    SELECT stage, COUNT(*) as count, SUM(value) as total_value
    FROM deals WHERE workspace_id = ?
    GROUP BY stage
  `, [req.workspaceId]);

  res.json({ stats, messagesByDay, dealsByStage, period });
}));

router.post('/events', authenticate, asyncHandler(async (req, res) => {
  const { event_type, event_data, session_id } = req.body;
  const id = uuidv4();
  db.run(
    'INSERT INTO analytics_events (id, workspace_id, event_type, event_data, user_id, session_id) VALUES (?, ?, ?, ?, ?, ?)',
    [id, req.workspaceId, event_type, JSON.stringify(event_data || {}), req.userId, session_id]
  );
  res.status(201).json({ id });
}));

router.get('/events', authenticate, asyncHandler(async (req, res) => {
  const { event_type, start_date, end_date, limit = 100 } = req.query;
  let sql = 'SELECT * FROM analytics_events WHERE workspace_id = ?';
  const params = [req.workspaceId];
  if (event_type) { sql += ' AND event_type = ?'; params.push(event_type); }
  if (start_date) { sql += ' AND created_at >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND created_at <= ?'; params.push(end_date); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit));
  const events = db.all(sql, params).map(e => ({ ...e, event_data: JSON.parse(e.event_data) }));
  res.json({ events });
}));

/**
 * PEND-MED-010: Telemetry endpoint para métricas da extensão
 * Recebe dados de telemetria do AnalyticsModule da extensão
 */
router.post('/telemetry', authenticate, asyncHandler(async (req, res) => {
  const {
    sessionId,
    totalMessages,
    daily,
    hourly,
    contacts,
    campaigns,
    responseTimes
  } = req.body;

  try {
    // Criar registro de telemetria
    const telemetryId = uuidv4();
    db.run(`
      INSERT INTO analytics_telemetry (
        id, workspace_id, user_id, session_id,
        total_sent, total_failed, total_confirmed,
        unique_contacts, total_campaigns,
        data_snapshot, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `, [
      telemetryId,
      req.workspaceId,
      req.userId,
      sessionId,
      totalMessages?.sent || 0,
      totalMessages?.failed || 0,
      totalMessages?.confirmed || 0,
      contacts?.length || 0,
      campaigns?.length || 0,
      JSON.stringify({ daily, hourly, campaigns, responseTimes })
    ]);

    // Processar métricas diárias
    if (daily && typeof daily === 'object') {
      for (const [date, metrics] of Object.entries(daily)) {
        const metricId = uuidv4();
        db.run(`
          INSERT OR REPLACE INTO analytics_daily_metrics (
            id, workspace_id, date, messages_sent, messages_failed
          ) VALUES (?, ?, ?, ?, ?)
        `, [
          metricId,
          req.workspaceId,
          date,
          metrics.sent || 0,
          metrics.failed || 0
        ]);
      }
    }

    // Processar campanhas
    if (campaigns && Array.isArray(campaigns)) {
      for (const campaign of campaigns) {
        const eventId = uuidv4();
        db.run(`
          INSERT INTO analytics_events (
            id, workspace_id, event_type, event_data, user_id, session_id
          ) VALUES (?, ?, 'campaign_completed', ?, ?, ?)
        `, [
          eventId,
          req.workspaceId,
          JSON.stringify(campaign),
          req.userId,
          sessionId
        ]);
      }
    }

    res.json({
      success: true,
      telemetryId,
      message: 'Telemetry data received and processed'
    });

  } catch (error) {
    logger.error('[Analytics] Telemetry error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process telemetry data'
    });
  }
}));

/**
 * PEND-MED-010: Obter agregados de telemetria
 */
router.get('/telemetry/summary', authenticate, asyncHandler(async (req, res) => {
  const { period = '7d' } = req.query;

  const days = period === '30d' ? 30 : period === '90d' ? 90 : 7;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const summary = db.get(`
    SELECT
      SUM(total_sent) as total_sent,
      SUM(total_failed) as total_failed,
      SUM(total_confirmed) as total_confirmed,
      MAX(unique_contacts) as unique_contacts,
      COUNT(DISTINCT session_id) as sessions
    FROM analytics_telemetry
    WHERE workspace_id = ? AND created_at >= ?
  `, [req.workspaceId, startDate.toISOString()]);

  const dailyMetrics = db.all(`
    SELECT date, messages_sent, messages_failed
    FROM analytics_daily_metrics
    WHERE workspace_id = ? AND date >= ?
    ORDER BY date ASC
  `, [req.workspaceId, startDate.toISOString().split('T')[0]]);

  res.json({
    summary,
    dailyMetrics,
    period
  });
}));

module.exports = router;
