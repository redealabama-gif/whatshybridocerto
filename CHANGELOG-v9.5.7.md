# WhatsHybrid Pro — v9.5.7 (Confidence Score Growth Fix + Full Project ZIP)

**Data:** 2026-05-09
**Tipo:** Correção crítica de bug + correção de packaging
**Filosofia:** "O autopilot foi desenhado para crescer com feedback. Agora ele cresce de fato."

---

## Bugs corrigidos

### BUG #1 — `recordSuggestionUsed` nunca atualizava métricas (silent no-op)

**Sintoma:** Score de confidence nunca passava de ~35 pontos. Autopiloto (limiar 85) impossível de ativar legitimamente.

**Causa raiz:** Mismatch de nome de método.
- `confidence-system.js:440` define: `recordSuggestionUsage(edited)`
- `suggestion-injector.js:409,431` chama: `recordSuggestionUsed(false/true)` (sem o "age")
- Optional chaining (`?.`) silenciosamente fazia no-op desde a v8.x

Resultado: `metrics.suggestionsUsed` e `metrics.suggestionsEdited` ficavam **sempre em 0**. Componente "Usage Score" do score (max 25 pts) ficava sempre em 0.

**Fix:** Adicionado alias `recordSuggestionUsed` que delega para `recordSuggestionUsage`. Suggestion-injector e qualquer outro caller histórico passam a funcionar imediatamente sem alterações neles.

### BUG #2 — `sendConfidenceFeedback` não tinha callers

**Sintoma:** Componente "Feedback Score" do score (max 40 pts) ficava **sempre em 0** — `feedbackGood`/`feedbackBad` nunca incrementavam.

**Causa raiz:** Nada no codebase chama `sendConfidenceFeedback('good'|'bad'|'correction')`. O método existe mas é órfão.

**Fix:** Em `confidence-system.js:init()`, adicionado listeners no EventBus:
- `feedback:received` (emitido por `ai-feedback-system.js` em todo feedback rated 1-5) → mapeia para `good`/`bad`/`correction` e chama `sendConfidenceFeedback`
- `successfulInteraction` (emitido em rating ≥ 4) → chama `sendConfidenceFeedback('good')`

Score agora cresce organicamente conforme cliente:
- Aprova sugestões sem editar → `usageScore` sobe
- Dá feedback positivo (estrelas, polegares) → `feedbackScore` sobe
- Adiciona FAQs/produtos/exemplos → `knowledgeScore` sobe
- Autopilot manda mensagens com sucesso → `autoSendScore` sobe (capped 15)

Score máximo achievable agora: **100** (era ~35).

---

## Como o autopiloto agora funciona (premissa SaaS validada)

| Score | Nível | Autopilot ativável? |
|------:|:-----:|:-------------------:|
| 0-29 | 🔴 Beginner | Não — IA ainda não conhece o negócio |
| 30-49 | 🟠 Learning | Não — em fase de aprendizado |
| 50-69 | 🟡 Assisted | Não — apenas sugestões manuais |
| 70-84 | 🟢 Copilot | **Manualmente sim, mas aviso de risco** |
| **85-89** | 🟢 Copilot+ | **✅ Autopilot ativável (limiar v9.5.4)** |
| 90-100 | 🔵 Autonomous | **✅ Autopilot 100% liberado** |

Cliente vê o crescimento em tempo real. Quando atinge 85, o sistema confia que ele treinou o suficiente.

---

## Packaging — ZIP COMPLETO restaurado

**Bug que estava acontecendo:** Versões v9.5.2 a v9.5.6 estavam empacotando apenas `whatshybrid-extension/` + `whatshybrid-backend/` + 1 changelog. A versão v9.5.1 (e anteriores) empacotavam o **projeto inteiro** (~616 arquivos).

**Fix:** v9.5.7 volta a incluir tudo:
- `whatshybrid-extension/` — extension completa
- `whatshybrid-backend/` — backend completo
- `deploy/` — scripts de Caddy, deploy, backup, health, install, restore
- `docs/`, `docs-site/` — documentação
- `scripts/` — scripts de manutenção
- `.github/` — CI workflows + dependabot
- `BRAND_CONFIG.json`, `package.json`, `package-lock.json`
- `README.md`, `RUNBOOK.md`, `DEPLOY.md`, `CONTRIBUTING.md`, `LICENSE`
- `docker-compose.yml`
- **TODOS** os CHANGELOGs (v8.5 → v9.5.7)

---

## Validação

- ✅ `node --check` em `confidence-system.js` — sintaxe OK
- ✅ Build limpo (3 bundles)
- ✅ **114 testes de backend passando**
- ⚠️ Validação visual em browser real: não executada (ambiente headless)

---

## Compatibilidade

- **Não-breaking** total. Customers existentes:
  - Score começa a crescer organicamente após o update (zero ação necessária)
  - Histórico de `feedbackGood/Bad`/`suggestionsUsed/Edited` que estava em 0 começa a ser populado a partir desta versão
  - Quem mexeu manualmente em `minConfidence` para baixar autopilot continua funcionando

- **Recomendação:** Após instalar v9.5.7, deixar o cliente operar normalmente por ~1-2 semanas. Score deve subir naturalmente conforme uso e feedback. Quando passar 85, autopilot fica disponível com confiança real.
