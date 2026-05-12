# ADR 005 — Estratégia de Resiliência WhatsApp

**Status:** Accepted
**Date:** 2026-05-07

## Contexto

Produto core depende de injetar JS no WhatsApp Web e ler/escrever via `window.Store`. WhatsApp atualiza a aplicação sem aviso prévio, ocasionalmente:

- Renomeia keys de `Store` (`Store.Chat` → `Store.ChatCollection`)
- Refatora estrutura interna do webpack
- Adiciona detecção anti-bot
- Força reload com `app_too_old`

Não há solução pra isso ser zero. Precisamos de **estratégia em camadas**:

## Decisão

Adotamos **defesa em 4 camadas** + **diversificação de produto**.

### Camada 1: Wrapper defensivo de seletores

`whatshybrid-extension/modules/wa-bridge-defensive.js` expõe `WHL_WaBridge.get(key)` que tenta múltiplos paths em ordem de preferência. Quando todos falham, registra telemetria e retorna `null`.

Caller decide: tentar de novo, ativar modo manual, ou exibir banner.

### Camada 2: Telemetria centralizada

Tabela `selector_telemetry` agrega falhas por `(selector_name, wa_version, extension_version)`. Backend mantém dashboard de "qual seletor está quebrando em qual versão". Endpoint `POST /api/v1/telemetry/selector-failure`.

### Camada 3: Modo manual com graceful degradation

Quando um seletor crítico falha, a extensão:
1. Exibe banner explicando situação
2. Desativa auto-reply automaticamente
3. Mantém modo Copilot (sugere mas não envia)
4. Cliente continua atendendo (manualmente) sem interrupção

### Camada 4: Canary externo

Script `scripts/canary-whatsapp.js` (puppeteer) roda 24×7 num VPS dedicado:
- A cada 30 min abre web.whatsapp.com com extensão instalada
- Verifica que `Store`, `Chat`, `Msg`, `Contact`, `Wid` carregaram
- Roda envio + recebimento de teste
- Alerta Discord se falhar

Resultado: descobrimos breakage **4-6 horas antes** do primeiro cliente reclamar.

### Diversificação: WhatsApp Business Cloud API

A Meta oferece API oficial gratuita até 1.000 conversas/mês. Adicionamos como **segunda opção** no produto:

- Cliente escolhe entre "WhatsApp Web (extensão)" ou "WhatsApp Business API (oficial)"
- Cloud API: zero risco de breakage, mas requer:
  - Migração de número (perde uso de WhatsApp comum)
  - Aprovação Business Manager (1-3 dias)
  - Templates pré-aprovados pra mensagens fora janela 24h
- Web (extensão): funciona pra atendimento humano consultivo, vendas, freelancer

Para qual cliente faz sentido cada caminho:
- **Cloud API:** B2C com volume alto (>1000 msg/dia), e-commerce, marketing massa
- **Web (extensão):** atendimento humano, vendas consultivas, PMEs, freelancer

## Alternativas consideradas

1. **Pinar versão do WhatsApp Web** — bloquear service worker. Rejeitado: clientes ficariam com vulnerabilidades de segurança ativas, virariam vetor de ataque.

2. **Engenharia reversa do protocolo WebSocket** (estilo Baileys/whatsapp-web.js) — Rejeitado: viola ToS WhatsApp, risco de banimento de números, dor de manutenção alta.

3. **Apenas Cloud API** — Rejeitado: perde mercado de atendimento humano consultivo (PMEs brasileiras), que é exatamente nosso target inicial.

4. **Apenas Web** — Rejeitado: risco concentrado em uma única dependência frágil.

## Consequências

✅ Cliente não fica sem produto quando WhatsApp atualiza
✅ Tempo médio de detecção: < 30 minutos (canary)
✅ Tempo médio de fix: 4-24h (mapear novos paths + release)
✅ Revenue resiliente: clientes em Cloud API continuam funcionando independente do que aconteça com extensão Web
✅ Insights agregados: telemetria de seletores guia priorização (qual seletor consertar primeiro)

❌ Custo operacional: +R$ 50/mês (VPS canary + número teste)
❌ Codebase mais complexo: 2 implementações (Web + Cloud API) pra manter
❌ Cloud API tem restrições (templates, janela 24h) que confundem clientes

## Métricas de sucesso

- **% de clientes resilientes:** alvo 60-70% em Cloud API após 12 meses
- **Tempo médio entre breakage e detecção:** < 1 hora
- **Tempo médio entre breakage e fix em produção:** < 24 horas
- **% de uptime efetivo dos clientes durante breakage Web:** > 80% (modo manual mantém atendimento)

## Quando revisar

Revisar quando:
- WhatsApp lançar mudança grande de protocolo (raro mas possível)
- Cloud API mudar pricing significativamente
- Surgir alternativa oficial melhor (improvável)
- 12 meses após primeira release v9.2.0 (avaliar métricas reais)
