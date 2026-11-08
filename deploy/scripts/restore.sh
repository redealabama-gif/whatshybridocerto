#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Vórtex Pro — Restore de backup
# ═══════════════════════════════════════════════════════════════════════════
# Uso:
#   ./deploy/scripts/restore.sh                                     # lista os backups
#   ./deploy/scripts/restore.sh /path/to/backup.tar.gz             # dry-run
#   ./deploy/scripts/restore.sh /path/to/backup.tar.gz --apply     # aplica

set -euo pipefail

BACKUP_FILE="${1:-}"
APPLY="${2:-}"

PROJECT_DIR="${PROJECT_DIR:-/opt/whatshybrid}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"

if [[ -z "$BACKUP_FILE" ]] || [[ ! -f "$BACKUP_FILE" ]]; then
    echo "Uso: $0 <backup.tar.gz> [--apply]"
    echo "  sem --apply: só verifica o backup (dry-run); com --apply: restaura"
    if ls "$BACKUP_DIR"/*.tar.gz > /dev/null 2>&1; then
        echo "Backups disponíveis em $BACKUP_DIR (mais recentes primeiro):"
        ls -t "$BACKUP_DIR"/*.tar.gz | head -10 | sed 's/^/  /'
    fi
    exit 1
fi

if ! command -v sqlite3 > /dev/null 2>&1; then
    echo "❌ sqlite3 não está instalado no host (usado para conferir o backup)."
    echo "   Instale com: apt-get install -y sqlite3"
    exit 1
fi

TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "═══ Restore: $(basename "$BACKUP_FILE") ═══"
[[ "$APPLY" != "--apply" ]] && log "MODO DRY-RUN"

log "1. Verificando integridade..."
tar tzf "$BACKUP_FILE" > /dev/null 2>&1 || { log "❌ tarball corrompido"; exit 1; }

tar xzf "$BACKUP_FILE" -C "$TEMP_DIR"
DB_GZ=$(find "$TEMP_DIR" -name "*.db.gz" | head -1)
[[ -z "$DB_GZ" ]] && { log "❌ DB não encontrado"; exit 1; }

gunzip -t "$DB_GZ" || { log "❌ gzip corrompido"; exit 1; }

gunzip -k "$DB_GZ" -c > "$TEMP_DIR/test_restore.db"
INTEGRITY=$(sqlite3 "$TEMP_DIR/test_restore.db" "PRAGMA integrity_check;" 2>&1)
[[ "$INTEGRITY" != "ok" ]] && { log "❌ integrity_check: $INTEGRITY"; exit 1; }
log "  ✅ DB íntegro"

USER_COUNT=$(sqlite3 "$TEMP_DIR/test_restore.db" "SELECT COUNT(*) FROM users" 2>/dev/null || echo "0")
WS_COUNT=$(sqlite3 "$TEMP_DIR/test_restore.db" "SELECT COUNT(*) FROM workspaces" 2>/dev/null || echo "0")
log "  Conteúdo: $USER_COUNT users, $WS_COUNT workspaces"

if [[ "$APPLY" != "--apply" ]]; then
    log "DRY-RUN OK. Para aplicar: $0 $BACKUP_FILE --apply"
    exit 0
fi

# O banco fica no volume Docker `db_data` (montado em /app/data no backend e
# no ai-worker), NÃO em $PROJECT_DIR/data no host. A troca é feita por um
# container descartável com o mesmo volume (`docker compose run`), com os dois
# serviços parados para ninguém estar com o banco aberto.
cd "$PROJECT_DIR"

log "2. Parando backend e ai-worker..."
docker compose stop backend ai-worker

log "3. Backup de segurança do banco atual..."
mkdir -p "$BACKUP_DIR"
SAFETY="$BACKUP_DIR/before_restore_$(date +%Y%m%d_%H%M%S).db"
# `.backup` do sqlite inclui o que ainda estiver no WAL (cópia consistente).
if docker compose run --rm --no-deps -T --entrypoint sh backend -c '
    [ -f /app/data/whatshybrid.db ] || exit 1
    sqlite3 /app/data/whatshybrid.db ".backup /tmp/safety.db"
    cat /tmp/safety.db' > "$SAFETY"; then
    log "  Salvo em $SAFETY"
else
    rm -f "$SAFETY"
    SAFETY="(não havia banco no volume)"
    log "  $SAFETY"
fi

log "4. Restaurando no volume..."
gunzip -c "$DB_GZ" | docker compose run --rm --no-deps -T --entrypoint sh backend -c '
    set -e
    cd /app/data
    cat > whatshybrid.db.restore
    rm -f whatshybrid.db-wal whatshybrid.db-shm
    mv whatshybrid.db.restore whatshybrid.db'

log "5. Reiniciando backend e ai-worker..."
docker compose start backend ai-worker
HEALTH_OK=false
for _ in $(seq 1 12); do
    if docker compose exec -T backend wget -qO- http://localhost:3000/health > /dev/null 2>&1; then
        HEALTH_OK=true
        break
    fi
    sleep 5
done
if [[ "$HEALTH_OK" == "true" ]]; then
    log "  ✅ Backend respondendo no /health"
else
    log "  ⚠️ Backend não respondeu ao /health em 60s — veja: docker compose logs backend"
fi

log "═══ Restore aplicado ✅ ═══"
log "Safety backup: $SAFETY"
