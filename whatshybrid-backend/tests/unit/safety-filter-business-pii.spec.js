'use strict';

/**
 * IA-07 — ResponseSafetyFilter: dado que veio da base da própria empresa ou da
 * conversa do próprio cliente não é vazamento. Antes, telefone/e-mail da loja e
 * o nº de pedido que o cliente mandou trocavam a resposta por "Desculpe, não
 * posso processar essa solicitação…" (audit/evidencias/21-filtro-pii-falso-positivo.txt).
 */

const ResponseSafetyFilter = require('../../src/ai/safety/ResponseSafetyFilter');

const f = new ResponseSafetyFilter();
const BUSINESS = 'Empresa: Loja A\nTelefone: (11) 98765-4321\nEmail: contato@lojaa.com.br\nHorário de atendimento: Seg a Sex 9h–18h';

describe('IA-07 — PII do próprio negócio / do próprio cliente', () => {
  test('telefone e e-mail da loja (estão na base) → resposta mantida', () => {
    const r = f.validate(
      'Claro! Chame no nosso WhatsApp comercial (11) 98765-4321 ou escreva para contato@lojaa.com.br.',
      { allowedText: BUSINESS }
    );
    expect(r.safe).toBe(true);
    expect(r.issues.map((i) => i.type)).not.toContain('pii_leak');
  });

  test('nº de pedido que o próprio cliente mandou → resposta mantida', () => {
    const r = f.validate(
      'Encontrei aqui! Seu pedido 87654321 foi despachado ontem e chega em até 3 dias úteis.',
      { allowedText: `${BUSINESS}\nCliente: oi, meu pedido 87654321 ainda não chegou` }
    );
    expect(r.safe).toBe(true);
  });
});

describe('IA-07 (controle) — vazamento de verdade continua bloqueado', () => {
  test('CPF e cartão que não estão na base nem na conversa → bloqueia', () => {
    const r = f.validate('O CPF dele é 123.456.789-09 e o cartão 4111 1111 1111 1111.', { allowedText: BUSINESS });
    expect(r.safe).toBe(false);
    expect(r.issues.find((i) => i.type === 'pii_leak').piiTypes).toEqual(expect.arrayContaining(['CPF', 'credit_card']));
  });

  test('telefone que NÃO é o da loja → bloqueia', () => {
    const r = f.validate('Fala direto com o João no (21) 99999-0000.', { allowedText: BUSINESS });
    expect(r.safe).toBe(false);
  });

  test('sem contexto (chamada antiga) → comportamento antigo: bloqueia', () => {
    const r = f.validate('Chame no (11) 98765-4321.');
    expect(r.safe).toBe(false);
  });
});
