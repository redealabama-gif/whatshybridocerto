# WhatsHybrid Pro — v9.5.5 (Cost Tracking + Specialized Assistants + Memory Events)

**Data:** 2026-05-09
**Tipo:** Novas features (não-breaking) — observabilidade econômica + roteamento por especialistas + telemetria granular
**Inspiração:** Padrões adotados do projeto irmão `redealabama_railway_ready` (PHP)

---

## Resumo

3 features adotadas após análise do projeto Rede Alabama:
1. **Token usage + cost tracking** (`llm_cost_log`) — operador SaaS finalmente vê quanto gasta por workspace, provider, modelo, dia
2. **Framework de assistentes especializados** — 3 assistentes (oferta/objeção/recuperação) com playbooks próprios injetados no prompt quando a situação detecta
3. **Memory event queue** ("Leão" pattern) — fila granular de eventos com flush em batch para o backend, complementando o sync whole-blob existente

---

## ADICIONADO

### 1. Token Usage + Cost Tracking

**Backend:**
- **Migration `008_llm_cost_log.sql`** — tabela com `provider, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, http_status, cost_usd, intent, chat_id`
- **`src/services/CostLoggerService.js`** — pricing table para 13 modelos (OpenAI/Anthropic/Groq/Google), fallback por provider quando modelo desconhecido. Métodos:
  - `log({...})` — fire-and-forget per request
  - `summarize(workspaceId, days)` — agregações por provider/model/day
  - `computeCostUsd(provider, model, prompt, completion)` — cálculo standalone
- **`POST /api/v1/ai/complete`** — agora chama `CostLoggerService.log()` após cada chamada bem-sucedida (sem bloquear se logger falhar)
- **`GET /api/v1/ai/costs/summary?days=30`** — retorna `{ requestCount, totalTokens, totalCostUsd, byProvider, byModel, byDay }`

**Pricing table (USD/1M tokens):**
| Modelo | Input | Output |
|--------|------:|-------:|
| gpt-4o | 2.50 | 10.00 |
| gpt-4o-mini | 0.15 | 0.60 |
| claude-3-5-sonnet | 3.00 | 15.00 |
| claude-3-haiku | 0.25 | 1.25 |
| llama-3.3-70b | 0.59 | 0.79 |
| gemini-1.5-flash | 0.075 | 0.30 |

Pricing histórico é preservado — atualizar `PRICING` afeta só requests futuros, rows antigos mantêm o `cost_usd` calculado no momento.

**Por que importa:** Em produção SaaS, sem isso o operador não sabe a margem por workspace. Critical para precificação e detecção de workspace que está abusando.

---

### 2. Framework de Assistentes Especializados

**Novo:** `whatshybrid-extension/modules/specialized-assistants.js` (~180 linhas)

3 assistentes built-in com playbook próprio:

#### `sales_smart_offer` — Especialista em Ofertas
- **Triggers:** "desconto", "promoção", "à vista", "tem condição", "quanto custa", "preço", "valor"
- **Playbook:** Confirmar produto → preço cheio com confiança → oferecer 1 condição diferenciada → urgência sutil (se verdadeira) → pergunta de avanço
- **Exemplos:** "Qual o valor?" → "É R$ 199. À vista no PIX fica R$ 179. Quer que eu separe?"

#### `sales_objection` — Resolução de Objeções
- **Triggers:** "tá caro", "muito caro", "vou pensar", "não cabe", "fora do orçamento"
- **Playbook:** Acolher sem combater → pergunta para entender objeção real → oferecer alternativa (parcelar / produto menor) ou prova social → se "vou pensar", propor follow-up concreto
- **Tom:** empático, sem pressão. Nunca "deixa eu te convencer"

#### `sales_recovery` — Recuperação de Cliente
- **Trigger:** Profile-based — `daysSinceLastContact ≥ 30` ou último contato há 30+ dias (não keyword)
- **Playbook:** Cumprimento sem cobrança → referência sutil a interação anterior → novidade ou condição especial → pergunta aberta de baixo compromisso
- **Tom:** leveza, máx 2 frases

**Como funciona:**
- `pickAssistant(transcript, lastUserMsg, profile)` retorna o assistente com maior confiança (mín 0.55)
- 1 keyword match = 0.7, 2+ matches = 0.95, profile-based = 1.0
- Quando match: injeta `ASSISTENTE ESPECIALIZADO ATIVADO: <nome>` + playbook no system prompt + 1-2 exemplos canônicos como `user/assistant` turns
- Emite `ai:assistant:picked` no EventBus para telemetria

**Extensível:** `WHLAssistants.register({ id, name, triggers, promptAddition, examples })` permite o operador definir assistentes próprios.

**Por que importa:** Maior salto qualitativo. IA passa de "chatbot genérico" para "vendedor que sabe negociar". Mensagem "achei caro" agora invoca playbook de objeção (não tenta combater preço, faz pergunta investigativa).

---

### 3. Memory Event Queue (Leão Pattern)

**Novo extension:** `whatshybrid-extension/modules/memory-event-queue.js`

**Padrão adotado:** Alabama `serviceWorker.js:62-93` — fila local granular com flush em batch.

**Como funciona:**
- Captura individual events (não whole-blob): `feedback`, `successful_interaction`, `ai_tier_hit`, `assistant_picked`, `safety_blocked`, custom `memory:event`
- Fila local em `chrome.storage.local.whl_memory_event_queue` — bounded em 500 events (drop oldest se overflow)
- Flush triggers: `setInterval(30s)` OU queue ≥ 50 events
- Falhas re-enfileiram (front da queue) para retry no próximo interval
- Auto-flush em `beforeunload`

**Backend:**
- **Migration `009_memory_events.sql`** — tabela `memory_events (id, workspace_id, user_id, event_type, payload, client_ts, created_at)` com índice por `(workspace_id, event_type, created_at)`
- **`POST /api/v1/sync/ai_memory_events`** — aceita `{ events: [...] }` (max 100 por batch), insere todos
- **`GET /api/v1/sync/ai_memory_events?since=<ts>&type=<filter>&limit=<n>`** — query timeline cross-device

**Complementa (não substitui)** o `data-sync-manager.js` existente:
- `data-sync-manager` sincroniza whole-blob de `whl_ai_memory`, `whl_few_shot_examples`, `whl_knowledge_base` (estado)
- `memory-event-queue` registra events (timeline), permitindo:
  - Reconstrução de timeline por chat
  - Analytics granulares (quantas safety_blocks no mês? quantos tier_0 vs tier_3?)
  - Cross-device — events do device A são queryable por device B

**Por que importa:** Persistência granular sobrevive a edge cases (queda de rede, troca de device, sync paused).

---

## NÃO FOI ALTERADO

- Caminho primário Tier 0 (Backend AIOrchestrator) — robusto, 12 camadas
- Pipeline de fallback Tier 1-5 — funcionando
- Few-shot, Knowledge Base, RAG, autopilot, safety filter — sem mudanças além das wirings
- Outras correções v9.5.0–v9.5.4 — todas mantidas

---

## Validação

- ✅ `node --check` em 5 arquivos editados/novos — sintaxe OK
- ✅ JSON manifests + migrations válidos
- ✅ `node build.js` — bundles regenerados
- ✅ Smoke test assistants — 5/5 corretos:
  - "Tem desconto à vista?" → `sales_smart_offer` ✓
  - "Achei muito caro" → `sales_objection` ✓
  - "Vou pensar" → `sales_objection` ✓
  - "Quanto custa?" → `sales_smart_offer` ✓
  - "Boa tarde" + 45d profile → `sales_recovery` ✓
- ✅ Smoke test cost logger — cálculos USD corretos:
  - gpt-4o 1000+500 → $0.0075
  - claude-3-5-sonnet 5000+1000 → $0.03
  - llama-3.1-8b 10000+500 → $0.00054
  - modelo desconhecido → fallback por provider
- ✅ **114 testes de backend passando, 0 falhas**
- ⚠️ Validação visual em browser real: não executada (ambiente headless)

---

## Métricas

| Bundle | v9.5.4 | v9.5.5 | Δ |
|--------|-------:|-------:|---:|
| `content-bundle.js` | 1347.5 KB | 1355.7 KB | +8 KB |
| `advanced-bundle.js` | 374.5 KB | 375.4 KB | +1 KB |
| **Total** | 1.821 KB | 1.831 KB | +10 KB |

10KB adicionados pelo:
- `specialized-assistants.js` (~6KB)
- `memory-event-queue.js` (~3KB)
- Wirings em `ai-suggestion-fixed.js` (~1KB)

Backend: 1 service + 1 route + 2 migrations.

---

## Compatibilidade

- **Não-breaking** total. Sem flag, sem migração de dados.
- Feature 1 (cost log): backwards-compatible — endpoint `/api/v1/ai/usage` antigo ainda funciona (continua usando `analytics_events`).
- Feature 2 (assistants): falha gracioso — se `WHLAssistants` não carregar, prompt continua igual ao v9.5.4.
- Feature 3 (memory events): coexiste com sync whole-blob. Se backend não responde, events ficam na queue local até cair (depois drop oldest).

---

## Migração

`npm run migrate` no backend para aplicar `008_llm_cost_log.sql` + `009_memory_events.sql`. Migration runner é idempotente — pular se já aplicada.
