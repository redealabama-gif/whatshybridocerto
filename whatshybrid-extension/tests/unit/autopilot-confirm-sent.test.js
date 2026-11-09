/**
 * IA-19 — confirmação de envio do autopilot no WhatsApp atual. Ela procurava
 * '.message-out:last-child', que não existe mais: nunca confirmava e esperava
 * o timeout inteiro (6 s) a cada mensagem enviada. No DOM atual a última
 * mensagem é a última raiz [data-id] da conversa; "enviada" = ícone de status.
 */
const assert = require('node:assert');
const { test } = require('../_harness');
const { makeEnv, loadAutopilot, incoming, waitFor, FAST } = require('./_autopilot-env');

test('IA-19: DOM atual (sem .message-out) → envio confirmado pelo ícone, sem esperar 6 s', async () => {
  const env = makeEnv({});
  // DOM atual: nenhum .message-out; a última raiz [data-id] tem o ícone ✓✓
  const lastRoot = {
    parentElement: { closest: () => null },
    getAttribute: (a) => (a === 'data-id' ? '3EB0NEW000000000009' : null),
    querySelector: (sel) => (/msg-dblcheck|msg-check|msg-time/.test(String(sel)) ? {} : null),
  };
  const baseQS = env.document.querySelector;
  env.document.querySelector = (sel) => (String(sel).includes('message-out') ? null : baseQS(sel));
  env.document.querySelectorAll = (sel) => (String(sel).includes('[data-id]') ? [lastRoot] : []);

  const events = [];
  env.window.EventBus.on('autopilot:auto-responded', (d) => events.push(d));
  const AP = loadAutopilot(env);
  try {
    AP.setConfig(FAST);
    await AP.start();
    const t0 = Date.now();
    env.window.EventBus.emit('message:received', incoming('5511900000061', 'Bom dia'));
    await waitFor(() => events.length > 0, 15000);
    const elapsed = Date.now() - t0;
    assert.strictEqual(events.length, 1, 'não respondeu');
    assert.strictEqual(events[0].confirmed, true, 'envio não confirmado');
    assert.ok(elapsed < 4000, `esperou ${elapsed} ms pela confirmação`);
  } finally { env.restore(); }
});
