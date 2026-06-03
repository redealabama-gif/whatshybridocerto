#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# WhatsHybrid Pro — Instalação Automática em VPS Ubuntu 22.04 / 24.04
# ═══════════════════════════════════════════════════════════════════════════
#
# Script idempotente: pode rodar múltiplas vezes sem quebrar nada.
#
# Pré-requisitos:
#   - VPS Ubuntu 22.04 ou 24.04 com root SSH
#   - Mínimo: 2 vCPU / 2GB RAM / 30GB disco
#   - Recomendado para 50+ clientes: 4 vCPU / 4GB RAM / 60GB disco
#   - Domínio com DNS A apontando para IP do VPS
#
# Uso:
#   ssh root@SEU_IP
#   curl -fsSL https://raw.githubusercontent.com/SEU_REPO/main/deploy/scripts/install.sh -o install.sh
#   chmod +x install.sh
#   ./install.sh
#
# OU, se você já tem o código clonado:
#   ./deploy/scripts/install.sh

set -euo pipefail

# ── Cores para output ─────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'  # No Color

log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[ OK ]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_err()   { echo -e "${RED}[ERR ]${NC}  $*" >&2; }

# ── Verificações iniciais ─────────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
   log_err "Este script precisa ser executado como root (use sudo)."
   exit 1
fi

if [[ ! -f /etc/os-release ]]; then
    log_err "Sistema operacional não detectado."
    exit 1
fi

source /etc/os-release
if [[ "$ID" != "ubuntu" ]]; then
    log_warn "Este script foi testado em Ubuntu. Detectado: $ID. Continuando mesmo assim..."
fi

log_info "═════════════════════════════════════════════════════════════════"
log_info " WhatsHybrid Pro — Setup automático"
log_info "═════════════════════════════════════════════════════════════════"
log_info ""
log_info " Vai instalar:"
log_info "   • Docker + Docker Compose"
log_info "   • UFW (firewall)"
log_info "   • Fail2ban (proteção contra força bruta SSH)"
log_info "   • Cron job de backup diário"
log_info ""

# ── 1. Atualizar sistema ─────────────────────────────────────────────────
log_info "[1/7] Atualizando pacotes do sistema..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -yqq
apt-get install -yqq curl wget git ufw fail2ban htop jq unzip

# ── 2. Docker ────────────────────────────────────────────────────────────
log_info "[2/7] Instalando Docker..."
if command -v docker &>/dev/null; then
    log_ok "Docker já instalado: $(docker --version)"
else
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    log_ok "Docker instalado: $(docker --version)"
fi

# Docker Compose v2 (plugin)
if docker compose version &>/dev/null; then
    log_ok "Docker Compose v2 já instalado"
else
    apt-get install -yqq docker-compose-plugin
fi

# ── 3. Firewall ──────────────────────────────────────────────────────────
log_info "[3/7] Configurando firewall (UFW)..."
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (Caddy redirect to HTTPS)'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 443/udp comment 'HTTP/3 QUIC'
ufw --force enable
log_ok "Firewall ativo. Regras: $(ufw status | grep -c ALLOW) permitidas."

# ── 4. Fail2ban ──────────────────────────────────────────────────────────
log_info "[4/7] Configurando Fail2ban..."
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port = 22
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
EOF
systemctl restart fail2ban
systemctl enable fail2ban >/dev/null 2>&1
log_ok "Fail2ban ativo"

# ── 5. Diretório do projeto ──────────────────────────────────────────────
log_info "[5/7] Configurando diretório do projeto..."

PROJECT_DIR="${PROJECT_DIR:-/opt/whatshybrid}"
mkdir -p "$PROJECT_DIR"

# Se o script foi rodado de dentro do projeto já clonado, copia para PROJECT_DIR
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

if [[ -f "$SOURCE_DIR/docker-compose.yml" ]]; then
    log_info "Detectado código em $SOURCE_DIR — copiando para $PROJECT_DIR"
    rsync -a --exclude='node_modules' --exclude='data' --exclude='logs' \
          --exclude='.git' --exclude='*.db*' \
          "$SOURCE_DIR/" "$PROJECT_DIR/"
else
    log_warn "Você precisa colocar o código em $PROJECT_DIR antes de continuar."
    log_warn "Exemplo: rsync -av ./ root@IP:$PROJECT_DIR/"
    exit 1
fi

cd "$PROJECT_DIR"

# ── 6. Configuração inicial do .env ──────────────────────────────────────
log_info "[6/7] Configurando variáveis de ambiente..."

if [[ ! -f .env ]]; then
    cp .env.example .env

    # Gerar JWT_SECRET aleatório forte automaticamente
    JWT_SECRET=$(openssl rand -hex 32)
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" .env

    log_ok ".env criado a partir do template com JWT_SECRET aleatório"
    log_warn "═════════════════════════════════════════════════════════════════"
    log_warn " AÇÃO MANUAL NECESSÁRIA:"
    log_warn "  Edite $PROJECT_DIR/.env e preencha:"
    log_warn "    • DOMAIN (seu domínio com DNS apontando aqui)"
    log_warn "    • LETSENCRYPT_EMAIL"
    log_warn "    • Pelo menos uma OPENAI_API_KEY / ANTHROPIC_API_KEY / GROQ_API_KEY"
    log_warn "    • CORS_ORIGINS (inclua chrome-extension://ID_DA_SUA_EXTENSAO)"
    log_warn ""
    log_warn "  Depois rode:"
    log_warn "    cd $PROJECT_DIR && ./deploy/scripts/deploy.sh"
    log_warn "═════════════════════════════════════════════════════════════════"
else
    log_ok ".env já existe — não sobrescrito"
fi

# ── 7. Cron job de backup ────────────────────────────────────────────────
log_info "[7/7] Configurando backup automático diário (3h da manhã)..."

mkdir -p /var/log/whatshybrid
mkdir -p /opt/whatshybrid/backups

# Idempotente: remove crontab anterior antes de adicionar
(crontab -l 2>/dev/null | grep -v "whatshybrid-backup" || true) > /tmp/crontab.tmp
echo "0 3 * * * cd $PROJECT_DIR && ./deploy/scripts/backup.sh >> /var/log/whatshybrid/backup.log 2>&1 # whatshybrid-backup" >> /tmp/crontab.tmp
crontab /tmp/crontab.tmp
rm /tmp/crontab.tmp

log_ok "Backup diário configurado (3h da manhã)"

# ── Resumo final ────────────────────────────────────────────────────────
log_info ""
log_info "═════════════════════════════════════════════════════════════════"
log_ok " Setup concluído!"
log_info "═════════════════════════════════════════════════════════════════"
log_info ""
log_info " Próximos passos:"
log_info "   1. Edite $PROJECT_DIR/.env (variáveis essenciais)"
log_info "   2. Configure DNS: \$DOMAIN → IP do VPS ($(curl -s ifconfig.me 2>/dev/null || echo 'IP_DESTE_VPS'))"
log_info "   3. Rode: cd $PROJECT_DIR && ./deploy/scripts/deploy.sh"
log_info ""
log_info " Verificações úteis:"
log_info "   docker ps                   — containers rodando"
log_info "   docker compose logs -f      — logs em tempo real"
log_info "   ./deploy/scripts/health.sh  — health check completo"
log_info "   ufw status                  — regras de firewall"
log_info "   fail2ban-client status sshd — IPs banidos"
log_info ""
