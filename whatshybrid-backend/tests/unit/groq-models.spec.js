'use strict';

/**
 * IA-41 — a Groq desativou os modelos que o backend pedia
 * (llama-3.3-70b-versatile, llama-3.1-*, mixtral, gemma2, llama3-8b-8192):
 * toda chamada voltava 404 "model_not_found". Os modelos de chat que a conta
 * tem hoje são de raciocínio: com limite baixo de tokens o raciocínio consome
 * tudo e o texto volta VAZIO (finish_reason=length), e sem
 * reasoning_effort "low" o qwen também devolve vazio (medido com a chave real,
 * audit/evidencias/fase3/IA-41-groq-modelos.txt).
 */

// O config exige estes segredos no carregamento; valores só de teste.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-jwt-key-for-pipeline-runs-not-a-real-key';
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'ci-webhook-key-for-pipeline-runs';

const GroqProvider = require('../../src/ai/providers/GroqProvider');
const config = require('../../config');

// GET https://api.groq.com/openai/v1/models em 2026-11-09 (modelos de chat).
const DISPONIVEIS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];

let sent;
let reply;
const realFetch = global.fetch;

beforeEach(() => {
  sent = [];
  reply = { choices: [{ message: { content: 'Beleza, vou acompanhar pela Jet. Valeu!' }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } };
  global.fetch = jest.fn(async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => reply };
  });
});
afterAll(() => { global.fetch = realFetch; });

test('modelo padrão da Groq (provider e config) existe hoje na conta', () => {
  expect(DISPONIVEIS).toContain(new GroqProvider({ apiKey: 'k' }).defaultModel);
  expect(DISPONIVEIS).toContain(config.ai.groq.defaultModel);
});

test('pede raciocínio baixo e deixa espaço para a resposta', async () => {
  const groq = new GroqProvider({ apiKey: 'k' });
  await groq.complete([{ role: 'user', content: 'oi' }], { maxTokens: 100, maxRetries: 0 });
  expect(sent).toHaveLength(1);
  expect(DISPONIVEIS).toContain(sent[0].body.model);
  expect(sent[0].body.reasoning_effort).toBe('low');
  expect(sent[0].body.max_tokens).toBeGreaterThanOrEqual(512);
});

test('texto vazio (raciocínio consumiu o limite) é falha — o roteador tenta o próximo provedor', async () => {
  reply = { choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 } };
  const groq = new GroqProvider({ apiKey: 'k' });
  await expect(groq.complete([{ role: 'user', content: 'oi' }], { maxRetries: 0 })).rejects.toThrow(/vazi|empty/i);
});
