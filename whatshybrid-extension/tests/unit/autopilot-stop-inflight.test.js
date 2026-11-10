/**
 * IA-55 — "Parar" o Autopilot não cancelava a resposta que já estava sendo gerada.
 *
 * stopAutopilot() aborta o AbortController e em seguida faz
 * state.abortController = null. As verificações antes de abrir o chat e de
 * enviar perguntam state.abortController?.signal.aborted — com o controlador
 * nulo isso é undefined e o envio seguia. A IA do servidor leva até 30 s: o
 * operador clicava em Parar, o painel mostrava "Parado" e, segundos depois, a
 * resposta ia para o cliente mesmo assim.
 * (Visto como falha intermitente da suíte: a instância de um teste, parada,
 * terminava o envio no ambiente do teste seguinte.)
 */
const assert = require('node:assert');
const { test } = require('../_harness');
const { makeEnv, loadAutopilot, incoming, waitFor, FAST } = require('./_autopilot-env');

test('IA-55: clicar em Parar enquanto a IA gera a resposta → nada é enviado', async () => {
  let liberar;
  const geracao = new Promise((r) => { liberar = r; });
  const env = makeEnv({
    process: async () => {
      await geracao; // a IA do servidor ainda está respondendo
      return { success: true, response: 'Atendemos de segunda a sexta, das 8h às 18h.', metadata: { autopilot: { allowAutoSend: true, minConfidence: 70, riskTier: 'low', reasons: [], escalate: false } } };
    },
  });
  env.stateRef.activeChat = '5511900000055@c.us';
  const AP = loadAutopilot(env);
  try {
    AP.setConfig(FAST);
    await AP.start();
    env.window.EventBus.emit('message:received', incoming('5511900000055', 'Qual o horário de vocês?'));
    await waitFor(() => env.stateRef.backendCalls.length > 0, 8000);
    assert.ok(env.stateRef.backendCalls.length > 0, 'o Autopilot nem pediu a resposta');
    await AP.stop(); // operador clica em Parar
    liberar(); // a resposta chega depois
    await new Promise((r) => setTimeout(r, 3000));
    assert.strictEqual(AP.isRunning(), false);
    assert.strictEqual(env.stateRef.sendLog.length, 0, `enviou depois do Parar: ${JSON.stringify(env.stateRef.sendLog)}`);
  } finally { env.restore(); }
});
