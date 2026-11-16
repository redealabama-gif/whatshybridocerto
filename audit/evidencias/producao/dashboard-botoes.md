# DASH-01 — nenhum botão do painel respondia (CSP bloqueia handler inline)

Relato do dono (15/11/2026): em `/dashboard.html`, "Ir para extensão",
"Ver meu saldo", "Comprar tokens", comprar cada pacote, "Assinar com renovação
automática", "Pagamento único", "Mudar plano", "Cancelar" e **até "Sair"** não
faziam nada. Pergunta dele: *"isso é um problema de fato, ou vai terminar quando
eu colocar no ar?"*

**É um problema de fato.** Não tem relação com localhost — o mesmo cabeçalho vai
para produção.

## Causa

Cabeçalho servido (medido com `curl -D - http://127.0.0.1:3000/dashboard.html`):

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' ... ; script-src-attr 'none'
```

`script-src-attr 'none'` é o padrão do helmet e bloqueia **handler inline** —
um atributo `onclick` no HTML simplesmente não executa. O `'unsafe-inline'` que
existe em `script-src` **não** cobre isso: `script-src-attr` é uma diretiva
separada e, estando presente, é ela que vale para atributos.

Por isso o padrão batia exatamente com o relato:

| Como o botão era ligado | Resultado |
|---|---|
| atributo `onclick` no HTML (17 botões) | **morto** |
| `addEventListener` no script (abas, "Instalar agora") | funcionava |

## Alcance (antes da correção)

| Página | Handlers inline | O que ficava morto |
|---|---|---|
| `dashboard.html` | 14 | todos os botões citados, inclusive **Sair** |
| `signup.html` | 2 | os dois botões **"Voltar"** do cadastro em etapas |
| `login.html` | 1 | o olho de **mostrar senha** |
| `index.html` | 1 | `onerror` do vídeo da home (fallback) |

## Medição no Chromium real (`audit/harness/dashboard-botoes.js`)

Antes — clicando com o mouse de verdade:

```
[billing] "Assinar com renovação automática" onclick=subscribeRecurring()
   clique: ok
   navegou: não | modal: nenhum | toast: nenhum        <- nada, nem pedido HTTP
[overview] "Sair" onclick=api.logout()
   clique: ok
   -> *** NADA ACONTECEU ***
```

Chamando a MESMA função direto pelo console (sem passar pelo atributo), tudo
funcionava — o que prova que o problema era o atributo, não a função:

```
=== subscribeRecurring() ===
   fetch: POST /api/v1/billing/subscribe-recurring -> 503
   toast: Erro: Administrador precisa configurar MERCADOPAGO_ACCESS_TOKEN
```

Depois da correção, clicando com o mouse:

```
[overview] "Ver meu saldo →"      aba: tab-overview -> tab-tokens (MUDOU)        -> REAGIU
[extension] "Instalar agora"      toast: Em breve disponível na Chrome Web Store -> REAGIU
[tokens]   "Comprar tokens"       scrollY=534 (rolou até os pacotes)             -> REAGIU
[billing]  "Assinar com renov..." 503 + toast "configurar MERCADOPAGO_ACCESS_TOKEN" -> REAGIU
[billing]  "Pagamento único"      503 + toast                                     -> REAGIU
[billing]  "Cancelar"             REAGIU (confirm() aparece)
=== SAIR: clicando no botão de verdade ===
antes:  {"jwt":true,  "chaves":["wh_jwt","whl_lang","wh_user"]}
depois: {"url":".../login.html","jwt":false,"chaves":["whl_lang"]}
```

Os 503 do MercadoPago são **corretos**: o dono ainda não configurou
`MERCADOPAGO_ACCESS_TOKEN`. O defeito era não aparecer aviso nenhum.

## Correção

Nenhum afrouxamento de CSP. Todos os handlers inline viraram `addEventListener`:

- `dashboard.html`: cada botão declara `data-act` (e `data-arg` quando precisa) e
  uma única ligação por **delegação** no documento — isso cobre também os botões
  criados depois, como os pacotes de tokens.
- `login.html`: `id="toggle-pwd"` + listener.
- `signup.html`: `data-goto-step` + listener.
- `index.html`: `data-hide-on-error` + listener de `error`.

## Regressão

`tests/integration/csp-handlers-inline.spec.js` varre as 10 páginas de `public/`
e falha se qualquer uma voltar a usar `on*="..."`. Antes: 4 páginas falhando.
Depois: 10/10.

## Por que a varredura anterior do site não pegou

A Fase 2 (site) conferiu páginas, links e formulários — e os formulários usam
`addEventListener`, então passavam. Faltou clicar em cada botão de ação e
verificar que ele REAGE. O harness novo faz isso.
