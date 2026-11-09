/**
 * IA-01 — o autopilot só envia sozinho o que passou por uma guarda de risco E
 * de confiança. Sem a guarda do backend (metadata.autopilot ausente), ou sem
 * como comparar a confiança com o limiar, a resposta vai para revisão humana.
 *
 * Mensagens reais da auditoria (audit/evidencias/30-autopilot.md). A decisão
 * do ConfidenceSystem segue o formato REAL de canAutoSendSmart (campo
 * `confidence`, não `score`) — "Oi, ..." é tratado como saudação (95).
 */
const assert = require('node:assert');
const { test } = require('../_harness');
const { runOne } = require('./_autopilot-env');

const GREETING_95 = async () => ({ canSend: true, reason: 'greeting', confidence: 95, answer: null });

test('IA-01: backend sem metadata.autopilot → NÃO envia, vai para revisão', async () => {
  const r = await runOne({
    canAutoSendSmart: GREETING_95,
    process: async () => ({ success: true, response: 'Claro! Vamos devolver seu dinheiro hoje mesmo.', metadata: {} }),
  }, '5511900000001', 'Oi, quero meu dinheiro de volta, vou no Procon');
  assert.strictEqual(r.sent.length, 0, `enviou sem guarda: ${JSON.stringify(r.sent)}`);
  assert.ok(r.suggestionOnly.some((s) => s.reason === 'no_backend_guard'), `esperava revisão por no_backend_guard, veio ${JSON.stringify(r.suggestionOnly)}`);
});

test('IA-01: confiança abaixo do limiar do tier (campo `confidence`) → NÃO envia', async () => {
  const r = await runOne({
    canAutoSendSmart: async () => ({ canSend: true, reason: 'product_match', confidence: 78, answer: null }),
    process: async () => ({ success: true, response: 'O plano Pro custa R$ 189/mês.', metadata: { autopilot: { allowAutoSend: true, minConfidence: 85, riskTier: 'normal', reasons: [], escalate: false } } }),
  }, '5511900000002', 'Quanto custa o plano Pro?');
  assert.strictEqual(r.sent.length, 0, `enviou com confiança 78 < 85: ${JSON.stringify(r.sent)}`);
  assert.ok(r.suggestionOnly.some((s) => s.reason === 'tier_confidence'), `esperava tier_confidence, veio ${JSON.stringify(r.suggestionOnly)}`);
});

test('IA-01: confiança desconhecida → NÃO envia', async () => {
  const r = await runOne({
    canAutoSendSmart: async () => ({ canSend: true, reason: 'ok' }),
    process: async () => ({ success: true, response: 'Resposta qualquer.', metadata: { autopilot: { allowAutoSend: true, minConfidence: 70, riskTier: 'low', reasons: [], escalate: false } } }),
  }, '5511900000003', 'Bom dia');
  assert.strictEqual(r.sent.length, 0, `enviou sem confiança conhecida: ${JSON.stringify(r.sent)}`);
});

test('IA-01 (controle): guarda libera e confiança ≥ limiar → envia 1x', async () => {
  const r = await runOne({
    canAutoSendSmart: GREETING_95,
    process: async () => ({ success: true, response: 'Bom dia! Como posso ajudar?', metadata: { autopilot: { allowAutoSend: true, minConfidence: 70, riskTier: 'low', reasons: [], escalate: false } } }),
  }, '5511900000004', 'Bom dia');
  assert.strictEqual(r.sent.length, 1, `esperava 1 envio, houve ${r.sent.length} · revisão=${JSON.stringify(r.suggestionOnly)}`);
  assert.strictEqual(r.sent[0].text, 'Bom dia! Como posso ajudar?');
});
