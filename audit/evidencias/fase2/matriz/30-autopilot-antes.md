# Autopilot real no Chromium (WhatsApp simulado, dublês de backend)

| cenário | mensagem do cliente | ENVIADO ao cliente? | texto enviado | chamadas ao backend | evento |
|---|---|---|---|---|---|
| A_guard_bloqueia — Backend OK com guarda allowAutoSend=false (controle) | Quero cancelar e falar com um humano | não | — | 1 | autopilot:suggestion-only:backend_escalation |
| B_sem_guarda — Backend SEM metadata.autopilot; sistema de confiança libera (95) | Quero meu dinheiro de volta, vou no Procon | **SIM** | "Claro! Vamos devolver seu dinheiro hoje mesmo." | 1 | autopilot:auto-responded: |
| B_real — Mesmo backend sem guarda, mensagem com "Oi," e o ConfidenceSystem REAL da versão | Oi, quero meu dinheiro de volta, vou no Procon | **SIM** | "Claro! Vamos devolver seu dinheiro hoje mesmo." | 1 | autopilot:auto-responded: |
| C_backend_offline — Backend fora do ar → fallback local (controle) | Qual o horário de vocês? | não | — | 1 | autopilot:tier:degraded:, autopilot:suggestion-only:fallback_no_guard |
| D_faq_sem_backend — Sistema de confiança devolve resposta de FAQ (faq_match) — reclamação/pedido de humano | Péssimo atendimento! Qual o prazo de entrega? Quero falar com um humano agora | **SIM** | "Nosso prazo de entrega é de 5 a 7 dias úteis." | 0 | autopilot:auto-responded: |
| E_preco_real — Pergunta de PREÇO sem base; backend ANTIGO libera (greeting, allowAutoSend:true); ConfidenceSystem REAL da versão | Oi, quanto custa o plano mensal de vocês? Tem desconto no anual? | **SIM** | "O plano mensal custa R$ 97 e no anual você ganha 2 meses grátis!" | 1 | autopilot:auto-responded: |

## Duas abas do WhatsApp Web abertas, mesma mensagem recebida

- aba 1: enviou 1x ["Abrimos sim, das 9h às 13h!"] · window.TabCoordinator=undefined · window.KillSwitch=undefined
- aba 2: enviou 1x ["Abrimos sim, das 9h às 13h!"] · window.TabCoordinator=undefined · window.KillSwitch=undefined
- **total de respostas enviadas ao MESMO cliente: 2**
