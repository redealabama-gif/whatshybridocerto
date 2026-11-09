# Cenários do backend (execução real, provedor falso)

## S1 — 12 mensagens típicas, base de conhecimento vazia (provedor responde texto rico de 4 frases)

| caso | status | intent (conf.) | goal | fechamento? | 1 pergunta? | "sem base"? | confuso? | variante | resposta final vs. texto do modelo | autopilot (allowAutoSend / risco / motivo) | max_tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|
| preco | 200 | pricing (0.9) | fechar_venda | — | — | sim | — | variant_a | variant_a: saudação removida | false / high / ungrounded | 400 |
| entrega | 200 | question (0.6000000000000001) | gerar_interesse | — | — | sim | — | variant_b | intacta | false / high / ungrounded | 400 |
| reclamacao | 200 | complaint (0.52) | recuperar_engajamento | — | — | — | — | variant_b | intacta | false / high / negative_sentiment | 400 |
| cancelar | 200 | cancellation (0.52) | gerar_interesse | — | — | — | — | default | intacta | false / high / high_stakes_intent | 400 |
| pagamento | 200 | question (0.6000000000000001) | fechar_venda | — | — | sim | — | default | intacta | false / high / ungrounded | 400 |
| explicar | 200 | information (0.6000000000000001) | gerar_interesse | — | — | sim | — | variant_b | intacta | false / high / ungrounded | 400 |
| agradecer | 200 | feedback (0.52) | gerar_interesse | — | — | — | — | default | intacta | true / low / — | 400 |
| horario | 200 | information (0.9) | gerar_interesse | — | — | sim | — | variant_b | intacta | false / high / ungrounded | 400 |
| humano | 200 | information (0.6000000000000001) | gerar_interesse | — | — | sim | — | variant_b | intacta | false / high / human_requested | 400 |
| injecao | 200 | information (0.24) | gerar_interesse | — | — | sim | — | default | intacta | false / high / ungrounded | 400 |
| reembolso | 200 | cancellation (0.52) | gerar_interesse | — | — | — | — | variant_b | intacta | false / high / negative_sentiment | 400 |
| saude | 200 | question (0.6000000000000001) | gerar_interesse | — | — | sim | — | variant_a | variant_a: saudação removida | false / high / ungrounded | 400 |

Resumo S1: fechamento em 0/12; "faça UMA pergunta" em 0/12; "cliente confuso" em 0/12; resposta alterada pela variante A/B em 8/12; allowAutoSend=true em 1/12.

## S1b — Intenção detectada com e sem o histórico "Boa tarde / Boa tarde! Tudo bem?"

| caso | intent COM histórico | intent SEM histórico |
|---|---|---|
| preco | pricing (0.9) | pricing (0.9) |
| entrega | question (0.6000000000000001) | question (0.6000000000000001) |
| reclamacao | complaint (0.52) | complaint (0.52) |
| cancelar | cancellation (0.52) | cancellation (0.52) |
| pagamento | question (0.6000000000000001) | question (0.6000000000000001) |
| explicar | information (0.6000000000000001) | information (0.6000000000000001) |
| agradecer | feedback (0.52) | feedback (0.52) |
| horario | information (0.9) | information (0.9) |
| humano | information (0.6000000000000001) | information (0.6000000000000001) |
| injecao | information (0.24) | information (0.24) |
| reembolso | cancellation (0.52) | cancellation (0.52) |
| saude | question (0.6000000000000001) | question (0.6000000000000001) |

## S2 — Treinamento: POST /api/v1/training/sync (formato do training.js) → mesma pergunta
- sync → HTTP 200 {"success":true,"synced":{"examples":1,"faqs":1,"products":1,"businessInfo":true}}
- **preco**: intent=pricing knowledgeResults=2 · seção "Relevant Knowledge"=true · no prompt: preço 149=true, Campinas=false, horário=true, pix=true · "faça UMA pergunta"=false · fechamento=false
- **entrega**: intent=question knowledgeResults=2 · seção "Relevant Knowledge"=true · no prompt: preço 149=false, Campinas=true, horário=true, pix=true · "faça UMA pergunta"=false · fechamento=false
- **horario**: intent=information knowledgeResults=2 · seção "Relevant Knowledge"=true · no prompt: preço 149=true, Campinas=false, horário=true, pix=true · "faça UMA pergunta"=false · fechamento=false
- **pagamento**: intent=question knowledgeResults=1 · seção "Relevant Knowledge"=true · no prompt: preço 149=false, Campinas=false, horário=true, pix=true · "faça UMA pergunta"=false · fechamento=false

## S4 — Isolamento entre clientes: mesmo chatId em A e B
- Dados de A aparecem no prompt de B? **não**
- Pergunta idêntica em B depois de A: chamadas ao provedor em B=1 (0 = servido do cache de A)

## S5 — Créditos: saldo antes/depois de 1 sugestão
- saldo 499640 → 499460 (debitado 180); chamadas ao provedor nessa sugestão: 2
- saldo ZERADO → /api/v2/ai/process HTTP 402 (provedor chamado 0x) · /api/v1/ai/complete HTTP 402 (provedor chamado 0x)

## S6 — Kill switch "ai" e "autopilot" ligados → a IA para?
- set ai → HTTP 200 {"success":true,"feature":"ai","enabled":true,"scope":"global","userId":null,"currentState":{"extension":false,"autopilo (chave padrão "CHANGE_ME_IN_PRODUCTION")
- set autopilot → HTTP 200; status visto pelo cliente B → {"success":true,"killSwitch":{"extension":false,"autopilot":true,"ai":true,"campaigns":false,"bulk_messages":false},"timestamp":1794185223722}
- /api/v2/ai/process com kill switch ligado → HTTP 503 success=false provedor chamado 0x · autopilot=null

## S7 — Feedback da sugestão (POST /api/v1/ai/learn/feedback)
- interactionId=int_1794185223738_8pp5o0m3r · feedback → HTTP 200 {"success":true,"id":"92e2cd40-f7d5-43ad-85c5-e2bc89cc4acf"}
- linhas nas tabelas de aprendizado: {"learning_patterns":0,"interaction_metadata":34,"ai_feedback":1,"learned_examples":0}

## S8 — Rotas chamadas pela extensão (request-batcher)
- POST /api/v1/ai/completions → HTTP 404
- POST /api/v1/ai/completions/batch → HTTP 404

## S9 — Persona enviada pela extensão e cliente em outro idioma
- persona no system prompt: true
- cliente escreve em inglês (extensão sempre manda language=pt-BR): prompt usa Language=en · intent=question
## S10 — Telefone/e-mail da loja (cadastrados) e nº de pedido do cliente na resposta
- **phone** ("Qual o telefone e o e-mail de vocês?") → resposta trocada pela frase de segurança? não · safety=[] · resposta="Nosso atendimento funciona de segunda a sexta, das 9h às 18h. Se preferir, chame no nosso WhatsApp comercial (11) 98765-4321 ou escreva para contato@lojaa.com.b"
- **order** ("Oi, meu pedido 87654321 ainda não chegou") → resposta trocada pela frase de segurança? não · safety=[] · resposta="Encontrei aqui! Seu pedido 87654321 foi despachado ontem e deve chegar em até 3 dias úteis. Qualquer coisa, é só me chamar por aqui."

## S3 — Provedor falhando (vazio / malicioso / 500) — rodado por último
- modo **lento** medido à parte (a requisição leva ~500 s e derruba o fetch do harness): ver `audit/evidencias/22-provedor-lento.txt`
- **empty** → HTTP 200 em 7 ms · success=false · chamadas ao provedor=2 · resposta="Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente." · erro="LLM indisponível e sem conhecimento ancorado para fallback" · safety=null
- **malicious** → HTTP 200 em 10 ms · success=true · chamadas ao provedor=3 · resposta="Desculpe, não posso processar essa solicitação no momento. Como posso ajudar de outra forma?" · erro=null · safety=[{"type":"pii_leak","severity":"high","message":"Response may contain personally identifiable information","piiTypes":["CPF","credit_card"]}]
- **500** → HTTP 200 em 1014 ms · success=false · chamadas ao provedor=4 · resposta="Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente." · erro="LLM indisponível e sem conhecimento ancorado para fallback" · safety=null
- **cliente A logo depois das falhas do cliente B** (provedor já OK) → success=true · chamadas ao provedor=1 · erro=null · resposta="Que bom que você chamou. O plano mensal custa R$ 97 e inclui todos os recursos de atendimento, e no pagamento anual você ganha dois meses grátis, saindo por R$ " · autopilot={"allowAutoSend":true,"escalate":false,"reasons":[],"primaryReason":null,"riskTier":"low","minConfidence":70}

