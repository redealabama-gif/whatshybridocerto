#!/usr/bin/env node
// Roda arquivos de teste da extensão (tests/unit/<arquivo>) com o harness do
// projeto e mostra só o resultado dos casos (os logs dos módulos são omitidos).
// Uso (na raiz): node audit/scripts/run-ext-test.js autopilot-guard-failclosed.test.js
'use strict';
const path = require('path');
const EXT = path.resolve(__dirname, '../../whatshybrid-extension');
process.chdir(EXT);
const out = console.log.bind(console);
const keep = (s) => typeof s === 'string' && /^(\s{2}[✓✗] |\s{6}\S|\n\s{2}\d+ passou|• )/.test(s);
console.log = (...a) => { if (a.length === 1 && keep(a[0])) out(a[0]); };
console.info = console.warn = console.error = console.debug = () => {};
for (const f of process.argv.slice(2)) { out('• ' + f); require(path.join(EXT, 'tests/unit', f)); }
require(path.join(EXT, 'tests/_harness')).run().then((fail) => process.exit(fail > 0 ? 1 : 0));
