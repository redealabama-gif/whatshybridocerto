# public/js/vendor — assets de terceiros auto-hospedados

Esta pasta guarda cópias **locais** (auto-hospedadas) de libs que, por padrão,
viriam de CDN. Servir localmente deixa a landing **imune a quedas de CDN** e a
bloqueios de rede no ambiente do visitante.

## Geração automática (deploy)

O `Dockerfile` já roda `node scripts/fetch-landing-vendor.js --soft` no build, então
**a imagem de produção sobe com estes assets locais automaticamente** — sem precisar
commitar binário no git. O modo `--soft` garante que, se um download falhar no build,
a imagem não quebra (o front cai pro CDN em runtime).

## Como gerar manualmente

```bash
cd whatshybrid-backend
npm run vendor:landing
```

Isso baixa (precisa de internet liberada no ambiente que roda o script):

| Arquivo | O que é | De onde |
| --- | --- | --- |
| `cobe.js` | lib do **globo** interativo (ESM self-contained) | jsdelivr `/+esm` (fallback esm.sh `?bundle`) |
| `../../assets/robot-scene.splinecode` | cena 3D do **robô** | `prod.spline.design` |

`lucide.min.js` (ícones, lucide **1.70.0**, licença ISC) é diferente: fica
**commitado no git** e as páginas (início, cadastro, login, painel, senha) só usam
esta cópia, sem CDN. Antes vinha de `https://unpkg.com/lucide@latest`: quando a
CDN falhava, o login quebrava e o formulário mandava a senha na URL; e a versão
"latest" mudou sozinha para a 1.x, que não tem mais o ícone `chrome` (o painel
ficou sem os ícones da extensão). Para atualizar, troque o arquivo por outra
versão fixa e confira os ícones usados (`data-lucide="..."`).

Depois, **faça commit** dos arquivos gerados.

## Como o front usa

- `js/globe.js` tenta nesta ordem: **local** (`/js/vendor/cobe.js`) → unpkg →
  jsdelivr → esm.sh. A primeira que carregar vence.
- O loader do robô (em `index.html`) faz um `HEAD` em
  `assets/robot-scene.splinecode`; se existir, usa a cópia local, senão cai pra
  `prod.spline.design`.

Ou seja: enquanto os arquivos locais não existirem, tudo continua funcionando
via CDN. Quando existirem, a landing fica 100% independente de serviços externos.
