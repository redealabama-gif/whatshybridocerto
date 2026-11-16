# BTN-00 — todo botão de todo lugar foi clicado

Cobrança do dono (16/11/2026): *"toda hora eu te pergunto alguma coisa que está
pronta pra produção, você fala que de acordo com o código tá, mas eu encontro
um novo problema. Verifica todos os botões de todos os lugares."*

Ele estava certo, e a causa foi de método: o teste do DASH-01 procurava
**handler inline** no HTML. Um botão **sem handler nenhum** passava — e foi
exatamente o caso do "Falar com o suporte", que eu cheguei a listar como
"botão SEM onclick" e não investiguei.

Os dois harnesses abaixo não olham código: **clicam** e exigem reação.

- `audit/harness/botoes-todas-paginas.js` — as 10 páginas do site
- `audit/harness/botoes-extensao.js` — as 14 telas do painel e o Treinamento

## O que conta como "reagiu"

navegar · abrir modal · mostrar aviso (toast) · mudar o DOM · fazer requisição ·
abrir `confirm()`/`alert()` · abrir **aba nova** · abrir **seletor de arquivo** ·
disparar a **validação nativa** do formulário

## Resultado final

| | Clicáveis testados | Mortos | Links quebrados |
|---|---|---|---|
| Site (10 páginas) | 69 botões + 47 links | **0** | **0** |
| Extensão (14 telas + Treinamento) | 179 | **0** | — |

## Defeitos reais encontrados e corrigidos

| # | Onde | O que era |
|---|---|---|
| **BTN-01** | dashboard, "Falar com o suporte" | `<a href="mailto:">`. Sem programa de e-mail configurado, clicar não faz nada. Removido a pedido do dono; o endereço ficou no texto. De quebra, usava `.com` enquanto o resto do site usa `.com.br` |
| **BTN-02** | dashboard, "Comprar tokens" | só `scrollIntoView`. Com a seção de pacotes já visível, o scroll não tinha para onde ir: zero resposta. Agora rola **e destaca** a seção |
| **BTN-03** | Treinamento, "📤 Enviar" | `if (!userText) return;` — com o campo vazio, saía em silêncio. Agora avisa e põe foco no campo |
| **SITE-01** | home, prova social | anunciava o plano "Business" por R$ 199,90, que não existe |

## Cinco falsos positivos do meu próprio método

Vale registrar, porque cada um escondia (ou inventava) defeito:

| # | O que o harness não enxergava | Efeito |
|---|---|---|
| 1 | marcadores perdidos após a 1ª navegação | 52 botões do site acusados sem ser |
| 2 | `confirm()` descartado pelo Playwright | "Cancelar" da assinatura acusado |
| 3 | validação nativa do navegador | "Continuar" do cadastro acusado |
| 4 | aba nova (`chrome.tabs.create` / `window.open`) | 12 botões da extensão acusados |
| 5 | elemento de modal que some entre a coleta e o clique | 2 acusados, depois 27 pulados |

Também havia uma lacuna silenciosa: as páginas públicas eram varridas **com
sessão aberta**, então `login.html` e `signup.html` redirecionavam para o painel
e nunca eram testadas — as duas telas mais críticas, puladas sem aviso.

## O que NÃO foi clicado, e por quê

**55 chips do seletor de etiqueta do CRM.** Clicar em um fecha o seletor e leva
os outros junto; a varredura reabre o modal uma vez, mas não dá conta dos 16
ícones e das cores um a um.

Isso é aceitável porque eles **compartilham um único handler**
(`modules/labels.js`):

```js
const AVAILABLE_ICONS = ['🏷️','⭐','🔥','✅','⏳','📞','💼','❤️','🎯','💎','🚀','📌','🆕','💰','🛒','📧'];
...
modal.querySelectorAll('#icon-picker-grid .icon-option').forEach(opt => {
    opt.addEventListener('click', () => { ... });
});
```

São o mesmo código com dados diferentes: testar um exercita o mecanismo dos 16.
O mesmo vale para os chips de cor.

**4 links `mailto:`/externos** (help, privacy, terms e `web.whatsapp.com`) foram
conferidos pelo destino, não clicados — dependem de programa de e-mail ou saem
do site.

## Como repetir

```
bash audit/harness/start-backend.sh /tmp/btn 3000 18080 &
node audit/harness/botoes-todas-paginas.js
node audit/harness/botoes-extensao.js
```

Os dois saem com código 1 se acharem botão morto ou link quebrado.
