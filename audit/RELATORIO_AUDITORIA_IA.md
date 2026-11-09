# Auditoria funcional da IA — Vórtex Pro / WhatsHybrid

- **Data:** 2026-11-08 · **Branch:** `audit/ia-funcional` (base `origin/main` 01a603b, extensão 9.6.6)
- **Fase 1 — somente diagnóstico.** Nenhum arquivo de código-fonte foi alterado; só foram criados arquivos em `audit/`.
- **Runtime auditado:** `whatshybrid-extension/dist/{core,content,advanced}-bundle.js` + `sidepanel.html` + `training/training.html`; backend `whatshybrid-backend/src` com SQLite descartável, sem Redis, chaves falsas e **provedor de IA falso** local (`audit/harness/fake-provider.js`). Nenhuma chamada a provedor real, nenhuma mensagem enviada pelo WhatsApp.
- **Fase 2 (correções) concluída:** resultado e antes × depois na **seção 11**.
- **Marcação da evidência:** **[EXEC]** = executado nos harnesses (saída gravada em `audit/evidencias/`) · **[EST]** = leitura de código · **NÃO VERIFICADO** = não foi possível executar.

---

## 1. Resumo executivo

1. **Causa raiz do "curta e genérica" (provada com a extensão real no Chromium):** no DOM atual do WhatsApp a sugestão lê um único balão (o do `msg-container`); o modelo recebeu "Boa tarde! Vi o anúncio de vocês no Instagram" e 1 mensagem de histórico, em vez da pergunta real e de 6 mensagens (IA-06).
2. O classificador de intenção dá a vitória à regex de texto mais comprido: "Oi, quanto custa…" vira saudação (0,88) e o LLM nunca é consultado (IA-03).
3. O prompt tem diretivas contraditórias e manda "faça UMA pergunta" em 10 de 12 mensagens com a base vazia (IA-08/09); o A/B corta a saudação ou acrescenta "Posso te ajudar com mais alguma informação?" em 8 de 12 (IA-14).
4. O filtro de PII troca respostas certas (telefone ou e-mail da própria loja, nº de pedido) por uma frase genérica (IA-07).
5. **P0:** o Autopilot enviou sozinho em 3 de 5 cenários de risco: sem guarda ("Vamos devolver seu dinheiro hoje mesmo" para quem ameaçou ir ao Procon), FAQ ignorando "quero falar com um humano" e preço inventado (IA-01/02/03).
6. **P0:** o kill switch ligado não para a IA e a chave padrão é `CHANGE_ME_IN_PRODUCTION` (IA-04); duas abas mandam duas respostas ao mesmo cliente (IA-05). `tab-coordinator.js` e `kill-switch.js` existem, mas estão fora de todos os bundles.
7. **P1:** sincronizar o treinamento pode apagar as FAQs e ainda mostrar "sincronizado" (IA-10); provedor lento custa 501 s e 12 chamadas por sugestão (IA-11); falhas de um cliente desligam a IA de todos e o fallback libera envio de texto cru da base (IA-12).
8. **Funciona (provado):** isolamento entre clientes (memória e cache), créditos (débito e 402 com saldo zero), persona, idioma no backend, feedback gravado, RAG com treinamento e revisão humana quando o backend cai.
9. **Baseline:** extensão 70/70 e backend 136 unitários + 54 de integração verdes; já vermelhos antes da auditoria: `eslint .` da extensão (sem configuração) e `validate:versions` (9.6.6 / 9.6.0 / 9.5.8).
10. **Totais:** 5 achados P0, 8 P1, 12 P2 e 13 P3; nenhum código-fonte alterado. O plano de correção (seção 6) aguarda a sua aprovação.

---

## 2. Matriz de funcionalidades

Legenda: ✅ funciona · 🟡 parcial · 🔴 quebrado · ⚫ morto / não carregado · ⚪ não verificado

| # | Funcionalidade | Status | Evidência |
|---|---|:-:|---|
| 1 | Botão 🤖 chega ao backend (Tier 0, `/api/v2/ai/process`) | ✅ | [EXEC] `50-extensao-e2e-*.json`: 1 chamada ao provedor, painel exibe a resposta |
| 2 | Botão 🤖: contexto correto no DOM **atual** do WhatsApp | 🔴 | [EXEC] `50-extensao-e2e-atual.json`, `40-sugestao-contexto.md` (IA-06) |
| 3 | Botão 🤖: contexto correto no DOM antigo | ✅ | [EXEC] `50-extensao-e2e-antigo.json`: 6 mensagens, intent pricing, base no prompt |
| 4 | Classificação de intenção | 🔴 | [EXEC] `23-classificador-intencao.md`, S1/S1b (IA-03) |
| 5 | Prompt dinâmico (diretivas coerentes) | 🔴 | [EXEC] S1, `10-prompt-pergunta-preco.txt` (IA-08/09) |
| 6 | Variantes A/B | 🔴 | [EXEC] S1: texto alterado em 8/12 (IA-14) |
| 7 | Filtro de segurança: bloqueia CPF, cartão e injeção | ✅ | [EXEC] S3 modo `malicious` |
| 8 | Filtro de segurança: sem falsos positivos | 🔴 | [EXEC] `21-filtro-pii-falso-positivo.txt` (IA-07) |
| 9 | Treinamento → backend (1ª sincronização, conta única) | ✅ | [EXEC] S2: `success:true`, itens no banco |
| 10 | RAG: treinamento aparece no prompt | ✅ | [EXEC] S2: seção "Relevant Knowledge", preço, horário e pix no prompt |
| 11 | Treinamento com id já usado por outro workspace | 🔴 | [EXEC] `24-treinamento-sync-colisao.md` (IA-10) |
| 12 | Importação CSV/TXT/JSON/XLSX/ODS na página de treinamento | ⚪ | NÃO VERIFICADO (UI não executada) |
| 13 | Importação PDF/DOCX | ⚫ | [EST] `training/training.html:384` aceita só `.csv,.txt,.json,.xlsx,.ods` |
| 14 | Treino por voz (gravação / STT) | ⚫ | [EST] `training/modules/{voice-recorder,speech-to-text,interactive-training}.js` não carregados |
| 15 | Memória por conversa no backend, isolada por cliente | ✅ | [EXEC] S4: dados de A não aparecem no prompt de B |
| 16 | Cache semântico do backend isolado por cliente | ✅ | [EXEC] S4: B chama o provedor (não reaproveita A) |
| 17 | Cache local de respostas da extensão | 🟡 | [EST] chave sem chat (IA-15); NÃO VERIFICADO em execução |
| 18 | Créditos: débito por sugestão e bloqueio com saldo zero | ✅ | [EXEC] S5: −180 tokens; saldo zero → 402 sem chamar o provedor |
| 19 | Feedback 👍/👎 gravado | ✅ | [EXEC] S7: 1 linha em `ai_feedback` |
| 20 | Aprendizado contínuo a partir do feedback | 🟡 | [EXEC] S7: `learning_patterns=0`, `learned_examples=0`; rota de ingestão sombreada (IA-17); aprendizado com N feedbacks NÃO VERIFICADO |
| 21 | Persona enviada pela extensão entra no prompt | ✅ | [EXEC] S9 |
| 22 | Idioma do cliente (backend) | ✅ | [EXEC] S9: cliente em inglês → `Language: en` |
| 23 | Idioma nos caminhos locais (fallback) | 🟡 | [EST] português fixo (IA-37) |
| 24 | Autopilot: guarda do backend bloqueia (controle) | ✅ | [EXEC] `30-autopilot.md` cenário A |
| 25 | Autopilot: backend fora do ar → revisão humana | ✅ | [EXEC] cenário C |
| 26 | Autopilot: nenhum envio sem guarda efetiva | 🔴 | [EXEC] cenários B, D e E (IA-01/02/03) |
| 27 | Autopilot: uma resposta só com 2 abas | 🔴 | [EXEC] 2 abas → 2 envios (IA-05) |
| 28 | Autopilot: maturidade aplicada antes de enviar | 🟡 | [EST] só registra (IA-18) |
| 29 | Kill switch (backend e extensão) | 🔴 | [EXEC] S6 + `window.KillSwitch` undefined (IA-04) |
| 30 | Provedor lento ou com erro 500: prazo e custo controlados | 🔴 | [EXEC] `22-provedor-lento.txt`, S3 (IA-11) |
| 31 | Circuit breaker isolado por cliente | 🔴 | [EXEC] S3, cliente A depois das falhas de B (IA-12) |
| 32 | Rotas do request-batcher | 🔴 | [EXEC] S8: 404 (IA-16) |
| 33 | Tempo real (socket.io) | ⚫ | [EST] arquivo ausente; sincronização HTTP como alternativa (IA-29) |
| 34 | Sugestão pelo atalho Ctrl+Shift+S (SuggestionInjector → IA local) | ⚪ | NÃO VERIFICADO em execução; [EST] não usa o backend (IA-25) |
| 35 | Provedores locais (chave do usuário no navegador, AIGateway/AIService) | ⚪ | NÃO VERIFICADO |
| 36 | Mensagens `chrome.runtime` com handler | ✅ | [EXEC+EST] `61-mensagens-sw.md`: 9 tipos sem handler no SW/content, todos tratados no sidepanel (`sidepanel-router.js:3515,3519,3523,4101,4126,4134,4141`, `autopilot-handlers.js:334`, `groups-manager.js:79`) |

---

## 3. Achados

Esforço: **P** = até meio dia · **M** = 1 a 2 dias · **G** = mais de 2 dias.
Caminhos: `ext/` = `whatshybrid-extension/` · `be/` = `whatshybrid-backend/` · evidências em `audit/evidencias/`.

### P0 — envio automático e controle

| ID | Sev. | Área | arquivo:linha | Evidência | Impacto | Correção | Esf. |
|---|---|---|---|---|---|---|---|
| IA-01 | P0 | Autopilot: guarda ausente libera o envio | `ext/modules/smartbot-autopilot-v2.js:997-1000` (comentário "Fail-safe: guard ausente… → segue o fluxo normal de envio"), `:1029-1032` (`minConfidence` ausente → não bloqueia) | [EXEC] `30-autopilot.md` cenário B: o backend respondeu sem `metadata.autopilot` e o Autopilot **enviou** "Claro! Vamos devolver seu dinheiro hoje mesmo." para "Quero meu dinheiro de volta, vou no Procon" | Envio automático sem nenhuma guarda sempre que a guarda não volta (backend antigo, `WHL_AUTOPILOT_GUARD=0`, erro) | Fail-closed: sem guarda ou sem `minConfidence` → `suggestion-only` (revisão humana) | P |
| IA-02 | P0 | Autopilot: FAQ e resposta rápida pulam a guarda | `ext/modules/smartbot-autopilot-v2.js:964` (`confidenceCheck.answer \|\| await generateResponse(item)`); `ext/modules/confidence-system.js:636-684` (`faq_match` e `canned_reply` devolvem `answer`) | [EXEC] cenário D: resposta de FAQ **enviada com 0 chamadas ao backend** para "Péssimo atendimento! Qual o prazo de entrega? Quero falar com um humano agora" | Pedido de humano, reclamação e sentimento negativo não são avaliados | Resposta vinda do sistema de confiança também exige guarda; sem `__aiGuard` → revisão | P |
| IA-03 | P0 | Backend: intenção errada libera envio | `be/src/ai/classifiers/HybridIntentClassifier.js:214-275` (ranking pela soma de `pattern.source.length`; um único match ganha +0,3 → 0,95), `:400` (confiança > 0,8 → LLM não é consultado) | [EXEC] `23-classificador-intencao.md`: "Oi, quanto custa…" → greeting 0,88 (greeting=72 contra pricing=49); "Bom dia! Vocês entregam…" → greeting 0,95; reclamação → schedule; reembolso → purchase; saúde → schedule. S1: preço e entrega saem com `allowAutoSend:true / low`. `30-autopilot.md` cenário E: **preço inventado enviado** ("R$ 97") | A intenção errada contamina a guarda, o objetivo comercial, o RAG e as diretivas: gera resposta genérica e envio automático de dado inventado | Pontuar pela especificidade real (saudação só vence se a mensagem for só um cumprimento); match único abaixo do limiar, para ir ao LLM; a guarda trata pergunta factual sem base como `ungrounded`, qualquer que seja o rótulo | M |
| IA-04 | P0 | Kill switch sem efeito | `be/src/routes/admin-killswitch.js:16` (estado só em memória), `:83` (chave padrão `CHANGE_ME_IN_PRODUCTION`); nenhuma rota de IA consulta o estado (só `be/src/server.js:84,499` o referenciam); `ext/modules/kill-switch.js` fora de todos os bundles e sem consumidor (só um comentário em `smartbot-autopilot-v2.js:1756`) | [EXEC] S6: com `ai` e `autopilot` ligados, `/api/v2/ai/process` → HTTP 200 e provedor chamado 1x; `window.KillSwitch` = undefined (`30-autopilot.md`) | Não há como parar a IA ou o Autopilot num incidente; quem souber a chave padrão liga e desliga; o estado some no restart | Middleware de kill switch nas rotas de IA (503 `kill_switch`, 0 chamadas ao provedor); o Autopilot para ao receber esse 503; recusar a chave padrão em produção; persistir o estado | M |
| IA-05 | P0 | Autopilot com várias abas | `ext/modules/smartbot-autopilot-v2.js:834` (`window.TabCoordinator?.isLeader && …`: sem coordenador, a checagem é pulada); `ext/modules/tab-coordinator.js` (507 linhas) fora de todos os bundles | [EXEC] `30-autopilot.md`: 2 abas → **2 respostas ao mesmo cliente**; `window.TabCoordinator` = undefined | Cliente recebe resposta duplicada; custo em dobro | Carregar o coordenador junto do Autopilot e fail-closed sem líder; dedupe por `messageId` no service worker | M |

### P1 — qualidade da resposta e integridade

| ID | Sev. | Área | arquivo:linha | Evidência | Impacto | Correção | Esf. |
|---|---|---|---|---|---|---|---|
| IA-06 | P1 | **Sugestão: contexto errado (causa raiz do sintoma)** | `ext/modules/ai-suggestion-fixed.js:1549-1680`; seletor em `:1575` (`[data-testid="msg-container"], .message-in, .message-out, …`) | [EXEC] extensão real (`50-extensao-e2e-atual.json`): o modelo recebeu "Boa tarde! Vi o anúncio de vocês no Instagram", **1** mensagem de histórico e intent greeting. Com o DOM antigo (`50-…-antigo.json`): "Quanto fica por mês para esse tamanho? E tem fidelidade?", 6 mensagens, intent pricing e "R$ 189" no prompt. `40-sugestao-contexto.md`: com `msg-container` no último balão, a mensagem é a certa, mas o histórico continua com 1 | No WhatsApp atual (o seu `WHL_RecoverDiag` mostrou 1 `msg-container`, 0 `.message-in/out` e `data-id` com o id puro), a IA responde ao balão errado e sem contexto → resposta curta e genérica | Extrair por linha (`#main [role="row"]` com `[data-id]`), com a direção vinda de `data-pre-plain-text` ou dos ícones; ou ler da Store (o diagnóstico mostrou a coleção com 302 mensagens) | M |
| IA-07 | P1 | Filtro de PII com falso positivo | `be/src/ai/safety/ResponseSafetyFilter.js:22-27` (regex `email`, `phone_br`), `:138-151` (PII → severidade alta → `safe=false`); `be/src/ai/AIOrchestrator.js:547-549` (troca por frase fixa) | [EXEC] `21-filtro-pii-falso-positivo.txt`: telefone e e-mail **da própria loja** e "pedido 87654321" → resposta trocada por "Desculpe, não posso processar essa solicitação no momento…", com `success:true` | Respostas corretas viram frase genérica; o operador não fica sabendo | Não tratar como PII os dados do próprio negócio (contato do workspace e do treinamento); mascarar em vez de trocar; sinalizar `metadata.safetyReplaced` | M |
| IA-08 | P1 | Prompt com diretivas contraditórias | `be/src/ai/intelligence/ClientBehaviorAdapter.js:346-350` ("MOMENTO DE FECHAMENTO… Não adicione informações extras"); `be/src/ai/intelligence/EmotionToneEngine.js:73` ("O cliente está confuso…"); contra o estilo "responda de forma completa" (`be/src/ai/prompts/DynamicPromptBuilder.js:606`) | [EXEC] S1: diretiva de fechamento numa pergunta de preço; "cliente confuso" em 5/12 mensagens comuns; prompt completo em `10-prompt-pergunta-preco.txt` | O modelo recebe ordens opostas ("seja completo" e "não acrescente nada"; "está confuso" sem confusão) → respostas curtas e vagas | Fechamento e confusão só com sinal forte, nunca numa pergunta factual; precedência explícita entre diretivas | M |
| IA-09 | P1 | Prompt com base vazia | `be/src/ai/prompts/DynamicPromptBuilder.js:65-75` (`GROUNDING_NOTICE`: "ajude de forma breve"), `:608` (`clarify`: "faça UMA pergunta de esclarecimento") | [EXEC] S1 sem treinamento: "faça UMA pergunta" em 10/12; aviso de "sem base" em 8/12 | Sem treinamento, quase toda resposta vira uma pergunta curta | `clarify` só quando falta dado do negócio de verdade; avisar o operador "sem base de conhecimento" | P |
| IA-10 | P1 | Treinamento: perda silenciosa ao sincronizar | `be/src/routes/training.js:48-56` (o id do cliente vira chave primária global), `:78` e `:109` (DELETE do workspace antes do INSERT, sem transação), HTTP 200 com `success:false`; `ext/background.js:512` (sucesso decidido só por `response.ok`) | [EXEC] `24-treinamento-sync-colisao.md`: um 2º workspace com o mesmo id local → FAQs de B **1 → 0**, HTTP 200 `success:false`; a extensão mostraria "sincronizado" | Perda do treinamento (por exemplo, ao trocar de conta no mesmo navegador), e o usuário acha que sincronizou | Chave composta (workspace_id, id) ou id com prefixo do workspace; transação; status diferente de 2xx em falha; o service worker checa `body.success` | M |
| IA-11 | P1 | Provedor: sem prazo global, custo ×12 | `be/src/ai/providers/BaseProvider.js:19` (`maxRetries` 3), `:27` (40 s por tentativa) + fallback entre provedores; a extensão desiste em 30 s (`ext/modules/ai-suggestion-fixed.js:1221`) | [EXEC] `22-provedor-lento.txt`: **501 s e 12 chamadas** para uma sugestão; S3 modo 500: 12 chamadas | Custo até 12x por sugestão com provedor instável; o servidor trabalha 8 minutos depois de o usuário desistir | Prazo global por requisição (AbortSignal propagado), sem retry depois de timeout, teto de tentativas | M |
| IA-12 | P1 | Circuit breaker global entre clientes | `be/src/ai/AIOrchestrator.js:93-95` (singleton compartilhado); `be/src/ai/services/AIRouterService.js:54-55`, `:141-143`, `:700-705`; fallback de conhecimento em `AIOrchestrator.js:953-954` | [EXEC] S3: depois das falhas do cliente B, o cliente A (provedor OK) teve **0 chamadas** ("No AI provider available") e recebeu o texto cru da base ("Empresa: Loja A\nHorário de atendimento… Posso te ajudar com mais alguma informação?") como resposta a "Bom dia, tudo bem?", com `success:true` e `allowAutoSend:true` | A falha de um cliente derruba a IA de todos por 60 s, e o fallback libera envio automático de texto cru | Breaker por (cliente, provedor); fallback de conhecimento marcado `ungrounded` e `allowAutoSend:false` | M |
| IA-13 | P1 | Extensão troca a URL do backend por localhost | `ext/modules/backend-client.js:209-220` (failover esgotado → `DEFAULT_BASE_URL` + `saveState()`); `ext/constants/endpoints.js:25-26` (`http://localhost:3000`) | [EST] NÃO VERIFICADO em execução | Uma instabilidade passageira troca a URL configurada por localhost e grava; a "inteligência avançada" para até alguém reconfigurar | Nunca sobrescrever a URL definida pelo usuário; a recuperação volta para a URL do usuário | P |

### P2

| ID | Sev. | Área | arquivo:linha | Evidência | Impacto | Correção | Esf. |
|---|---|---|---|---|---|---|---|
| IA-14 | P2 | A/B altera o texto final | `be/src/ai/AIOrchestrator.js:517`, `:964-973` (`variant_a` corta a saudação; `variant_b` acrescenta " Posso te ajudar com mais alguma informação?") | [EXEC] S1: texto alterado em 8/12 (7/12 na rodada anterior; a atribuição é aleatória) | Sufixo fixo e saudação cortada deixam a resposta genérica | Variantes atuam no prompt, não no texto pronto; ou desligar até haver métrica | P |
| IA-15 | P2 | Cache local sem chat na chave | `ext/modules/ai-response-cache.js:152-156` (chave `intent\|entities\|sentiment\|category`), `:179-198` (similaridade ≥ 0,7); usado em `ext/modules/copilot-engine.js:1464` | [EST] NÃO VERIFICADO em execução | Resposta personalizada de um cliente pode ser servida a outro que pergunte algo parecido | Incluir o chatId na chave, ou não cachear resposta com dado pessoal | P |
| IA-16 | P2 | request-batcher aponta para rotas inexistentes | `ext/modules/optimizations/request-batcher.js:398`, `:578` | [EXEC] S8: `/api/v1/ai/completions` e `/batch` → 404 | Chamadas em lote sempre falham | Apontar para uma rota existente ou tirar do bundle (sua aprovação) | P |
| IA-17 | P2 | Feedback não chega à ingestão | `be/src/routes/ai.js:586` (`/learn/feedback`, montada em `be/src/server.js:485`) atende antes de `be/src/routes/ai-ingest.js:410` (`/feedback` em `/api/v1/ai/learn`, `server.js:497`) | [EXEC] S7: grava em `ai_feedback`; `learning_patterns=0`, `learned_examples=0`. [EST] a ordem das rotas | O pipeline de ingestão (aprendizado contínuo) nunca recebe o feedback da extensão | `/learn/feedback` também alimenta a ingestão (ou unificar as rotas) | P |
| IA-18 | P2 | Maturidade do Autopilot só registrada | `ext/modules/ai-suggestion-fixed.js:1838`, `:2053` (`autopilotMaturity.record`); nenhuma checagem no envio em `smartbot-autopilot-v2.js` | [EST] | O Autopilot liga num workspace "imaturo" | Checar a maturidade antes de enviar sozinho (ou declarar que é só métrica) | P |
| IA-19 | P2 | Autopilot incompatível com o DOM atual | `ext/modules/smartbot-autopilot-v2.js:1564` (`.message-out:last-child`), `:1846` (regex `(\d+)@([cg])\.us`, mas o WhatsApp atual usa `@lid`) | [EST] + o seu diagnóstico real (0 `.message-out`, chats `@lid`) | Confirmação de envio e id do chat falham no WhatsApp atual | Seletores e ids do DOM atual ou da Store | M |
| IA-20 | P2 | Timeouts desalinhados | `ext/modules/ai-suggestion-fixed.js:1221` (30 s), `be/src/ai/providers/BaseProvider.js:27` (40 s), fila 45 s (`BaseProvider.js:21-23`) | [EST] + `22-provedor-lento.txt` | A extensão desiste antes do servidor; se o crédito é debitado nesse caso: NÃO VERIFICADO | Cliente espera mais que o servidor, ou servidor com prazo menor que 30 s | P |
| IA-21 | P2 | CopilotEngine lê só 1 mensagem | `ext/modules/copilot-engine.js:1054` (`extractMessagesFromDOM()` sem argumento) → `:1371`/`:1419` (`slice(-1)`) | [EXEC] `41-copilot-extracao.md`: 1 mensagem mesmo no DOM antigo (com 30 → 6). Vale para o caminho do DOM; com a Store acessível, `:1247` usa todo o histórico. No content script (mundo isolado) `window.Store` não existe; qual mundo vale em produção: NÃO VERIFICADO | Histórico do Autopilot e fallback local sem contexto | Passar a janela (por exemplo, 30) | P |
| IA-22 | P2 | Sidepanel carrega scripts inexistentes | `ext/sidepanel.html:1518-1519` (`tests/regression-tests.js`, `tests/ai-copilot-tests.js`) | [EXEC] `ls`: os arquivos não existem (o ERR_FILE_NOT_FOUND do seu console) | Erros no console | Remover as 2 tags (sua aprovação) | P |
| IA-23 | P2 | Teste de isolamento não cobre a IA | `be/tests/integration/tenant-isolation.routes.spec.js` (só `/contacts`) | [EST] | Uma regressão de isolamento na IA passaria no CI | Casos para `/api/v2/ai/process`, cache e treinamento | P |
| IA-24 | P2 | Sugestão em segundo plano descartada | `ext/modules/copilot-engine.js:468-471` (`message:received`) → `:714` → `:2249` `generateResponse` (`AIGateway.complete` `:1547` / `AIService.complete` `:1591`, `consumeCredits` `:1599`); ninguém exibe `copilot:suggestions` (`ext/modules/suggestion-injector.js:913-915`) | [EST] NÃO VERIFICADO em execução | Com chave de IA local configurada, cada mensagem recebida gasta uma chamada (e crédito) sem efeito | Gerar só quando pedido | P |
| IA-25 | P2 | Três caminhos de sugestão diferentes | botão 🤖 → backend (`ai-suggestion-fixed.js:1216`); Ctrl+Shift+S e `showSuggestionsPanel` → `suggestion-injector.js:934`, `:615-725` → CopilotEngine / SmartReplies / AIService locais; CopilotEngine automático (IA-24) | [EST] | A resposta muda conforme o atalho; o Ctrl+Shift+S ignora o treinamento e a guarda do backend | Unificar no Tier 0 (backend) | M |

### P3

| ID | Sev. | Área | arquivo:linha | Evidência | Impacto | Correção | Esf. |
|---|---|---|---|---|---|---|---|
| IA-26 | P3 | 16 arquivos de IA não carregados (H1) | lista na seção 5 | [EXEC] `audit/inventario-ia.md` | Manutenção e confusão; 2 deles são justamente a trava de abas e o kill switch | Carregar (tab-coordinator, kill-switch) ou apagar (sua aprovação) | P |
| IA-27 | P3 | Módulos do backend sem `require` (H8) | `be/src/ai/agents/CustomerServiceAgent.js` (487 linhas), `be/src/ai/learning/LearningPipelinePrismaAdapter.js` (127) | [EST] `60-estatica.txt` | — | Apagar (sua aprovação) | P |
| IA-28 | P3 | Rotas sem consumidor na extensão (H7) | `be/src/server.js:488-490` (`/smartbot`, `/smartbot-extended`, `/smartbot-ai-plus`), `:493` (`/autopilot`) | [EST]; jobs não verificados | Superfície exposta sem uso | Confirmar uso externo e remover (sua aprovação) | P |
| IA-29 | P3 | `socket.io` ausente (H9) | `ext/manifest.json:89`, `ext/build-manifest.json:21` citam `lib/socket.io.min.js`, que não existe; `ext/modules/backend-client.js:844-892` cai para HTTP | [EXEC] `ls` | Tempo real desligado (a sincronização por HTTP funciona) | Empacotar o arquivo ou tirar as referências | P |
| IA-30 | P3 | Build no repositório não reproduz o `dist/` | o build no repo (esbuild) gera os 3 bundles diferentes; o build isolado (minificador manual) é idêntico | [EXEC] `02-build-no-repo.log`, `02-build-isolado.log` | Risco de publicar um bundle diferente do testado | Fixar o minificador no `build.js` | P |
| IA-31 | P3 | `validate:versions` falha | manifest 9.6.6, raiz 9.6.0, backend 9.5.8 | [EXEC] baseline | Checagem de versões vermelha | Alinhar; você pediu para não mudar versões, então a decisão é sua | P |
| IA-32 | P3 | `eslint .` da extensão sem configuração | — | [EXEC] baseline (saída 2) | Lint da extensão não roda | Adicionar configuração | P |
| IA-33 | P3 | Erro de SQL no boot | `be/src/utils/database-legacy.js:621` (índice em `sync_data(module_key)`) | [EXEC] log do backend: `no such column: module_key` | Ruído; impacto funcional NÃO VERIFICADO | Ajustar a migração | P |
| IA-34 | P3 | URL base do provedor não configurável por env | `be/src/ai/providers/{OpenAI,Groq,Anthropic}Provider.js:13`; `be/src/ai/services/AIRouterService.js:188-200` passa `config.x \|\| {}` | [EST] (o harness teve de redirecionar o `fetch`) | Sem proxy, gateway ou região alternativa | Ler `*_BASE_URL` do env | P |
| IA-35 | P3 | `/api/v2/ai/ext/providers` sem autenticação | `be/src/routes/ai-v2.js:50` | [EST] (só ids e modelos) | Expõe a configuração | Exigir autenticação | P |
| IA-36 | P3 | Chaves de provedor em texto puro no navegador | `ext/modules/ai-service.js:492-494` (`chrome.storage.local.set` de `configs`, que guarda `apiKey`; formato em `:315`) | [EST] | Chave exposta a quem acessa o perfil do navegador | Preferir o backend; se for local, avisar o usuário | M |
| IA-37 | P3 | Português fixo nos caminhos locais (H13) | `ext/modules/ai-suggestion-fixed.js:1217` (sempre `language:'pt-BR'`), `:1335`, `:1465`; `copilot-engine.js:152`; `suggestion-injector.js:714` | [EXEC] S9: o backend detecta inglês (✅); [EST] os caminhos locais forçam português | Cliente estrangeiro recebe português no fallback | Usar o idioma detectado | P |
| IA-38 | P3 | e2e inexistente | `package.json` (raiz): `test:e2e` = `playwright test`, mas não existem `e2e/` nem `playwright.config.*` | [EST] | Nenhum teste ponta a ponta no CI | Usar os harnesses de `audit/harness/` como base | M |

---

## 4. Veredito das hipóteses H1–H14

| H | Hipótese | Veredito | Evidência |
|---|---|---|---|
| H1 | Módulos de IA não carregados | **CONFIRMADA** | [EXEC] inventário: 69 arquivos, 53 carregados, 16 sem carregamento; nenhum alcançável pelo lazy-loader |
| H2 | Trava entre abas é no-op | **CONFIRMADA** | [EXEC] 2 abas → 2 envios; `window.TabCoordinator` undefined; `smartbot-autopilot-v2.js:834` |
| H3 | Kill switch sem consumidor | **CONFIRMADA** | [EXEC] S6: IA responde com o kill switch ligado; [EST] nenhuma rota consulta o estado; `kill-switch.js` não carregado |
| H4 | Envio autônomo sem guarda | **CONFIRMADA (P0)** | [EXEC] cenários B, D e E enviaram |
| H5 | Implementações de sugestão concorrentes | **CONFIRMADA** | [EST] 5 módulos no runtime (`ai-suggestion-fixed` no advanced; `suggestion-injector`, `smart-suggestions`, `smart-replies`, `copilot-engine` no content; os dois últimos também no sidepanel); 3 caminhos que chamam IA; `smart-suggestions.js:389` e `:423` substituem `AIService.generateResponse` e `generateText`. UI duplicada visível: NÃO VERIFICADO em execução |
| H6 | request-batcher em rota 404 | **CONFIRMADA** | [EXEC] S8 |
| H7 | Rotas do backend sem consumidor | **CONFIRMADA (estático)** | [EST] `server.js:488-490, 493` sem chamadas na extensão; jobs e clientes externos não verificados |
| H8 | CustomerServiceAgent / LearningPipelinePrismaAdapter sem `require` | **CONFIRMADA** | [EST] `60-estatica.txt` |
| H9 | socket.io ausente | **CONFIRMADA** (impacto baixo) | [EXEC] `ls`; alternativa HTTP em `backend-client.js:844-892` |
| H10 | Endpoints com localhost como padrão | **CONFIRMADA** + risco novo (IA-13) | [EST] `constants/endpoints.js:25-26`, `backend-client.js:209-220` |
| H11 | Importador de documentos e voz quebrados | **REFUTADA em parte** | [EST] PDF/DOCX nunca são oferecidos (`training.html:384`); a aba de voz foi removida de propósito, e os módulos de voz são código morto; importação CSV/XLSX NÃO VERIFICADA |
| H12 | Lacunas de teste, e2e ausente | **CONFIRMADA** | [EST] sem `e2e/` nem configuração do Playwright; o isolamento só cobre `/contacts` |
| H13 | Português forçado | **PARCIAL** | [EXEC] o backend detecta o idioma (S9); [EST] os caminhos locais forçam pt-BR |
| H14 | Cache vazando entre chats | **PARCIAL** | [EXEC] backend isolado (S4); [EST] a chave do cache local não inclui o chat (IA-15) |

---

## 5. Código morto e duplicado (lista para sua aprovação; nada foi apagado)

**Extensão: 16 arquivos de IA sem nenhum carregamento** (`audit/inventario-ia.md`):

- `modules/ai-ab-testing.js` (222 linhas)
- `modules/ai-analytics-collector.js` (230)
- `modules/ai-conversation-memory.js` (594)
- `modules/ai-dynamic-prompt.js` (587)
- `modules/ai-embedding-provider.js` (543)
- `modules/ai-hybrid-intent.js` (521)
- `modules/ai-hybrid-search.js` (707)
- `modules/ai-validated-learning.js` (501)
- `modules/backend-singleton.js` (58)
- `modules/examples/conversation-memory-usage.js` (46)
- `modules/idb-storage.js` (238)
- **`modules/kill-switch.js` (265)**: proposta: carregar (IA-04), não apagar
- **`modules/tab-coordinator.js` (507)**: proposta: carregar (IA-05), não apagar
- `training/modules/interactive-training.js` (497)
- `training/modules/speech-to-text.js` (176)
- `training/modules/voice-recorder.js` (119)

**Backend:**

- `src/ai/agents/CustomerServiceAgent.js` (487 linhas) e `src/ai/learning/LearningPipelinePrismaAdapter.js` (127), sem `require`.
- Rotas sem consumidor na extensão: `server.js:488-490` e `:493`.
- Rota duplicada de feedback: `ai.js:586` e `ai-ingest.js:410` (IA-17).

**Duplicado em execução:**

- 5 implementações de sugestão e 3 caminhos que chamam IA (IA-25).
- `smart-suggestions.js:389` e `:423` substituem `AIService.generateResponse` e `AIService.generateText` em tempo de execução.

**Referências quebradas:**

- `sidepanel.html:1518-1519` (IA-22);
- `lib/socket.io.min.js` em `manifest.json:89` e `build-manifest.json:21` (IA-29);
- rotas do request-batcher (IA-16).

---

## 6. Plano de correção (Fase 2, só depois da sua aprovação)

**Regras** (as que você definiu):

- Ordem P0 → P1 → P2, **um commit por achado** (`fix(ia): <ID> <resumo>`).
- Cada correção vem com um teste de regressão que **falha antes e passa depois**, e eu mostro as duas saídas.
- Toda mudança em arquivo de bundle é seguida de `npm run build` e `npm run verify:bundles` na extensão.
- Mudanças mínimas: sem renomear, sem mudar versões, sem apagar código morto sem a sua aprovação.
- No fim: Etapa 0 completa de novo e a matriz da seção 2 em formato antes × depois.

**Onde entram os testes:**

- extensão: `whatshybrid-extension/tests/unit/*.test.js` (roda em `node tests/run-all.js`), usando os DOMs de `audit/harness/wa-dom.js`;
- backend: `whatshybrid-backend/tests/unit|integration/*.spec.js` (jest).

### P0

| ID | Correção mínima | Teste de regressão (antes → depois) |
|---|---|---|
| IA-01 | Em `processQueue`, sem guarda ou sem `minConfidence` → `suggestion-only` com motivo `no_backend_guard` | `ext/tests/unit/autopilot-guard-failclosed.test.js`: backend dublê sem `metadata.autopilot` → **1 envio → 0 envios** e evento `suggestion-only` |
| IA-02 | Resposta do sistema de confiança (`faq_match` ou `canned_reply`) não é enviada sem `__aiGuard`; vai para revisão | Mesmo arquivo: FAQ + "quero falar com um humano" → **1 envio → 0** |
| IA-03 | `classifyWithRegex`: a saudação só vence quando a mensagem é só um cumprimento; match único fica abaixo do limiar (vai ao LLM quando há chave); `AutopilotGuard` marca pergunta factual sem base como `ungrounded` | `be/tests/unit/intent-classifier-regex.spec.js`: "Oi, quanto custa…" **greeting → pricing**; "Bom dia! Vocês entregam…" **greeting → outra intenção que não saudação**; `be/tests/unit/autopilot-guard.spec.js`: preço sem base → `allowAutoSend` **true → false** |
| IA-04 | Middleware nas rotas de IA (`/api/v2/ai/*`, `/api/v1/ai/*`) que consulta o kill switch (global e por usuário) → 503 `kill_switch`; o Autopilot trata 503 como parada; chave padrão recusada em produção | `be/tests/integration/kill-switch.routes.spec.js`: kill switch `ai` ligado → `/process` **200 → 503** e provedor falso com **1 → 0** chamadas; `NODE_ENV=production` sem `ADMIN_KILL_SWITCH_KEY` → a chave padrão **aceita → recusada** |
| IA-05 | Incluir `modules/tab-coordinator.js` no bundle do Autopilot (`build-manifest.json`, **precisa da sua aprovação**) + fail-closed sem líder + dedupe por `messageId` no service worker | Harness com 2 abas (`audit/harness/autopilot-harness.js` vira teste): **2 envios → 1** |

### P1

| ID | Correção mínima | Teste de regressão |
|---|---|---|
| IA-06 | `extractMessages` com estratégia por linha `#main [role="row"]` → `[data-id]`, mantendo os seletores antigos como alternativa | `ext/tests/unit/suggestion-context-dom.test.js` com o DOM atual: **1 → 6 mensagens**, última = "Quanto fica por mês…" (as duas variantes de `msg-container`) |
| IA-07 | Lista de permissão com o telefone e o e-mail do workspace e do treinamento; PII do próprio negócio não troca a resposta | `be/tests/unit/safety-filter-business-pii.spec.js`: telefone da loja **substituído → mantido**; CPF de terceiro continua bloqueado |
| IA-08 | Fechamento e confusão só com sinal forte e nunca numa pergunta factual | `be/tests/unit/prompt-directives.spec.js`: pergunta de preço sem sinal de fechamento → diretiva de fechamento **presente → ausente**; "cliente confuso" nas 12 mensagens do S1 **5 → 0** |
| IA-09 | `clarify` só quando a intenção exige dado do negócio e não há base | `be/tests/unit/grounding-notice.spec.js` (existente, ampliado): saudação ou agradecimento com base vazia → "faça UMA pergunta" **presente → ausente** |
| IA-10 | Inserir com id prefixado pelo workspace (ou PK composta, via migração) + transação + status 409/500 em falha; o service worker checa `body.success` | `be/tests/integration/training-sync.routes.spec.js`: 2 workspaces com o mesmo id → FAQs de B **1 → 0** vira **1 → 1** e o status **200 `success:false` → 2xx `success:true`** |
| IA-11 | Prazo global (por exemplo, 25 s) com AbortSignal compartilhado; sem retry depois de timeout | `be/tests/unit/airouter-deadline.spec.js`: provedor lento → **501 s / 12 chamadas → ≤ 25 s / ≤ 2** |
| IA-12 | Breaker por (cliente, provedor); fallback de conhecimento com `allowAutoSend:false` | `be/tests/unit/airouter-breaker-tenant.spec.js`: falhas de B → chamadas de A **0 → 1**; fallback → `allowAutoSend` **true → false** |
| IA-13 | A recuperação não sobrescreve uma URL definida pelo usuário | `ext/tests/unit/backend-client-url.test.js`: URL personalizada + falhas → URL **localhost → personalizada** |

### P2 e P3

- **P2:** cada item ganha o teste citado na correção da seção 3.
- **Exigem a sua aprovação antes:**
  - **IA-14:** desligar ou mudar o A/B é decisão de produto;
  - **IA-16 e IA-22:** remover referências;
  - **IA-18:** política de maturidade.
- **P3:** só com a sua aprovação. Inclui apagar código morto (seção 5), alinhar versões (IA-31), dependências (IA-29) e configuração de lint (IA-32).

### Critério de pronto: como cada item será provado

| Critério | Prova |
|---|---|
| Nenhum envio automático sem guarda de confiança e risco | Testes de IA-01, IA-02, IA-03 e IA-12 + `audit/harness/autopilot-harness.js`: os cenários B, D e E passam a **não enviar** |
| Kill switch funcional | Teste de IA-04 + S6 refeito: 0 chamadas ao provedor |
| Proteção contra duplicidade entre abas | Teste de IA-05 (2 abas → 1 envio); se não der para garantir, fica registrado como **P0 aberto** |
| Baseline não piora | `bash audit/scripts/baseline.sh depois`, comparado com `baseline-antes/RESUMO.md` |

---

## 7. Lacunas de cobertura

1. **WhatsApp real.**
   - O DOM do harness foi montado a partir do seu `WHL_RecoverDiag`: 1 `msg-container`, 0 `.message-in/out` e `data-id` com o id puro.
   - Não sei **qual** balão tem o `msg-container` no seu WhatsApp, por isso testei o primeiro e o último. O comando da seção 9 confirma.
2. **Modelo real.** O provedor falso devolve um texto fixo. Por isso o texto do painel no e2e não serve de diagnóstico; o diagnóstico é **o que chegou ao modelo** (o log do provedor falso). A qualidade com o GPT real é NÃO VERIFICADA.
3. **Autopilot.**
   - Rodou o `smartbot-autopilot-v2.js` real com dublês de backend.
   - O cenário E reproduz a saída real do backend no S1 (preço classificado como saudação, `allowAutoSend:true`).
   - O cenário B simula um backend que não manda a guarda.
4. **Postgres e Redis.** Os testes usaram só SQLite e o caminho síncrono (`REDIS_DISABLED=true`). O caminho com fila: NÃO VERIFICADO.
5. **Caminhos locais.** Provedores locais (chave no navegador), AIGateway, Ctrl+Shift+S e CopilotEngine automático: NÃO VERIFICADOS em execução.
6. **Interfaces.**
   - A UI do treinamento (`training.html`) e a importação CSV/XLSX não foram executadas.
   - O sidepanel também não foi executado; só os scripts e os handlers foram analisados.
7. **Aprendizado.** O aprendizado contínuo com vários feedbacks, os jobs do backend (H7) e o débito de créditos quando a extensão desiste aos 30 s: NÃO VERIFICADOS.
8. **Build.** O runtime testado é o `dist/` versionado (o `verify:bundles` confirma que está em sincronia com a fonte). O build dentro do repositório gera bundles diferentes (IA-30).

---

## 8. Etapa 0: baseline (antes)

Fonte: `audit/evidencias/baseline-antes/RESUMO.md` e logs.

| Comando | Resultado |
|---|---|
| `npm run verify:bundles` (extensão) | ✅ 133 arquivos em sincronia |
| `node tests/run-all.js` (extensão) | ✅ 70/70 |
| `npm run canary` (extensão) | ✅ 10 seletores OK |
| `npx eslint .` (extensão) | 🔴 saída 2: sem arquivo de configuração |
| `npx jest --ci` (backend) | ✅ 136 testes / 18 suítes |
| `npm run test:integration` (backend) | ✅ 54 / 9 |
| `npm test` (backend, smoke) | 🔴 sem servidor no ar; ✅ com o servidor no ar (`be-smoke-com-servidor.log`: 12+4+6+19) |
| `npm run lint` (backend) | ✅ 0 erros, 87 avisos |
| `npm run typecheck` (backend) | ✅ |
| `npm run audit:gate` (backend) | ✅ |
| `npm run validate:versions` (raiz) | 🔴 9.6.6 / 9.6.0 / 9.5.8 |
| Build reproduzível | 🟡 o build isolado é idêntico ao `dist/`; o build no repositório não é (IA-30) |

---

## 9. Como reproduzir e como confirmar no seu WhatsApp

**Reproduzir** (na raiz do repositório; tudo local, provedor falso):

```bash
bash audit/scripts/baseline.sh antes
```

```bash
node audit/scripts/inventario-ia.js > audit/inventario-ia.md
```

```bash
node audit/harness/fake-provider.js 18080 &
```

```bash
bash audit/harness/start-backend.sh /tmp/audit-be 3000 18080 &
```

```bash
node audit/harness/backend-scenarios.js /tmp/audit-be/audit.db
```

```bash
node audit/harness/training-sync-colisao.js /tmp/audit-be/audit.db
```

```bash
node audit/scripts/classificador-intencao.js
```

```bash
node audit/harness/extension-e2e.js atual && node audit/harness/extension-e2e.js antigo
```

```bash
node audit/harness/suggestion-harness.js && node audit/harness/copilot-extract-harness.js && node audit/harness/autopilot-harness.js
```

```bash
node audit/scripts/mensagens-sw.js
```

**Confirmar o DOM no seu WhatsApp Web.** Só leitura: não envia nada. Abra uma conversa com várias mensagens, abra o console do Chrome (F12 → Console, contexto "top") e cole:

```js
(() => {
  const main = document.querySelector('#main');
  const rows = [...main.querySelectorAll('[role="row"]')];
  const mc = [...main.querySelectorAll('[data-testid="msg-container"]')];
  return {
    linhas: rows.length,
    msgContainer: mc.length,
    msgContainerNaLinha: mc.map((el) => rows.findIndex((r) => r.contains(el))),
    comDataId: main.querySelectorAll('[data-id]').length,
    ultimosDataId: [...main.querySelectorAll('[data-id]')].slice(-3).map((e) => e.getAttribute('data-id')),
    messageIn: main.querySelectorAll('.message-in').length,
    messageOut: main.querySelectorAll('.message-out').length,
    prePlainText: main.querySelectorAll('[data-pre-plain-text]').length,
    tailIn: main.querySelectorAll('[data-icon="tail-in"]').length,
    tailOut: main.querySelectorAll('[data-icon="tail-out"]').length,
  };
})()
```

Se `msgContainer` for 1 e `messageIn`/`messageOut` forem 0, o IA-06 está confirmado no seu ambiente. `msgContainerNaLinha` diz qual balão a sugestão está lendo hoje: 0 = o primeiro da tela; `linhas − 1` = o último.

---

## 10. Índice de evidências (`audit/evidencias/`)

| Arquivo | O que prova |
|---|---|
| `baseline-antes/` | Etapa 0 (todos os comandos e logs) |
| `00-npm-ci.log`, `02-build-*.log` | Instalação e reprodutibilidade do build |
| `10-prompt-pergunta-preco.txt` | Prompt completo enviado ao modelo numa pergunta de preço |
| `20-backend-cenarios.{md,json}` | S1–S9 e S3 (rodada limpa, banco novo): intenção, diretivas, A/B, guarda, treinamento, isolamento, créditos, kill switch, feedback, rotas 404, persona e idioma, falhas do provedor, breaker entre clientes |
| `21-filtro-pii-falso-positivo.txt` | IA-07 |
| `22-provedor-lento.txt` | IA-11 (501 s, 12 chamadas) |
| `23-classificador-intencao.md` | IA-03 (por que preço vira "greeting") |
| `24-treinamento-sync-colisao.md` | IA-10 |
| `30-autopilot.{md,json}` | IA-01, 02, 03 e 05: Autopilot real no Chromium |
| `40-sugestao-contexto.{md,json}` | IA-06: o que a sugestão manda ao backend (DOM antigo × atual) |
| `41-copilot-extracao.{md,txt}` | IA-21 |
| `50-extensao-e2e-{antigo,atual}.json` | IA-06 com a **extensão real** carregada no Chromium |
| `60-estatica.txt`, `61-mensagens-sw.md` | Análise estática (H7–H14, mensagens) |
| `../inventario-ia.md` | H1: grafo de carregamento dos 69 arquivos de IA |

---

## 11. Fase 2 — correções e antes × depois

Todas as saídas estão em `audit/evidencias/fase2/`:
- `IA-xx-antes*.txt` e `IA-xx-depois*.txt` guardam o teste de regressão de cada correção, antes e depois dela;
- `matriz/*-antes*` e `matriz/*-depois*` guardam os mesmos harnesses rodados contra o código original (commit 15d6325) e contra o corrigido.

### 11.1 Resumo

- **20 commits `fix(ia)`**, um por achado (o IA-11 ganhou um complemento). Cada um traz um teste que falhava antes e passa depois.
- **Corrigidos:**
  - P0: IA-01 a IA-05;
  - P1: IA-06 a IA-13;
  - P2: IA-15, IA-19, IA-21, IA-24 e IA-25, mais o IA-23 (cobertura de teste);
  - o IA-20 foi resolvido pelo IA-11: o backend agora responde em até 25 s, antes dos 30 s da extensão.
- **Causa raiz do "curta e genérica":** corrigida dos dois lados.
  - sugestão (IA-06) e histórico do Autopilot (IA-21): a IA recebe a pergunta certa e a conversa inteira;
  - classificação de intenção (IA-03), diretivas (IA-08/09) e filtro de PII (IA-07) também corrigidos;
  - resta o A/B (IA-14), que depende da sua decisão.
- **Critério de pronto:**

  | Critério | Resultado |
  |---|---|
  | Nenhum envio automático sem guarda | ✅ 4 envios indevidos → 0 (matriz/30) |
  | Kill switch funcional | ✅ HTTP 200 com 1 chamada ao provedor → 503 com 0 chamadas (matriz/20, S6) |
  | Duas abas | ✅ 2 respostas → 1 |
  | Baseline não piora | ✅ tabela 11.4 |
  | Teste por correção | ✅ tabela 11.2 |

### 11.2 Achado × commit × teste

| ID | Status | Commit | Teste de regressão | Antes → depois |
|---|---|---|---|---|
| IA-01 | ✅ corrigido | 10e0dbf | `ext/tests/unit/autopilot-guard-failclosed.test.js` | 1/4 (3 envios indevidos) → 4/4 |
| IA-02 | ✅ | 00ddf06 | `ext/tests/unit/autopilot-faq-guard.test.js` | 0/2 → 2/2 |
| IA-03 | ✅ | f38d2e0 | `be/tests/unit/intent-classifier-regex.spec.js` + `autopilot-guard-factual.spec.js`; `ext/tests/unit/confidence-greeting.test.js` | 3/15 → 15/15; 1/2 → 2/2 |
| IA-04 | ✅ | b196b34 | `be/tests/integration/kill-switch.routes.spec.js`; `ext/tests/unit/autopilot-kill-switch.test.js` | 1/6 → 6/6; 0/3 → 4/4 |
| IA-04 (deploy) | ✅ depois do merge (11.8) | 4fd2642 | `be/tests/unit/deploy-killswitch-key.spec.js`; controle em `kill-switch.routes.spec.js` | 0/3 → 3/3; `docker compose config`: chave ausente no container → presente |
| IA-05 | ✅ | 918aee0 | `ext/tests/unit/autopilot-multi-tab.test.js` | 2 envios (1/2) → 1 envio (3/3) |
| IA-06 | ✅ | 943611d | `ext/tests/unit/suggestion-context-dom.test.js` | 1 mensagem (1/6) → 6/6 |
| IA-07 | ✅ | 60f2ac7 | `be/tests/unit/safety-filter-business-pii.spec.js` | 3/5 → 5/5 |
| IA-08 | ✅ | 6a61abc | `be/tests/unit/prompt-directives.spec.js` | 2/5 → 5/5 |
| IA-09 | ✅ | 49c60b4 | `be/tests/unit/clarify-policy.spec.js` | 0/4 → 4/4 |
| IA-10 | ✅ | 7292358 | `be/tests/integration/training-sync.routes.spec.js`; `ext/tests/unit/training-sync-sw.test.js` | 0/3 → 3/3; 1/2 → 2/2 |
| IA-11 | ✅ | a05944f + 167705b | `be/tests/unit/airouter-deadline.spec.js`; `airouter-attempt-cap.spec.js` | 26 s/8 chamadas → 2,6 s/≤2; 500: 8 → ≤3 |
| IA-12 | ✅ | 5d1f3c9 | `be/tests/unit/airouter-breaker-tenant.spec.js` | 1/3 → 3/3 |
| IA-13 | ✅ | 17088ec | `ext/tests/unit/backend-client-url.test.js` | 1/3 → 3/3 |
| IA-14 | ⏸️ decisão sua | — | — | A/B segue alterando 8/12 respostas |
| IA-15 | ✅ | f83f736 | `ext/tests/unit/ai-response-cache-chat.test.js` | 1/3 (vazamento provado) → 3/3 |
| IA-16 | ⏸️ decisão (reavaliado) | — | — | sem consumidor no runtime: código morto, não 404 em produção |
| IA-17 | ⏸️ decisão (reavaliado) | — | — | ver 11.5 |
| IA-18 | ⏸️ decisão sua | — | — | — |
| IA-19 | ✅ | 8e3f03f | `ext/tests/unit/autopilot-confirm-sent.test.js` | 0/1 → 1/1 |
| IA-20 | ✅ via IA-11 | a05944f | `matriz/22-provedor-lento-depois.txt` | 501 s → 25 s (< 30 s da extensão) |
| IA-21 | ✅ | 678a793 | `ext/tests/unit/copilot-context-dom.test.js` | 1 mensagem (0/3) → 3/3 |
| IA-22 | ⏸️ decisão (remoção) | — | — | — |
| IA-23 | ✅ cobertura | dde0643 | `be/tests/integration/ai-tenant-isolation.routes.spec.js` | 3/3; o bug antigo simulado (mutação) é pego |
| IA-24 | ✅ | c2afda7 | `ext/tests/unit/copilot-background-ai.test.js` | 2 chamadas de IA por mensagem → 0 |
| IA-25 | ✅ | 92cef77 | `ext/tests/unit/suggestion-injector-backend.test.js` | 0 mensagens, sem backend (0/3) → 3/3 |
| IA-26 a IA-38 | ⏸️ P3, decisão sua | — | — | — |

### 11.3 Matriz antes × depois

Mesmos harnesses, contra o código original e o corrigido:

| Funcionalidade | Antes | Depois | Evidência (`fase2/matriz/`) |
|---|:-:|:-:|---|
| Botão 🤖: contexto no DOM atual | 🔴 mensagem errada, 1 de histórico | ✅ pergunta certa, 6 mensagens | `50-extensao-e2e-atual-*.json` (extensão real), `40-sugestao-contexto-*` |
| Histórico do Autopilot no DOM atual | 🔴 1 mensagem | ✅ 6 | `41-copilot-extracao-*` |
| Atalho Ctrl+Shift+S | 🔴 0 mensagens, sem backend | ✅ backend + histórico | teste IA-25 |
| Classificação de intenção (S1) | 🔴 5 de 12 erradas | ✅ corrigidas | `23-classificador-intencao-*`, `20-…` S1 |
| Diretivas: fechamento / "faça UMA pergunta" / "confuso" | 🔴 1/12 · 10/12 · 5/12 | ✅ 0/12 · 0/12 · 0/12 | `20-…` S1 |
| A/B alterando o texto | 🔴 | 🔴 (pendente IA-14) | `20-…` S1 |
| PII da loja / nº do pedido | 🔴 trocados | ✅ mantidos | `20-…` S10 |
| PII de terceiros (CPF/cartão) | ✅ bloqueado | ✅ bloqueado | `20-…` S3 malicious |
| Treinamento com id de outro workspace | 🔴 FAQs de B 1 → 0, "sucesso" | ✅ mantidas, sucesso real | `24-…` |
| Autopilot: envios indevidos (B, B_real, D, E) | 🔴 4 | ✅ 0 | `30-autopilot-*` |
| Autopilot: 2 abas | 🔴 2 respostas | ✅ 1 | `30-autopilot-*` |
| Kill switch | 🔴 200, provedor chamado | ✅ 503, 0 chamadas | `20-…` S6 |
| Provedor lento | 🔴 501 s, 12 chamadas | ✅ 25 s, 2 chamadas | `22-provedor-lento-depois.txt` × `../22-provedor-lento.txt` |
| Provedor com 500 | 🔴 21 s, 12 chamadas | ✅ 1 s, 4 chamadas | `20-…` S3 |
| Cliente A depois das falhas de B | 🔴 0 chamadas | ✅ resposta real (1 chamada) | `20-…` S3 |
| Cache local entre chats | 🔴 vazamento | ✅ separado | teste IA-15 |
| URL do backend configurada | 🔴 vira localhost | ✅ mantida | teste IA-13 (e reproduzido por acaso no E2E "antes", 11.5) |
| IA em segundo plano sem uso | 🔴 2 chamadas/mensagem | ✅ 0 | teste IA-24 |
| Isolamento, créditos, persona, idioma, feedback, RAG | ✅ | ✅ | `20-…` S2, S4, S5, S7, S9 |

### 11.4 Etapa 0: antes × depois

| Comando | Antes | Depois |
|---|---|---|
| extensão `verify:bundles` | ✅ 133 arquivos | ✅ 134 (entrou `modules/kill-switch.js`) |
| extensão `tests/run-all.js` | ✅ 70/70 | ✅ 108/108 |
| extensão `canary` | ✅ | ✅ |
| extensão `eslint .` | 🔴 sem configuração | 🔴 igual (IA-32, P3) |
| backend `jest --ci` | ✅ 136 | ✅ 184 |
| backend `test:integration` | ✅ 54 | ✅ 66 |
| backend smoke com servidor | ✅ 12+4+6+19 | ✅ 12+4+6+19 |
| backend `lint` | ✅ 0 erros / 87 avisos | ✅ 0 erros / 86 avisos |
| backend `typecheck` / `audit:gate` | ✅ / ✅ | ✅ / ✅ |
| raiz `validate:versions` | 🔴 9.6.6 / 9.6.0 / 9.5.8 | 🔴 igual (você pediu para não mudar versões) |

Logs em `audit/evidencias/baseline-depois/`. Os bundles foram gerados com `npm run build` numa cópia fora do repositório, com o mesmo minificador do `dist/` versionado (IA-30). Script: `audit/scripts/build-isolado.sh`.

### 11.5 O que a Fase 2 corrigiu na análise da Fase 1

**Problemas maiores do que o relatado:**
- **IA-13:** eram 3 caminhos que gravavam localhost (boot, failover normal e "recuperação"), não 1.
  - O E2E "antes" reproduziu o bug por acaso: com o backend na porta 3100, a URL virou `localhost:3000`.
  - A sugestão caiu num texto genérico de modelo pronto: "Oi! Estou à disposição. O que você precisa?".
- **IA-21:** é a mesma causa raiz do IA-06, do lado do Autopilot (o histórico mandado ao backend tinha 1 mensagem).
- **IA-25:** no DOM atual o atalho extraía 0 mensagens, não 1.
- **IA-24:** eram 2 chamadas de IA por mensagem recebida (análise profunda e sugestão).
- **IA-03, parte na extensão:** o `isSimpleGreeting` tratava "Oi, <qualquer pedido>" como saudação simples (confiança 95). Por isso os cenários de risco do Autopilot eram realistas.
- **IA-11:** o prazo global não bastava para erro 500 rápido (11 chamadas). Veio o complemento com teto de tentativas (4 chamadas).

**Problemas menores do que o relatado:**
- **IA-17:** a rota que a extensão usa (`ai.js /learn/feedback`) alimenta sim o pipeline de aprendizado (`recordFeedback`) e grava as correções. O que não roda é a rota antiga e sombreada do `ai-ingest`, que criaria um exemplo de treino a cada 👍. Ligar isso é decisão de produto.
- **IA-16:** o request-batcher não tem consumidor; as rotas 404 nunca são chamadas na prática.
- **IA-19:** o id do chat lido pelo DOM já tinha alternativa pela ponte da página (funciona). O defeito real era a confirmação de envio, que esperava 6 s em cada mensagem.

### 11.6 Pendências que dependem de você

1. **IA-14 (A/B):**
   - Hoje 8 de 12 respostas são alteradas depois do modelo: corta a saudação ou acrescenta "Posso te ajudar com mais alguma informação?".
   - É o último contribuinte conhecido para a resposta "genérica".
   - Recomendação: tirar o pós-processamento do texto e levar as variantes para o prompt, ou desligar o A/B até haver métrica.
2. **IA-18:** aplicar a maturidade do Autopilot antes de ele enviar sozinho?
3. **IA-17:** criar um exemplo de treino a cada 👍 (rota antiga) ou manter só o que já funciona?
4. **Remoções** (só com o seu ok):
   - a lista da seção 5;
   - o request-batcher (IA-16);
   - as tags quebradas do sidepanel (IA-22);
   - o `tab-coordinator.js`, que ficou desnecessário com a trava no service worker.
5. **P3:**
   - alinhar versões (IA-31);
   - configuração de lint da extensão (IA-32);
   - minificador do build (IA-30);
   - `module_key` (IA-33);
   - URL base do provedor por env (IA-34);
   - `/ext/providers` sem autenticação (IA-35);
   - chaves de provedor no navegador (IA-36);
   - idioma nos caminhos locais (IA-37);
   - e2e (IA-38).

### 11.7 Riscos e limites que continuam

- **Breaker interno dos provedores:** o de cada provedor (`BaseProvider`: 5 falhas → 30 s) continua global. O do AIRouter passou a ser por cliente.
- **Custo do classificador:** ele agora consulta o LLM em mensagens ambíguas (1 chamada curta, até 5 s, sem nova tentativa). Com o provedor falso, que não devolve JSON, a classificação cai no regex; por isso as confianças do S1 "depois" são baixas. A classificação pelo LLM real: NÃO VERIFICADO.
- **Transação do `training/sync`:** segue o padrão síncrono do SQLite usado no resto do backend. No Postgres vale a ressalva já documentada em `src/utils/db/index.js`.
- **Commits do backend:** feitos sem o hook do repositório (`--no-verify`), por decisão sua, para o diff ficar mínimo. O `eslint` foi rodado à mão: 0 erros e os mesmos avisos de antes, arquivo por arquivo.
- **DOM real:** as correções de contexto usam `[data-id]` e ícones de entrega, validados no harness com o formato do seu diagnóstico. A sugestão tenta primeiro a Store do WhatsApp pela ponte da página. Confirmar no seu WhatsApp com o comando da seção 9 continua recomendado.
- **Modelo real:** o GPT/Groq real não foi chamado. Está provado o que chega ao modelo; a qualidade do texto gerado pelo modelo real é NÃO VERIFICADA.

### 11.8 Ajuste depois do merge (PR #313): chave do kill switch no deploy Docker

- **Lacuna:** IA-04 passou a recusar, em produção, a chave padrão `CHANGE_ME_IN_PRODUCTION` (`be/src/routes/admin-killswitch.js:34-38`); sem `ADMIN_KILL_SWITCH_KEY`, `POST /api/v1/admin/kill-switch/set` responde 503 (`:160-162`). O `docker-compose.yml` só entrega ao container as variáveis que lista, e essa não estava na lista. Com `.env` de teste contendo a chave, `docker compose config` mostrava o backend em `NODE_ENV=production` **sem** ela (`audit/evidencias/fase2/IA-04-deploy-compose-antes.txt`): no deploy Docker não havia como ligar o kill switch.
- **Correção (4fd2642):** o compose repassa `ADMIN_KILL_SWITCH_KEY=${ADMIN_KILL_SWITCH_KEY:-}` ao backend (sem valor padrão); os dois `.env.example` documentam a variável vazia; o `install.sh` gera uma chave aleatória no `.env` novo.
- **Prova:** `be/tests/unit/deploy-killswitch-key.spec.js` 0/3 → 3/3 (`IA-04-deploy-antes.txt`, `IA-04-deploy-depois.txt`). O compose real entrega a chave ao container; o trecho do `install.sh` que cria o `.env` foi executado numa pasta temporária e a chave gerada (64 hex) chega ao backend (`IA-04-deploy-compose-depois.txt`). Controle: em produção, com a chave configurada, o admin liga o kill switch e `/process` responde 503 sem chamar o orquestrador (`kill-switch.routes.spec.js`, 7/7).
- **Servidor que já existe:** o `install.sh` só gera o `.env` novo. Num `.env` existente, acrescente `ADMIN_KILL_SWITCH_KEY=` com o valor de `openssl rand -hex 32` e rode `./deploy/scripts/deploy.sh`. Sem isso, o kill switch segue respondendo 503 "ADMIN_KILL_SWITCH_KEY não configurada".

## 12. Fase 3 — diagnóstico com as chaves reais (2026-11-09)

Depois do merge do PR #313, o teste no WhatsApp real continuou mostrando sugestões genéricas ("Ok! Em que posso ser útil?", "Certo! Pode me dar mais detalhes?"). O usuário autorizou o uso das chaves dele (OpenAI e Groq) para o diagnóstico. As chaves e as conversas reais ficaram **fora do repositório**: as evidências abaixo usam conversas sintéticas que reproduzem as mesmas situações (o dono da conta como comprador recebendo rastreio, colega de trabalho, conversa pessoal tensa e um controle de loja). Harness: `audit/harness/start-backend-real.sh`, `log-fetch.js`, `real-provider-check.js`, `real-sampling.js` e `extension-e2e.js` (modo IA real).

Chaves: a da OpenAI responde e tem crédito (HTTP 200). A primeira da Groq foi desativada pelo usuário; a nova responde, mas a conta tem limite de 8.000 tokens por minuto (429 depois de 3–4 sugestões por minuto — `IA-41-groq-modelos.txt` e o log da avaliação).

### 12.1 Causas encontradas

| ID | Prior. | Achado | Prova |
|---|---|---|---|
| IA-39 | P0 | Com o backend conectado e a IA do servidor falhando (MÉTODOS 0 e 3), o popup mostrava uma frase de `DEFAULT_RESPONSES` (`ext/modules/smart-suggestions.js:164-169`) como se fosse a sugestão — o comentário em `ai-suggestion-fixed.js` dizia "só sem backend nem providers", mas a condição não checava. O filtro de segurança local também trocava a sugestão do servidor (ex.: telefone da loja, liberado no backend pelo IA-07) por frase pronta | `fase3/ext-suggestion-no-canned-backend-antes.txt` |
| IA-40 | P0 | Redis ligado (padrão do compose) e `ai-worker` parado: `/api/v2/ai/process` esperava a fila por até 45 s (`AI_QUEUE_WAIT_MS`) antes do caminho síncrono; a extensão desiste em 30 s → frase pronta | Redis + backend real: **48,3 s** (`chaves-reais/fila-sem-worker-antes.md`) |
| IA-41 | P0 | A Groq desativou os modelos fixos no código (`llama-3.3-70b-versatile` e outros: 404/400). Em `/api/v1/ai/complete` (MÉTODO 3) a cadeia começa pela Groq e 404/401 abortavam sem tentar a OpenAI. Os modelos atuais da Groq são de raciocínio: com limite baixo de tokens o texto volta vazio | `fase3/IA-41-groq-modelos.txt`; MÉTODO 3 = 404 em 4/4 (`chaves-reais/antes.md`) |
| IA-42 | P1 | Com o LLM respondendo, o texto saía com voz de atendente de loja e invertia papéis: identidade "You are a professional customer service assistant", diretivas comerciais em qualquer conversa, resumo com "Client:", CTA obrigatória no verificador de qualidade; o MÉTODO 3 da extensão usava "Você é um atendente humano" | `fase3/IA-42-real-antes-openai.txt` |
| IA-43 | P1 | Uma geração travada na OpenAI consumiu o prazo inteiro (abortada aos 23,5 s de 25 s) e a Groq nem foi tentada | rodada intermediária, cenário colega_trabalho |
| IA-14 | P2 | O A/B colava "Posso te ajudar com mais alguma informação?" (apareceu como fim de sugestão numa conversa pessoal real) — decisão que estava pendente, resolvida pelo pedido do usuário | `fase3/IA-14-antes.txt` |

### 12.2 Achado × commit × teste

| ID | Commit | Teste de regressão | Antes → depois |
|---|---|---|---|
| diagnóstico | 4355e0e | harness com chaves reais | — |
| IA-40 | caed80e | `be/tests/integration/ai-process-queue.routes.spec.js` | 1/3 (4 s esperando a fila) → 3/3 (44 ms e 310 ms) |
| IA-41 | b5913a7 | `be/tests/unit/groq-models.spec.js`, `be/tests/integration/ai-complete-fallback.routes.spec.js` | 0/7 → 7/7 |
| IA-43 | fb77e59 | `be/tests/unit/airouter-fallback-reserve.spec.js` | 0/1 (falha aos 6 s, reserva não tentado) → 1/1 (reserva responde aos 4 s) |
| IA-42 | 0f11880 | `be/tests/unit/prompt-papel-conversa.spec.js` | 0/6 → 6/6 |
| IA-14 | 41c19be | `be/tests/unit/ab-variant-text.spec.js` | 1/3 → 3/3 |
| IA-39 | 930e2ad | `ext/tests/unit/suggestion-no-canned-backend.test.js` | 1/3 → 3/3 |
| IA-42 (ext.) | afc7060 | `ext/tests/unit/suggestion-metodo3-papel.test.js` | 0/2 → 2/2 |

### 12.3 Antes × depois com as chaves reais

| Medida | Antes | Depois | Evidência |
|---|---|---|---|
| Popup com a IA do servidor falhando | frase pronta disfarçada | erro com o motivo e "Tentar Novamente" | `fase3/ext-suggestion-no-canned-backend-*.txt` |
| Fila sem `ai-worker` (Redis real) | 48,3 s | 2,7 s (log: "fila de IA sem worker ativo") | `chaves-reais/fila-sem-worker-*.md` |
| MÉTODO 3 (`/api/v1/ai/complete`) | 404 em 4/4 | 200 em 4/4, sem preço inventado | `chaves-reais/antes.md`, `depois.md` |
| Caminho principal, gpt-4o-mini, 3 amostras × 4 conversas | compra 3/3 genéricas, com fatos inventados ("a Jet é conhecida por sua eficiência") e voz de loja; colega e pessoal com voz de SAC; loja 3/3 "vou confirmar" | compra 3/3 como comprador (1 fecho genérico, 1 palpite sobre a transportadora); colega 2/3 no papel certo; pessoal 3/3 em primeira pessoa; loja 3/3 "vou confirmar" | `fase3/IA-42-real-*.txt` |
| Extensão real no Chromium + backend + OpenAI | — | "O plano Pro para clínicas custa R$ 189/mês para até 5 usuários, sem fidelidade..." — da FAQ treinada, 6 mensagens de histórico | `fase3/50-extensao-e2e-atual-chaves-reais.json` |
| Testes | backend 188, extensão 108 | backend 208, extensão 113, zero-dep 11/11 | — |

### 12.4 O que fazer no servidor

1. Deploy do backend: quase todas as correções desta fase são do backend (IA-40, IA-41, IA-42, IA-43, IA-14).
2. Conferir o `ai-worker` (`docker compose ps ai-worker`, `docker compose logs --tail 50 ai-worker`). Com o IA-40 um worker parado não trava mais a sugestão, mas o log do backend avisa "fila de IA sem worker ativo".
3. Trocar no `.env` a `GROQ_API_KEY` desativada pela nova. `GROQ_MODEL`/`GROQ_FAST_MODEL` vazios usam `openai/gpt-oss-120b`/`openai/gpt-oss-20b`.
4. Extensão: atualizar e recarregar (IA-39 e MÉTODO 3 estão no `dist/`).

### 12.5 Limites e pendências

- O gpt-4o-mini ainda escorrega às vezes (palpite sobre a transportadora, fecho genérico, papel invertido em conversa ambígua). Um modelo maior melhora isso, mas custa mais: o `OpenAIProvider` fixa `gpt-4o-mini` e ignora o `AI_DEFAULT_MODEL` do `.env`; consertar a leitura trocaria o modelo de todos para o padrão do config (`gpt-4o`, cerca de 16× o custo) — decisão do usuário.
- Groq com 8.000 tokens por minuto: como reserva serve; como principal, não aguenta volume.
- Extensão: os modelos Groq locais (`ai-service.js`, `ai-gateway.js`, `api-config.js`) seguem os antigos, mas esse caminho está desligado (`FORCE_BACKEND`; `addApiKey` recusa chaves de LLM).
- `CostLoggerService`/`metrics.js` não têm preço para os modelos novos da Groq (custo registrado aproximado).
- NÃO VERIFICADO: o servidor de produção do usuário (versão em execução, estado do `ai-worker`, chaves no `.env`) — não acessível daqui.
- Pendências anteriores sem mudança: IA-17, IA-18, remoções da seção 5 e P3.
