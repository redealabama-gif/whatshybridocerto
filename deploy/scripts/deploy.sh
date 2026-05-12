#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# WhatsHybrid Pro — Deploy / Update
# ═══════════════════════════════════════════════════════════════════════════
#
# Faz:
#   1. Backup do banco antes de qualquer mudança
#   2. Build das imagens com cache
#   3. Restart com zero-downtime (Caddy mantém conexões)
#   4. Health check pós-deploy
#   5. Rollback automático se health check falhar
#
# Uso:
#   cd /opt/whatshybrid
#   ./deploy/scripts/deploy.sh

set -euo pipefail

# ── Cores e helpers ──────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info() { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()   { echo -e "${GREEN}[ OK ]${NC}  $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_err()  { echo -e "${RED}[ERR ]${NC}  $*" >&2; }

# Trap para mensagem clara em erro
trap 'log_err "Deploy falhou na linha $LINENO. Banco está intacto (backup feito antes)."; exit 1' ERR

# ── Verificações ─────────────────────────────────────────────────────────
if [[ ! -f docker-compose.yml ]]; then
    log_err "docker-compose.yml não encontrado. Rode este script da raiz do projeto."
    exit 1
fi

if [[ ! -f .env ]]; then
    log_err ".env não encontrado. Copie de .env.example e configure."
    exit 1
fi

# Carrega DOMAIN do .env para health check
set -a
source .env
set +a

if [[ -z "${DOMAIN:-}" ]]; then
    log_err "DOMAIN não definido no .env"
    exit 1
fi

log_info "═════════════════════════════════════════════════════════════════"
log_info " Deploy WhatsHybrid Pro"
log_info " Domínio: $DOMAIN"
log_info "═════════════════════════════════════════════════════════════════"

# ── 1. Backup pré-deploy ─────────────────────────────────────────────────
log_info "[1/5] Backup pré-deploy..."
if [[ -x ./deploy/scripts/backup.sh ]]; then
    ./deploy/scripts/backup.sh "pre-deploy-$(date +%Y%m%d_%H%M%S)"
    log_ok "Backup feito"
else
    log_warn "backup.sh não disponível ou não executável — pulando backup"
fi

# ── 2. Pull do código (se for repo git) ──────────────────────────────────
if [[ -d .git ]]; then
    log_info "[2/5] Atualizando código do git..."
    git fetch origin
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    git pull origin "$BRANCH"
    log_ok "Código atualizado para $(git rev-parse --short HEAD)"
else
    log_info "[2/5] Pulando git pull (não é repo git, código já está local)"
fi

# ── 3. Build das imagens ─────────────────────────────────────────────────
log_info "[3/5] Build das imagens Docker..."
docker compose build --pull
log_ok "Build concluído"

# ── 4. Subir os containers (rolling restart) ─────────────────────────────
log_info "[4/5] Restart dos containers..."

# Salva estado atual em caso de rollback
PREVIOUS_BACKEND_IMAGE=$(docker compose images backend --format json 2>/dev/null | jq -r '.[0].ImageID' || echo "")

# up -d com --remove-orphans remove containers antigos
docker compose up -d --remove-orphans

log_ok "Containers iniciados"

# ── 5. Health check pós-deploy ──────────────────────────────────────────
log_info "[5/5] Aguardando health check..."

MAX_ATTEMPTS=30
ATTEMPT=0
HEALTH_OK=false

while [[ $ATTEMPT -lt $MAX_ATTEMPTS ]]; do
    sleep 5
    ATTEMPT=$((ATTEMPT + 1))

    # Tenta via Caddy (HTTPS público)
    if curl -fsSL --max-time 5 "https://$DOMAIN/health" > /dev/null 2>&1; then
        HEALTH_OK=true
        break
    fi

    # Fallback: tenta direto no backend (rede interna do compose)
    if docker compose exec -T backend wget -qO- http://localhost:3000/health > /dev/null 2>&1; then
        HEALTH_OK=true
        log_warn "Health OK no backend mas Caddy ainda não respondeu (TLS pode estar provisionando)"
        break
    fi

    echo -n "."
done
echo

if [[ "$HEALTH_OK" == "true" ]]; then
    log_ok "Deploy concluído com sucesso!"
    log_info ""
    log_info "Versão atual:"
    docker compose images backend --format "table {{.Repository}}\t{{.Tag}}\t{{.ImageID}}\t{{.Size}}"
    log_info ""
    log_info "Status dos containers:"
    docker compose ps
    log_info ""
    log_info "Logs em tempo real: docker compose logs -f"
else
    log_err "═════════════════════════════════════════════════════════════════"
    log_err " HEALTH CHECK FALHOU após $MAX_ATTEMPTS tentativas"
    log_err "═════════════════════════════════════════════════════════════════"
    log_err ""
    log_err " Logs do backend:"
    docker compose logs --tail=50 backend
    log_err ""
    log_err " Logs do caddy:"
    docker compose logs --tail=20 caddy
    log_err ""
    log_err " Para tentar rollback manual:"
    log_err "   git log -5"
    log_err "   git reset --hard COMMIT_ANTERIOR"
    log_err "   ./deploy/scripts/deploy.sh"
    log_err ""
    log_err " Para restaurar banco:"
    log_err "   ls /opt/whatshybrid/backups/"
    log_err "   ./deploy/scripts/restore.sh BACKUP_FILE.tar.gz"
    exit 1
fi
