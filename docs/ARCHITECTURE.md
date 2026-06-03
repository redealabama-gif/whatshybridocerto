# WhatsHybrid Pro — Arquitetura do Sistema

## Visão Geral

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CHROME BROWSER                                   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    WhatsApp Web (web.whatsapp.com)               │   │
│  │                                                                   │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │              CONTENT SCRIPT (content.js)                 │    │   │
│  │  │                                                           │    │   │
│  │  │  ┌──────────────┐  ┌────────────────┐  ┌────────────┐  │    │   │
│  │  │  │ MessageCapture│  │ SuggestionInj. │  │ RecoverDOM │  │    │   │
│  │  │  └──────┬───────┘  └───────┬────────┘  └─────┬──────┘  │    │   │
│  │  │         │                  │                   │         │    │   │
│  │  │         └──────────────────┼───────────────────┘         │    │   │
│  │  │                            │                              │    │   │
│  │  │                    ┌───────▼────────┐                    │    │   │
│  │  │                    │  EventBusCentral│                    │    │   │
│  │  │                    └───────┬────────┘                    │    │   │
│  │  └────────────────────────────┼────────────────────────────-┘    │   │
│  │                               │ chrome.runtime.sendMessage        │   │
│  │  ┌────────────────────────────▼────────────────────────────┐    │   │
│  │  │                   BACKGROUND SERVICE WORKER              │    │   │
│  │  │                       (background.js)                    │    │   │
│  │  │                                                           │    │   │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │    │   │
│  │  │  │  AIGateway   │  │ BackendClient│  │TabCoordinator │ │    │   │
│  │  │  │  (ai-gateway)│  │(backend-     │  │(tab-coordinat)│ │    │   │
│  │  │  └──────┬───────┘  │  singleton)  │  └───────────────┘ │    │   │
│  │  │         │          └──────┬───────┘                     │    │   │
│  │  │  ┌──────▼───────┐         │         ┌───────────────┐  │    │   │
│  │  │  │FeatureGate   │         │         │SubscriptionMgr│  │    │   │
│  │  │  │(subscription)│         │         └───────────────┘  │    │   │
│  │  │  └──────────────┘         │                             │    │   │
│  │  └───────────────────────────┼─────────────────────────────┘    │   │
│  │                              │ HTTPS / WebSocket                  │   │
│  │  ┌───────────────────────────▼─────────────────────────────┐    │   │
│  │  │                    SIDE PANEL (sidepanel.html)            │    │   │
│  │  │   CRM │ Campanhas │ Treinamento │ Analytics │ Configurações│   │   │
│  │  └─────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                              │ REST API / WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      WHATSHYBRID BACKEND (Node.js / Express)            │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                       API Routes                                  │   │
│  │  /auth  /contacts  /campaigns  /conversations  /ai  /recover     │   │
│  └───────────────────────────┬─────────────────────────────────────┘   │
│                               │                                         │
│  ┌──────────────┐  ┌──────────▼──────────┐  ┌─────────────────────┐  │
│  │ RateLimiter  │  │   Business Logic     │  │  Socket.io (WS)     │  │
│  │ Auth (JWT)   │  │                      │  │  real-time events   │  │
│  │ Helmet/CORS  │  │  CampaignManager     │  └─────────────────────┘  │
│  └──────────────┘  │  ContactManager      │                            │
│                    │  RecoverModule       │  ┌─────────────────────┐  │
│                    │  AIOrchestrator      │  │  Logger (structured)│  │
│                    └──────────┬──────────┘  │  x-request-id corr. │  │
│                               │             └─────────────────────┘  │
│  ┌────────────────────────────▼────────────────────────────────────┐  │
│  │                      Data Layer (SQLite / PostgreSQL)             │  │
│  │  contacts │ campaigns │ messages │ knowledge_base │ recover_log   │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       AI PROVIDERS (external)                           │
│   OpenAI (GPT-4o) │ Anthropic (Claude) │ Groq (Llama) │ Ollama (local) │
└─────────────────────────────────────────────────────────────────────────┘
```

## Fluxo de uma sugestão de IA

```
1. Usuário digita no WhatsApp Web
       │
       ▼
2. ContentScript (text-monitor.js) detecta input
       │
       ▼
3. EventBusCentral emite evento 'text:input'
       │
       ▼
4. AIGateway (background) recebe via runtime.sendMessage
       │
       ├─→ [cache hit] → retorna sugestão imediata
       │
       └─→ [cache miss] → BackendClient.POST /api/ai/suggest
                               │
                               ▼
                         Backend → AIOrchestrator
                               │
                               ├─→ FewShotLearning (exemplos validados)
                               ├─→ RAG (knowledge_base)
                               └─→ AI Provider (OpenAI/etc)
                                        │
                                        ▼
                               Resposta → FeatureGate
                               (verifica subscription)
                                        │
                                        ▼
                         SuggestionInjector injeta no DOM
```

## Módulos críticos da extensão

| Módulo | Arquivo | Responsabilidade |
|--------|---------|-----------------|
| EventBus | `modules/event-bus-central.js` | Comunicação desacoplada entre módulos |
| AIGateway | `modules/ai-gateway.js` | Proxy de IA com cache e fallback |
| BackendClient | `modules/backend-singleton.js` | Conexão única com o backend |
| TabCoordinator | `modules/tab-coordinator.js` | Evita conflitos em multi-tab |
| FeatureGate | `modules/feature-gate.js` | Controle de acesso por subscription |
| RecoverAdvanced | `modules/recover-advanced.js` | Recuperação de mensagens |
| KillSwitch | `modules/kill-switch.js` | Desativação de emergência remota |

## Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/health` | Health check (público) |
| POST | `/api/auth/login` | Autenticação |
| POST | `/api/auth/refresh` | Renovar token |
| GET | `/api/contacts` | Listar contatos |
| POST | `/api/contacts` | Criar contato |
| PUT | `/api/contacts/:id` | Atualizar contato |
| GET | `/api/campaigns` | Listar campanhas |
| POST | `/api/campaigns` | Criar campanha |
| PATCH | `/api/campaigns/:id/pause` | Pausar campanha |
| PATCH | `/api/campaigns/:id/resume` | Retomar campanha |
| GET | `/api/conversations` | Listar conversas |
| POST | `/api/ai/suggest` | Sugestão de IA |
| POST | `/api/ai/train` | Treinar com exemplo |
| GET | `/api/recover/recent` | Mensagens recuperadas |
| POST | `/api/recover/ingest` | Ingerir mensagem para recover |
| GET | `/api/subscription/status` | Status da assinatura |

## Decisões de arquitetura

**Por que IIFE em vez de ES Modules na extensão?**
Chrome extensions MV3 com content scripts precisam de compatibilidade máxima. IIFEs com namespace global (`window.WHLModulo`) evitam conflitos e funcionam sem bundler.

**Por que SQLite em desenvolvimento?**
Zero configuração, portável, suficiente para volumes de uso individual/pequenas equipes. Migrar para PostgreSQL em produção é suportado via `DATABASE_URL`.

**Por que EventBus centralizado?**
Desacopla os módulos, facilita testes unitários e evita dependências circulares entre os mais de 80 módulos da extensão.
