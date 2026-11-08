#!/usr/bin/env bash
# Build da extensão num diretório FORA do repositório, para usar o mesmo
# minificador ("manual") com que o dist/ versionado foi gerado — dentro do repo
# o build acha o esbuild do node_modules da raiz e gera bundles diferentes
# (achado IA-30). Copia de volta o que o build escreve e roda verify:bundles.
# Uso (na raiz): bash audit/scripts/build-isolado.sh [dir-de-trabalho]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${1:-${TMPDIR:-/tmp}/whl-build-isolado}"
rm -rf "$WORK"; mkdir -p "$WORK"
( cd "$ROOT" && tar --exclude=node_modules -cf - whatshybrid-extension ) | ( cd "$WORK" && tar -xf - )
( cd "$WORK/whatshybrid-extension" && npm run build --silent ) | grep -E "Minifier|✅|hash gravado|manifest" || true
for f in dist/core-bundle.js dist/content-bundle.js dist/advanced-bundle.js dist/build-report.json dist/build-sources.json manifest.json content/wpp-hooks.js; do
  cp "$WORK/whatshybrid-extension/$f" "$ROOT/whatshybrid-extension/$f"
done
( cd "$ROOT/whatshybrid-extension" && npm run verify:bundles --silent )
