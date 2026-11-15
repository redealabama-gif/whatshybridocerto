/**
 * LGP-02 — a política de privacidade precisa descrever o que o produto REALMENTE faz.
 *
 * Duas lacunas encontradas na Fase 7:
 *  1. o recurso "Recover" guarda mensagens que o remetente APAGOU e a versão
 *     anterior de mensagens EDITADAS, e o Extrator coleta contatos e membros de
 *     grupos — nada disso aparecia na política (transparência, LGPD art. 9º);
 *  2. a política afirmava "Não usamos cookies de marketing nem rastreamento de
 *     terceiros", mas o site carrega Google Analytics (gtag) e Meta Pixel (fbq)
 *     quando GA_MEASUREMENT_ID / META_PIXEL_ID estão configurados — afirmação
 *     falsa assim que o dono liga os IDs.
 *
 * Este teste lê os arquivos do site: trava a política contra o que o código faz.
 */

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '../../public');
const texto = (arq) => fs.readFileSync(path.join(PUBLIC, arq), 'utf8');
const semTags = (html) => html
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

describe('LGP-02 — política de privacidade bate com o produto', () => {
  const privacidade = semTags(texto('privacy.html'));

  test('descreve a captura de mensagens apagadas e editadas (Recover)', () => {
    expect(privacidade).toMatch(/apagad/);
    expect(privacidade).toMatch(/editad/);
    expect(privacidade).toMatch(/recover/);
  });

  test('descreve a extração de contatos e de membros de grupos', () => {
    expect(privacidade).toMatch(/extrator/);
    expect(privacidade).toMatch(/grupos/);
  });

  test('não afirma que NÃO há rastreamento de terceiros (o site carrega GA e Meta Pixel)', () => {
    const carregaGA = /googletagmanager\.com\/gtag/.test(texto('index.html'));
    const carregaPixel = /connect\.facebook\.net|fbq\(/.test(texto('index.html'));
    expect(carregaGA || carregaPixel).toBe(true); // o site realmente tem os dois
    expect(privacidade).not.toMatch(/não usamos cookies de marketing nem rastreamento de terceiros/);
    expect(privacidade).toMatch(/analytics|pixel/);
  });

  test('continua cobrindo o básico da LGPD (direitos, retenção, compartilhamento, encarregado)', () => {
    for (const termo of ['lgpd', 'exclusão', 'portabilidade', 'retenção', 'openai', 'mercadopago', 'encarregado']) {
      expect(privacidade).toContain(termo);
    }
  });
});
