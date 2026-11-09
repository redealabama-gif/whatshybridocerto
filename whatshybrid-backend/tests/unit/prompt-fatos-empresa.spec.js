'use strict';

/**
 * IA-58 — sem informação na base, o modelo inventava fatos da empresa.
 *
 * A regra final do prompt ("Antes de responder"), que o modelo segue melhor,
 * só citava preço, prazo, fidelidade, garantia, estoque e status de pedido.
 * O aviso "sem informação na base" ficava no meio do prompt e era ignorado.
 * Medido com gpt-4o-mini (conta nova, sem treino), 3 amostras cada:
 * "Vocês têm estacionamento?" → "Sim, temos estacionamento disponível";
 * "Quanto tempo dura a avaliação?" → "cerca de 30 a 45 minutos";
 * "Aceitam cartão? Dá pra parcelar?" → "aceitamos… até 12 vezes" — 9 de 9
 * inventados, enquanto preço/fidelidade (citados na regra) viravam "vou
 * confirmar". Evidência: audit/evidencias/fase3/IA-58-amostras.md.
 */

const { DynamicPromptBuilder } = require('../../src/ai/prompts/DynamicPromptBuilder');

const regraFinal = () => {
  const prompt = new DynamicPromptBuilder().build({ language: 'pt-BR' }).prompt;
  const ini = prompt.indexOf('# Antes de responder');
  return ini >= 0 ? prompt.slice(ini) : '';
};

describe('IA-58 — fatos da empresa sem base', () => {
  test('a regra final cobre qualquer fato da empresa, não só preço e prazo', () => {
    const r = regraFinal();
    for (const fato of ['estacionamento', 'duração', 'forma de pagamento', 'endereço', 'horário']) {
      expect(r).toMatch(new RegExp(fato, 'i'));
    }
    expect(r).toMatch(/não afirme nem negue/i);
  });
});
