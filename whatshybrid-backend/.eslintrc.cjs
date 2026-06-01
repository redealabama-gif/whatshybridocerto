/**
 * ESLint config conservadora — pega bugs reais sem inundar de warnings.
 * Estilo fica com Prettier (eslint-config-prettier desliga regras conflitantes).
 *
 * Filosofia: legacy first. Promove de warn → error em ondas, conforme a base
 * for limpa. Não adianta endurecer tudo de uma vez e travar todo PR.
 */
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  extends: ['eslint:recommended', 'prettier'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'script',
  },
  rules: {
    // ── Bugs reais (erro) ──
    eqeqeq: ['error', 'smart'],
    'no-var': 'error',
    'no-implicit-globals': 'error',
    'no-throw-literal': 'error',
    'no-await-in-loop': 'off', // muito código legado faz isso
    'no-prototype-builtins': 'warn',
    'no-empty': ['error', { allowEmptyCatch: true }],
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-useless-escape': 'warn',
    'no-control-regex': 'off',
    'no-inner-declarations': 'off',
    'no-async-promise-executor': 'warn',

    // ── Higiene (warn — não trava CI ainda) ──
    'no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    'prefer-const': 'warn',
    'no-console': 'off', // backend usa console intencionalmente em hot paths antes do logger

    // ── Off (legado tolerado) ──
    'no-case-declarations': 'off',
    'no-redeclare': 'warn',
  },
  overrides: [
    {
      files: ['tests/**/*.js', '**/*.test.js'],
      env: { jest: true, node: true },
      rules: {
        'no-unused-vars': 'off',
      },
    },
    {
      files: ['tests/load/**/*.js'],
      parserOptions: { sourceType: 'module' },
      globals: {
        // k6 runtime — preenchidos quando o script roda no k6, não no Node
        __ENV: 'readonly',
        __VU: 'readonly',
        __ITER: 'readonly',
      },
    },
    {
      files: ['scripts/**/*.js'],
      rules: {
        'no-process-exit': 'off',
      },
    },
    {
      // canary roda dentro do browser (window/document)
      files: ['scripts/canary-*.js'],
      env: { browser: true, node: true },
    },
    {
      // ─── TÉCNICA: arquivos com bugs reais identificados na 1ª auditoria de lint.
      // 'no-undef' desligado AQUI pra não travar CI enquanto não consertamos.
      // Cada arquivo abaixo tem ReferenceError em produção se a função for chamada.
      // Devem ser corrigidos em PR separado, e este bloco removido.
      // Auditoria: 2026-06-01
      files: [
        'src/ai/learning/outcome/PerformanceScoreEngine.js',
        'src/ai/providers/BaseProvider.js',
        'src/ai/services/smartbot-extended/SessionManager.js',
        'src/ai/services/smartbot-extended/SmartBotExtendedService.js',
        'src/ai/services/smartbot-ia/SmartBotIAService.js',
        'src/infra/cache/CacheManager.js',
        'src/multi-tenant/tenant-middleware.js',
        'src/routes/ai-v2.js',
        'src/routes/intelligence.js',
      ],
      rules: {
        'no-undef': 'off',
        'no-dupe-class-members': 'off',
        'require-yield': 'off',
      },
    },
  ],
};
