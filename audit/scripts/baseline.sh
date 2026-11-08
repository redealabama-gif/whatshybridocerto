#!/usr/bin/env bash
# Auditoria IA — Etapa 0: baseline. Roda os checks do repo e registra o
# resultado (código de saída + final da saída) em audit/evidencias/.
# Uso (na raiz):  bash audit/scripts/baseline.sh [rótulo]
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="${1:-antes}"
OUT="$ROOT/audit/evidencias/baseline-$LABEL"
mkdir -p "$OUT"
SUMMARY="$OUT/RESUMO.md"
echo "# Baseline ($LABEL) — $(date -u +%FT%TZ)" > "$SUMMARY"
echo "" >> "$SUMMARY"
echo "| Comando | Diretório | Saída | Resultado (final do log) |" >> "$SUMMARY"
echo "|---|---|---:|---|" >> "$SUMMARY"

run() { # dir nome cmd...
  local dir="$1"; shift; local name="$1"; shift
  local log="$OUT/$name.log"
  ( cd "$ROOT/$dir" && timeout 900 "$@" ) > "$log" 2>&1
  local code=$?
  local tailmsg
  tailmsg="$(grep -E 'passou|falhou|Tests:|Test Suites:|passed|failed|problems?|error|✅|❌|OK|ok' "$log" | tail -3 | tr '\n' ' ' | tr '|' '/' | cut -c1-220)"
  echo "| \`$*\` | $dir | $code | $tailmsg |" >> "$SUMMARY"
  echo "[$code] $dir :: $*"
}

E=whatshybrid-extension
B=whatshybrid-backend
run "$E" ext-verify-bundles npm run verify:bundles
run "$E" ext-tests node tests/run-all.js
run "$E" ext-canary npm run canary
run "$E" ext-lint npx eslint .
run "$B" be-unit npx jest --ci
run "$B" be-integration npm run test:integration
run "$B" be-smoke npm test
run "$B" be-lint npm run lint
run "$B" be-typecheck npm run typecheck
run "$B" be-audit-gate npm run audit:gate
run . root-validate-versions npm run validate:versions
echo "" >> "$SUMMARY"
echo "Logs completos: \`audit/evidencias/baseline-$LABEL/*.log\`" >> "$SUMMARY"
