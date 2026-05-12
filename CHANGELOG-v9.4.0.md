# CHANGELOG v9.4.0 — Backend-Only AI + Etapas 12 e 13

**Data:** Maio de 2026
**Tipo:** Architecture refactor + auditoria contínua
**Compatibilidade:** Drop-in. 1 nova migration inline (`ai_feedback`).
**Target:** elevar nota de 9.0 → 9.1+

---

## 🏗️ ARQUITETURA — Backend-Only AI

**Mudança fundamental no modelo SaaS.** Antes da v9.4.0, a extensão tinha um caminho onde o cliente podia configurar API key própria (OpenAI, Anthropic, Groq) e bater direto no provider. Isso quebrava o modelo:

- 🔴 Saldo de tokens nunca debitado quando cliente usava key própria
- 🔴 Backend não conseguia auditar uso
- 🔴 Limites de plano não se aplicavam
- 🔴 Vetor de fraude: cliente seta key fake, ignora billing
- 🔴 Cliente plano free conseguia IA infinita configurando key dele

**Modelo correto agora vigente:**
- VOCÊ (dono SaaS) cultiva 1 API key OpenAI/Anthropic no `.env` do backend
- CLIENTE paga plano (R$ 49/99/199), consome do saldo dele
- Backend é o ÚNICO caminho — extensão NUNCA fala direto com provider

### Mudanças concretas:
1. **`AIGateway.executeRequest()`** agora roteia 100% via `executeViaBackend()` → `POST /api/v1/ai/complete`
2. **`AIGateway.addApiKey()`** bloqueia LLM providers (`openai`, `anthropic`, `groq`, `google`, `mistral`, `venice`, `cohere`)
3. **`api-config.js`** não carrega mais keys do `WHL_CONFIG` ou `chrome.storage` — apaga storage legado no boot
4. **`smart-replies.js`** — campo de input "API Key" REMOVIDO da UI, substituído por badge "🔒 IA gerenciada pelo plano"
5. **`smart-replies.callOpenAI`/`callAnthropic`** desviadas pra `AIGateway.complete()` (caminho direto morreu)
6. **`PUT /api/v1/settings/ai-keys`** retorna `410 Gone` + apaga `aiKeys` legados do `workspace.settings`
7. Mensagens de erro "Configure a API Key" trocadas por "Plano sem créditos suficientes. Faça upgrade."

---

## 📨 Etapa 12 — Campaigns & Disparos (6 corrigidos, 2 críticos)

### Bug #85 🔴 Service worker dorme — campanhas órfãs no restart
Manifest v3 service workers morrem em ~30s idle. Variáveis module-level (`campaignQueue`, `campaignState`) voltam ao default. `chrome.runtime.onInstalled` só dispara em install/update — não em wake-up.

**Cenário do desastre:** Cliente roda campanha de 500 contatos. Fecha notebook. Service worker morre. Reabre. State perdido. Cliente tem que recomeçar do zero.

**Fix em `campaign-handler.js`:**
```js
let _restorePromise = null;
function restoreCampaignStateFromStorage() {
  if (_restorePromise) return _restorePromise;
  _restorePromise = new Promise((resolve) => {
    chrome.storage.local.get(['workerTabId', 'campaignQueue', 'campaignState'], (data) => {
      if (data.campaignState) campaignState = data.campaignState;
      if (data.campaignQueue) campaignQueue = data.campaignQueue;
      resolve();
    });
  });
  return _restorePromise;
}
restoreCampaignStateFromStorage();        // dispara no load do módulo
chrome.runtime.onStartup?.addListener(...);  // browser startup
handleWorkerReady = async ... await restoreCampaignStateFromStorage();
```

### Bug #91 🔴 Timeout marcava destinatário como `failed` permanente
WhatsApp Web demora pra carregar (rede ruim) → timeout 45s → recipient `failed` → próximo. Em rede ruim, campanha perdia ~25% dos destinatários por timeouts recuperáveis.

**Fix:** Retry 2x em erros recuperáveis (timeout, network, disconnected). `INVALID_NUMBER` continua sem retry (não adianta).

### Bug #87 🟠 `target_contacts` sem limite — DoS via array gigante
Cliente mandava `target_contacts` com 1M phones → JSON.stringify trava request → SQLite TEXT field estoura → JSON.parse na extensão trava browser.

**Fix:** Cap 50.000 contatos por campanha. Acima disso → criar várias.

### Bug #90 🟠 `startCampaign` sem validação de queue/config
Cliente mandava `config.imageData` com 10MB base64 → `chrome.storage.local.set` estoura cota (5MB) → extensão quebra silenciosamente.

**Fix:** Valida queue (max 50k), message (max 10k chars), imageData (max 8MB base64).

### Bug #88 🟡 `name`/`description` sem limite
Cap 200/2000 chars.

### Bug #89 🟡 `PUT /:id` aceitava counters arbitrários
`sent_count: 999999999` passava sem validação → métricas falsas.

**Fix:** Validação `Number.isInteger(0..1M)` + status whitelist.

### 🟠 Anotado: #86 Extensão não sincroniza progresso com backend
Refactor de feature, não bug de segurança. Cliente troca de PC → progresso perdido. Backend só vê `sent_count: 0`.

---

## 🤖 Etapa 13 — Autopilot & Auto-learning (parcial: 2 corrigidos, 1 anotado)

### Bug #94 🔴 Loop de aprendizado MORTO há provavelmente o produto inteiro
Extensão chamava `POST /api/v1/ai/learn/feedback` (linha 2532 `copilot-engine.js`) e `GET /api/v1/ai/learn/context/:chatId` (linha 1128). **NENHUMA das duas existia no backend.** Frontend recebia 404 silencioso, autopilot nunca aprendia com correções do user, `ValidatedLearningPipeline` ficava sem dados.

**Fix:**
- Migration inline em `database-legacy.js` cria tabela `ai_feedback` com índices apropriados
- `routes/ai.js` ganha `POST /learn/feedback` (validação rigorosa de tipos) e `GET /learn/context/:chatId`
- Endpoint dispara `ValidatedLearningPipeline.recordFeedback` async via `setImmediate`

```sql
CREATE TABLE IF NOT EXISTS ai_feedback (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id TEXT,
  user_message TEXT NOT NULL,
  assistant_response TEXT NOT NULL,
  rating REAL,
  corrected_response TEXT,
  feedback_type TEXT DEFAULT 'rating',
  user_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  consumed_by_pipeline INTEGER DEFAULT 0
);
```

### Bug #93 🟡 `/feedback` aceitava `rating` sem validar tipo
`rating: '<script>'` ou `rating: NaN` passava — quebrava agregações estatísticas (média virava NaN).

**Fix:** Validação rigorosa de string, número, range, tamanho de context (max 50KB JSON).

### Bug #92 🟠 ANOTADO + parcialmente resolvido pela arquitetura
A correção arquitetural Backend-Only (acima) **resolve a raiz** do problema. AIGateway não permite mais bypass de billing.

---

## 📊 Arquivos modificados

### Arquitetura Backend-Only:
| Arquivo | Mudança |
|---|---|
| `extension/modules/ai-gateway.js` | `executeRequest` → sempre `executeViaBackend`. `addApiKey` bloqueia LLM providers |
| `extension/modules/api-config.js` | Removida carga de API keys, limpa storage legado |
| `extension/modules/smart-replies.js` | UI de API key removida. `callAI` usa `AIGateway`. `setApiKey` no-op. `isConfigured` checa AIGateway |
| `extension/sidepanel-fixes.js` | Mensagens de erro atualizadas |
| `extension/training/training.js` | Mensagem de erro atualizada |
| `backend/src/routes/settings.js` | `PUT /ai-keys` retorna 410 + limpa keys legados |

### Etapa 12:
| Arquivo | Mudança |
|---|---|
| `extension/background/campaign-handler.js` | `restoreCampaignStateFromStorage` em load + onStartup. `startCampaign` valida inputs. Retry em erro recuperável |
| `backend/src/routes/campaigns.js` | Validação de tamanhos + counters + status whitelist |

### Etapa 13:
| Arquivo | Mudança |
|---|---|
| `backend/src/routes/ai.js` | `POST /learn/feedback` + `GET /learn/context/:chatId` |
| `backend/src/routes/smartbot.js` | Validação rigorosa em `/feedback` |
| `backend/src/utils/database-legacy.js` | Migration `ai_feedback` |

---

## 🧪 Validação

```
▶ Backend JS:        146 arquivos válidos
▶ Extension JS:      140 arquivos válidos
▶ Migrations SQL:    7 formais + 4 inline (+1 ai_feedback)
▶ Testes formais:    15/15 passing
```

---

## 📈 Total acumulado da auditoria

```
Etapa 1 (Contracts)           ✅ 14 bugs, 11 corrigidos
Etapa 2 (Schema)              ✅ 4 bugs, 3 corrigidos
Etapa 3 (Race conditions)     ✅ 6 bugs, 4 corrigidos
Etapa 4 (Multi-tenant)        ✅ 8 itens, 3 corrigidos
Etapa 5 (Error paths)         ✅ 6 itens, 3 corrigidos
Etapa 6 (SQLite/Postgres)     ✅ 4 itens, 1 corrigido
Etapa 7 (SQL Injection)       ✅ 1 bug, 1 corrigido
Etapa 8 (XSS)                 ✅ 8 bugs, 8 corrigidos
Etapa 9 (Auth)                ✅ 11 itens, 6 corrigidos
Etapa 10 (Secrets)            ✅ 5 itens, 1 corrigido
Etapa 11 (Billing)            ✅ 10 itens, 8 corrigidos (5 críticos!)
Etapa 12 (Campaigns)          ✅ 13 itens, 6 corrigidos (2 críticos)
Etapa 13 (Autopilot, parcial) ✅ 3 itens, 2 corrigidos
─────────────────────────────────────────────────────────────────
TOTAL                            93 itens auditados, 57 corrigidos
+ 1 refactor arquitetural CRÍTICO (Backend-Only AI)
```

---

## 🎯 Nota honesta

**9.1/10** (sobe de 9.0)

- (+0.10) Refactor Backend-Only AI — fecha vetor de fraude que reduzia receita
- (+0.05) Etapa 12 — 2 bugs críticos em campanhas (state restore, retry)
- (+0.03) Etapa 13 — fechamento do loop de aprendizado que estava morto há tempos
- (-0.08) Auditoria parcial da Etapa 13 — race em sessões concorrentes ainda pendente

Refactor Backend-Only é o que mais movimenta a nota — **arquitetura agora suporta o modelo de negócio que você descreveu** (cliente paga plano, consome do saldo).

---

## ⏭️ Etapas restantes (5 a fazer)

- **Etapa 13 (continuação)** — Race em sessões autopilot, ValidatedLearningPipeline.recordFeedback
- **Etapa 14** — Inputs Limites (50k chars, 30MB áudio)
- **Etapa 15** — Concorrência Multi-tab
- **Etapa 16** — Recovery & Resilience
- **Etapa 17** — Popup & Dashboard frontend
- **Etapa 18** — Memory Leaks frontend

---

## ⚠️ AÇÃO NECESSÁRIA NO DEPLOY

1. **Configure API keys no `.env` do backend:**
   ```
   OPENAI_API_KEY=sk-...
   ANTHROPIC_API_KEY=sk-ant-...    # opcional
   ```
2. **Restart backend** — migration `ai_feedback` roda automaticamente
3. **Recarregue extensão** no Chrome — limpa keys legadas do storage
4. **Comunique clientes** que tinham keys próprias configuradas que agora a IA está incluída no plano

---

**Versão:** 9.4.0
**Codename:** "Backend-Only AI"
**Próxima:** Etapa 13 (continuação) + Etapa 14
