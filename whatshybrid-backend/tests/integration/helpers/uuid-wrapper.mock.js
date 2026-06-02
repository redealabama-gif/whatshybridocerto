/**
 * Mock do uuid-wrapper para Jest.
 *
 * O wrapper real usa `import('uuid')` dinâmico (uuid v11 é ESM-only), o que o
 * ambiente CommonJS do Jest não suporta sem --experimental-vm-modules. Aqui
 * usamos crypto.randomUUID() — o mesmo formato v4 que o uuid produz — de forma
 * síncrona. Comportamento equivalente ao de produção.
 */
const crypto = require('crypto');

const v4 = () => crypto.randomUUID();

module.exports = {
  initUUID: async () => {},
  generateUUID: async () => v4(),
  uuidv4: v4,
  v4,
};
