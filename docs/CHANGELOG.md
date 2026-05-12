# WhatsHybrid Pro v8.4.0 — Tokens + Email + Cobrança Recorrente Real

> **Onda 4 + 4.5 completa.** Sistema de tokens (modelo ChatGPT/Claude), email transacional, cobrança automática mensal via preapproval do MercadoPago, e correção arquitetural baseada na sua auditoria.

---

## ⚠️ Auditoria honesta (antes de tudo)

Você cobrou e estava certo. Aqui está o que eu errei nas Ondas 1-3 e corrigi agora:

### 1. Sistema de aprendizado: muito mais robusto do que eu havia mexido

Eu corrigi 6 bugs no `ValidatedLearningPipeline` na Onda 1 e tratei como se fosse "todo o aprendizado". Mas o sistema tem **15+ componentes**:

| Componente | Função |
|---|---|
| `AutoLearningLoop` | Ciclo autônomo SEM humano |
| `ResponseOutcomeTracker` | Detecta se cliente respondeu/converteu |
| `PerformanceScoreEngine` | Score 0→1 por outcome real |
| `StrategySelector` | Aprende qual estratégia funciona por cliente |
| `ResponseABTester` | Testa variantes A/B |
| `ConversationMemory` | Memória contextual por chat |
| `ClientBehaviorAdapter` | Adapta tom por cliente |
| `CommercialIntelligenceEngine` | Inteligência comercial v10.1 |
| `HybridIntentClassifier` | Classifica intenção |
| `DynamicPromptBuilder` | Monta prompt dinâmico |
| `HybridSearch` (RAG) | Busca semântica |
| `EmbeddingProvider` | Embeddings |
| `knowledge_base` (tabela) | Base conhecimento |
| `training_examples` (tabela) | Few-shot examples |
| `ValidatedLearningPipeline` | Feedback humano (que eu mexi) |

**Nesta versão:** validei que NÃO mexi em nenhum desses 14 outros componentes — sistema robusto continua intacto.

### 2. Treinamento estava duplicado

A extensão já tem **`whatshybrid-extension/training/training.html`** com 970 linhas e 46 seções (Few-Shot, FAQ, Produtos, Info Negócio, Pagamento, Entrega, Trocas, Instruções Personalizadas, Analytics, Simulação Neural, Curadoria, Lab de Teste).

Eu criei aba "Treinar IA" duplicada no portal. **Removida.** Agora a aba Extensão tem um bloco explicativo apontando para a extensão.

### 3. API Keys foi escolha errada

Você pediu modelo de tokens (igual ChatGPT/Claude). **Aba "API Keys" removida.** Substituída por aba "Tokens & Uso".

### 4. Sistema de créditos B2C já existia

Tabelas `subscriptions`/`credit_transactions` existem mas são do modelo antigo da extensão (vinculadas a email). **Mantidas intactas** (continuam servindo a extensão standalone). Criei tabelas paralelas vinculadas a workspace para o SaaS B2B.

---

## ✓ O que está pronto agora

### A) Sistema de tokens (modelo SaaS)

**Tabelas novas:**
- `workspace_credits` — saldo de tokens por workspace (total, used, last_topup_at, low_balance_warned_at)
- `token_transactions` — histórico imutável (consume, topup, plan_grant, plan_renewal, refund, adjustment)

**Limites por plano:**
| Plano | Tokens/mês |
|---|---|
| Starter | 50.000 (~250 mensagens médias) |
| Pro | 500.000 (~2.500 mensagens médias) |
| Agency | 5.000.000 |

**Pacotes avulsos (não expiram):**
| Pacote | Tokens | Preço |
|---|---|---|
| 10k | 10.000 | R$ 19,00 |
| 50k | 50.000 | R$ 79,00 |
| 200k | 200.000 | R$ 249,00 |
| 1M | 1.000.000 | R$ 999,00 |

**Como funciona:**
1. Cliente compra plano → recebe tokens iniciais (`plan_grant`)
2. Cada mensagem que invoca a IA debita tokens automaticamente via `AIRouterService._trackRequest`
3. Quando saldo < 10% → email + alerta no dashboard
4. Quando saldo = 0 → middleware `checkTokenBalance` retorna 402 com link pra comprar
5. Cliente compra pacote → webhook MP credita tokens automaticamente
6. Renovação mensal → reseta para limite do plano (não acumula sobras)

### B) Cobrança automática real (Onda 4.5)

Implementação completa de **preapproval** do MercadoPago:

- `POST /api/v1/billing/subscribe-recurring` — cria preapproval, retorna URL para cliente autorizar
- `POST /api/v1/billing/cancel-recurring` — cancela débito automático
- Webhook detecta `subscription_authorized_payment` (cobrança mensal automática) e ativa workspace + concede tokens
- Cliente autoriza UMA vez, MP cobra todo mês sem ele refazer checkout

Botões no dashboard:
- **"Assinar com renovação automática"** (recomendado, débito mensal automático)
- **"Pagamento único (1 mês)"** (checkout one-shot, modo antigo)

### C) Email transacional

Service `EmailService.js` com SendGrid via HTTPS (sem SDK). Templates HTML futuristas (gradient purple/cyan, glassmorphism). 7 tipos de email:

1. **Welcome** — pós-signup
2. **Payment confirmed** — pagamento aprovado
3. **Trial ending** — 3 dias antes do fim do trial
4. **Charge failed** — cobrança recusada
5. **Tokens low** — < 10% saldo
6. **Tokens exhausted** — saldo zero
7. **Topup confirmed** — pacote avulso comprado

EventBus (`utils/events.js`) + listeners (`utils/emailListeners.js`) — emails são enviados automaticamente quando:
- `user.signup` é emitido pelo /auth/signup
- `subscription.activated` é emitido pelo webhook de pagamento
- `tokens.low_balance` é emitido pelo TokenService.consume
- `subscription.trial_ending` é emitido pelo billingCron
- `tokens.topup_confirmed` é emitido pelo webhook ao creditar pacote
- ...

**Modo dry-run:** se `SENDGRID_API_KEY` ausente, emails são apenas logados (não bloqueia o sistema).

### D) Frontend reorganizado

**Dashboard novo (`/dashboard.html`):**
- ✅ Aba "Visão Geral"
- ✅ Aba "Extensão Chrome" (com bloco apontando para treinamento na extensão)
- ✅ Aba "Tokens & Uso" — saldo grande com progress bar, KPIs (consumido 30d, requests, média), grid de pacotes para comprar, histórico em tabela
- ✅ Aba "Assinatura" — 3 botões (recorrência automática / pagamento único / mudar plano), info de método de pagamento, histórico de faturas
- ❌ Aba "Treinar IA" — REMOVIDA (duplicava extensão)
- ❌ Aba "API Keys" — REMOVIDA (modelo errado)

**Landing (`/`):**
- Pricing atualizada para mencionar tokens (50k/500k/5M)
- FAQ atualizado: "Quanto custa a IA por cliente atendido?" agora explica modelo de tokens
- Mensagem "Compre tokens extras quando precisar" no plano Pro

### E) Endpoints novos (15+ desta versão)

Routes:
- `GET /api/v1/tokens/balance` — saldo + status low_balance
- `GET /api/v1/tokens/history` — histórico de transações
- `GET /api/v1/tokens/usage?days=30` — relatório de uso
- `GET /api/v1/tokens/packages` — pacotes disponíveis
- `POST /api/v1/billing/create-token-checkout` — checkout pra comprar pacote avulso
- `POST /api/v1/billing/subscribe-recurring` — cria preapproval (recorrente)
- `POST /api/v1/billing/cancel-recurring` — cancela preapproval
- Webhook handler reconhece tipos: `payment`, `preapproval`, `subscription_authorized_payment`, `subscription_preapproval`

---

## 🔌 Como ativar

### 1. Atualizar `.env` (3 vars novas)

```bash
# SendGrid (opcional — sem isso emails são dry-run)
SENDGRID_API_KEY=SG.xxxxxxxxxxxx
EMAIL_FROM=noreply@whatshybrid.com.br
EMAIL_FROM_NAME=WhatsHybrid Pro
```

(Os outros vars de MP já vinham na v8.3.0.)

### 2. Cron e migrations rodam automaticamente

Sem ação manual. Boot do server:
- Cria tabelas novas (`workspace_credits`, `token_transactions`, colunas `mp_preapproval_id`, `auto_renew_enabled`)
- Inicia cron (03:00 todo dia)
- Conecta listeners de email

### 3. Configurar webhook no MP (apenas se Onda 4.5)

URL única para todos os tipos:
```
https://api.seudominio.com.br/api/v1/webhooks/payment/mercadopago-saas
```

Eventos: `payment`, `preapproval`, `subscription_authorized_payment`, `subscription_preapproval`.

---

## 🧪 Como testar localmente

```bash
unzip whatshybrid-pro-v8.4.0.zip
cd whatshybrid-backend
npm install      # primeira vez
export JWT_SECRET=$(openssl rand -hex 32)
export BILLING_CRON_DISABLED=true
NODE_ENV=development npm start
```

Fluxo de teste:
1. http://localhost:3000/signup — criar conta plano "Pro"
2. Welcome email aparece no console (dry-run)
3. Dashboard mostra aba "Tokens & Uso" com 500k tokens disponíveis
4. Aba "Assinatura" com 3 botões (incluindo "Assinar com renovação automática")
5. Clica em "Comprar tokens" — mostra 4 pacotes
6. Clica em qualquer um — toast warning "MP não configurado" (esperado, sem token)

Para testar billing real:
- Configure `MERCADOPAGO_ACCESS_TOKEN` (sandbox)
- Restart
- Os botões agora redirecionam para checkout real do MP

Para forçar débito de tokens (ver subtração funcionar):
- Faça uma chamada à `/api/v2/intelligence/process-message` autenticado
- Veja saldo diminuir em tempo real no dashboard

---

## 📊 Estado final v8.4.0

```
whatshybrid-backend/
├── src/
│   ├── routes/
│   │   ├── tokens.js                         [NOVO]   65 linhas — endpoints de saldo/histórico
│   │   ├── billing.js                        [+++ ]  351 linhas — checkout + recorrência
│   │   ├── webhooks-payment-saas.js          [+++ ]  368 linhas — handler preapproval+payment
│   │   ├── api-keys.js                       [legado, mantido]
│   │   ├── subscription.js                   [legado, mantido]
│   │   ├── extension.js                      [legado, mantido]
│   │   ├── auth.js                           [+ events.emit('user.signup')]
│   │   ├── users.js                          [+/stats]
│   │   └── smartbot.js                       [+/config GET/POST]
│   ├── services/
│   │   ├── TokenService.js                   [NOVO]  286 linhas — débito atômico, alertas
│   │   ├── EmailService.js                   [NOVO]  280 linhas — 7 templates HTML
│   │   └── MercadoPagoService.js             [+++ ]  340 linhas — preapproval methods
│   ├── middleware/
│   │   └── tokenBalance.js                   [NOVO]   60 linhas — bloqueia AI sem saldo
│   ├── jobs/
│   │   └── billingCron.js                    [+++ ]  280 linhas — emite trial_ending
│   ├── utils/
│   │   ├── events.js                         [NOVO]   15 linhas — EventBus singleton
│   │   ├── emailListeners.js                 [NOVO]  130 linhas — 7 listeners
│   │   └── database.js                       [+migrations: workspace_credits, token_transactions, mp_preapproval_id, auto_renew_enabled]
│   ├── ai/services/
│   │   └── AIRouterService.js                [+débito automático em _trackRequest]
│   └── server.js                             [+1 mount + emailListeners.setup()]
├── public/
│   ├── dashboard.html                        [reorganizado: -training -api +tokens]
│   ├── index.html                            [pricing atualizada com tokens]
│   ├── login.html                            [intacto]
│   └── signup.html                           [intacto]
└── .env.example                              [+SENDGRID_API_KEY, EMAIL_FROM*]
```

---

## ⚠️ O que ficou de fora (Onda 5)

1. **Stripe** — só MP por enquanto. Para clientes internacionais, criar `StripeService.js` análogo (estrutura está pronta).
2. **Páginas legais** — `/terms`, `/privacy`, `/forgot-password` ainda dão 404. Você cria depois com seu CNPJ.
3. **Email com link real de reset de senha** — endpoint `/auth/forgot-password` ainda não existe.
4. **Dunning automático** — cron marca past_due e suspende após 7 dias. Não tenta cobrar de novo automaticamente (com preapproval ativo, MP já faz isso sozinho — então é menos necessário).
5. **Runbook de incidentes** — Onda 5 (Go-Live).

---

## Sumário das ondas

| Onda | Status | Versão |
|---|---|---|
| 1. IA aprende (validei que está intacto) | ✅ | 8.0.6 |
| 2. Deploy SaaS-ready | ✅ | 8.1.0 |
| 3. Observabilidade | ✅ | 8.1.1 |
| 3.5. Site público + portal cliente futurista | ✅ | 8.2.0 |
| 4. Billing & onboarding (planos + checkout one-shot) | ✅ | 8.3.0 |
| **4.5. Tokens + Email + Cobrança recorrente** | **✅ entregue agora** | **8.4.0** |
| 5. Go-live checklist + termos legais + Stripe | ⏳ | — |

**Você agora tem um SaaS B2B funcional ponta-a-ponta:** signup → trial 7 dias → tokens iniciais do plano → IA debita tokens em cada uso → quando trial termina, cliente pode optar por:
- **Pagamento único** (1 mês) — checkout simples
- **Recorrência automática** (recomendado) — autoriza uma vez, MP cobra todo mês

Quando saldo de tokens fica baixo, recebe email automático + tem botão "comprar mais" no dashboard.

Próximo passo natural é Onda 5 (Go-Live), mas honestamente: **suba o que tem, configure MP em sandbox, e teste o ciclo completo com você como primeiro cliente** antes de continuar codificando.
