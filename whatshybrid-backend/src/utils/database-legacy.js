/**
 * Database Utility — better-sqlite3 (síncrono, nativo, sem perda de dados)
 *
 * CORREÇÃO P0: Substituído sql.js (in-memory + 30s flush) por better-sqlite3
 * — Sem janela de 30 segundos de perda de dados
 * — Síncrono: sem race conditions entre saves
 * — WAL mode: leituras concorrentes sem bloquear escritas
 * — Transações reais com BEGIN/COMMIT/ROLLBACK nativo
 * — Schema único: este arquivo é a única fonte de verdade (prisma/schema.prisma removido)
 *
 * ⚠️ ATENÇÃO POSTGRES (v9.3.6):
 *   Este arquivo é SQLite-only. Define 55 tabelas inline que NÃO existem nas migrations
 *   formais em /migrations/. Quando DB_DRIVER=postgres, este arquivo não cria tabelas
 *   (driver diferente). Resultado: 39 tabelas faltam.
 *
 *   Para usar Postgres, é necessário portar este schema pra migrations versionadas.
 *   Não foi feito porque o produto atualmente roda 100% em SQLite e a migração
 *   pra Postgres exige também refactor de ~364 chamadas db.* síncronas pra await
 *   (ver src/utils/db/index.js).
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../../config');
const logger = require('./logger');

let db = null;
let dbPath = null;

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;
PRAGMA cache_size=-32000;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT,
  avatar TEXT,
  phone TEXT,
  role TEXT DEFAULT 'user',
  status TEXT DEFAULT 'active',
  workspace_id TEXT,
  settings TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  settings TEXT DEFAULT '{}',
  plan TEXT DEFAULT 'free',
  credits INTEGER DEFAULT 0,
  max_response_tokens INTEGER DEFAULT 400,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Contacts
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  avatar TEXT,
  tags TEXT DEFAULT '[]',
  labels TEXT DEFAULT '[]',
  custom_fields TEXT DEFAULT '{}',
  source TEXT,
  status TEXT DEFAULT 'active',
  last_contact_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  chat_id TEXT,
  status TEXT DEFAULT 'open',
  assigned_to TEXT,
  tags TEXT DEFAULT '[]',
  metadata TEXT DEFAULT '{}',
  last_message_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id)
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  sender_id TEXT,
  content TEXT,
  message_type TEXT DEFAULT 'text',
  media_url TEXT,
  status TEXT DEFAULT 'sent',
  metadata TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'broadcast',
  status TEXT DEFAULT 'draft',
  template_id TEXT,
  target_contacts TEXT DEFAULT '[]',
  sent_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  read_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  scheduled_at DATETIME,
  started_at DATETIME,
  completed_at DATETIME,
  settings TEXT DEFAULT '{}',
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Templates
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  content TEXT NOT NULL,
  variables TEXT DEFAULT '[]',
  media_url TEXT,
  status TEXT DEFAULT 'active',
  usage_count INTEGER DEFAULT 0,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- CRM Deals
CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  contact_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  value REAL DEFAULT 0,
  currency TEXT DEFAULT 'BRL',
  stage TEXT DEFAULT 'lead',
  probability INTEGER DEFAULT 0,
  expected_close_date DATE,
  assigned_to TEXT,
  tags TEXT DEFAULT '[]',
  custom_fields TEXT DEFAULT '{}',
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id)
);

-- CRM Pipeline Stages
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  position INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'todo',
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'pending',
  due_date DATETIME,
  contact_id TEXT,
  deal_id TEXT,
  assigned_to TEXT,
  completed_at DATETIME,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id),
  FOREIGN KEY (deal_id) REFERENCES deals(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id)
);

-- Labels
CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Analytics Events
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data TEXT DEFAULT '{}',
  user_id TEXT,
  session_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Webhooks
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT DEFAULT '[]',
  headers TEXT DEFAULT '{}',
  status TEXT DEFAULT 'active',
  secret TEXT,
  last_triggered_at DATETIME,
  failure_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Webhook Logs
CREATE TABLE IF NOT EXISTS webhook_logs (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  event_type TEXT,
  request_body TEXT,
  response_status INTEGER,
  response_body TEXT,
  duration_ms INTEGER,
  success INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (webhook_id) REFERENCES webhooks(id)
);

-- AI Conversations (for Copilot)
CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT,
  messages TEXT DEFAULT '[]',
  context TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Knowledge Base
CREATE TABLE IF NOT EXISTS knowledge_base (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  type TEXT DEFAULT 'faq',
  question TEXT,
  answer TEXT,
  content TEXT,
  tags TEXT DEFAULT '[]',
  embedding TEXT,
  usage_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Workspace Knowledge (blob sync)
CREATE TABLE IF NOT EXISTS workspace_knowledge (
  id TEXT PRIMARY KEY,
  workspace_id TEXT UNIQUE NOT NULL,
  data TEXT DEFAULT '{}',
  version INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Training Examples (Few-Shot Learning)
CREATE TABLE IF NOT EXISTS training_examples (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,
  input TEXT NOT NULL,
  output TEXT NOT NULL,
  context TEXT DEFAULT '',
  category TEXT DEFAULT 'Geral',
  tags TEXT DEFAULT '[]',
  usage_count INTEGER DEFAULT 0,
  last_used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Refresh Tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  plan_id TEXT NOT NULL DEFAULT 'free',
  status TEXT DEFAULT 'inactive',
  credits_total INTEGER DEFAULT 0,
  credits_used INTEGER DEFAULT 0,
  payment_id TEXT,
  payment_gateway TEXT,
  activated_at DATETIME,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Credit Transactions
CREATE TABLE IF NOT EXISTS credit_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_code TEXT NOT NULL,
  amount INTEGER NOT NULL,
  type TEXT DEFAULT 'usage',
  description TEXT,
  payment_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subscription_code) REFERENCES subscriptions(code)
);

-- Sync Data
-- Schema alinhado com routes/sync.js (module / last_modified). Antes este
-- bloco usava module_key/version e, como roda antes do sync.js, o
-- CREATE TABLE IF NOT EXISTS do sync.js herdava o schema errado.
CREATE TABLE IF NOT EXISTS sync_data (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  module TEXT NOT NULL,
  data TEXT,
  last_modified INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- System Health
CREATE TABLE IF NOT EXISTS system_health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_name TEXT NOT NULL,
  status TEXT DEFAULT 'unknown',
  last_check DATETIME,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Chat Memories
CREATE TABLE IF NOT EXISTS chat_memories (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  chat_title TEXT,
  phone_number TEXT,
  summary TEXT,
  facts TEXT DEFAULT '[]',
  interactions TEXT DEFAULT '[]',
  context TEXT DEFAULT '{}',
  metrics TEXT DEFAULT '{}',
  version INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(chat_id, workspace_id)
);

-- Products
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  short_description TEXT,
  sku TEXT,
  category TEXT,
  price REAL DEFAULT 0,
  price_original REAL,
  currency TEXT DEFAULT 'BRL',
  stock INTEGER,
  stock_status TEXT DEFAULT 'available',
  specifications TEXT DEFAULT '{}',
  tags TEXT DEFAULT '[]',
  variants TEXT DEFAULT '[]',
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- FAQs
CREATE TABLE IF NOT EXISTS faqs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  keywords TEXT DEFAULT '[]',
  views INTEGER DEFAULT 0,
  helpful INTEGER DEFAULT 0,
  not_helpful INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Scheduled Jobs (persisted between restarts)
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT,
  priority INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  timeout INTEGER DEFAULT 60000,
  next_run_at INTEGER,
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  started_at INTEGER,
  completed_at INTEGER,
  failed_at INTEGER,
  result TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL
);

-- Job Logs
CREATE TABLE IF NOT EXISTS job_logs (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  action TEXT,
  details TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES scheduled_jobs(id)
);

-- Remarketing
CREATE TABLE IF NOT EXISTS remarketing_disparos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  message TEXT,
  status TEXT DEFAULT 'pending',
  sent_at DATETIME,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Campaign Recipients
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  name TEXT,
  status TEXT DEFAULT 'pending',
  sent_at DATETIME,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

-- Reports
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Webhook Queue
CREATE TABLE IF NOT EXISTS webhook_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  sent_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- AI Requests (métricas de tokens por tenant — P2 observabilidade)
CREATE TABLE IF NOT EXISTS ai_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT,
  model TEXT,
  tokens_used INTEGER DEFAULT 0,
  response_time INTEGER DEFAULT 0,
  pipeline_stage TEXT,
  status TEXT DEFAULT 'success',
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- CORREÇÃO P1: Tabelas de aprendizado persistido com namespace por tenant
-- learning_patterns: candidatos e graduados por workspace
CREATE TABLE IF NOT EXISTS learning_patterns (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  pattern_key TEXT NOT NULL,
  intent TEXT NOT NULL,
  question TEXT NOT NULL,
  response TEXT NOT NULL,
  feedback_score REAL DEFAULT 0,
  positive_count INTEGER DEFAULT 0,
  negative_count INTEGER DEFAULT 0,
  total_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'candidate',
  graduated_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, pattern_key),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- strategy_history: histórico de performance por estratégia e tenant
CREATE TABLE IF NOT EXISTS strategy_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  response_goal TEXT,
  client_stage TEXT,
  intent TEXT,
  tone_variant TEXT,
  cta_style TEXT,
  response_length TEXT,
  performance_score REAL,
  outcome_label TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- performance_scores: scores históricos por variável e tenant
CREATE TABLE IF NOT EXISTS performance_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  dimension_value TEXT NOT NULL,
  score REAL NOT NULL,
  components TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- interaction_metadata: metadados de interações para fechar o loop de feedback
-- CORREÇÃO P0: Armazena intent+question+response por interactionId para o recordFeedback funcionar
CREATE TABLE IF NOT EXISTS interaction_metadata (
  interaction_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  question TEXT NOT NULL,
  response TEXT NOT NULL,
  response_goal TEXT,
  client_stage TEXT,
  variant TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contacts_workspace ON contacts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace ON campaigns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_deals_workspace ON deals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_analytics_workspace ON analytics_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_subscriptions_code ON subscriptions(code);
CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_sync_data_user ON sync_data(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_data_key ON sync_data(module_key);
CREATE INDEX IF NOT EXISTS idx_chat_memories_chat ON chat_memories(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_memories_workspace ON chat_memories(workspace_id);
CREATE INDEX IF NOT EXISTS idx_products_workspace ON products(workspace_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_faqs_workspace ON faqs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_faqs_category ON faqs(category);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status ON scheduled_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run ON scheduled_jobs(next_run_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_type ON scheduled_jobs(type);
CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_learning_patterns_workspace ON learning_patterns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_learning_patterns_status ON learning_patterns(status);
CREATE INDEX IF NOT EXISTS idx_strategy_history_workspace ON strategy_history(workspace_id);
CREATE INDEX IF NOT EXISTS idx_performance_scores_workspace ON performance_scores(workspace_id);
CREATE INDEX IF NOT EXISTS idx_interaction_metadata_workspace ON interaction_metadata(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ai_requests_workspace ON ai_requests(workspace_id);

-- v8.0.5 PERF: Índices compostos para queries hot path
-- Cobrem WHERE workspace_id = ? ORDER BY created_at DESC sem table scan
CREATE INDEX IF NOT EXISTS idx_contacts_ws_created ON contacts(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_ws_created ON deals(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at DESC);
-- v9.5.0 BUG #153: idx_jobs_ws_status referenciava workspace_id mas
-- scheduled_jobs não tem essa coluna. CREATE INDEX falhava → SCHEMA exec
-- abortava o resto. Substituído por índice em (status, next_run_at) que
-- é o que JobsRunner.processJobs usa pra buscar próximos jobs.
CREATE INDEX IF NOT EXISTS idx_jobs_status_nextrun ON scheduled_jobs(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_tasks_ws_status_due ON tasks(workspace_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_ai_requests_ws_created ON ai_requests(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_ws_created ON analytics_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_ws_conv ON ai_conversations(workspace_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_faqs_ws_active ON faqs(workspace_id, is_active);
CREATE INDEX IF NOT EXISTS idx_chat_memories_ws_chat ON chat_memories(workspace_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_job_logs_job_created ON job_logs(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interaction_metadata_id ON interaction_metadata(interaction_id);
`;

function initialize() {
  try {
    dbPath = config.database?.path || path.join(process.cwd(), 'data', 'whatshybrid.db');
    const dbDir = path.dirname(dbPath);

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs', { recursive: true });
    }

    // better-sqlite3: síncrono, nativo, WAL mode
    db = new Database(dbPath, { verbose: process.env.NODE_ENV === 'development' ? null : null });

    // Aplicar PRAGMA e schema completo
    db.exec(SCHEMA);

    // ── Migrations idempotentes ─────────────────────────────────────────
    // SQLite não tem ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
    // Detectamos colunas existentes via PRAGMA e adicionamos só as faltantes.
    runMigrations(db);

    logger.info(`[DB] better-sqlite3 inicializado em ${dbPath} (WAL mode)`);
    return db;
  } catch (error) {
    logger.error('[DB] Falha na inicialização:', error);
    throw error;
  }
}

/**
 * Migrations idempotentes para tabelas existentes.
 * Adicione novos blocos aqui quando precisar evoluir o schema sem perder dados.
 */
function runMigrations(db) {
  // v9.4.6 BUG #127: early-return se db é null (caller passou null pra Postgres).
  // database-legacy.js inteiro é SQLite-only (PRAGMA table_info, ALTER TABLE ADD COLUMN
  // sintaxe SQLite, etc). Em Postgres, migrations versionadas em /migrations são usadas.
  // Sem este check, primeiro db.prepare() lança "Cannot read properties of null"
  // — capturado pelo try/catch externo, mas polui logs e foi confuso de debugar.
  if (!db) {
    return; // não-SQLite, skip silencioso
  }

  // ── ai_requests: colunas para cost tracking (v8.1.0) ──
  try {
    const cols = db.prepare("PRAGMA table_info(ai_requests)").all().map(c => c.name);
    
    const newColumns = [
      { name: 'prompt_tokens',     sql: 'ALTER TABLE ai_requests ADD COLUMN prompt_tokens INTEGER DEFAULT 0' },
      { name: 'completion_tokens', sql: 'ALTER TABLE ai_requests ADD COLUMN completion_tokens INTEGER DEFAULT 0' },
      { name: 'latency_ms',        sql: 'ALTER TABLE ai_requests ADD COLUMN latency_ms INTEGER DEFAULT 0' },
      { name: 'error_message',     sql: 'ALTER TABLE ai_requests ADD COLUMN error_message TEXT' },
      { name: 'tenant_user_id',    sql: 'ALTER TABLE ai_requests ADD COLUMN tenant_user_id TEXT' },
      { name: 'request_id',        sql: 'ALTER TABLE ai_requests ADD COLUMN request_id TEXT' },
    ];

    for (const col of newColumns) {
      if (!cols.includes(col.name)) {
        db.exec(col.sql);
        logger.info(`[DB] Migration: added column ai_requests.${col.name}`);
      }
    }
  } catch (err) {
    logger.warn(`[DB] Migration warning (ai_requests): ${err.message}`);
  }

  // ── workspaces: trial e billing (v8.2.0) ──
  try {
    const cols = db.prepare("PRAGMA table_info(workspaces)").all().map(c => c.name);
    
    const newColumns = [
      { name: 'trial_end_at',          sql: 'ALTER TABLE workspaces ADD COLUMN trial_end_at DATETIME' },
      { name: 'subscription_status',   sql: "ALTER TABLE workspaces ADD COLUMN subscription_status TEXT DEFAULT 'trialing'" },
      { name: 'next_billing_at',       sql: 'ALTER TABLE workspaces ADD COLUMN next_billing_at DATETIME' },
      { name: 'payment_provider',      sql: 'ALTER TABLE workspaces ADD COLUMN payment_provider TEXT' },
      { name: 'payment_customer_id',   sql: 'ALTER TABLE workspaces ADD COLUMN payment_customer_id TEXT' },
      // v8.4.0 — recorrência automática
      { name: 'mp_preapproval_id',     sql: 'ALTER TABLE workspaces ADD COLUMN mp_preapproval_id TEXT' },
      { name: 'auto_renew_enabled',    sql: 'ALTER TABLE workspaces ADD COLUMN auto_renew_enabled INTEGER DEFAULT 0' },
    ];

    for (const col of newColumns) {
      if (!cols.includes(col.name)) {
        db.exec(col.sql);
        logger.info(`[DB] Migration: added column workspaces.${col.name}`);
      }
    }
  } catch (err) {
    logger.warn(`[DB] Migration warning (workspaces): ${err.message}`);
  }

  // ── audit_log + feature_flags: governance tables (v9.3.4 — antes só na migration 004) ──
  // Bug que isso resolve: rotas que chamam AuditLogService.log() ou
  // FeatureFlagsService.isEnabled() falhavam silenciosamente em ambientes
  // que nunca rodaram `npm run migrate:up`. Resultado: zero auditoria.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        workspace_id TEXT,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        ip TEXT,
        user_agent TEXT,
        metadata TEXT,
        outcome TEXT DEFAULT 'success',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_log(workspace_id, created_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, created_at DESC)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id TEXT PRIMARY KEY,
        flag_name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        workspace_id TEXT,
        description TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (flag_name, workspace_id)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_feature_flags_name ON feature_flags(flag_name)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_feature_flags_workspace ON feature_flags(workspace_id)`);
  } catch (err) {
    logger.warn(`[DB] Migration warning (audit_log/feature_flags): ${err.message}`);
  }

  // ── login_attempts: rate limit de login (v9.3.4 — antes só na migration 004) ──
  // Bug que isso resolve: sem essa tabela, recordAttempt falha silenciosamente
  // (catch loga warning). Rate limit de login não funciona — brute force passa.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        ip TEXT,
        success INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, created_at DESC)`);
  } catch (err) {
    logger.warn(`[DB] Migration warning (login_attempts): ${err.message}`);
  }

  // v9.5.0 BUG #152: índices UNIQUE pra webhook_inbox/billing_invoices/
  // token_transactions foram movidos PRA DENTRO dos blocos CREATE TABLE
  // logo abaixo. Antes existiam aqui isolados e falhavam silenciosamente
  // na primeira run (tabela ainda não existia) e ficavam pendentes pra 2ª
  // run — quebrando idempotência (211 → 214 objetos diff).

  // ── ai_feedback: tabela pra fechamento do loop de aprendizado (v9.4.0) ──
  // Bug que isso resolve: extensão chamava POST /api/v1/ai/learn/feedback há muito,
  // mas a tabela e a rota nem existiam — feedback do user (rating + correção) sumia
  // em silêncio. Autopilot nunca aprendia com correções, ValidatedLearningPipeline
  // ficava sem base de dados. Agora persiste de fato.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_feedback (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        message_id TEXT,
        user_message TEXT NOT NULL,
        assistant_response TEXT NOT NULL,
        rating REAL,
        corrected_response TEXT,
        feedback_type TEXT DEFAULT 'rating',
        user_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        consumed_by_pipeline INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_ai_feedback_workspace ON ai_feedback(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_ai_feedback_chat ON ai_feedback(workspace_id, chat_id);
      CREATE INDEX IF NOT EXISTS idx_ai_feedback_unconsumed ON ai_feedback(consumed_by_pipeline, created_at)
        WHERE consumed_by_pipeline = 0;
    `);
  } catch (err) {
    logger.warn(`[DB] Migration warning (ai_feedback): ${err.message}`);
  }

  // ── users: 2FA columns (v9.3.3 — antes só na migration 002 formal) ──
  // Se cliente nunca roda npm run migrate:up, 2FA quebra com "no such column".
  try {
    const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    const userMigrations = [
      { name: 'totp_secret',          sql: 'ALTER TABLE users ADD COLUMN totp_secret TEXT' },
      { name: 'totp_enabled',         sql: 'ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0' },
      { name: 'preferred_language',   sql: "ALTER TABLE users ADD COLUMN preferred_language TEXT DEFAULT 'pt-BR'" },
      { name: 'onboarding_completed', sql: 'ALTER TABLE users ADD COLUMN onboarding_completed INTEGER DEFAULT 0' },
    ];
    for (const col of userMigrations) {
      if (!userCols.includes(col.name)) {
        db.exec(col.sql);
        logger.info(`[DB] Migration: added column users.${col.name}`);
      }
    }
  } catch (err) {
    logger.warn(`[DB] Migration warning (users): ${err.message}`);
  }
  // ── contacts.stage: CRM kanban support (v9.3.2) ──
  // Bug que isso resolve: kanban movia contato entre estágios mas /sync ignorava
  // o campo stage porque a coluna não existia. Agora persiste corretamente.
  try {
    const cols = db.prepare("PRAGMA table_info(contacts)").all().map(c => c.name);
    if (!cols.includes('stage')) {
      db.exec("ALTER TABLE contacts ADD COLUMN stage TEXT DEFAULT 'new'");
      db.exec("UPDATE contacts SET stage = 'new' WHERE stage IS NULL");
      db.exec("CREATE INDEX IF NOT EXISTS idx_contacts_stage ON contacts(workspace_id, stage)");
      logger.info('[DB] Migration: added contacts.stage column + index');
    }
  } catch (err) {
    logger.warn(`[DB] Migration warning (contacts.stage): ${err.message}`);
  }

  // ── analytics_telemetry, analytics_daily_metrics, ai_usage_logs, error_logs, admin_settings (v9.3.3) ──
  // Bug que isso resolve: rotas referenciavam essas tabelas mas elas nunca eram criadas.
  // Toda chamada POST /analytics/telemetry, GET /admin/* falhava silenciosamente.
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS analytics_telemetry (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_id TEXT,
        session_id TEXT,
        total_sent INTEGER DEFAULT 0,
        total_failed INTEGER DEFAULT 0,
        total_confirmed INTEGER DEFAULT 0,
        unique_contacts INTEGER DEFAULT 0,
        total_campaigns INTEGER DEFAULT 0,
        data_snapshot TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_analytics_telemetry_ws_date ON analytics_telemetry(workspace_id, created_at DESC)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS analytics_daily_metrics (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        date TEXT NOT NULL,
        messages_sent INTEGER DEFAULT 0,
        messages_failed INTEGER DEFAULT 0,
        messages_confirmed INTEGER DEFAULT 0,
        campaigns_started INTEGER DEFAULT 0,
        ai_requests INTEGER DEFAULT 0,
        ai_tokens INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(workspace_id, date)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_analytics_daily_ws_date ON analytics_daily_metrics(workspace_id, date DESC)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_usage_logs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT,
        user_id TEXT,
        provider TEXT,
        model TEXT,
        tokens_input INTEGER DEFAULT 0,
        tokens_output INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        duration_ms INTEGER,
        status TEXT DEFAULT 'success',
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_usage_ws_date ON ai_usage_logs(workspace_id, created_at DESC)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS error_logs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT,
        user_id TEXT,
        error_type TEXT,
        error_message TEXT,
        stack_trace TEXT,
        context TEXT,
        severity TEXT DEFAULT 'error',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_error_logs_date ON error_logs(created_at DESC)`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS admin_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT
      )
    `);
  } catch (err) {
    logger.warn(`[DB] Migration warning (analytics tables): ${err.message}`);
  }

  // ── api_keys: tabela nova para chaves de API por tenant (v8.2.0) ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_id TEXT,
        name TEXT,
        key_hash TEXT NOT NULL,
        key_preview TEXT,
        last_used_at DATETIME,
        revoked_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    `);
  } catch (err) {
    logger.warn(`[DB] Migration warning (api_keys): ${err.message}`);
  }

  // ── billing_intents: rastreia tentativas de pagamento iniciadas (v8.3.0) ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS billing_intents (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        plan TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_ref TEXT,
        status TEXT DEFAULT 'pending',
        amount REAL,
        currency TEXT DEFAULT 'BRL',
        metadata TEXT DEFAULT '{}',
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
      );
      CREATE INDEX IF NOT EXISTS idx_billing_intents_workspace ON billing_intents(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_billing_intents_provider_ref ON billing_intents(provider, provider_ref);
    `);
  } catch (err) {
    logger.warn(`[DB] Migration warning (billing_intents): ${err.message}`);
  }

  // ── billing_invoices: histórico de pagamentos confirmados (v8.3.0) ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS billing_invoices (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        intent_id TEXT,
        plan TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_ref TEXT,
        status TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'BRL',
        period_start DATETIME,
        period_end DATETIME,
        paid_at DATETIME,
        failed_reason TEXT,
        retry_count INTEGER DEFAULT 0,
        next_retry_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
      );
      CREATE INDEX IF NOT EXISTS idx_billing_invoices_workspace ON billing_invoices(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_billing_invoices_status ON billing_invoices(status);
      CREATE INDEX IF NOT EXISTS idx_billing_invoices_provider_ref ON billing_invoices(provider, provider_ref);
      -- v9.3.9 / v9.5.0 BUG #152: UNIQUE pra idempotência cross-driver.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_invoices_unique_provider_ref
        ON billing_invoices(provider, provider_ref)
        WHERE provider_ref IS NOT NULL;
    `);
  } catch (err) {
    logger.warn(`[DB] Migration warning (billing_invoices): ${err.message}`);
  }

  // ── workspace_credits: saldo de tokens por workspace (v8.4.0) ──
  // Modelo SaaS B2B (separado de subscriptions/credit_transactions, que é B2C legado)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_credits (
        workspace_id TEXT PRIMARY KEY,
        tokens_total INTEGER NOT NULL DEFAULT 0,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        last_topup_at DATETIME,
        last_used_at DATETIME,
        low_balance_warned_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
      );
    `);
  } catch (err) {
    logger.warn(`[DB] Migration warning (workspace_credits): ${err.message}`);
  }

  // ── v9.4.6: Consolidação de workspaces.credits LEGACY → workspace_credits ──
  // workspaces.credits foi removido do código. Antes de dropar a coluna (v10),
  // garantimos que clientes que tinham saldo lá não percam tokens.
  // Migration idempotente: só roda 1x por workspace (verifica se já existe row).
  try {
    // Detecta se a coluna ainda existe
    const cols = db.prepare("PRAGMA table_info(workspaces)").all().map(c => c.name);
    if (cols.includes('credits')) {
      // v9.5.0 BUG #151: db.all(sql) é API do wrapper async; aqui `db` é raw
      // better-sqlite3 (recebido via runMigrations(getDb())). Use prepare().all().
      const candidates = db.prepare(`
        SELECT w.id, w.credits
        FROM workspaces w
        LEFT JOIN workspace_credits wc ON wc.workspace_id = w.id
        WHERE w.credits > 0 AND wc.workspace_id IS NULL
      `).all();
      let migrated = 0;
      const insertCredits = db.prepare(
        `INSERT INTO workspace_credits (workspace_id, tokens_total, tokens_used, last_topup_at)
         VALUES (?, ?, 0, CURRENT_TIMESTAMP)`
      );
      const insertTxn = db.prepare(
        `INSERT INTO token_transactions
         (id, workspace_id, type, amount, balance_after, description, metadata, created_at)
         VALUES (?, ?, 'adjustment', ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      );
      const { v4: uuidv4 } = require('./uuid-wrapper');
      for (const ws of candidates) {
        try {
          insertCredits.run(ws.id, ws.credits);
          insertTxn.run(
            uuidv4(), ws.id, ws.credits, ws.credits,
            'v9.4.6 migration: consolidated workspaces.credits → workspace_credits',
            JSON.stringify({ migration: 'v9.4.6_credits_consolidation', original_value: ws.credits })
          );
          migrated++;
        } catch (e) {
          logger.warn(`[DB] credits migration skip ws=${ws.id}: ${e.message}`);
        }
      }
      if (migrated > 0) {
        logger.info(`[DB] v9.4.6: migrated ${migrated} workspaces.credits → workspace_credits`);
      }
    }
  } catch (err) {
    logger.warn(`[DB] Migration warning (credits consolidation): ${err.message}`);
  }

  // ── v9.4.6: Limpeza de aiKeys legacy em workspaces.settings ──
  // Backend-Only AI desde v9.4.0. Cliente nunca configurou key, mas se houver
  // valor antigo salvo, removemos pra não vazar via /workspace endpoint.
  try {
    // v9.5.0 BUG #151: idem credits — db é raw better-sqlite3.
    const stale = db.prepare(`
      SELECT id FROM workspaces WHERE settings LIKE '%aiKeys%'
    `).all();
    let cleaned = 0;
    const getSettings = db.prepare('SELECT settings FROM workspaces WHERE id = ?');
    const updateSettings = db.prepare('UPDATE workspaces SET settings = ? WHERE id = ?');
    for (const ws of stale) {
      try {
        const row = getSettings.get(ws.id);
        const s = JSON.parse(row?.settings || '{}');
        if (s.aiKeys) {
          delete s.aiKeys;
          updateSettings.run(JSON.stringify(s), ws.id);
          cleaned++;
        }
      } catch (_) {}
    }
    if (cleaned > 0) {
      logger.info(`[DB] v9.4.6: cleaned aiKeys from ${cleaned} workspaces`);
    }
  } catch (err) {
    logger.warn(`[DB] Migration warning (aiKeys cleanup): ${err.message}`);
  }
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS token_transactions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        type TEXT NOT NULL,                    -- 'topup' | 'consume' | 'plan_grant' | 'refund' | 'adjustment'
        amount INTEGER NOT NULL,                -- positivo = adiciona, negativo = consome
        balance_after INTEGER NOT NULL,
        ai_request_id TEXT,                     -- FK opcional pra ai_requests
        invoice_id TEXT,                        -- FK opcional pra billing_invoices
        model TEXT,                             -- gpt-4o, claude-3.5, etc
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        description TEXT,
        metadata TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
      );
      CREATE INDEX IF NOT EXISTS idx_token_tx_workspace ON token_transactions(workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_token_tx_type ON token_transactions(type);
      -- v9.4.3 BUG #110: idempotência por ai_request_id.
      -- Sem isso, conexão cai entre debit e response → cliente retry → cobra 2x.
      -- Index parcial só pra type='consume' com ai_request_id NOT NULL.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_token_tx_idem
        ON token_transactions(workspace_id, ai_request_id)
        WHERE type = 'consume' AND ai_request_id IS NOT NULL;
      -- v9.3.9 / v9.5.0 BUG #152: UNIQUE pra idempotência por invoice (defense em camada DB).
      CREATE UNIQUE INDEX IF NOT EXISTS idx_token_transactions_unique_invoice
        ON token_transactions(workspace_id, invoice_id, type)
        WHERE invoice_id IS NOT NULL;
    `);
  } catch (err) {
    logger.warn(`[DB] Migration warning (token_transactions): ${err.message}`);
  }

  // ── v8.5.0: refresh_tokens.token_hash (rotação segura — armazena SHA-256) ──
  try {
    const cols = db.prepare("PRAGMA table_info(refresh_tokens)").all().map(c => c.name);
    if (!cols.includes('token_hash')) {
      db.exec(`ALTER TABLE refresh_tokens ADD COLUMN token_hash TEXT`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash)`);
      logger.info('[DB] Migration: added token_hash to refresh_tokens');
    }
  } catch (err) {
    logger.warn(`[DB] Migration warning (refresh_tokens.token_hash): ${err.message}`);
  }

  // ── v8.5.0: password_reset_tokens — para fluxo de recuperação de senha ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL,
        used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_pwd_reset_tokens_hash ON password_reset_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_pwd_reset_tokens_user ON password_reset_tokens(user_id, expires_at);
    `);
  } catch (err) {
    logger.warn(`[DB] Migration warning (password_reset_tokens): ${err.message}`);
  }

  // ── v8.5.0: webhook_inbox — outbox/inbox pattern para webhooks de pagamento ──
  // Garante idempotência e replay seguro caso o backend caia durante processamento
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_inbox (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        event_type TEXT,
        provider_event_id TEXT,
        signature TEXT,
        raw_payload TEXT NOT NULL,
        status TEXT DEFAULT 'received',
        attempts INTEGER DEFAULT 0,
        last_error TEXT,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_inbox_status ON webhook_inbox(status, received_at);
      CREATE INDEX IF NOT EXISTS idx_webhook_inbox_provider_event ON webhook_inbox(provider, provider_event_id);
      -- v9.3.4 / v9.5.0 BUG #152: UNIQUE pra impedir cobrança duplicada via replay de MP.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_inbox_unique_event
        ON webhook_inbox(provider, provider_event_id)
        WHERE provider_event_id IS NOT NULL;
    `);
  } catch (err) {
    logger.warn(`[DB] Migration warning (webhook_inbox): ${err.message}`);
  }

  // ── v8.5.0: email_outbox — DLQ para emails que falharam ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS email_outbox (
        id TEXT PRIMARY KEY,
        to_address TEXT NOT NULL,
        subject TEXT NOT NULL,
        html TEXT NOT NULL,
        text TEXT,
        status TEXT DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        last_error TEXT,
        next_retry_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        sent_at DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status, next_retry_at);
    `);
  } catch (err) {
    logger.warn(`[DB] Migration warning (email_outbox): ${err.message}`);
  }

  // ── v8.5.0: extension_telemetry — telemetria de falhas da extensão ──
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS extension_telemetry (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        error TEXT,
        stack TEXT,
        user_agent TEXT,
        wa_version TEXT,
        ip TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_ext_telemetry_event ON extension_telemetry(event_type, created_at DESC);
    `);
  } catch (err) {
    logger.warn(`[DB] Migration warning (extension_telemetry): ${err.message}`);
  }

  // ── v8.5.0: workspace_settings — config key/value por workspace ──
  // Usado para custom prompts de IA, preferências, etc
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_settings (
        workspace_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (workspace_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_ws_settings_ws ON workspace_settings(workspace_id);
    `);
  } catch (err) {
    logger.warn(`[DB] Migration warning (workspace_settings): ${err.message}`);
  }
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initialize() first.');
  return db;
}

function close() {
  if (db) {
    db.close();
    db = null;
    logger.info('[DB] Conexão encerrada');
  }
}

// ── Query helpers com API compatível com o código existente ──────────────────

function run(sql, params = []) {
  try {
    const stmt = getDb().prepare(sql);
    const result = stmt.run(Array.isArray(params) ? params : Object.values(params));
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  } catch (error) {
    logger.error('[DB] run error:', error.message, '| SQL:', sql.substring(0, 200));
    throw error;
  }
}

function get(sql, params = []) {
  try {
    const stmt = getDb().prepare(sql);
    return stmt.get(Array.isArray(params) ? params : Object.values(params));
  } catch (error) {
    logger.error('[DB] get error:', error.message);
    throw error;
  }
}

function all(sql, params = []) {
  try {
    const stmt = getDb().prepare(sql);
    return stmt.all(Array.isArray(params) ? params : Object.values(params));
  } catch (error) {
    logger.error('[DB] all error:', error.message);
    throw error;
  }
}

/**
 * Transação real com better-sqlite3.
 * better-sqlite3 transactions são síncronas e atômicas — sem janela de perda de dados.
 */
function transaction(fn) {
  return getDb().transaction(fn)();
}

function runMultiple(queries) {
  return transaction(() => {
    return queries.map(({ sql, params }) => {
      try {
        const stmt = getDb().prepare(sql);
        const result = stmt.run(params || []);
        return { success: true, changes: result.changes };
      } catch (error) {
        logger.error('[DB] runMultiple query error:', error.message);
        return { success: false, error: error.message };
      }
    });
  });
}

function exec(fn) {
  return fn();
}

// Compatibilidade com código que chama saveDatabase()
function saveDatabase() {
  // No-op: better-sqlite3 persiste em disco imediatamente em cada write (WAL mode)
  // Não há flush manual necessário
}

module.exports = {
  initialize,
  getDb,
  close,
  run,
  get,
  all,
  transaction,
  exec,
  runMultiple,
  saveDatabase, // no-op para compatibilidade
  runMigrations,
  SCHEMA, // v9.5.0 BUG #148: exposto pra wrapper aplicar em runMigrations()
};
