# Planos: o que o site promete × o que é liberado (Fase 4)

Fontes comparadas, item a item:
- página inicial (`public/index.html`, seção `#pricing`) e cards do cadastro (`public/signup.html`);
- extensão: `modules/subscription-manager.js` (`PLANS`), `modules/feature-gate.js`, `modules/crm.js`;
- servidor: `src/middleware/subscription.js` (`PLAN_LIMITS`, aplicado com `checkSubscription`/`checkLimit` nas rotas), `src/services/TokenService.js` (`PLAN_TOKENS`, `TOKEN_PACKAGES`), `src/services/MercadoPagoService.js` (`PLAN_PRICES`).

| Promessa do site | Onde é aplicado | Confere? |
|---|---|---|
| Free R$ 0 · Starter R$ 49,90/mês · Pro R$ 99,90/mês | `MercadoPagoService.js:21` e `signup.html` (`data-price`) | ✅ |
| Starter: 50.000 tokens de IA/mês · Pro: 500.000 ("10× mais") | `TokenService.js:30-35` (`PLAN_TOKENS`); renovação `resetMonthlyForPlan` | ✅ |
| Free sem IA (IA listada em "Disponível nos planos pagos") | `PLAN_TOKENS.free = 0` — sem saldo o servidor recusa (`consume` → INSUFFICIENT_CREDITS) | ✅ |
| Pacotes avulsos "a partir de R$ 19" | `TOKEN_PACKAGES.pack_10k` = 10k por R$ 19,00 | ✅ |
| Pacotes avulsos "não expiram" | **PLN-01** — expiravam na renovação; corrigido (`migrations/023`, `tests/integration/tokens-pacote-nao-expira.spec.js`) | ✅ depois da correção |
| Free: CRM até **50 contatos** e até **50 tarefas** | servidor `PLAN_LIMITS.free` contacts 50 / tasks 50 (`checkLimit` em `POST /contacts`, `POST /tasks`); extensão `maxContacts` 50 | ✅ |
| Starter: "CRM até **1.000 contatos** e **200 tarefas**" | servidor contacts 1000 / tasks 200; extensão `maxContacts` 1000 | ✅ |
| Pro: "CRM ilimitado" | servidor -1; extensão -1 | ✅ |
| Pro: "Disparo em massa expandido — até 2.000 mensagens/dia" | servidor `bulk_contacts_per_day` 2000; extensão `bulkContactsPerDay` 2000 (Starter 500, Free 5) | ✅ |
| Autopilot e Treinamento a partir do Starter | rotas `autopilot` e `training` com `checkSubscription`; extensão `autopilot:true`/`training:true` no Starter | ✅ |
| Cupom EXIT50 "-50% no 1º mês" | `CouponService` (first_invoice_only) + resumo do cadastro (PROD-04) | ✅ |
| "Anual −20%" / "Economize R$ X/ano" | **PLN-02** — não existe cobrança anual; removido do site | ✅ depois da correção |
| 7 dias grátis sem cartão | cadastro cria trial de 7 dias sem pedir cartão | ✅ (cobrança ao fim do trial: ver Fase 5) |

## Observações (não quebram promessa, mas anotadas)

1. **Pro "Conversas ilimitadas"**: o limite `maxChatsPerDay` (Free 10, Starter
   100) existe só na definição — nenhum código o aplica (0 usos fora de
   `subscription-manager.js`). Ninguém é bloqueado; o Pro anuncia como
   diferencial algo que hoje todos têm. P2: aplicar o limite nos planos
   menores ou tirar a linha do card.
2. **Free ganha a mais do que o anunciado** (não a menos): a extensão dá
   disparo limitado (5 contatos/dia) e 3 sugestões/dia locais, enquanto a
   página lista disparo em massa e IA como "planos pagos". Decisão comercial
   se quiser cortar.
3. **`src/services/LicenseService.js` é código morto** (nenhum require) com
   números DIVERGENTES (Free 100 contatos, Starter 3 usuários, Pro 10.000
   contatos). Não afeta cliente; P2: remover para ninguém ligar isso de volta.
4. **Equipe**: "adicione membros" não tem teto aplicado (extensão -1, servidor
   sem limite). Igual para todos os planos pagos.
