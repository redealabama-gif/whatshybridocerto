# WhatsHybrid Pro

> **CRM SaaS B2B com IA neural para WhatsApp Web**
> Atendimento automatizado, aprendizado contínuo, integração nativa via extensão Chrome.

![Version](https://img.shields.io/badge/version-9.4.7-blueviolet.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Tests](https://img.shields.io/badge/smoke%20tests-3%20suites-success.svg)

> **v8.5.0** = release de **hardening pós-auditoria**: tenant isolation, refresh rotation com reuse detection, webhook outbox, email DLQ, /health/deep, ARIA, mobile responsive, custom AI prompts, telemetria de falha de hooks, smoke tests, backup com integrity check. Veja [CHANGELOG-v8.5.0.md](./CHANGELOG-v8.5.0.md).

---

## O que é

Plataforma SaaS multi-tenant que combina:
- **Extensão Chrome** que se acopla ao WhatsApp Web (atendimento + IA)
- **Backend Node.js + SQLite** com 30+ rotas, billing recorrente, observabilidade
- **Site público** (landing, signup com checkout, portal do cliente)
- **Sistema de tokens** estilo OpenAI/Claude (cliente compra plano e consome conforme uso)
- **Cobrança automática** via MercadoPago (PIX, boleto, cartão recorrente)

---

## Estrutura do projeto

```
whatshybrid-pro/
├── README.md, DEPLOY.md, CONTRIBUTING.md   Documentação raiz
├── docs/                                    Documentação detalhada
│   ├── CHANGELOG.md                        Última versão (v8.4.0)
│   ├── ARCHITECTURE.md                     Design técnico
│   ├── INSTALLATION.md                     Guia de instalação
│   └── extension-docs/                     Docs da extensão
├── deploy/                                  Produção
│   ├── caddy/Caddyfile                     Reverse proxy + TLS
│   └── scripts/                            install/deploy/backup/health
├── scripts/                                 Build e versão
│   ├── build-extension.js
│   ├── pack-extension.js
│   └── bump-version.js
├── docker-compose.yml                       Stack completa em 1 comando
├── whatshybrid-backend/                     Backend Node.js
│   ├── src/
│   │   ├── routes/        30+ endpoints HTTP
│   │   ├── services/      TokenService, EmailService, MercadoPagoService
│   │   ├── ai/            15+ componentes de IA (RAG, learning, agents)
│   │   ├── middleware/    auth, subscription, tokenBalance
│   │   ├── jobs/          cron de billing diário
│   │   └── utils/         database, events, emailListeners
│   ├── public/            Site público (landing, login, signup, dashboard)
│   ├── admin/             Painel admin operacional
│   └── config/
└── whatshybrid-extension/                   Chrome Extension
    ├── manifest.json
    ├── training/          UI de treinamento dedicada (970 linhas)
    ├── modules/           140+ scripts modulares
    ├── content/           Content scripts do WhatsApp Web
    ├── chatbackup/        Backup de conversas
    └── popup/, sidepanel/, icons/, i18n/
```

---

## Quick start (dev)

```bash
# 1. Backend
cd whatshybrid-backend
cp .env.example .env
# Edite .env: pelo menos JWT_SECRET e OPENAI_API_KEY (ou ANTHROPIC_API_KEY)
npm install
npm start

# 2. Extensão (Chrome)
# Abra chrome://extensions
# Ativar "Modo desenvolvedor"
# "Carregar sem compactação" e selecionar a pasta whatshybrid-extension/
```

Acesse:
- `http://localhost:3000` para a landing pública
- `http://localhost:3000/signup` para criar conta de teste
- `http://localhost:3000/dashboard` para o portal do cliente
- `http://localhost:3000/admin` para o painel admin (auth)

---

## Deploy em produção (Docker)

```bash
# Em um VPS Ubuntu 22.04+ (Hostinger, DigitalOcean, etc):
git clone <seu-repo> /opt/whatshybrid
cd /opt/whatshybrid
cp whatshybrid-backend/.env.example whatshybrid-backend/.env
# Configure: JWT_SECRET, MERCADOPAGO_*, SENDGRID_API_KEY, PUBLIC_BASE_URL, etc

# Bootstrap completo (instala Docker, UFW, fail2ban, cron de backup):
bash deploy/scripts/install.sh

# Sobe a stack (caddy + backend + redis + worker):
docker compose up -d

# Caddy faz TLS automático via Let's Encrypt - só apontar DNS para o IP do VPS
```

Ver `DEPLOY.md` para detalhes.

---

## Funcionalidades principais (v8.4.0)

### Para o cliente (via extensão)

- IA atende WhatsApp Web em tempo real
- Modo Copiloto (sugestão + 1 clique humano)
- Aprendizado contínuo: 15+ componentes (outcome tracker, score engine, A/B test, memória conversacional, RAG, etc.)
- Treinamento dedicado dentro da extensão (FAQ, persona, produtos, políticas, few-shot)
- Multi-tenant nativo (workspaces isolados)

### Para o owner do SaaS (você)

- Signup público com trial de 7 dias
- 3 planos (Starter R$ 97, Pro R$ 197, Agency R$ 497)
- Tokens por workspace (50k, 500k, 5M)
- Pacotes avulsos (10k a 1M tokens, R$ 19 a R$ 999)
- Pagamento via MercadoPago (PIX, boleto, cartão)
- Renovação automática (preapproval - cliente autoriza 1 vez, MP cobra todo mês)
- Email transacional (welcome, payment confirmed, trial ending, charge failed, tokens low)
- Painel admin com KPIs, custo por tenant, erros recentes
- Cron diário (gerencia trials, suspende inadimplentes, alerta)

---

## Configuração mínima

**Obrigatório no `.env`:**
```bash
JWT_SECRET=$(openssl rand -hex 32)
OPENAI_API_KEY=sk-...           # ou ANTHROPIC_API_KEY=sk-ant-...
PUBLIC_BASE_URL=https://api.seudominio.com.br
```

**Para receber pagamentos (opcional em dev):**
```bash
MERCADOPAGO_ACCESS_TOKEN=APP_USR-...
MERCADOPAGO_WEBHOOK_SECRET=...
```

**Para emails transacionais (opcional em dev):**
```bash
SENDGRID_API_KEY=SG.xxx
EMAIL_FROM=noreply@seudominio.com.br
```

Ver `.env.example` para todas as variáveis disponíveis.

---

## Documentação

| Arquivo | Conteúdo |
|---|---|
| `docs/CHANGELOG.md` | O que mudou em v8.4.0 (auditoria, tokens, billing, email) |
| `docs/ARCHITECTURE.md` | Design técnico, módulos, fluxos |
| `docs/INSTALLATION.md` | Instalação detalhada |
| `docs/extension-docs/` | Documentação da extensão |
| `DEPLOY.md` | Procedimento operacional de deploy e rollback |
| `CONTRIBUTING.md` | Como contribuir |

---

## Licença

MIT - ver `LICENSE`.
