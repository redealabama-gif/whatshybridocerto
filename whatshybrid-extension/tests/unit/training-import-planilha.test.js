/**
 * IA-49 — importação de produtos por planilha na tela de treinamento.
 *
 * Três jeitos comuns de uma planilha brasileira chegar e que zeravam o preço:
 *  - cabeçalho com acento ("Preço", "Descrição"): o importador só lia
 *    preco/descricao → preço 0 e sem descrição;
 *  - CSV salvo pelo Excel em português, separado por ";": nem era reconhecido
 *    como produtos;
 *  - célula de preço formatada como moeda: o leitor devolve "R$ 650.00" /
 *    "R$ 1.250,00" e parseFloat dá NaN.
 * Preço 0 no banco → a IA não tem o preço e responde "R$ XXX" ou inventa.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const EXT = path.join(__dirname, '../..');
const XLSX = require(path.join(EXT, 'lib/xlsx.mini.min.js'));

function loadImporter() {
  const sandbox = { console: { log() {}, warn() {}, error() {} }, window: {}, XLSX };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'training/modules/document-importer.js'), 'utf8'), sandbox);
  return sandbox.window.documentImporter;
}
const csv = (name, text) => ({ name, text: async () => text });
function xlsxFile(rows, fmt) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (fmt) for (let r = 2; r <= rows.length; r++) if (ws[`B${r}`]) ws[`B${r}`].z = fmt;
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Produtos');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { name: 'produtos.xlsx', arrayBuffer: async () => buf };
}

test('IA-49: CSV com cabeçalho acentuado (Nome,Preço,Descrição) importa preço e descrição', async () => {
  const r = await loadImporter().processFile(csv('p.csv', 'Nome,Preço,Descrição\nClareamento dental,650,Sessão de 1 hora\n'));
  assert.strictEqual(r.type, 'products');
  assert.strictEqual(r.items[0].price, 650);
  assert.strictEqual(r.items[0].description, 'Sessão de 1 hora');
});

test('IA-49: CSV do Excel em português (separado por ;) com preço "R$ 1.250,00"', async () => {
  const r = await loadImporter().processFile(csv('p.csv', 'Nome;Preço;Descrição\nImplante;"R$ 1.250,00";Com coroa\nLimpeza;180,50;Profilaxia\n'));
  assert.strictEqual(r.type, 'products', `tipo detectado: ${r.type}`);
  assert.strictEqual(r.items[0].name, 'Implante');
  assert.strictEqual(r.items[0].price, 1250);
  assert.strictEqual(r.items[1].price, 180.5);
});

test('IA-49: XLSX com "Preço" formatado como moeda importa o valor', async () => {
  const r = await loadImporter().processFile(xlsxFile([['Nome', 'Preço', 'Descrição'], ['Clareamento dental', 650, 'Sessão de 1 hora'], ['Implante', 1250.5, 'Com coroa']], '"R$" #,##0.00'));
  assert.strictEqual(r.type, 'products');
  assert.strictEqual(r.items[0].price, 650);
  assert.strictEqual(r.items[1].price, 1250.5);
  assert.strictEqual(r.items[0].description, 'Sessão de 1 hora');
});

test('IA-49 (controle): planilha simples sem acento continua igual', async () => {
  const r = await loadImporter().processFile(csv('p.csv', 'nome,preco,descricao\nLimpeza,180,Profilaxia\n'));
  assert.strictEqual(r.items[0].price, 180);
  assert.strictEqual(r.items[0].description, 'Profilaxia');
});
