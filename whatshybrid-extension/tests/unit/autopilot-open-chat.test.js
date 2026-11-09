/**
 * IA-44 — abrir o chat da mensagem no WhatsApp atual.
 *
 * O Autopilot roda no mundo isolado da extensão (pacote "content"), onde não
 * existe window.Store. Para abrir o chat de uma mensagem que chegou em outra
 * conversa, ele procura window.openChatByPhone (o abridor robusto do
 * content.js, que delega ao mundo da página pelo mesmo caminho do Disparo) —
 * mas o content.js nunca o exportava. Sobrava o "Método 3": clicar num link
 * https://web.whatsapp.com/send?phone=…, que recarrega o WhatsApp Web inteiro:
 * a fila em memória se perde e o Autopilot volta desligado (o "ligado" não é
 * persistido). O teste antigo não via isso porque o ambiente simulado dava ao
 * Autopilot uma window.Store que ele não tem em produção.
 */
const assert = require('node:assert');
const { test } = require('../_harness');
const { makeEnv, loadAutopilot, incoming, waitFor, FAST } = require('./_autopilot-env');

async function run(opts, phone, body, waitMs) {
  const env = makeEnv(opts);
  env.stateRef.activeChat = '5511900000000@c.us'; // o operador está em OUTRA conversa
  const suggestionOnly = [];
  env.window.EventBus.on('autopilot:suggestion-only', (d) => suggestionOnly.push(d && d.reason));
  const AP = loadAutopilot(env);
  try {
    AP.setConfig(FAST);
    await AP.start();
    env.window.EventBus.emit('message:received', incoming(phone, body));
    await waitFor(() => env.stateRef.sendLog.length > 0 || env.stateRef.navigations.length > 0, waitMs);
    await new Promise((r) => setTimeout(r, 200));
    return { sent: env.stateRef.sendLog.slice(), navigations: env.stateRef.navigations.slice(), suggestionOnly };
  } finally { env.restore(); }
}

test('IA-44: mensagem em outra conversa, sem window.Store (mundo isolado real) → nunca recarrega o WhatsApp por link /send?phone', async () => {
  const r = await run({ noStore: true }, '5511988887777', 'Qual o horário de vocês?', 3500);
  assert.deepStrictEqual(r.navigations, [], `navegou para ${r.navigations.join(', ')} (recarrega o WhatsApp Web e desliga o Autopilot)`);
  assert.strictEqual(r.sent.length, 0, 'não pode enviar sem confirmar o chat aberto');
});

test('IA-44 (controle): com o abridor do content.js exportado → abre o chat por ele e responde no chat certo', async () => {
  const opened = [];
  const r = await run({ noStore: true, openChatByPhone: async (phone, st) => { opened.push(phone); st.activeChat = `${phone}@c.us`; return true; } },
    '5511988887777', 'Qual o horário de vocês?', 8000);
  assert.deepStrictEqual(opened, ['5511988887777']);
  assert.deepStrictEqual(r.navigations, []);
  assert.strictEqual(r.sent.length, 1);
  assert.strictEqual(r.sent[0].chat, '5511988887777@c.us');
});
