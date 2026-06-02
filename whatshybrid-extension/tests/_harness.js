/**
 * Harness de teste mínimo, ZERO dependência (roda com `node` puro, sem npm ci).
 *
 * Os testes registram casos com test(nome, fn) e usam o `assert` nativo do Node
 * (require('node:assert')). O run-all.js requer os arquivos de teste (que
 * registram aqui) e chama run().
 */

const cases = [];

function test(name, fn) {
  cases.push({ name, fn });
}

async function run() {
  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    try {
      await c.fn();
      console.log('  ✓ ' + c.name);
      pass++;
    } catch (e) {
      console.log('  ✗ ' + c.name);
      console.log('      ' + ((e && e.message) || e));
      fail++;
    }
  }
  console.log('\n  ' + pass + ' passou, ' + fail + ' falhou (' + cases.length + ' no total)');
  return fail;
}

module.exports = { test, run };
