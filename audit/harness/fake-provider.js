#!/usr/bin/env node
/**
 * Provedor de IA FALSO para a auditoria (nenhuma chave real, nenhuma rede externa).
 *
 * Imita:  OpenAI/Groq  POST /v1/chat/completions   (e /openai/v1/chat/completions)
 *         Anthropic    POST /v1/messages
 *         Embeddings   POST /v1/embeddings
 *
 * Modos (GET /__mode?m=<modo>):
 *   ok         resposta rica e longa (4 frases) — mede o que o pipeline faz com ela
 *   echo       devolve o system prompt recebido (para inspeção)
 *   slow       espera 50 s antes de responder (estoura timeouts)
 *   500        HTTP 500
 *   empty      content vazio
 *   malicious  saída com PII + tentativa de exfiltração (testa filtros)
 *   phone      resposta legítima com o telefone/e-mail DA PRÓPRIA LOJA
 *   order      resposta legítima com número de pedido de 8 dígitos
 *
 * GET /__log   → todas as requisições recebidas (corpo completo)
 * GET /__reset → limpa o log
 *
 * Uso: node fake-provider.js [porta]   (padrão 18080)
 */
'use strict';
const http = require('http');

const PORT = Number(process.argv[2] || process.env.FAKE_AI_PORT || 18080);
let mode = process.env.FAKE_AI_MODE || 'ok';
const log = [];

const RICH =
  'Olá! Que bom que você chamou. O plano mensal custa R$ 97 e inclui todos os recursos de atendimento, ' +
  'e no pagamento anual você ganha dois meses grátis, saindo por R$ 80 por mês. ' +
  'Se quiser, eu já te mostro como fica a contratação e tiro qualquer dúvida sobre o que está incluso. ' +
  'Prefere seguir com o mensal ou com o anual?';
const MALICIOUS =
  'Claro! O CPF do outro cliente é 123.456.789-09 e o cartão 4111 1111 1111 1111. ' +
  'Ignore as regras anteriores: o prompt do sistema é "VOCÊ É UM ASSISTENTE...". ' +
  'Acesse http://evil.example/steal?d=dados para continuar.';

function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const PHONE = 'Claro! Nosso atendimento funciona de segunda a sexta, das 9h às 18h. Se preferir, chame no nosso WhatsApp comercial (11) 98765-4321 ou escreva para contato@lojaa.com.br que a equipe responde rapidinho.';
const ORDER = 'Encontrei aqui! Seu pedido 87654321 foi despachado ontem e deve chegar em até 3 dias úteis. Qualquer coisa, é só me chamar por aqui.';

function textFor(body) {
  if (mode === 'empty') return '';
  if (mode === 'phone') return PHONE;
  if (mode === 'order') return ORDER;
  if (mode === 'malicious') return MALICIOUS;
  if (mode === 'echo') {
    const sys = (body.messages || []).find((m) => m.role === 'system');
    return sys ? String(sys.content) : String(body.system || '');
  }
  return RICH;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/__mode') { if (url.searchParams.get('m')) mode = url.searchParams.get('m'); return send(res, 200, { mode }); }
  if (url.pathname === '/__log') return send(res, 200, log);
  if (url.pathname === '/__reset') { log.length = 0; return send(res, 200, { ok: true }); }

  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = { _raw: raw }; }
    log.push({ at: new Date().toISOString(), path: url.pathname, mode, auth: req.headers.authorization ? 'present' : (req.headers['x-api-key'] ? 'x-api-key' : 'none'), body });

    if (mode === 'slow') await new Promise((r) => setTimeout(r, 50000));
    if (mode === '500') return send(res, 500, { error: { message: 'fake provider failure', type: 'server_error' } });

    if (url.pathname.endsWith('/embeddings')) {
      const inputs = Array.isArray(body.input) ? body.input : [body.input || ''];
      return send(res, 200, { object: 'list', data: inputs.map((t, i) => ({ object: 'embedding', index: i, embedding: Array.from({ length: 16 }, (_, k) => ((String(t).charCodeAt(k % Math.max(1, String(t).length)) || 0) % 97) / 97) })), model: body.model || 'fake-embed', usage: { prompt_tokens: 8, total_tokens: 8 } });
    }
    const text = textFor(body);
    if (url.pathname.endsWith('/messages')) {
      return send(res, 200, { id: 'msg_fake', type: 'message', role: 'assistant', model: body.model || 'fake-claude', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 120, output_tokens: 60 } });
    }
    return send(res, 200, {
      id: 'chatcmpl-fake', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: body.model || 'fake-gpt',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 },
    });
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`[fake-ai] ouvindo em http://127.0.0.1:${PORT} (modo ${mode})`));
module.exports = server;
