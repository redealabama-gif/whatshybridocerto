# WhatsHybrid Pro — Guia de Deploy em Produção

> **Para você que vai colocar isso em produção sozinho.**
>
> Este guia leva uma VPS Ubuntu vazia até um SaaS funcionando em **20-30 minutos**.

---

## 📋 Antes de começar — checklist

### O que você precisa contratar

- [ ] **VPS Ubuntu 22.04 ou 24.04**
  - Para começar (até 20 clientes): **R$30-40/mês** — 2 vCPU / 2GB RAM / 30GB SSD
    - DigitalOcean Droplet $12 USD, Linode Nanode $12, Vultr $12, Contabo €4.50, Hostinger VPS R$30
  - Para crescer (50-100 clientes): **R$80-150/mês** — 4 vCPU / 4GB RAM / 60GB SSD
- [ ] **Domínio próprio** (~R$40-60/ano no Registro.br para .com.br)
- [ ] **Pelo menos uma API key de IA**:
  - OpenAI: ~$0.50-2/dia para 50 clientes ativos
  - Anthropic Claude: similar
  - Groq: muito mais barato, modelos open-source
- [ ] **Email para Let's Encrypt** (recebe alertas de cert)

### O que você precisa configurar

- [ ] DNS do seu domínio: registro **A** apontando para o IP do VPS
  - Exemplo: `api.seudominio.com.br` → `172.93.55.1`
  - Aguardar propagação (15min - 4h)

---

## 🚀 Setup em 5 passos

### Passo 1 — SSH no VPS

```bash
ssh root@SEU_IP_DO_VPS
```

### Passo 2 — Subir o código para o VPS

Da sua máquina local (onde você baixou o zip do WhatsHybrid):

```bash
# Descompactar o zip
unzip whatshybrid-pro-v8.0.6.zip
cd whatshybrid-pro-v8.0.6-learning-fixed

# Enviar para o VPS
rsync -av --progress \
  --exclude='node_modules' --exclude='data' --exclude='*.db' \
  --exclude='.git' --exclude='logs' \
  ./ root@SEU_IP:/opt/whatshybrid/
```

### Passo 3 — Rodar o instalador

No SSH do VPS:

```bash
cd /opt/whatshybrid
chmod +x deploy/scripts/*.sh
./deploy/scripts/install.sh
```

Esse script faz tudo:
- Instala Docker + Docker Compose
- Configura firewall (UFW)
- Configura Fail2ban contra força bruta SSH
- Cria diretórios
- Configura cron de backup diário
- Gera JWT_SECRET aleatório forte

### Passo 4 — Editar `.env`

```bash
nano /opt/whatshybrid/.env
```

**Mínimo obrigatório para subir:**

```bash
DOMAIN=api.seudominio.com.br          # ← seu domínio
LETSENCRYPT_EMAIL=voce@seudominio.com.br
JWT_SECRET=<<JÁ_PREENCHIDO_AUTOMATICO>>
OPENAI_API_KEY=sk-...                  # ← pelo menos uma key
CORS_ORIGINS=https://api.seudominio.com.br,chrome-extension://ID_DA_SUA_EXTENSAO
```

Salva e sai (`Ctrl+O`, `Enter`, `Ctrl+X`).

### Passo 5 — Deploy

```bash
cd /opt/whatshybrid
./deploy/scripts/deploy.sh
```

Vai:
1. Fazer backup (vazio na primeira vez)
2. Build das imagens Docker (~3-5 min)
3. Subir Caddy + Backend + Worker + Redis
4. Esperar Let's Encrypt provisionar TLS (~30-60s)
5. Health check final

**No final, deve aparecer:**

```
[ OK ]  Deploy concluído com sucesso!
```

Se aparecer erro, leia a seção **Problemas comuns** abaixo.

### Verificação

```bash
# Health check completo
./deploy/scripts/health.sh

# Logs em tempo real
docker compose logs -f

# Testar API
curl https://api.seudominio.com.br/health
```

---

## 🧰 Comandos do dia-a-dia

| Tarefa | Comando |
|---|---|
| Ver logs do backend | `docker compose logs -f backend` |
| Ver logs de tudo | `docker compose logs -f` |
| Restart só do backend | `docker compose restart backend` |
| Status dos containers | `docker compose ps` |
| Rodar health check | `./deploy/scripts/health.sh` |
| Backup manual | `./deploy/scripts/backup.sh` |
| Listar backups | `ls -lh /opt/whatshybrid/backups/` |
| Restaurar backup | `./deploy/scripts/restore.sh` |
| Ver uso de recursos | `docker stats` |
| Atualizar para nova versão | `./deploy/scripts/deploy.sh` |
| Banir IP de força bruta SSH | `fail2ban-client set sshd banip IP` |

---

## 💾 Backup e restore

**Backup automático já está configurado** (cron diário às 3h da manhã, retenção 7 dias).

### Backup manual antes de mudanças críticas

```bash
./deploy/scripts/backup.sh "antes-de-mudar-X"
```

### Restore (em caso de pane)

```bash
./deploy/scripts/restore.sh
# vai listar backups disponíveis e perguntar qual usar
```

### Backups off-site (FORTEMENTE recomendado)

VPS pode ser perdido (cobrança falha, hack, hardware). Configure backup remoto:

**Opção A — Backblaze B2** (mais barato, ~R$0,03/GB/mês):

```bash
# Instalar B2 CLI
pip install --break-system-packages b2

# Configurar
b2 authorize-account YOUR_KEY_ID YOUR_APP_KEY

# Adicionar no /opt/whatshybrid/deploy/scripts/backup.sh, no final:
b2 upload-file MEU-BUCKET "$FINAL_NAME" "whatshybrid/$FINAL_NAME"
```

**Opção B — Rsync para outro VPS**:

```bash
# Adicionar ao cron:
0 4 * * * rsync -av /opt/whatshybrid/backups/ user@OUTRA_VPS:/backups/whatshybrid/
```

---

## 🩺 Problemas comuns

### "Caddy não consegue obter cert TLS"

**Causa**: DNS ainda não propagou ou firewall bloqueando porta 80.

```bash
# Verifique DNS
dig api.seudominio.com.br
# Deve retornar o IP do VPS

# Verifique firewall
ufw status
# Deve ter "80/tcp ALLOW" e "443/tcp ALLOW"

# Logs do Caddy
docker compose logs caddy
```

### "Backend retorna 502"

**Causa**: backend crashou ou ainda está iniciando.

```bash
docker compose logs --tail=100 backend
docker compose ps backend
```

Se status é `unhealthy`, há erro de inicialização (provavelmente `.env` errado).

### "Health check falha mas containers estão rodando"

```bash
# Entrar no container do backend
docker compose exec backend sh

# Testar conexão com Redis
wget -qO- http://localhost:3000/health

# Ver erros recentes
tail -100 logs/error.log
```

### "Disco ficou cheio"

```bash
# Limpar imagens Docker antigas
docker system prune -a --volumes

# Limpar logs antigos do Docker
truncate -s 0 /var/lib/docker/containers/*/*-json.log

# Limpar backups muito antigos manualmente
ls -lt /opt/whatshybrid/backups/
rm /opt/whatshybrid/backups/backup_DATA_ANTIGA*.tar.gz
```

### "Redis usando muita memória"

Redis está configurado com 256MB max + LRU. Se mesmo assim usa muito:

```bash
docker compose exec redis redis-cli FLUSHDB  # ⚠️ apaga cache
docker compose restart redis
```

---

## 📊 Monitoramento

### Health check automático com alerta por email

Adicione ao cron:

```bash
crontab -e
# Adicione:
*/15 * * * * /opt/whatshybrid/deploy/scripts/health.sh > /tmp/health.log 2>&1 || mail -s "WhatsHybrid: Health check FALHOU" voce@email.com < /tmp/health.log
```

### Sentry (recomendado para erros em produção)

1. Crie conta em https://sentry.io (free tier suficiente)
2. Crie um projeto Node.js
3. Cole o DSN no `.env`:
   ```
   SENTRY_DSN=https://abc123@sentry.io/456
   ```
4. Restart: `./deploy/scripts/deploy.sh`

Erros em produção viram tickets organizados.

### Uptime externo (Better Stack / UptimeRobot)

UptimeRobot tem free tier para 50 monitors. Configure:

- **URL**: `https://api.seudominio.com.br/health`
- **Frequência**: 5 minutos
- **Alerta**: email + SMS quando der down

---

## 📈 Quando escalar

| Sintoma | Ação |
|---|---|
| RAM constantemente >85% | Upgrade para 4GB |
| CPU constantemente >80% | Upgrade vCPUs |
| Disco >85% | Limpar logs antigos ou upgrade |
| Backend health check intermitente | Aumentar `ORCHESTRATOR_MAX_TENANTS` ou RAM |
| Redis OOM | Aumentar `--maxmemory` no docker-compose |
| Latência >500ms na API | Adicionar 2ª instância de backend (load balancer) |

Para 200+ clientes ativos, pense em migrar para PostgreSQL e múltiplas instâncias do backend (próximas ondas).

---

## 🔐 Hardening adicional (opcional mas recomendado)

### 1. SSH apenas com chave (sem senha)

Na sua máquina local:

```bash
ssh-copy-id root@SEU_IP
```

No VPS, edite `/etc/ssh/sshd_config`:

```
PasswordAuthentication no
PermitRootLogin prohibit-password
```

```bash
systemctl restart sshd
```

### 2. Trocar porta SSH (security through obscurity)

Em `/etc/ssh/sshd_config`:

```
Port 2222
```

```bash
ufw allow 2222/tcp
ufw delete allow 22/tcp
systemctl restart sshd
```

### 3. Updates de segurança automáticos

```bash
apt-get install unattended-upgrades
dpkg-reconfigure --priority=low unattended-upgrades
```

---

## 📞 Quando algo der errado

**Em ordem do menos para o mais drástico:**

1. **Restart do serviço problemático**: `docker compose restart backend`
2. **Redeploy**: `./deploy/scripts/deploy.sh`
3. **Restart de tudo**: `docker compose down && docker compose up -d`
4. **Restore de backup recente**: `./deploy/scripts/restore.sh`
5. **Reboot do VPS**: `reboot` (containers sobem automaticamente, restart=unless-stopped)

Se nada disso funcionar, leia os logs: `docker compose logs --tail=200 > /tmp/diagnose.log`

---

## ✅ Verificação final pós-deploy

Antes de considerar "em produção", confira:

- [ ] `https://api.seudominio.com.br/health` retorna `200 OK`
- [ ] `./deploy/scripts/health.sh` retorna 0 erros
- [ ] TLS válido por mais de 30 dias (Caddy renova automaticamente)
- [ ] Backup automático configurado (cron)
- [ ] Pelo menos 1 backup off-site
- [ ] Sentry/monitoring configurado
- [ ] Você sabe onde estão os logs (`docker compose logs`)
- [ ] Você sabe como restaurar backup
- [ ] Você sabe como atualizar (deploy.sh)

Quando todos os checkboxes estiverem marcados, **você tem um SaaS rodando em produção**.

---

## 🎯 Próximas ondas

Esta é a **Onda 2 de 5**. Já você tem:

- ✅ **Onda 1**: IA que de fato aprende (v8.0.6)
- ✅ **Onda 2**: Deploy SaaS-ready (esta release, v8.1.0)

Falta:

- ⏳ **Onda 3**: Observabilidade — endpoint `/metrics` por tenant, dashboard
- ⏳ **Onda 4**: Onboarding e billing — fluxo de signup, integração Stripe/MercadoPago, renovação automática
- ⏳ **Onda 5**: Go-live checklist — runbook de incidentes, doc operacional para você

Diga **"próximo"** quando estiver pronto.
