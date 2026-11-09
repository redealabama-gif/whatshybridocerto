#!/usr/bin/env bash
# Sobe o backend REAL com as chaves REAIS de IA que o usuário autorizou para o
# diagnóstico. As chaves são lidas de um arquivo FORA do repositório e nunca
# gravadas aqui. SQLite descartável; Redis só com REDIS_URL. As chamadas aos provedores são
# registradas (sem cabeçalhos) por log-fetch.js em <dir>/provider-calls.jsonl.
# Uso (na raiz): bash audit/harness/start-backend-real.sh <dir-de-trabalho> <porta> <arquivo-com-chaves> [server|worker]
# Com REDIS_URL definido, liga a fila (como no docker compose); "worker" sobe o
# ai-worker (consumidor da fila) com o mesmo ambiente, em vez do servidor.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${1:?dir de trabalho}"
PORT="${2:-3000}"
KEYS="${3:?arquivo com OPENAI_API_KEY e/ou GROQ_API_KEY}"
MODE="${4:-server}"
mkdir -p "$WORK"
set -a; . "$KEYS"; set +a
export NODE_ENV=development
export PORT="$PORT"
export DB_PATH="$WORK/real.db"
if [ -n "${REDIS_URL:-}" ]; then export REDIS_DISABLED=false REDIS_URL; else export REDIS_DISABLED=true; fi
export JWT_SECRET="ci-jwt-key-for-pipeline-runs-not-a-real-key"
export WEBHOOK_SECRET="ci-webhook-key-for-pipeline-runs"
export LOG_FETCH_FILE="$WORK/provider-calls.jsonl"
export NODE_OPTIONS="--require $ROOT/audit/harness/log-fetch.js"
# O fetch do Node só usa HTTPS_PROXY com NODE_USE_ENV_PROXY=1 (Node >= 22.21);
# neste ambiente a saída para a internet passa por um proxy com CA próprio.
export NODE_USE_ENV_PROXY=1
if [ -f /root/.ccr/ca-bundle.crt ]; then export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt; fi
export LOG_LEVEL="${LOG_LEVEL:-info}"
cd "$ROOT/whatshybrid-backend"
if [ "$MODE" = "worker" ]; then exec node src/jobs/ai-worker.js; fi
node src/utils/migration-runner.js up > "$WORK/migrate.log" 2>&1 || { echo "migração falhou"; tail -20 "$WORK/migrate.log"; exit 1; }
exec node src/server.js
