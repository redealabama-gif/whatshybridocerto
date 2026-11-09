'use strict';

/**
 * IA-42 — com o LLM respondendo, a sugestão saía com voz de atendente de loja
 * em qualquer conversa ("Estou aqui para ajudar. Se houver algo específico, me
 * avise") e invertia papéis: o dono da conta tratado como vendedor quando ele
 * era o comprador ("Ótimo saber que o rastreio é da Jet! Eles costumam ser bem
 * eficientes"). Medido com a chave real: audit/evidencias/chaves-reais/antes.md.
 *
 * Causas: a identidade sem persona era "You are a professional customer
 * service assistant."; as diretrizes comerciais valiam para qualquer conversa;
 * e o verificador de qualidade reprovava toda resposta sem chamada para ação
 * (missing_cta), regenerando com "sempre conduza o cliente para o próximo passo".
 */

const { DynamicPromptBuilder } = require('../../src/ai/prompts/DynamicPromptBuilder');
const ResponseQualityChecker = require('../../src/ai/quality/ResponseQualityChecker');

const buildPrompt = (persona = null) => new DynamicPromptBuilder().build({ persona, language: 'pt-BR' }).prompt;

describe('IA-42 — papel do dono da conta na conversa', () => {
  test('sem persona: escreve a próxima mensagem do dono da conta, não um atendente', () => {
    const prompt = buildPrompt();
    expect(prompt).not.toMatch(/customer service assistant/i);
    expect(prompt).toMatch(/próxima mensagem que o dono deste WhatsApp/i);
    expect(prompt).toMatch(/não presuma que ele é o vendedor/i);
    expect(prompt).toMatch(/Em que posso ser útil/); // citada como frase a evitar
    expect(prompt).toMatch(/só valem quando a conversa é atendimento/i);
  });

  test('o prompt termina com o lembrete do papel, mesmo com orçamento apertado', () => {
    const { prompt } = new DynamicPromptBuilder().build({ persona: null, language: 'pt-BR', totalBudget: 300 });
    const tail = prompt.slice(prompt.lastIndexOf('# Antes de responder'));
    expect(prompt.lastIndexOf('# Antes de responder')).toBeGreaterThan(0);
    expect(tail).toMatch(/ignore as diretrizes comerciais/i);
    expect(tail).toMatch(/só afirme o que estiver na conversa ou na base/i);
    expect(tail).toMatch(/não tem fidelidade/);
    expect(tail).toMatch(/R\$ XXX/);
  });

  test('com persona: mantém a persona e as mesmas regras de papel', () => {
    const prompt = buildPrompt({ name: 'Vendedor consultivo', systemPrompt: 'Seja consultivo e objetivo.' });
    expect(prompt).toMatch(/Vendedor consultivo/);
    expect(prompt).toMatch(/Seja consultivo e objetivo\./);
    expect(prompt).toMatch(/próxima mensagem que o dono deste WhatsApp/i);
  });
});

describe('IA-42 — verificador de qualidade', () => {
  const ctx = { message: 'Esse rastreio é da transportadora Jet', goal: 'recuperar_engajamento', intent: 'information' };

  test('resposta natural e específica, sem chamada para ação, é aprovada', () => {
    const r = new ResponseQualityChecker().evaluate('Beleza, vou acompanhar pela Jet. Valeu pelo código!', ctx);
    expect(r.passed).toBe(true);
  });

  test('frases de atendimento genéricas são reprovadas como genéricas', () => {
    const checker = new ResponseQualityChecker();
    for (const t of [
      'Ok! Em que posso ser útil?',
      'Certo! Pode me dar mais detalhes?',
      'Compreendo. Posso ajudar com mais alguma informação?',
      'Entendo. Estou aqui para ajudar. Se houver algo específico, me avise.',
    ]) {
      expect({ t, issues: checker.evaluate(t, { ...ctx, goal: 'responder_duvida' }).issues }).toEqual({ t, issues: expect.arrayContaining(['generic']) });
    }
  });

  test('a regeneração não pede mais chamada para ação', () => {
    const r = new ResponseQualityChecker().evaluate('Entendo. Estou aqui para ajudar.', { ...ctx, goal: 'fechar_venda' });
    expect(r.passed).toBe(false);
    expect(r.reinforcement).not.toMatch(/CALL-TO-ACTION|próximo passo/i);
  });
});
