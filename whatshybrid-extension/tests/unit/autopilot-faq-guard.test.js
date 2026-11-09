/**
 * IA-02 — resposta pronta do ConfidenceSystem (FAQ / resposta rápida) também
 * passa pela guarda do backend, que avalia a MENSAGEM do cliente (pedido de
 * humano, reclamação, tema sensível...). Cenário D da auditoria
 * (audit/evidencias/30-autopilot.md): a FAQ de prazo era enviada com 0 chamadas
 * ao backend, mesmo com "quero falar com um humano".
 */
const assert = require('node:assert');
const { test } = require('../_harness');
const { runOne } = require('./_autopilot-env');

const FAQ_ANSWER = 'Nosso prazo de entrega é de 5 a 7 dias úteis.';
const FAQ_MATCH = async () => ({ canSend: true, reason: 'faq_match', confidence: 90, answer: FAQ_ANSWER });

test('IA-02: FAQ + pedido de humano → consulta a guarda e NÃO envia', async () => {
  const r = await runOne({
    canAutoSendSmart: FAQ_MATCH,
    process: async () => ({
      success: true,
      response: 'Texto gerado pelo backend.',
      metadata: { autopilot: { allowAutoSend: false, escalate: true, reasons: ['human_requested', 'negative_sentiment'], primaryReason: 'human_requested', riskTier: 'high', minConfidence: 101 } },
    }),
  }, '5511900000011', 'Péssimo atendimento! Qual o prazo de entrega? Quero falar com um humano agora');
  assert.strictEqual(r.sent.length, 0, `enviou: ${JSON.stringify(r.sent)}`);
  assert.strictEqual(r.backendCalls, 1, `a guarda do backend não foi consultada (chamadas=${r.backendCalls})`);
  assert.ok(r.suggestionOnly.some((s) => s.reason === 'backend_escalation' && s.primaryReason === 'human_requested'),
    `esperava revisão por backend_escalation/human_requested, veio ${JSON.stringify(r.suggestionOnly)}`);
});

test('IA-02: FAQ + mensagem comum + guarda libera → envia a resposta da FAQ', async () => {
  const r = await runOne({
    canAutoSendSmart: FAQ_MATCH,
    process: async () => ({
      success: true,
      response: 'Texto gerado pelo backend.',
      metadata: { autopilot: { allowAutoSend: true, escalate: false, reasons: [], primaryReason: null, riskTier: 'normal', minConfidence: 85 } },
    }),
  }, '5511900000012', 'Qual o prazo de entrega?');
  assert.strictEqual(r.backendCalls, 1, `a guarda do backend não foi consultada (chamadas=${r.backendCalls})`);
  assert.strictEqual(r.sent.length, 1, `esperava 1 envio, houve ${r.sent.length} · revisão=${JSON.stringify(r.suggestionOnly)}`);
  assert.strictEqual(r.sent[0].text, FAQ_ANSWER, 'deveria enviar a resposta pronta da FAQ');
});
