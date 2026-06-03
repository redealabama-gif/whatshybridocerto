# 📚 Central de Ajuda WhatsHybrid Pro

Bem-vindo. Esta documentação cobre tudo que você precisa pra começar e operar.

## 🚀 Começando

- [Primeiros passos](getting-started.md)
- [Instalando a extensão Chrome](installing-extension.md)
- [Configurando sua IA](configuring-ai.md)
- [Onboarding em 5 minutos](onboarding-walkthrough.md)

## 💰 Planos e cobrança

- [Tokens explicados](tokens-explained.md)
- [FAQ de cobrança](billing-faq.md)
- [Como cancelar / pausar](cancellation.md)

## 🤖 Inteligência Artificial

- [Tipos de tom de voz](ai-tones.md)
- [Construindo a Base de Conhecimento](knowledge-base.md)
- [Boas práticas de prompts](prompt-best-practices.md)
- [A/B testing automático](ab-testing.md)

## 🔧 Solução de problemas

- [Erros comuns](troubleshooting.md)
- [Extensão não conecta](extension-connection-issues.md)
- [IA respondendo de forma inadequada](ai-quality-tuning.md)
- [Status do serviço](https://status.whatshybrid.com.br) (link externo)

## 🔐 Segurança

- [Ativando 2FA](two-factor-auth.md)
- [LGPD e seus dados](privacy-lgpd.md)
- [Excluindo sua conta](deleting-account.md)

## 🔗 API

- [Documentação OpenAPI](https://app.whatshybrid.com.br/api-docs.html) (link externo)
- [Autenticação](api-authentication.md)
- [Rate limits](api-rate-limits.md)

## 🤝 Indique e ganhe

- [Programa de indicações](referrals.md)

---

## Como usar este help center

Para gerar um site público a partir destes markdowns, há 3 opções:

1. **Mintlify** (recomendado, free tier generoso): conecta repositório,
   identifica esta pasta, gera site em `docs.whatshybrid.com.br`.
2. **docs.page**: similar ao Mintlify, sem deploy.
3. **GitHub Pages + Jekyll**: hospedagem grátis, mais setup.

Para Mintlify:
```bash
npm i -g mintlify
cd docs-site
mintlify init
# segue prompts; faz git push; conecta no dashboard.mintlify.com
```

Para começar localmente:
```bash
mintlify dev
```
