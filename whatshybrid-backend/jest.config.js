/**
 * Jest config.
 *
 * Convenção: testes Jest reais usam sufixo `.spec.js`. Os arquivos `.test.js`
 * em `tests/unit/` são scripts standalone legados (rodáveis via `node`) que
 * chamam process.exit() ao final — Jest engole o exit e quebra. Por isso são
 * explicitamente excluídos aqui. Conforme cada um for migrado pra Jest,
 * renomeie pra `.spec.js`.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.spec.js'],
  testPathIgnorePatterns: ['/node_modules/', '/data/'],
  // Não polui o output com chamadas a console.log dos services
  silent: false,
  // Timeout default — testes de SQL/HTTP locais são rápidos
  testTimeout: 10000,
};
