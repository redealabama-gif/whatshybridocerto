#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# WhatsHybrid Pro — Restore de backup
# ═══════════════════════════════════════════════════════════════════════════
# Uso:
#   ./deploy/scripts/restore.sh /path/to/backup.tar.gz             # dry-run
#   ./deploy/scripts/restore.sh /path/to/backup.tar.gz --apply     # aplica

set -euo pipefail

BACKUP_FILE="${1:-}"
APPLY="${2:-}"

if [[ -z "$BACKUP_FILE" ]] || [[ ! -f "$BACKUP_FILE" ]]; then
    echo "Uso: $0 <backup.tar.gz> [--apply]"
    exit 1
fi

PROJECT_DIR="${PROJECT_DIR:-/opt/whatshybrid}"
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

log "2. Parando backend..."
cd "$PROJECT_DIR"
docker compose stop backend

log "3. Backup do DB atual..."
mkdir -p "$PROJECT_DIR/backups"
SAFETY="$PROJECT_DIR/backups/before_restore_$(date +%Y%m%d_%H%M%S).db"
cp "$PROJECT_DIR/data/whatshybrid.db" "$SAFETY" 2>/dev/null || log "  (sem DB atual)"

log "4. Restaurando..."
gunzip -k "$DB_GZ" -c > "$PROJECT_DIR/data/whatshybrid.db"

log "5. Reiniciando..."
docker compose start backend
sleep 5
curl -sf http://localhost:3000/health > /dev/null && log "  ✅ Up" || log "  ⚠️ Health check failed"

log "═══ Restore aplicado ✅ ═══"
log "Safety backup: $SAFETY"
