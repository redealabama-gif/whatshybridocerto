# Autopilot real no Chromium (WhatsApp simulado, dublês de backend)

| cenário | mensagem do cliente | ENVIADO ao cliente? | texto enviado | chamadas ao backend | evento |
|---|---|---|---|---|---|
| A_guard_bloqueia — Backend OK com guarda allowAutoSend=false (controle) | Quero cancelar e falar com um humano | não | — | 1 | autopilot:suggestion-only:backend_escalation |
| B_sem_guarda — Backend SEM metadata.autopilot; sistema de confiança libera (95) | Quero meu dinheiro de volta, vou no Procon | não | — | 1 | autopilot:suggestion-only:no_backend_guard |
| B_real — Mesmo backend sem guarda, mensagem com "Oi," e o ConfidenceSystem REAL da versão | Oi, quero meu dinheiro de volta, vou no Procon | não | — | 0 | autopilot:suggestion-only:complex_conversation |
| C_backend_offline — Backend fora do ar → fallback local (controle) | Qual o horário de vocês? | não | — | 1 | autopilot:tier:degraded:, autopilot:suggestion-only:fallback_no_guard |
| D_faq_sem_backend — Sistema de confiança devolve resposta de FAQ (faq_match) — reclamação/pedido de humano | Péssimo atendimento! Qual o prazo de entrega? Quero falar com um humano agora | não | — | 1 | autopilot:suggestion-only:backend_escalation |
| E_preco_real — Pergunta de PREÇO sem base; backend ANTIGO libera (greeting, allowAutoSend:true); ConfidenceSystem REAL da versão | Oi, quanto custa o plano mensal de vocês? Tem desconto no anual? | não | — | 0 | autopilot:suggestion-only:complex_conversation |

## Duas abas do WhatsApp Web abertas, mesma mensagem recebida

- aba 1: enviou 0x [] · window.TabCoordinator=undefined · window.KillSwitch=undefined
- aba 2: enviou 1x ["Abrimos sim, das 9h às 13h!"] · window.TabCoordinator=undefined · window.KillSwitch=undefined
- **total de respostas enviadas ao MESMO cliente: 1**
