# WhatsHybrid Pro — v9.5.2 (Training Effectiveness)

**Data:** 2026-05-08
**Tipo:** Melhorias funcionais (não-breaking) — eficácia de treinamento
**Filosofia:** "Os exemplos de treinamento existem; agora façamos eles importarem."

---

## Resumo executivo

Auditoria pós-v9.5.1 identificou 8 gaps que reduziam a eficácia do sistema de
treinamento. Todos foram corrigidos em mudanças cirúrgicas (sem deletar nada,
sem refatorações grandes). O resultado: exemplos editados (qualidade 10) agora
realmente sobrevivem ao pruning, sinônimos do português brasileiro são
reconhecidos na seleção de exemplos, exemplos antigos perdem peso
gradualmente, e a aba Voz funciona offline via Web Speech API quando o
backend não tem `OPENAI_API_KEY`.

---

## ALTERADO — Few-Shot Learning (`modules/few-shot-learning.js`)

### 1. Sinônimos do domínio na seleção de exemplos
Antes, `pickRelevantExamples` fazia overlap simples de palavras ≥ 4 chars.
"valor" não matchava "preço". "frete" não matchava "entrega". Resultado:
exemplos relevantes eram ignorados e o fallback retornava os 2 mais usados.

Agora um dicionário de 10 grupos de sinônimos (preço/valor/custo,
entrega/frete/envio, cancelar/cancelamento/devolver, pagamento/boleto/pix,
horário/funciona/expediente, estoque/disponível, desconto/promoção/cupom,
garantia/troca/defeito, endereço/localização, contato/telefone) normaliza
palavras antes do match. Verificado por smoke test: "Tem frete?" agora
seleciona corretamente o exemplo "Como faço a entrega?".

### 2. Decay de relevância por idade
`createdAt` é gravado mas nunca entrava no scoring. Agora:
```
recencyMultiplier = max(0.4, 1 - (idadeEmDias / 180) * 0.6)
```
Exemplos com 30 dias mantêm 90% do peso, com 90 dias 70%, com 180+ dias o
piso de 40%. Isso prioriza exemplos novos sem descartar conhecimento histórico.

### 3. Boost de qualidade nos exemplos editados
Quando você usa o botão ✏️ Editar (introduzido na v9.5.1), o exemplo recebe
`quality: 10`. Antes, esse campo era gravado mas nunca usado. Agora:
- No scoring de seleção: multiplicador 1.5x para quality ≥ 10
- No pruning quando excede MAX_EXAMPLES (60): exemplos editados têm prioridade
  de sobrevivência sobre exemplos antigos muito usados de qualidade 9

### 4. `incrementUsage(exampleId)` — novo método público
Wired em `ai-suggestion-fixed.js`: toda vez que um exemplo é selecionado para
um prompt em produção, seu `usageCount` é incrementado e `lastUsed`
atualizado. Antes esses campos existiam mas nunca eram tocados. Agora o
sistema realmente aprende quais exemplos ajudam.

---

## ALTERADO — Aba Curadoria (`training/training.js` + `training.css`)

### 5. Badges de qualidade + idade relativa
Cada card de exemplo agora mostra:
- **Badge laranja "✏️ Editado"** para exemplos quality 10 (curados manualmente)
- **Badge verde "9/10"** para aprovações sem edição
- **🕒 idade relativa** ("3d", "2 meses", "1 ano") em vez de só timestamp
- **📊 contador de uso** mais limpo

O operador agora consegue decidir conscientemente quais exemplos manter ou
deletar, ao invés de tomar decisões às cegas.

---

## ALTERADO — Simulação de Treinamento (`training/modules/ai-client.js`)

### 6. System prompt completo na simulação
Antes, o `TrainingAIClient` construía um system prompt mínimo: só `business.name`
+ tom + 5 FAQs. A produção (`knowledge-base.js:buildSystemPrompt()`) usa nome,
segmento, horário, tom, **políticas (pagamento/entrega/devolução), até 20
produtos com preços e estoque, 10 FAQs**.

Resultado: a IA na simulação respondia com menos contexto que a IA em
produção. Os exemplos aprovados pelo curador refletiam uma IA "mais burra".

Agora o `TrainingAIClient._buildSystemPrompt()` chama
`window.knowledgeBase.buildSystemPrompt()` quando o módulo está carregado.
Fallback inline melhorado também: passou a incluir produtos, políticas e 10
FAQs (era 5).

---

## ALTERADO — Aba Voz (`training/modules/speech-to-text.js` + `interactive-training.js`)

### 7. Fallback Web Speech API quando backend não responde
Antes, se o backend retornasse 500 (ex: `OPENAI_API_KEY` ausente), a aba Voz
ficava inutilizável. Agora:

1. Tenta o backend primeiro (Whisper, alta qualidade)
2. Se falhar com erro de OpenAI Key OU 5xx, e `window.SpeechRecognition`
   existe no browser, automaticamente alterna para transcrição local via
   Web Speech API
3. Toast informativo: *"Servidor indisponível. Tentando transcrição local..."*
4. Qualidade menor que Whisper, mas funciona offline e sem custo

A escolha do fallback é detectada por padrão: erro contém "openai" + "key/chave".
Erros normais (rede, formato inválido) continuam mostrando a mensagem original.

### 8. Novo método público `WHLSpeechToText.isWebSpeechAvailable()`
Permite que o UI consulte capabilities do browser antes de chamar `transcribeLive`.

---

## NÃO FOI ALTERADO

- Backend (`whatshybrid-backend/src/`) — sem mudanças, todas as melhorias são no
  cliente
- Build pipeline (`build.js`) — bundles continuam idênticos no formato
- Outras correções da v9.5.0/v9.5.1 (todas mantidas)
- Aba Importar, Curadoria, FAQs, Produtos, Empresa, Simulação na superfície —
  só ajustes internos de scoring/UI

---

## Métricas

| Métrica | v9.5.1 | v9.5.2 | Δ |
|---------|-------:|-------:|---:|
| `modules/few-shot-learning.js` | 814 | 882 | +68 (sinônimos + decay + incrementUsage) |
| `modules/ai-suggestion-fixed.js` | (sem mudança de tamanho material) | +4 linhas | wire incrementUsage |
| `training/modules/ai-client.js` | 226 | 250 | +24 (system prompt completo) |
| `training/modules/speech-to-text.js` | 117 | 175 | +58 (Web Speech fallback) |
| `training/modules/interactive-training.js` | (pequeno) | +25 linhas | fallback wire |
| `training/training.js` | 1.620 | ~1.660 | +40 (badges + formatRelativeAge) |
| `training/training.css` | 2.228 | ~2.260 | +32 (.quality-badge styles) |

---

## Validação

- ✅ `node --check` em todos os 6 arquivos editados — sintaxe OK
- ✅ `JSON.parse(manifest.json)` — válido (versão 9.5.2)
- ✅ `node build.js` — sucesso, bundles regenerados
  (core 99.8KB, content 1338.4KB, advanced 583.4KB)
- ✅ Smoke test inline do few-shot-learning — sinônimos, recency, quality boost
  e incrementUsage funcionando
- ✅ 11 arquivos de teste de backend — **114 testes, 0 falhas**
- ⚠️ Validação visual em browser real: não executada (ambiente headless)

---

## Compatibilidade

- **Não-breaking** total. Todos os exemplos existentes continuam funcionando.
- Exemplos antigos sem `quality` no schema recebem default 9.
- Exemplos antigos sem `createdAt` recebem `Date.now()` na primeira leitura.
- Sinônimos não removem o matching exato — apenas adicionam matches que antes
  eram perdidos.
- Web Speech fallback é puramente aditivo: se o backend funcionar, nada muda.

---

## Migração / Upgrade

Nenhuma ação necessária. Reinstalar a extensão e recarregar.
Storage do cliente preservado. Exemplos existentes ganham os benefícios da
nova lógica de scoring automaticamente.
