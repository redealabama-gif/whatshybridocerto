# ADR 001 — Extension Bundler

**Status:** Accepted
**Date:** 2026-05-07

## Contexto

Extensão Chrome MV3 com 139 content scripts no manifest.json, totalizando ~3.2MB de JS. Cada inject no WhatsApp Web carregava 139 arquivos individuais — performance ruim, race conditions sutis, manifesto pesado.

Tentativa anterior de usar `esbuild` com `bundle: true` quebrou porque os scripts legados dependem de variáveis globais (`window.X`) e ordem específica de carga.

## Decisão

**Estratégia: concat + minify (não bundle).**

- Scripts são concatenados na ordem original do manifest
- Cada script é wrapped em `(function(){ try { ... } catch(e){} })()` para isolar `var` em scope mas preservar `window.X = ...`
- Esbuild aplica apenas `minify: true` (sem resolução de imports)
- Output em 3 bundles: `core` (i18n+constants+utils), `content` (runtime essencial), `advanced` (lazy-loaded)
- Manifest passa a referenciar `dist/core-bundle.js` + `dist/content-bundle.js` (139 → 2)
- `advanced-bundle.js` carregado dinamicamente via `chrome.scripting.executeScript` quando o sidepanel abre

## Alternativas consideradas

1. **Webpack/Rollup com tree-shaking real** — exigiria migrar todos os scripts pra ES modules (semanas de trabalho, alto risco de regressão)
2. **Manifest v3 nativo com module imports** — não suportado em content scripts até hoje (Chrome 122+ limitado)
3. **Manter manifest com 139 scripts** — performance ruim e crescente

## Consequências

✅ Inject reduz de 139 → 2 arquivos (verificado em DevTools)
✅ Tamanho via minify: ~3.2MB → ~1MB esperado (depende de esbuild instalado)
✅ Ordem preservada — zero risco de regressão funcional
✅ Sem mudança de paradigma de imports (legados continuam usando `window.X`)

❌ Não há tree-shaking real — código morto continua no bundle
❌ Source maps em dev funcionam mas em prod minified é difícil debugar
❌ Adicionar/remover script exige rebuild manual (não watch automático)

## Como manter

- Quando adicionar arquivo .js novo na extensão: edita `build-manifest.json` para incluir em `core`/`content`/`advanced`
- `npm run build` regenera bundles e atualiza `manifest.json`
- `manifest-prebuild.json` mantém backup do manifest pré-bundle (caso precise reverter)
