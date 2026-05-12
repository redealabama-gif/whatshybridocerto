/**
 * CostLoggerService.js — v9.5.5
 *
 * Logs each LLM request to the llm_cost_log table with token counts, latency
 * and computed USD cost. Pricing is from a static table per model (USD per
 * 1M tokens, separate input/output prices) representative of late-2025/2026
 * provider rates. Update PRICING when providers change pricing — historical
 * rows keep the cost they were inserted with.
 *
 * Pattern adopted from RedeAlabama's `whatsapp_llm_helper.php` cost log
 * (line 209-215).
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../utils/database');
const logger = require('../utils/logger');

// USD per 1M tokens. { input, output }. Sources: OpenAI/Anthropic/Groq pricing pages
// as of Q4 2025 / early 2026. Free / cheap models (Groq mixtral, Venice) are 0.
const PRICING = {
  // OpenAI
  'gpt-4o':           { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':      { input: 0.15,  output: 0.60 },
  'gpt-4o-2024-08-06':{ input: 2.50,  output: 10.00 },
  'gpt-4-turbo':      { input: 10.00, output: 30.00 },
  'gpt-3.5-turbo':    { input: 0.50,  output: 1.50 },
  'o1-preview':       { input: 15.00, output: 60.00 },
  'o1-mini':          { input: 3.00,  output: 12.00 },
  // Anthropic
  'claude-3-5-sonnet-20241022':  { input: 3.00,  output: 15.00 },
  'claude-3-5-sonnet-latest':    { input: 3.00,  output: 15.00 },
  'claude-3-opus':               { input: 15.00, output: 75.00 },
  'claude-3-haiku':              { input: 0.25,  output: 1.25 },
  'claude-3-5-haiku-20241022':   { input: 0.80,  output: 4.00 },
  // Groq (mostly free or near-zero on the prompt side)
  'llama-3.3-70b-versatile':     { input: 0.59,  output: 0.79 },
  'llama-3.1-8b-instant':        { input: 0.05,  output: 0.08 },
  'mixtral-8x7b-32768':          { input: 0.24,  output: 0.24 },
  // Google
  'gemini-1.5-pro':              { input: 1.25,  output: 5.00 },
  'gemini-1.5-flash':            { input: 0.075, output: 0.30 },
  'gemini-2.0-flash':            { input: 0.10,  output: 0.40 },
};

const PROVIDER_FALLBACK_PRICE = {
  openai:    { input: 2.50,  output: 10.00 }, // gpt-4o-ish
  anthropic: { input: 3.00,  output: 15.00 },
  groq:      { input: 0.50,  output: 0.80 },
  google:    { input: 0.50,  output: 2.00 },
  venice:    { input: 0.20,  output: 0.50 },
};

function priceFor(provider, model) {
  if (model && PRICING[model]) return PRICING[model];
  // Try prefix match: "gpt-4o-mini-2024-07-18" → "gpt-4o-mini"
  if (model) {
    for (const [name, price] of Object.entries(PRICING)) {
      if (model.startsWith(name)) return price;
    }
  }
  return PROVIDER_FALLBACK_PRICE[provider] || { input: 1.00, output: 2.00 };
}

function computeCostUsd(provider, model, promptTokens, completionTokens) {
  const price = priceFor(provider, model);
  const promptCost = (Number(promptTokens) || 0) * price.input / 1_000_000;
  const completionCost = (Number(completionTokens) || 0) * price.output / 1_000_000;
  return Number((promptCost + completionCost).toFixed(6));
}

/**
 * Log a single LLM completion to llm_cost_log.
 * Fire-and-forget — errors are logged but never thrown so AI request never
 * fails because of a logging error.
 */
function log({
  workspaceId,
  userId,
  requestId,
  provider,
  model,
  promptTokens = 0,
  completionTokens = 0,
  latencyMs = 0,
  httpStatus = 200,
  intent = null,
  chatId = null,
}) {
  try {
    const totalTokens = (Number(promptTokens) || 0) + (Number(completionTokens) || 0);
    const cost = computeCostUsd(provider, model, promptTokens, completionTokens);
    db.run(
      `INSERT INTO llm_cost_log
       (id, workspace_id, user_id, request_id, provider, model,
        prompt_tokens, completion_tokens, total_tokens,
        latency_ms, http_status, cost_usd, intent, chat_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(), workspaceId, userId || null, requestId || null,
        provider, model,
        Number(promptTokens) || 0, Number(completionTokens) || 0, totalTokens,
        Number(latencyMs) || 0, Number(httpStatus) || 200, cost,
        intent || null, chatId || null,
      ]
    );
    return { ok: true, cost, totalTokens };
  } catch (err) {
    logger.warn('[CostLogger] Failed to log row (non-fatal):', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Aggregate spend for a workspace over the last N days.
 * Returns: { totalCostUsd, totalTokens, byProvider, byModel, byDay, requestCount }
 */
function summarize(workspaceId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - Number(days || 30));
  const startIso = startDate.toISOString();

  const totals = db.get(
    `SELECT COUNT(*) AS request_count,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(cost_usd), 0) AS total_cost
     FROM llm_cost_log
     WHERE workspace_id = ? AND created_at >= ?`,
    [workspaceId, startIso]
  ) || {};

  const byProvider = db.all(
    `SELECT provider,
            COUNT(*) AS requests,
            COALESCE(SUM(total_tokens), 0) AS tokens,
            COALESCE(SUM(cost_usd), 0) AS cost_usd,
            COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
     FROM llm_cost_log
     WHERE workspace_id = ? AND created_at >= ?
     GROUP BY provider
     ORDER BY cost_usd DESC`,
    [workspaceId, startIso]
  );

  const byModel = db.all(
    `SELECT model, provider,
            COUNT(*) AS requests,
            COALESCE(SUM(total_tokens), 0) AS tokens,
            COALESCE(SUM(cost_usd), 0) AS cost_usd
     FROM llm_cost_log
     WHERE workspace_id = ? AND created_at >= ?
     GROUP BY model, provider
     ORDER BY cost_usd DESC
     LIMIT 20`,
    [workspaceId, startIso]
  );

  const byDay = db.all(
    `SELECT DATE(created_at) AS day,
            COUNT(*) AS requests,
            COALESCE(SUM(total_tokens), 0) AS tokens,
            COALESCE(SUM(cost_usd), 0) AS cost_usd
     FROM llm_cost_log
     WHERE workspace_id = ? AND created_at >= ?
     GROUP BY day
     ORDER BY day DESC`,
    [workspaceId, startIso]
  );

  return {
    days: Number(days),
    requestCount: Number(totals.request_count) || 0,
    totalTokens: Number(totals.total_tokens) || 0,
    totalCostUsd: Number((totals.total_cost || 0).toFixed(4)),
    byProvider,
    byModel,
    byDay,
  };
}

module.exports = { log, summarize, computeCostUsd, priceFor };
