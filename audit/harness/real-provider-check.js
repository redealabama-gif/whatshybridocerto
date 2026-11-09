#!/usr/bin/env node
/**
 * Diagnóstico com as chaves REAIS (autorizado pelo usuário; as chaves ficam
 * fora do repositório). Conversas (sintéticas por padrão) passam pelos dois
 * caminhos de backend do popup "Sugestão de IA" (ai-suggestion-fixed.js), com o mesmo
 * corpo que a extensão manda:
 *   MÉTODO 0 → POST /api/v2/ai/process  (orquestrador; a extensão desiste em 30 s)
 *   MÉTODO 3 → POST /api/v1/ai/complete (LLM direto, o prompt lido do código da extensão)
 * Para cada um: status, tempo, texto final e as chamadas ao provedor (modelo,
 * status, resposta crua), lidas do log de log-fetch.js.
 *
 * Uso: node audit/harness/real-provider-check.js <provider-calls.jsonl> [backend] [tag]
 * Opcional: ONLY=a,b (só esses cenários), CONVERSAS_FILE e OUT_DIR (fora do repo).
 * Saída: audit/evidencias/chaves-reais/<tag>.{json,md}
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CALLS = process.argv[2];
const B = process.argv[3] || 'http://127.0.0.1:3000';
const TAG = process.argv[4] || 'antes';
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '../evidencias/chaves-reais');
const EXT_TIMEOUT_MS = 30000; // ai-suggestion-fixed.js: Promise.race(..., 30000)
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

// 'assistant' = o dono da conta (mensagens enviadas); 'user' = o contato.
// As conversas abaixo são SINTÉTICAS e reproduzem as situações dos prints do
// usuário (ele como comprador recebendo rastreio, colega de trabalho, conversa
// pessoal tensa) mais um controle de loja. As conversas reais dele nunca vão
// para o repositório: para usá-las localmente, CONVERSAS_FILE=<json fora do repo>.
const CONVERSAS = process.env.CONVERSAS_FILE ? JSON.parse(fs.readFileSync(process.env.CONVERSAS_FILE, 'utf8')) : {
  compra_rastreio: [
    ['assistant', 'Boa noite! Conseguiu ver o código de rastreio do meu pedido?'],
    ['user', 'Boa noite! Hoje temos envio'],
    ['user', 'Até as 20h mando o rastreio'],
    ['assistant', 'Beleza, fico no aguardo'],
    ['assistant', 'O que eu comprei é aquele da foto, de 90mg?'],
    ['user', 'Sim'],
    ['user', 'PX123456789BR'],
    ['user', 'O prazo é de uns 7 dias'],
    ['user', 'Esse rastreio é da transportadora Jet'],
  ],
  colega_trabalho: [
    ['assistant', 'Fala, pode tirar uma dúvida minha?'],
    ['assistant', 'Tu tem o contato de alguém do RH da regional?'],
    ['user', 'Pra falar sobre qual assunto??'],
    ['user', 'Eles não vão saber'],
    ['user', 'Vão dizer que é assunto da outra unidade'],
  ],
  pessoal_tensa: [
    ['user', 'Melhor a gente não se falar hoje'],
    ['user', 'Você prometeu e não cumpriu de novo'],
    ['assistant', 'Calma, deixa eu te explicar'],
    ['user', 'Não quero nem imaginar como vai ser da próxima vez'],
    ['user', 'A conclusão é que você vai fazer de novo e pior'],
  ],
  loja_controle: [
    ['user', 'Boa tarde! Vi o anúncio de vocês no Instagram'],
    ['assistant', 'Boa tarde! Que bom que chamou 😊 Como posso ajudar?'],
    ['user', 'Queria saber do plano para clínica odontológica'],
    ['assistant', 'Temos o plano Pro, ideal para clínicas. Quantos dentistas atendem aí?'],
    ['user', 'Somos 3 dentistas e 2 recepcionistas'],
    ['user', 'Quanto fica por mês para esse tamanho? E tem fidelidade?'],
  ],
};

// MÉTODO 3: o mesmo prompt que a extensão manda — lido do código dela, para o
// teste nunca divergir. Sem METODO3_SYSTEM_PROMPT (código anterior ao IA-42),
// usa o prompt antigo de "atendente humano" com a conversa "Atendente:/Cliente:".
const EXT_SRC = fs.readFileSync(path.resolve(__dirname, '../../whatshybrid-extension/modules/ai-suggestion-fixed.js'), 'utf8');
const M3_MATCH = EXT_SRC.match(/const METODO3_SYSTEM_PROMPT = ([\s\S]*?);\n/);
const METODO3_SYSTEM = M3_MATCH ? Function(`return ${M3_MATCH[1]}`)() : null;
function metodo3Messages(conv) {
  if (METODO3_SYSTEM) {
    const t = conv.map(([r, c]) => `${r === 'assistant' ? 'Eu' : 'Contato'}: ${c}`).join('\n');
    return [
      { role: 'system', content: METODO3_SYSTEM },
      { role: 'user', content: `Conversa (as linhas "Eu:" são do dono da conta):\n${t}\n\nEscreva a próxima mensagem dele.` },
    ];
  }
  return [
    { role: 'system', content: 'Você é um atendente humano, atencioso e profissional. Leia a conversa INTEIRA, entenda o que o cliente quis dizer e responda de forma completa e calorosa (não seca, sem soar robótico) — geralmente 2 a 4 frases. Responda em português.' },
    { role: 'user', content: `Conversa recente:\n${transcriptOf(conv)}\n\nResponda à ÚLTIMA mensagem do cliente de forma humana e coerente.` },
  ];
}

async function http(method, url, body, token, timeoutMs = 120000) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch (_) { json = { _text: text.slice(0, 300) }; }
    return { status: r.status, json, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, json: { exception: String(e.message || e) }, ms: Date.now() - t0 };
  }
}
const lines = () => (CALLS && fs.existsSync(CALLS) ? fs.readFileSync(CALLS, 'utf8').split('\n').filter(Boolean) : []);
const callsSince = (n) => lines().slice(n).map((l) => JSON.parse(l));
const short = (s, n = 160) => (s == null ? s : String(s).replace(/\s+/g, ' ').slice(0, n));
const transcriptOf = (conv) => conv.map(([r, c]) => `${r === 'assistant' ? 'Atendente' : 'Cliente'}: ${c}`).join('\n');

(async () => {
  const email = `real-${Date.now()}@example.com`;
  const sign = await http('POST', `${B}/api/v1/auth/signup`, { email, password: 'Audit#Senha2026', name: 'Diagnostico Real', company: 'Diagnostico Chaves Reais', plan: 'pro' });
  if (!sign.json.accessToken) throw new Error(`signup falhou: ${JSON.stringify(sign.json).slice(0, 300)}`);
  const token = sign.json.accessToken;

  const ev = { tag: TAG, generatedAt: new Date().toISOString(), backend: B, extTimeoutMs: EXT_TIMEOUT_MS, scenarios: {} };
  const md = [`# Chaves reais — ${TAG} (${ev.generatedAt})`, '', `Backend: ${B}. A extensão desiste do MÉTODO 0 após ${EXT_TIMEOUT_MS / 1000} s.`, ''];

  for (const [name, conv] of Object.entries(CONVERSAS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    const history = conv.map(([role, content]) => ({ role, content }));
    const lastUserMsg = [...conv].reverse().find(([r]) => r === 'user')[1];
    const sc = { lastUserMsg };

    // MÉTODO 0 — /api/v2/ai/process
    let n = lines().length;
    const m0 = await http('POST', `${B}/api/v2/ai/process`, {
      chatId: `55219${String(Object.keys(ev.scenarios).length).padStart(8, '0')}@c.us`,
      message: lastUserMsg, language: 'pt-BR', businessRules: [], persona: null, history,
    }, token);
    const md0 = m0.json.metadata || {};
    sc.metodo0 = {
      status: m0.status, ms: m0.ms, dentroDoTimeoutDaExtensao: m0.ms <= EXT_TIMEOUT_MS,
      success: m0.json.success, response: m0.json.response, error: m0.json.error || m0.json.message || m0.json.exception,
      intent: md0.intent, provider: md0.provider, model: md0.model, llmFallback: md0.llmFallback,
      safetyReplaced: md0.safetyReplaced, qualityScore: md0.qualityScore,
      chamadas: callsSince(n).map((c) => ({ via: c.via, model: c.model, status: c.status, ms: c.ms, erro: c.error && (c.error.message || c.error.code), exception: c.exception, reply: short(c.reply, 300), system: short(((c.messages || []).find((m) => m.role === 'system') || {}).content, 4000), nMsgs: (c.messages || []).length })),
    };

    // MÉTODO 3 — /api/v1/ai/complete (prompt igual ao da extensão)
    n = lines().length;
    const m3 = await http('POST', `${B}/api/v1/ai/complete`, {
      messages: metodo3Messages(conv),
      temperature: 0.7, maxTokens: 320,
    }, token);
    sc.metodo3 = {
      status: m3.status, ms: m3.ms, text: m3.json.text || m3.json.content, error: m3.json.error || m3.json.message || m3.json.exception,
      provider: m3.json.provider, model: m3.json.model,
      chamadas: callsSince(n).map((c) => ({ via: c.via, model: c.model, status: c.status, ms: c.ms, erro: c.error && (c.error.message || c.error.code), exception: c.exception })),
    };
    ev.scenarios[name] = sc;

    md.push(`## ${name}`, '', `Última mensagem do contato: "${lastUserMsg}"`, '');
    md.push(`- MÉTODO 0 (/api/v2/ai/process): HTTP ${m0.status} em ${(m0.ms / 1000).toFixed(1)} s${m0.ms > EXT_TIMEOUT_MS ? ' — **passa do limite de 30 s da extensão**' : ''}; success=${m0.json.success}; intent=${md0.intent}; llmFallback=${md0.llmFallback}`);
    md.push(`  - resposta: ${m0.json.response ? `"${short(m0.json.response, 400)}"` : `— (erro: ${short(sc.metodo0.error, 200)})`}`);
    for (const c of sc.metodo0.chamadas) md.push(`  - chamada ${c.via} ${c.model}: HTTP ${c.status} em ${c.ms} ms${c.erro ? ` — ${short(c.erro, 160)}` : ''}${c.exception ? ` — ${short(c.exception, 160)}` : ''}${c.reply ? ` → "${short(c.reply, 200)}"` : ''}`);
    md.push(`- MÉTODO 3 (/api/v1/ai/complete): HTTP ${m3.status} em ${(m3.ms / 1000).toFixed(1)} s; ${sc.metodo3.text ? `"${short(sc.metodo3.text, 400)}"` : `erro: ${short(sc.metodo3.error, 200)}`}`);
    for (const c of sc.metodo3.chamadas) md.push(`  - chamada ${c.via} ${c.model}: HTTP ${c.status} em ${c.ms} ms${c.erro ? ` — ${short(c.erro, 160)}` : ''}`);
    md.push('');
    console.log(`[${name}] M0 ${m0.status} ${m0.ms}ms "${short(m0.json.response || sc.metodo0.error, 120)}" | M3 ${m3.status} ${m3.ms}ms "${short(sc.metodo3.text || sc.metodo3.error, 120)}"`);
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${TAG}.json`), JSON.stringify(ev, null, 2));
  fs.writeFileSync(path.join(OUT, `${TAG}.md`), md.join('\n') + '\n');
  console.log(`→ ${path.relative(process.cwd(), path.join(OUT, `${TAG}.md`))}`);
})().catch((e) => { console.error(e); process.exit(1); });
