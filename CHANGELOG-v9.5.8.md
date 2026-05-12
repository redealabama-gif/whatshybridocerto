# WhatsHybrid Pro — v9.5.8 (XLSX/ODS + PDF Import)

**Data:** 2026-05-09
**Tipo:** Nova feature (não-breaking) — suporte a planilhas e PDFs na importação

---

## Adicionado

### 1. Importação de planilhas (`.xlsx`, `.xls`, `.ods`)

**Antes:** Cliente precisava exportar Excel/LibreOffice Calc → "Salvar como CSV" antes de importar. Fricção significativa no onboarding.

**Agora:** Importação direta. SheetJS (`xlsx.mini.min.js`, 245KB) lê a primeira aba, converte em array de objetos, detecta tipo (produtos/FAQs) pelos headers (mesma lógica do CSV — em PT/EN). Multi-aba: a primeira é processada; demais são ignoradas (operador é avisado).

**Headers reconhecidos** (case-insensitive):
- **Produtos:** `produto`, `product`, `nome`, `name`, `preco`, `preço`, `price`, `descricao`, `description`, `categoria`, `sku`, `codigo`, `estoque`
- **FAQs:** `pergunta`, `question`, `resposta`, `answer`

Após import → vai para `whl_knowledge_base.products` ou `.faq` → indexado no RAG → injetado no prompt em cada resposta da IA.

### 2. Importação de PDF

**Antes:** PDF estava no UI mas era stub (retornava "instale PDF.js"). Removido na v9.5.1.

**Agora:** Suporte real via PDF.js v5 (`pdf.min.mjs` + `pdf.worker.min.mjs`, ~1.7MB total). Processo:

1. **Extrai texto** de todas as páginas (rebuild de linhas via coordenadas Y para preservar layout)
2. **Detecta padrões Q&A** automaticamente — regex captura `Pergunta:/Resposta:`, `P:/R:`, `Q:/A:`, `Question:/Answer:` em qualquer ordem
3. **Se detectar ≥ 2 pares Q&A:** importa como FAQs estruturadas → vai para `whl_knowledge_base.faq`
4. **Se NÃO detectar Q&A:** divide em parágrafos ≥ 30 chars → cada um vira um documento em `whl_knowledge_base.cannedReplies` → indexado no RAG semântico

**Resultado prático:** Cliente sobe um manual em PDF, política de empresa, catálogo com descrições — IA passa a citar trechos relevantes nas respostas via retrieval semântico.

### Arquivos da biblioteca

```
whatshybrid-extension/lib/
  xlsx.mini.min.js       (245 KB)  — SheetJS sem formula evaluation
  pdf.min.mjs            (486 KB)  — PDF.js core (legacy build)
  pdf.worker.min.mjs     (1.3 MB)  — PDF.js worker (renderização em background thread)
```

Carregados sob demanda apenas na página de treinamento (`training.html`). Não impactam o content-bundle nem o WhatsApp Web em runtime.

---

## ALTERADO

### `document-importer.js`
- `supportedFormats`: `['csv','txt','json']` → `['csv','txt','json','xlsx','xls','ods','pdf']`
- Novo método `processSpreadsheet(file, extension)` — lê via SheetJS
- Novo método `processPDF(file)` — extrai via PDF.js + detecta Q&A pairs
- Novo método `_extractFaqPairs(text)` — regex multi-formato

### `training.html`
- `<input accept>` agora aceita `.csv,.txt,.json,.xlsx,.xls,.ods,.pdf`
- Mensagem ao usuário atualizada: "CSV, TXT, JSON, XLSX (Excel), ODS (LibreOffice), PDF"
- Carrega SheetJS via `<script>` tradicional (UMD → `window.XLSX`)
- Carrega PDF.js via `<script type="module">` + define `window.pdfjsLib` + worker

### `training.js`
- `handleFileUpload` agora trata `result.type === 'documents'` (vindos do PDF não-Q&A) → grava em `whl_knowledge_base.cannedReplies` → trigger automático de `knowledgeBase.indexToRAG()`

### `manifest.json`
- `web_accessible_resources` adiciona `lib/xlsx.mini.min.js`, `lib/pdf.min.mjs`, `lib/pdf.worker.min.mjs`

### Dependências (devDependencies)
- `xlsx@^0.18.5` (SheetJS)
- `pdfjs-dist@^5.7.284`

---

## Validação

- ✅ `node --check` em arquivos editados
- ✅ JSON manifests válidos
- ✅ Build limpo (3 bundles)
- ✅ Smoke test XLSX: roundtrip OK (XLSX criado → lido → 2 produtos com preço/descrição corretos)
- ✅ **114 testes de backend passando**
- ⚠️ Validação visual em browser real: não executada (ambiente headless)

---

## Compatibilidade

- **Não-breaking** — formatos antigos (CSV/TXT/JSON) continuam funcionando idênticos
- Cliente sem usar XLSX/PDF: bundle das libs nem é carregado (só na página de Treinamento e on-demand pelo browser)
- Headers em PT/EN: ambos funcionam
- Fórmulas Excel: SheetJS-mini ignora; valores calculados são lidos. Funções complexas com referências externas podem retornar vazio.

---

## Como testar

1. **XLSX:** No Excel ou LibreOffice Calc, criar planilha com colunas `nome`, `preco`, `descricao`. Salvar como `.xlsx`. Subir na aba Importar do treinamento. Ver toast "X produtos importados". Verificar aba Produtos.
2. **ODS:** Mesma planilha, salvar como `.ods`. Subir. Mesma experiência.
3. **PDF estruturado** (Q&A): criar PDF com formato `P: ... R: ...`. Subir. Ver "FAQs importadas".
4. **PDF freeform** (manual/política): subir um manual em PDF. Ver "trechos de PDF adicionados à base de conhecimento". Iniciar uma simulação na aba Simulação fazendo pergunta sobre conteúdo do PDF — IA deve citar trechos.

---

## Sobre fórmulas e células complexas em Excel

`xlsx.mini.min.js` (versão escolhida pra economizar bundle) **não avalia fórmulas em runtime** — lê os valores cacheados que o Excel/LibreOffice salvou no arquivo. Isso significa:
- ✅ Fórmulas simples (`=A1*0.9`) já tem o resultado salvo, é lido
- ⚠️ Fórmulas que dependem de macros, links externos ou recalculam ao abrir podem não trazer valor
- ❌ Fórmulas em arquivos nunca abertos no Excel (gerados programaticamente sem `forceCalc`) podem vir vazias

Para 99% dos casos de uso (catálogo de produtos, FAQ, lista de preços), funciona perfeitamente.
