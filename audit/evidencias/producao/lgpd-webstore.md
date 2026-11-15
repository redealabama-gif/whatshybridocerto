# LGPD, legal e Chrome Web Store (Fase 7)

## LGPD

| Item | Verificação | Status |
|---|---|---|
| Política de privacidade existe e cobre o básico | direitos do titular, retenção, compartilhamento (OpenAI/MercadoPago/SendGrid), encarregado, LGPD citada | ✅ |
| **Descreve o que o produto realmente faz** | faltavam o **Recover** (mensagens que o remetente apagou + versão anterior de editadas) e o **Extrator** (contatos e membros de grupos) | ✅ corrigido (LGP-02) |
| **Não faz afirmação falsa sobre rastreamento** | dizia "não usamos cookies de marketing nem rastreamento de terceiros", mas o site carrega Google Analytics e Meta Pixel quando os IDs estão configurados | ✅ corrigido (LGP-02) |
| Exportar meus dados (portabilidade) | `GET /api/v1/me/export` (autenticado) + guia na Central de Ajuda | ✅ |
| Excluir minha conta | `POST /api/v1/me/delete-account`; anonimiza e-mail, zera senha, desativa 2FA, cancela workspace; logs 12 m e faturas 5 anos ficam por obrigação legal | ✅ (`lgpd-me.routes.spec.js`) |
| Rotina de retenção | `lgpd-retention-purge.js` + `npm run lgpd:purge` | ✅ (`lgpd-retention-purge.spec.js`) |
| Termos de uso | presentes, com conteúdo | ✅ |
| 🔒 Consentimento de cookies | se o dono ligar GA/Meta Pixel, o ideal é um aviso de cookies com opção de recusar antes de disparar os pixels — **decisão do dono** (hoje os pixels só sobem se ele configurar os IDs) | 🔒 |

## Chrome Web Store

| Item | Situação | Status |
|---|---|---|
| Manifest V3 | `manifest_version: 3` | ✅ |
| **Servidor padrão** | apontava para `http://localhost:3000` em QUALQUER instalação — cliente da loja ficava sem servidor | ✅ corrigido (LGP-01) |
| Permissões declaradas × usadas | `storage`, `alarms` (27), `notifications` (9), `downloads` (3), `sidePanel` (20), `tabs`, `scripting`, `webRequest` (usado em `background/message-handler.js`), `unlimitedStorage` (declarativa, para o volume de dados do CRM/Recover) — todas justificáveis | ✅ |
| `host_permissions` de desenvolvimento | inclui `http://localhost/*` e `http://127.0.0.1/*`. **Funciona**, mas revisores da loja questionam acesso a localhost numa extensão publicada | ⚠️ 🔒 avaliar remover no build de publicação |
| Política de privacidade publicada | `https://whatshybrid.com.br/privacy.html` (exigida pela loja quando há dados sensíveis) | ✅ existe · 🔒 declarar na ficha da loja |
| Descrição e finalidade única | "CRM e automação inteligente para WhatsApp" — coerente com o que a extensão faz | ✅ |
| 🔒 Risco de revisão | automação de WhatsApp (disparo em massa) é um tema sensível na loja. Revisar os textos da ficha para enfatizar **atendimento e CRM**, não "envio em massa", e deixar claro o consentimento do destinatário | 🔒 decisão do dono |

## Pendências do dono (🔒)

1. Confirmar o **endereço real da API** antes de publicar (`WHL_BACKEND_PRODUCTION`
   ou o padrão `https://api.whatshybrid.com.br`).
2. Decidir sobre aviso de cookies, se for usar GA/Meta Pixel.
3. Avaliar remover as permissões de `localhost` no pacote enviado à loja.
4. Preparar a ficha da loja (descrição, prints, política de privacidade, justificativa de cada permissão).
