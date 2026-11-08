#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Vórtex Pro — Health check operacional
# ═══════════════════════════════════════════════════════════════════════════
#
# Verifica TUDO o que precisa estar saudável em produção:
#   1. Containers rodando
#   2. Backend respondendo no /health
#   3. Banco SQLite acessível e com tabelas
#   4. Redis respondendo
#   5. Caddy roteando corretamente
#   6. TLS válido e não próximo de expirar
#   7. Espaço em disco suficiente
#   8. Memória disponível
#   9. Backups recentes
#
# Uso:
#   ./deploy/scripts/health.sh
#
# Exit code:
#   0 = tudo OK
#   1 = warnings (sistema funciona mas precisa atenção)
#   2 = errors críticos

set -uo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_ok()    { echo -e "  ${GREEN}✓${NC} $*"; }
log_warn()  { echo -e "  ${YELLOW}!${NC} $*"; ((WARN_COUNT++)) || true; }
log_err()   { echo -e "  ${RED}✗${NC} $*"; ((ERR_COUNT++)) || true; }

WARN_COUNT=0
ERR_COUNT=0

# ── Ir para a raiz do projeto ────────────────────────────────────────────
# O `docker compose` e o .env dependem da pasta atual. Sem este cd, rodar o
# script pelo cron (como o DEPLOY.md sugere) ou de outra pasta fazia todas as
# checagens falharem — falso alarme a cada execução.
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$PROJECT_DIR" || { echo "Não consegui entrar em $PROJECT_DIR"; exit 2; }

# ── Carregar .env ────────────────────────────────────────────────────────
if [[ -f .env ]]; then
    set -a
    source .env
    set +a
fi

DOMAIN="${DOMAIN:-localhost}"

echo
echo "═════════════════════════════════════════════════════════════════"
echo " HEALTH CHECK — $(date '+%Y-%m-%d %H:%M:%S')"
echo "═════════════════════════════════════════════════════════════════"
echo

# ── 1. Containers rodando ────────────────────────────────────────────────
echo "[1] Containers Docker:"
EXPECTED_SERVICES=("caddy" "backend" "ai-worker" "redis")
for svc in "${EXPECTED_SERVICES[@]}"; do
    # Template Go em vez de `--format json | jq '.[0]'`: o compose atual imprime
    # um objeto JSON por linha (não uma lista) e o jq antigo quebrava.
    STATUS=$(docker compose ps "$svc" --format '{{.State}}' 2>/dev/null | head -1)
    STATUS="${STATUS:-missing}"
    if [[ "$STATUS" == "running" ]]; then
        HEALTH=$(docker compose ps "$svc" --format '{{.Health}}' 2>/dev/null | head -1)
        HEALTH="${HEALTH:-no-healthcheck}"
        if [[ "$HEALTH" == "healthy" || "$HEALTH" == "no-healthcheck" ]]; then
            log_ok "$svc: $STATUS"
        else
            log_warn "$svc: $STATUS (health: $HEALTH)"
        fi
    else
        log_err "$svc: $STATUS"
    fi
done
echo

# ── 2. Backend /health ───────────────────────────────────────────────────
echo "[2] Backend HTTP:"
if RESPONSE=$(docker compose exec -T backend wget -qO- http://localhost:3000/health 2>/dev/null); then
    log_ok "Backend respondendo"
    if echo "$RESPONSE" | jq -e '.status' > /dev/null 2>&1; then
        STATUS=$(echo "$RESPONSE" | jq -r '.status')
        UPTIME=$(echo "$RESPONSE" | jq -r '.uptime // "?"')
        log_ok "Status: $STATUS, uptime: ${UPTIME}s"
    fi
else
    log_err "Backend não responde em /health"
fi
echo

# ── 3. Banco SQLite ──────────────────────────────────────────────────────
echo "[3] Banco SQLite:"
DB_SIZE=$(docker compose exec -T backend sh -c \
    '[ -f /app/data/whatshybrid.db ] && stat -c%s /app/data/whatshybrid.db || echo missing' \
    2>/dev/null | tr -d '\r\n')
# SQL com aspas simples (string literal). Antes era type="table" (aspas
# duplas = identificador), que o CLI do sqlite pode recusar.
TABLES=""
if [[ -n "$DB_SIZE" && "$DB_SIZE" != "missing" ]]; then
    TABLES=$(docker compose exec -T backend sqlite3 /app/data/whatshybrid.db \
        "SELECT count(*) FROM sqlite_master WHERE type='table'" 2>/dev/null | tr -d '\r\n')
fi

if [[ "$DB_SIZE" == "missing" ]]; then
    log_err "Banco não encontrado em /app/data/whatshybrid.db"
elif [[ -z "$DB_SIZE" || -z "$TABLES" ]]; then
    log_err "Erro ao consultar banco"
else
    log_ok "Banco: $(numfmt --to=iec --suffix=B "$DB_SIZE"), $TABLES tabelas"

    # Verificar tabelas críticas
    REQUIRED_TABLES=("users" "workspaces" "ai_conversations" "interaction_metadata" "learning_patterns")
    for t in "${REQUIRED_TABLES[@]}"; do
        EXISTS=$(docker compose exec -T backend sqlite3 /app/data/whatshybrid.db \
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='$t'" 2>/dev/null | tr -d '\r\n')
        if [[ "$EXISTS" == "1" ]]; then
            log_ok "Tabela '$t' existe"
        else
            log_err "Tabela '$t' não existe"
        fi
    done
fi
echo

# ── 4. Redis ─────────────────────────────────────────────────────────────
echo "[4] Redis:"
if docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
    KEYS=$(docker compose exec -T redis redis-cli DBSIZE 2>/dev/null | awk '{print $NF}' | tr -d '\r\n')
    USED=$(docker compose exec -T redis redis-cli INFO memory 2>/dev/null | grep "used_memory_human" | cut -d: -f2 | tr -d '\r\n')
    log_ok "Redis: PONG, $KEYS keys, ${USED:-?} usado"
else
    log_err "Redis não responde"
fi
echo

# ── 5. Caddy + TLS ───────────────────────────────────────────────────────
echo "[5] Caddy + TLS:"
if [[ "$DOMAIN" != "localhost" ]]; then
    if curl -fsSL --max-time 10 "https://$DOMAIN/health" > /dev/null 2>&1; then
        log_ok "HTTPS público respondendo: https://$DOMAIN/health"

        # Cert expiry
        EXPIRY=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null \
                | openssl x509 -noout -enddate 2>/dev/null \
                | cut -d= -f2)
        if [[ -n "$EXPIRY" ]]; then
            EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s 2>/dev/null || echo 0)
            NOW_EPOCH=$(date +%s)
            DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

            if [[ $DAYS_LEFT -gt 30 ]]; then
                log_ok "TLS válido por mais $DAYS_LEFT dias"
            elif [[ $DAYS_LEFT -gt 7 ]]; then
                log_warn "TLS expira em $DAYS_LEFT dias (Caddy renova automaticamente)"
            else
                log_err "TLS expira em $DAYS_LEFT dias!"
            fi
        fi
    else
        log_err "HTTPS não respondendo. Verifique DNS, firewall, e Caddy logs"
    fi
else
    log_warn "DOMAIN não configurado (usando localhost)"
fi
echo

# ── 6. Disco ─────────────────────────────────────────────────────────────
echo "[6] Espaço em disco:"
DISK_USED=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
DISK_AVAIL=$(df -h / | awk 'NR==2 {print $4}')
if [[ $DISK_USED -lt 80 ]]; then
    log_ok "Disco / : $DISK_USED% usado, $DISK_AVAIL livre"
elif [[ $DISK_USED -lt 90 ]]; then
    log_warn "Disco / : $DISK_USED% usado — começando a apertar"
else
    log_err "Disco / : $DISK_USED% — CRÍTICO"
fi

# Volume Docker
# O `docker system df --format json` imprime um objeto por linha e o tipo é
# "Local Volumes" — o filtro antigo (lista + "Volumes") nunca casava.
DOCKER_USED=$(docker system df --format json 2>/dev/null \
    | jq -r '(if type == "array" then .[] else . end) | select(.Type | test("Volumes")) | .Size' 2>/dev/null | head -1)
[[ -n "$DOCKER_USED" ]] && log_ok "Volumes Docker: $DOCKER_USED"
echo

# ── 7. Memória ───────────────────────────────────────────────────────────
echo "[7] Memória:"
MEM_INFO=$(free -m | awk 'NR==2 {print $3"|"$2"|"$7}')
USED=$(echo "$MEM_INFO" | cut -d'|' -f1)
TOTAL=$(echo "$MEM_INFO" | cut -d'|' -f2)
AVAIL=$(echo "$MEM_INFO" | cut -d'|' -f3)
PERCENT=$((USED * 100 / TOTAL))

if [[ $PERCENT -lt 80 ]]; then
    log_ok "RAM: ${USED}MB/${TOTAL}MB (${PERCENT}%), ${AVAIL}MB livre"
elif [[ $PERCENT -lt 90 ]]; then
    log_warn "RAM: ${USED}MB/${TOTAL}MB (${PERCENT}%) — apertado"
else
    log_err "RAM: ${USED}MB/${TOTAL}MB (${PERCENT}%) — CRÍTICO"
fi
echo

# ── 8. Backups ───────────────────────────────────────────────────────────
echo "[8] Backups:"
BACKUP_DIR="${BACKUP_DIR:-/opt/whatshybrid/backups}"
if [[ -d "$BACKUP_DIR" ]]; then
    LATEST=$(ls -t "$BACKUP_DIR"/*.tar.gz 2>/dev/null | head -1)
    if [[ -n "$LATEST" ]]; then
        AGE_HOURS=$(( ($(date +%s) - $(stat -c%Y "$LATEST")) / 3600 ))
        SIZE=$(stat -c%s "$LATEST")
        if [[ $AGE_HOURS -lt 26 ]]; then
            log_ok "Último backup: ${AGE_HOURS}h atrás ($(numfmt --to=iec --suffix=B "$SIZE"))"
        else
            log_warn "Último backup: ${AGE_HOURS}h atrás — pode estar atrasado"
        fi

        TOTAL_BACKUPS=$(ls "$BACKUP_DIR"/*.tar.gz 2>/dev/null | wc -l)
        log_ok "Total de backups: $TOTAL_BACKUPS"
    else
        log_warn "Nenhum backup encontrado em $BACKUP_DIR"
    fi
else
    log_warn "Diretório de backup não existe: $BACKUP_DIR"
fi
echo

# ── Resumo final ─────────────────────────────────────────────────────────
echo "═════════════════════════════════════════════════════════════════"
if [[ $ERR_COUNT -eq 0 && $WARN_COUNT -eq 0 ]]; then
    echo -e "${GREEN} ✓ Todos os checks passaram${NC}"
    exit 0
elif [[ $ERR_COUNT -eq 0 ]]; then
    echo -e "${YELLOW} ! $WARN_COUNT warning(s) — sistema funciona mas verifique${NC}"
    exit 1
else
    echo -e "${RED} ✗ $ERR_COUNT erro(s) crítico(s) + $WARN_COUNT warning(s)${NC}"
    exit 2
fi
