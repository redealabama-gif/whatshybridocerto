# Proposta de direção de arte — protótipo

**Isto não é código de produção e não está ligado ao site.** É um arquivo solto,
fora de `whatshybrid-backend/`, feito só para o dono avaliar a direção visual
antes de autorizar o redesign. Nenhum arquivo do projeto foi tocado para criá-lo.

```
proposta-visual.html      o protótipo (abra direto no navegador)
assets/logo-mark.png      cópia do logo real do projeto
assets/fontes/*.woff2     Fraunces e Inter (os mesmos já auto-hospedados)
                          + JetBrains Mono, que é a única fonte nova proposta
capturas/desktop.png      renderizado em 1440x1000
capturas/mobile.png       renderizado em 390x844
```

## O que ele demonstra

Conceito **Editorial de Instrumento**: hierarquia de página impressa (réguas,
medida de linha, citação) combinada com a precisão de um painel de instrumento
(rótulos em mono, números tabulares, fios de 1px).

- paleta **inalterada** — `#6f00ff #00ffff #030014 #0f0c29 #131129 #1e1b3a`;
- escala de tipo com 8 degraus (a landing hoje tem 43 tamanhos distintos);
- 3 raios de borda (hoje são 15);
- cabeçalho de seção com índice lateral, no lugar do eyebrow centralizado que
  hoje se repete em 10 das 17 seções;
- réguas no lugar de cards — o card sobrevive só onde é comparação (planos);
- movimento reaproveitando o `.reveal` que já existe, sem GSAP.

Conteúdo, textos e preços são os reais da página de vendas.

## Estado

Aguardando aprovação. Se a direção for aprovada, a implementação acontece na
branch `redesign-pagina-vendas`, nos arquivos reais, preservando os 56
seletores que o JavaScript usa, os formulários, os links e os CTAs.

Se for recusada, esta pasta pode ser apagada sem efeito nenhum sobre o site.
