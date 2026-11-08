# Baseline (antes) — 2026-11-08T19:02:50Z

| Comando | Diretório | Saída | Resultado (final do log) |
|---|---|---:|---|
| `npm run verify:bundles` | whatshybrid-extension | 0 | [bundles] ✅ bundles em sincronia com a fonte (133 arquivos).  |
| `node tests/run-all.js` | whatshybrid-extension | 0 |   ✓ Recover: content/wpp-hooks.js está em sincronia com wpp-hooks-parts (rode o build)   ✓ checkOne: DEGRADED quando só um fallback casa; BROKEN quando nada casa   70 passou, 0 falhou (70 no total)  |
| `npm run canary` | whatshybrid-extension | 0 | [WACanary] ✅ OK — 10 seletores em sincronia com o runtime, forma válida.  |
| `npx eslint .` | whatshybrid-extension | 2 | ESLint looked for configuration files in /home/user/whatshybridocerto/whatshybrid-extension/adapters and its ancestors. If it found none, it then looked in your home directory.  |
| `npx jest --ci` | whatshybrid-backend | 0 |       at Layer.handle_error (../node_modules/express/lib/router/layer.js:71:5) Test Suites: 18 passed, 18 total Tests:       136 passed, 136 total  |
| `npm run test:integration` | whatshybrid-backend | 0 |       at Object.error [as get] (src/utils/db/sqlite-driver.js:53:12) Test Suites: 9 passed, 9 total Tests:       54 passed, 54 total  |
| `npm test` | whatshybrid-backend | 2 | npm error location /home/user/whatshybridocerto/whatshybrid-backend npm error command failed npm error command sh -c node tests/smoke/run-all.js  |
| `npm run lint` | whatshybrid-backend | 0 | /home/user/whatshybridocerto/whatshybrid-backend/tests/e2e/server-smoke.test.js ✖ 87 problems (0 errors, 87 warnings)   0 errors and 11 warnings potentially fixable with the `--fix` option.  |
| `npm run typecheck` | whatshybrid-backend | 0 |  |
| `npm run audit:gate` | whatshybrid-backend | 0 |    ::warning::high fast-uri GHSA-4c8g-83qw-93j6 — fast-uri vulnerable to host confusion via failed IDN canonicalization ✅ Sem high/critical de produção fora do allowlist.  |
| `npm run validate:versions` | . | 1 |  |

Logs completos: `audit/evidencias/baseline-antes/*.log`
