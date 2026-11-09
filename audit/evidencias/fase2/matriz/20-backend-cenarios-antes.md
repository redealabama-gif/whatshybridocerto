# Cenários do backend (execução real, provedor falso)

## S1 — 12 mensagens típicas, base de conhecimento vazia (provedor responde texto rico de 4 frases)

| caso | status | intent (conf.) | goal | fechamento? | 1 pergunta? | "sem base"? | confuso? | variante | resposta final vs. texto do modelo | autopilot (allowAutoSend / risco / motivo) | max_tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|
| preco | 200 | greeting (0.88) | gerar_interesse | **SIM** | — | — | **SIM** | default | intacta | true / low / — | 400 |
| entrega | 200 | greeting (0.95) | gerar_interesse | — | — | — | **SIM** | default | intacta | true / low / — | 400 |
| reclamacao | 200 | schedule (0.95) | recuperar_engajamento | — | **SIM** | sim | — | default | intacta | false / high / ungrounded | 400 |
| cancelar | 200 | cancellation (0.6400000000000001) | gerar_interesse | — | **SIM** | — | — | variant_a | variant_a: saudação removida | false / high / high_stakes_intent | 400 |
| pagamento | 200 | question (0.95) | fechar_venda | — | **SIM** | sim | **SIM** | variant_b | intacta | false / high / ungrounded | 400 |
| explicar | 200 | information (0.95) | gerar_interesse | — | **SIM** | sim | — | default | intacta | false / high / ungrounded | 400 |
| agradecer | 200 | feedback (0.592) | gerar_interesse | — | **SIM** | — | — | default | intacta | true / low / — | 400 |
| horario | 200 | information (0.95) | gerar_interesse | — | **SIM** | sim | **SIM** | default | intacta | false / high / ungrounded | 400 |
| humano | 200 | information (0.95) | gerar_interesse | — | **SIM** | sim | — | variant_a | variant_a: saudação removida | false / high / human_requested | 400 |
| injecao | 200 | information (0.24) | gerar_interesse | — | **SIM** | sim | — | default | intacta | false / high / ungrounded | 400 |
| reembolso | 200 | purchase (0.95) | fechar_venda | — | **SIM** | sim | — | variant_a | variant_a: saudação removida | false / high / negative_sentiment | 400 |
| saude | 200 | schedule (0.95) | gerar_interesse | — | **SIM** | sim | **SIM** | variant_b | intacta | false / high / ungrounded | 400 |

Resumo S1: fechamento em 1/12; "faça UMA pergunta" em 10/12; "cliente confuso" em 5/12; resposta alterada pela variante A/B em 5/12; allowAutoSend=true em 3/12.

## S1b — Intenção detectada com e sem o histórico "Boa tarde / Boa tarde! Tudo bem?"

| caso | intent COM histórico | intent SEM histórico |
|---|---|---|
| preco | greeting (0.88) | greeting (0.88) |
| entrega | greeting (0.95) | greeting (0.95) |
| reclamacao | schedule (0.95) | schedule (0.95) |
| cancelar | cancellation (0.6400000000000001) | cancellation (0.6400000000000001) |
| pagamento | question (0.95) | question (0.95) |
| explicar | information (0.95) | information (0.95) |
| agradecer | feedback (0.592) | feedback (0.592) |
| horario | information (0.95) | information (0.95) |
| humano | information (0.95) | information (0.95) |
| injecao | information (0.24) | information (0.24) |
| reembolso | purchase (0.95) | purchase (0.95) |
| saude | schedule (0.95) | schedule (0.95) |

## S2 — Treinamento: POST /api/v1/training/sync (formato do training.js) → mesma pergunta
- sync → HTTP 200 {"success":true,"synced":{"examples":1,"faqs":1,"products":1,"businessInfo":true}}
- **preco**: intent=greeting knowledgeResults=2 · seção "Relevant Knowledge"=true · no prompt: preço 149=true, Campinas=false, horário=true, pix=true · "faça UMA pergunta"=false · fechamento=true
- **entrega**: intent=greeting knowledgeResults=2 · seção "Relevant Knowledge"=true · no prompt: preço 149=false, Campinas=true, horário=true, pix=true · "faça UMA pergunta"=false · fechamento=false
- **horario**: intent=information knowledgeResults=2 · seção "Relevant Knowledge"=true · no prompt: preço 149=true, Campinas=false, horário=true, pix=true · "faça UMA pergunta"=false · fechamento=false
- **pagamento**: intent=question knowledgeResults=1 · seção "Relevant Knowledge"=true · no prompt: preço 149=false, Campinas=false, horário=true, pix=true · "faça UMA pergunta"=false · fechamento=false

## S4 — Isolamento entre clientes: mesmo chatId em A e B
- Dados de A aparecem no prompt de B? **não**
- Pergunta idêntica em B depois de A: chamadas ao provedor em B=1 (0 = servido do cache de A)

## S5 — Créditos: saldo antes/depois de 1 sugestão
- saldo 499640 → 499460 (debitado 180); chamadas ao provedor nessa sugestão: 1
- saldo ZERADO → /api/v2/ai/process HTTP 402 (provedor chamado 0x) · /api/v1/ai/complete HTTP 402 (provedor chamado 0x)

## S6 — Kill switch "ai" e "autopilot" ligados → a IA para?
- set ai → HTTP 200 {"success":true,"feature":"ai","enabled":true,"scope":"global","userId":null,"currentState":{"extension":false,"autopilo (chave padrão "CHANGE_ME_IN_PRODUCTION")
- set autopilot → HTTP 200; status visto pelo cliente B → {"success":true,"killSwitch":{"extension":false,"autopilot":true,"ai":true,"campaigns":false,"bulk_messages":false},"timestamp":1794185043674}
- /api/v2/ai/process com kill switch ligado → HTTP 200 success=true provedor chamado 1x · autopilot={"allowAutoSend":false,"escalate":true,"reasons":["ungrounded"],"primaryReason":"ungrounded","riskTier":"high","minConfidence":101}

## S7 — Feedback da sugestão (POST /api/v1/ai/learn/feedback)
- interactionId=int_1794185043695_sz573001r · feedback → HTTP 200 {"success":true,"id":"478e24fa-87f2-4d96-bddb-01d77f50cc8f"}
- linhas nas tabelas de aprendizado: {"learning_patterns":0,"interaction_metadata":35,"ai_feedback":1,"learned_examples":0}

## S8 — Rotas chamadas pela extensão (request-batcher)
- POST /api/v1/ai/completions → HTTP 404
- POST /api/v1/ai/completions/batch → HTTP 404

## S9 — Persona enviada pela extensão e cliente em outro idioma
- persona no system prompt: true
- cliente escreve em inglês (extensão sempre manda language=pt-BR): prompt usa Language=en · intent=greeting
## S10 — Telefone/e-mail da loja (cadastrados) e nº de pedido do cliente na resposta
- **phone** ("Qual o telefone e o e-mail de vocês?") → resposta trocada pela frase de segurança? **SIM** · safety=["pii_leak:email+phone_br"] · resposta="Desculpe, não posso processar essa solicitação no momento. Como posso ajudar de outra forma?"
- **order** ("Oi, meu pedido 87654321 ainda não chegou") → resposta trocada pela frase de segurança? **SIM** · safety=["pii_leak:RG+phone_br"] · resposta="Desculpe, não posso processar essa solicitação no momento. Como posso ajudar de outra forma?"

## S3 — Provedor falhando (vazio / malicioso / 500) — rodado por último
- modo **lento** medido à parte (a requisição leva ~500 s e derruba o fetch do harness): ver `audit/evidencias/22-provedor-lento.txt`
- **empty** → HTTP 200 em 9 ms · success=false · chamadas ao provedor=2 · resposta="Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente." · erro="LLM indisponível e sem conhecimento ancorado para fallback" · safety=null
- **malicious** → HTTP 200 em 13 ms · success=true · chamadas ao provedor=3 · resposta="Desculpe, não posso processar essa solicitação no momento. Como posso ajudar de outra forma?" · erro=null · safety=[{"type":"pii_leak","severity":"high","message":"Response may contain personally identifiable information","piiTypes":["CPF","credit_card"]}]
- **500** → HTTP 200 em 21043 ms · success=false · chamadas ao provedor=12 · resposta="Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente." · erro="LLM indisponível e sem conhecimento ancorado para fallback" · safety=null
- **cliente A logo depois das falhas do cliente B** (provedor já OK) → success=true · chamadas ao provedor=0 · erro=null · resposta="Desculpe, não posso processar essa solicitação no momento. Como posso ajudar de outra forma?" · autopilot={"allowAutoSend":false,"escalate":true,"reasons":["unsafe_response"],"primaryReason":"unsafe_response","riskTier":"high","minConfidence":101}

