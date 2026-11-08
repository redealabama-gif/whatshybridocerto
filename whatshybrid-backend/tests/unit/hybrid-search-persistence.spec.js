'use strict';

/**
 * Persistência do índice do HybridSearch (snapshot em disco).
 *
 * Regressão de dois defeitos:
 * - _flushToDisk fazia Object.fromEntries(tf) num objeto simples e lançava
 *   "object is not iterable": nenhum snapshot era gravado;
 * - loadFromDisk restaurava cada tf como Map, que o BM25 não lê (tf[termo]):
 *   documentos restaurados pontuavam 0.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const HybridSearch = require('../../src/ai/search/HybridSearch');

function snapshotDocs(hs) {
  return JSON.parse(fs.readFileSync(hs.snapshotPath, 'utf8')).documents.length;
}

describe('HybridSearch: snapshot em disco', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-persist-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function indexed() {
    const hs = new HybridSearch({ tenantId: 'spec', persistenceDir: dir });
    await hs.addDocument({
      id: 'faq:1',
      content: 'entregamos em todo o Brasil pelos Correios',
      metadata: {},
    });
    await hs.addDocument({
      id: 'faq:2',
      content: 'aceitamos pagamento via PIX e cartão',
      metadata: {},
    });
    await hs.flush();
    return hs;
  }

  test('grava o snapshot sem erro', async () => {
    const hs = await indexed();
    expect(fs.existsSync(hs.snapshotPath)).toBe(true);
    expect(snapshotDocs(hs)).toBe(2);
  });

  test('índice recarregado do disco pontua no BM25 e remove documentos', async () => {
    await indexed();
    const loaded = new HybridSearch({ tenantId: 'spec', persistenceDir: dir });
    await loaded.loadFromDisk();
    expect(loaded.documents.size).toBe(2);

    const hits = loaded._searchBM25('pagamento pix', 5);
    expect(hits[0]).toMatchObject({ docId: 'faq:2' });
    expect(hits[0].score).toBeGreaterThan(0);

    loaded.removeDocument('faq:2');
    expect(loaded.documentFrequencies.has('pix')).toBe(false);
    await loaded.flush();
  });

  test('clear() também zera o snapshot em disco', async () => {
    const hs = await indexed();
    hs.clear();
    await hs.flush();
    expect(snapshotDocs(hs)).toBe(0);

    const loaded = new HybridSearch({ tenantId: 'spec', persistenceDir: dir });
    await loaded.loadFromDisk();
    expect(loaded.documents.size).toBe(0);
  });
});
