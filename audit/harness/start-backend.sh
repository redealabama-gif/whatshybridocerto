#!/usr/bin/env bash
# Sobe o backend REAL em modo de teste: SQLite descartável, sem Redis, chaves
# FALSAS e todas as chamadas de IA redirecionadas para o provedor falso.
# Uso (na raiz): bash audit/harness/start-backend.sh <dir-de-trabalho> [porta] [porta-fake]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${1:?dir de trabalho}"
PORT="${2:-3000}"
FAKE_PORT="${3:-18080}"
mkdir -p "$WORK"
export NODE_ENV=development
export PORT="$PORT"
export DB_PATH="$WORK/audit.db"
export REDIS_DISABLED=true
export JWT_SECRET="ci-jwt-key-for-pipeline-runs-not-a-real-key"
export WEBHOOK_SECRET="ci-webhook-key-for-pipeline-runs"
# Chaves FALSAS: só servem para o AIRouter registrar os provedores.
export OPENAI_API_KEY="sk-fake-openai-key-audit-0000000000000000"
export GROQ_API_KEY="gsk_fake_groq_key_audit_000000000000000"
export FAKE_AI_URL="http://127.0.0.1:$FAKE_PORT"
export NODE_OPTIONS="--require $ROOT/audit/harness/redirect-fetch.js"
export LOG_LEVEL="${LOG_LEVEL:-info}"
cd "$ROOT/whatshybrid-backend"
node src/utils/migration-runner.js up > "$WORK/migrate.log" 2>&1 || { echo "migração falhou"; tail -20 "$WORK/migrate.log"; exit 1; }
exec node src/server.js
