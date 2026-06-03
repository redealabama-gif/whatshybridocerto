#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# WhatsHybrid Pro — Backup do SQLite + logs
# ═══════════════════════════════════════════════════════════════════════════
#
# Faz backup atômico do SQLite usando o comando .backup do próprio sqlite,
# que é seguro em DB ativo (snapshot consistente sem locking).
#
# Política de retenção (ajuste se necessário):
#   - Diários: últimos 7 dias
#   - Semanais (domingo): últimas 4 semanas
#   - Mensais (dia 1): últimos 6 meses
#
# Uso:
#   ./deploy/scripts/backup.sh                    # backup automático
#   ./deploy/scripts/backup.sh "label-custom"     # backup com label
#
# Agendamento (já configurado pelo install.sh):
#   0 3 * * * cd /opt/whatshybrid && ./deploy/scripts/backup.sh

set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/opt/whatshybrid/backups}"
PROJECT_DIR="${PROJECT_DIR:-/opt/whatshybrid}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LABEL="${1:-auto}"
BACKUP_NAME="backup_${TIMESTAMP}_${LABEL}"

# ── Logs ─────────────────────────────────────────────────────────────────
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "═══ Backup iniciado: $BACKUP_NAME ═══"

# ── Preparação ───────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
cd "$PROJECT_DIR"

if ! docker compose ps backend --format json | jq -e '.[0]' > /dev/null 2>&1; then
    log "ERRO: container 'backend' não está rodando. Backup abortado."
    exit 1
fi

# ── 1. Backup SQLite (snapshot atômico) ─────────────────────────────────
log "Snapshot SQLite..."

# .backup do sqlite é atômico e seguro em DB ativo
docker compose exec -T backend sh -c '
    cd /app/data
    if [ -f whatshybrid.db ]; then
        # SQLite .backup command — atomic, safe with WAL
        sqlite3 whatshybrid.db ".backup /tmp/wh_backup.db"
        gzip -9 /tmp/wh_backup.db
        cat /tmp/wh_backup.db.gz
        rm /tmp/wh_backup.db.gz
    else
        echo "ERROR: whatshybrid.db não encontrado em /app/data" >&2
        exit 1
    fi
' > "$BACKUP_DIR/${BACKUP_NAME}.db.gz"

# Verifica que o backup tem tamanho razoável (>1KB)
DB_SIZE=$(stat -c%s "$BACKUP_DIR/${BACKUP_NAME}.db.gz")
if [[ $DB_SIZE -lt 1024 ]]; then
    log "ERRO: backup do banco com apenas $DB_SIZE bytes — provavelmente falhou"
    rm -f "$BACKUP_DIR/${BACKUP_NAME}.db.gz"
    exit 1
fi
log "  Banco: $(numfmt --to=iec --suffix=B $DB_SIZE)"

# ── 2. Backup do .env (sem as senhas, só estrutura) ─────────────────────
# Útil para reconstruir config se VPS for perdido
if [[ -f .env ]]; then
    # Cria versão sanitizada do .env (sem valores sensíveis)
    grep -v -E '^(JWT_SECRET|.*_API_KEY|.*_SECRET|.*_TOKEN|.*_PASSWORD)=' .env > "$BACKUP_DIR/${BACKUP_NAME}.env.template" || true
    log "  .env structure: $(stat -c%s "$BACKUP_DIR/${BACKUP_NAME}.env.template") bytes"
fi

# ── 3. Backup dos arquivos de memória de IA (se existirem) ──────────────
# /app/data inclui /app/data/memory/{tenant}/ com JSON de conversas
log "Snapshot de memória de IA..."
docker compose exec -T backend sh -c '
    cd /app/data
    if [ -d memory ]; then
        tar czf - memory 2>/dev/null
    else
        echo "" | gzip
    fi
' > "$BACKUP_DIR/${BACKUP_NAME}.memory.tar.gz"

MEM_SIZE=$(stat -c%s "$BACKUP_DIR/${BACKUP_NAME}.memory.tar.gz")
log "  Memória: $(numfmt --to=iec --suffix=B $MEM_SIZE)"

# ── 4. Empacotamento final ──────────────────────────────────────────────
cd "$BACKUP_DIR"
FINAL_NAME="${BACKUP_NAME}.tar.gz"
tar czf "$FINAL_NAME" "${BACKUP_NAME}".*
rm -f "${BACKUP_NAME}".db.gz "${BACKUP_NAME}".memory.tar.gz "${BACKUP_NAME}".env.template 2>/dev/null

FINAL_SIZE=$(stat -c%s "$FINAL_NAME")
log "Backup final: $FINAL_NAME ($(numfmt --to=iec --suffix=B $FINAL_SIZE))"

# ── 5b. v8.5.0: VERIFICAÇÃO DE INTEGRIDADE ───────────────────────────────
# Faz restore em /tmp e roda integrity check
log "Verificando integridade do backup..."

VERIFY_DIR=$(mktemp -d)
trap "rm -rf $VERIFY_DIR" EXIT

if tar tzf "$FINAL_NAME" > /dev/null 2>&1; then
    log "  ✅ Tarball está íntegro"
else
    log "  ❌ Tarball corrompido!"
    exit 1
fi

# Extrai DB e verifica
tar xzf "$FINAL_NAME" -C "$VERIFY_DIR" 2>/dev/null
DB_GZ=$(find "$VERIFY_DIR" -name "*.db.gz" | head -1)

if [[ -z "$DB_GZ" ]]; then
    log "  ❌ DB não encontrado no backup"
    exit 1
fi

gunzip -t "$DB_GZ" 2>/dev/null && log "  ✅ Gzip do DB íntegro" || {
    log "  ❌ Gzip do DB corrompido"
    exit 1
}

# Restore para temp e verifica integrity_check
gunzip -k "$DB_GZ" -c > "$VERIFY_DIR/restored.db"
INTEGRITY=$(sqlite3 "$VERIFY_DIR/restored.db" "PRAGMA integrity_check;" 2>/dev/null || echo "FAILED")

if [[ "$INTEGRITY" != "ok" ]]; then
    log "  ❌ DB restaurado falhou integrity_check: $INTEGRITY"
    exit 1
fi
log "  ✅ DB restaurado: integrity_check OK"

# Verifica que tabelas críticas existem
TABLES=$(sqlite3 "$VERIFY_DIR/restored.db" "SELECT name FROM sqlite_master WHERE type='table'" 2>/dev/null)
for required in users workspaces refresh_tokens billing_invoices; do
    if echo "$TABLES" | grep -qE "^${required}$"; then
        log "  ✅ Tabela $required presente"
    else
        log "  ⚠️  Tabela $required AUSENTE!"
    fi
done

# Conta registros chave
USER_COUNT=$(sqlite3 "$VERIFY_DIR/restored.db" "SELECT COUNT(*) FROM users" 2>/dev/null || echo "0")
WS_COUNT=$(sqlite3 "$VERIFY_DIR/restored.db" "SELECT COUNT(*) FROM workspaces" 2>/dev/null || echo "0")
log "  Registros: $USER_COUNT users, $WS_COUNT workspaces"

# Cleanup
rm -rf "$VERIFY_DIR"
trap - EXIT

log "═══ Verificação de integridade: ✅ OK ═══"


# ── 5. Retenção: limpa backups antigos ──────────────────────────────────
log "Aplicando política de retenção..."

# Diários: manter últimos 7 dias
find . -maxdepth 1 -name 'backup_*_auto.tar.gz' -mtime +7 -delete 2>/dev/null && \
    log "  Diários antigos (>7d): removidos"

# Semanais (label 'weekly'): manter 4 semanas
find . -maxdepth 1 -name 'backup_*_weekly.tar.gz' -mtime +28 -delete 2>/dev/null && \
    log "  Semanais antigos (>28d): removidos"

# Mensais: manter 6 meses
find . -maxdepth 1 -name 'backup_*_monthly.tar.gz' -mtime +180 -delete 2>/dev/null && \
    log "  Mensais antigos (>180d): removidos"

# Lista backups disponíveis
log "Backups disponíveis ($(ls *.tar.gz 2>/dev/null | wc -l)):"
ls -lh *.tar.gz 2>/dev/null | awk '{print "  " $9 "  " $5}' | head -10

# ── 6. (Opcional) Upload para storage remoto ────────────────────────────
# Descomente se quiser enviar para S3/Backblaze/etc:
#
# if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
#     log "Enviando para S3..."
#     aws s3 cp "$FINAL_NAME" "s3://$BACKUP_S3_BUCKET/whatshybrid/$FINAL_NAME"
# fi
#
# Backblaze B2 (mais barato que S3 para backups):
# if [[ -n "${B2_BUCKET:-}" ]]; then
#     b2 upload-file "$B2_BUCKET" "$FINAL_NAME" "whatshybrid/$FINAL_NAME"
# fi

log "═══ Backup concluído com sucesso ═══"
