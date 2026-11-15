# Pagamento, trial e cobrança (pergunta e do dono)

> "Cadastro → plano → cupom → trial 7 dias → 1º mês 50% off: é realmente
> cobrado? Tem sistema de pagamento por cartão?"

## Como o fluxo funciona hoje (verificado)

1. **Cadastro (`signup.html` passo 3)** chama só `POST /api/v1/auth/signup`.
   **Não captura cartão** — a própria tela diz "A integração de pagamento é
   configurada após o cadastro". Cria a conta com **trial de 7 dias**
   (`trial_end_at`), sem cobrança. Confere com "7 dias grátis, sem cartão".
2. **Cupom EXIT50** (opcional, vindo do modal de saída): 50% só na **1ª
   fatura**. Verificado no servidor (`/coupons/validate`):
   - Starter R$ 49,90 → **R$ 24,95** na 1ª fatura (`firstInvoiceOnly: true`);
   - Pro R$ 99,90 → **R$ 49,95** na 1ª fatura.
   Bate com o resumo do cadastro (PROD-04).
3. **Cobrança** acontece **depois**, quando o cliente configura o pagamento no
   painel (botões "Assinar"/"Configurar pagamento" → MercadoPago checkout, que
   aceita **PIX, boleto e cartão** — `MercadoPagoService.createPreference`).
4. **Webhook MercadoPago** (`/api/v1/webhooks/payment/mercadopago-saas`):
   pagamento aprovado → ativa a assinatura, concede os tokens do plano e gera a
   **chave de acesso WHL-…**, que vai por **e-mail** (SendGrid). Tudo com
   **assinatura verificada** e **idempotência** (reentrega não cobra/credita 2×).
5. **Fim do trial sem pagamento:** o cron de billing marca `past_due` e
   **bloqueia o acesso**; há **dunning** (novas tentativas com espaçamento).
6. **Estorno** revoga o acesso e marca a fatura como `refunded`.

## O que está testado (verde)

| Área | Teste | Resultado |
|---|---|---|
| Webhook: assinatura inválida → 401 | `webhooks-payment.routes.spec.js` | ✅ |
| Webhook: aprovado → ativa + fatura paga + chave WHL- | idem | ✅ |
| Webhook: idempotência (não duplica fatura) | idem | ✅ |
| Estorno → revoga acesso + fatura refunded | idem | ✅ |
| Cupom: 1ª fatura, firstInvoiceOnly, por plano | `coupons.routes.spec.js`, `billing-phase3.test.js` | ✅ (11 + 33) |
| Trial expirado → past_due (mesmo se MP falha) | `billing-cron-expired-trials.test.js` | ✅ (27) |
| Dunning: não redispara no mesmo dia, avança tentativas | `billing-dunning-suspend.test.js` | ✅ (18) |
| Pacote avulso: topup idempotente, tokens.topup_confirmed | `webhooks-payment-saas.test.js` | ✅ (81) |
| E-mail "Pagamento confirmado" com a chave e o passo-a-passo | dry-run (abaixo) | ✅ conteúdo ok |

E-mail da chave (dry-run, sem SENDGRID_API_KEY):
`[EmailService:DRY-RUN] To: cliente@… | Subject: Pagamento confirmado — Vórtex Pro`
→ o HTML traz o código `WHL-…`, "Como ativar" (instalar extensão, colar código)
e o aviso de 1 dispositivo. Correto.

## O que NÃO dá para verificar aqui (⚠️ NÃO VERIFICADO — depende do dono 🔒)

- **Cobrança real** (cartão/PIX/boleto) exige credenciais de produção do
  **MercadoPago** (`MERCADOPAGO_ACCESS_TOKEN`, `notification_url` pública).
  Sem elas, `createPreference` não gera checkout real. Testar com um cartão de
  valor baixo em produção.
- **Envio real de e-mail** exige `SENDGRID_API_KEY` e domínio autenticado
  (SPF/DKIM). Sem a chave, o backend roda em **dry-run** (não envia) e, em
  produção, dispara alerta crítico avisando disso.

## Resposta ao dono

Sim, há sistema de pagamento (MercadoPago: cartão, PIX e boleto), mas ele **não
cobra no cadastro** — o trial de 7 dias começa **sem cartão**. A cobrança só
acontece quando o cliente configura o pagamento no painel; aí o 1º mês sai com
o desconto do cupom (se usou EXIT50) e a chave de acesso chega por e-mail. Para
isso funcionar em produção faltam **suas credenciais** do MercadoPago e do
SendGrid (itens do go-live). Os erros que você viu em "começar trial grátis" e
"entrar" eram outros (CORS e ícones) e já foram corrigidos (PROD-01..03).
