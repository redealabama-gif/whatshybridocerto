# Baseline (depois) — 2026-11-09T00:51:48Z

| Comando | Diretório | Saída | Resultado (final do log) |
|---|---|---:|---|
| `npm run verify:bundles` | whatshybrid-extension | 0 | [bundles] ✅ bundles em sincronia com a fonte (134 arquivos).  |
| `node tests/run-all.js` | whatshybrid-extension | 0 |   type: 'selector_broken',   ✓ checkOne: DEGRADED quando só um fallback casa; BROKEN quando nada casa   108 passou, 0 falhou (108 no total)  |
| `npm run canary` | whatshybrid-extension | 0 | [WACanary] ✅ OK — 10 seletores em sincronia com o runtime, forma válida.  |
| `npx eslint .` | whatshybrid-extension | 2 | ESLint looked for configuration files in /home/user/whatshybridocerto/whatshybrid-extension/adapters and its ancestors. If it found none, it then looked in your home directory.  |
| `npx jest --ci` | whatshybrid-backend | 0 |       {"level":"warn","message":"[HybridIntentClassifier] LLM falhou, usando fallback regex:","detail":"The operation was aborted due to timeout","timestamp":"2026-11-09T00:53:06.706Z"} Test Suites: 29 passed, 29 total T |
| `npm run test:integration` | whatshybrid-backend | 0 |       at Object.error [as get] (src/utils/db/sqlite-driver.js:53:12) Test Suites: 12 passed, 12 total Tests:       66 passed, 66 total  |
| `npm test` | whatshybrid-backend | 2 | npm error location /home/user/whatshybridocerto/whatshybrid-backend npm error command failed npm error command sh -c node tests/smoke/run-all.js  |
| `npm run lint` | whatshybrid-backend | 0 | /home/user/whatshybridocerto/whatshybrid-backend/tests/e2e/server-smoke.test.js ✖ 86 problems (0 errors, 86 warnings)   0 errors and 11 warnings potentially fixable with the `--fix` option.  |
| `npm run typecheck` | whatshybrid-backend | 0 |  |
| `npm run audit:gate` | whatshybrid-backend | 0 |    ::warning::high fast-uri GHSA-4c8g-83qw-93j6 — fast-uri vulnerable to host confusion via failed IDN canonicalization ✅ Sem high/critical de produção fora do allowlist.  |
| `npm run validate:versions` | . | 1 |  |

Logs completos: `audit/evidencias/baseline-depois/*.log`
