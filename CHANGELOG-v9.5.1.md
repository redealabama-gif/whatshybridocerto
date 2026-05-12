# WhatsHybrid Pro — v9.5.1 (Training UI Simplification)

**Data:** 2026-05-08
**Tipo:** Simplificação (não-breaking) — remoção de fachada + 1 feature nova
**Filosofia:** "Esconder feature inacabada é melhor que mostrar feature quebrada"

---

## Resumo executivo

O módulo de treinamento da IA tinha 10 abas e ~6.300 linhas, das quais ~50% era
fachada — UI que renderizava mas nunca era alimentada em runtime real. Auditoria
empírica confirmou que 7 módulos estavam órfãos (zero uso fora da própria UI de
treinamento) e 2 botões eram fakes (mudavam só `textContent`).

**Resultado:** 7 abas em vez de 10, 4.839 linhas em vez de 6.333 (-23%), 8
arquivos JS deletados, 1 feature nova (botão "✏️ Editar" na curadoria de
respostas).

---

## REMOVIDO

### Abas (3)
- 🎯 **Gaps** — Aba mostrava dados zerados; `gap-detector.js` nunca foi
  alimentado por runtime real (apenas inicializado vazio).
- 🧪 **A/B Test** — `ab-testing.js` órfão (zero referências fora do training/).
- 📊 **Analytics** — Mostrava dados mockados (intenções calculadas como
  `Math.floor(suggestionsUsed * 0.8)`), `quality-scorer` e `sentiment-tracker`
  órfãos.

### Módulos JS deletados (8 arquivos / 3.608 linhas)

| Arquivo | Linhas | Motivo |
|---------|-------:|--------|
| `training/modules/gap-detector.js` | 360 | Órfão — só usado em `renderGapsTab` removida |
| `training/modules/ab-testing.js` | 342 | Órfão — só usado em `renderAbTestingTab` removida |
| `training/modules/sentiment-tracker.js` | 437 | Órfão — só usado em `renderSentimentMetrics` removida |
| `training/modules/quality-scorer.js` | 402 | Órfão — só usado em `renderCategoryScores` removida |
| `training/modules/dataset-exporter.js` | 464 | Órfão — fine-tuning export removido |
| `training/modules/advanced-scenarios.js` | 631 | Órfão — nunca chamado em runtime |
| `training/modules/adaptive-persona.js` | 442 | Órfão — nunca chamado em runtime |
| `training/modules/external-kb.js` | 530 | Órfão — `fetchGoogleSheets()` nunca chamado pela UI |

`modules/ai-ab-testing.js` (módulo de produção, nome similar mas arquivo
diferente) **NÃO foi tocado** — protegido pela REGRA 1.

### Botões fakes (2)
- `btnConnectExecutor` ("📱 CONECTAR WHATSAPP" no robô executor) — só mudava
  `textContent` (linhas 1722-1726 do training.js v9.5.0).
- `btnConnectSimulator` (idem no robô simulador) — mesma fachada.
- Status `.robot-status` removido junto (perdia sentido sem o botão).

### Aba Importar — simplificações
- Bloco "🔗 Conectar Bases Externas" removido (Google Sheets, Notion, Airtable,
  API custom). `connectGoogleSheets()`, `connectNotion()`, modais
  `sheetsModal`/`notionModal` deletados.
- Bloco "💾 Exportar para Fine-Tuning" removido (botões JSONL/Alpaca/ShareGPT/CSV
  e `#exportStats`). `exportToFormat()` deletado.
- Suporte **PDF removido** (`processPDF()` retornava só "instale PDF.js");
  `accept=".csv,.txt,.json,.pdf"` → `".csv,.txt,.json"`.

### Texto / branding
- Header: "🧠 Treinamento Neural" → "🎓 Treinamento da IA"
- Aba Simulação: "🧠 Simulação Neural" → "🧠 Simulação de Conversa"
- Subtítulo: "Conecte seus robôs e veja a mágica acontecer..." → "Treine a IA
  simulando conversas reais. Aprovações alimentam o aprendizado
  automaticamente."
- Bloco de marketing "Treine sua IA em Minutos" removido (era estático e
  irrelevante na aba de produção).

---

## ADICIONADO

### Botão "✏️ Editar" na curadoria de respostas

Antes, ao gerar resposta na simulação, o cliente só podia **Aprovar** ou
**Rejeitar**. Se a resposta estava 80% boa, era jogada fora.

Agora a curadoria tem 3 botões: **Aprovar / Editar / Rejeitar**. Ao clicar em
Editar:
1. Modal abre com a resposta original (read-only) e textarea editável
2. Cliente ajusta o texto
3. Ao salvar, a versão editada vira **exemplo aprovado de qualidade 10**
   (vs. qualidade 9 das aprovações sem edição)
4. Metadata `edited: true` + `editedAt: <timestamp>` é gravada em
   `whl_few_shot_examples`
5. Tag `'edited'` adicionada ao exemplo
6. `source: 'neural_simulation_edited'` em vez de `'neural_simulation'`

Implementação:
- `training/training.js` — método `editMessage(messageId)` (~70 linhas)
- `training/simulation-engine.js:670` — `addExample()` agora grava `edited`,
  `editedAt`, `quality: response.edited ? 10 : 9`, tag `'edited'`
- `training/training.css` — regra `.btn-edit-msg` (laranja, distinta
  visualmente)

---

## ATUALIZADO

### Manifests
- `manifest.json`, `manifest-prebuild.json` — `web_accessible_resources` limpo
  (8 entradas removidas, 3 novas)
- Versões: extensão 9.5.0→9.5.1, backend 9.5.0→9.5.1

### `document-importer.js`
- `supportedFormats: ['pdf','csv','txt','json','xlsx']` →
  `['csv','txt','json']`
- `processPDF()` removido
- Header de docstring atualizado

---

## TAREFA 5 (Voz) — Decisão: **MANTER**

Auditoria do backend `whatshybrid-backend/src/routes/speech.js`:

- ✅ Rota `/api/v1/speech/transcribe` implementada com auth, rate limit
  (`aiLimiter`), validação de mimetype (whitelist estrita), tamanho máximo
  25MB, timeout 90s
- ✅ Frontend `voice-recorder.js` → `speech-to-text.js` →
  `interactive-training.js` carregam corretamente em `tabVoice`
- ✅ Container `#voiceTrainingContainer` mantido no HTML
- ⚠️ Requer `OPENAI_API_KEY` configurada no `.env` do servidor (Whisper
  ~$0.006/min). Sem a key, retorna 500 com mensagem clara: "API Key OpenAI não
  configurada no servidor"

**Caminho técnico está completo.** A decisão "manter" se baseia no fato de que
o código existente é funcional — não é fachada. A configuração de runtime
(API key) é responsabilidade do operador do servidor, não bug a corrigir.

---

## NÃO FOI ALTERADO

- Backend (`whatshybrid-backend/`) — escopo desta versão é só simplificação de
  UI de treinamento
- Build pipeline (`build.js`) — bundles continuam idênticos (training.html é
  página separada, não vai pro bundle)
- Módulos de PRODUÇÃO em `whatshybrid-extension/modules/*` — protegidos pela
  REGRA 1 (todos os deletes ficaram em `training/modules/`)
- Outras 22 correções da v9.5.0 (todas mantidas)

---

## Métricas

| Métrica | v9.5.0 | v9.5.1 | Δ |
|---------|-------:|-------:|---:|
| Abas no training UI | 10 | 7 | -3 |
| `training.html` | 970 | 638 | -332 (-34%) |
| `training.js` | 2.324 | 1.620 | -704 (-30%) |
| `training.css` | 2.210 | 2.228 | +18 (botão Editar) |
| `simulation-engine.js` | 829 | 832 | +3 (metadata edited) |
| `training/modules/` arquivos | 13 | 5 | -8 |
| `training/modules/` linhas | ~3.954 | ~346 | -3.608 (-91%) |
| **Total módulo treinamento** | **~10.300** | **~5.700** | **-4.600 (-44%)** |

---

## Validação

- ✅ `node --check` — sintaxe OK em training.js, simulation-engine.js,
  document-importer.js
- ✅ `JSON.parse(manifest.json)` — válido
- ✅ Build da extensão (`node build.js`) — sucesso, bundles inalterados
- ✅ Testes unitários do backend (54 testes existentes) — passing
- ⚠️ Validação visual em browser: não executada (ambiente headless). REGRA 5 do
  prompt: CSS órfão preservado por segurança (não quebra layout, apenas adiciona
  ~5KB ao CSS).

---

## Compatibilidade

- **Não-breaking** para clientes existentes:
  - `whl_knowledge_base` e `whl_few_shot_examples` mantêm mesmo schema
  - Novos exemplos editados ganham campos extras (`edited`, `editedAt`) que são
    opcionais — versões anteriores ignoram
- **Quebra silenciosa** apenas em código que dependia de:
  - `window.gapDetector`, `window.abTesting`, `window.qualityScorer`,
    `window.sentimentTracker`, `window.datasetExporter`, `window.externalKB`,
    `window.advancedScenarios`, `window.adaptivePersona` — todos eram
    estritamente internos ao training/, sem uso externo confirmado por grep.

---

## Migração / Upgrade

Nenhuma ação necessária. Reinstalar a extensão e o backend. Storage do cliente
preservado.
