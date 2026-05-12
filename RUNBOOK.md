# RUNBOOK Operacional — WhatsHybrid Pro

> Procedimentos para operar o sistema em produção. Mantenha aberto durante incidentes.

---

## 📞 Quando algo está errado

### 1. O backend está down

**Sintomas:** Cliente reclama que o site/dashboard não abre. Status page (status.whatshybrid.com.br) mostra red.

**Diagnose:**
```bash
ssh user@vps
cd /opt/whatshybrid
docker compose ps                        # vê containers
docker compose logs backend --tail 100   # logs recentes
docker compose logs --since 10m backend  # últimos 10min
```

**Ações comuns:**
```bash
# Restart backend (1ª tentativa)
docker compose restart backend

# Rebuild se restart não resolveu (após pull)
docker compose pull
docker compose up -d --force-recreate backend

# Volta versão anterior (rollback)
git log --oneline -5
git checkout <commit-anterior>
docker compose up -d --build backend
```

---

### 2. Banco de dados travou

**Sintomas:** /health/deep retorna 503, queries demoram >5s, erros "database is locked".

**SQLite:**
```bash
# Verifica integridade
docker compose exec backend sqlite3 /app/data/whatshybrid.db "PRAGMA integrity_check;"

# Se corrupted: restore último backup
ls -lh backups/
./deploy/scripts/restore.sh backups/backup_AAAAMMDD_HHMMSS_auto.tar.gz --apply
```

**Postgres:**
```bash
# Conecta
docker compose exec postgres psql -U whatshybrid -d whatshybrid

# Verifica conexões ativas
SELECT pid, state, query_start, query FROM pg_stat_activity WHERE state != 'idle';

# Mata query travada
SELECT pg_cancel_backend(<pid>);

# Estatísticas
SELECT * FROM pg_stat_database WHERE datname = 'whatshybrid';
```

---

### 3. Webhook MercadoPago não chegou

**Sintomas:** Cliente pagou mas conta não foi ativada.

**Diagnose:**
```bash
# Verifica inbox de webhooks
docker compose exec backend sqlite3 /app/data/whatshybrid.db \
  "SELECT id, event_type, status, last_error, received_at
   FROM webhook_inbox
   WHERE provider = 'mercadopago' AND received_at >= datetime('now', '-1 day')
   ORDER BY received_at DESC LIMIT 20;"

# Se nenhum registro: webhook não chegou no servidor (problema de rede/DNS/Caddy)
docker compose logs caddy --since 1h | grep webhook

# Se status = 'failed': processar de novo
# Pega o id e força replay manual:
curl -X POST https://api.whatshybrid.com.br/api/v1/webhooks/payment/manual-confirm \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"payment_id": "MP-PAYMENT-ID", "workspace_id": "WS-ID"}'
```

---

### 4. Email não está saindo

**Sintomas:** Cliente não recebeu welcome / payment confirmation / drip.

**Diagnose:**
```bash
# Verifica outbox
docker compose exec backend sqlite3 /app/data/whatshybrid.db \
  "SELECT id, to_address, subject, status, attempts, last_error, next_retry_at
   FROM email_outbox
   WHERE created_at >= datetime('now', '-1 day')
   ORDER BY created_at DESC LIMIT 20;"

# Se status = 'pending' há muito tempo: cron não está rodando
docker compose logs backend | grep "EmailOutbox"

# Se status = 'failed': verificar logs com last_error
# Comum: SendGrid API key inválida, limite excedido
```

**Reprocessa fila manualmente:**
```bash
docker compose exec backend node -e "
const e = require('./src/services/EmailService');
e.processOutbox(50).then(r => console.log(r));
"
```

---

### 5. AI provider down (OpenAI / Anthropic)

**Sintomas:** Erros 500 nas rotas /ai/*. Cliente reclama que IA não responde.

**Diagnose:**
```bash
curl https://api.whatshybrid.com.br/health/deep | jq .checks.ai_providers
```

Se `active: 0`:
1. Verifica status providers:
   - https://status.openai.com
   - https://status.anthropic.com
2. Verifica API key no .env (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)
3. Verifica créditos OpenAI / Anthropic

**Mitigação enquanto provider tá fora:**
- AIRouter já faz fallback automático entre providers
- Se TODOS estão fora: documenta em status page e desativa auto-reply via `EMERGENCY_AI_DISABLED=true` env var (precisa adicionar essa flag no AIRouterService)

---

### 6. Extensão quebrou após update do WhatsApp

**Sintomas:** Spike em `extension_telemetry` com `event_type = 'hooks_failed'`.

**Diagnose:**
```bash
docker compose exec backend sqlite3 /app/data/whatshybrid.db \
  "SELECT wa_version, COUNT(*) AS c, MIN(created_at) AS first
   FROM extension_telemetry
   WHERE event_type = 'hooks_failed' AND created_at >= datetime('now', '-1 day')
   GROUP BY wa_version ORDER BY c DESC;"
```

Se um `wa_version` específico está dominando: WhatsApp atualizou.

**Ações:**
1. Notifica todos os clientes via email transacional sobre incompatibilidade
2. Investiga `wpp-hooks/02-webpack-interceptor.js` — o gancho com webpack interno provavelmente precisa atualização
3. Modo manual já está ativo (graceful degradation v8.5.0+) — clientes podem continuar atendendo
4. Empurra fix em até 24h via `npm run build` + release no Chrome Web Store

---

### 7. Health score em massa caindo

**Sintomas:** Alertas Discord múltiplos "workspace em risco".

**Diagnose:**
```bash
docker compose exec backend sqlite3 /app/data/whatshybrid.db \
  "SELECT subscription_status, AVG(health_score) AS avg, COUNT(*) AS c
   FROM workspaces WHERE health_score IS NOT NULL
   GROUP BY subscription_status;"
```

**Se média baixou globalmente:**
- Possível problema sistêmico (AI errors, DB lento)
- Verifica /metrics/prometheus ai_requests_total{status="error"}

**Se concentrado em workspaces específicos:**
- Investiga individualmente
- Considera outreach manual (email/whatsapp)

---

## 🔄 Procedimentos rotineiros

### Deploy de nova versão

```bash
ssh user@vps
cd /opt/whatshybrid
./deploy/scripts/deploy.sh
# Script faz: git pull, docker build, migration check, restart, smoke test
```

### Backup manual

```bash
./deploy/scripts/backup.sh "manual-$(date +%Y%m%d)"
```

### Restore

```bash
./deploy/scripts/restore.sh /opt/whatshybrid/backups/backup_X.tar.gz          # dry-run
./deploy/scripts/restore.sh /opt/whatshybrid/backups/backup_X.tar.gz --apply  # aplica
```

### Migration

```bash
# Verificar status
cd /opt/whatshybrid && docker compose exec backend npm run migrate:status

# Aplicar pendentes
docker compose exec backend npm run migrate:up
```

### Health check completo

```bash
./deploy/scripts/health.sh
```

### Smoke tests contra produção

```bash
TEST_BASE_URL=https://api.whatshybrid.com.br npm run test:smoke
```

---

## 🚨 Disaster Recovery (DR)

**Cenário:** VPS principal totalmente perdido.

### Pré-requisito: backups offsite

Backups devem estar em segundo lugar (S3, B2, ou outro VPS):
```bash
# Configurado em backup.sh — comente/descomente no fim do script
aws s3 cp $FINAL_NAME s3://whatshybrid-backups/
```

### Procedimento de DR

1. **Provisiona novo VPS** (Hostinger/DigitalOcean — escolha região BR ideal)
   ```bash
   ssh root@new-vps
   apt update && apt install -y docker.io docker-compose-v2 git
   ```

2. **Clone repo:**
   ```bash
   git clone https://github.com/your-org/whatshybrid-pro /opt/whatshybrid
   cd /opt/whatshybrid
   ```

3. **Restore backup:**
   ```bash
   # Baixa backup mais recente
   aws s3 cp s3://whatshybrid-backups/$(aws s3 ls s3://whatshybrid-backups/ | sort | tail -1 | awk '{print $NF}') ./backup.tar.gz

   # Restaura
   ./deploy/scripts/restore.sh ./backup.tar.gz --apply
   ```

4. **Configura .env** (a partir do template):
   ```bash
   cp .env.example .env
   nano .env   # preenche secrets — JWT_SECRET, MP keys, SendGrid, etc.
   ```

5. **Sobe stack:**
   ```bash
   docker compose up -d
   sleep 10
   curl http://localhost:3000/health
   ```

6. **Aponta DNS:**
   - Atualiza A record em DNS provider para IP do novo VPS
   - TTL baixo (60s) acelera propagação

7. **Smoke test:**
   ```bash
   TEST_BASE_URL=http://NOVO_IP:3000 npm run test:smoke
   ```

8. **Monitora:**
   - Sentry pra erros novos
   - Status page status.whatshybrid.com.br atualiza automático

**Tempo alvo:** < 30 minutos do incidente até serviço operacional.

---

## 📊 Métricas pra acompanhar diariamente

| Métrica | Threshold OK | Atenção | Crítico |
|---------|--------------|---------|---------|
| Uptime / mês | > 99.5% | 99-99.5% | < 99% |
| p95 latência | < 200ms | 200-500ms | > 500ms |
| Error rate | < 0.5% | 0.5-2% | > 2% |
| AI fallback rate | < 5% | 5-10% | > 10% |
| Workspaces ativos crescimento | > 5%/mês | 0-5% | negativo |
| MRR | crescente | estável | decrescente |
| Email outbox pending | < 10 | 10-50 | > 50 |
| Webhook inbox failed | 0 | 1-5 | > 5 |
| Health score médio | > 70 | 50-70 | < 50 |

---

## 🔐 Acessos críticos

| Sistema | Onde | Quem tem acesso |
|---------|------|-----------------|
| VPS root | SSH key | só você |
| MercadoPago dashboard | console.mercadopago.com.br | só você |
| Stripe dashboard | dashboard.stripe.com | só você |
| SendGrid/Resend | console | só você |
| Sentry | sentry.io | você + equipe (quando tiver) |
| DNS | provider (Cloudflare/Hostinger) | só você |
| Backups offsite | S3/B2 | só você |
| Cloudflare (se usar) | cloudflare.com | só você |

**Importante:** documente todas as credenciais em gerenciador de senhas (1Password / Bitwarden). Não commite nada.

---

## 📞 Contatos / SLAs

- **MercadoPago Suporte:** suporte@mercadopago.com (resposta 24-48h)
- **Stripe Support:** dashboard chat (resposta < 1h em business hours)
- **SendGrid:** docs.sendgrid.com (free tier sem suporte humano direto)
- **Provedor VPS (Hostinger/DO/etc.):** chat 24/7

Em caso de incidente: documente sempre em `/docs/incidents/INCIDENT-YYYY-MM-DD.md` com:
1. Resumo
2. Timeline
3. Impacto (clientes afetados, duração)
4. Root cause
5. Action items pra prevenir recorrência

---

## 🟢 (v9.2.0) WhatsApp atualizou e quebrou os seletores

**Sintomas:**
- Spike em `selector_telemetry` para uma `wa_version` específica
- Banner "Modo manual ativo" aparecendo na extensão dos clientes
- Alertas Discord do canary (vide abaixo)
- Reclamações de cliente "não está respondendo automaticamente"

### Triagem rápida

```bash
# 1. Quais seletores estão falhando?
docker compose exec backend sqlite3 /app/data/whatshybrid.db \
  "SELECT selector_name, wa_version, COUNT(DISTINCT workspace_id) AS afetados,
          MAX(failure_count) AS picos
   FROM selector_telemetry
   WHERE last_seen >= datetime('now', '-2 hours')
   GROUP BY selector_name, wa_version
   ORDER BY afetados DESC LIMIT 20;"
```

### Decisão

- **1 seletor falhando, 1 versão WA específica:** atualização normal do WhatsApp. Atualize `SELECTORS` em `whatshybrid-extension/modules/wa-bridge-defensive.js` com novo path. Faça release da extensão.

- **Múltiplos seletores falhando, mesma versão WA:** WhatsApp fez refactor maior. Pode levar 24-48h pra mapear novos paths. Notifica clientes via email transacional sobre incompatibilidade temporária.

- **Todos os clientes em modo manual:** não é WA — é seu deploy. Verifica se o último build da extensão foi corrompido. Rolla back pra versão anterior no Chrome Web Store.

### Ações práticas

```bash
# Roda canary pra confirmar
node whatshybrid-backend/scripts/canary-whatsapp.js

# Vê quais clientes estão em qual versão do WA
docker compose exec backend sqlite3 /app/data/whatshybrid.db \
  "SELECT current_extension_version,
          COUNT(*) AS workspaces
   FROM workspaces
   WHERE current_extension_version IS NOT NULL
   GROUP BY current_extension_version
   ORDER BY workspaces DESC;"

# Desativa feature problemática via feature flag (sem deploy)
docker compose exec backend node -e "
  const ff = require('./src/services/FeatureFlagsService');
  ff.set('auto_reply', false, null, 'Desativado por incompatibilidade WA temporária');
"
```

### Recovery

Após mapear novos paths e fazer release:

```bash
# 1. Edita modules/wa-bridge-defensive.js — adiciona novo fallback
# 2. cd whatshybrid-extension && npm run build
# 3. Empacota .zip pra Chrome Web Store
# 4. Submete review (Google leva 24-48h em geral)
# 5. Notifica clientes via email: "Atualização disponível"
# 6. Reativa feature flag:
docker compose exec backend node -e "
  require('./src/services/FeatureFlagsService').set('auto_reply', true);
"
```

### Prevention (canary)

Configure 1 VPS dedicado com:
- 1 número WhatsApp Business de teste (≠ produção)
- Cron rodando `scripts/canary-whatsapp.js` a cada 30 minutos
- Webhook Discord do alertManager

```bash
# Em VPS canary:
*/30 * * * * cd /opt/whatshybrid && node scripts/canary-whatsapp.js
```

Você descobre quebra **4-6 horas antes** do primeiro cliente reclamar.

### Fontes para acompanhar updates

- [WhatsApp Blog](https://blog.whatsapp.com/) — anúncios oficiais
- [WABetaInfo](https://wabetainfo.com/) — vazamentos de mudanças (revisar segundas)
- [@WABetaInfo no X/Twitter](https://twitter.com/WABetaInfo)
- Padrões observados:
  - Updates backend silenciosos: terça/quarta de manhã (UTC-3)
  - Mudanças visíveis: mensais
  - Refactors de Store interno: trimestrais (Jan/Abr/Jul/Out)
